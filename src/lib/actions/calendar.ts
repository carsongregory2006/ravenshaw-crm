"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { safe } from "@/lib/actions/util";
import { logActivity } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { addExdate, exdateFor } from "@/lib/calendar/shared";
import { pushCreate, pushDelete, pushPatch, getGoogleEvent, syncUserGoogle, importGoogleCalendarList, fromGoogle } from "@/lib/calendar/google-sync";
import type { CalendarEvent, CalendarRow } from "@/lib/types";

type DbEvent = CalendarEvent & { external_recurring_id?: string | null };

export interface EventInput {
  calendar_id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurrence?: string | null;
  color?: string | null;
  status?: "confirmed" | "tentative" | "cancelled";
  attendees?: { email: string; name?: string; status?: string }[];
  reminders?: { minutes: number }[];
  contact_id?: string | null;
  deal_id?: string | null;
}

export type EditScope = "single" | "all";

const EDITABLE: (keyof EventInput)[] = [
  "calendar_id", "title", "description", "location", "meeting_url", "start_at", "end_at", "all_day",
  "recurrence", "color", "status", "attendees", "reminders", "contact_id", "deal_id",
];

function pick(input: Partial<EventInput>) {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (input[k] !== undefined) out[k] = input[k];
  if (typeof out.title === "string") out.title = (out.title as string).trim() || "(No title)";
  return out as Partial<EventInput>;
}

async function getCalendar(id: string) {
  const sb = await createClient();
  const { data, error } = await sb.from("calendars").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Calendar not found or not accessible");
  return data as CalendarRow;
}

async function getEvent(id: string) {
  const sb = await createClient();
  const { data, error } = await sb.from("calendar_events").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Event not found or not accessible");
  return data as DbEvent;
}

const isGoogle = (c: CalendarRow) => c.source === "google" && !!c.google_calendar_id && !!c.owner_id;

function refresh() {
  revalidatePath("/calendar");
}

// ───────────────────────── events ─────────────────────────

export async function createEvent(input: EventInput) {
  return safe(async () => {
    const me = await requireProfile();
    const sb = await createClient();
    const cal = await getCalendar(input.calendar_id);
    const fields = pick(input);
    if (new Date(fields.end_at!) <= new Date(fields.start_at!)) throw new Error("End must be after start");

    let row: DbEvent | null = null;
    if (isGoogle(cal)) {
      const g = await pushCreate(cal, fields as Partial<DbEvent>);
      if (fields.recurrence) {
        // Google expands recurring series into instances; pull them in.
        await syncUserGoogle(cal.owner_id!);
      } else {
        const { data, error } = await createAdminClient().from("calendar_events")
          .upsert({ ...fromGoogle(g, cal.id), contact_id: fields.contact_id ?? null, deal_id: fields.deal_id ?? null, reminders: fields.reminders ?? [{ minutes: 10 }], created_by: me.id },
            { onConflict: "calendar_id,external_source,external_id" })
          .select("*").single();
        if (error) throw new Error(error.message);
        row = data as DbEvent;
      }
    } else {
      const { data, error } = await sb.from("calendar_events").insert({ ...fields, created_by: me.id }).select("*").single();
      if (error) throw new Error(error.message);
      row = data as DbEvent;
    }

    if (fields.contact_id || fields.deal_id) {
      await logActivity({
        type: "meeting",
        title: `Meeting scheduled: ${fields.title}`,
        body: new Date(fields.start_at!).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
        contact_id: fields.contact_id ?? null,
        deal_id: fields.deal_id ?? null,
        actor_id: me.id,
        metadata: { event_id: row?.id },
      });
    }
    refresh();
    return row;
  });
}

