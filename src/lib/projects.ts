import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PROJECT_STATUSES = ["idea", "building", "live", "paused"] as const;
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

const clean = (s: unknown, max = 500) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function listProjects(db: SupabaseClient, opts: { status?: string } = {}) {
  let q = db.from("projects").select("id, name, description, status, due_date, position, created_at, updated_at").order("position").order("created_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  const { data: projects, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (projects ?? []).map((p) => p.id);
  const counts = new Map<string, { todo: number; doing: number; done: number }>();
  if (ids.length) {
    const { data: tasks } = await db.from("project_tasks").select("project_id, status").in("project_id", ids);
    for (const t of tasks ?? []) {
      const c = counts.get(t.project_id) ?? { todo: 0, doing: 0, done: 0 };
      c[t.status as TaskStatus]++;
      counts.set(t.project_id, c);
    }
  }
  return (projects ?? []).map((p) => ({ ...p, tasks: counts.get(p.id) ?? { todo: 0, doing: 0, done: 0 } }));
}

export async function getProject(db: SupabaseClient, id: string) {
  const [{ data: project }, { data: tasks }] = await Promise.all([
    db.from("projects").select("*").eq("id", id).maybeSingle(),
    db.from("project_tasks").select("*").eq("project_id", id).order("position").order("created_at"),
  ]);
  if (!project) throw new Error("Project not found");
  return { project, tasks: tasks ?? [] };
}

export async function createProject(db: SupabaseClient, input: { name: string; description?: string | null; status?: string; due_date?: string | null; created_by?: string | null }) {
  const name = clean(input.name, 120);
  if (!name) throw new Error("Give the project a name");
  const status = PROJECT_STATUSES.includes(input.status as ProjectStatus) ? input.status : "building";
  const { data, error } = await db.from("projects").insert({ name, description: clean(input.description, 4000) || null, status, due_date: day(input.due_date), created_by: input.created_by ?? null }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateProject(db: SupabaseClient, id: string, patch: { name?: string; description?: string | null; status?: string; due_date?: string | null }) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) { const n = clean(patch.name, 120); if (!n) throw new Error("Name can't be empty"); row.name = n; }
  if (patch.description !== undefined) row.description = clean(patch.description, 4000) || null;
  if (patch.status !== undefined) { if (!PROJECT_STATUSES.includes(patch.status as ProjectStatus)) throw new Error(`Status must be one of ${PROJECT_STATUSES.join(", ")}`); row.status = patch.status; }
  if (patch.due_date !== undefined) row.due_date = day(patch.due_date);
  const { data, error } = await db.from("projects").update(row).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found");
  return data;
}

export async function addProjectTask(db: SupabaseClient, projectId: string, input: { title: string; notes?: string | null; status?: string; due_date?: string | null }) {
  const title = clean(input.title, 300);
  if (!title) throw new Error("Give the task a title");
  const status = TASK_STATUSES.includes(input.status as TaskStatus) ? (input.status as TaskStatus) : "todo";
  const { data: last } = await db.from("project_tasks").select("position").eq("project_id", projectId).eq("status", status).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("project_tasks").insert({
    project_id: projectId, title, notes: clean(input.notes, 4000) || null, status, due_date: day(input.due_date),
    position: (last?.position ?? -1) + 1, completed_at: status === "done" ? new Date().toISOString() : null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  await db.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId);
  return data;
}

export async function updateProjectTask(db: SupabaseClient, id: string, patch: { title?: string; notes?: string | null; status?: string; due_date?: string | null; position?: number }) {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) { const t = clean(patch.title, 300); if (!t) throw new Error("Title can't be empty"); row.title = t; }
  if (patch.notes !== undefined) row.notes = clean(patch.notes, 4000) || null;
  if (patch.due_date !== undefined) row.due_date = day(patch.due_date);
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.status !== undefined) {
    if (!TASK_STATUSES.includes(patch.status as TaskStatus)) throw new Error(`Status must be one of ${TASK_STATUSES.join(", ")}`);
    row.status = patch.status;
    row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  const { data, error } = await db.from("project_tasks").update(row).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Task not found");
  await db.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", data.project_id);
  return data;
}
