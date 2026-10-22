"use client";
import { Time } from "@/components/ui/time";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isTomorrow } from "date-fns";
import { Card } from "@/components/ui/misc";
import { Checkbox } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface TodayTask { id: string; title: string; due_at: string | null; priority: string; contact_id: string | null; contact_name?: string | null }
export interface UpcomingEvent { id: string; title: string; start_at: string; end_at: string; all_day: boolean; color: string | null; meeting_url: string | null }

export function TodayTasks({ tasks }: { tasks: TodayTask[] }) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());
  const complete = async (id: string) => {
    setDone((s) => new Set(s).add(id));
    const { error } = await createClient().from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); setDone((s) => { const n = new Set(s); n.delete(id); return n; }); return; }
    toast.success("Task completed");
    router.refresh();
  };
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><CheckSquare className="size-4 text-fg-3" />My tasks due today</span>}
      actions={<Link href="/tasks?new=1"><Button size="xs" variant="ghost" icon={Plus}>Add</Button></Link>} padded={false}>
      {tasks.length === 0 ? <p className="p-3 text-[13px] text-fg-3">Nothing due. Nice.</p> : (
        <ul className="divide-y divide-border-light">
          {tasks.map((t) => {
            const overdue = t.due_at && new Date(t.due_at) < new Date() && !isToday(new Date(t.due_at));
            return (
              <li key={t.id} className={cn("flex items-center gap-2 px-3 py-2", done.has(t.id) && "opacity-40 line-through")}>
                <Checkbox checked={done.has(t.id)} onChange={() => complete(t.id)} aria-label="Complete task" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{t.title}</div>
                  <div className="text-xs text-fg-3">
                    {t.due_at && <span className={overdue ? "text-danger" : ""}>{overdue ? "Overdue · " : ""}<Time value={t.due_at} format="datetime" title={false} /></span>}
                    {t.contact_id && t.contact_name && <> · <Link className="hover:underline" href={`/contacts/${t.contact_id}`}>{t.contact_name}</Link></>}
                  </div>
                </div>
                <StatusTag status={t.priority} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function UpcomingEvents({ events }: { events: UpcomingEvent[] }) {
  // times are formatted in the viewer's timezone, so only after mount (server renders in UTC)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const day = (d: Date) => (isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "EEE, MMM d"));
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4 text-fg-3" />Upcoming</span>}
      actions={<Link href="/calendar"><Button size="xs" variant="ghost">Calendar</Button></Link>} padded={false}>
      {events.length === 0 ? <p className="p-3 text-[13px] text-fg-3">No events in the next 7 days.</p> : (
        <ul className="divide-y divide-border-light">
          {events.map((e) => {
            const s = new Date(e.start_at);
            return (
              <li key={e.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: e.color || "var(--accent)" }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{e.title}</div>
                  <div className="text-xs text-fg-3" suppressHydrationWarning>{!mounted ? "\u00a0" : <>{day(s)} · {e.all_day ? "All day" : `${format(s, "h:mm a")} – ${format(new Date(e.end_at), "h:mm a")}`}</>}</div>
                </div>
                {e.meeting_url && <a href={e.meeting_url} target="_blank" rel="noreferrer"><Button size="xs">Join</Button></a>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
