import {
  startOfMonth, endOfMonth, subMonths, startOfQuarter, startOfYear, subDays, startOfDay, endOfDay,
  differenceInCalendarDays, format, addDays,
} from "date-fns";

export type RangeKey = "this_month" | "last_month" | "qtd" | "ytd" | "30d" | "90d" | "365d" | "custom";

export const RANGE_PRESETS: { key: RangeKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "365d", label: "Last 365 days" },
];

export interface DateRange {
  key: RangeKey;
  label: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  days: number;
}

/** Resolve ?range=…&from=…&to=… into a window plus the equal-length window right before it. */
export function resolveRange(params: { range?: string; from?: string; to?: string } = {}, now = new Date()): DateRange {
  const key = (RANGE_PRESETS.some((p) => p.key === params.range) || params.range === "custom" ? params.range : "this_month") as RangeKey;
  let from: Date, to: Date;
  switch (key) {
    case "last_month": from = startOfMonth(subMonths(now, 1)); to = endOfMonth(subMonths(now, 1)); break;
    case "qtd": from = startOfQuarter(now); to = endOfDay(now); break;
    case "ytd": from = startOfYear(now); to = endOfDay(now); break;
    case "30d": from = startOfDay(subDays(now, 29)); to = endOfDay(now); break;
    case "90d": from = startOfDay(subDays(now, 89)); to = endOfDay(now); break;
    case "365d": from = startOfDay(subDays(now, 364)); to = endOfDay(now); break;
    case "custom": {
      const f = params.from ? new Date(params.from + "T00:00:00") : startOfMonth(now);
      const t = params.to ? new Date(params.to + "T00:00:00") : now;
      from = startOfDay(isNaN(+f) ? startOfMonth(now) : f);
      to = endOfDay(isNaN(+t) ? now : t);
      if (to < from) [from, to] = [startOfDay(to), endOfDay(from)];
      break;
    }
    default: from = startOfMonth(now); to = endOfDay(now);
  }
  const days = differenceInCalendarDays(to, from) + 1;
  // previous comparable window: for whole calendar months compare to previous month(s), else same length
  let prevFrom: Date, prevTo: Date;
  if (key === "this_month" || key === "last_month") {
    prevFrom = startOfMonth(subMonths(from, 1));
    prevTo = key === "this_month" ? endOfDay(addDays(prevFrom, differenceInCalendarDays(to, from))) : endOfMonth(prevFrom);
    if (prevTo > endOfMonth(prevFrom)) prevTo = endOfMonth(prevFrom);
  } else {
    prevTo = endOfDay(subDays(from, 1));
    prevFrom = startOfDay(subDays(from, days));
  }
  const label = key === "custom" ? `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}` : RANGE_PRESETS.find((p) => p.key === key)!.label;
  return { key, label, from, to, prevFrom, prevTo, days };
}

export function rangeQuery(r: Pick<DateRange, "key" | "from" | "to">) {
  const q = new URLSearchParams({ range: r.key });
  if (r.key === "custom") { q.set("from", format(r.from, "yyyy-MM-dd")); q.set("to", format(r.to, "yyyy-MM-dd")); }
  return q.toString();
}

/** First day of each month from `from` to `to` inclusive (max `cap` most recent). */
export function monthsBetween(from: Date, to: Date, cap = 24): Date[] {
  const out: Date[] = [];
  let m = startOfMonth(from);
  while (m <= to) { out.push(m); m = startOfMonth(addDays(endOfMonth(m), 1)); }
  return out.slice(-cap);
}

export const monthKey = (d: Date | string) => format(new Date(d), "yyyy-MM");
export const monthLabel = (d: Date | string) => format(new Date(d), "MMM yy");
