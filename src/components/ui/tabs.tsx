"use client";
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TabDef { id: string; label: string; icon?: LucideIcon; count?: number }

/** Twenty-style underline tabs. Controlled. */
export function Tabs({ tabs, value, onChange, className, right }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center border-b border-border px-3", className)}>
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "relative flex h-10 shrink-0 items-center gap-1.5 px-2 text-[13px] font-medium transition-colors cursor-pointer",
                active ? "text-fg" : "text-fg-3 hover:text-fg-2",
              )}
            >
              {t.icon && <t.icon className="size-4" />}
              {t.label}
              {t.count != null && <span className="rounded-sm bg-bg-3 px-1 text-xs text-fg-3">{t.count}</span>}
              {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-fg" />}
            </button>
          );
        })}
      </div>
      {right && <div className="ml-auto flex items-center gap-2 pl-2">{right}</div>}
    </div>
  );
}
