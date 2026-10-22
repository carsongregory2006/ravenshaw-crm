"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Crown, RefreshCw, Trophy } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Spinner, Stat } from "@/components/ui/misc";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { money, num, pct } from "@/lib/utils";
import { declareWinner, getLandingAnalytics, type LandingAnalytics, type VariantStats } from "@/lib/actions/landing";

const SERIES = ["#1961ED", "#E5484D", "#0F8A78", "#D1580B", "#7B49E8", "#A77B00"];

function Confidence({ v }: { v: number | null }) {
  if (v == null) return <span className="text-fg-4">—</span>;
  const color = v >= 0.95 ? "green" : v >= 0.8 ? "yellow" : "gray";
  return <Tag color={color}>{(v * 100).toFixed(0)}%{v >= 0.95 ? " · significant" : ""}</Tag>;
}

export function LandingAnalyticsView({ pageId, onWinner }: { pageId: string; onWinner: (variantId: string) => void }) {
  const [data, setData] = useState<LandingAnalytics | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<"views" | "leads">("leads");
  const [winner, setWinner] = useState<VariantStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getLandingAnalytics(pageId, days);
    setLoading(false);
    if (!r.ok) return toast.error(r.error);
    setData(r.data);
  }, [pageId, days]);
  useEffect(() => { load(); }, [load]);

  const leader = useMemo(() => {
    if (!data) return null;
    return [...data.variants].filter((v) => (v.visitors || v.views) > 0).sort((a, b) => b.cvr - a.cvr)[0] ?? null;
  }, [data]);

  if (!data) return <div className="flex h-64 items-center justify-center"><Spinner /></div>;

  const t = data.totals;
  const denom = t.visitors || t.views;

  const columns: Column<VariantStats>[] = [
    {
      id: "name", header: "Variant", width: 170, cell: (v) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{v.name}</span>
          {v.is_control && <Tag color="gray">Control</Tag>}
          {!v.is_active && <Tag color="yellow">Paused</Tag>}
          {leader?.variant_id === v.variant_id && data.variants.length > 1 && <Crown className="size-3.5 text-warning" />}
        </span>
      ),
    },
    { id: "views", header: "Views", align: "right", sortValue: (v) => v.views, cell: (v) => num(v.views) },
    { id: "visitors", header: "Visitors", align: "right", sortValue: (v) => v.visitors, cell: (v) => num(v.visitors) },
    { id: "cta", header: "CTA clicks", align: "right", sortValue: (v) => v.cta_clicks, cell: (v) => num(v.cta_clicks) },
    { id: "conv", header: "Leads", align: "right", sortValue: (v) => v.conversions, cell: (v) => num(v.conversions) },
    { id: "cvr", header: "Conv. rate", align: "right", sortValue: (v) => v.cvr, cell: (v) => <b>{pct(v.cvr)}</b> },
    {
      id: "lift", header: "Lift vs control", align: "right", sortValue: (v) => v.lift ?? -999,
      cell: (v) => (v.is_control ? <span className="text-fg-4">baseline</span> : v.lift == null ? "—" : <span className={v.lift >= 0 ? "text-success" : "text-danger"}>{v.lift >= 0 ? "+" : ""}{(v.lift * 100).toFixed(1)}%</span>),
    },
    { id: "conf", header: "Confidence", width: 140, cell: (v) => (v.is_control ? <span className="text-fg-4">—</span> : <Confidence v={v.confidence} />) },
    { id: "booked", header: "Booked", align: "right", sortValue: (v) => v.booked, cell: (v) => num(v.booked) },
    { id: "won", header: "Won", align: "right", sortValue: (v) => v.won, cell: (v) => num(v.won) },
    { id: "rev", header: "Revenue", align: "right", sortValue: (v) => v.revenue, cell: (v) => money(v.revenue) },
    {
      id: "actions", header: "", width: 120, cell: (v) => data.variants.length > 1 && (
        <Button size="xs" variant="ghost" icon={Trophy} onClick={() => setWinner(v)}>Declare winner</Button>
      ),
    },
  ];

  const series = data.variants.map((v, i) => ({ key: `${v.name} ${metric}`, name: v.name, color: SERIES[i % SERIES.length] }));

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Split test results</h2>
        <div className="flex items-center gap-1.5">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-7 w-32">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
          <Button icon={RefreshCw} loading={loading} onClick={load} aria-label="Refresh" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Views (all time)" value={num(t.views)} sub={`${num(t.visitors)} unique`} />
        <Stat label="Leads" value={num(t.conversions)} sub={denom ? `${pct(t.conversions / denom)} conversion` : undefined} />
        <Stat label="Booked" value={num(t.booked)} sub={t.conversions ? `${pct(t.booked / t.conversions)} of leads` : undefined} />
        <Stat label="Won deals" value={num(t.won)} sub={t.conversions ? `${pct(t.won / t.conversions)} of leads` : undefined} />
        <Stat label="Revenue collected" value={money(t.revenue)} sub={t.conversions ? `${money(t.revenue / t.conversions)} / lead` : undefined} />
      </div>

      {leader && data.variants.length > 1 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-2 px-3 py-2 text-[13px]">
          <Crown className="size-4 text-warning" />
          <span><b>{leader.name}</b> leads with {pct(leader.cvr)} conversion
            {leader.confidence != null && <> at <b>{(leader.confidence * 100).toFixed(0)}%</b> confidence</>}.
            {" "}{(leader.confidence ?? 0) >= 0.95 ? "That's statistically significant — safe to declare a winner." : "Keep the test running until confidence reaches 95%."}
          </span>
        </div>
      )}

      <Card padded={false}>
        <DataTable rows={data.variants.map((v) => ({ ...v, id: v.variant_id }))} columns={columns as Column<VariantStats & { id: string }>[]} />
      </Card>

      <Card title={`Daily ${metric}`} actions={
        <div className="flex rounded-md bg-bg-3 p-0.5">
          {(["leads", "views"] as const).map((m) => (
            <button key={m} onClick={() => setMetric(m)} className={`h-6 rounded-[5px] px-2 text-xs capitalize cursor-pointer ${metric === m ? "bg-bg text-fg shadow-sm" : "text-fg-3"}`}>{m}</button>
          ))}
        </div>
      }>
        {t.views === 0 ? (
          <EmptyState title="No traffic yet" description="Publish the page and share the link — views and leads will chart here." className="py-10" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.daily} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--border-light)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "var(--fg-3)" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--fg-3)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Dialog open={!!winner} onOpenChange={(o) => !o && setWinner(null)} size="sm" title={`Declare ${winner?.name} the winner?`}
        description="It becomes the control and gets 100% of traffic. All other variants are paused (not deleted) so you can start a new test later."
        footer={<>
          <Button onClick={() => setWinner(null)}>Cancel</Button>
          <Button variant="primary" icon={Trophy} onClick={async () => {
            const w = winner!;
            setWinner(null);
            const r = await declareWinner(pageId, w.variant_id);
            if (!r.ok) return toast.error(r.error);
            toast.success(`${w.name} now receives 100% of traffic`);
            onWinner(w.variant_id);
            load();
          }}>Declare winner</Button>
        </>} />
    </div>
  );
}
