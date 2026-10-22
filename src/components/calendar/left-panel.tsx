"use client";
import { useState } from "react";
import { Check, ChevronDown, MoreVertical, Plus, RefreshCw, Trash2, Eye, Pencil, Unplug, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { CALENDAR_COLORS } from "@/lib/calendar/shared";
import type { CalendarRow } from "@/lib/types";
import { MiniMonth } from "./mini-month";

type CalWithSync = CalendarRow & { sync_error?: string | null };

export interface GoogleStatus { configured: boolean; connected: boolean; email: string | null }

function CalendarItem({ cal, visible, owned, onToggle, onOnly, onColor, onRename, onDelete, ownerName }: {
  cal: CalWithSync; visible: boolean; owned: boolean; ownerName?: string;
  onToggle: () => void; onOnly: () => void; onColor: (c: string) => void; onRename?: () => void; onDelete?: () => void;
}) {
  return (
    <div className="group flex h-8 items-center gap-3 rounded-md pl-2 pr-1 hover:bg-hover">
      <button onClick={onToggle} aria-label={`${visible ? "Hide" : "Show"} ${cal.name}`}
        className="flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border-2 cursor-pointer"
        style={{ borderColor: cal.color, background: visible ? cal.color : "transparent" }}>
        {visible && <Check className="size-3 text-white" strokeWidth={3} />}
      </button>
      <button onClick={onToggle} className="min-w-0 flex-1 truncate text-left text-[13px] cursor-pointer" title={cal.sync_error ? `Sync error: ${cal.sync_error}` : undefined}>
        {cal.name}
        {ownerName && <span className="ml-1 text-xs text-fg-3">· {ownerName}</span>}
        {cal.sync_error && <span className="ml-1 text-xs text-danger">!</span>}
      </button>
      <Menu>
        <MenuTrigger asChild>
          <button className="rounded-full p-1 text-fg-3 opacity-0 hover:bg-active group-hover:opacity-100 data-[state=open]:opacity-100 cursor-pointer" aria-label="Calendar options">
            <MoreVertical className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" width={220}>
          <MenuItem icon={Eye} onSelect={onOnly}>Display this only</MenuItem>
          {owned && onRename && <MenuItem icon={Pencil} onSelect={onRename}>Rename</MenuItem>}
          {owned && onDelete && <MenuItem icon={Trash2} danger onSelect={onDelete}>Delete calendar</MenuItem>}
          {owned && (
            <>
              <MenuSeparator />
              <div className="grid grid-cols-6 gap-1.5 p-2">
                {CALENDAR_COLORS.map((c) => (
                  <button key={c} onClick={() => onColor(c)} aria-label={`Color ${c}`}
                    className="flex size-6 items-center justify-center rounded-full cursor-pointer hover:scale-110" style={{ background: c }}>
                    {cal.color === c && <Check className="size-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}

export function LeftPanel({
  date, onDate, rangeStart, rangeEnd, marked, mine, others, ownerNames, isVisible, onToggle, onOnly, onColor, onCreateCalendar, onRename, onDeleteCalendar,
  google, onSync, syncing, onDisconnect, onCreate,
}: {
  date: Date; onDate: (d: Date) => void; rangeStart: Date; rangeEnd: Date; marked: Set<string>;
  mine: CalendarRow[]; others: CalendarRow[]; ownerNames: Record<string, string>;
  isVisible: (c: CalendarRow) => boolean; onToggle: (c: CalendarRow) => void; onOnly: (c: CalendarRow) => void;
  onColor: (c: CalendarRow, color: string) => void; onCreateCalendar: (name: string, color: string) => Promise<void>;
  onRename: (c: CalendarRow, name: string) => Promise<void>; onDeleteCalendar: (c: CalendarRow) => void;
  google: GoogleStatus; onSync: () => void; syncing: boolean; onDisconnect: () => void; onCreate: () => void;
}) {
  const [openMine, setOpenMine] = useState(true);
  const [openOthers, setOpenOthers] = useState(true);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "rename"; cal: CalendarRow } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CALENDAR_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (dialog?.mode === "create") await onCreateCalendar(name, color);
      else if (dialog?.mode === "rename") await onRename(dialog.cal, name);
      setDialog(null);
    } finally { setBusy(false); }
  };

  return (
    <aside className="flex w-[256px] shrink-0 flex-col overflow-y-auto px-2 pb-4">
      <div className="px-2 pb-4 pt-2">
        <button onClick={onCreate}
          className="flex h-14 items-center gap-3 rounded-2xl bg-bg pl-4 pr-6 text-[14px] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.2),0_4px_8px_rgba(0,0,0,0.08)] transition-shadow hover:bg-bg-2 hover:shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_16px_rgba(0,0,0,0.1)] cursor-pointer dark:bg-bg-3">
          <Plus className="size-7 text-[#1a73e8]" strokeWidth={2.2} /> Create
        </button>
      </div>

      <MiniMonth value={date} onSelect={onDate} rangeStart={rangeStart} rangeEnd={rangeEnd} marked={marked} className="px-2" />

      <div className="mt-4">
        <button onClick={() => setOpenMine((x) => !x)} className="flex h-9 w-full items-center justify-between rounded-md px-2 text-[14px] font-medium hover:bg-hover cursor-pointer">
          My calendars <ChevronDown className={cn("size-4 text-fg-3 transition-transform", !openMine && "-rotate-90")} />
        </button>
        {openMine && mine.map((c) => (
          <CalendarItem key={c.id} cal={c} visible={isVisible(c)} owned onToggle={() => onToggle(c)} onOnly={() => onOnly(c)}
            onColor={(col) => onColor(c, col)}
            onRename={c.source === "internal" ? () => { setName(c.name); setDialog({ mode: "rename", cal: c }); } : undefined}
            onDelete={c.source === "internal" ? () => onDeleteCalendar(c) : undefined} />
        ))}
      </div>

      <div className="mt-2">
        <div className="flex h-9 items-center justify-between rounded-md px-2 hover:bg-hover">
          <button onClick={() => setOpenOthers((x) => !x)} className="flex-1 text-left text-[14px] font-medium cursor-pointer">Other calendars</button>
          <button onClick={() => { setName(""); setColor(CALENDAR_COLORS[Math.floor(Math.random() * CALENDAR_COLORS.length)]); setDialog({ mode: "create" }); }}
            className="rounded-full p-1 text-fg-3 hover:bg-active cursor-pointer" aria-label="Create new calendar"><Plus className="size-4" /></button>
          <button onClick={() => setOpenOthers((x) => !x)} className="p-1 cursor-pointer" aria-label="Toggle other calendars"><ChevronDown className={cn("size-4 text-fg-3 transition-transform", !openOthers && "-rotate-90")} /></button>
        </div>
        {openOthers && others.map((c) => (
          <CalendarItem key={c.id} cal={c} visible={isVisible(c)} owned={false} ownerName={c.owner_id ? ownerNames[c.owner_id] : undefined}
            onToggle={() => onToggle(c)} onOnly={() => onOnly(c)} onColor={() => {}} />
        ))}
        {openOthers && others.length === 0 && <p className="px-2 py-1 text-xs text-fg-3">Calendly bookings appear here once your webhook is connected.</p>}
      </div>

      <div className="mt-4 rounded-lg border border-border-light p-3">
        <div className="mb-1 flex items-center gap-2 text-[13px] font-medium">
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z" /><path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9z" /><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.8 9.3 6 12 6z" /></svg>
          Google Calendar
        </div>
        {google.connected ? (
          <>
            <p className="truncate text-xs text-fg-3">Connected{google.email ? ` as ${google.email}` : ""}</p>
            <div className="mt-2 flex gap-1">
              <Button size="xs" icon={RefreshCw} loading={syncing} onClick={onSync}>Sync now</Button>
              <Button size="xs" variant="ghost" icon={Unplug} onClick={onDisconnect}>Disconnect</Button>
            </div>
          </>
        ) : google.configured ? (
          <>
            <p className="text-xs text-fg-3">Two-way sync your Google events with the CRM calendar.</p>
            <a href="/api/integrations/google/connect" className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-[#1a73e8] px-2.5 text-[12px] font-medium text-white hover:bg-[#1765cc]">
              <ExternalLink className="size-3.5" /> Connect Google Calendar
            </a>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-fg-3">
            To enable sync, add <code className="rounded bg-bg-3 px-1">GOOGLE_CLIENT_ID</code> and <code className="rounded bg-bg-3 px-1">GOOGLE_CLIENT_SECRET</code> in Vercel. Authorized redirect URI: <code className="break-all rounded bg-bg-3 px-1">/api/integrations/google/callback</code>
          </p>
        )}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} size="sm" title={dialog?.mode === "rename" ? "Rename calendar" : "Create new calendar"}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!name.trim()}>{dialog?.mode === "rename" ? "Save" : "Create calendar"}</Button></>}>
        <div className="space-y-3 pb-2">
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} placeholder="e.g. Sales calls" /></Field>
          {dialog?.mode === "create" && (
            <Field label="Color">
              <div className="flex flex-wrap gap-1.5">
                {CALENDAR_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} className="flex size-6 items-center justify-center rounded-full cursor-pointer" style={{ background: c }} aria-label={c}>
                    {color === c && <Check className="size-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
      </Dialog>
    </aside>
  );
}
