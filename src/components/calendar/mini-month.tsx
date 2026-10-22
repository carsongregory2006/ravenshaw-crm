"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { cn } from "@/lib/utils";

export function MiniMonth({ value, onSelect, rangeStart, rangeEnd, marked, className, compact }: {
  value: Date;
  onSelect: (d: Date) => void;
  rangeStart?: Date;
  rangeEnd?: Date;
  marked?: Set<string>;
  className?: string;
  compact?: boolean;
}) {
  const [month, setMonth] = useState(startOfMonth(value));
  useEffect(() => setMonth(startOfMonth(value)), [value]);
  const gridStart = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1 flex items-center justify-between pl-2">
        <span className="text-[13px] font-medium">{format(month, "MMMM yyyy")}</span>
        {!compact && (
          <div className="flex">
            <button aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="rounded-full p-1 text-fg-2 hover:bg-hover cursor-pointer"><ChevronLeft className="size-4" /></button>
            <button aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="rounded-full p-1 text-fg-2 hover:bg-hover cursor-pointer"><ChevronRight className="size-4" /></button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-fg-3">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="h-6 leading-6">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {days.map((d) => {
          const inRange = rangeStart && rangeEnd && d >= rangeStart && d < rangeEnd;
          const today = isToday(d);
          const selected = isSameDay(d, value);
          const hasEvents = marked?.has(format(d, "yyyy-MM-dd"));
          return (
            <div key={d.toISOString()} className={cn("flex h-7 items-center justify-center", inRange && !compact && "bg-accent-soft/60 first:rounded-l-full last:rounded-r-full")}>
              <button
                onClick={() => onSelect(d)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full cursor-pointer transition-colors",
                  !isSameMonth(d, month) && "text-fg-4",
                  today ? "bg-[#1a73e8] font-semibold text-white" : selected ? "bg-accent-soft font-semibold text-accent" : hasEvents ? "bg-[#1a73e8]/15 text-fg hover:bg-hover" : "hover:bg-hover",
                )}
              >
                {format(d, "d")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
