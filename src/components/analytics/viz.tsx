"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import * as React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, PieChart, Pie, Cell,
  ComposedChart, Area, AreaChart,
} from "recharts";
import { format } from "date-fns";
import { cn, money, num, pct } from "@/lib/utils";

/**
 * Chart tokens. Categorical slots are the validated reference palette (light vs #fff, dark vs #171717 — both pass
 * the six checks; light slots 3–5 sit under 3:1 so every chart ships with a legend/labels and a table/CSV view).
 */
const VIZ_CSS = `
.viz{--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--series-7:#6250d6;--series-8:#e34948;
--seq-100:#cde2fb;--seq-200:#9ec5f4;--seq-250:#86b6ef;--seq-300:#6da7ec;--seq-400:#3987e5;--seq-450:#2a78d6;--seq-500:#256abf;--seq-600:#184f95;--seq-700:#0d366b;
--good:#0ca30c;--critical:#d03b3b;--grid:#ececea;--axis:#d6d6d6;--muted:#898781}
.dark .viz{--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--series-5:#d55181;--series-6:#008300;--series-7:#9085e9;--series-8:#e66767;
--grid:#262626;--axis:#383835;--muted:#898781}
`;

export function VizStyles() {
  return <style dangerouslySetInnerHTML={{ __html: VIZ_CSS }} />;
}

export type Fmt = "money" | "num" | "pct" | "days" | "minutes" | "text" | "x";

export function fmt(v: unknown, f: Fmt = "num", compact = false): string {
  if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return "—";
  const x = Number(v);
  switch (f) {
    case "money": return money(x, { compact });
    case "pct": return pct(x);
    case "days": return `${x.toFixed(1)} d`;
    case "minutes": return x < 60 ? `${Math.round(x)} min` : x < 1440 ? `${(x / 60).toFixed(1)} h` : `${(x / 1440).toFixed(1)} d`;
    case "x": return `${x.toFixed(2)}×`;
    case "text": return String(v);
    default: return compact && Math.abs(x) >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x) : num(Math.round(x * 100) / 100);
  }
}

const monthTick = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? format(new Date(v + "-01T00:00:00"), "MMM") : /^\d{4}-\d{2}-\d{2}$/.test(v) ? format(new Date(v + "T00:00:00"), "MMM d") : v);
const tooltipLabel = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? format(new Date(v + "-01T00:00:00"), "MMMM yyyy") : /^\d{4}-\d{2}-\d{2}$/.test(v) ? format(new Date(v + "T00:00:00"), "EEE, MMM d") : v);

export interface SeriesDef { key: string; label: string; slot: number }

