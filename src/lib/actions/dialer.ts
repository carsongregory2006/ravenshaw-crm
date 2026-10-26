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
import { fileContact } from "@/lib/folders";
import { createCallControlApp, getCredentialConnection, listNumberRouting, setNumberConnection } from "@/lib/integrations/telnyx";
import { inboundAppId, saveInboundAppId } from "@/lib/telnyx-inbound";
import { getDialerSettings } from "@/lib/dialer-settings";
import { withDefaults, type DialerSettings } from "@/lib/dialer/settings";
import { callerIdHealth, leadHealth, type Health, type HealthCall } from "@/lib/dialer/health";
import { contactLabel, toE164 } from "@/lib/utils";
import type { Contact, ContactFolder, DialSession } from "@/lib/types";

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
  listId?: string | null; contactIds?: string[] | null; name?: string | null; onlyPending: boolean; fromMode: "fixed" | "local"; fromNumber: string | null;
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
      // Recycled leads wait until their call-again time.
      if (input.onlyPending) q = q.eq("status", "pending").or(`available_at.is.null,available_at.lte.${new Date().toISOString()}`);
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
      const { data: list, error } = await admin.from("lead_lists").insert({ name: input.name?.trim() || `Quick session ${new Date().toLocaleDateString("en-CA")}`, source: "quick", created_by: profile.id }).select("id, name").single();
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
  folderId: string | null;
  health: Health;
}

/** Number health for a set of contacts, from their call history. */
async function healthFor(contacts: { id: string; phone_bad: boolean; do_not_contact: boolean }[]) {
  const admin = createAdminClient();
  const byContact = new Map<string, HealthCall[]>();
  for (const part of chunk(contacts.map((c) => c.id), 200)) {
    const { data } = await admin.from("calls").select("contact_id, direction, started_at, duration_sec, status, disposition").in("contact_id", part).order("started_at", { ascending: false }).limit(5000);
    for (const c of data ?? []) byContact.set(c.contact_id, [...(byContact.get(c.contact_id) ?? []), c as HealthCall]);
  }
  return new Map(contacts.map((c) => [c.id, leadHealth(byContact.get(c.id) ?? [], { phoneBad: c.phone_bad, doNotContact: c.do_not_contact })]));
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
      const { data } = await admin.from("contacts").select("id, first_name, last_name, email, phone, title, status, do_not_contact, phone_bad, sms_opt_out, folder_id, company:companies(name)").in("id", part);
      const rows = (data ?? []) as unknown as (Contact & { company: { name: string } | null })[];
      const health = await healthFor(rows);
      for (const c of rows) {
        leads.set(c.id, {
          id: c.id, name: contactLabel(c) || "Unnamed", phone: c.phone, email: c.email, company: c.company?.name ?? null, title: c.title, status: c.status,
          notes: null, doNotContact: c.do_not_contact, phoneBad: c.phone_bad, smsOptOut: c.sms_opt_out, lastOutcome: null, lastCalledAt: null,
          folderId: c.folder_id, health: health.get(c.id)!,
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
      settings: await getDialerSettings(),
      session: s,
      leads: s.queue.map((cid) => leads.get(cid)).filter((l): l is SessionLead => !!l),
      calls: (calls ?? []) as (CallLite & { id: string; contact_id: string | null })[],
      voicemail: drop as { id: string; name: string } | null,
    };
  });
}

/** Recent calls and timeline for the lead card, plus fresh number health and folder. */
export async function leadHistoryAction(contactId: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const [{ data: calls }, { data: acts }, { data: c }] = await Promise.all([
      sb.from("calls").select("id, direction, started_at, duration_sec, status, disposition, notes, from_number").eq("contact_id", contactId).order("started_at", { ascending: false }).limit(100),
      sb.from("activities").select("id, type, title, body, created_at").eq("contact_id", contactId).neq("type", "call").order("created_at", { ascending: false }).limit(6),
      sb.from("contacts").select("phone_bad, do_not_contact, folder_id").eq("id", contactId).maybeSingle(),
    ]);
    const health = leadHealth((calls ?? []) as HealthCall[], { phoneBad: c?.phone_bad, doNotContact: c?.do_not_contact });
    return { calls: (calls ?? []).slice(0, 6), activities: acts ?? [], health, folderId: (c?.folder_id as string | null) ?? null };
  });
}

// ───────────── Folders ─────────────

/** Folders with how many people are in each (people with no folder count as New). */
export async function foldersAction() {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: folders } = await sb.from("contact_folders").select("*").order("position").order("name");
    const list = (folders ?? []) as ContactFolder[];
    const counts = await Promise.all(list.map(async (f) => {
      let q = sb.from("contacts").select("id", { count: "exact", head: true });
      q = f.system_key === "new" ? q.or(`folder_id.is.null,folder_id.eq.${f.id}`) : q.eq("folder_id", f.id);
      const { count } = await q;
      return count ?? 0;
    }));
    return list.map((f, i) => ({ ...f, count: counts[i] }));
  });
}

