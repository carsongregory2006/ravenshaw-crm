import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt, Sparkline, type Fmt } from "./viz";

/** Stat tile: label · value · delta vs previous period (colored by whether up is good) · optional sparkline. */
export function Kpi({ label, value, f = "money", prev, upIsGood = true, icon: Icon, hint, spark, className }: {
  label: string; value: number | string | null; f?: Fmt; prev?: number | null; upIsGood?: boolean; icon?: LucideIcon; hint?: string; spark?: number[]; className?: string;
}) {
  const delta = typeof value === "number" && prev != null && prev !== 0 ? (value - prev) / Math.abs(prev) : null;
  const good = delta == null ? null : delta === 0 ? null : (delta > 0) === upIsGood;
  return (
    <div className={cn("rounded-lg border border-border bg-bg p-3", className)} title={hint}>
      <div className="flex items-center gap-1.5 text-xs text-fg-3">
        {Icon && <Icon className="size-3.5" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="truncate text-xl font-semibold tracking-tight text-fg">{fmt(value, f)}</div>
        {spark && <Sparkline values={spark} />}
      </div>
      <div className="mt-0.5 h-4 text-xs text-fg-3">
        {delta != null ? (
          <span className={good == null ? "" : good ? "text-success" : "text-danger"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}%
            <span className="ml-1 text-fg-3">vs prev ({fmt(prev, f, true)})</span>
          </span>
        ) : prev != null ? <span>prev {fmt(prev, f, true)}</span> : null}
      </div>
    </div>
  );
}
