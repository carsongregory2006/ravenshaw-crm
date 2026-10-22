import "server-only";
import { format } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/activity";
import { expandOccurrences } from "./shared";
import type { CalendarEvent } from "@/lib/types";

/**
 * Cron entry: creates in-app notifications for events whose reminder window has opened.
 * Each (event, occurrence, offset) is sent once — tracked in calendar_reminders_sent.
 */
export async function dueReminders() {
  const db = createAdminClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600_000 + 60_000); // reminders up to 1 day ahead

  const [{ data: single }, { data: recurring }] = await Promise.all([
    db.from("calendar_events").select("*, calendar:calendars(owner_id, name)")
      .neq("status", "cancelled").is("recurrence", null).eq("all_day", false)
      .gt("start_at", now.toISOString()).lte("start_at", horizon.toISOString()),
    db.from("calendar_events").select("*, calendar:calendars(owner_id, name)")
      .neq("status", "cancelled").not("recurrence", "is", null).eq("all_day", false)
      .lte("start_at", horizon.toISOString()),
  ]);

  type Row = CalendarEvent & { calendar: { owner_id: string | null; name: string } | null };
  let sent = 0;
  for (const ev of [...(single ?? []), ...(recurring ?? [])] as Row[]) {
    const reminders = Array.isArray(ev.reminders) ? ev.reminders : [];
    if (!reminders.length) continue;
    for (const occ of expandOccurrences(ev, now, horizon)) {
      if (occ.start <= now) continue;
      for (const r of reminders) {
        const minutes = Number(r.minutes);
        if (!isFinite(minutes)) continue;
        const fireAt = occ.start.getTime() - minutes * 60_000;
        if (fireAt > now.getTime()) continue;
        const { data: claimed } = await db.from("calendar_reminders_sent")
          .upsert({ event_id: ev.id, occurrence_start: occ.start.toISOString(), minutes }, { onConflict: "event_id,occurrence_start,minutes", ignoreDuplicates: true })
          .select("event_id");
        if (!claimed?.length) continue;

        const recipients: (string | null)[] = [ev.calendar?.owner_id ?? null, ev.created_by];
        if (ev.contact_id && !ev.calendar?.owner_id) {
          const { data: c } = await db.from("contacts").select("owner_id").eq("id", ev.contact_id).maybeSingle();
          recipients.push(c?.owner_id ?? null);
        }
        const mins = Math.round((occ.start.getTime() - now.getTime()) / 60_000);
        await notify(recipients, {
          title: `${ev.title} ${mins <= 1 ? "starting now" : `in ${mins} min`}`,
          body: `${format(occ.start, "EEE MMM d, h:mm a")}${ev.location ? ` · ${ev.location}` : ""}${ev.meeting_url ? ` · ${ev.meeting_url}` : ""}`,
          link: `/calendar?date=${format(occ.start, "yyyy-MM-dd")}&event=${ev.id}`,
        });
        sent++;
      }
    }
  }
  return { sent };
}
