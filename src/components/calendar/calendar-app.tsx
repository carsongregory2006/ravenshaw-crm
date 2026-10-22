"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addDays, addMonths, addWeeks, addYears, format, isSameMonth, startOfDay, startOfMonth, startOfWeek, startOfYear,
} from "date-fns";
import { ChevronLeft, ChevronRight, ChevronDown, Menu as MenuIcon, Search, X, RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { buildOccurrences, localDateToUtcIso, type Occurrence } from "@/lib/calendar/shared";
import {
  createEvent, updateEvent, deleteEvent, markShowed, createCalendar, updateCalendar, deleteCalendar, syncGoogleNow,
  type EventInput, type EditScope,
} from "@/lib/actions/calendar";
import type { CalendarEvent, CalendarRow, Profile } from "@/lib/types";
import { useCalendarEvents } from "./use-events";
import { TimeGrid } from "./time-grid";
import { MonthView } from "./month-view";
import { YearView } from "./year-view";
import { ScheduleView } from "./schedule-view";
import { Floating } from "./floating";
import { EventCard } from "./event-card";
import { QuickCreate } from "./quick-create";
import { EventEditor, type EditorInitial } from "./event-editor";
import { ScopeDialog } from "./scope-dialog";
import { LeftPanel, type GoogleStatus } from "./left-panel";

export type CalView = "day" | "week" | "month" | "year" | "schedule" | "4day";

const VIEWS: { id: CalView; label: string; key: string }[] = [
  { id: "day", label: "Day", key: "D" },
  { id: "week", label: "Week", key: "W" },
  { id: "month", label: "Month", key: "M" },
  { id: "year", label: "Year", key: "Y" },
  { id: "schedule", label: "Schedule", key: "A" },
  { id: "4day", label: "4 days", key: "X" },
];

function rangeFor(view: CalView, date: Date, scheduleDays: number): [Date, Date] {
  const d = startOfDay(date);
  switch (view) {
    case "day": return [d, addDays(d, 1)];
    case "4day": return [d, addDays(d, 4)];
    case "week": { const s = startOfWeek(d); return [s, addDays(s, 7)]; }
    case "month": { const s = startOfWeek(startOfMonth(d)); return [s, addDays(s, 42)]; }
    case "year": { const s = startOfYear(d); return [s, addYears(s, 1)]; }
    case "schedule": return [d, addDays(d, scheduleDays)];
  }
}

function shift(view: CalView, date: Date, dir: 1 | -1) {
  switch (view) {
    case "day": return addDays(date, dir);
    case "4day": return addDays(date, 4 * dir);
    case "week": return addWeeks(date, dir);
    case "month": return addMonths(date, dir);
    case "year": return addYears(date, dir);
    case "schedule": return addDays(date, 30 * dir);
  }
}

function titleFor(view: CalView, start: Date, end: Date, date: Date) {
  if (view === "day") return format(date, "MMMM d, yyyy");
  if (view === "year") return format(date, "yyyy");
  if (view === "month") return format(date, "MMMM yyyy");
  const last = addDays(end, -1);
  if (isSameMonth(start, last)) return format(start, "MMMM yyyy");
  if (start.getFullYear() === last.getFullYear()) return `${format(start, "MMM")} – ${format(last, "MMM yyyy")}`;
  return `${format(start, "MMM yyyy")} – ${format(last, "MMM yyyy")}`;
}

const LS_VIS = "cal-visible";

export function CalendarApp({ me, initialCalendars, ownerNames, google, initial }: {
  me: Profile;
  initialCalendars: CalendarRow[];
  ownerNames: Record<string, string>;
  google: GoogleStatus;
  initial: { date?: string; view?: string; event?: string; google?: string; create?: boolean };
}) {
  const router = useRouter();
  const isStaff = me.role === "admin" || me.role === "ops";
  const [calendars, setCalendars] = useState(initialCalendars);
  useEffect(() => setCalendars(initialCalendars), [initialCalendars]);

  const [view, setView] = useState<CalView>(() => (VIEWS.some((v) => v.id === initial.view) ? (initial.view as CalView) : "week"));
  const [date, setDate] = useState<Date>(() => (initial.date ? new Date(`${initial.date}T00:00`) : new Date()));
  const [panelOpen, setPanelOpen] = useState(true);
  const [scheduleDays, setScheduleDays] = useState(60);
  const [localVis, setLocalVis] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ occ: Occurrence; rect: DOMRect | null } | null>(null);
  const [draft, setDraft] = useState<{ start: Date; end: Date; allDay: boolean; rect: DOMRect | null } | null>(null);
  const [editor, setEditor] = useState<{ initial: EditorInitial; occ?: Occurrence } | null>(null);
  const [scopeAsk, setScopeAsk] = useState<{ verb: "Edit" | "Delete"; resolve: (s: EditScope | null) => void } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Occurrence[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // restore prefs
  useEffect(() => {
    try {
      setLocalVis(JSON.parse(localStorage.getItem(LS_VIS) || "{}"));
      if (!initial.view) {
        const v = localStorage.getItem("cal-view") as CalView | null;
        if (v && VIEWS.some((x) => x.id === v)) setView(v);
      }
    } catch {}
    if (window.innerWidth < 900) setPanelOpen(false);
    if (initial.google === "connected") toast.success("Google Calendar connected");
    else if (initial.google === "disconnected") toast("Google Calendar disconnected");
    else if (initial.google === "error" || initial.google === "invalid_state") toast.error("Couldn't connect Google Calendar. Please try again.");
    else if (initial.google === "not_configured") toast.error("Google OAuth isn't configured yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep URL shareable without navigation
  useEffect(() => {
    try {
      localStorage.setItem("cal-view", view);
      const u = new URL(window.location.href);
      u.searchParams.set("date", format(date, "yyyy-MM-dd"));
      u.searchParams.set("view", view);
      ["google", "new", "event"].forEach((k) => u.searchParams.delete(k));
      window.history.replaceState(null, "", u.toString());
    } catch {}
  }, [view, date]);

  const mine = calendars.filter((c) => c.owner_id === me.id);
  const others = calendars.filter((c) => c.owner_id !== me.id);
  const isVisible = useCallback((c: CalendarRow) => {
    if (c.owner_id === me.id) return c.is_visible;
    return localVis[c.id] ?? c.owner_id === null;
  }, [localVis, me.id]);
  const visibleIds = calendars.filter(isVisible).map((c) => c.id);
  const writable = mine.length ? mine : calendars.filter((c) => c.owner_id === null);
  const defaultCalId = mine.find((c) => c.source === "internal")?.id ?? writable[0]?.id ?? "";
  const canEdit = (ev: CalendarEvent) => {
    const cal = calendars.find((c) => c.id === ev.calendar_id);
    return !!cal && (cal.owner_id === me.id || cal.owner_id === null || isStaff);
  };

  const [rangeStart, rangeEnd] = useMemo(() => rangeFor(view, date, scheduleDays), [view, date, scheduleDays]);
  const { events, setEvents, reload } = useCalendarEvents(visibleIds, rangeStart, rangeEnd);
  const occs = useMemo(() => buildOccurrences(events, calendars, rangeStart, rangeEnd), [events, calendars, rangeStart, rangeEnd]);
  const marked = useMemo(() => new Set(occs.map((o) => format(o.start, "yyyy-MM-dd"))), [occs]);

  const days = useMemo(() => {
    const n = view === "day" ? 1 : view === "4day" ? 4 : 7;
    return Array.from({ length: n }, (_, i) => addDays(rangeStart, i));
  }, [view, rangeStart]);

  // deep links: ?event=<id> and ?new=1
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    if (initial.create) { deepLinked.current = true; openEditorForNew(); return; }
    if (!initial.event) { deepLinked.current = true; return; }
    const occ = occs.find((o) => o.event.id === initial.event);
    if (occ) { deepLinked.current = true; setSelected({ occ, rect: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occs]);

  const askScope = (verb: "Edit" | "Delete") => new Promise<EditScope | null>((resolve) => setScopeAsk({ verb, resolve }));

  // ── creation ──
  function openEditorForNew(seed?: Partial<EditorInitial>) {
    const s = new Date();
    s.setMinutes(0, 0, 0);
    s.setHours(s.getHours() + 1);
    const start = view === "month" || view === "year" ? new Date(startOfDay(date).setHours(9)) : s;
    setEditor({ initial: { calendar_id: defaultCalId, start_at: start.toISOString(), end_at: new Date(start.getTime() + 3600_000).toISOString(), all_day: false, reminders: [{ minutes: 10 }], ...seed } });
  }

  const timesFor = (start: Date, end: Date, allDay: boolean) =>
    allDay ? { start_at: localDateToUtcIso(start), end_at: localDateToUtcIso(end), all_day: true } : { start_at: start.toISOString(), end_at: end.toISOString(), all_day: false };

  const onSlotCreate = (start: Date, end: Date, allDay: boolean, rect: DOMRect) => {
    setSelected(null);
    if (!defaultCalId) { toast.error("No calendar available"); return; }
    setDraft({ start, end, allDay, rect });
  };

  const saveQuick = async (v: { title: string; calendarId: string; description: string }) => {
    if (!draft) return;
    const res = await createEvent({
      calendar_id: v.calendarId, title: v.title, description: v.description || null,
      ...timesFor(draft.start, draft.end, draft.allDay), reminders: [{ minutes: 10 }],
    });
    if (!res.ok) { toast.error(res.error); return; }
    setDraft(null);
    toast.success("Event saved");
    reload();
  };

  // ── edit / move ──
  const applyChange = async (occ: Occurrence, start: Date, end: Date) => {
    const ev = occ.event;
    if (!canEdit(ev)) { toast.error("You can't edit this event"); return; }
    let scope: EditScope = "all";
    if (occ.isRecurring) {
      const s = await askScope("Edit");
      if (!s) return;
      scope = s;
    }
    const times = timesFor(start, end, ev.all_day);
    if (!occ.isRecurring) setEvents((xs) => xs.map((x) => (x.id === ev.id ? { ...x, ...times } : x)));
    const res = await updateEvent({ id: ev.id, patch: times, scope, occurrenceStart: occ.start.toISOString() });
    if (!res.ok) toast.error(res.error);
    else toast("Event updated");
    reload();
  };

  const onMonthMove = (occ: Occurrence, delta: number) => applyChange(occ, addDays(occ.start, delta), addDays(occ.end, delta));

  const editorInitialFrom = (occ: Occurrence, asCopy = false): EditorInitial => {
    const ev = occ.event;
    const allDayTimes = ev.all_day ? timesFor(occ.start, occ.end, true) : { start_at: occ.start.toISOString(), end_at: occ.end.toISOString(), all_day: false };
    return {
      id: asCopy ? undefined : ev.id,
      calendar_id: asCopy && !canEdit(ev) ? defaultCalId : ev.calendar_id,
      title: ev.title, description: ev.description, location: ev.location, meeting_url: ev.meeting_url,
      ...allDayTimes,
      recurrence: asCopy ? null : ev.recurrence, color: ev.color, attendees: ev.attendees, reminders: ev.reminders,
      contact_id: ev.contact_id, deal_id: ev.deal_id,
    };
  };

  const saveEditor = async (input: EventInput): Promise<boolean> => {
    if (!editor) return false;
    const { initial: init, occ } = editor;
    if (!init.id) {
      const res = await createEvent(input);
      if (!res.ok) { toast.error(res.error); return false; }
      toast.success("Event saved");
      reload();
      return true;
    }
    let scope: EditScope = "all";
    if (occ?.isRecurring) {
      const s = await askScope("Edit");
      if (!s) return false;
      scope = s;
    }
    const patch: Partial<EventInput> = { ...input };
    if (scope === "single") delete patch.recurrence;
    const res = await updateEvent({ id: init.id, patch, scope, occurrenceStart: occ?.start.toISOString() });
    if (!res.ok) { toast.error(res.error); return false; }
    toast.success("Event saved");
    reload();
    return true;
  };

  const removeOcc = async (occ: Occurrence) => {
    setSelected(null);
    let scope: EditScope = "all";
    if (occ.isRecurring) {
      const s = await askScope("Delete");
      if (!s) return;
      scope = s;
    }
    const ev = occ.event;
    if (scope === "all" || !occ.isRecurring) setEvents((xs) => xs.filter((x) => x.id !== ev.id));
    const res = await deleteEvent({ id: ev.id, scope, occurrenceStart: occ.start.toISOString() });
    if (!res.ok) { toast.error(res.error); reload(); return; }
    const restorable = !occ.isRecurring;
    toast("Event deleted", restorable ? {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await createEvent({
            calendar_id: ev.calendar_id, title: ev.title, description: ev.description, location: ev.location, meeting_url: ev.meeting_url,
            start_at: ev.start_at, end_at: ev.end_at, all_day: ev.all_day, recurrence: ev.recurrence, color: ev.color,
            attendees: ev.attendees, reminders: ev.reminders, contact_id: ev.contact_id, deal_id: ev.deal_id,
          });
          if (!r.ok) toast.error(r.error);
          reload();
        },
      },
    } : undefined);
    reload();
  };

  const doMarkShowed = async (occ: Occurrence) => {
    const res = await markShowed(occ.event.id);
    if (!res.ok) toast.error(res.error);
    else toast.success(res.data.moved ? "Marked showed — deal moved to Showed" : "Marked as showed");
  };

  // ── calendars ──
  const toggleCal = async (c: CalendarRow) => {
    if (c.owner_id === me.id) {
      setCalendars((xs) => xs.map((x) => (x.id === c.id ? { ...x, is_visible: !x.is_visible } : x)));
      const r = await updateCalendar(c.id, { is_visible: !c.is_visible });
      if (!r.ok) toast.error(r.error);
    } else {
      const next = { ...localVis, [c.id]: !isVisible(c) };
      setLocalVis(next);
      try { localStorage.setItem(LS_VIS, JSON.stringify(next)); } catch {}
    }
  };
  const onlyCal = async (c: CalendarRow) => {
    const nextLocal: Record<string, boolean> = {};
    others.forEach((o) => (nextLocal[o.id] = o.id === c.id));
    setLocalVis(nextLocal);
    try { localStorage.setItem(LS_VIS, JSON.stringify(nextLocal)); } catch {}
    setCalendars((xs) => xs.map((x) => (x.owner_id === me.id ? { ...x, is_visible: x.id === c.id } : x)));
    await Promise.all(mine.filter((m) => m.is_visible !== (m.id === c.id)).map((m) => updateCalendar(m.id, { is_visible: m.id === c.id })));
  };
  const colorCal = async (c: CalendarRow, color: string) => {
    setCalendars((xs) => xs.map((x) => (x.id === c.id ? { ...x, color } : x)));
    const r = await updateCalendar(c.id, { color });
    if (!r.ok) toast.error(r.error);
  };

  const doSync = async () => {
    setSyncing(true);
    const r = await syncGoogleNow();
    setSyncing(false);
    if (!r.ok) toast.error(r.error);
    else { toast.success(`Google Calendar synced (${r.data.changed} change${r.data.changed === 1 ? "" : "s"})`); router.refresh(); reload(); }
  };
  const doDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar? Synced Google events will be removed from the CRM (they stay in Google).")) return;
    const res = await fetch("/api/integrations/google/disconnect", { method: "POST", headers: { accept: "application/json" } });
    if (!res.ok) { toast.error("Failed to disconnect"); return; }
    toast("Google Calendar disconnected");
    router.refresh();
    reload();
  };

  // ── search ──
  useEffect(() => {
    if (!searchOpen || !query.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      const like = `%${query.trim()}%`;
      const { data } = await createClient().from("calendar_events").select("*")
        .in("calendar_id", calendars.map((c) => c.id))
        .or(`title.ilike.${like},description.ilike.${like},location.ilike.${like}`)
        .neq("status", "cancelled").order("start_at", { ascending: true }).limit(100);
      const evs = (data ?? []) as CalendarEvent[];
      const map = new Map(calendars.map((c) => [c.id, c]));
      setResults(evs.map((ev) => {
        const occ = buildOccurrences([{ ...ev, recurrence: null }], calendars, new Date(0), new Date(8640000000000000))[0];
        return occ ? { ...occ, event: ev, isRecurring: !!ev.recurrence, calendar: map.get(ev.calendar_id) } : null;
      }).filter(Boolean) as Occurrence[]);
    }, 200);
    return () => clearTimeout(t);
  }, [query, searchOpen, calendars]);

  // ── keyboard shortcuts (Google's) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest("input,textarea,select,[contenteditable=true]") || editor || scopeAsk || document.querySelector("[role=dialog][data-state=open]")) return;
      const k = e.key.toLowerCase();
      const v = VIEWS.find((x) => x.key.toLowerCase() === k || (k === "1" && x.id === "day") || (k === "2" && x.id === "week") || (k === "3" && x.id === "month") || (k === "4" && x.id === "4day"));
      if (v) { setView(v.id); setResults(null); e.preventDefault(); return; }
      if (k === "t") { setDate(new Date()); e.preventDefault(); }
      else if (k === "j" || k === "n") { setDate((d) => shift(view, d, 1)); e.preventDefault(); }
      else if (k === "k" || k === "p") { setDate((d) => shift(view, d, -1)); e.preventDefault(); }
      else if (k === "c") { openEditorForNew(); e.preventDefault(); }
      else if (k === "/") { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); e.preventDefault(); }
      else if (k === "escape") { setSelected(null); setDraft(null); }
      else if ((k === "delete" || k === "backspace") && selected && canEdit(selected.occ.event)) { removeOcc(selected.occ); }
      else if (k === "e" && selected && canEdit(selected.occ.event)) { setEditor({ initial: editorInitialFrom(selected.occ), occ: selected.occ }); setSelected(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const goDay = (d: Date) => { setDate(d); setView("day"); setResults(null); };
  const onEventClick = (occ: Occurrence, rect: DOMRect) => { setDraft(null); setSelected({ occ, rect }); };
  const ghost = draft ? { start: draft.start, end: draft.end, allDay: draft.allDay } : null;
  const currentView = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* top bar */}
      <header className="flex h-16 shrink-0 items-center gap-1 border-b border-border px-2 sm:gap-2 sm:px-3">
        <Tooltip content="Main menu">
          <button onClick={() => setPanelOpen((x) => !x)} className="rounded-full p-3 text-fg-2 hover:bg-hover cursor-pointer" aria-label="Toggle calendar panel">
            <MenuIcon className="size-5" />
          </button>
        </Tooltip>
        <div className="mr-4 hidden items-center gap-2 sm:flex">
          <span className="relative flex size-9 items-center justify-center rounded-md border border-border bg-bg text-[13px] font-semibold text-[#1a73e8] shadow-sm">
            <span className="absolute inset-x-0 top-0 h-2 rounded-t-md bg-[#1a73e8]" />
            <span className="mt-1.5">{format(new Date(), "d")}</span>
          </span>
          <span className="text-[20px] text-fg-2">Calendar</span>
        </div>
        <Tooltip content={format(new Date(), "EEEE, MMMM d")}>
          <button onClick={() => { setDate(new Date()); setResults(null); }}
            className="h-9 rounded-full border border-border px-5 text-[13px] font-medium hover:bg-hover cursor-pointer">Today</button>
        </Tooltip>
        <div className="flex">
          <Tooltip content={`Previous ${currentView.label.toLowerCase()}`}>
            <button onClick={() => setDate((d) => shift(view, d, -1))} className="rounded-full p-2 text-fg-2 hover:bg-hover cursor-pointer" aria-label="Previous"><ChevronLeft className="size-5" /></button>
          </Tooltip>
          <Tooltip content={`Next ${currentView.label.toLowerCase()}`}>
            <button onClick={() => setDate((d) => shift(view, d, 1))} className="rounded-full p-2 text-fg-2 hover:bg-hover cursor-pointer" aria-label="Next"><ChevronRight className="size-5" /></button>
          </Tooltip>
        </div>
        <h2 className="ml-1 truncate text-[18px] font-normal sm:text-[22px]">{results ? "Search results" : titleFor(view, rangeStart, rangeEnd, date)}</h2>

        <div className="ml-auto flex items-center gap-1">
          {searchOpen ? (
            <div className="flex h-10 items-center gap-1 rounded-lg bg-bg-3 pl-3 pr-1">
              <Search className="size-4 text-fg-3" />
              <input ref={searchRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events"
                onKeyDown={(e) => e.key === "Escape" && (setSearchOpen(false), setQuery(""))}
                className="w-36 bg-transparent text-[13px] outline-none sm:w-56" />
              <button onClick={() => { setSearchOpen(false); setQuery(""); }} className="rounded-full p-1.5 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Close search"><X className="size-4" /></button>
            </div>
          ) : (
            <Tooltip content="Search">
              <button onClick={() => setSearchOpen(true)} className="rounded-full p-2.5 text-fg-2 hover:bg-hover cursor-pointer" aria-label="Search"><Search className="size-5" /></button>
            </Tooltip>
          )}
          {google.connected && (
            <Tooltip content="Sync Google Calendar">
              <button onClick={doSync} disabled={syncing} className="rounded-full p-2.5 text-fg-2 hover:bg-hover cursor-pointer disabled:opacity-50" aria-label="Sync now">
                <RefreshCw className={cn("size-5", syncing && "animate-spin")} />
              </button>
            </Tooltip>
          )}
          <Menu>
            <MenuTrigger asChild>
              <button className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-hover cursor-pointer">
                {currentView.label} <ChevronDown className="size-4" />
              </button>
            </MenuTrigger>
            <MenuContent align="end" width={180}>
              {VIEWS.map((v) => (
                <MenuItem key={v.id} onSelect={() => { setView(v.id); setResults(null); }} shortcut={v.key} icon={v.id === view ? Check : undefined}>
                  {v.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {panelOpen && (
          <LeftPanel
            date={date} onDate={(d) => { setDate(d); setResults(null); }} rangeStart={rangeStart} rangeEnd={rangeEnd} marked={marked}
            mine={mine} others={others} ownerNames={ownerNames} isVisible={isVisible}
            onToggle={toggleCal} onOnly={onlyCal} onColor={colorCal}
            onCreateCalendar={async (name, color) => {
              const r = await createCalendar(name, color);
              if (!r.ok) { toast.error(r.error); throw new Error(r.error); }
              setCalendars((xs) => [...xs, r.data]);
              toast.success("Calendar created");
            }}
            onRename={async (c, name) => {
              const r = await updateCalendar(c.id, { name });
              if (!r.ok) { toast.error(r.error); throw new Error(r.error); }
              setCalendars((xs) => xs.map((x) => (x.id === c.id ? { ...x, name } : x)));
            }}
            onDeleteCalendar={async (c) => {
              if (!confirm(`Delete "${c.name}" and all of its events?`)) return;
              const r = await deleteCalendar(c.id);
              if (!r.ok) { toast.error(r.error); return; }
              setCalendars((xs) => xs.filter((x) => x.id !== c.id));
              toast("Calendar deleted");
              reload();
            }}
            google={google} onSync={doSync} syncing={syncing} onDisconnect={doDisconnect}
            onCreate={() => openEditorForNew()}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col border-l border-border-light">
          {results ? (
            <ScheduleView occs={results} onEventClick={onEventClick} onDayClick={goDay} emptyText={`No events match "${query}"`} selectedKey={selected?.occ.key} />
          ) : view === "month" ? (
            <MonthView date={date} occs={occs} selectedKey={selected?.occ.key} onDayClick={goDay} onSlotCreate={onSlotCreate} onEventClick={onEventClick} onEventMove={onMonthMove} />
          ) : view === "year" ? (
            <YearView date={date} occs={occs} onDayClick={goDay} onEventClick={onEventClick} />
          ) : view === "schedule" ? (
            <ScheduleView occs={occs} onEventClick={onEventClick} onDayClick={goDay} onLoadMore={() => setScheduleDays((n) => n + 60)} selectedKey={selected?.occ.key} />
          ) : (
            <TimeGrid days={days} occs={occs} ghost={ghost} selectedKey={selected?.occ.key}
              onSlotCreate={onSlotCreate} onEventClick={onEventClick} onEventChange={applyChange} onDayHeaderClick={goDay} />
          )}
        </div>
      </div>

      {selected && (
        <Floating anchor={selected.rect} onClose={() => setSelected(null)}>
          <EventCard
            occ={selected.occ}
            canEdit={canEdit(selected.occ.event)}
            onClose={() => setSelected(null)}
            onEdit={() => { setEditor({ initial: editorInitialFrom(selected.occ), occ: selected.occ }); setSelected(null); }}
            onDelete={() => removeOcc(selected.occ)}
            onDuplicate={() => { setEditor({ initial: editorInitialFrom(selected.occ, true) }); setSelected(null); }}
            onMarkShowed={() => doMarkShowed(selected.occ)}
          />
        </Floating>
      )}

      {draft && (
        <Floating anchor={draft.rect} onClose={() => setDraft(null)}>
          <QuickCreate
            start={draft.start} end={draft.end} allDay={draft.allDay}
            calendars={writable} defaultCalendarId={defaultCalId}
            onClose={() => setDraft(null)}
            onSave={saveQuick}
            onMore={(v) => {
              setEditor({ initial: { calendar_id: v.calendarId, title: v.title, description: v.description, ...timesFor(draft.start, draft.end, draft.allDay), reminders: [{ minutes: 10 }] } });
              setDraft(null);
            }}
          />
        </Floating>
      )}

      {editor && (
        <EventEditor
          open
          initial={editor.initial}
          calendars={editor.initial.id ? calendars.filter((c) => c.owner_id === me.id || c.id === editor.initial.calendar_id) : writable}
          defaultCalendarId={defaultCalId}
          isRecurringInstance={editor.occ?.isRecurring}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}

      <ScopeDialog
        open={!!scopeAsk}
        verb={scopeAsk?.verb ?? "Edit"}
        onCancel={() => { scopeAsk?.resolve(null); setScopeAsk(null); }}
        onConfirm={(s) => { scopeAsk?.resolve(s); setScopeAsk(null); }}
      />

    </div>
  );
}
