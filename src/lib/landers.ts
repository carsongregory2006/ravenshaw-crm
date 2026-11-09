import type { LanderVisit } from "@/lib/types";

/** A visit that left within 10 seconds without clicking anything. */
const isBounce = (v: LanderVisit) => v.time_on_page_s < 10 && v.cta_clicks === 0 && !v.converted;

export const RETENTION_MARKS = [5, 10, 25, 50, 75, 90, 100] as const;

export interface LanderSummary {
  visits: number;
  visitors: number;
  avgTime: number;
  bounceRate: number;
  avgScroll: number;
  clickRate: number;
  leads: number;
  convRate: number;
  booked: number;
  plays: number;
  playRate: number;
  avgWatch: number;
  avgPctWatched: number;
  completionRate: number;
  retention: { mark: number; share: number }[];
  /** Conversion rate of visitors who watched at least half the VSL, vs everyone else. */
  convWatchedHalf: number | null;
  convOthers: number | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (n: number, d: number) => (d ? n / d : 0);

export function summarize(visits: LanderVisit[]): LanderSummary {
  const plays = visits.filter((v) => v.vsl_started);
  const watchedHalf = visits.filter((v) => v.vsl_max_pct >= 50);
  const others = visits.filter((v) => v.vsl_max_pct < 50);
  const leads = visits.filter((v) => v.converted).length;
  return {
    visits: visits.length,
    visitors: new Set(visits.map((v) => v.visitor_id ?? v.id)).size,
    avgTime: avg(visits.map((v) => v.time_on_page_s)),
    bounceRate: rate(visits.filter(isBounce).length, visits.length),
    avgScroll: avg(visits.map((v) => v.max_scroll_pct)),
    clickRate: rate(visits.filter((v) => v.cta_clicks > 0).length, visits.length),
    leads,
    convRate: rate(leads, visits.length),
    booked: visits.filter((v) => v.booked).length,
    plays: plays.length,
    playRate: rate(plays.length, visits.length),
    avgWatch: avg(plays.map((v) => v.vsl_watch_s)),
    avgPctWatched: avg(plays.map((v) => v.vsl_max_pct)),
    completionRate: rate(plays.filter((v) => v.vsl_max_pct >= 95).length, plays.length),
    retention: RETENTION_MARKS.map((mark) => ({
      mark,
      share: rate(plays.filter((v) => v.vsl_max_pct >= (mark === 100 ? 95 : mark)).length, plays.length),
    })),
    convWatchedHalf: watchedHalf.length ? rate(watchedHalf.filter((v) => v.converted).length, watchedHalf.length) : null,
    convOthers: others.length ? rate(others.filter((v) => v.converted).length, others.length) : null,
  };
}

export function sourceOf(v: LanderVisit) {
  if (v.utm?.utm_source) return v.utm.utm_source;
  if (!v.referrer) return "Direct";
  try {
    return new URL(v.referrer).hostname.replace(/^www\./, "") || "Direct";
  } catch {
    return "Direct";
  }
}

export function groupBy(visits: LanderVisit[], key: (v: LanderVisit) => string) {
  const m = new Map<string, LanderVisit[]>();
  for (const v of visits) {
    const k = key(v);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  }
  return [...m.entries()].map(([name, rows]) => ({ name, ...summarize(rows) })).sort((a, b) => b.visits - a.visits);
}

export function duration(s: number) {
  const t = Math.round(s);
  if (t < 60) return `${t}s`;
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
}

export function trackerSnippet(origin: string, pageId: string) {
  return `<script async src="${origin}/api/public/t?p=${pageId}"></script>`;
}
