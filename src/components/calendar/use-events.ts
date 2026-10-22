"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { addDays } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import type { CalendarEvent } from "@/lib/types";

/** Loads events for the visible calendars overlapping [start, end) (plus recurring masters). */
export function useCalendarEvents(calendarIds: string[], start: Date, end: Date) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const key = calendarIds.slice().sort().join(",");
  const s = addDays(start, -1).toISOString();
  const e = addDays(end, 1).toISOString();

  const load = useCallback(async () => {
    const id = ++reqId.current;
    if (!key) { setEvents([]); return; }
    setLoading(true);
    const sb = createClient();
    const ids = key.split(",");
    const [{ data: ranged }, { data: recurring }] = await Promise.all([
      sb.from("calendar_events").select("*").in("calendar_id", ids).is("recurrence", null).lt("start_at", e).gt("end_at", s).limit(2000),
      sb.from("calendar_events").select("*").in("calendar_id", ids).not("recurrence", "is", null).lt("start_at", e).limit(500),
    ]);
    if (id !== reqId.current) return;
    setEvents([...(ranged ?? []), ...(recurring ?? [])] as CalendarEvent[]);
    setLoading(false);
  }, [key, s, e]);

  useEffect(() => { load(); }, [load]);

  return { events, setEvents, loading, reload: load };
}
