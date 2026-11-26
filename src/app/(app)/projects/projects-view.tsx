"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, FolderKanban, Plus, Trash2 } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  addProjectTaskAction, createProjectAction, deleteProjectAction, deleteProjectTaskAction, updateProjectAction, updateProjectTaskAction,
} from "@/lib/actions/workspace";
import { cn } from "@/lib/utils";

type ProjectRow = { id: string; name: string; description: string | null; status: string; due_date: string | null; updated_at: string; tasks: { todo: number; doing: number; done: number } };
type Task = { id: string; project_id: string; title: string; notes: string | null; status: "todo" | "doing" | "done"; due_date: string | null; position: number };

const STATUS: Record<string, { label: string; color: "gray" | "purple" | "green" | "orange" }> = {
  idea: { label: "Idea", color: "gray" }, building: { label: "Building", color: "purple" }, live: { label: "Live", color: "green" }, paused: { label: "Paused", color: "orange" },
};
const COLS: { id: Task["status"]; label: string }[] = [{ id: "todo", label: "To do" }, { id: "doing", label: "Doing" }, { id: "done", label: "Done" }];

export function ProjectsView({ projects, openId }: { projects: ProjectRow[]; openId: string | null }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const open = projects.find((p) => p.id === openId) ?? null;
  if (open) return <ProjectBoard project={open} onBack={() => router.push("/projects")} onChanged={() => router.refresh()} />;
  const shown = filter ? projects.filter((p) => p.status === filter) : projects;
  return (
    <Page>
      <PageHeader icon={FolderKanban} title="Projects" actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>New project</Button>}>
        <div className="ml-2 flex items-center gap-0.5">
          {[["", "All"], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("h-6 rounded-md px-2 text-xs cursor-pointer", filter === k ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>{label}</button>
          ))}
        </div>
      </PageHeader>
      <PageBody>
        {!projects.length ? (
          <EmptyState icon={FolderKanban} title="No projects yet" description="Track everything you're building: each project gets its own task board."
            action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New project</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => {
              const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
              const pct = total ? Math.round((p.tasks.done / total) * 100) : 0;
              const s = STATUS[p.status] ?? STATUS.idea;
              return (
                <button key={p.id} onClick={() => router.push(`/projects?p=${p.id}`)} className="rounded-lg border border-border p-4 text-left hover:border-fg-4 hover:bg-hover cursor-pointer">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.name}</span>
                    <Tag color={s.color}>{s.label}</Tag>
                  </div>
                  {p.description && <p className="mt-1 line-clamp-2 text-[13px] text-fg-3">{p.description}</p>}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-2"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-1.5 flex text-[11px] text-fg-4">
                    <span>{p.tasks.done}/{total} tasks done{p.tasks.doing ? ` · ${p.tasks.doing} in progress` : ""}</span>
                    {p.due_date && <span className="ml-auto">Due {p.due_date}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PageBody>
      <ProjectDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); router.push(`/projects?p=${id}`); router.refresh(); }} />
    </Page>
  );
}

