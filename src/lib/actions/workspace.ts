"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safe } from "@/lib/actions/util";
import { getProfile } from "@/lib/auth";
import { toE164 } from "@/lib/utils";
import { getDaily, setDailyCheck, dailyHistory, getReminderSettings } from "@/lib/daily";
import { addProjectTask, createProject, updateProject, updateProjectTask } from "@/lib/projects";

async function staff() {
  const p = await getProfile();
  if (!p) throw new Error("Not signed in");
  if (p.role !== "admin" && p.role !== "ops") throw new Error("Only admins and ops can use this");
  return p;
}

// ───────────── Daily inputs ─────────────

export async function loadDailyAction() {
  return safe(async () => {
    await staff();
    const db = await createClient();
    const [today, history, reminders] = await Promise.all([getDaily(db), dailyHistory(db, 14), getReminderSettings(db)]);
    return { ...today, history, reminders };
  });
}

export async function toggleDailyAction(itemId: string, done: boolean) {
  return safe(async () => {
    await staff();
    await setDailyCheck(await createClient(), itemId, done);
    return null;
  });
}

export async function addDailyItemAction(title: string) {
  return safe(async () => {
    await staff();
    const t = title.trim().slice(0, 200);
    if (!t) throw new Error("Type something to add");
    const db = await createClient();
    const { data: last } = await db.from("daily_items").select("position").eq("active", true).order("position", { ascending: false }).limit(1).maybeSingle();
    const { error } = await db.from("daily_items").insert({ title: t, position: (last?.position ?? -1) + 1 });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function updateDailyItemAction(id: string, patch: { title?: string; position?: number }) {
  return safe(async () => {
    await staff();
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) { const t = patch.title.trim().slice(0, 200); if (!t) throw new Error("Can't be empty"); row.title = t; }
    if (patch.position !== undefined) row.position = patch.position;
    const { error } = await (await createClient()).from("daily_items").update(row).eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

/** Removing hides the item (keeps its past check-offs for history). */
export async function removeDailyItemAction(id: string) {
  return safe(async () => {
    await staff();
    const { error } = await (await createClient()).from("daily_items").update({ active: false }).eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function saveDailyRemindersAction(input: { enabled: boolean; phone: string }) {
  return safe(async () => {
    await staff();
    const phone = input.phone.trim() ? toE164(input.phone) : null;
    if (input.phone.trim() && (!phone || phone.replace(/\D/g, "").length < 10)) throw new Error("That phone number doesn't look right");
    const { error } = await (await createClient()).from("app_kv").upsert({ key: "daily_reminders", value: { enabled: input.enabled, phone }, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return null;
  });
}

// ───────────── Projects ─────────────

export async function createProjectAction(input: { name: string; description?: string; status?: string; due_date?: string | null }) {
  return safe(async () => {
    const p = await staff();
    const data = await createProject(await createClient(), { ...input, created_by: p.id });
    revalidatePath("/projects");
    return { id: data.id as string };
  });
}

export async function updateProjectAction(id: string, patch: { name?: string; description?: string | null; status?: string; due_date?: string | null }) {
  return safe(async () => {
    await staff();
    await updateProject(await createClient(), id, patch);
    revalidatePath("/projects");
    return null;
  });
}

export async function deleteProjectAction(id: string) {
  return safe(async () => {
    await staff();
    const { error } = await (await createClient()).from("projects").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/projects");
    return null;
  });
}

export async function addProjectTaskAction(projectId: string, input: { title: string; status?: string; due_date?: string | null; notes?: string | null }) {
  return safe(async () => {
    await staff();
    return await addProjectTask(await createClient(), projectId, input);
  });
}

export async function updateProjectTaskAction(id: string, patch: { title?: string; notes?: string | null; status?: string; due_date?: string | null; position?: number }) {
  return safe(async () => {
    await staff();
    return await updateProjectTask(await createClient(), id, patch);
  });
}

export async function deleteProjectTaskAction(id: string) {
  return safe(async () => {
    await staff();
    const { error } = await (await createClient()).from("project_tasks").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

// ───────────── Grok / AI connector (MCP) ─────────────

export async function rotateConnectorKeyAction() {
  return safe(async () => {
    const p = await getProfile();
    if (p?.role !== "admin") throw new Error("Only admins can manage the AI connector");
    const { rotateConnectorKey } = await import("@/lib/mcp/server");
    return { key: await rotateConnectorKey(p.id) };
  });
}

export async function revokeConnectorKeyAction() {
  return safe(async () => {
    const p = await getProfile();
    if (p?.role !== "admin") throw new Error("Only admins can manage the AI connector");
    const { revokeConnectorKey } = await import("@/lib/mcp/server");
    await revokeConnectorKey();
    revalidatePath("/settings");
    return null;
  });
}
