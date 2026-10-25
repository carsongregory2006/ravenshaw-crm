/** Cold-calling metrics, shared by the session summary (server) and the dashboard (client). */

export interface CallLite {
  started_at: string;
  duration_sec: number | null;
  status: string;
  disposition: string | null;
  from_number: string | null;
}

export interface DialStats {
  dials: number;
  connects: number;
  connectRate: number | null;
  conversations: number;
  thresholdSec: number;
  talkSec: number;
  avgCallSec: number | null;
  outcomes: Record<string, number>;
  appointments: number;
  badNumbers: number;
  voicemails: number;
  durationSec: number;
  dialsPerHour: number | null;
  skipped?: number;
}

/** Answered calls: the far end picked up (a person or their voicemail). */
export const isConnect = (c: Pick<CallLite, "status" | "duration_sec">) => (c.duration_sec ?? 0) > 0 || c.status === "completed" || c.status === "answered";

export function computeStats(calls: CallLite[], opts: { thresholdSec?: number; durationSec?: number; skipped?: number } = {}): DialStats {
  const thresholdSec = opts.thresholdSec ?? 30;
  const dials = calls.length;
  const connected = calls.filter(isConnect);
  const talkSec = connected.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
  const outcomes: Record<string, number> = {};
  for (const c of calls) if (c.disposition) outcomes[c.disposition] = (outcomes[c.disposition] ?? 0) + 1;
  const durationSec = opts.durationSec ?? 0;
  return {
    dials,
    connects: connected.length,
    connectRate: dials ? connected.length / dials : null,
    conversations: calls.filter((c) => (c.duration_sec ?? 0) >= thresholdSec).length,
    thresholdSec,
    talkSec,
    avgCallSec: connected.length ? talkSec / connected.length : null,
    outcomes,
    appointments: (outcomes.interested ?? 0) + (outcomes.booked ?? 0),
    badNumbers: (outcomes.bad_number ?? 0) + (outcomes.wrong_number ?? 0),
    voicemails: outcomes.voicemail ?? 0,
    durationSec,
    dialsPerHour: durationSec >= 60 ? dials / (durationSec / 3600) : null,
    ...(opts.skipped != null ? { skipped: opts.skipped } : {}),
  };
}

export function fmtSecs(sec?: number | null) {
  if (sec == null) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}
