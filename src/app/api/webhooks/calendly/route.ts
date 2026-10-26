import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCalendlyWebhook, getResource } from "@/lib/integrations/calendly";
import { findContact } from "@/lib/comms";
import { logActivity, notify, notifyAdmins } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { loadScheduledEvent, recordCalendlyBooking, type Db, type Invitee } from "@/lib/calendly-booking";

export const dynamic = "force-dynamic";

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
    if (body.event === "invitee.created") await recordCalendlyBooking(db, p as unknown as Invitee);
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
