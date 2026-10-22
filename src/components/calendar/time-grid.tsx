"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMinutes, format, isSameDay, isToday, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { HOUR_PX, layoutBars, layoutDay, gmtLabel, fmtTimeShort, textOn, type Occurrence } from "@/lib/calendar/shared";

const SNAP = 15;
const GUTTER = 56;
const BAR_H = 22;

type Drag =
  | { kind: "create"; day: number; startMin: number; curDay: number; curMin: number; moved: boolean; x0: number; y0: number }
  | { kind: "move"; occ: Occurrence; offsetMin: number; curDay: number; curMin: number; moved: boolean; x0: number; y0: number; el: HTMLElement }
  | { kind: "resize"; occ: Occurrence; curMin: number; moved: boolean; x0: number; y0: number };

export interface TimeGridProps {
  days: Date[];
  occs: Occurrence[];
  ghost?: { start: Date; end: Date; allDay: boolean } | null;
  selectedKey?: string | null;
  onSlotCreate: (start: Date, end: Date, allDay: boolean, rect: DOMRect) => void;
  onEventClick: (occ: Occurrence, rect: DOMRect) => void;
  onEventChange: (occ: Occurrence, start: Date, end: Date) => void;
  onDayHeaderClick: (day: Date) => void;
}

const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clampMin = (m: number) => Math.max(0, Math.min(24 * 60, m));

