"use client";
import { useState } from "react";
import { addDays, addMonths, format, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import { cn } from "@/lib/utils";
import type { Occurrence } from "@/lib/calendar/shared";
import { Floating } from "./floating";
import { DayList } from "./month-view";

export function YearView({ date, occs, onDayClick, onEventClick }: {
  date: Date; occs: Occurrence[]; onDayClick: (d: Date) => void; onEventClick: (o: Occurrence, r: DOMRect) => void;
}) {
  const [pop, setPop] = useState<{ day: Date; rect: DOMRect } | null>(null);
  const counts = new Map<string, number>();
  for (const o of occs) {
    for (let d = startOfDay(o.start); d < o.end; d = addDays(d, 1)) {
      const k = format(d, "yyyy-MM-dd");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const year = startOfYear(date);
  const dayOccs = (d: Date) => occs.filter((o) => o.start < addDays(startOfDay(d), 1) && o.end > startOfDay(d));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 gap-y-8 px-6 py-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, m) => {
          const month = addMonths(year, m);
          const start = startOfWeek(startOfMonth(month));
          return (
            <div key={m}>
              <div className="mb-2 pl-1 text-[14px] font-medium">{format(month, "MMMM")}</div>
              <div className="grid grid-cols-7 text-center text-[10px] font-medium text-fg-3">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="h-6 leading-6">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 text-center text-[11px]">
                {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => {
                  const inMonth = isSameMonth(d, month);
                  const n = counts.get(format(d, "yyyy-MM-dd")) ?? 0;
                  return (
                    <div key={d.toISOString()} className="flex h-7 items-center justify-center">
                      {inMonth && (
                        <button
                          onClick={(e) => setPop({ day: d, rect: e.currentTarget.getBoundingClientRect() })}
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full cursor-pointer",
                            isToday(d) ? "bg-[#1a73e8] font-semibold text-white" : n ? "bg-[#1a73e8]/15 font-medium text-[#1a73e8] hover:bg-[#1a73e8]/25" : "hover:bg-hover",
                          )}
                          title={n ? `${n} event${n > 1 ? "s" : ""}` : undefined}
                        >
                          {format(d, "d")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {pop && (
        <Floating anchor={pop.rect} onClose={() => setPop(null)} width={240}>
          <DayList day={pop.day} occs={dayOccs(pop.day)} onClose={() => setPop(null)}
            onDayClick={(d) => { setPop(null); onDayClick(d); }}
            onEventClick={(o, r) => { setPop(null); onEventClick(o, r); }} />
        </Floating>
      )}
    </div>
  );
}
