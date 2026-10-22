"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RANGE_PRESETS } from "@/lib/metrics/range";
import { cn } from "@/lib/utils";

/** Date-range control: presets + custom range. Writes ?range/from/to and keeps other params (e.g. tab). */
export function RangePicker({ value, label, from, to }: { value: string; label: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [cf, setCf] = useState(from);
  const [ct, setCt] = useState(to);

  const apply = (range: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(params.toString());
    q.set("range", range);
    q.delete("from"); q.delete("to");
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    router.push(`${pathname}?${q}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button icon={CalendarRange} iconRight={ChevronDown}>{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        {RANGE_PRESETS.map((p) => (
          <button key={p.key} onClick={() => apply(p.key)}
            className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover cursor-pointer", value === p.key && "font-medium")}>
            <span className="flex-1">{p.label}</span>
            {value === p.key && <Check className="size-4 stroke-[2.5]" />}
          </button>
        ))}
        <div className="mt-1 space-y-2 border-t border-border-light p-2">
          <div className="text-xs text-fg-3">Custom range</div>
          <div className="flex items-center gap-1.5">
            <Input type="date" value={cf} onChange={(e) => setCf(e.target.value)} aria-label="From" />
            <Input type="date" value={ct} onChange={(e) => setCt(e.target.value)} aria-label="To" />
          </div>
          <Button size="sm" variant="primary" className="w-full" disabled={!cf || !ct} onClick={() => apply("custom", { from: cf, to: ct })}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
