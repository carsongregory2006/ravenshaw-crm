import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCalendlyWebhook, getResource } from "@/lib/integrations/calendly";
import { findContact } from "@/lib/comms";
import { logActivity, notify, notifyAdmins } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { toE164 } from "@/lib/utils";
import type { Contact, PipelineStage } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof createAdminClient>;

interface Invitee {
  uri: string;
  email: string;
  name?: string;
  first_name?: string | null;
  last_name?: string | null;
  text_reminder_number?: string | null;
  questions_and_answers?: { question: string; answer: string }[];
  tracking?: Record<string, string | null>;
  cancel_url?: string;
  reschedule_url?: string;
  rescheduled?: boolean;
  cancellation?: { reason?: string; canceled_by?: string };
  scheduled_event?: ScheduledEvent;
  event?: string;
}
interface ScheduledEvent {
  uri: string;
  name: string;
  start_time: string;
  end_time: string;
  location?: { type?: string; location?: string; join_url?: string };
  event_memberships?: { user_email?: string; user_name?: string }[];
}

async function ensureCalendlyCalendar(db: Db) {
  const { data } = await db.from("calendars").select("id").eq("source", "calendly").is("owner_id", null).limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await db.from("calendars").insert({ name: "Calendly", color: "#006bff", source: "calendly", owner_id: null }).select("id").single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

function splitName(inv: Invitee) {
  if (inv.first_name || inv.last_name) return { first: inv.first_name ?? null, last: inv.last_name ?? null };
  const parts = (inv.name ?? "").trim().split(/\s+/);
  return { first: parts[0] || null, last: parts.slice(1).join(" ") || null };
}

function phoneFrom(inv: Invitee) {
  if (inv.text_reminder_number) return inv.text_reminder_number;
  const qa = inv.questions_and_answers?.find((q) => /phone|mobile|cell|number/i.test(q.question));
  return qa?.answer ?? null;
}

async function resolveContact(db: Db, inv: Invitee): Promise<Contact> {
  const tr = inv.tracking ?? {};
  const hint = tr.utm_content || tr.salesforce_uuid;
  if (hint && UUID.test(hint)) {
    const { data } = await db.from("contacts").select("*").eq("id", hint).maybeSingle();
    if (data) return data as Contact;
  }
  const phone = phoneFrom(inv);
  const found = await findContact({ email: inv.email, phone });
  if (found) {
    const patch: Record<string, unknown> = {};
    if (!found.phone && phone) patch.phone = toE164(phone);
    if (!found.first_name && !found.last_name) {
      const n = splitName(inv);
      patch.first_name = n.first;
      patch.last_name = n.last;
    }
    if (Object.keys(patch).length) await db.from("contacts").update(patch).eq("id", found.id);
    return { ...found, ...patch } as Contact;
  }
  const n = splitName(inv);
  const { data: owner } = await db.rpc("rr_next_rep", { p_page_id: null });
  const { data, error } = await db.from("contacts").insert({
    first_name: n.first,
    last_name: n.last,
    email: inv.email,
    phone: toE164(phone),
    source: "calendly",
    status: "lead",
    owner_id: (owner as string | null) ?? null,
    utm_source: tr.utm_source ?? null,
    utm_medium: tr.utm_medium ?? null,
    utm_campaign: tr.utm_campaign ?? null,
    utm_term: tr.utm_term ?? null,
    utm_content: tr.utm_content ?? null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  await emitEvent({ type: "lead_created", contactId: data.id, data: { source: "calendly" } });
  return data as Contact;
}

async function stages(db: Db) {
  const { data } = await db.from("pipeline_stages").select("*").order("position");
  return (data ?? []) as PipelineStage[];
}

/** Latest open deal for a contact; creates one at "Booked" if none exists. Moves earlier deals forward to "Booked". */
async function ensureBookedDeal(db: Db, contact: Contact, eventName: string) {
  const all = await stages(db);
  const booked = all.find((s) => s.key === "booked");
  const { data: deals } = await db.from("deals").select("id, stage_id, owner_id").eq("contact_id", contact.id).order("created_at", { ascending: false });
  const open = (deals ?? []).find((d) => {
    const s = all.find((x) => x.id === d.stage_id);
    return s && !s.is_won && !s.is_lost;
  });
  if (open) {
    const cur = all.find((s) => s.id === open.stage_id)!;
    if (booked && cur.position < booked.position) {
      await db.from("deals").update({ stage_id: booked.id }).eq("id", open.id);
      await emitEvent({ type: "stage_changed", contactId: contact.id, dealId: open.id, data: { stage_key: "booked" } });
    }
    return open.id as string;
  }
  if (!booked) return null;
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || "New deal";
  const { data: created } = await db.from("deals").insert({
    name: `${name} — ${eventName}`,
    contact_id: contact.id,
    company_id: contact.company_id,
    owner_id: contact.owner_id,
    stage_id: booked.id,
    source: "calendly",
  }).select("id").single();
  if (created) await emitEvent({ type: "stage_changed", contactId: contact.id, dealId: created.id, data: { stage_key: "booked" } });
  return (created?.id as string) ?? null;
}

async function loadScheduledEvent(inv: Invitee): Promise<ScheduledEvent | null> {
  if (inv.scheduled_event?.uri) return inv.scheduled_event;
  if (inv.event) {
    try { return (await getResource(inv.event)) as ScheduledEvent; } catch { return null; }
  }
  return null;
}

async function onCreated(db: Db, inv: Invitee) {
  const se = await loadScheduledEvent(inv);
  if (!se) throw new Error("Missing scheduled_event");
  const contact = await resolveContact(db, inv);
  const calendarId = await ensureCalendlyCalendar(db);
  const dealId = await ensureBookedDeal(db, contact, se.name);
  const displayName = inv.name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || inv.email;

  const attendees = [
    { email: inv.email, name: displayName, status: "accepted" },
    ...(se.event_memberships ?? []).filter((m) => m.user_email).map((m) => ({ email: m.user_email!, name: m.user_name, status: "accepted" })),
  ];
  const qa = (inv.questions_and_answers ?? []).map((q) => `${q.question}\n${q.answer}`).join("\n\n");
  const desc = [qa, inv.reschedule_url ? `Reschedule: ${inv.reschedule_url}` : null, inv.cancel_url ? `Cancel: ${inv.cancel_url}` : null].filter(Boolean).join("\n\n");

  const { data: ev, error } = await db.from("calendar_events").upsert({
    calendar_id: calendarId,
    title: `${se.name} with ${displayName}`,
    description: desc || null,
    location: se.location?.location ?? (se.location?.type && !se.location?.join_url ? se.location.type : null),
    meeting_url: se.location?.join_url ?? null,
    start_at: se.start_time,
    end_at: se.end_time,
    all_day: false,
    status: "confirmed",
    attendees,
    contact_id: contact.id,
    deal_id: dealId,
    external_source: "calendly",
    external_id: se.uri,
  }, { onConflict: "calendar_id,external_source,external_id" }).select("id").single();
  if (error) throw new Error(error.message);

  const when = new Date(se.start_time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
  await logActivity({
    type: "meeting",
    title: `${inv.rescheduled ? "Rescheduled" : "Booked"}: ${se.name}`,
    body: `${when} ET${se.location?.join_url ? `\n${se.location.join_url}` : ""}`,
    contact_id: contact.id,
    deal_id: dealId,
    metadata: { event_id: ev?.id, calendly_event: se.uri, source: "calendly" },
  });
  const n = { title: `New booking: ${displayName}`, body: `${se.name} · ${when} ET`, link: `/contacts/${contact.id}` };
  if (contact.owner_id) await notify([contact.owner_id], n);
  else await notifyAdmins(n);
  await emitEvent({ type: "booking_created", contactId: contact.id, dealId, data: { event_name: se.name, start_time: se.start_time } });
}

async function onCanceled(db: Db, inv: Invitee) {
  const se = await loadScheduledEvent(inv);
  const uri = se?.uri ?? inv.event;
  if (!uri) return;
  const { data: ev } = await db.from("calendar_events").update({ status: "cancelled" })
    .eq("external_source", "calendly").eq("external_id", uri).select("id, contact_id, deal_id, title").maybeSingle();
  if (inv.rescheduled) return; // a new invitee.created follows
  const contact = ev?.contact_id ? { id: ev.contact_id } : await findContact({ email: inv.email });
  await logActivity({
    type: "meeting",
    title: `Meeting canceled${se?.name ? `: ${se.name}` : ""}`,
    body: inv.cancellation?.reason ? `Reason: ${inv.cancellation.reason}` : null,
    contact_id: contact?.id ?? null,
    deal_id: ev?.deal_id ?? null,
    metadata: { calendly_event: uri, canceled_by: inv.cancellation?.canceled_by },
  });
  if (contact?.id) {
    const { data: c } = await db.from("contacts").select("owner_id, first_name, last_name, email").eq("id", contact.id).maybeSingle();
    const n = { title: `Booking canceled: ${[c?.first_name, c?.last_name].filter(Boolean).join(" ") || c?.email || inv.email}`, body: inv.cancellation?.reason ?? undefined, link: `/contacts/${contact.id}` };
    if (c?.owner_id) await notify([c.owner_id], n);
    else await notifyAdmins(n);
  }
}

async function onNoShow(db: Db, payload: { invitee?: string; uri?: string }) {
  if (!payload.invitee) return;
  const inv = (await getResource(payload.invitee)) as Invitee;
  const contact = await findContact({ email: inv.email });
  if (!contact) return;
  const tags = Array.from(new Set([...(contact.tags ?? []), "no-show"]));
  await db.from("contacts").update({ tags }).eq("id", contact.id);
  const { data: ev } = inv.event
    ? await db.from("calendar_events").select("id, deal_id, title").eq("external_source", "calendly").eq("external_id", inv.event).maybeSingle()
    : { data: null };
  await logActivity({ type: "meeting", title: `No-show${ev?.title ? `: ${ev.title}` : ""}`, contact_id: contact.id, deal_id: ev?.deal_id ?? null, metadata: { calendly_invitee: inv.uri } });
  if (contact.owner_id) await notify([contact.owner_id], { title: `No-show: ${inv.name ?? inv.email}`, link: `/contacts/${contact.id}` });
  if (!(contact.tags ?? []).includes("no-show")) {
    await emitEvent({ type: "tag_added", contactId: contact.id, dealId: ev?.deal_id ?? null, data: { tag: "no-show" } });
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyCalendlyWebhook(raw, req.headers)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: { event: string; created_at?: string; payload: Record<string, unknown> };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const db = createAdminClient();
  const p = body.payload ?? {};
  const externalId = `${body.event}:${(p.uri as string) ?? ""}:${body.created_at ?? ""}`;

  const inserted = await db.from("webhook_events")
    .insert({ provider: "calendly", event_type: body.event, external_id: externalId, payload: body })
    .select("id").single();
  let logged = inserted.data;
  const dupErr = inserted.error;
  if (dupErr?.code === "23505") {
    // retry of a delivery we've seen: skip if it was processed, otherwise reprocess
    const { data: prev } = await db.from("webhook_events").select("id, processed_at")
      .eq("provider", "calendly").eq("external_id", externalId).maybeSingle();
    if (!prev || prev.processed_at) return NextResponse.json({ ok: true, duplicate: true });
    logged = { id: prev.id };
  } else if (dupErr) {
    console.error("calendly webhook log failed", dupErr);
  }

  try {
    if (body.event === "invitee.created") await onCreated(db, p as unknown as Invitee);
    else if (body.event === "invitee.canceled") await onCanceled(db, p as unknown as Invitee);
    else if (body.event === "invitee_no_show.created") await onNoShow(db, p as { invitee?: string });
    if (logged) await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", logged.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("calendly webhook", msg);
    if (logged) await db.from("webhook_events").update({ error: msg }).eq("id", logged.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
