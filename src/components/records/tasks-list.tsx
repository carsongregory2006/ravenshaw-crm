"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { isBefore, isToday, startOfDay, format } from "date-fns";
import { CheckSquare, MoreHorizontal, Pencil, Plus, Trash2, User, Target, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveTask, setTaskCompleted, deleteTask } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { ContactPicker, UserPicker } from "./pickers";
import { useProfile } from "@/components/shell/profile-context";
import { cn, contactLabel, fmtDateTime } from "@/lib/utils";
import type { Task } from "@/lib/types";

export type TaskRow = Task & {
  contact?: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
  deal?: { id: string; name: string; deal_number: string } | null;
  assignee?: { full_name: string | null; avatar_url: string | null } | null;
};

export interface TasksFilter { contact_id?: string; deal_id?: string; client_id?: string }

export function TasksList({ filter, scope: initialScope, showScopeToggle, autoOpenNew, compact }: {
  filter?: TasksFilter; scope?: "mine" | "all"; showScopeToggle?: boolean; autoOpenNew?: boolean; compact?: boolean;
}) {
  const profile = useProfile();
  const [tasks, setTasks] = React.useState<TaskRow[] | null>(null);
  const [scope, setScope] = React.useState<"mine" | "all">(initialScope ?? (filter ? "all" : "mine"));
  const [editing, setEditing] = React.useState<Partial<Task> | null>(autoOpenNew ? {} : null);
  const filterKey = JSON.stringify(filter ?? {});

  const load = React.useCallback(async () => {
    let q = createClient().from("tasks")
      .select("*, contact:contacts(id, first_name, last_name, email), deal:deals(id, name, deal_number), assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url)")
      .order("due_at", { ascending: true, nullsFirst: false }).limit(500);
    const f = JSON.parse(filterKey) as TasksFilter;
    if (f.contact_id) q = q.eq("contact_id", f.contact_id);
    if (f.deal_id) q = q.eq("deal_id", f.deal_id);
    if (f.client_id) q = q.eq("client_id", f.client_id);
    if (scope === "mine") q = q.eq("assignee_id", profile.id);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setTasks((data as TaskRow[]) ?? []);
  }, [filterKey, scope, profile.id]);

  React.useEffect(() => { load(); }, [load]);

  const toggle = async (t: TaskRow) => {
    const done = !t.completed_at;
    setTasks((xs) => xs?.map((x) => (x.id === t.id ? { ...x, completed_at: done ? new Date().toISOString() : null } : x)) ?? null);
    const r = await setTaskCompleted(t.id, done);
    if (!r.ok) { toast.error(r.error); load(); }
  };
  const remove = async (t: TaskRow) => {
    const r = await deleteTask(t.id);
    if (!r.ok) return toast.error(r.error);
    toast.success("Task deleted");
    load();
  };

  const groups = React.useMemo(() => {
    const today = startOfDay(new Date());
    const g: Record<string, TaskRow[]> = { Overdue: [], Today: [], Upcoming: [], "No due date": [], Completed: [] };
    for (const t of tasks ?? []) {
      if (t.completed_at) g.Completed.push(t);
      else if (!t.due_at) g["No due date"].push(t);
      else if (isToday(new Date(t.due_at))) g.Today.push(t);
      else if (isBefore(new Date(t.due_at), today)) g.Overdue.push(t);
      else g.Upcoming.push(t);
    }
    g.Completed.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return g;
  }, [tasks]);

  return (
    <div className={cn(!compact && "p-4")}>
      <div className="mb-3 flex items-center gap-2">
        {showScopeToggle && (
          <div className="flex rounded-md border border-border p-0.5">
            {(["mine", "all"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={cn("h-6 rounded-sm px-2 text-xs cursor-pointer", scope === s ? "bg-active text-fg font-medium" : "text-fg-3 hover:text-fg")}>
                {s === "mine" ? "My tasks" : "All tasks"}
              </button>
            ))}
          </div>
        )}
        <Button size="sm" variant={compact ? "secondary" : "primary"} icon={Plus} className="ml-auto" onClick={() => setEditing({ ...filter })}>New task</Button>
      </div>
      {tasks === null ? <div className="flex justify-center py-8"><Spinner /></div> :
        tasks.length === 0 ? (
          <EmptyState icon={CheckSquare} title="No tasks" description="Create follow-ups and to-dos so nothing slips." />
        ) : (
          <div className="space-y-4">
            {Object.entries(groups).filter(([, xs]) => xs.length).map(([label, xs]) => (
              <div key={label}>
                <div className={cn("mb-1 flex items-center gap-1.5 text-xs font-medium", label === "Overdue" ? "text-danger" : "text-fg-3")}>
                  {label} <span className="text-fg-4">{xs.length}</span>
                </div>
                <ul className="divide-y divide-border-light rounded-lg border border-border">
                  {xs.map((t) => (
                    <li key={t.id} className="group flex items-center gap-2.5 px-3 py-2 hover:bg-hover">
                      <Checkbox checked={!!t.completed_at} onChange={() => toggle(t)} aria-label="Complete task" />
                      <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => setEditing(t)}>
                        <div className={cn("truncate text-[13px]", t.completed_at && "text-fg-3 line-through")}>{t.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-3">
                          {t.due_at && <span className={cn("inline-flex items-center gap-1", !t.completed_at && isBefore(new Date(t.due_at), new Date()) && "text-danger")}><CalendarClock className="size-3" />{fmtDateTime(t.due_at)}</span>}
                          {t.contact && !filter?.contact_id && <Link onClick={(e) => e.stopPropagation()} href={`/contacts/${t.contact.id}`} className="inline-flex items-center gap-1 hover:text-fg"><User className="size-3" />{contactLabel(t.contact)}</Link>}
                          {t.deal && !filter?.deal_id && <Link onClick={(e) => e.stopPropagation()} href={`/deals/${t.deal.id}`} className="inline-flex items-center gap-1 hover:text-fg"><Target className="size-3" />{t.deal.deal_number}</Link>}
                        </div>
                      </button>
                      {t.priority !== "medium" && <StatusTag status={t.priority} />}
                      {t.assignee && <Avatar name={t.assignee.full_name} src={t.assignee.avatar_url} size={18} />}
                      <Menu>
                        <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Task actions" /></MenuTrigger>
                        <MenuContent align="end" width={140}>
                          <MenuItem icon={Pencil} onSelect={() => setEditing(t)}>Edit</MenuItem>
                          <MenuItem icon={Trash2} danger onSelect={() => remove(t)}>Delete</MenuItem>
                        </MenuContent>
                      </Menu>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      {editing && <TaskDialog task={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

export function TaskDialog({ task, onClose, onSaved }: { task: Partial<Task>; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = React.useState<Partial<Task>>(task);
  const [saving, setSaving] = React.useState(false);
  const toLocal = (iso?: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const r = await saveTask({
      id: t.id, title: t.title ?? "", description: t.description ?? null, due_at: t.due_at ?? null, priority: t.priority ?? "medium",
      assignee_id: t.assignee_id ?? undefined, contact_id: t.contact_id ?? null, deal_id: t.deal_id ?? null, client_id: t.client_id ?? null,
    });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(t.id ? "Task updated" : "Task created");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.id ? "Edit task" : "New task"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="task-form" loading={saving}>Save</Button></>}>
      <form id="task-form" onSubmit={submit} className="space-y-3 pb-2">
        <Field label="Title"><Input autoFocus required value={t.title ?? ""} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="Follow up about proposal" /></Field>
        <Field label="Description"><Textarea value={t.description ?? ""} onChange={(e) => setT({ ...t, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due"><Input type="datetime-local" value={toLocal(t.due_at)} onChange={(e) => setT({ ...t, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
          <Field label="Priority">
            <Select value={t.priority ?? "medium"} onChange={(e) => setT({ ...t, priority: e.target.value as Task["priority"] })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Assignee"><UserPicker value={t.assignee_id} onChange={(id) => setT({ ...t, assignee_id: id })} placeholder="Me" /></Field>
          <Field label="Person"><ContactPicker value={t.contact_id} onChange={(id) => setT({ ...t, contact_id: id })} /></Field>
        </div>
      </form>
    </Dialog>
  );
}