function ProjectDialog({ open, onClose, onSaved, project }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; project?: ProjectRow }) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState("building");
  const [due, setDue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setName(project?.name ?? ""); setDescription(project?.description ?? ""); setStatus(project?.status ?? "building"); setDue(project?.due_date ?? "");
  }, [open, project]);
  const save = async () => {
    setBusy(true);
    const input = { name, description, status, due_date: due || null };
    const r = project ? await updateProjectAction(project.id, input).then((x) => (x.ok ? { ok: true as const, data: { id: project.id } } : x)) : await createProjectAction(input);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    onSaved(r.data.id);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={project ? "Edit project" : "New project"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>{project ? "Save" : "Create"}</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravenshaw CRM, AI receptionist, Landing page" /></Field>
        <Field label="What is it?"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}

function ProjectBoard({ project, onBack, onChanged }: { project: ProjectRow; onBack: () => void; onChanged: () => void }) {
  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [adding, setAdding] = React.useState<Record<string, string>>({});
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [editProject, setEditProject] = React.useState(false);
  const load = React.useCallback(async () => {
    const { data } = await createClient().from("project_tasks").select("*").eq("project_id", project.id).order("position").order("created_at");
    setTasks((data as Task[]) ?? []);
  }, [project.id]);
  React.useEffect(() => { load(); }, [load]);

  const add = async (status: Task["status"]) => {
    const title = adding[status]?.trim();
    if (!title) return;
    const r = await addProjectTaskAction(project.id, { title, status });
    if (!r.ok) return toast.error(r.error);
    setAdding((a) => ({ ...a, [status]: "" }));
    load(); onChanged();
  };
  const moveTo = async (t: Task, status: Task["status"]) => {
    setTasks((ts) => ts && ts.map((x) => (x.id === t.id ? { ...x, status } : x)));
    const r = await updateProjectTaskAction(t.id, { status });
    if (!r.ok) { toast.error(r.error); load(); }
    onChanged();
  };
  const s = STATUS[project.status] ?? STATUS.idea;
  return (
    <Page>
      <PageHeader icon={FolderKanban} title={<span className="flex items-center gap-2"><button onClick={onBack} className="text-fg-3 hover:text-fg cursor-pointer"><ArrowLeft className="size-4" /></button>{project.name}<Tag color={s.color}>{s.label}</Tag></span>}
        actions={<>
          <Select value={project.status} className="h-7 w-auto text-xs" onChange={async (e) => { const r = await updateProjectAction(project.id, { status: e.target.value }); if (!r.ok) return toast.error(r.error); onChanged(); }}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setEditProject(true)}>Edit</Button>
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete project" onClick={async () => {
            if (!confirm(`Delete "${project.name}" and all its tasks?`)) return;
            const r = await deleteProjectAction(project.id); if (!r.ok) return toast.error(r.error); onBack(); onChanged();
          }} />
        </>} />
      <PageBody>
        {project.description && <p className="mb-3 max-w-3xl whitespace-pre-wrap text-[13px] text-fg-2">{project.description}</p>}
        {!tasks ? <div className="flex justify-center py-10"><Spinner /></div> : (
          <div className="grid gap-3 md:grid-cols-3">
            {COLS.map((col, ci) => {
              const list = tasks.filter((t) => t.status === col.id);
              return (
                <Card key={col.id} title={`${col.label} · ${list.length}`} padded={false} className="bg-bg-2/40">
                  <div className="space-y-2 p-2">
                    {list.map((t) => (
                      <div key={t.id} className="group rounded-md border border-border bg-bg p-2.5 text-[13px] shadow-xs">
                        <button onClick={() => setEditing(t)} className={cn("w-full text-left hover:underline cursor-pointer", t.status === "done" && "text-fg-3 line-through")}>{t.title}</button>
                        {t.notes && <p className="mt-1 line-clamp-2 text-xs text-fg-3">{t.notes}</p>}
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-fg-4">
                          {t.due_date && <span>Due {t.due_date}</span>}
                          <span className="ml-auto flex">
                            {ci > 0 && <Button size="xs" variant="ghost" icon={ChevronLeft} aria-label={`Move to ${COLS[ci - 1].label}`} onClick={() => moveTo(t, COLS[ci - 1].id)} />}
                            {ci < COLS.length - 1 && <Button size="xs" variant="ghost" icon={ChevronRight} aria-label={`Move to ${COLS[ci + 1].label}`} onClick={() => moveTo(t, COLS[ci + 1].id)} />}
                          </span>
                        </div>
                      </div>
                    ))}
                    <form onSubmit={(e) => { e.preventDefault(); add(col.id); }} className="flex gap-1">
                      <Input value={adding[col.id] ?? ""} onChange={(e) => setAdding((a) => ({ ...a, [col.id]: e.target.value }))} placeholder="Add a task…" className="h-7 text-xs" />
                      <Button size="sm" type="submit" icon={Plus} aria-label="Add task" disabled={!adding[col.id]?.trim()} />
                    </form>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
      <ProjectDialog open={editProject} project={project} onClose={() => setEditProject(false)} onSaved={() => { setEditProject(false); onChanged(); }} />
      {editing && <TaskDialog task={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); onChanged(); }} />}
    </Page>
  );
}

function TaskDialog({ task, onClose, onSaved }: { task: Task; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = React.useState(task.title);
  const [notes, setNotes] = React.useState(task.notes ?? "");
  const [status, setStatus] = React.useState<string>(task.status);
  const [due, setDue] = React.useState(task.due_date ?? "");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Task"
      footer={<>
        <Button variant="ghost" icon={Trash2} className="mr-auto" onClick={async () => { const r = await deleteProjectTaskAction(task.id); if (!r.ok) return toast.error(r.error); onSaved(); }}>Delete</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={async () => {
          setBusy(true);
          const r = await updateProjectTaskAction(task.id, { title, notes, status, due_date: due || null });
          setBusy(false);
          if (!r.ok) return toast.error(r.error);
          onSaved();
        }}>Save</Button>
      </>}>
      <div className="space-y-3">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Column"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
