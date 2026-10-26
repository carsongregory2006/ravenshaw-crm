/**
 * PhoneBurner-style 1–5 health scores. Pure functions so the server and the UI agree.
 *  - Lead number health: how likely this lead's number is to reach someone, from its call history.
 *  - Caller ID health: how well one of OUR numbers is performing (volume, connect-rate trend, instant hang-ups),
 *    a proxy for carrier spam labelling, which carriers don't expose directly.
 */

export interface Health { score: number | null; label: string; reasons: string[] }

export interface HealthCall { started_at: string; duration_sec: number | null; status: string; disposition: string | null; direction?: string }

const connected = (c: HealthCall) => (c.duration_sec ?? 0) > 0 || c.status === "completed" || c.status === "answered";
const LABELS = ["", "Dead", "Poor", "Fair", "Good", "Healthy"];

export function leadHealth(calls: HealthCall[], flags: { phoneBad?: boolean; doNotContact?: boolean } = {}): Health {
  if (flags.phoneBad) return { score: 1, label: LABELS[1], reasons: ["Marked bad number"] };
  const out = calls.filter((c) => c.direction !== "inbound").sort((a, b) => b.started_at.localeCompare(a.started_at));
  const inbound = calls.some((c) => c.direction === "inbound" && connected(c));
  if (!out.length) return inbound ? { score: 5, label: LABELS[5], reasons: ["They've called you"] } : { score: null, label: "New", reasons: ["Never dialed"] };
  if (out.some((c) => c.disposition === "bad_number" || c.disposition === "wrong_number")) return { score: 1, label: LABELS[1], reasons: ["A call was logged as bad/wrong number"] };

  // Misses in a row since the last real connect; quick hang-ups (<5s) count as half a miss.
  let misses = 0;
  let lastConnect: HealthCall | null = null;
  for (const c of out) {
    if (connected(c) && (c.duration_sec ?? 0) >= 5) { lastConnect = c; break; }
    misses += connected(c) ? 0.5 : 1;
  }
  const everConnected = out.some((c) => connected(c) && (c.duration_sec ?? 0) >= 5) || inbound;
  let score = misses === 0 ? 5 : misses <= 2 ? 4 : misses <= 4 ? 3 : misses <= 7 ? 2 : 1;
  if (everConnected) score = Math.max(score, 2);
  const reasons = [
    `${out.length} dial${out.length === 1 ? "" : "s"}, ${out.filter(connected).length} connected`,
    misses ? `${Math.ceil(misses)} miss${Math.ceil(misses) === 1 ? "" : "es"} in a row` : "Last call connected",
    ...(lastConnect ? [] : everConnected ? [] : ["Never connected"]),
  ];
  return { score, label: LABELS[score], reasons };
}

export function callerIdHealth(calls: HealthCall[], now = Date.now()): Health & { dials24h: number; rate7: number | null; rate30: number | null } {
  const ago = (d: number) => now - d * 86_400_000;
  const t = (c: HealthCall) => new Date(c.started_at).getTime();
  const last24 = calls.filter((c) => t(c) >= ago(1));
  const last7 = calls.filter((c) => t(c) >= ago(7));
  const prior = calls.filter((c) => t(c) < ago(7) && t(c) >= ago(37));
  const rate = (cs: HealthCall[]) => (cs.length ? cs.filter(connected).length / cs.length : null);
  const rate7 = rate(last7), rate30 = rate(prior);
  const reasons: string[] = [];
  let score = 5;

  if (last24.length > 150) { score -= 2; reasons.push(`${last24.length} dials in 24h — heavy volume gets numbers flagged as spam`); }
  else if (last24.length > 100) { score -= 1; reasons.push(`${last24.length} dials in 24h — getting close to spam-flag volume`); }

  if (last7.length >= 30 && rate7 != null) {
    if (prior.length >= 30 && rate30) {
      const ratio = rate7 / rate30;
      if (ratio < 0.5) { score -= 2; reasons.push(`Connect rate fell ${Math.round((1 - ratio) * 100)}% vs. the previous month — possible spam label`); }
      else if (ratio < 0.75) { score -= 1; reasons.push(`Connect rate down ${Math.round((1 - ratio) * 100)}% vs. the previous month`); }
    }
    if (rate7 < 0.05) { score -= 1; reasons.push(`Only ${(rate7 * 100).toFixed(1)}% of calls connect this week`); }
  }
  const conn7 = last7.filter(connected);
  const quick = conn7.filter((c) => (c.duration_sec ?? 0) < 8).length;
  if (conn7.length >= 10 && quick / conn7.length > 0.4) { score -= 1; reasons.push(`${Math.round((quick / conn7.length) * 100)}% of answered calls hang up within 8s`); }

  score = Math.max(1, Math.min(5, score));
  if (last7.length < 30 && !reasons.length) return { score: 5, label: LABELS[5], reasons: [`Not enough calls this week to judge (${last7.length})`], dials24h: last24.length, rate7, rate30 };
  if (!reasons.length) reasons.push("Volume and connect rate look normal");
  return { score, label: LABELS[score], reasons, dials24h: last24.length, rate7, rate30 };
}