export async function createFolderAction(name: string, color: string) {
  return safe(async () => {
    const profile = await me();
    if (!name.trim()) throw new Error("Name the folder");
    const sb = await createClient();
    const { data, error } = await sb.from("contact_folders").insert({ name: name.trim(), color, created_by: profile.id }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: data.id as string };
  });
}

export async function renameFolderAction(id: string, name: string) {
  return safe(async () => {
    await me();
    if (!name.trim()) throw new Error("Name the folder");
    const sb = await createClient();
    const { error, count } = await sb.from("contact_folders").update({ name: name.trim() }, { count: "exact" }).eq("id", id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Built-in folders can't be renamed");
    return null;
  });
}

/** Move people into a folder by hand (any folder, including built-in ones). */
export async function moveToFolderAction(contactIds: string[], folderId: string) {
  return safe(async () => {
    await me();
    if (!contactIds.length) throw new Error("Select at least one person");
    const sb = await createClient();
    let moved = 0;
    for (const part of chunk(contactIds, 300)) {
      const { error, count } = await sb.from("contacts").update({ folder_id: folderId, folder_updated_at: new Date().toISOString() }, { count: "exact" }).in("id", part);
      if (error) throw new Error(error.message);
      moved += count ?? 0;
    }
    revalidatePath("/dialer");
    return { moved };
  });
}

/** People in a folder, with number health. */
export async function folderContactsAction(folderId: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: f } = await sb.from("contact_folders").select("id, system_key").eq("id", folderId).maybeSingle();
    if (!f) throw new Error("Folder not found");
    let q = sb.from("contacts").select("id, first_name, last_name, email, phone, status, do_not_contact, phone_bad, folder_updated_at, company:companies(name)")
      .order("folder_updated_at", { ascending: false, nullsFirst: false }).limit(1000);
    q = f.system_key === "new" ? q.or(`folder_id.is.null,folder_id.eq.${f.id}`) : q.eq("folder_id", f.id);
    const { data } = await q;
    const rows = (data ?? []) as unknown as (Contact & { company: { name: string } | null })[];
    const health = await healthFor(rows);
    return rows.map((c) => ({
      id: c.id, name: contactLabel(c), phone: c.phone, company: c.company?.name ?? null, status: c.status,
      doNotContact: c.do_not_contact, phoneBad: c.phone_bad, movedAt: c.folder_updated_at, health: health.get(c.id)!,
    }));
  });
}

