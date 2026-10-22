"use client";
import { Time } from "@/components/ui/time";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  StickyNote, Mail, MessageSquare, Phone, CalendarDays, CheckSquare, ArrowRightLeft, FileSignature, Receipt,
  Banknote, Info, Sparkles, FileInput, Trash2, History, type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { addNote, deleteActivity } from "@/lib/actions/crm";
import { cn, fmtDateTime, timeAgo } from "@/lib/utils";
import type { Activity, ActivityType } from "@/lib/types";

export type TimelineActivity = Activity & { actor?: { full_name: string | null; avatar_url?: string | null } | null };

const ICONS: Record<ActivityType, LucideIcon> = {
  note: StickyNote, email: Mail, sms: MessageSquare, call: Phone, meeting: CalendarDays, task: CheckSquare,
  stage_change: ArrowRightLeft, contract: FileSignature, invoice: Receipt, payment: Banknote, system: Info, ai: Sparkles, form: FileInput,
};

const TINT: Partial<Record<ActivityType, string>> = {
  payment: "text-success", contract: "text-[#7b49e8]", ai: "text-accent", stage_change: "text-warning",
};

export function Timeline({ activities, target, currentUserId }: {
  activities: TimelineActivity[];
  target: { contact_id?: string | null; deal_id?: string | null; company_id?: string | null; client_id?: string | null };
  currentUserId: string;
}) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "notes" | "comms" | "system">("all");
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());

  const save = async () => {
    setSaving(true);
    const r = await addNote(target, note);
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    setNote("");
    toast.success("Note added");
    router.refresh();
  };

  const remove = async (id: string) => {
    const r = await deleteActivity(id);
    if (!r.ok) return toast.error(r.error);
    setHidden((h) => new Set(h).add(id));
  };

  const shown = activities.filter((a) => {
    if (hidden.has(a.id)) return false;
    if (filter === "notes") return a.type === "note";
    if (filter === "comms") return ["email", "sms", "call", "meeting"].includes(a.type);
    if (filter === "system") return !["note", "email", "sms", "call", "meeting"].includes(a.type);
    return true;
  });

  // group by month
  const groups = new Map<string, TimelineActivity[]>();
  for (const a of shown) {
    const k = new Date(a.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border border-border bg-bg focus-within:border-accent">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note… (⌘↵ to save)"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && note.trim()) save(); }}
          className="min-h-16 border-0 focus:ring-0" />
        <div className="flex items-center justify-between border-t border-border-light px-2 py-1.5">
          <div className="flex gap-1">
            {(["all", "notes", "comms", "system"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("h-6 rounded-sm px-1.5 text-xs capitalize cursor-pointer", filter === f ? "bg-active text-fg" : "text-fg-3 hover:bg-hover")}>
                {f}
              </button>
            ))}
          </div>
          <Button size="xs" variant="primary" icon={StickyNote} onClick={save} loading={saving} disabled={!note.trim()}>Add note</Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" description="Notes, messages, calls, stage changes and payments will appear here." />
      ) : (
        [...groups.entries()].map(([month, items]) => (
          <div key={month}>
            <div className="mb-2 text-xs font-medium text-fg-3">{month}</div>
            <ol className="relative space-y-0">
              {items.map((a, i) => {
                const Icon = ICONS[a.type] ?? Info;
                return (
                  <li key={a.id} className="group relative flex gap-3 pb-4">
                    {i < items.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}
                    <span className="relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg">
                      <Icon className={cn("size-3.5 text-fg-3", TINT[a.type])} />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-center gap-1.5 text-[13px]">
                        {a.actor?.full_name && <><Avatar name={a.actor.full_name} src={a.actor.avatar_url} size={14} /><span className="font-medium">{a.actor.full_name}</span></>}
                        <span className={cn("truncate", a.actor?.full_name ? "text-fg-2" : "text-fg")}>{a.type === "note" ? "added a note" : a.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-fg-4"><Time value={a.created_at} /></span>
                        {(a.type === "note" && a.actor_id === currentUserId) && (
                          <button onClick={() => remove(a.id)} aria-label="Delete note" className="hidden rounded-sm p-0.5 text-fg-4 hover:text-danger group-hover:block cursor-pointer">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                      {a.body && (
                        <div className={cn("mt-1 text-[13px] text-fg-2", a.type === "note" && "rounded-md border border-border-light bg-bg-2 px-3 py-2 text-fg")}>
                          {a.type === "note" || a.type === "ai"
                            ? <div className="prose-sm max-w-none [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4"><ReactMarkdown>{a.body}</ReactMarkdown></div>
                            : <p className="line-clamp-3 whitespace-pre-wrap">{a.body}</p>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
    </div>
  );
}
