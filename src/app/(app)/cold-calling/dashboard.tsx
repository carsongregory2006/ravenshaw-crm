"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TrendingUp, Zap } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Time } from "@/components/ui/time";
import { Tag } from "@/components/ui/badge";
import { ColumnChart, LineSeriesChart } from "@/components/analytics/viz";
import { SessionSummary } from "@/components/dialer/session-summary";
import { coldCallingDataAction } from "@/lib/actions/dialer";
import { computeStats, fmtSecs, isConnect, type CallLite, type DialStats } from "@/lib/dialer/stats";
import { cn, lineLabel, pct } from "@/lib/utils";
import type { DialSession } from "@/lib/types";

type Range = "7" | "30" | "90" | "all" | "custom";
type SessionRow = DialSession & { user: { full_name: string | null } | null };
type CallRow = CallLite & { dial_session_id: string | null };

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
const sessionSecs = (s: DialSession) => ((s.ended_at ? new Date(s.ended_at).getTime() : Date.now()) - new Date(s.started_at).getTime()) / 1000;

export function ColdCallingDashboard() {
  const [range, setRange] = useState<Range>("30");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [threshold, setThreshold] = useState(30);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<SessionRow | null>(null);

  useEffect(() => {
    let from: string | null = null, to: string | null = null;
    if (range === "custom") {
      if (fromDate) from = new Date(`${fromDate}T00:00:00`).toISOString();
      if (toDate) { const t = new Date(`${toDate}T00:00:00`); t.setDate(t.getDate() + 1); to = t.toISOString(); }
    } else if (range !== "all") {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - Number(range) + 1); from = d.toISOString();
    }
    setLoading(true);
    coldCallingDataAction({ from, to }).then((r) => {
      setLoading(false);
      if (!r.ok) return toast.error(r.error);
      setCalls(r.data.calls);
      setSessions(r.data.sessions);
    });
  }, [range, fromDate, toDate]);

  const m = useMemo(() => {
    // Dials/hour only makes sense for time spent in dialing sessions.
    const sessionTime = sessions.reduce((s, x) => s + sessionSecs(x), 0);
    const sessionDials = calls.filter((c) => c.dial_session_id).length;
    const totals: DialStats = { ...computeStats(calls, { thresholdSec: threshold }), durationSec: sessionTime, dialsPerHour: sessionTime >= 60 ? sessionDials / (sessionTime / 3600) : null };

    const byDay = new Map<string, CallRow[]>();
    for (const c of calls) { const k = dayKey(c.started_at); byDay.set(k, [...(byDay.get(k) ?? []), c]); }
    const days = [...byDay.keys()].sort().map((day) => {
      const cs = byDay.get(day)!;
      const st = computeStats(cs, { thresholdSec: threshold });
      return { day, dials: st.dials, connects: st.connects, conversations: st.conversations, rate: st.connectRate ?? 0, booked: st.appointments };
    });

    const hours = Array.from({ length: 24 }, (_, h) => ({ h, dials: 0, connects: 0 }));
    for (const c of calls) { const h = new Date(c.started_at).getHours(); hours[h].dials++; if (isConnect(c)) hours[h].connects++; }
    const active = hours.filter((x) => x.dials);
    const lo = active.length ? Math.min(...active.map((x) => x.h)) : 8;
    const hi = active.length ? Math.max(...active.map((x) => x.h)) : 18;
    const hourRows = hours.slice(lo, hi + 1).map((x) => ({ hour: hourLabel(x.h), dials: x.dials, connects: x.connects, rate: x.dials ? x.connects / x.dials : 0 }));
    const best = [...hours].filter((x) => x.dials >= 5).sort((a, b) => b.connects / b.dials - a.connects / a.dials).slice(0, 3);

    const byLine = new Map<string, CallRow[]>();
    for (const c of calls) { const k = c.from_number ?? "unknown"; byLine.set(k, [...(byLine.get(k) ?? []), c]); }
    const lines = [...byLine.entries()].map(([line, cs]) => ({ line, st: computeStats(cs, { thresholdSec: threshold }) })).sort((a, b) => b.st.dials - a.st.dials);

    return { totals, days, hourRows, best, lines };
  }, [calls, sessions, threshold]);

  const t = m.totals;

  return (
    <Page>
      <PageHeader icon={TrendingUp} title="Cold Calling" actions={<Link href="/dialer"><Button size="sm" variant="primary" icon={Zap}>Power Dialer</Button></Link>}>
        <div className="ml-2 flex items-center gap-0.5">
          {([["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"], ["custom", "Custom"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} className={cn("h-6 rounded-md px-2 text-xs cursor-pointer", range === k ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>{label}</button>
          ))}
          {range === "custom" && <>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="ml-1 h-7 w-auto text-xs" />
            <span className="text-xs text-fg-3">to</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-7 w-auto text-xs" />
          </>}
        </div>
      </PageHeader>
      <PageBody className="space-y-4 p-4">
        {loading ? <div className="flex justify-center py-16"><Spinner /></div> : !calls.length && !sessions.length ? (
          <EmptyState icon={TrendingUp} title="No outbound calls in this range" description="Start a Power Dialer session and your numbers will show up here." action={<Link href="/dialer"><Button variant="primary">Open Power Dialer</Button></Link>} />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-fg-3">
              All outbound calls in range ({sessions.length} dialing session{sessions.length === 1 ? "" : "s"}). Conversation =
              <Input type="number" min={5} value={threshold} onChange={(e) => setThreshold(Math.max(5, Number(e.target.value) || 30))} className="h-6 w-16 text-xs" /> seconds or longer.
            </div>
            <SessionSummary stats={t} showDuration={false} />

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Dials, connects & conversations by day">
                {m.days.length ? <LineSeriesChart data={m.days} x="day" series={[{ key: "dials", label: "Dials", slot: 1 }, { key: "connects", label: "Connects", slot: 3 }, { key: "conversations", label: "Conversations", slot: 2 }]} /> : <p className="text-xs text-fg-3">No data.</p>}
              </Card>
              <Card title="Connect rate over time">
                {m.days.length ? <LineSeriesChart data={m.days} x="day" f="pct" area series={[{ key: "rate", label: "Connect rate", slot: 1 }]} /> : <p className="text-xs text-fg-3">No data.</p>}
              </Card>
              <Card title="Best hours to call" actions={m.best.length ? <span className="text-xs text-fg-3">Top: {m.best.map((b) => `${hourLabel(b.h)} (${pct(b.connects / b.dials, 0)})`).join(", ")}</span> : null}>
                <ColumnChart data={m.hourRows} x="hour" f="num" series={[{ key: "dials", label: "Dials", slot: 1 }, { key: "connects", label: "Connects", slot: 3 }]} />
                <p className="mt-1 text-[11px] text-fg-4">Your local time. “Top” needs at least 5 dials in that hour.</p>
              </Card>
              <Card title="By From number" padded={false}>
                <table className="w-full text-[13px]">
                  <thead className="text-left text-xs text-fg-3">
                    <tr className="border-b border-border-light">{["Number", "Dials", "Connects", "Rate", "Convos", "Talk", "Booked"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {m.lines.map(({ line, st }) => (
                      <tr key={line} className="border-b border-border-light last:border-0">
                        <td className="px-3 py-2">{line === "unknown" ? "Unknown" : lineLabel(line)}</td>
                        <td className="px-3 py-2 tabular-nums">{st.dials}</td>
                        <td className="px-3 py-2 tabular-nums">{st.connects}</td>
                        <td className="px-3 py-2 tabular-nums">{pct(st.connectRate)}</td>
                        <td className="px-3 py-2 tabular-nums">{st.conversations}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtSecs(st.talkSec)}</td>
                        <td className="px-3 py-2 tabular-nums">{st.appointments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            <Card title="Dialing sessions" padded={false}>
              {!sessions.length ? <p className="p-3 text-xs text-fg-3">No dialing sessions in this range.</p> : (
                <table className="w-full text-[13px]">
                  <thead className="text-left text-xs text-fg-3">
                    <tr className="border-b border-border-light">{["Started", "Rep", "List", "Length", "Dials", "Connects", "Rate", "Convos", "Booked", ""].map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => {
                      const st = s.stats ?? computeStats(calls.filter((c) => c.dial_session_id === s.id), { thresholdSec: s.conversation_threshold_sec, durationSec: sessionSecs(s) });
                      return (
                        <tr key={s.id} onClick={() => setOpen(s)} className="cursor-pointer border-b border-border-light last:border-0 hover:bg-hover">
                          <td className="px-3 py-2"><Time value={s.started_at} format="datetime" /></td>
                          <td className="px-3 py-2">{s.user?.full_name ?? "—"}</td>
                          <td className="px-3 py-2">{s.name ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtSecs(st.durationSec)}</td>
                          <td className="px-3 py-2 tabular-nums">{st.dials}</td>
                          <td className="px-3 py-2 tabular-nums">{st.connects}</td>
                          <td className="px-3 py-2 tabular-nums">{pct(st.connectRate)}</td>
                          <td className="px-3 py-2 tabular-nums">{st.conversations}</td>
                          <td className="px-3 py-2 tabular-nums">{st.appointments}</td>
                          <td className="px-3 py-2">{!s.ended_at && <Tag color="green">In progress</Tag>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </PageBody>

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)} size="xl" title={open.name ?? "Dialing session"}
          description={<><Time value={open.started_at} format="datetime" /> · {open.user?.full_name ?? ""} · {open.from_mode === "local" ? "Local presence" : `From ${lineLabel(open.from_number)}`}</>}
          footer={!open.ended_at ? <Link href={`/dialer/session/${open.id}`}><Button variant="primary">Resume session</Button></Link> : undefined}>
          <SessionSummary stats={open.stats ?? computeStats(calls.filter((c) => c.dial_session_id === open.id), { thresholdSec: open.conversation_threshold_sec, durationSec: sessionSecs(open) })} />
        </Dialog>
      )}
    </Page>
  );
}
