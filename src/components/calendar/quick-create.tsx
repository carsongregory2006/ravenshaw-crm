"use client";
import { useState } from "react";
import { Clock, X, CalendarDays, AlignLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtRange } from "@/lib/calendar/shared";
import type { CalendarRow } from "@/lib/types";

export function QuickCreate({ start, end, allDay, calendars, defaultCalendarId, onClose, onSave, onMore }: {
  start: Date; end: Date; allDay: boolean;
  calendars: CalendarRow[];
  defaultCalendarId: string;
  onClose: () => void;
  onSave: (v: { title: string; calendarId: string; description: string }) => Promise<void>;
  onMore: (v: { title: string; calendarId: string; description: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [saving, setSaving] = useState(false);
  const cal = calendars.find((c) => c.id === calendarId);

  const save = async () => {
    setSaving(true);
    try { await onSave({ title, calendarId, description }); } finally { setSaving(false); }
  };

  return (
    <div className="pb-3">
      <div className="flex justify-end px-2 pt-2">
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-fg-2 hover:bg-hover cursor-pointer"><X className="size-[18px]" /></button>
      </div>
      <form className="space-y-3 px-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add title"
          className="w-full border-b-2 border-border bg-transparent pb-1 pl-9 text-[20px] outline-none placeholder:text-fg-3 focus:border-[#1a73e8]"
        />
        <div className="flex items-center gap-4 text-[13px]">
          <Clock className="size-[18px] text-fg-3" />
          <button type="button" onClick={() => onMore({ title, calendarId, description })} className="rounded px-1 text-left hover:bg-hover cursor-pointer">
            {fmtRange(start, end, allDay)}
            <div className="text-xs text-fg-3">{allDay ? "All day" : "Does not repeat"}</div>
          </button>
        </div>
        <div className="flex items-center gap-4">
          <AlignLeft className="size-[18px] text-fg-3" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add description"
            className="h-8 flex-1 rounded-md bg-bg-3 px-2 text-[13px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-[#1a73e8]/30" />
        </div>
        <div className="flex items-center gap-4">
          <CalendarDays className="size-[18px] text-fg-3" />
          <div className="flex flex-1 items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: cal?.color }} />
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}
              className="h-8 flex-1 rounded-md bg-bg-3 px-2 text-[13px] outline-none cursor-pointer">
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.source === "google" ? " (Google)" : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="md" onClick={() => onMore({ title, calendarId, description })}>More options</Button>
          <Button type="submit" variant="primary" size="md" loading={saving} className="rounded-full px-5">Save</Button>
        </div>
      </form>
    </div>
  );
}
