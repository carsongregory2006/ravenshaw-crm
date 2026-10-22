// Client-safe calendar helpers: colors, recurrence expansion, all-day date handling, overlap layout.
import { rrulestr, RRule, type Weekday } from "rrule";
import { addDays, addMinutes, differenceInCalendarDays, format, startOfDay } from "date-fns";
import type { CalendarEvent, CalendarRow } from "@/lib/types";

/** Google Calendar event palette (colorId 1–11). */
export const GOOGLE_EVENT_COLORS: { id: string; name: string; hex: string }[] = [
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "11", name: "Tomato", hex: "#d50000" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "8", name: "Graphite", hex: "#616161" },
];

export const CALENDAR_COLORS = ["#1a73e8", "#039be5", "#33b679", "#0b8043", "#f6bf26", "#f4511e", "#d50000", "#e67c73", "#8e24aa", "#7986cb", "#616161", "#795548"];

export const HOUR_PX = 48;

/** A concrete occurrence of an event within the visible range. */
export interface Occurrence {
  key: string;
  event: CalendarEvent;
  start: Date;
  end: Date;
  color: string;
  calendar?: CalendarRow;
  isRecurring: boolean;
  allDay: boolean;
}

// ── all-day dates are stored as UTC midnight; render them as local dates ──
export function allDayToLocal(iso: string) {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
export function localDateToUtcIso(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}

export function eventStart(ev: Pick<CalendarEvent, "start_at" | "all_day">) {
  return ev.all_day ? allDayToLocal(ev.start_at) : new Date(ev.start_at);
}
export function eventEnd(ev: Pick<CalendarEvent, "end_at" | "all_day">) {
  return ev.all_day ? allDayToLocal(ev.end_at) : new Date(ev.end_at);
}

// ── recurrence ──
// Stored as Google-style lines joined by "\n": "RRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE:20261020T130000Z"

function toRRuleDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function expandOccurrences(ev: CalendarEvent, rangeStart: Date, rangeEnd: Date): { start: Date; end: Date }[] {
  const start = eventStart(ev);
  const end = eventEnd(ev);
  const dur = end.getTime() - start.getTime();
  if (!ev.recurrence) {
    return end > rangeStart && start < rangeEnd ? [{ start, end }] : [];
  }
  try {
    // rrule works in "floating" UTC; feed local wall-clock as UTC so DST doesn't shift times.
    const floatStart = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()));
    const lines = ev.recurrence.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      if (!l.startsWith("EXDATE")) return l;
      // EXDATE stored in real UTC; convert to floating local wall-clock
      const vals = l.split(":")[1].split(",").map((v) => {
        const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
        if (!m) return v;
        const real = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
        const local = ev.all_day ? allDayToLocal(real.toISOString()) : real;
        return toRRuleDate(new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes())));
      });
      return `EXDATE:${vals.join(",")}`;
    });
    const set = rrulestr(`DTSTART:${toRRuleDate(floatStart)}\n${lines.join("\n")}`, { forceset: true });
    const fl = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
    const unfl = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
    const occ = set.between(new Date(fl(rangeStart).getTime() - dur), fl(rangeEnd), true);
    return occ.slice(0, 1000).map((o) => {
      const s = unfl(o);
      return { start: s, end: new Date(s.getTime() + dur) };
    });
  } catch {
    return end > rangeStart && start < rangeEnd ? [{ start, end }] : [];
  }
}

