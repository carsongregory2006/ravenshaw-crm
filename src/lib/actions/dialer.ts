"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/actions/util";
import { getProfile } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sendEmailToContact, sendSmsToContact } from "@/lib/comms";
import { computeStats, type CallLite } from "@/lib/dialer/stats";
import { ourLines } from "@/lib/phone-lines";
import { contactLabel, toE164 } from "@/lib/utils";
import type { Contact, DialSession } from "@/lib/types";

async function me() {
  const p = await getProfile();
  if (!p) throw new Error("Not signed in");
  return p;
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Contacts we must not dial: Do Not Contact, flagged bad number, or no phone. */
const undialable = (c: Pick<Contact, "do_not_contact" | "phone_bad" | "phone">) => c.do_not_contact || c.phone_bad || !c.phone;

// ───────────── Lead lists ─────────────

export interface LeadImportRow { full_name?: string; first_name?: string; last_name?: string; phone?: string; email?: string; company?: string; notes?: string }

/**
 * Import a CSV as a named lead list. Matches existing contacts by phone (no duplicates), creates the rest,
 * and leaves out Do Not Contact / bad-number contacts.
 */
export async function importLeadListAction(input: { name: string; rows: LeadImportRow[] }) {
  return safe(async () => {
    const profile = await me();
    if (!input.name.trim()) throw new Error("Give the list a name");
    if (input.rows.length > 5000) throw new Error("Import up to 5,000 rows at a time");
    const admin = createAdminClient();
    const r = { added: 0, created: 0, matched: 0, skippedNoPhone: 0, skippedDnc: 0, skippedBad: 0, duplicateRows: 0 };

    // Normalize + dedupe within the file by phone.
    const seen = new Set<string>();
    const rows: (LeadImportRow & { e164: string })[] = [];
    for (const row of input.rows) {
      const e164 = toE164(row.phone ?? null);
      if (!e164 || e164.replace(/\D/g, "").length < 10) { r.skippedNoPhone++; continue; }
      if (seen.has(e164)) { r.duplicateRows++; continue; }
      seen.add(e164);
      rows.push({ ...row, e164 });
    }

    // Existing contacts by phone.
    const existing = new Map<string, Pick<Contact, "id" | "do_not_contact" | "phone_bad" | "phone">>();
    for (const part of chunk(rows.map((x) => x.e164), 200)) {
      const { data } = await admin.from("contacts").select("id, phone, do_not_contact, phone_bad").in("phone", part);
      for (const c of data ?? []) if (c.phone) existing.set(c.phone, c);
    }

    // Companies by name (find or create).
    const companyIds = new Map<string, string>();
    const names = [...new Set(rows.map((x) => x.company?.trim()).filter(Boolean) as string[])];
    for (const part of chunk(names, 200)) {
      const { data } = await admin.from("companies").select("id, name").in("name", part);
      for (const c of data ?? []) companyIds.set(c.name.toLowerCase(), c.id);
    }
    const missing = names.filter((n) => !companyIds.has(n.toLowerCase()));
    for (const part of chunk(missing, 200)) {
      const { data } = await admin.from("companies").insert(part.map((name) => ({ name, owner_id: profile.id }))).select("id, name");
      for (const c of data ?? []) companyIds.set(c.name.toLowerCase(), c.id);
    }

    const { data: list, error: listErr } = await admin.from("lead_lists").insert({ name: input.name.trim(), source: "csv", created_by: profile.id }).select("id").single();
    if (listErr) throw new Error(listErr.message);

    const items: { contact_id: string; notes: string | null }[] = [];
    const toCreate: (LeadImportRow & { e164: string })[] = [];
    for (const row of rows) {
      const ex = existing.get(row.e164);
      if (ex) {
        if (ex.do_not_contact) { r.skippedDnc++; continue; }
        if (ex.phone_bad) { r.skippedBad++; continue; }
        r.matched++;
        items.push({ contact_id: ex.id, notes: row.notes?.trim() || null });
      } else toCreate.push(row);
    }
    for (const part of chunk(toCreate, 500)) {
      const { data, error } = await admin.from("contacts").insert(part.map((row) => {
        let first = row.first_name?.trim() || null;
        let last = row.last_name?.trim() || null;
        if (!first && !last && row.full_name?.trim()) {
          const bits = row.full_name.trim().split(/\s+/);
          first = bits.shift() || null;
          last = bits.join(" ") || null;
        }
        return {
          first_name: first, last_name: last, phone: row.e164, email: row.email?.trim().toLowerCase() || null,
          company_id: row.company ? companyIds.get(row.company.trim().toLowerCase()) ?? null : null,
          status: "lead", source: "csv_import", owner_id: profile.id, tags: ["cold-call"],
        };
      })).select("id, phone");
      if (error) throw new Error(error.message);
      const byPhone = new Map((data ?? []).map((c) => [c.phone as string, c.id as string]));
      for (const row of part) {
        const id = byPhone.get(row.e164);
        if (id) { r.created++; items.push({ contact_id: id, notes: row.notes?.trim() || null }); }
      }
    }

    for (const [i, part] of chunk(items, 500).entries()) {
      const { error } = await admin.from("lead_list_items").upsert(
        part.map((it, j) => ({ list_id: list.id, contact_id: it.contact_id, notes: it.notes, position: i * 500 + j })),
        { onConflict: "list_id,contact_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    }
    r.added = items.length;

    // CSV notes also go on the contact's timeline.
    const noted = items.filter((it) => it.notes);
    for (const part of chunk(noted, 500)) {
      await admin.from("activities").insert(part.map((it) => ({ type: "note", contact_id: it.contact_id, title: "Note (lead list import)", body: it.notes, actor_id: profile.id })));
    }
    revalidatePath("/dialer");
    return { listId: list.id as string, ...r };
  });
}

/** Build a list from existing contacts (undialable ones are left out). */
export async function createListFromContactsAction(name: string, contactIds: string[]) {
  return safe(async () => {
    const profile = await me();
    if (!name.trim()) throw new Error("Give the list a name");
    if (!contactIds.length) throw new Error("Select at least one person");
    const sb = await createClient();
    const ok: string[] = [];
    let skipped = 0;
    for (const part of chunk(contactIds, 300)) {
      const { data } = await sb.from("contacts").select("id, phone, do_not_contact, phone_bad").in("id", part);
      const byId = new Map((data ?? []).map((c) => [c.id, c]));
      for (const id of part) {
        const c = byId.get(id);
        if (!c || undialable(c)) skipped++; else ok.push(id);
      }
    }
    if (!ok.length) throw new Error("None of the selected people can be dialed (no phone, bad number or Do Not Contact)");
    const admin = createAdminClient();
    const { data: list, error } = await admin.from("lead_lists").insert({ name: name.trim(), source: "contacts", created_by: profile.id }).select("id").single();
    if (error) throw new Error(error.message);
    for (const [i, part] of chunk(ok, 500).entries()) {
      await admin.from("lead_list_items").insert(part.map((contact_id, j) => ({ list_id: list.id, contact_id, position: i * 500 + j })));
    }
    revalidatePath("/dialer");
    return { listId: list.id as string, added: ok.length, skipped };
  });
}

export async function archiveListAction(listId: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { error, count } = await sb.from("lead_lists").update({ archived_at: new Date().toISOString() }, { count: "exact" }).eq("id", listId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("List not found");
    revalidatePath("/dialer");
    return null;
  });
}

/** Put called/skipped leads back in the queue. */
export async function resetListAction(listId: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { error } = await sb.from("lead_list_items").update({ status: "pending" }).eq("list_id", listId);
    if (error) throw new Error(error.message);
    revalidatePath("/dialer");
    return null;
  });
}

// ───────────── Sessions ─────────────

export async function startSessionAction(input: {
  listId?: string | null; contactIds?: string[] | null; onlyPending: boolean; fromMode: "fixed" | "local"; fromNumber: string | null;
  thresholdSec: number; advanceDelaySec: number; voicemailDropId?: string | null;
}) {
  return safe(async () => {
    const profile = await me();
    const sb = await createClient();
    const admin = createAdminClient();
    const { lines, defaultLine } = await ourLines();
    const from = toE164(input.fromNumber ?? null) ?? defaultLine;
    if (from && lines.length && !lines.includes(from)) throw new Error("Pick one of your Telnyx numbers");

    let listId = input.listId ?? null;
    let listName: string | null = null;
    let ids: string[];
    if (listId) {
      const { data: list } = await sb.from("lead_lists").select("id, name").eq("id", listId).maybeSingle();
      if (!list) throw new Error("List not found");
      listName = list.name;
      let q = sb.from("lead_list_items").select("contact_id, status").eq("list_id", listId).order("position").limit(5000);
      if (input.onlyPending) q = q.eq("status", "pending");
      const { data } = await q;
      ids = (data ?? []).map((d) => d.contact_id);
      if (input.contactIds?.length) {
        const want = new Set(input.contactIds);
        ids = ids.filter((id) => want.has(id));
      }
    } else {
      if (!input.contactIds?.length) throw new Error("Pick a list or some leads");
      ids = input.contactIds;
    }

    // Drop anyone who became undialable since the list was built.
    const dialable = new Set<string>();
    for (const part of chunk(ids, 300)) {
      const { data } = await admin.from("contacts").select("id, phone, do_not_contact, phone_bad").in("id", part);
      for (const c of data ?? []) if (!undialable(c)) dialable.add(c.id);
    }
    ids = ids.filter((id) => dialable.has(id));
    if (!ids.length) throw new Error(input.onlyPending ? "No uncalled leads left in this list — reset it or untick “Only leads not called yet”" : "No dialable leads");

    if (!listId) {
      const { data: list, error } = await admin.from("lead_lists").insert({ name: `Quick session ${new Date().toLocaleDateString("en-CA")}`, source: "quick", created_by: profile.id }).select("id, name").single();
      if (error) throw new Error(error.message);
      listId = list.id;
      listName = list.name;
      await admin.from("lead_list_items").insert(ids.map((contact_id, position) => ({ list_id: list.id, contact_id, position })));
    }

    const { data: session, error } = await admin.from("dial_sessions").insert({
      user_id: profile.id, list_id: listId, name: listName, from_mode: input.fromMode, from_number: from,
      queue: ids, position: 0, conversation_threshold_sec: Math.max(5, Math.round(input.thresholdSec || 30)),
      advance_delay_sec: Math.min(30, Math.max(0, Math.round(input.advanceDelaySec ?? 5))), voicemail_drop_id: input.voicemailDropId || null,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: session.id as string };
  });
}

export interface SessionLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  status: string;
  notes: string | null;
  doNotContact: boolean;
  phoneBad: boolean;
  smsOptOut: boolean;
  lastOutcome: string | null;
  lastCalledAt: string | null;
}

export async function loadSessionAction(id: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: session } = await sb.from("dial_sessions").select("*").eq("id", id).maybeSingle();
    if (!session) throw new Error("Session not found");
    const s = session as DialSession;
    const admin = createAdminClient();
    const leads = new Map<string, SessionLead>();
    for (const part of chunk(s.queue, 300)) {
      const { data } = await admin.from("contacts").select("id, first_name, last_name, email, phone, title, status, do_not_contact, phone_bad, sms_opt_out, company:companies(name)").in("id", part);
      for (const c of (data ?? []) as unknown as (Contact & { company: { name: string } | null })[]) {
        leads.set(c.id, {
          id: c.id, name: contactLabel(c) || "Unnamed", phone: c.phone, email: c.email, company: c.company?.name ?? null, title: c.title, status: c.status,
          notes: null, doNotContact: c.do_not_contact, phoneBad: c.phone_bad, smsOptOut: c.sms_opt_out, lastOutcome: null, lastCalledAt: null,
        });
      }
    }
    if (s.list_id) {
      for (const part of chunk(s.queue, 300)) {
        const { data } = await admin.from("lead_list_items").select("contact_id, notes, last_outcome, last_called_at").eq("list_id", s.list_id).in("contact_id", part);
        for (const it of data ?? []) {
          const l = leads.get(it.contact_id);
          if (l) Object.assign(l, { notes: it.notes, lastOutcome: it.last_outcome, lastCalledAt: it.last_called_at });
        }
      }
    }
    const [{ data: calls }, { data: drop }] = await Promise.all([
      admin.from("calls").select("id, contact_id, started_at, duration_sec, status, disposition, from_number").eq("dial_session_id", id).order("started_at"),
      s.voicemail_drop_id ? admin.from("voicemail_drops").select("id, name").eq("id", s.voicemail_drop_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return {
      session: s,
      leads: s.queue.map((cid) => leads.get(cid)).filter((l): l is SessionLead => !!l),
      calls: (calls ?? []) as (CallLite & { id: string; contact_id: string | null })[],
      voicemail: drop as { id: string; name: string } | null,
    };
  });
}

/** Recent calls and timeline for the lead card. */
export async function leadHistoryAction(contactId: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const [{ data: calls }, { data: acts }] = await Promise.all([
      sb.from("calls").select("id, direction, started_at, duration_sec, status, disposition, notes, from_number").eq("contact_id", contactId).order("started_at", { ascending: false }).limit(6),
      sb.from("activities").select("id, type, title, body, created_at").eq("contact_id", contactId).neq("type", "call").order("created_at", { ascending: false }).limit(6),
    ]);
    return { calls: calls ?? [], activities: acts ?? [] };
  });
}