export async function updateEvent(args: { id: string; patch: Partial<EventInput>; scope?: EditScope; occurrenceStart?: string }) {
  return safe(async () => {
    const me = await requireProfile();
    const sb = await createClient();
    const ev = await getEvent(args.id);
    const patch = pick(args.patch);
    const scope: EditScope = args.scope ?? "all";
    const recurringInstance = !!ev.recurrence || !!ev.external_recurring_id;
    if (patch.start_at && patch.end_at && new Date(patch.end_at) <= new Date(patch.start_at)) throw new Error("End must be after start");

    const fromCal = await getCalendar(ev.calendar_id);
    const toCal = patch.calendar_id && patch.calendar_id !== ev.calendar_id ? await getCalendar(patch.calendar_id) : fromCal;

    // Moving between calendars where Google is involved → delete + recreate.
    if (toCal.id !== fromCal.id && (isGoogle(fromCal) || isGoogle(toCal))) {
      const merged: EventInput = {
        calendar_id: toCal.id, title: ev.title, description: ev.description, location: ev.location, meeting_url: ev.meeting_url,
        start_at: ev.start_at, end_at: ev.end_at, all_day: ev.all_day, recurrence: ev.external_recurring_id ? null : ev.recurrence,
        color: ev.color, attendees: ev.attendees, reminders: ev.reminders, contact_id: ev.contact_id, deal_id: ev.deal_id, ...patch,
      };
      const created = await createEvent(merged);
      if (!created.ok) throw new Error(created.error);
      const del = await deleteEvent({ id: ev.id, scope: "single" });
      if (!del.ok) throw new Error(del.error);
      refresh();
      return created.data;
    }

    // ── Google-backed events ──
    if (isGoogle(fromCal) && ev.external_id) {
      if (ev.external_recurring_id && scope === "all") {
        const master = await getGoogleEvent(fromCal, ev.external_recurring_id);
        const body: Partial<DbEvent> = { ...patch } as Partial<DbEvent>;
        if (patch.start_at && patch.end_at && args.occurrenceStart) {
          const delta = new Date(patch.start_at).getTime() - new Date(args.occurrenceStart).getTime();
          const dur = new Date(patch.end_at).getTime() - new Date(patch.start_at).getTime();
          const mStart = master.start.dateTime ? new Date(master.start.dateTime) : new Date(`${master.start.date}T00:00:00Z`);
          const ns = new Date(mStart.getTime() + delta);
          body.start_at = ns.toISOString();
          body.end_at = new Date(ns.getTime() + dur).toISOString();
          body.all_day = patch.all_day ?? ev.all_day;
        } else {
          delete body.start_at;
          delete body.end_at;
        }
        delete body.recurrence;
        await pushPatch(fromCal, ev.external_recurring_id, body);
        await syncUserGoogle(fromCal.owner_id!);
      } else {
        const body = { ...patch, all_day: patch.all_day ?? ev.all_day } as Partial<DbEvent>;
        if (ev.external_recurring_id) delete body.recurrence; // instance exception
        const g = await pushPatch(fromCal, ev.external_id, body);
        const { contact_id, deal_id, reminders } = patch;
        await sb.from("calendar_events").update({
          ...fromGoogle(g, fromCal.id),
          ...(contact_id !== undefined ? { contact_id } : {}),
          ...(deal_id !== undefined ? { deal_id } : {}),
          ...(reminders !== undefined ? { reminders } : {}),
        }).eq("id", ev.id);
        if (patch.recurrence) await syncUserGoogle(fromCal.owner_id!);
      }
      refresh();
      return null;
    }

    // ── internal / calendly events ──
    if (recurringInstance && ev.recurrence && scope === "single" && args.occurrenceStart) {
      const occ = new Date(args.occurrenceStart);
      await sb.from("calendar_events").update({ recurrence: addExdate(ev.recurrence, exdateFor(ev, occ)) }).eq("id", ev.id);
      const occEnd = new Date(occ.getTime() + (new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime()));
      const { data, error } = await sb.from("calendar_events").insert({
        calendar_id: ev.calendar_id, title: ev.title, description: ev.description, location: ev.location, meeting_url: ev.meeting_url,
        start_at: occ.toISOString(), end_at: occEnd.toISOString(), all_day: ev.all_day, color: ev.color, attendees: ev.attendees,
        reminders: ev.reminders, contact_id: ev.contact_id, deal_id: ev.deal_id, created_by: me.id,
        ...patch, recurrence: null,
      }).select("*").single();
      if (error) throw new Error(error.message);
      refresh();
      return data as DbEvent;
    }

    const update: Record<string, unknown> = { ...patch };
    if (recurringInstance && ev.recurrence && args.occurrenceStart && patch.start_at && patch.end_at) {
      // shift the whole series by the same delta as the dragged occurrence
      const delta = new Date(patch.start_at).getTime() - new Date(args.occurrenceStart).getTime();
      const dur = new Date(patch.end_at).getTime() - new Date(patch.start_at).getTime();
      const ns = new Date(new Date(ev.start_at).getTime() + delta);
      update.start_at = ns.toISOString();
      update.end_at = new Date(ns.getTime() + dur).toISOString();
    }
    const { data, error } = await sb.from("calendar_events").update(update).eq("id", ev.id).select("*").single();
    if (error) throw new Error(error.message);
    refresh();
    return data as DbEvent;
  });
}

