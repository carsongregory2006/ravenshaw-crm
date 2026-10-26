"use client";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Health } from "@/lib/dialer/health";

const tone = (s: number) => (s >= 4 ? "bg-success" : s === 3 ? "bg-warning" : "bg-danger");

/** PhoneBurner-style 5-bar health meter with the reasons on hover. */
export function HealthMeter({ health, label, className }: { health: Health | null | undefined; label?: boolean; className?: string }) {
  if (!health) return null;
  const s = health.score;
  return (
    <Tooltip content={<div className="max-w-60 space-y-0.5 text-xs"><div className="font-medium">{s ? `${s}/5 · ${health.label}` : health.label}</div>{health.reasons.map((r) => <div key={r}>{r}</div>)}</div>}>
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="inline-flex items-end gap-[2px]" aria-label={s ? `Number health ${s} of 5` : "Number health unknown"}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={cn("w-[3px] rounded-[1px]", s && i <= s ? tone(s) : "bg-border")} style={{ height: 4 + i * 2 }} />
          ))}
        </span>
        {label && <span className="text-xs text-fg-3">{s ? `${s}/5` : "New"}</span>}
      </span>
    </Tooltip>
  );
}