export async function setSessionPositionAction(id: string, position: number, skippedContactId?: string | null) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: s } = await sb.from("dial_sessions").select("skipped, list_id, ended_at").eq("id", id).maybeSingle();
    if (!s) throw new Error("Session not found");
    if (s.ended_at) throw new Error("This session has ended");
    const patch: Record<string, unknown> = { position };
    if (skippedContactId) {
      patch.skipped = [...new Set([...(s.skipped ?? []), skippedContactId])];
      if (s.list_id) await sb.from("lead_list_items").update({ status: "skipped" }).eq("list_id", s.list_id).eq("contact_id", skippedContactId).eq("status", "pending");
    }
    await sb.from("dial_sessions").update(patch).eq("id", id);
    return null;
  });
}

/** End the session: compute and save its summary. */
export async function endSessionAction(id: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: s } = await sb.from("dial_sessions").select("*").eq("id", id).maybeSingle();
    if (!s) throw new Error("Session not found");
    const session = s as DialSession;
    if (session.ended_at && session.stats) return session.stats;
    const endedAt = new Date();
    const { data: calls } = await createAdminClient().from("calls").select("started_at, duration_sec, status, disposition, from_number").eq("dial_session_id", id);
    const stats = computeStats((calls ?? []) as CallLite[], {
      thresholdSec: session.conversation_threshold_sec,
      durationSec: (endedAt.getTime() - new Date(session.started_at).getTime()) / 1000,
      skipped: session.skipped.length,
    });
    await sb.from("dial_sessions").update({ ended_at: endedAt.toISOString(), stats }).eq("id", id);
    revalidatePath("/cold-calling");
    return stats;
  });
}

