"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutBars, fmtTimeShort, textOn, type Occurrence } from "@/lib/calendar/shared";
import { Floating } from "./floating";

const LANE_H = 22;
const HEADER_H = 26;

export function MonthView({ date, occs, selectedKey, onDayClick, onSlotCreate, onEventClick, onEventMove }: {
  date: Date;
  occs: Occurrence[];
  selectedKey?: string | null;
  onDayClick: (d: Date) => void;
  onSlotCreate: (start: Date, end: Date, allDay: boolean, rect: DOMRect) => void;
  onEventClick: (occ: Occurrence, rect: DOMRect) => void;
  onEventMove: (occ: Occurrence, dayDelta: number) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(date));
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));
  const ref = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(110);
  const [more, setMore] = useState<{ day: Date; rect: DOMRect } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragging = useRef<Occurrence | null>(null);
  const now = new Date();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRowH(el.clientHeight / 6));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxLanes = Math.max(1, Math.floor((rowH - HEADER_H - 4) / LANE_H));
  const weekBars = useMemo(() => weeks.map((days) => layoutBars(occs, days, () => true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occs, gridStart.getTime()]);

  const dayOccs = (d: Date) => occs.filter((o) => o.start < addDays(startOfDay(d), 1) && o.end > startOfDay(d) && !(o.end.getTime() === startOfDay(d).getTime()));

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {weeks[0].map((d) => (
          <div key={d.getDay()} className="border-l border-border pt-1.5 pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-fg-2 first:border-l-0">
            {format(d, "EEE")}
          </div>
        ))}
      </div>
      <div ref={ref} className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((days, wi) => {
          const bars = weekBars[wi];
          // overflow per day: count items whose lane doesn't fit
          const perDay = days.map((_, di) => bars.filter((b) => b.startCol <= di && b.endCol >= di));
          const overflowDay = perDay.map((items) => items.length > maxLanes);
          const visibleLanes = (di: number) => (overflowDay[di] ? maxLanes - 1 : maxLanes);
          const barVisible = (b: (typeof bars)[number]) => {
            for (let c = b.startCol; c <= b.endCol; c++) if (b.lane >= visibleLanes(c)) return false;
            return true;
          };
          return (
            <div key={wi} className="relative grid grid-cols-7 border-b border-border last:border-b-0">
              {days.map((d, di) => {
                const k = d.toDateString();
                return (
                  <div
                    key={k}
                    className={cn("relative border-l border-border first:border-l-0", dragOver === k && "bg-accent-soft/50")}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-chip]")) return;
                      const day = startOfDay(d);
                      onSlotCreate(day, addDays(day, 1), true, e.currentTarget.getBoundingClientRect());
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(k); }}
                    onDragLeave={() => setDragOver((x) => (x === k ? null : x))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(null);
                      const o = dragging.current;
                      dragging.current = null;
                      if (!o) return;
                      const delta = differenceInCalendarDays(d, startOfDay(o.start)) - Number(e.dataTransfer.getData("text/offset") || 0);
                      if (delta) onEventMove(o, delta);
                    }}
                  >
                    <div className="flex justify-center pt-1">
                      <button
                        data-chip
                        onClick={() => onDayClick(d)}
                        className={cn(
                          "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-medium cursor-pointer",
                          isToday(d) ? "bg-[#1a73e8] text-white" : "hover:bg-hover",
                          !isToday(d) && !isSameMonth(d, date) && "text-fg-3",
                        )}
                      >
                        {d.getDate() === 1 ? format(d, "MMM d") : format(d, "d")}
                      </button>
                    </div>
                    {overflowDay[di] && (
                      <button
                        data-chip
                        onClick={(e) => setMore({ day: d, rect: e.currentTarget.getBoundingClientRect() })}
                        className="absolute left-1 right-1 truncate rounded px-1.5 text-left text-[12px] font-medium text-fg-2 hover:bg-hover cursor-pointer"
                        style={{ top: HEADER_H + (maxLanes - 1) * LANE_H, height: LANE_H - 2 }}
                      >
                        {perDay[di].length - (maxLanes - 1)} more
                      </button>
                    )}
                  </div>
                );
              })}
              {/* bars & dot items */}
              {bars.filter(barVisible).map((b) => {
                const o = b.occ;
                const isBar = o.allDay || b.endCol > b.startCol;
                return (
                  <button
                    key={o.key}
                    data-chip
                    draggable
                    onDragStart={(e) => {
                      dragging.current = o;
                      // which day of the bar was grabbed (so multi-day bars move relative to grab point)
                      const r = e.currentTarget.getBoundingClientRect();
                      const span = b.endCol - b.startCol + 1;
                      const grabbed = Math.floor(((e.clientX - r.left) / r.width) * span);
                      const offset = b.startCol + grabbed - differenceInCalendarDays(startOfDay(o.start), days[0]);
                      e.dataTransfer.setData("text/offset", String(offset));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(e) => { e.stopPropagation(); onEventClick(o, e.currentTarget.getBoundingClientRect()); }}
                    className={cn(
                      "absolute flex items-center gap-1 overflow-hidden whitespace-nowrap rounded px-1.5 text-left text-[12px] cursor-pointer",
                      isBar ? "font-medium hover:brightness-95" : "text-fg hover:bg-hover",
                      o.end < now && "opacity-60",
                      selectedKey === o.key && (isBar ? "shadow-lg" : "bg-active"),
                    )}
                    style={{
                      top: HEADER_H + b.lane * LANE_H,
                      height: LANE_H - 2,
                      left: `calc(${(b.startCol / 7) * 100}% + 4px)`,
                      width: `calc(${((b.endCol - b.startCol + 1) / 7) * 100}% - 8px)`,
                      ...(isBar ? { background: o.color, color: textOn(o.color) } : {}),
                      borderTopLeftRadius: b.continuesLeft ? 0 : undefined,
                      borderBottomLeftRadius: b.continuesLeft ? 0 : undefined,
                    }}
                  >
                    {!isBar && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
                    {!o.allDay && <span className={cn(isBar ? "" : "text-fg-2")}>{fmtTimeShort(o.start)}</span>}
                    <span className={cn("truncate", !isBar && "font-medium")}>{o.event.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {more && (
        <Floating anchor={more.rect} onClose={() => setMore(null)} width={240}>
          <DayList day={more.day} occs={dayOccs(more.day)} onClose={() => setMore(null)}
            onDayClick={(d) => { setMore(null); onDayClick(d); }}
            onEventClick={(o, r) => { setMore(null); onEventClick(o, r); }} />
        </Floating>
      )}
    </div>
  );
}

/** "+N more" / year-view day popover content. */
export function DayList({ day, occs, onClose, onDayClick, onEventClick }: {
  day: Date; occs: Occurrence[]; onClose: () => void; onDayClick: (d: Date) => void; onEventClick: (o: Occurrence, r: DOMRect) => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-2 flex items-start justify-between">
        <div className="w-full text-center">
          <div className="text-[11px] font-medium uppercase text-fg-2">{format(day, "EEE")}</div>
          <button onClick={() => onDayClick(day)} className={cn("mx-auto mt-0.5 flex size-11 items-center justify-center rounded-full text-[24px] cursor-pointer", isToday(day) ? "bg-[#1a73e8] text-white" : "hover:bg-hover")}>
            {format(day, "d")}
          </button>
        </div>
        <button onClick={onClose} className="absolute right-2 top-2 rounded-full p-1 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Close"><X className="size-4" /></button>
      </div>
      {occs.length === 0 && <p className="py-2 text-center text-xs text-fg-3">There are no events scheduled on this day.</p>}
      <div className="space-y-0.5">
        {occs.map((o) => {
          const isBar = o.allDay;
          return (
            <button key={o.key} onClick={(e) => onEventClick(o, e.currentTarget.getBoundingClientRect())}
              className={cn("flex h-6 w-full items-center gap-1.5 truncate rounded px-1.5 text-left text-[12px] cursor-pointer", isBar ? "font-medium hover:brightness-95" : "hover:bg-hover")}
              style={isBar ? { background: o.color, color: textOn(o.color) } : undefined}>
              {!isBar && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
              {!isBar && !isSameDay(o.start, day) ? null : !isBar && <span className="text-fg-2">{fmtTimeShort(o.start)}</span>}
              <span className="truncate font-medium">{o.event.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
