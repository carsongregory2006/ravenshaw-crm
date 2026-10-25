"use client";
import { Card, Stat } from "@/components/ui/misc";
import { BarList } from "@/components/analytics/viz";
import { DISPOSITIONS, dispositionLabel } from "@/lib/dispositions";
import { fmtSecs, type DialStats } from "@/lib/dialer/stats";
import { pct } from "@/lib/utils";

const n1 = (x: number | null) => (x == null ? "—" : (Math.round(x * 10) / 10).toString());

/** Stat tiles + outcome breakdown for a dialing session (or any set of calls). */
export function SessionSummary({ stats, showDuration = true }: { stats: DialStats; showDuration?: boolean }) {
  const outcomes = [
    ...DISPOSITIONS.map((d) => ({ label: d.label, value: stats.outcomes[d.value] ?? 0 })),
    ...Object.entries(stats.outcomes).filter(([k]) => !DISPOSITIONS.some((d) => d.value === k)).map(([k, v]) => ({ label: dispositionLabel(k) ?? k, value: v })),
  ];
  const unlogged = stats.dials - Object.values(stats.outcomes).reduce((a, b) => a + b, 0);
  if (unlogged > 0) outcomes.push({ label: "No outcome", value: unlogged });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {showDuration && <Stat label="Session length" value={fmtSecs(stats.durationSec)} />}
        <Stat label="Dials" value={stats.dials} sub={stats.skipped ? `${stats.skipped} skipped` : undefined} />
        <Stat label="Connects" value={stats.connects} sub={stats.connectRate != null ? `${pct(stats.connectRate)} connect rate` : undefined} />
        <Stat label="Conversations" value={stats.conversations} sub={`≥ ${stats.thresholdSec}s`} />
        <Stat label="Talk time" value={fmtSecs(stats.talkSec)} sub={`avg ${fmtSecs(stats.avgCallSec)}`} />
        <Stat label="Dials / hour" value={n1(stats.dialsPerHour)} />
        <Stat label="Booked" value={stats.appointments} />
        <Stat label="Voicemails" value={stats.voicemails} />
        <Stat label="Bad numbers" value={stats.badNumbers} />
      </div>
      <Card title="Outcomes">
        {stats.dials ? <BarList data={outcomes} label="label" value="value" /> : <p className="text-xs text-fg-3">No calls yet.</p>}
      </Card>
    </div>
  );
}
