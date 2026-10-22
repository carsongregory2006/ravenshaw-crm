"use server";
import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/actions/util";
import { appUrl, toE164 } from "@/lib/utils";
import { chat } from "@/lib/integrations/openrouter";
import { sendSms } from "@/lib/integrations/telnyx";
import { sendEmail, emailHtml } from "@/lib/integrations/resend";
import * as calendly from "@/lib/integrations/calendly";
import * as pandadoc from "@/lib/integrations/pandadoc";
import * as mercury from "@/lib/integrations/mercury";
import type { Channel, UserRole, WorkspaceSettings } from "@/lib/types";

async function admin() {
  const p = await getProfile();
  if (!p || p.role !== "admin") throw new Error("Only admins can do this.");
  return p;
}
async function me() {
  const p = await getProfile();
  if (!p) throw new Error("Not signed in");
  return p;
}
const done = () => revalidatePath("/settings");

// ───────────── Profile ─────────────
export async function updateMyProfile(input: { full_name: string; phone: string; avatar_url: string; timezone: string; available_for_rr: boolean }) {
  return safe(async () => {
    const p = await me();
    const sb = await createClient();
    const { error } = await sb.from("profiles").update({
      full_name: input.full_name.trim() || null,
      phone: toE164(input.phone) ?? null,
      avatar_url: input.avatar_url.trim() || null,
      timezone: input.timezone,
      available_for_rr: input.available_for_rr,
    }).eq("id", p.id);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}

// ───────────── General ─────────────
type WsPatch = Partial<Omit<WorkspaceSettings, "id" | "updated_at">>;
export async function updateWorkspace(patch: WsPatch) {
  return safe(async () => {
    await admin();
    const { error } = await createAdminClient().from("workspace_settings").update(patch).eq("id", 1);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}

export async function testAi(model: string) {
  return safe(async () => {
    await me();
    const started = Date.now();
    const text = await chat([{ role: "user", content: "Reply with exactly: Ravenshaw AI is connected." }], { model: model || undefined, maxTokens: 30 });
    return { text, ms: Date.now() - started };
  });
}

// ───────────── Team ─────────────
export async function updateMember(id: string, patch: {
  role?: UserRole; is_active?: boolean; available_for_rr?: boolean;
  commission_rate_setup?: number; commission_rate_recurring?: number; commission_recurring_months?: number | null;
}) {
  return safe(async () => {
    const a = await admin();
    if (id === a.id && (patch.role && patch.role !== "admin" || patch.is_active === false)) throw new Error("You can't demote or deactivate yourself.");
    const db = createAdminClient();
    const { error } = await db.from("profiles").update(patch).eq("id", id);
    if (error) throw error;
    if (patch.is_active === false) await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (patch.is_active === true) await db.auth.admin.updateUserById(id, { ban_duration: "none" });
    done();
  });
}

export async function inviteMember(input: { email: string; full_name: string; role: UserRole; setup: number; recurring: number; months: number | null }) {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    const email = input.email.trim().toLowerCase();
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { full_name: input.full_name, role: input.role },
      redirectTo: appUrl("/auth/callback?next=/settings?tab=profile"),
    });
    if (error) throw error;
    if (data.user) {
      await db.from("profiles").update({
        full_name: input.full_name || null,
        role: input.role,
        is_active: true,
        available_for_rr: true,
        commission_rate_setup: input.setup,
        commission_rate_recurring: input.recurring,
        commission_recurring_months: input.months,
      }).eq("id", data.user.id);
    }
    done();
  });
}

export async function resendInvite(email: string) {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl("/auth/callback?next=/settings?tab=profile") });
    if (error) {
      // Already-confirmed users can't be re-invited; send a magic link instead.
      const { error: e2 } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl("/auth/callback") } });
      if (e2) throw error;
    }
  });
}

export async function setGlobalPool(members: { rep_id: string; weight: number; active: boolean }[]) {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    const { data: existing } = await db.from("rr_members").select("id, rep_id").is("page_id", null);
    const keep = new Set(members.map((m) => m.rep_id));
    const remove = (existing ?? []).filter((e) => !keep.has(e.rep_id)).map((e) => e.id);
    if (remove.length) await db.from("rr_members").delete().in("id", remove);
    for (const m of members) {
      const row = (existing ?? []).find((e) => e.rep_id === m.rep_id);
      if (row) await db.from("rr_members").update({ weight: m.weight, active: m.active }).eq("id", row.id);
      else await db.from("rr_members").insert({ page_id: null, rep_id: m.rep_id, weight: m.weight, active: m.active });
    }
    done();
  });
}

// ───────────── Pipeline ─────────────
export async function saveStage(stage: { id?: string; name: string; color: string; probability: number }) {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    if (stage.id) {
      const { error } = await db.from("pipeline_stages").update({ name: stage.name, color: stage.color, probability: stage.probability }).eq("id", stage.id);
      if (error) throw error;
    } else {
      // insert before the Won/Lost stages
      const { data: all } = await db.from("pipeline_stages").select("id, position, is_won, is_lost").order("position");
      const open = (all ?? []).filter((s) => !s.is_won && !s.is_lost);
      const pos = open.length ? Math.max(...open.map((s) => s.position)) + 1 : 0;
      for (const s of (all ?? []).filter((s) => s.position >= pos)) await db.from("pipeline_stages").update({ position: s.position + 1 }).eq("id", s.id);
      const key = stage.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Math.random().toString(36).slice(2, 6);
      const { error } = await db.from("pipeline_stages").insert({ key, name: stage.name, color: stage.color, probability: stage.probability, position: pos });
      if (error) throw error;
    }
    done();
    revalidatePath("/deals");
  });
}

