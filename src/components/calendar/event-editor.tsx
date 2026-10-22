"use client";
import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Bell, CalendarDays, Clock, Globe, MapPin, Plus, Target, User, Users, Video, X, AlignLeft, Palette, Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { cn, contactLabel } from "@/lib/utils";
import { GOOGLE_EVENT_COLORS, allDayToLocal, localDateToUtcIso, repeatPresets, rruleOnly, describeRecurrence, tzName, gmtLabel } from "@/lib/calendar/shared";
import type { EventInput } from "@/lib/actions/calendar";
import type { CalendarRow } from "@/lib/types";
import { TimeSelect, toMin, toHHMM } from "./time-select";

export interface EditorInitial extends Partial<EventInput> {
  id?: string;
}

interface FormState {
  calendar_id: string;
  title: string;
  description: string;
  location: string;
  meeting_url: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  all_day: boolean;
  recurrence: string | null;
  color: string | null;
  attendees: { email: string; name?: string; status?: string }[];
  reminders: { minutes: number }[];
  contact_id: string | null;
  deal_id: string | null;
}

function toForm(init: EditorInitial, fallbackCal: string): FormState {
  const allDay = !!init.all_day;
  const s = init.start_at ? (allDay ? allDayToLocal(init.start_at) : new Date(init.start_at)) : new Date();
  const e = init.end_at ? (allDay ? addDays(allDayToLocal(init.end_at), -1) : new Date(init.end_at)) : new Date(s.getTime() + 3600_000);
  return {
    calendar_id: init.calendar_id ?? fallbackCal,
    title: init.title ?? "",
    description: init.description ?? "",
    location: init.location ?? "",
    meeting_url: init.meeting_url ?? "",
    startDate: format(s, "yyyy-MM-dd"),
    startTime: format(s, "HH:mm"),
    endDate: format(e, "yyyy-MM-dd"),
    endTime: format(e, "HH:mm"),
    all_day: allDay,
    recurrence: init.recurrence ?? null,
    color: init.color ?? null,
    attendees: init.attendees ?? [],
    reminders: init.reminders ?? [{ minutes: 10 }],
    contact_id: init.contact_id ?? null,
    deal_id: init.deal_id ?? null,
  };
}

export function formToInput(f: FormState): EventInput {
  let start_at: string, end_at: string;
  if (f.all_day) {
    const [sy, sm, sd] = f.startDate.split("-").map(Number);
    const [ey, em, ed] = f.endDate.split("-").map(Number);
    start_at = localDateToUtcIso(new Date(sy, sm - 1, sd));
    end_at = localDateToUtcIso(addDays(new Date(ey, em - 1, ed), 1));
  } else {
    start_at = new Date(`${f.startDate}T${f.startTime}`).toISOString();
    end_at = new Date(`${f.endDate}T${f.endTime}`).toISOString();
  }
  return {
    calendar_id: f.calendar_id,
    title: f.title.trim() || "(No title)",
    description: f.description || null,
    location: f.location || null,
    meeting_url: f.meeting_url || null,
    start_at,
    end_at,
    all_day: f.all_day,
    recurrence: f.recurrence,
    color: f.color,
    attendees: f.attendees,
    reminders: f.reminders,
    contact_id: f.contact_id,
    deal_id: f.deal_id,
  };
}