export async function deleteEvent(args: { id: string; scope?: EditScope; occurrenceStart?: string }) {
  return safe(async () => {
    const sb = await createClient();
    const ev = await getEvent(args.id);
    const cal = await getCalendar(ev.calendar_id);
    const scope = args.scope ?? "all";

    if (isGoogle(cal) && ev.external_id) {
      if (ev.external_recurring_id && scope === "all") {
        await pushDelete(cal, ev.external_recurring_id);
        await sb.from("calendar_events").delete().eq("calendar_id", cal.id).eq("external_recurring_id", ev.external_recurring_id);
      } else {
        await pushDelete(cal, ev.external_id);
      }
      await sb.from("calendar_events").delete().eq("id", ev.id);
    } else if (ev.recurrence && scope === "single" && args.occurrenceStart) {
      await sb.from("calendar_events").update({ recurrence: addExdate(ev.recurrence, exdateFor(ev, new Date(args.occurrenceStart))) }).eq("id", ev.id);
    } else {
      const { error } = await sb.from("calendar_events").delete().eq("id", ev.id);
      if (error) throw new Error(error.message);
    }
    refresh();
    return null;
  });
}

/** Mark the contact as having attended → moves the linked deal to "Showed". */
export async function markShowed(eventId: string) {
  return safe(async () => {
    const me = await requireProfile();
    const ev = await getEvent(eventId);
    const db = createAdminClient();
    let dealId = ev.deal_id;
    if (!dealId && ev.contact_id) {
      const { data: d } = await db.from("deals").select("id, stage:pipeline_stages(is_won,is_lost)").eq("contact_id", ev.contact_id).order("created_at", { ascending: false });
      dealId = (d ?? []).find((x: { stage: unknown }) => {
        const s = (Array.isArray(x.stage) ? x.stage[0] : x.stage) as { is_won: boolean; is_lost: boolean } | null;
        return s && !s.is_won && !s.is_lost;
      })?.id ?? null;
    }
    if (!dealId && !ev.contact_id) throw new Error("Link this event to a contact or deal first");

    let moved = false;
    if (dealId) {
      const [{ data: deal }, { data: stages }] = await Promise.all([
        db.from("deals").select("id, contact_id, stage_id, owner_id").eq("id", dealId).single(),
        db.from("pipeline_stages").select("*"),
      ]);
      const showed = stages?.find((s) => s.key === "showed");
      const cur = stages?.find((s) => s.id === deal?.stage_id);
      if (deal && showed && cur && !cur.is_won && !cur.is_lost && cur.position < showed.position) {
        await db.from("deals").update({ stage_id: showed.id }).eq("id", deal.id);
        moved = true;
        await emitEvent({ type: "stage_changed", contactId: deal.contact_id, dealId: deal.id, data: { stage_key: "showed" } });
      }
    }
    await logActivity({
      type: "meeting",
      title: `Showed up: ${ev.title}`,
      contact_id: ev.contact_id,
      deal_id: dealId,
      actor_id: me.id,
      metadata: { event_id: ev.id },
    });
    revalidatePath("/calendar");
    revalidatePath("/deals");
    return { moved, dealId };
  });
}

// ───────────────────────── calendars ─────────────────────────

export async function createCalendar(name: string, color: string) {
  return safe(async () => {
    const me = await requireProfile();
    const sb = await createClient();
    const { data, error } = await sb.from("calendars").insert({ owner_id: me.id, name: name.trim() || "Untitled", color, source: "internal" }).select("*").single();
    if (error) throw new Error(error.message);
    refresh();
    return data as CalendarRow;
  });
}

export async function updateCalendar(id: string, patch: { name?: string; color?: string; is_visible?: boolean }) {
  return safe(async () => {
    const sb = await createClient();
    const { error } = await sb.from("calendars").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function deleteCalendar(id: string) {
  return safe(async () => {
    const me = await requireProfile();
    const cal = await getCalendar(id);
    if (cal.owner_id !== me.id) throw new Error("You can only delete your own calendars");
    const sb = await createClient();
    const { count } = await sb.from("calendars").select("id", { count: "exact", head: true }).eq("owner_id", me.id).eq("source", "internal");
    if (cal.source === "internal" && (count ?? 0) <= 1) throw new Error("You need at least one calendar");
    const { error } = await sb.from("calendars").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function syncGoogleNow() {
  return safe(async () => {
    const me = await requireProfile();
    const { data } = await createAdminClient().from("google_accounts").select("user_id").eq("user_id", me.id).maybeSingle();
    if (!data) throw new Error("Google Calendar is not connected");
    await importGoogleCalendarList(me.id);
    const changed = await syncUserGoogle(me.id);
    refresh();
    return { changed };
  });
}
