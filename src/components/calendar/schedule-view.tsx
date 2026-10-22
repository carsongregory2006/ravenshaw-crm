"use client";
import { addDays, format, isToday, startOfDay } from "date-fns";
import { CalendarSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fmtTimeShort, type Occurrence } from "@/lib/calendar/shared";

/** Agenda list grouped by day (Google "Schedule" view; also used for search results). */
export function ScheduleView({ occs, onEventClick, onDayClick, onLoadMore, emptyText, selectedKey }: {
  occs: Occurrence[];
  onEventClick: (o: Occurrence, r: DOMRect) => void;
  onDayClick: (d: Date) => void;
  onLoadMore?: () => void;
  emptyText?: string;
  selectedKey?: string | null;
}) {
  const groups = new Map<string, { day: Date; items: Occurrence[] }>();
  for (const o of occs) {
    // multi-day events appear on each day they span (from the first listed day)
    let d = startOfDay(o.start);
    let guard = 0;
    do {
      const k = d.toDateString();
      if (!groups.has(k)) groups.set(k, { day: d, items: [] });
      groups.get(k)!.items.push(o);
      d = addDays(d, 1);
    } while (o.allDay && d < o.end && ++guard < 62);
  }
  const days = [...groups.values()].sort((a, b) => a.day.getTime() - b.day.getTime());

  if (!days.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-3">
        <CalendarSearch className="size-10 opacity-50" />
        <p className="text-[13px]">{emptyText ?? "Nothing planned. Enjoy!"}</p>
        {onLoadMore && <Button size="sm" onClick={onLoadMore}>Look further ahead</Button>}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl py-2">
        {days.map(({ day, items }) => (
          <div key={day.toISOString()} className="flex border-b border-border-light px-4 py-2">
            <button onClick={() => onDayClick(day)} className="flex w-[120px] shrink-0 items-start gap-2 pt-0.5 text-left cursor-pointer">
              <span className={cn("flex size-7 items-center justify-center rounded-full text-[20px] leading-none", isToday(day) ? "bg-[#1a73e8] text-white" : "text-fg")}>
                {format(day, "d")}
              </span>
              <span className={cn("pt-1.5 text-[11px] font-medium uppercase", isToday(day) ? "text-[#1a73e8]" : "text-fg-2")}>{format(day, "MMM, EEE")}</span>
            </button>
            <div className="min-w-0 flex-1">
              {items.map((o) => (
                <button
                  key={o.key + day.toISOString()}
                  onClick={(e) => onEventClick(o, e.currentTarget.getBoundingClientRect())}
                  className={cn("flex h-8 w-full items-center gap-4 rounded-full px-3 text-left text-[13px] hover:bg-hover cursor-pointer", selectedKey === o.key && "bg-active", o.end < new Date() && "opacity-60")}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color }} />
                  <span className="w-[140px] shrink-0 text-fg-2">{o.allDay ? "All day" : `${fmtTimeShort(o.start)} – ${fmtTimeShort(o.end)}`}</span>
                  <span className="truncate font-medium">{o.event.title}</span>
                  {o.event.location && <span className="hidden truncate text-xs text-fg-3 md:inline">{o.event.location}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        {onLoadMore && (
          <div className="flex justify-center py-4"><Button size="sm" variant="ghost" onClick={onLoadMore}>Load more</Button></div>
        )}
      </div>
    </div>
  );
}