function TooltipBox({ active, payload, label, series, f }: { active?: boolean; payload?: any[]; label?: string; series?: SeriesDef[]; f: Fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-2 text-xs shadow-md">
      {label != null && <div className="mb-1 font-medium text-fg">{tooltipLabel(String(label))}</div>}
      {payload.map((p) => {
        const s = series?.find((x) => x.key === p.dataKey);
        return (
          <div key={p.dataKey} className="flex items-center gap-2 text-fg-2">
            <span className="size-2 rounded-full" style={{ background: s ? `var(--series-${s.slot})` : p.color }} />
            <span>{s?.label ?? p.name}</span>
            <span className="ml-auto pl-3 font-medium text-fg tabular-nums">{fmt(p.value, f)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2.5 rounded-[2px]" style={{ background: `var(--series-${s.slot})` }} />{s.label}
        </span>
      ))}
    </div>
  );
}

const axisProps = {
  tick: { fill: "var(--muted)", fontSize: 11 },
  axisLine: { stroke: "var(--axis)" },
  tickLine: false,
} as const;

function Frame({ height, children, className, legend }: { height: number; children: React.ReactElement; className?: string; legend?: React.ReactNode }) {
  return (
    <div className={cn("viz", className)}>
      <VizStyles />
      {legend && <div className="mb-2">{legend}</div>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

/** Grouped columns over time (same unit, one axis). */
export function ColumnChart({ data, x, series, f = "money", height = 240 }: { data: Record<string, unknown>[]; x: string; series: SeriesDef[]; f?: Fmt; height?: number }) {
  return (
    <Frame height={height} legend={<Legend series={series} />}>
      <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={x} {...axisProps} tickFormatter={monthTick} />
        <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => fmt(v, f, true)} />
        <Tooltip cursor={{ fill: "var(--bg-hover)" }} content={(p: any) => <TooltipBox {...p} series={series} f={f} />} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={`var(--series-${s.slot})`} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </Frame>
  );
}

/** Horizontal bars, one series (one color), value labels at the tip. */
export function BarList({ data, label, value, f = "num", height, slot = 1 }: { data: Record<string, unknown>[]; label: string; value: string; f?: Fmt; height?: number; slot?: number }) {
  const h = height ?? Math.max(120, data.length * 30 + 16);
  return (
    <Frame height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={label} {...axisProps} axisLine={false} width={110} tick={{ fill: "var(--fg-2)", fontSize: 12 }} />
        <Tooltip cursor={{ fill: "var(--bg-hover)" }} content={(p: any) => <TooltipBox {...p} series={[{ key: value, label: "Value", slot }]} f={f} />} />
        <Bar dataKey={value} fill={`var(--series-${slot})`} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}
          label={{ position: "right", fill: "var(--fg-2)", fontSize: 11, formatter: (v: unknown) => fmt(v, f, true) }} />
      </BarChart>
    </Frame>
  );
}

/** Ordered stages (funnel): ordinal blue ramp, darkest = first stage. */
export function FunnelBars({ steps, f = "num" }: { steps: { label: string; value: number; rate?: number | null }[]; f?: Fmt }) {
  const ramp = ["var(--seq-600)", "var(--seq-500)", "var(--seq-450)", "var(--seq-400)", "var(--seq-300)", "var(--seq-250)"];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="viz space-y-1.5">
      <VizStyles />
      {steps.map((s, i) => (
        <div key={s.label} className="group flex items-center gap-3" title={`${s.label}: ${fmt(s.value, f)}`}>
          <div className="w-24 shrink-0 text-xs text-fg-2">{s.label}</div>
          <div className="relative h-6 flex-1">
            <div className="h-full rounded-r-[4px] transition-opacity group-hover:opacity-85" style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%`, background: ramp[Math.min(i, ramp.length - 1)] }} />
          </div>
          <div className="w-28 shrink-0 text-right text-xs tabular-nums">
            <span className="font-medium text-fg">{fmt(s.value, f)}</span>
            {s.rate != null && <span className="ml-1.5 text-fg-3">{pct(s.rate, 0)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Part-to-whole at a glance (≤6 segments; caller folds the tail into Other). */
export function Donut({ data, label, value, f = "money", height = 200 }: { data: Record<string, unknown>[]; label: string; value: string; f?: Fmt; height?: number }) {
  const total = data.reduce((a, d) => a + Number(d[value] ?? 0), 0);
  const series = data.map((d, i) => ({ key: String(d[label]), label: String(d[label]), slot: i + 1 }));
  return (
    <div className="viz flex flex-col items-center gap-3 sm:flex-row">
      <VizStyles />
      <div style={{ height, width: height }} className="relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={value} nameKey={label} innerRadius="62%" outerRadius="100%" paddingAngle={data.length > 1 ? 1.5 : 0} stroke="var(--bg)" strokeWidth={2} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={`var(--series-${i + 1})`} />)}
            </Pie>
            <Tooltip content={(p: any) => p.active && p.payload?.[0] ? (
              <div className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs shadow-md">
                <span className="font-medium">{p.payload[0].name}</span>: {fmt(p.payload[0].value, f)} ({pct(total ? p.payload[0].value / total : 0, 0)})
              </div>) : null} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-xs text-fg-3">Total</div>
          <div className="text-sm font-semibold">{fmt(total, f, true)}</div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--series-${s.slot})` }} />
            <span className="truncate text-fg-2">{s.label}</span>
            <span className="ml-auto tabular-nums text-fg">{fmt(data[i][value], f, true)}</span>
            <span className="w-9 text-right tabular-nums text-fg-3">{pct(total ? Number(data[i][value]) / total : 0, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lines over time with crosshair tooltip. */
export function LineSeriesChart({ data, x, series, f = "num", height = 220, area }: { data: Record<string, unknown>[]; x: string; series: SeriesDef[]; f?: Fmt; height?: number; area?: boolean }) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <Frame height={height} legend={<Legend series={series} />}>
      <Chart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={x} {...axisProps} tickFormatter={monthTick} minTickGap={24} />
        <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(v) => fmt(v, f, true)} allowDecimals={false} />
        <Tooltip cursor={{ stroke: "var(--axis)" }} content={(p: any) => <TooltipBox {...p} series={series} f={f} />} />
        {series.map((s) => area ? (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={`var(--series-${s.slot})`} fill={`var(--series-${s.slot})`} fillOpacity={0.1} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--bg)", strokeWidth: 2 }} isAnimationActive={false} />
        ) : (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={`var(--series-${s.slot})`} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--bg)", strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </Chart>
    </Frame>
  );
}

/** MRR movement: new vs churned columns + ending MRR line, all in dollars on one axis. */
export function MrrMovement({ data, height = 240 }: { data: { month: string; added: number; lost: number; ending: number }[]; height?: number }) {
  const series: SeriesDef[] = [{ key: "added", label: "New MRR", slot: 3 }, { key: "lost", label: "Churned MRR", slot: 2 }, { key: "ending", label: "Ending MRR", slot: 1 }];
  return (
    <Frame height={height} legend={<Legend series={series} />}>
      <ComposedChart data={data} barGap={2} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="month" {...axisProps} tickFormatter={monthTick} />
        <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => fmt(v, "money", true)} />
        <Tooltip cursor={{ fill: "var(--bg-hover)" }} content={(p: any) => <TooltipBox {...p} series={series} f="money" />} />
        <Bar dataKey="added" fill="var(--series-3)" maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="lost" fill="var(--series-2)" maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Line dataKey="ending" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3, fill: "var(--series-1)", stroke: "var(--bg)", strokeWidth: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </Frame>
  );
}

/** Cohort retention heatmap (sequential blue, text ink chosen by fill luminance). */
export function CohortGrid({ rows }: { rows: { month: string; size: number; cells: (number | null)[] }[] }) {
  const ramp = ["var(--seq-100)", "var(--seq-200)", "var(--seq-300)", "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-700)"];
  const months = Math.max(0, ...rows.map((r) => r.cells.length));
  return (
    <div className="viz overflow-x-auto">
      <VizStyles />
      <table className="border-separate border-spacing-[2px] text-xs">
        <thead>
          <tr className="text-fg-3">
            <th className="px-2 text-left font-normal">Cohort</th>
            <th className="px-2 text-right font-normal">Clients</th>
            {Array.from({ length: months }, (_, k) => <th key={k} className="w-11 font-normal">M{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td className="whitespace-nowrap px-2 text-fg-2">{format(new Date(r.month + "-01T00:00:00"), "MMM yyyy")}</td>
              <td className="px-2 text-right tabular-nums">{r.size}</td>
              {r.cells.map((c, k) => {
                if (c == null) return <td key={k} />;
                const idx = Math.min(ramp.length - 1, Math.floor(c * (ramp.length - 0.01)));
                return (
                  <td key={k} title={`${pct(c, 0)} retained after ${k} months`} className="h-7 w-11 rounded-[3px] text-center tabular-nums"
                    style={{ background: ramp[idx], color: idx >= 3 ? "#fff" : "#0b0b0b" }}>
                    {Math.round(c * 100)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tiny trend line for KPI tiles (de-emphasis gray, current point accented). */
export function Sparkline({ values, height = 28 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="viz" style={{ height, width: 80 }}>
      <VizStyles />
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 3, left: 3, bottom: 3 }}>
          <Line dataKey="v" stroke="var(--fg-4)" strokeWidth={1.5} isAnimationActive={false}
            dot={(p: any) => p.index === data.length - 1 ? <circle key="d" cx={p.cx} cy={p.cy} r={2.5} fill="var(--series-1)" /> : <g key={p.index} />} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
