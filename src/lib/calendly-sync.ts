import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listInvitees, listScheduledEvents } from "@/lib/integrations/calendly";
import { recordCalendlyBooking, type Invitee } from "@/lib/calendly-booking";

/**
 * Polling stand-in for Calendly webhooks (webhooks need a paid Calendly plan): every few minutes, record
 * upcoming bookings we haven't seen and mark cancelled ones. Safe to run repeatedly.
 */
export async function syncCalendly() {
  const db = createAdminClient();
  const out = { booked: 0, canceled: 0 };
  const minStart = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const maxStart = new Date(Date.now() + 90 * 86_400_000).toISOString();

  const active = await listScheduledEvents({ minStart, maxStart });
  if (active.length) {
    const { data: known } = await db.from("calendar_events").select("external_id").eq("external_source", "calendly").in("external_id", active.map((e) => e.uri));
    const seen = new Set((known ?? []).map((k) => k.external_id));
    for (const ev of active.filter((e) => !seen.has(e.uri))) {
      for (const inv of await listInvitees(ev.uri)) {
        if (inv.status !== "active") continue;
        await recordCalendlyBooking(db, { ...inv, scheduled_event: ev } as Invitee);
        out.booked++;
      }
    }
  }

  const canceled = await listScheduledEvents({ minStart, maxStart, status: "canceled" });
  if (canceled.length) {
    const { data } = await db.from("calendar_events").update({ status: "cancelled" })
      .eq("external_source", "calendly").in("external_id", canceled.map((e) => e.uri)).neq("status", "cancelled").select("id");
    out.canceled = data?.length ?? 0;
  }
  return out;
}
