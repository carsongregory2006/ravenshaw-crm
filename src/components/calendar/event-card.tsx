"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlignLeft, Bell, CalendarDays, Copy, Mail, MapPin, MoreVertical, Pencil, Trash2, Users, Video, X, User, Target, CheckCircle2, ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { contactLabel, cn } from "@/lib/utils";
import { describeRecurrence, fmtRange, type Occurrence } from "@/lib/calendar/shared";

function IconBtn({ label, icon: Icon, onClick }: { label: string; icon: typeof Pencil; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <button onClick={onClick} aria-label={label} className="rounded-full p-2 text-fg-2 hover:bg-hover hover:text-fg cursor-pointer">
        <Icon className="size-[18px]" />
      </button>
    </Tooltip>
  );
}

function Row({ icon: Icon, children, color }: { icon?: typeof Pencil; children: React.ReactNode; color?: string }) {
  return (
    <div className="flex gap-4 py-1.5">
      <div className="flex w-5 shrink-0 justify-center pt-0.5">
        {color ? <span className="mt-1 size-3.5 rounded-[4px]" style={{ background: color }} /> : Icon ? <Icon className="size-[18px] text-fg-3" /> : null}
      </div>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-fg">{children}</div>
    </div>
  );
}

function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-[#1a73e8] hover:underline">{part}</a>
      : <span key={i}>{part}</span>,
  );
}

const reminderLabel = (m: number) => m === 0 ? "At time of event" : m % 1440 === 0 ? `${m / 1440} day${m > 1440 ? "s" : ""} before` : m % 60 === 0 ? `${m / 60} hour${m > 60 ? "s" : ""} before` : `${m} minutes before`;

export function EventCard({ occ, canEdit, onClose, onEdit, onDelete, onDuplicate, onMarkShowed }: {
  occ: Occurrence;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMarkShowed: () => void;
}) {
  const ev = occ.event;
  const [contact, setContact] = useState<{ id: string; label: string } | null>(null);
  const [deal, setDeal] = useState<{ id: string; name: string; deal_number: string } | null>(null);

  useEffect(() => {
    const sb = createClient();
    if (ev.contact_id) {
      sb.from("contacts").select("id, first_name, last_name, email, phone").eq("id", ev.contact_id).maybeSingle()
        .then(({ data }) => setContact(data ? { id: data.id, label: contactLabel(data) } : null));
    } else setContact(null);
    if (ev.deal_id) {
      sb.from("deals").select("id, name, deal_number").eq("id", ev.deal_id).maybeSingle().then(({ data }) => setDeal(data));
    } else setDeal(null);
  }, [ev.contact_id, ev.deal_id]);

  const recurrence = describeRecurrence(ev.recurrence) ?? (occ.isRecurring ? "Recurring event" : null);
  const emails = ev.attendees.map((a) => a.email).filter(Boolean);
  const mailto = `mailto:${emails.join(",")}?subject=${encodeURIComponent(ev.title)}`;
  const source = ev.external_source === "calendly" ? "Calendly" : occ.calendar?.source === "google" ? "Google Calendar" : null;

  return (
    <div className="pb-3">
      <div className="flex items-center justify-end gap-0.5 px-2 pt-2">
        {canEdit && <IconBtn label="Edit event" icon={Pencil} onClick={onEdit} />}
        {canEdit && <IconBtn label="Delete event" icon={Trash2} onClick={onDelete} />}
        <IconBtn label={emails.length ? "Email guests" : "Email"} icon={Mail} onClick={() => window.open(mailto, "_blank")} />
        <Menu>
          <MenuTrigger asChild>
            <button aria-label="Options" className="rounded-full p-2 text-fg-2 hover:bg-hover hover:text-fg cursor-pointer"><MoreVertical className="size-[18px]" /></button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={Copy} onSelect={onDuplicate}>Duplicate</MenuItem>
            {(ev.contact_id || ev.deal_id) && <MenuItem icon={CheckCircle2} onSelect={onMarkShowed}>Mark as showed</MenuItem>}
            {ev.meeting_url && <MenuItem icon={ExternalLink} onSelect={() => navigator.clipboard.writeText(ev.meeting_url!)}>Copy meeting link</MenuItem>}
          </MenuContent>
        </Menu>
        <IconBtn label="Close" icon={X} onClick={onClose} />
      </div>

      <div className="px-4">
        <Row color={occ.color}>
          <div className="text-[20px] font-normal leading-snug">{ev.title}</div>
          <div className="text-[13px] text-fg-2">{fmtRange(occ.start, occ.end, occ.allDay && ev.all_day)}</div>
          {recurrence && <div className="text-[13px] text-fg-2">{recurrence}</div>}
          {ev.status === "tentative" && <div className="text-xs text-fg-3">Tentative</div>}
        </Row>

        {ev.meeting_url && (
          <Row icon={Video}>
            <a href={ev.meeting_url} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md bg-[#1a73e8] px-4 text-[13px] font-medium text-white hover:bg-[#1765cc]">
              {/meet\.google/.test(ev.meeting_url) ? "Join with Google Meet" : /zoom\.us/.test(ev.meeting_url) ? "Join Zoom meeting" : "Join meeting"}
            </a>
            <div className="mt-1 truncate text-xs text-fg-3">{ev.meeting_url.replace(/^https?:\/\//, "")}</div>
          </Row>
        )}
        {ev.location && (
          <Row icon={MapPin}>
            <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location)}`} target="_blank" rel="noreferrer" className="hover:underline">{ev.location}</a>
          </Row>
        )}
        {ev.attendees.length > 0 && (
          <Row icon={Users}>
            <div>{ev.attendees.length} guest{ev.attendees.length > 1 ? "s" : ""}</div>
            <ul className="mt-1 space-y-1">
              {ev.attendees.map((a) => (
                <li key={a.email} className="flex items-center gap-2 text-[13px]">
                  <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{(a.name || a.email)[0]?.toUpperCase()}</span>
                  <span className="min-w-0 truncate">{a.name || a.email}</span>
                  {a.status && a.status !== "needsAction" && <span className="text-xs text-fg-3">{a.status}</span>}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {(contact || deal) && (
          <Row icon={User}>
            {contact && <div><Link href={`/contacts/${contact.id}`} className="text-[#1a73e8] hover:underline">{contact.label}</Link></div>}
            {deal && (
              <div className="flex items-center gap-1">
                <Target className="size-3.5 text-fg-3" />
                <Link href={`/deals/${deal.id}`} className="text-[#1a73e8] hover:underline">{deal.deal_number} · {deal.name}</Link>
              </div>
            )}
          </Row>
        )}
        {ev.description && (
          <Row icon={AlignLeft}>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{linkify(ev.description)}</div>
          </Row>
        )}
        {ev.reminders?.length > 0 && (
          <Row icon={Bell}>{ev.reminders.map((r) => reminderLabel(r.minutes)).join(", ")}</Row>
        )}
        <Row icon={CalendarDays}>
          <span>{occ.calendar?.name ?? "Calendar"}</span>
          {source && <span className={cn("ml-2 text-xs text-fg-3")}>· {source}</span>}
        </Row>
        {(ev.contact_id || ev.deal_id) && occ.start < new Date() && (
          <div className="mt-2 pl-9">
            <button onClick={onMarkShowed} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-hover cursor-pointer">
              <CheckCircle2 className="size-4 text-success" /> Mark showed
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
