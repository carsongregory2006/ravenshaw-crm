import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeVars, sendEmailToContact, sendSmsToContact } from "@/lib/comms";
import { notify, notifyAdmins } from "@/lib/activity";
import { chat } from "@/lib/integrations/openrouter";
import { contactLabel, renderTemplate } from "@/lib/utils";
import type { Automation, AutomationNode, AutomationRun, Contact, WorkspaceSettings } from "@/lib/types";
import { UPDATABLE_FIELDS, type ConditionRule } from "./catalog";

type Db = ReturnType<typeof createAdminClient>;
type RichContact = Contact & { company?: { name: string } | null; owner?: { full_name: string; email: string; phone: string } | null };

const MAX_STEPS = 50;
const LEASE_MS = 2 * 60_000;

// ───────────────────────── time helpers (workspace timezone) ─────────────────────────

function localParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return { hour, minute: Number(get("minute")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}

/** First instant >= d that satisfies the window (stepping 5 minutes, max 8 days). */
function nextAllowed(d: Date, tz: string, w: { start: number; end: number; weekdaysOnly: boolean }) {
  let t = new Date(d);
  for (let i = 0; i < 8 * 24 * 12; i++) {
    const p = localParts(t, tz);
    const okDay = !w.weekdaysOnly || (p.weekday >= 1 && p.weekday <= 5);
    if (okDay && p.hour >= w.start && p.hour < w.end) return t;
    t = new Date(t.getTime() + 5 * 60_000);
  }
  return d;
}

/** Advance to the next local HH:MM at or after d. */
function untilTimeOfDay(d: Date, tz: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return d;
  const p = localParts(d, tz);
  const diff = ((h * 60 + (m || 0)) - (p.hour * 60 + p.minute) + 1440) % 1440;
  const t = new Date(d.getTime() + diff * 60_000);
  t.setSeconds(0, 0);
  return t;
}

export function computeWaitUntil(data: Record<string, unknown>, tz: string, from = new Date()) {
  const unitMs = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[String(data.unit ?? "days")] ?? 86_400_000;
  let t = new Date(from.getTime() + Math.max(0, Number(data.amount ?? 0)) * unitMs);
  if (data.until_time) t = untilTimeOfDay(t, tz, String(data.until_time));
  if (data.business_hours) t = nextAllowed(t, tz, { start: 9, end: 17, weekdaysOnly: true });
  else if (data.weekdays_only) t = nextAllowed(t, tz, { start: 0, end: 24, weekdaysOnly: true });
  return t;
}

// ───────────────────────── run processing ─────────────────────────

interface Ctx {
  db: Db;
  run: AutomationRun;
  automation: Automation;
  contact: RichContact | null;
  settings: WorkspaceSettings | null;
  vars: Record<string, unknown>;
}

type StepResult =
  | { kind: "next"; handle?: "yes" | "no"; message?: string; status?: "ok" | "skipped" | "error" }
  | { kind: "wait"; until: Date; message: string; stayOnNode?: boolean }
  | { kind: "end"; message?: string };

async function log(db: Db, runId: string, node: AutomationNode | null, status: string, message: string) {
  await db.from("automation_run_logs").insert({ run_id: runId, node_id: node?.id ?? null, node_type: node?.type ?? null, status, message: message.slice(0, 2000) });
}

async function loadContact(db: Db, id: string | null) {
  if (!id) return null;
  const { data } = await db.from("contacts")
    .select("*, company:companies(name), owner:profiles!contacts_owner_id_fkey(full_name,email,phone)")
    .eq("id", id).maybeSingle();
  return (data as RichContact) ?? null;
}

function buildVars(ctx: Pick<Ctx, "contact" | "settings" | "run">) {
  const context = (ctx.run.context ?? {}) as Record<string, unknown>;
  const extra = { ...context, ai: context.ai ?? {}, onboarding_link: ctx.settings?.onboarding_calendly_url ?? ctx.settings?.default_calendly_url ?? "" };
  return ctx.contact ? mergeVars(ctx.contact, ctx.settings, extra) : extra;
}

/** Process due runs (cron) or specific runs (just enrolled). Returns number of runs touched. */
export async function processRuns(opts: { runIds?: string[]; limit?: number } = {}) {
  const db = createAdminClient();
  const nowIso = new Date().toISOString();
  let q = db.from("automation_runs").select("id").in("status", ["running", "waiting"]).lte("next_run_at", nowIso);
  if (opts.runIds?.length) q = q.in("id", opts.runIds);
  const { data: due } = await q.order("next_run_at").limit(opts.limit ?? 100);
  if (!due?.length) return 0;

  const { data: settings } = await db.from("workspace_settings").select("*").eq("id", 1).single();
  const autoCache = new Map<string, Automation | null>();
  let processed = 0;

  for (const { id } of due) {
    // claim with a lease so concurrent ticks don't double-process
    const { data: claimed } = await db.from("automation_runs")
      .update({ status: "running", next_run_at: new Date(Date.now() + LEASE_MS).toISOString() })
      .eq("id", id).in("status", ["running", "waiting"]).lte("next_run_at", new Date().toISOString())
      .select("*").maybeSingle();
    if (!claimed) continue;
    const run = claimed as AutomationRun;
    try {
      if (!autoCache.has(run.automation_id)) {
        const { data } = await db.from("automations").select("*").eq("id", run.automation_id).maybeSingle();
        autoCache.set(run.automation_id, (data as Automation) ?? null);
      }
      const automation = autoCache.get(run.automation_id);
      if (!automation) throw new Error("Automation was deleted");
      if (automation.status === "paused") {
        // paused workflows hold their runs; re-check in 15 minutes
        await db.from("automation_runs").update({ status: "waiting", next_run_at: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", run.id);
        continue;
      }
      await executeRun({ db, run, automation, contact: await loadContact(db, run.contact_id), settings: settings as WorkspaceSettings, vars: {} });
      processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log(db, run.id, null, "error", msg);
      await db.from("automation_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", run.id);
    }
  }
  return processed;
}

async function executeRun(ctx: Ctx) {
  const { db, run, automation } = ctx;
  let nodeId = run.current_node_id;
  let steps = 0;

  while (nodeId) {
    if (steps++ >= MAX_STEPS) {
      await db.from("automation_runs").update({ status: "running", current_node_id: nodeId, next_run_at: new Date().toISOString() }).eq("id", run.id);
      return;
    }
    const node = automation.nodes.find((n) => n.id === nodeId);
    if (!node) break;
    ctx.vars = buildVars(ctx);

    let result: StepResult;
    try {
      result = await runNode(node, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log(db, run.id, node, "error", msg);
      // stay on the failed node so "Retry" resumes here
      await db.from("automation_runs").update({ status: "failed", error: msg, current_node_id: node.id, finished_at: new Date().toISOString() }).eq("id", run.id);
      return;
    }

    if (result.kind === "wait") {
      const next = result.stayOnNode ? node.id : nextNodeId(automation, node.id);
      await log(db, run.id, node, "waiting", result.message);
      if (!next) break;
      await db.from("automation_runs").update({
        status: "waiting", current_node_id: next, next_run_at: result.until.toISOString(), context: run.context,
      }).eq("id", run.id);
      return;
    }
    if (result.kind === "end") {
      await log(db, run.id, node, "ok", result.message ?? "Workflow ended");
      nodeId = null;
      break;
    }
    await log(db, run.id, node, result.status ?? "ok", result.message ?? "Done");
    nodeId = nextNodeId(automation, node.id, result.handle);
    // persist progress after each step so a crash resumes at the right node
    await db.from("automation_runs").update({ current_node_id: nodeId, context: run.context }).eq("id", run.id);
  }

  await db.from("automation_runs").update({
    status: "completed", current_node_id: null, finished_at: new Date().toISOString(), context: run.context, error: null,
  }).eq("id", run.id);
}

function nextNodeId(a: Automation, fromId: string, handle?: "yes" | "no") {
  const out = a.edges.filter((e) => e.source === fromId);
  if (handle) return out.find((e) => e.sourceHandle === handle)?.target ?? null;
  return (out.find((e) => !e.sourceHandle) ?? out[0])?.target ?? null;
}

function tpl(s: unknown, vars: Record<string, unknown>) {
  return renderTemplate(String(s ?? ""), vars);
}

async function findDeal(ctx: Ctx) {
  if (ctx.run.deal_id) {
    const { data } = await ctx.db.from("deals").select("id, stage_id").eq("id", ctx.run.deal_id).maybeSingle();
    if (data) return data;
  }
  if (!ctx.run.contact_id) return null;
  const { data } = await ctx.db.from("deals").select("id, stage_id").eq("contact_id", ctx.run.contact_id)
    .is("closed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function evalRule(rule: ConditionRule, ctx: Ctx): Promise<boolean> {
  const { db, run, contact } = ctx;
  const since = run.started_at;
  switch (rule.kind) {
    case "replied": {
      if (!run.contact_id) return false;
      const { count } = await db.from("messages").select("id", { count: "exact", head: true })
        .eq("contact_id", run.contact_id).eq("direction", "inbound").gte("created_at", since);
      return (count ?? 0) > 0;
    }
    case "opened_email": {
      if (!run.contact_id) return false;
      const { count } = await db.from("messages").select("id", { count: "exact", head: true })
        .eq("contact_id", run.contact_id).eq("channel", "email").eq("direction", "outbound").in("status", ["opened", "clicked"]).gte("created_at", since);
      return (count ?? 0) > 0;
    }
    case "booked": {
      if (!run.contact_id) return false;
      const { count } = await db.from("calendar_events").select("id", { count: "exact", head: true })
        .eq("contact_id", run.contact_id).neq("status", "cancelled").gte("created_at", since);
      return (count ?? 0) > 0;
    }
    case "has_tag": {
      const has = !!contact?.tags?.some((t) => t.toLowerCase() === String(rule.tag ?? "").toLowerCase());
      return rule.negate ? !has : has;
    }
    case "stage_is": {
      const deal = await findDeal(ctx);
      if (!deal) return false;
      const { data: st } = await db.from("pipeline_stages").select("key").eq("id", deal.stage_id).maybeSingle();
      return st?.key === rule.stage_key;
    }
    case "field": {
      const raw = (contact as unknown as Record<string, unknown> | null)?.[rule.field];
      const v = raw == null ? "" : String(raw).toLowerCase();
      const want = String(rule.value ?? "").toLowerCase();
      switch (rule.op) {
        case "equals": return v === want;
        case "not_equals": return v !== want;
        case "contains": return v.includes(want);
        case "is_empty": return v === "";
        case "is_not_empty": return v !== "";
      }
    }
  }
  return false;
}

async function runNode(node: AutomationNode, ctx: Ctx): Promise<StepResult> {
  const d = node.data ?? {};
  const { db, run, contact, vars } = ctx;
  const tz = ctx.settings?.timezone || "America/New_York";
  const context = (run.context ?? {}) as Record<string, unknown>;

  const needContact = () => { if (!contact) throw new Error("Run has no contact"); return contact; };
  const quietCheck = (): StepResult | null => {
    if (!d.quiet_hours) return null;
    const now = new Date();
    const ok = nextAllowed(now, tz, { start: 8, end: 20, weekdaysOnly: false });
    if (ok.getTime() - now.getTime() > 60_000) return { kind: "wait", until: ok, stayOnNode: true, message: `Quiet hours — will send at ${ok.toISOString()}` };
    return null;
  };

  switch (node.type) {
    case "trigger":
      return { kind: "next", message: "Triggered" };

    case "send_sms": {
      needContact();
      const q = quietCheck(); if (q) return q;
      const r = await sendSmsToContact(run.contact_id!, String(d.message ?? ""), { automationRunId: run.id, vars });
      if (r.ok) return { kind: "next", message: `SMS sent: ${tpl(d.message, vars).slice(0, 140)}` };
      const skip = /no phone|opted out/i.test(r.error ?? "");
      if (!skip && d.stop_on_error) throw new Error(r.error);
      return { kind: "next", status: skip ? "skipped" : "error", message: `SMS not sent: ${r.error}` };
    }

    case "send_email": {
      needContact();
      const q = quietCheck(); if (q) return q;
      const r = await sendEmailToContact(run.contact_id!, String(d.subject ?? ""), String(d.body ?? ""), { automationRunId: run.id, vars });
      if (r.ok) return { kind: "next", message: `Email sent: ${tpl(d.subject, vars)}` };
      const skip = /no email|opted out/i.test(r.error ?? "");
      if (!skip && d.stop_on_error) throw new Error(r.error);
      return { kind: "next", status: skip ? "skipped" : "error", message: `Email not sent: ${r.error}` };
    }

    case "wait": {
      if (context.test_skip_waits) return { kind: "next", status: "skipped", message: "Wait skipped (test mode)" };
      const until = computeWaitUntil(d, tz);
      if (until.getTime() <= Date.now() + 1000) return { kind: "next", message: "No delay needed" };
      return { kind: "wait", until, message: `Waiting until ${until.toISOString()}` };
    }

    case "condition": {
      const rules = (d.rules as ConditionRule[]) ?? [];
      const results = await Promise.all(rules.map((r) => evalRule(r, ctx)));
      const pass = d.match === "any" ? results.some(Boolean) : results.every(Boolean);
      return { kind: "next", handle: pass ? "yes" : "no", message: `Condition → ${pass ? "Yes" : "No"}` };
    }

    case "update_contact": {
      const c = needContact();
      const field = String(d.field ?? "");
      if (!UPDATABLE_FIELDS.includes(field)) throw new Error(`Field "${field}" cannot be updated by automations`);
      let value: unknown = tpl(d.value, vars);
      if (field === "lead_score") value = Number(value) || 0;
      if (field === "do_not_contact") value = value === "true" || value === "1";
      const { error } = await db.from("contacts").update({ [field]: value }).eq("id", c.id);
      if (error) throw new Error(error.message);
      return { kind: "next", message: `Set ${field} = ${String(value)}` };
    }

    case "add_tag":
    case "remove_tag": {
      const c = needContact();
      const tag = tpl(d.tag, vars).trim();
      const has = c.tags?.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (node.type === "add_tag" && has) return { kind: "next", status: "skipped", message: `Already tagged "${tag}"` };
      const tags = node.type === "add_tag" ? [...(c.tags ?? []), tag] : (c.tags ?? []).filter((t) => t.toLowerCase() !== tag.toLowerCase());
      await db.from("contacts").update({ tags }).eq("id", c.id);
      c.tags = tags;
      if (node.type === "add_tag") {
        const { emitEvent } = await import("@/lib/events");
        await emitEvent({ type: "tag_added", contactId: c.id, dealId: run.deal_id, data: { tag } });
      }
      return { kind: "next", message: `${node.type === "add_tag" ? "Added" : "Removed"} tag "${tag}"` };
    }

    case "assign_owner": {
      const c = needContact();
      let owner: string | null = null;
      if (d.mode === "user") owner = String(d.user_id || "") || null;
      else {
        const { data, error } = await db.rpc("rr_next_rep", { p_page_id: c.landing_page_id ?? null });
        if (error) throw new Error(error.message);
        owner = data as string | null;
      }
      if (!owner) return { kind: "next", status: "skipped", message: "No available rep to assign" };
      await db.from("contacts").update({ owner_id: owner }).eq("id", c.id);
      await db.from("deals").update({ owner_id: owner }).eq("contact_id", c.id).is("owner_id", null);
      const { data: p } = await db.from("profiles").select("full_name").eq("id", owner).maybeSingle();
      await notify([owner], { title: `New lead assigned: ${contactLabel(c)}`, link: `/contacts/${c.id}` });
      c.owner_id = owner;
      c.owner = { full_name: p?.full_name ?? "", email: c.owner?.email ?? "", phone: c.owner?.phone ?? "" };
      return { kind: "next", message: `Assigned to ${p?.full_name ?? owner}` };
    }

    case "create_task": {
      const c = contact;
      const due = new Date(Date.now() + Number(d.due_days ?? 0) * 86_400_000);
      const assignee = d.assignee === "owner" || !d.assignee ? c?.owner_id ?? null : String(d.assignee);
      const { error } = await db.from("tasks").insert({
        title: tpl(d.title, vars), description: d.description ? tpl(d.description, vars) : null, due_at: due.toISOString(),
        priority: (d.priority as string) || "medium", assignee_id: assignee, contact_id: c?.id ?? null, deal_id: run.deal_id,
      });
      if (error) throw new Error(error.message);
      return { kind: "next", message: `Task created: ${tpl(d.title, vars)}` };
    }

    case "move_stage": {
      const { data: stage } = await db.from("pipeline_stages").select("id, key, name").eq("key", String(d.stage_key)).maybeSingle();
      if (!stage) throw new Error(`Stage "${d.stage_key}" not found`);
      const deal = await findDeal(ctx);
      if (!deal) {
        if (!d.create_if_missing || !contact) return { kind: "next", status: "skipped", message: "Contact has no open deal" };
        const { data: created, error } = await db.from("deals").insert({
          name: `${contactLabel(contact)}${contact.company?.name ? ` — ${contact.company.name}` : ""}`,
          contact_id: contact.id, company_id: contact.company_id, owner_id: contact.owner_id, stage_id: stage.id, source: contact.source,
        }).select("id, stage_id").single();
        if (error) throw new Error(error.message);
        run.deal_id = created.id;
        await db.from("automation_runs").update({ deal_id: created.id }).eq("id", run.id);
        return { kind: "next", message: `Created deal in ${stage.name}` };
      }
      if (deal.stage_id === stage.id) return { kind: "next", status: "skipped", message: `Already in ${stage.name}` };
      await db.from("deals").update({ stage_id: stage.id }).eq("id", deal.id);
      const { emitEvent } = await import("@/lib/events");
      await emitEvent({ type: "stage_changed", contactId: run.contact_id, dealId: deal.id, data: { stage_key: stage.key } });
      return { kind: "next", message: `Moved deal to ${stage.name}` };
    }

    case "notify": {
      const n = { title: tpl(d.title, vars), body: tpl(d.body, vars) || undefined, link: contact ? `/contacts/${contact.id}` : undefined };
      const owner = contact?.owner_id;
      if (d.to === "admins") await notifyAdmins(n);
      else if (d.to === "both") await notifyAdmins(n, [owner]);
      else if (owner) await notify([owner], n);
      else await notifyAdmins(n); // unassigned contact → fall back to admins
      return { kind: "next", message: `Notified: ${n.title}` };
    }

    case "ai_generate": {
      const variable = String(d.variable || "output");
      const text = await chat([
        { role: "system", content: String(d.system || "You write concise, warm, human sales follow-ups for an AI automation agency. Return only the requested text — no preamble, no quotes.") },
        { role: "user", content: tpl(d.prompt, vars) },
      ], { maxTokens: 500 });
      const ai = { ...((context.ai as Record<string, unknown>) ?? {}), [variable]: text.trim() };
      run.context = { ...context, ai };
      return { kind: "next", message: `AI → {{ai.${variable}}}: ${text.trim().slice(0, 160)}` };
    }

    case "webhook": {
      const url = String(d.url ?? "");
      if (!/^https?:\/\//.test(url)) throw new Error("Invalid webhook URL");
      const res = await fetch(url, {
        method: String(d.method || "POST"),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automation_id: run.automation_id, run_id: run.id, contact, deal_id: run.deal_id, context }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
      return { kind: "next", message: `Webhook ${res.status}` };
    }

    case "end":
      return { kind: "end" };
  }
  return { kind: "next", status: "skipped", message: `Unknown node type ${node.type}` };
}

// ───────────────────────── manual control ─────────────────────────

function firstNodeId(a: Pick<Automation, "nodes" | "edges">) {
  const trigger = a.nodes.find((n) => n.type === "trigger");
  return a.edges.find((e) => e.source === trigger?.id)?.target ?? null;
}

/** Enroll a contact by hand (ignores trigger + status). Returns the run id. */
export async function enrollContact(automationId: string, contactId: string, opts: { context?: Record<string, unknown>; process?: boolean } = {}) {
  const db = createAdminClient();
  const { data: a } = await db.from("automations").select("*").eq("id", automationId).single();
  if (!a) throw new Error("Automation not found");
  const first = firstNodeId(a as Automation);
  if (!first) throw new Error("Connect the trigger to a first step before enrolling contacts");
  const { data: run, error } = await db.from("automation_runs").insert({
    automation_id: automationId, contact_id: contactId, status: "running", current_node_id: first,
    next_run_at: new Date().toISOString(), context: { event: "manual", ...(opts.context ?? {}) },
  }).select("id").single();
  if (error) throw new Error(error.message);
  await log(db, run.id, (a as Automation).nodes.find((n) => n.type === "trigger") ?? null, "ok", "Enrolled manually");
  if (opts.process !== false) await processRuns({ runIds: [run.id] });
  return run.id as string;
}

/** Run the workflow now for a contact; optionally skip all waits. */
export function testAutomation(automationId: string, contactId: string, skipWaits = false) {
  return enrollContact(automationId, contactId, { context: { test: true, test_skip_waits: skipWaits } });
}

export async function cancelRun(runId: string, reason = "Cancelled manually") {
  const db = createAdminClient();
  await db.from("automation_runs").update({ status: "cancelled", error: reason, finished_at: new Date().toISOString() })
    .eq("id", runId).in("status", ["running", "waiting"]);
  await log(db, runId, null, "skipped", reason);
}

/** Resume a failed/cancelled run from its current node (or skip a wait to run now). */
export async function retryRun(runId: string) {
  const db = createAdminClient();
  const { data: run } = await db.from("automation_runs").select("*").eq("id", runId).single();
  if (!run) throw new Error("Run not found");
  if (!run.current_node_id) throw new Error("Run already finished — nothing to retry");
  await db.from("automation_runs").update({ status: "running", error: null, finished_at: null, next_run_at: new Date().toISOString() }).eq("id", runId);
  await log(db, runId, null, "ok", "Resumed manually");
  await processRuns({ runIds: [runId] });
}
