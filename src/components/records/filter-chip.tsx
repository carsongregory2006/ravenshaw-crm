"use client";
import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Twenty-style filter chip with multi-select options. */
export function FilterChip({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const active = value.length > 0;
  const summary = active
    ? value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`
    : null;
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn(
          "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs cursor-pointer",
          active ? "border-accent/40 bg-accent-soft text-accent" : "border-dashed border-border-strong text-fg-3 hover:bg-hover hover:text-fg-2",
        )}>
          {label}{summary && <>: <span className="font-medium">{summary}</span></>}
          {active ? (
            <span role="button" aria-label={`Clear ${label}`} onClick={(e) => { e.stopPropagation(); onChange([]); }} className="ml-0.5 rounded-sm hover:bg-accent/10"><X className="size-3" /></span>
          ) : <ChevronDown className="size-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        {options.length > 7 && (
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="mb-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-[13px] outline-none focus:border-accent" />
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <div className="px-2 py-1.5 text-xs text-fg-3">No options</div>}
          {shown.map((o) => {
            const on = value.includes(o.value);
            return (
              <button key={o.value} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover cursor-pointer">
                <span className={cn("flex size-3.5 items-center justify-center rounded-sm border", on ? "border-accent bg-accent text-white" : "border-border-strong")}>
                  {on && <Check className="size-2.5" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