const REMINDER_UNITS = [{ id: 1, label: "minutes" }, { id: 60, label: "hours" }, { id: 1440, label: "days" }, { id: 10080, label: "weeks" }];
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function CustomRepeat({ start, value, onDone, onCancel }: { start: Date; value: string | null; onDone: (r: string) => void; onCancel: () => void }) {
  const parsed = useMemo(() => {
    const line = rruleOnly(value)?.replace(/^RRULE:/, "") ?? "";
    return Object.fromEntries(line.split(";").filter(Boolean).map((p) => p.split("="))) as Record<string, string>;
  }, [value]);
  const [freq, setFreq] = useState(parsed.FREQ ?? "WEEKLY");
  const [interval, setIntervalVal] = useState(Number(parsed.INTERVAL ?? 1));
  const [days, setDays] = useState<string[]>(parsed.BYDAY && !/\d/.test(parsed.BYDAY) ? parsed.BYDAY.split(",") : [DOW[start.getDay()]]);
  const [ends, setEnds] = useState<"never" | "on" | "after">(parsed.UNTIL ? "on" : parsed.COUNT ? "after" : "never");
  const [until, setUntil] = useState(parsed.UNTIL ? `${parsed.UNTIL.slice(0, 4)}-${parsed.UNTIL.slice(4, 6)}-${parsed.UNTIL.slice(6, 8)}` : format(addDays(start, 90), "yyyy-MM-dd"));
  const [count, setCount] = useState(Number(parsed.COUNT ?? 13));

  const build = () => {
    const parts = [`FREQ=${freq}`];
    if (interval > 1) parts.push(`INTERVAL=${interval}`);
    if (freq === "WEEKLY" && days.length) parts.push(`BYDAY=${DOW.filter((d) => days.includes(d)).join(",")}`);
    if (ends === "on") parts.push(`UNTIL=${until.replace(/-/g, "")}T235959Z`);
    if (ends === "after") parts.push(`COUNT=${Math.max(1, count)}`);
    onDone(`RRULE:${parts.join(";")}`);
  };

  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[freq];
  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex items-center gap-2">
        <span>Repeat every</span>
        <input type="number" min={1} value={interval} onChange={(e) => setIntervalVal(Math.max(1, Number(e.target.value)))} className="h-9 w-16 rounded-md bg-bg-3 px-2 outline-none" />
        <select value={freq} onChange={(e) => setFreq(e.target.value)} className="h-9 rounded-md bg-bg-3 px-2 outline-none cursor-pointer">
          {["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].map((f) => <option key={f} value={f}>{({ DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as Record<string, string>)[f]}{interval > 1 ? "s" : ""}</option>)}
        </select>
      </div>
      {freq === "WEEKLY" && (
        <div>
          <div className="mb-2">Repeat on</div>
          <div className="flex gap-2">
            {DOW.map((d, i) => (
              <button key={d} type="button" onClick={() => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
                className={cn("size-7 rounded-full text-[11px] font-medium cursor-pointer", days.includes(d) ? "bg-[#1a73e8] text-white" : "bg-bg-3 text-fg-2")}>
                {"SMTWTFS"[i]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <div>Ends</div>
        <label className="flex items-center gap-3"><input type="radio" checked={ends === "never"} onChange={() => setEnds("never")} className="accent-[#1a73e8]" /> Never</label>
        <label className="flex items-center gap-3"><input type="radio" checked={ends === "on"} onChange={() => setEnds("on")} className="accent-[#1a73e8]" /> On
          <input type="date" value={until} disabled={ends !== "on"} onChange={(e) => setUntil(e.target.value)} className="h-8 rounded-md bg-bg-3 px-2 outline-none disabled:opacity-50" /></label>
        <label className="flex items-center gap-3"><input type="radio" checked={ends === "after"} onChange={() => setEnds("after")} className="accent-[#1a73e8]" /> After
          <input type="number" min={1} value={count} disabled={ends !== "after"} onChange={(e) => setCount(Number(e.target.value))} className="h-8 w-16 rounded-md bg-bg-3 px-2 outline-none disabled:opacity-50" /> occurrences</label>
      </div>
      <p className="text-xs text-fg-3">Every {interval > 1 ? `${interval} ${unit}s` : unit}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={build}>Done</Button>
      </div>
    </div>
  );
}

type ContactHit = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null };

function ContactPicker({ contactId, onPick }: { contactId: string | null; onPick: (c: ContactHit | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [current, setCurrent] = useState<ContactHit | null>(null);
  useEffect(() => {
    if (!contactId) { setCurrent(null); return; }
    createClient().from("contacts").select("id, first_name, last_name, email, phone").eq("id", contactId).maybeSingle().then(({ data }) => setCurrent(data));
  }, [contactId]);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      const like = `%${q.trim()}%`;
      const { data } = await createClient().from("contacts").select("id, first_name, last_name, email, phone")
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(6);
      setHits(data ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  if (current) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md bg-bg-3 px-2 text-[13px]">
        <span className="truncate">{contactLabel(current)}</span>
        {current.email && <span className="truncate text-xs text-fg-3">{current.email}</span>}
        <button type="button" onClick={() => onPick(null)} className="ml-auto rounded p-0.5 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Unlink contact"><X className="size-3.5" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link a contact"
        className="h-9 w-full rounded-md bg-bg-3 px-2 text-[13px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-[#1a73e8]/30" />
      {hits.length > 0 && (
        <div className="absolute inset-x-0 top-10 z-10 rounded-md border border-border bg-bg p-1 shadow-lg">
          {hits.map((h) => (
            <button key={h.id} type="button" onClick={() => { onPick(h); setQ(""); setHits([]); }}
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] hover:bg-hover cursor-pointer">
              <span className="truncate">{contactLabel(h)}</span><span className="truncate text-xs text-fg-3">{h.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventEditor({ open, initial, calendars, defaultCalendarId, isRecurringInstance, onClose, onSave }: {
  open: boolean;
  initial: EditorInitial;
  calendars: CalendarRow[];
  defaultCalendarId: string;
  isRecurringInstance?: boolean;
  onClose: () => void;
  onSave: (input: EventInput) => Promise<boolean>;
}) {
  const [f, setF] = useState<FormState>(() => toForm(initial, defaultCalendarId));
  const [saving, setSaving] = useState(false);
  const [guest, setGuest] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [deals, setDeals] = useState<{ id: string; name: string; deal_number: string }[]>([]);

  useEffect(() => { if (open) setF(toForm(initial, defaultCalendarId)); }, [open, initial, defaultCalendarId]);

  useEffect(() => {
    if (!f.contact_id) { setDeals([]); return; }
    createClient().from("deals").select("id, name, deal_number").eq("contact_id", f.contact_id).order("created_at", { ascending: false })
      .then(({ data }) => setDeals(data ?? []));
  }, [f.contact_id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const startDate = new Date(`${f.startDate}T${f.startTime || "00:00"}`);
  const presets = repeatPresets(startDate);
  const ruleLine = rruleOnly(f.recurrence);
  const presetId = presets.find((p) => p.rule === ruleLine)?.id ?? (ruleLine ? "custom" : "none");
  const otherLines = (f.recurrence ?? "").split("\n").filter((l) => l && !l.startsWith("RRULE"));
  const setRule = (rule: string | null) => set("recurrence", rule ? [rule, ...otherLines].join("\n") : null);

  const onStartDate = (v: string) => {
    // keep duration when moving the start date
    const span = (new Date(`${f.endDate}T00:00`).getTime() - new Date(`${f.startDate}T00:00`).getTime()) / 86400_000;
    const nd = addDays(new Date(`${v}T00:00`), Math.round(span));
    setF((x) => ({ ...x, startDate: v, endDate: format(nd, "yyyy-MM-dd") }));
  };
  const onStartTime = (v: string) => {
    const dur = toMin(f.endTime) - toMin(f.startTime);
    const end = toMin(v) + (f.startDate === f.endDate ? Math.max(15, dur) : 0);
    setF((x) => ({ ...x, startTime: v, endTime: f.startDate === f.endDate ? toHHMM(Math.min(end, 24 * 60 - 15)) : x.endTime }));
  };

  const addGuest = (email: string, name?: string) => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || f.attendees.some((a) => a.email.toLowerCase() === e)) return;
    set("attendees", [...f.attendees, { email: e, name }]);
    setGuest("");
  };

  const save = async () => {
    const input = formToInput(f);
    if (new Date(input.end_at) <= new Date(input.start_at)) {
      const { toast } = await import("sonner");
      toast.error("End time must be after start time");
      return;
    }
    setSaving(true);
    try {
      if (await onSave(input)) onClose();
    } finally {
      setSaving(false);
    }
  };

  const cal = calendars.find((c) => c.id === f.calendar_id);
  const color = f.color ?? cal?.color ?? "#1a73e8";
  const field = "h-9 rounded-md bg-bg-3 px-2 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-[#1a73e8]/30";

  return (
    <>
      <Dialog open={open && !customOpen} onOpenChange={(o) => !o && onClose()} size="xl" title={initial.id ? "Edit event" : "New event"}
        description={isRecurringInstance ? "This is a recurring event — you'll choose whether to change one or all events when saving." : undefined}
        footer={<><Button variant="ghost" size="md" onClick={onClose}>Cancel</Button><Button variant="primary" size="md" loading={saving} onClick={save} className="px-6">Save</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4 pb-2">
          <input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Add title"
            className="w-full border-b-2 border-border bg-transparent pb-1 text-[22px] outline-none placeholder:text-fg-3 focus:border-[#1a73e8]" />

          {/* date / time */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Clock className="mr-2 size-[18px] text-fg-3" />
              <input type="date" value={f.startDate} onChange={(e) => onStartDate(e.target.value)} className={field} />
              {!f.all_day && <TimeSelect value={f.startTime} onChange={onStartTime} />}
              <span className="text-fg-3">to</span>
              {!f.all_day && <TimeSelect value={f.endTime} onChange={(v) => set("endTime", v)} from={f.startDate === f.endDate ? f.startTime : undefined} />}
              <input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set("endDate", e.target.value)} className={field} />
            </div>
            <div className="flex flex-wrap items-center gap-4 pl-[34px] text-[13px]">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={f.all_day} onChange={(e) => set("all_day", e.target.checked)} className="size-4 accent-[#1a73e8]" /> All day
              </label>
              <span className="flex items-center gap-1 text-fg-3"><Globe className="size-3.5" /> {gmtLabel(startDate)} {tzName()}</span>
              <select value={presetId} onChange={(e) => {
                if (e.target.value === "custom") { setCustomOpen(true); return; }
                setRule(presets.find((p) => p.id === e.target.value)?.rule ?? null);
              }} className={cn(field, "cursor-pointer")} disabled={isRecurringInstance && !f.recurrence}>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">{presetId === "custom" ? describeRecurrence(f.recurrence) : "Custom…"}</option>
              </select>
            </div>
          </div>

          <div className="grid gap-6 border-t border-border-light pt-4 md:grid-cols-[1fr_280px]">
            {/* details column */}
            <div className="space-y-3">
              <div className="flex items-center gap-3"><MapPin className="size-[18px] shrink-0 text-fg-3" />
                <input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Add location" className={cn(field, "flex-1")} /></div>
              <div className="flex items-center gap-3"><Video className="size-[18px] shrink-0 text-fg-3" />
                <input value={f.meeting_url} onChange={(e) => set("meeting_url", e.target.value)} placeholder="Add Google Meet / Zoom link" className={cn(field, "flex-1")} /></div>

              <div className="flex items-start gap-3"><Bell className="mt-2 size-[18px] shrink-0 text-fg-3" />
                <div className="flex-1 space-y-2">
                  {f.reminders.map((r, i) => {
                    const unit = [...REMINDER_UNITS].reverse().find((u) => r.minutes % u.id === 0 && r.minutes >= u.id) ?? REMINDER_UNITS[0];
                    return (
                      <div key={i} className="flex items-center gap-2 text-[13px]">
                        <span className="text-fg-2">Notification</span>
                        <input type="number" min={0} value={r.minutes / unit.id} onChange={(e) => {
                          const xs = [...f.reminders]; xs[i] = { minutes: Math.max(0, Number(e.target.value)) * unit.id }; set("reminders", xs);
                        }} className={cn(field, "w-16")} />
                        <select value={unit.id} onChange={(e) => {
                          const xs = [...f.reminders]; xs[i] = { minutes: (r.minutes / unit.id) * Number(e.target.value) }; set("reminders", xs);
                        }} className={cn(field, "cursor-pointer")}>
                          {REMINDER_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                        <button type="button" onClick={() => set("reminders", f.reminders.filter((_, j) => j !== i))} className="rounded-full p-1 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Remove notification"><X className="size-4" /></button>
                      </div>
                    );
                  })}
                  {f.reminders.length < 5 && (
                    <button type="button" onClick={() => set("reminders", [...f.reminders, { minutes: 30 }])} className="text-[13px] font-medium text-[#1a73e8] hover:underline cursor-pointer">Add notification</button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3"><CalendarDays className="size-[18px] shrink-0 text-fg-3" />
                <select value={f.calendar_id} onChange={(e) => set("calendar_id", e.target.value)} className={cn(field, "flex-1 cursor-pointer")}>
                  {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.source === "google" ? " (Google)" : c.source === "calendly" ? " (Calendly)" : ""}</option>)}
                </select>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="flex h-9 items-center gap-1.5 rounded-md px-2 hover:bg-hover cursor-pointer" aria-label="Event color">
                      <span className="size-4 rounded-full" style={{ background: color }} /><Palette className="size-4 text-fg-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[188px]">
                    <div className="grid grid-cols-6 gap-1.5">
                      {GOOGLE_EVENT_COLORS.map((c) => (
                        <button key={c.id} type="button" title={c.name} onClick={() => set("color", c.hex)}
                          className="flex size-6 items-center justify-center rounded-full cursor-pointer hover:scale-110" style={{ background: c.hex }}>
                          {f.color === c.hex && <Check className="size-3.5 text-white" />}
                        </button>
                      ))}
                      <button type="button" title="Calendar color" onClick={() => set("color", null)}
                        className="flex size-6 items-center justify-center rounded-full border border-border cursor-pointer" style={{ background: cal?.color }}>
                        {!f.color && <Check className="size-3.5 text-white" />}
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-start gap-3"><AlignLeft className="mt-2 size-[18px] shrink-0 text-fg-3" />
                <textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Add description" rows={5}
                  className="flex-1 resize-y rounded-md bg-bg-3 px-2 py-2 text-[13px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-[#1a73e8]/30" /></div>
            </div>

            {/* guests / CRM column */}
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-medium"><Users className="size-4 text-fg-3" /> Guests</div>
                <div className="flex gap-1">
                  <input value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Add guest email"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGuest(guest); } }} className={cn(field, "min-w-0 flex-1")} />
                  <Button type="button" size="md" icon={Plus} onClick={() => addGuest(guest)} aria-label="Add guest" />
                </div>
                <ul className="mt-2 space-y-1">
                  {f.attendees.map((a) => (
                    <li key={a.email} className="group flex items-center gap-2 text-[13px]">
                      <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{(a.name || a.email)[0]?.toUpperCase()}</span>
                      <span className="min-w-0 flex-1 truncate">{a.name || a.email}</span>
                      <button type="button" onClick={() => set("attendees", f.attendees.filter((x) => x.email !== a.email))} className="rounded p-0.5 text-fg-3 opacity-0 hover:bg-hover group-hover:opacity-100 cursor-pointer" aria-label={`Remove ${a.email}`}><X className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-medium"><User className="size-4 text-fg-3" /> Contact</div>
                <ContactPicker contactId={f.contact_id} onPick={(c) => {
                  setF((x) => ({
                    ...x,
                    contact_id: c?.id ?? null,
                    deal_id: c ? x.deal_id : null,
                    attendees: c?.email && !x.attendees.some((a) => a.email.toLowerCase() === c.email!.toLowerCase())
                      ? [...x.attendees, { email: c.email.toLowerCase(), name: contactLabel(c) }] : x.attendees,
                  }));
                }} />
              </div>
              {f.contact_id && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-medium"><Target className="size-4 text-fg-3" /> Deal</div>
                  <select value={f.deal_id ?? ""} onChange={(e) => set("deal_id", e.target.value || null)} className={cn(field, "w-full cursor-pointer")}>
                    <option value="">No deal</option>
                    {deals.map((d) => <option key={d.id} value={d.id}>{d.deal_number} · {d.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        </form>
      </Dialog>
      <Dialog open={customOpen} onOpenChange={(o) => !o && setCustomOpen(false)} size="sm" title="Custom recurrence">
        <CustomRepeat start={startDate} value={f.recurrence} onCancel={() => setCustomOpen(false)} onDone={(r) => { setRule(r); setCustomOpen(false); }} />
      </Dialog>
    </>
  );
}