export function buildOccurrences(events: CalendarEvent[], calendars: CalendarRow[], rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const calMap = new Map(calendars.map((c) => [c.id, c]));
  const out: Occurrence[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const cal = calMap.get(ev.calendar_id);
    for (const o of expandOccurrences(ev, rangeStart, rangeEnd)) {
      const multiDay = o.end.getTime() - o.start.getTime() >= 24 * 3600_000;
      out.push({
        key: `${ev.id}:${o.start.getTime()}`,
        event: ev,
        start: o.start,
        end: o.end,
        color: ev.color || cal?.color || "#1a73e8",
        calendar: cal,
        isRecurring: !!ev.recurrence || !!(ev as CalendarEvent & { external_recurring_id?: string }).external_recurring_id,
        allDay: ev.all_day || multiDay,
      });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
}

/** EXDATE value for an occurrence start (real instant, UTC). */
export function exdateFor(ev: Pick<CalendarEvent, "all_day">, occurrenceStart: Date) {
  const d = ev.all_day ? new Date(Date.UTC(occurrenceStart.getFullYear(), occurrenceStart.getMonth(), occurrenceStart.getDate())) : occurrenceStart;
  return toRRuleDate(d);
}

export function addExdate(recurrence: string, value: string) {
  const lines = recurrence.split("\n").filter(Boolean);
  const idx = lines.findIndex((l) => l.startsWith("EXDATE"));
  if (idx >= 0) lines[idx] = `${lines[idx]},${value}`;
  else lines.push(`EXDATE:${value}`);
  return lines.join("\n");
}

// ── repeat presets (Google's dropdown) ──
const WD: Weekday[] = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];
const nth = (d: Date) => Math.ceil(d.getDate() / 7);
const ordinal = (n: number) => ["first", "second", "third", "fourth", "fifth"][n - 1];

export function repeatPresets(d: Date) {
  const day = format(d, "EEEE");
  return [
    { id: "none", label: "Does not repeat", rule: null as string | null },
    { id: "daily", label: "Daily", rule: "RRULE:FREQ=DAILY" },
    { id: "weekly", label: `Weekly on ${day}`, rule: `RRULE:FREQ=WEEKLY;BYDAY=${WD[d.getDay()].toString()}` },
    { id: "monthly", label: `Monthly on the ${ordinal(nth(d))} ${day}`, rule: `RRULE:FREQ=MONTHLY;BYDAY=+${nth(d)}${WD[d.getDay()].toString()}` },
    { id: "monthday", label: `Monthly on day ${d.getDate()}`, rule: `RRULE:FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}` },
    { id: "yearly", label: `Annually on ${format(d, "MMMM d")}`, rule: "RRULE:FREQ=YEARLY" },
    { id: "weekdays", label: "Every weekday (Monday to Friday)", rule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  ];
}

/** Human description of a recurrence string. */
export function describeRecurrence(recurrence: string | null | undefined) {
  if (!recurrence) return null;
  const line = recurrence.split("\n").find((l) => l.startsWith("RRULE"));
  if (!line) return null;
  try {
    const t = RRule.fromString(line.replace(/^RRULE:/, "")).toText();
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch {
    return "Repeats";
  }
}

export function rruleOnly(recurrence: string | null | undefined) {
  return recurrence?.split("\n").find((l) => l.startsWith("RRULE")) ?? null;
}

// ── layout of timed events in a day column (side-by-side like Google) ──
export interface Positioned { occ: Occurrence; top: number; height: number; left: number; width: number }

export function layoutDay(occs: Occurrence[], day: Date): Positioned[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const items = occs
    .filter((o) => !o.allDay && o.end.getTime() > dayStart && o.start.getTime() < dayEnd)
    .map((o) => {
      const s = Math.max(o.start.getTime(), dayStart);
      const e = Math.min(o.end.getTime(), dayEnd);
      return { occ: o, s, e: Math.max(e, s + 15 * 60_000) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const result: Positioned[] = [];
  let cluster: { occ: Occurrence; s: number; e: number; col: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) {
      // expand into free columns to the right
      let span = 1;
      for (let k = c.col + 1; k < cols; k++) {
        if (cluster.some((o) => o.col === k && o.s < c.e && o.e > c.s)) break;
        span++;
      }
      result.push({
        occ: c.occ,
        top: ((c.s - dayStart) / 3600_000) * HOUR_PX,
        height: Math.max(((c.e - c.s) / 3600_000) * HOUR_PX - 1, 18),
        left: c.col / cols,
        width: span / cols,
      });
    }
    cluster = [];
  };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return result;
}

/** Lanes for bars spanning days in a row of `days` (all-day row / month week). */
export interface Bar { occ: Occurrence; startCol: number; endCol: number; lane: number; continuesLeft: boolean; continuesRight: boolean }

export function layoutBars(occs: Occurrence[], days: Date[], filter: (o: Occurrence) => boolean = (o) => o.allDay): Bar[] {
  if (!days.length) return [];
  const first = startOfDay(days[0]);
  const last = addDays(startOfDay(days[days.length - 1]), 1);
  const items = occs
    .filter((o) => filter(o) && o.end > first && o.start < last)
    .map((o) => {
      const sc = Math.max(0, differenceInCalendarDays(o.start, first));
      // exclusive end: an event ending exactly at midnight doesn't occupy that day
      const endRef = o.end.getTime() === startOfDay(o.end).getTime() && o.end > o.start ? addMinutes(o.end, -1) : o.end;
      const ec = Math.min(days.length - 1, differenceInCalendarDays(endRef, first));
      return { occ: o, startCol: sc, endCol: Math.max(sc, ec), continuesLeft: o.start < first, continuesRight: o.end > last };
    })
    .sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol) || Number(b.occ.allDay) - Number(a.occ.allDay) || a.occ.start.getTime() - b.occ.start.getTime());
  const lanes: number[][] = [];
  return items.map((it) => {
    let lane = 0;
    while ((lanes[lane] ?? []).some((c) => c >= it.startCol && c <= it.endCol)) lane++;
    lanes[lane] = [...(lanes[lane] ?? []), ...Array.from({ length: it.endCol - it.startCol + 1 }, (_, i) => it.startCol + i)];
    return { ...it, lane };
  });
}

export function fmtTimeShort(d: Date) {
  return d.getMinutes() === 0 ? format(d, "h a").replace(" ", "").toLowerCase() : format(d, "h:mma").toLowerCase();
}

export function fmtRange(start: Date, end: Date, allDay: boolean) {
  if (allDay) {
    const lastDay = addDays(end, -1);
    return differenceInCalendarDays(lastDay, start) <= 0
      ? format(start, "EEEE, MMMM d")
      : `${format(start, "MMMM d")} – ${format(lastDay, "MMMM d, yyyy")}`;
  }
  if (differenceInCalendarDays(end, start) === 0) return `${format(start, "EEEE, MMMM d")} ⋅ ${format(start, "h:mm")} – ${format(end, "h:mma").toLowerCase()}`;
  return `${format(start, "MMMM d, h:mma").toLowerCase()} – ${format(end, "MMMM d, h:mma").toLowerCase()}`;
}

export function gmtLabel(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const h = Math.trunc(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `GMT${off >= 0 ? "+" : "-"}${String(h).padStart(2, "0")}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

export function tzName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "Local time";
  }
}

/** Text color that reads on a given background hex. */
export function textOn(hex: string) {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 175 ? "#202124" : "#fff";
}
