import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, children, title, actions, padded = true }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cn("rounded-lg border border-border bg-bg", className)}>
      {(title || actions) && (
        <header className="flex h-10 items-center justify-between border-b border-border-light px-3">
          <h3 className="text-[13px] font-medium text-fg">{title}</h3>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={cn(padded && "p-3")}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, trend, icon: Icon, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; trend?: number | null; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-bg p-3", className)}>
      <div className="flex items-center gap-1.5 text-xs text-fg-3">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {(sub || trend != null) && (
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
          {trend != null && isFinite(trend) && (
            <span className={trend >= 0 ? "text-success" : "text-danger"}>{trend >= 0 ? "▲" : "▼"} {Math.abs(trend * 100).toFixed(1)}%</span>
          )}
          {sub}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-16 text-center", className)}>
      {Icon && <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-border bg-bg-2"><Icon className="size-5 text-fg-3" /></div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-fg-3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-fg-3", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border bg-bg-2 px-1 text-[10px] font-medium text-fg-3">{children}</kbd>;
}

/** Twenty-style "field row" used on record pages: icon + label | value */
export function FieldRow({ icon: Icon, label, children }: { icon?: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <div className="flex w-[120px] shrink-0 items-center gap-1.5 text-[13px] text-fg-3">
        {Icon && <Icon className="size-4" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 flex-1 text-[13px] text-fg">{children}</div>
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-fg-3">{children}</h4>
      {actions}
    </div>
  );
}