// ───────────── Per-lead actions ─────────────

export async function markDncAction(contactId: string) {
  return safe(async () => {
    const profile = await me();
    const sb = await createClient();
    const { error, count } = await sb.from("contacts").update({ do_not_contact: true }, { count: "exact" }).eq("id", contactId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Contact not found");
    await logActivity({ type: "system", contact_id: contactId, actor_id: profile.id, title: "Marked Do Not Contact (power dialer)" });
    return null;
  });
}

export async function createCallbackTaskAction(input: { contactId: string; dueAt: string; note?: string | null; callId?: string | null }) {
  return safe(async () => {
    const profile = await me();
    const due = new Date(input.dueAt);
    if (isNaN(due.getTime())) throw new Error("Pick a date and time for the call back");
    const sb = await createClient();
    const { data: c } = await sb.from("contacts").select("first_name, last_name, email, phone").eq("id", input.contactId).maybeSingle();
    if (!c) throw new Error("Contact not found");
    const { error } = await sb.from("tasks").insert({
      title: `Call back ${contactLabel(c)}`, description: input.note || null, due_at: due.toISOString(), priority: "high",
      assignee_id: profile.id, created_by: profile.id, contact_id: input.contactId,
    });
    if (error) throw new Error(error.message);
    await logActivity({ type: "task", contact_id: input.contactId, actor_id: profile.id, title: `Call back scheduled for ${due.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" })}`, metadata: { call_id: input.callId ?? null } });
    return null;
  });
}

/** One-click follow-up: send a saved SMS or email template to the lead. */
export async function sendTemplateAction(input: { contactId: string; templateId: string; from?: string | null }) {
  return safe(async () => {
    const profile = await me();
    const sb = await createClient();
    const [{ data: t }, { data: c }] = await Promise.all([
      sb.from("templates").select("channel, subject, body").eq("id", input.templateId).maybeSingle(),
      sb.from("contacts").select("id").eq("id", input.contactId).maybeSingle(),
    ]);
    if (!t) throw new Error("Template not found");
    if (!c) throw new Error("Contact not found");
    const r = t.channel === "sms"
      ? await sendSmsToContact(input.contactId, t.body, { userId: profile.id, from: input.from })
      : await sendEmailToContact(input.contactId, t.subject || "Following up", t.body, { userId: profile.id });
    if (!r.ok) throw new Error(r.error || "Send failed");
    return { channel: t.channel as "sms" | "email" };
  });
}

// ───────────── Voicemail drops ─────────────

export async function voicemailUploadUrlAction(ext: string) {
  return safe(async () => {
    const profile = await me();
    const clean = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "webm";
    const path = `${profile.id}/${crypto.randomUUID()}.${clean}`;
    const { data, error } = await createAdminClient().storage.from("voicemails").createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: data.token };
  });
}