/** 1–5 health for each of our caller IDs, from the last ~5 weeks of outbound calls. */
export async function callerIdHealthAction() {
  return safe(async () => {
    await me();
    const { lines } = await ourLines();
    const since = new Date(Date.now() - 37 * 86_400_000).toISOString();
    const admin = createAdminClient();
    const byLine = new Map<string, HealthCall[]>(lines.map((l) => [l, []]));
    for (let page = 0; page < 20; page++) {
      const { data } = await admin.from("calls").select("from_number, started_at, duration_sec, status, disposition").eq("direction", "outbound").gte("started_at", since).range(page * 1000, page * 1000 + 999);
      for (const c of data ?? []) if (c.from_number && byLine.has(c.from_number)) byLine.get(c.from_number)!.push(c as HealthCall);
      if (!data || data.length < 1000) break;
    }
    return lines.map((line) => ({ line, ...callerIdHealth(byLine.get(line)!) }));
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
    await fileContact(contactId, "bad_dnc");
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

// ───────────── Settings ─────────────

export async function getDialerSettingsAction() {
  return safe(async () => {
    await me();
    return getDialerSettings();
  });
}

export async function saveDialerSettingsAction(next: DialerSettings) {
  return safe(async () => {
    const profile = await me();
    if (profile.role !== "admin" && profile.role !== "ops") throw new Error("Only admins can change dialer settings");
    const v = withDefaults(next);
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const k of ["weekdayStart", "weekdayEnd", "weekendStart", "weekendEnd"] as const) if (!hhmm.test(v.callingHours[k])) throw new Error("Calling hours must be HH:MM");
    v.recycle.delayHours = Math.max(0, Math.min(24 * 30, Number(v.recycle.delayHours) || 0));
    v.recycle.maxAttempts = Math.max(1, Math.min(20, Math.round(Number(v.recycle.maxAttempts) || 5)));
    v.inbound.ringTimeoutSec = Math.max(10, Math.min(60, Math.round(Number(v.inbound.ringTimeoutSec) || 25)));
    if (!v.inbound.greetingText.trim()) throw new Error("Add a voicemail greeting");
    await createAdminClient().from("app_kv").upsert({ key: "dialer_settings", value: v, updated_at: new Date().toISOString() });
    return v;
  });
}

// ───────────── Inbound calls & voicemail (Telnyx routing) ─────────────

async function adminOnly() {
  const profile = await me();
  if (profile.role !== "admin" && profile.role !== "ops") throw new Error("Only admins can change phone routing");
  return profile;
}

/** Which of our numbers go through the CRM's voicemail app vs straight to the browser dialer. */
export async function inboundStatusAction() {
  return safe(async () => {
    await me();
    const appId = await inboundAppId();
    const numbers = await listNumberRouting();
    const sip = process.env.TELNYX_CONNECTION_ID ?? null;
    return {
      appId,
      numbers: numbers.map((n) => ({ number: n.phone_number, routing: appId && n.connection_id === appId ? "voicemail" : n.connection_id === sip ? "browser" : "other" as "voicemail" | "browser" | "other" })),
    };
  });
}

/**
 * Turn on CRM voicemail: create (once) a Telnyx Call Control app pointing at our webhook, using the same outbound
 * profile as the browser dialer, and move our numbers onto it. Outbound calling is unaffected.
 */
export async function enableInboundVoicemailAction() {
  return safe(async () => {
    await adminOnly();
    const sip = process.env.TELNYX_CONNECTION_ID;
    if (!sip) throw new Error("TELNYX_CONNECTION_ID isn't set");
    const base = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
    if (!base) throw new Error("Set NEXT_PUBLIC_APP_URL so Telnyx knows where to send call events");
    let appId = await inboundAppId();
    if (!appId) {
      const conn = await getCredentialConnection(sip);
      const app = await createCallControlApp({ name: "ravenshaw-crm-inbound", webhookUrl: `${base}/api/webhooks/telnyx`, outboundVoiceProfileId: conn.data.outbound?.outbound_voice_profile_id ?? null });
      appId = app.data.id;
      await saveInboundAppId(appId);
    }
    const moved: string[] = [];
    for (const n of await listNumberRouting()) {
      if (n.connection_id === sip) { await setNumberConnection(n.id, appId); moved.push(n.phone_number); }
    }
    return { appId, moved };
  });
}

/** Undo: send our numbers straight to the browser dialer again (no voicemail). */
export async function disableInboundVoicemailAction() {
  return safe(async () => {
    await adminOnly();
    const sip = process.env.TELNYX_CONNECTION_ID;
    const appId = await inboundAppId();
    if (!sip || !appId) throw new Error("CRM voicemail isn't set up");
    const moved: string[] = [];
    for (const n of await listNumberRouting()) {
      if (n.connection_id === appId) { await setNumberConnection(n.id, sip); moved.push(n.phone_number); }
    }
    return { moved };
  });
}

/** Signed link to play an inbound voicemail. */
export async function inboundVoicemailUrlAction(callId: string) {
  return safe(async () => {
    await me();
    const sb = await createClient();
    const { data: c } = await sb.from("calls").select("voicemail_path").eq("id", callId).maybeSingle();
    if (!c?.voicemail_path) throw new Error("No voicemail on this call");
    const { data, error } = await createAdminClient().storage.from("voicemails").createSignedUrl(c.voicemail_path, 3600);
    if (error) throw new Error(error.message);
    return { url: data.signedUrl };
  });
}

/** Edit the lead mid-call: contact fields, company by name, and the list notes. */
export async function updateLeadAction(input: {
  contactId: string; sessionId: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  title: string | null; company: string | null; notes: string | null;
}) {
  return safe(async () => {
    const profile = await me();
    const sb = await createClient();
    const { data: c } = await sb.from("contacts").select("id, phone").eq("id", input.contactId).maybeSingle();
    if (!c) throw new Error("Contact not found");
    const phone = input.phone?.trim() ? toE164(input.phone) : null;
    if (input.phone?.trim() && (!phone || phone.replace(/\D/g, "").length < 10)) throw new Error("That phone number doesn't look right");
    let companyId: string | null | undefined;
    const companyName = input.company?.trim();
    if (companyName) {
      const { data: found } = await sb.from("companies").select("id").ilike("name", companyName).limit(1).maybeSingle();
      companyId = found?.id ?? (await sb.from("companies").insert({ name: companyName, owner_id: profile.id }).select("id").single()).data?.id ?? null;
    } else if (input.company !== undefined) companyId = null;
    const { error } = await sb.from("contacts").update({
      first_name: input.first_name?.trim() || null, last_name: input.last_name?.trim() || null,
      email: input.email?.trim().toLowerCase() || null, phone, title: input.title?.trim() || null,
      ...(companyId !== undefined ? { company_id: companyId } : {}),
    }).eq("id", input.contactId);
    if (error) throw new Error(error.message);
    const { data: s } = await sb.from("dial_sessions").select("list_id").eq("id", input.sessionId).maybeSingle();
    if (s?.list_id) await sb.from("lead_list_items").update({ notes: input.notes?.trim() || null }).eq("list_id", s.list_id).eq("contact_id", input.contactId);
    return { phone, phoneChanged: phone !== c.phone };
  });
}