export async function reorderStages(ids: string[]) {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    await Promise.all(ids.map((id, i) => db.from("pipeline_stages").update({ position: i }).eq("id", id)));
    done();
    revalidatePath("/deals");
  });
}

export async function deleteStage(id: string) {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    const { data: s } = await db.from("pipeline_stages").select("is_won, is_lost").eq("id", id).single();
    if (s?.is_won || s?.is_lost) throw new Error("Won and Lost stages can't be deleted.");
    const { count } = await db.from("deals").select("id", { count: "exact", head: true }).eq("stage_id", id);
    if (count) throw new Error(`${count} deal(s) are in this stage. Move them first.`);
    const { error } = await db.from("pipeline_stages").delete().eq("id", id);
    if (error) throw error;
    done();
  });
}

// ───────────── Templates ─────────────
export async function saveTemplate(t: { id?: string; channel: Channel; name: string; subject?: string | null; body: string }) {
  return safe(async () => {
    const p = await me();
    const sb = await createClient();
    const row = { channel: t.channel, name: t.name, subject: t.channel === "email" ? t.subject ?? "" : null, body: t.body };
    const { error } = t.id
      ? await sb.from("templates").update(row).eq("id", t.id)
      : await sb.from("templates").insert({ ...row, created_by: p.id });
    if (error) throw error;
    done();
  });
}

export async function deleteTemplate(id: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { error } = await sb.from("templates").delete().eq("id", id);
    if (error) throw error;
    done();
  });
}

// ───────────── Integrations ─────────────
export async function testSms(to: string) {
  return safe(async () => {
    await admin();
    const { data: ws } = await createAdminClient().from("workspace_settings").select("sms_from_number, name").eq("id", 1).single();
    const num = toE164(to);
    if (!num) throw new Error("Enter a valid phone number");
    const r = await sendSms({ to: num, text: `Test SMS from ${ws?.name ?? "Ravenshaw AI"} CRM ✅`, from: ws?.sms_from_number || undefined });
    return r.id;
  });
}

export async function testEmail(to: string) {
  return safe(async () => {
    await admin();
    const { data: ws } = await createAdminClient().from("workspace_settings").select("email_from_name, email_from_address, name").eq("id", 1).single();
    const addr = ws?.email_from_address || process.env.RESEND_FROM_EMAIL;
    const from = addr ? (addr.includes("<") ? addr : `${ws?.email_from_name || ws?.name || "Ravenshaw AI"} <${addr}>`) : undefined;
    const r = await sendEmail({ to, subject: "Test email from your CRM", html: emailHtml("This is a test email from your Ravenshaw AI CRM. Email sending works ✅", { brand: ws?.name }), from });
    return r.id;
  });
}

export async function calendlyRegisterWebhook() {
  return safe(async () => {
    await admin();
    const url = appUrl("/api/webhooks/calendly");
    const existing = await calendly.listWebhookSubscriptions();
    if (existing.some((w: { callback_url?: string }) => w.callback_url === url)) return "Webhook already registered";
    await calendly.createWebhookSubscription(url);
    return "Webhook registered";
  });
}

export async function calendlyEventTypes() {
  return safe(async () => {
    await admin();
    return (await calendly.listEventTypes()).map((e) => ({ name: e.name, url: e.scheduling_url, duration: e.duration, active: e.active }));
  });
}

export async function pandadocTemplates() {
  return safe(async () => {
    await admin();
    return (await pandadoc.listTemplates()).map((t) => ({ id: t.id, name: t.name }));
  });
}

export async function mercuryAccounts() {
  return safe(async () => {
    await admin();
    const accts = await mercury.listAccounts();
    return accts.map((a) => ({ id: a.id, name: a.name, available: a.availableBalance, current: a.currentBalance, kind: a.kind, status: a.status, selected: a.id === process.env.MERCURY_ACCOUNT_ID }));
  });
}

// ───────────── System ─────────────
export async function enableScheduler() {
  return safe(async () => {
    await admin();
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("Set CRON_SECRET in Vercel environment variables first.");
    const url = appUrl();
    if (url.includes("localhost")) throw new Error("NEXT_PUBLIC_APP_URL must be your public Vercel URL.");
    const { error } = await createAdminClient().rpc("schedule_crm_tick", { app_url: url, secret });
    if (error) throw error;
    return `Scheduler calls ${url}/api/cron/tick every minute`;
  });
}

export async function runTickNow() {
  return safe(async () => {
    await admin();
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("CRON_SECRET is not set.");
    const res = await fetch(appUrl("/api/cron/tick"), { method: "POST", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new Error(`Tick failed (${res.status}): ${text.slice(0, 300)}`);
    revalidatePath("/settings");
    return text.slice(0, 2000);
  });
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function exportCsv(table: "contacts" | "companies" | "deals" | "invoices" | "payments" | "expenses" | "commissions") {
  return safe(async () => {
    await admin();
    const db = createAdminClient();
    const all: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("*").order("created_at", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return toCsv(all);
  });
}