export async function saveVoicemailAction(input: { name: string; path: string; durationSec?: number | null }) {
  return safe(async () => {
    const profile = await me();
    if (!input.name.trim()) throw new Error("Name the voicemail");
    if (!input.path.startsWith(`${profile.id}/`)) throw new Error("Invalid upload");
    const { data, error } = await createAdminClient().from("voicemail_drops").insert({
      name: input.name.trim(), storage_path: input.path, duration_sec: input.durationSec ?? null, created_by: profile.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/dialer");
    return { id: data.id as string };
  });
}

export async function voicemailUrlAction(id: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: v } = await sb.from("voicemail_drops").select("storage_path").eq("id", id).maybeSingle();
    if (!v) throw new Error("Voicemail not found");
    const { data, error } = await createAdminClient().storage.from("voicemails").createSignedUrl(v.storage_path, 60 * 60 * 4);
    if (error) throw new Error(error.message);
    return { url: data.signedUrl };
  });
}

// ───────────── Dashboard ─────────────

export async function coldCallingDataAction(range: { from: string | null; to: string | null }) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const calls: (CallLite & { dial_session_id: string | null })[] = [];
    for (let page = 0; page < 20; page++) {
      let q = sb.from("calls").select("started_at, duration_sec, status, disposition, from_number, dial_session_id")
        .eq("direction", "outbound").order("started_at", { ascending: false }).range(page * 1000, page * 1000 + 999);
      if (range.from) q = q.gte("started_at", range.from);
      if (range.to) q = q.lt("started_at", range.to);
      const { data } = await q;
      calls.push(...((data ?? []) as typeof calls));
      if (!data || data.length < 1000) break;
    }
    let sq = sb.from("dial_sessions").select("id, name, user_id, from_mode, from_number, started_at, ended_at, stats, queue, position, conversation_threshold_sec, user:profiles(full_name)")
      .order("started_at", { ascending: false }).limit(500);
    if (range.from) sq = sq.gte("started_at", range.from);
    if (range.to) sq = sq.lt("started_at", range.to);
    const { data: sessions } = await sq;
    return { calls, sessions: (sessions ?? []) as unknown as (DialSession & { user: { full_name: string | null } | null })[] };
  });
}