export function TimeGrid({ days, occs, ghost, selectedKey, onSlotCreate, onEventClick, onEventChange, onDayHeaderClick }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // initial scroll: an hour before now if today is visible, else 7am
  const firstKey = days[0]?.toDateString();
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = days.some((d) => isToday(d));
    const h = showsToday ? Math.max(0, new Date().getHours() - 1.5) : 7;
    el.scrollTop = h * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, days.length]);

  const bars = useMemo(() => layoutBars(occs, days), [occs, days]);
  const laneCount = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const maxLanes = allDayExpanded ? laneCount : Math.min(laneCount, 3);
  const columns = useMemo(() => days.map((d) => layoutDay(occs, d)), [occs, days]);

  // ── pointer math ──
  const pointToSlot = (x: number, y: number) => {
    const rect = colsRef.current!.getBoundingClientRect();
    const colW = rect.width / days.length;
    const day = Math.max(0, Math.min(days.length - 1, Math.floor((x - rect.left) / colW)));
    const min = clampMin(((y - rect.top) / HOUR_PX) * 60);
    return { day, min };
  };
  const slotRect = (day: number, startMin: number, endMin: number) => {
    const rect = colsRef.current!.getBoundingClientRect();
    const colW = rect.width / days.length;
    return new DOMRect(rect.left + day * colW, rect.top + (startMin / 60) * HOUR_PX, colW, ((endMin - startMin) / 60) * HOUR_PX);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3;
      const { day, min } = pointToSlot(e.clientX, e.clientY);
      let next: Drag;
      if (d.kind === "create") next = { ...d, curDay: day, curMin: min, moved };
      else if (d.kind === "move") next = { ...d, curDay: day, curMin: min, moved };
      else next = { ...d, curMin: min, moved };
      dragRef.current = next;
      setDrag(next);
      // autoscroll near edges
      const sc = scrollRef.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (e.clientY < r.top + 24) sc.scrollTop -= 12;
        else if (e.clientY > r.bottom - 24) sc.scrollTop += 12;
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (d.kind === "create") {
        let s: number, e: number;
        if (!d.moved) {
          s = Math.floor(d.startMin / 30) * 30;
          e = Math.min(s + 60, 24 * 60);
        } else {
          const a = snap(Math.min(d.startMin, d.curMin));
          const b = snap(Math.max(d.startMin, d.curMin));
          s = a;
          e = Math.max(b, a + SNAP);
        }
        const day = days[d.day];
        onSlotCreate(addMinutes(startOfDay(day), s), addMinutes(startOfDay(day), e), false, slotRect(d.day, s, e));
      } else if (d.kind === "move") {
        if (!d.moved) {
          onEventClick(d.occ, d.el.getBoundingClientRect());
          return;
        }
        const dur = d.occ.end.getTime() - d.occ.start.getTime();
        const startMin = snap(clampMin(d.curMin - d.offsetMin));
        const ns = addMinutes(startOfDay(days[d.curDay]), Math.min(startMin, 24 * 60 - SNAP));
        if (ns.getTime() !== d.occ.start.getTime()) onEventChange(d.occ, ns, new Date(ns.getTime() + dur));
      } else if (d.kind === "resize" && d.moved) {
        const dayStart = startOfDay(d.occ.start);
        const startMin = (d.occ.start.getTime() - dayStart.getTime()) / 60_000;
        const endMin = Math.max(startMin + SNAP, snap(d.curMin));
        const ne = addMinutes(dayStart, endMin);
        if (ne.getTime() !== d.occ.end.getTime()) onEventChange(d.occ, d.occ.start, ne);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  const begin = (d: Drag) => { dragRef.current = d; setDrag(d); };

  const onColumnPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { day, min } = pointToSlot(e.clientX, e.clientY);
    e.preventDefault();
    begin({ kind: "create", day, startMin: min, curDay: day, curMin: min, moved: false, x0: e.clientX, y0: e.clientY });
  };

  const onEventPointerDown = (occ: Occurrence, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const { day, min } = pointToSlot(e.clientX, e.clientY);
    const occStartMin = (occ.start.getTime() - startOfDay(days[day]).getTime()) / 60_000;
    begin({ kind: "move", occ, offsetMin: min - occStartMin, curDay: day, curMin: min, moved: false, x0: e.clientX, y0: e.clientY, el: e.currentTarget });
  };

  const onResizePointerDown = (occ: Occurrence, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const { min } = pointToSlot(e.clientX, e.clientY);
    begin({ kind: "resize", occ, curMin: min, moved: false, x0: e.clientX, y0: e.clientY });
  };

  // ── previews ──
  type Preview = { day: number; startMin: number; endMin: number; occ?: Occurrence };
  let preview: Preview | null = null;
  if (drag?.kind === "create" && drag.moved && drag.day === drag.curDay) {
    const a = snap(Math.min(drag.startMin, drag.curMin));
    preview = { day: drag.day, startMin: a, endMin: Math.max(snap(Math.max(drag.startMin, drag.curMin)), a + SNAP) };
  } else if (drag?.kind === "move" && drag.moved) {
    const dur = (drag.occ.end.getTime() - drag.occ.start.getTime()) / 60_000;
    const s = snap(clampMin(drag.curMin - drag.offsetMin));
    preview = { day: drag.curDay, startMin: s, endMin: Math.min(s + dur, 24 * 60), occ: drag.occ };
  } else if (drag?.kind === "resize" && drag.moved) {
    const di = days.findIndex((d) => isSameDay(d, drag.occ.start));
    const s = (drag.occ.start.getTime() - startOfDay(drag.occ.start).getTime()) / 60_000;
    if (di >= 0) preview = { day: di, startMin: s, endMin: Math.max(s + SNAP, snap(drag.curMin)), occ: drag.occ };
  }
  const draggingKey = drag && drag.kind !== "create" && drag.moved ? drag.occ.key : null;

  const ghostTimed: Preview | null = ghost && !ghost.allDay ? (() => {
    const di = days.findIndex((d) => isSameDay(d, ghost.start));
    if (di < 0) return null;
    const s = (ghost.start.getTime() - startOfDay(ghost.start).getTime()) / 60_000;
    const e = isSameDay(ghost.end, ghost.start) ? (ghost.end.getTime() - startOfDay(ghost.start).getTime()) / 60_000 : 24 * 60;
    return { day: di, startMin: s, endMin: e };
  })() : null;

  const allDayHeight = Math.max(maxLanes, ghost?.allDay ? 1 : 0) * (BAR_H + 2) + 6;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none">
      {/* day headers */}
      <div className="flex shrink-0 pr-[10px]">
        <div style={{ width: GUTTER }} className="shrink-0" />
        {days.map((d) => {
          const today = isToday(d);
          return (
            <div key={d.toISOString()} className="flex flex-1 flex-col items-center pb-1 pt-2">
              <span className={cn("text-[11px] font-medium uppercase tracking-wide", today ? "text-[#1a73e8]" : "text-fg-2")}>{format(d, "EEE")}</span>
              <button
                onClick={() => onDayHeaderClick(d)}
                className={cn(
                  "mt-0.5 flex size-11 items-center justify-center rounded-full text-[24px] font-normal transition-colors cursor-pointer",
                  today ? "bg-[#1a73e8] text-white hover:bg-[#1765cc]" : "text-fg hover:bg-hover",
                )}
              >
                {format(d, "d")}
              </button>
            </div>
          );
        })}
      </div>

      {/* all-day row */}
      <div className="flex shrink-0 border-b border-border pr-[10px]">
        <div style={{ width: GUTTER }} className="flex shrink-0 items-end justify-end pb-1 pr-2 text-[10px] text-fg-3">
          {laneCount > 3 ? (
            <button onClick={() => setAllDayExpanded((x) => !x)} className="rounded px-1 hover:bg-hover cursor-pointer">{allDayExpanded ? "less" : `+${laneCount - 3}`}</button>
          ) : gmtLabel(days[0])}
        </div>
        <div
          className="relative flex-1 border-l border-border"
          style={{ height: allDayHeight }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const r = e.currentTarget.getBoundingClientRect();
            const di = Math.max(0, Math.min(days.length - 1, Math.floor(((e.clientX - r.left) / r.width) * days.length)));
            const day = startOfDay(days[di]);
            onSlotCreate(day, addDays(day, 1), true, new DOMRect(r.left + (di * r.width) / days.length, r.top, r.width / days.length, BAR_H));
          }}
        >
          {days.map((d, i) => i > 0 && <div key={i} className="pointer-events-none absolute inset-y-0 border-l border-border" style={{ left: `${(i / days.length) * 100}%` }} />)}
          {bars.filter((b) => b.lane < maxLanes).map((b) => (
            <button
              key={b.occ.key}
              onClick={(e) => onEventClick(b.occ, e.currentTarget.getBoundingClientRect())}
              className={cn(
                "absolute truncate rounded px-2 text-left text-[12px] font-medium leading-[22px] cursor-pointer hover:brightness-95",
                b.occ.end < now && "opacity-60",
                selectedKey === b.occ.key && "shadow-lg ring-2 ring-white/60",
              )}
              style={{
                top: 3 + b.lane * (BAR_H + 2),
                height: BAR_H,
                left: `calc(${(b.startCol / days.length) * 100}% + 2px)`,
                width: `calc(${((b.endCol - b.startCol + 1) / days.length) * 100}% - 6px)`,
                background: b.occ.color,
                color: textOn(b.occ.color),
                borderTopLeftRadius: b.continuesLeft ? 0 : undefined,
                borderBottomLeftRadius: b.continuesLeft ? 0 : undefined,
              }}
            >
              {b.occ.allDay || b.occ.event.all_day ? b.occ.event.title : `${fmtTimeShort(b.occ.start)} ${b.occ.event.title}`}
            </button>
          ))}
          {ghost?.allDay && (() => {
            const di = days.findIndex((d) => isSameDay(d, ghost.start));
            if (di < 0) return null;
            return (
              <div className="pointer-events-none absolute rounded bg-[#1a73e8] px-2 text-[12px] leading-[22px] text-white shadow-md"
                style={{ top: 3, height: BAR_H, left: `calc(${(di / days.length) * 100}% + 2px)`, width: `calc(${100 / days.length}% - 6px)` }}>
                (No title)
              </div>
            );
          })()}
        </div>
      </div>

      {/* time grid */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-scroll">
        <div className="flex" style={{ height: 24 * HOUR_PX }}>
          {/* hour gutter */}
          <div style={{ width: GUTTER }} className="relative shrink-0">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-fg-3" style={{ top: h * HOUR_PX }}>
                {format(new Date(2000, 0, 1, h), "h a")}
              </span>
            ))}
          </div>
          {/* day columns */}
          <div
            ref={colsRef}
            className="relative flex flex-1 border-l border-border"
            style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR_PX}px)` }}
          >
            {days.map((d, di) => (
              <div key={d.toISOString()} className={cn("relative flex-1", di > 0 && "border-l border-border")} onPointerDown={onColumnPointerDown}>
                {columns[di].map((p) => {
                  const o = p.occ;
                  const short = p.height < 34;
                  const isLastCol = p.left + p.width >= 0.999;
                  return (
                    <div
                      key={o.key}
                      onPointerDown={(e) => onEventPointerDown(o, e)}
                      className={cn(
                        "group absolute overflow-hidden rounded-[5px] border border-[var(--bg)] px-1.5 text-[12px] leading-tight cursor-pointer transition-[filter] hover:brightness-95",
                        o.end < now && "opacity-60",
                        draggingKey === o.key && "opacity-40",
                        selectedKey === o.key && "z-20 shadow-lg",
                      )}
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `calc(${p.left * 100}% + 1px)`,
                        width: `calc(${p.width * 100}% - ${isLastCol ? 10 : 1}px)`,
                        background: o.event.status === "tentative" ? "var(--bg)" : o.color,
                        color: o.event.status === "tentative" ? o.color : textOn(o.color),
                        borderColor: o.event.status === "tentative" ? o.color : undefined,
                        zIndex: Math.round(p.left * 10) + 1,
                      }}
                    >
                      {short ? (
                        <div className="truncate pt-px"><span className="font-medium">{o.event.title}</span>, {fmtTimeShort(o.start)}</div>
                      ) : (
                        <>
                          <div className="truncate pt-0.5 font-medium">{o.event.title}</div>
                          <div className="truncate opacity-90">{fmtTimeShort(o.start)} – {fmtTimeShort(o.end)}</div>
                          {p.height > 56 && o.event.location && <div className="truncate opacity-90">{o.event.location}</div>}
                        </>
                      )}
                      <div onPointerDown={(e) => onResizePointerDown(o, e)} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />
                    </div>
                  );
                })}

                {/* drag / ghost previews */}
                {[preview, ghostTimed].map((pv, i) => pv && pv.day === di && (
                  <div
                    key={i}
                    className="pointer-events-none absolute z-30 overflow-hidden rounded-[5px] px-1.5 text-[12px] leading-tight shadow-lg"
                    style={{
                      top: (pv.startMin / 60) * HOUR_PX,
                      height: Math.max(((pv.endMin - pv.startMin) / 60) * HOUR_PX - 1, 18),
                      left: 1,
                      right: 10,
                      background: pv.occ ? pv.occ.color : "#1a73e8",
                      color: pv.occ ? textOn(pv.occ.color) : "#fff",
                    }}
                  >
                    <div className="truncate pt-0.5 font-medium">{pv.occ ? pv.occ.event.title : "(No title)"}</div>
                    <div className="truncate opacity-90">
                      {fmtTimeShort(addMinutes(startOfDay(days[pv.day]), pv.startMin))} – {fmtTimeShort(addMinutes(startOfDay(days[pv.day]), pv.endMin))}
                    </div>
                  </div>
                ))}

                {isToday(d) && (
                  <div className="pointer-events-none absolute inset-x-0 z-40" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <div className="absolute -left-[6px] -top-[5px] size-3 rounded-full bg-[#ea4335]" />
                    <div className="h-[2px] bg-[#ea4335]" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
