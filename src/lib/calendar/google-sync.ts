import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listEvents, listCalendarList, insertEvent, patchEvent, deleteEvent, gcal, type GEvent,
} from "@/lib/integrations/google";
import { integrations } from "@/lib/env";
import { GOOGLE_EVENT_COLORS } from "./shared";
import type { CalendarEvent, CalendarRow } from "@/lib/types";

type DbEvent = CalendarEvent & { external_recurring_id?: string | null };

const colorFromId = (id?: string) => GOOGLE_EVENT_COLORS.find((c) => c.id === id)?.hex ?? null;
const colorToId = (hex?: string | null) => (hex ? GOOGLE_EVENT_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.id : undefined);

function dateOnlyFromIso(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Google event → calendar_events row fields. */
export function fromGoogle(g: GEvent, calendarId: string) {
  const allDay = !!g.start.date;
  const start = allDay ? `${g.start.date}T00:00:00Z` : new Date(g.start.dateTime!).toISOString();
  const end = allDay ? `${g.end.date}T00:00:00Z` : new Date(g.end.dateTime!).toISOString();
  return {
    calendar_id: calendarId,
    title: g.summary || "(No title)",
    description: g.description ?? null,
    location: g.location ?? null,
    meeting_url: g.hangoutLink ?? null,
    start_at: start,
    end_at: end,
    all_day: allDay,
    recurrence: g.recurrence?.length ? g.recurrence.join("\n") : null,
    color: colorFromId(g.colorId),
    status: g.status === "tentative" ? "tentative" : "confirmed",
    attendees: (g.attendees ?? []).map((a) => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
    external_source: "google",
    external_id: g.id,
    external_recurring_id: (g as GEvent & { recurringEventId?: string }).recurringEventId ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** calendar_events fields → Google event body. */
export function toGoogle(ev: Partial<DbEvent>): Partial<GEvent> & Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (ev.title !== undefined) body.summary = ev.title;
  if (ev.description !== undefined) body.description = ev.description ?? "";
  if (ev.location !== undefined || ev.meeting_url !== undefined) {
    body.location = [ev.location, ev.meeting_url && !ev.location ? ev.meeting_url : null].filter(Boolean).join(" ") || "";
  }
  if (ev.start_at && ev.end_at) {
    if (ev.all_day) {
      body.start = { date: dateOnlyFromIso(ev.start_at) };
      body.end = { date: dateOnlyFromIso(ev.end_at) };
    } else {
      body.start = { dateTime: new Date(ev.start_at).toISOString() };
      body.end = { dateTime: new Date(ev.end_at).toISOString() };
    }
  }
  if (ev.recurrence !== undefined) body.recurrence = ev.recurrence ? ev.recurrence.split("\n").filter(Boolean) : [];
  if (ev.color !== undefined) body.colorId = colorToId(ev.color) ?? null;
  if (ev.attendees !== undefined) body.attendees = (ev.attendees ?? []).map((a) => ({ email: a.email, displayName: a.name }));
  if (ev.reminders !== undefined) {
    body.reminders = { useDefault: false, overrides: (ev.reminders ?? []).slice(0, 5).map((r) => ({ method: "popup", minutes: r.minutes })) };
  }
  return body;
}

/** Import/refresh the user's Google calendar list into `calendars`. */
export async function importGoogleCalendarList(userId: string) {
  const db = createAdminClient();
  const list = await listCalendarList(userId);
  const { data: existing } = await db.from("calendars").select("id, google_calendar_id").eq("owner_id", userId).eq("source", "google");
  const have = new Set((existing ?? []).map((c) => c.google_calendar_id));
  const rows = (list.items ?? [])
    .filter((c) => !have.has(c.id))
    .map((c) => ({
      owner_id: userId,
      name: c.summary,
      color: c.backgroundColor || "#039be5",
      source: "google",
      google_calendar_id: c.id,
      is_visible: !!c.primary,
    }));
  if (rows.length) await db.from("calendars").insert(rows);
}

async function syncCalendar(userId: string, cal: CalendarRow) {
  const db = createAdminClient();
  const timeMin = new Date(Date.now() - 30 * 86400_000).toISOString();
  let full = !cal.sync_token;
  let res: Awaited<ReturnType<typeof listEvents>>;
  try {
    res = await listEvents(userId, cal.google_calendar_id!, { syncToken: cal.sync_token, timeMin });
  } catch (e) {
    if ((e as { status?: number }).status === 410) {
      full = true;
      res = await listEvents(userId, cal.google_calendar_id!, { syncToken: null, timeMin });
    } else throw e;
  }

  const cancelled = res.items.filter((g) => g.status === "cancelled").map((g) => g.id);
  const live = res.items.filter((g) => g.status !== "cancelled" && (g.start?.dateTime || g.start?.date));

  if (cancelled.length) {
    for (let i = 0; i < cancelled.length; i += 200) {
      await db.from("calendar_events").delete().eq("calendar_id", cal.id).eq("external_source", "google").in("external_id", cancelled.slice(i, i + 200));
    }
  }
  for (let i = 0; i < live.length; i += 200) {
    const rows = live.slice(i, i + 200).map((g) => fromGoogle(g, cal.id));
    const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "calendar_id,external_source,external_id" });
    if (error) throw new Error(error.message);
  }
  if (full) {
    // remove local google events in the synced window that Google no longer returns
    const keep = new Set(live.map((g) => g.id));
    const { data: local } = await db.from("calendar_events").select("id, external_id")
      .eq("calendar_id", cal.id).eq("external_source", "google").gte("end_at", timeMin);
    const stale = (local ?? []).filter((r) => r.external_id && !keep.has(r.external_id)).map((r) => r.id);
    for (let i = 0; i < stale.length; i += 200) await db.from("calendar_events").delete().in("id", stale.slice(i, i + 200));
  }
  await db.from("calendars").update({ sync_token: res.nextSyncToken ?? null, last_synced_at: new Date().toISOString(), sync_error: null }).eq("id", cal.id);
  return live.length + cancelled.length;
}

/** Sync every Google calendar of one user. Returns number of changed events. */
export async function syncUserGoogle(userId: string) {
  const db = createAdminClient();
  const { data: cals } = await db.from("calendars").select("*").eq("owner_id", userId).eq("source", "google");
  let changed = 0;
  for (const cal of (cals ?? []) as CalendarRow[]) {
    try {
      changed += await syncCalendar(userId, cal);
    } catch (e) {
      await db.from("calendars").update({ sync_error: e instanceof Error ? e.message.slice(0, 500) : String(e) }).eq("id", cal.id);
    }
  }
  return changed;
}

/** Cron entry: sync every connected user's Google calendars. */
export async function syncAllGoogleCalendars() {
  if (!integrations.google()) return { users: 0, changed: 0 };
  const db = createAdminClient();
  const { data: accts } = await db.from("google_accounts").select("user_id").not("refresh_token", "is", null);
  let changed = 0;
  for (const a of accts ?? []) {
    try {
      changed += await syncUserGoogle(a.user_id);
    } catch (e) {
      console.error("google sync failed", a.user_id, e);
    }
  }
  return { users: accts?.length ?? 0, changed };
}

// ── write-through helpers (called by calendar actions) ──

export async function pushCreate(cal: CalendarRow, ev: Partial<DbEvent>) {
  return insertEvent(cal.owner_id!, cal.google_calendar_id!, toGoogle(ev) as Partial<GEvent>);
}

export async function pushPatch(cal: CalendarRow, externalId: string, ev: Partial<DbEvent>) {
  return patchEvent(cal.owner_id!, cal.google_calendar_id!, externalId, toGoogle(ev) as Partial<GEvent>);
}

export async function pushDelete(cal: CalendarRow, externalId: string) {
  try {
    await deleteEvent(cal.owner_id!, cal.google_calendar_id!, externalId);
  } catch (e) {
    if (![404, 410].includes((e as { status?: number }).status ?? 0)) throw e;
  }
}

export async function getGoogleEvent(cal: CalendarRow, externalId: string) {
  return gcal<GEvent>(cal.owner_id!, `/calendars/${encodeURIComponent(cal.google_calendar_id!)}/events/${externalId}`);
}
