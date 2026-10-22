"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safe } from "@/lib/actions/util";
import { emitEvent } from "@/lib/events";
import { getProfile } from "@/lib/auth";
import { toE164 } from "@/lib/utils";
import type { Contact, Company, Deal, DealLineItem, Task } from "@/lib/types";

async function me() {
  const p = await getProfile();
  if (!p) throw new Error("Not signed in");
  return p;
}

const isStaffRole = (r: string) => r === "admin" || r === "ops";

// ───────────── Contacts ─────────────

export type ContactInput = Partial<Omit<Contact, "id" | "created_at" | "updated_at">>;

function cleanContact(input: ContactInput): ContactInput {
  const out: ContactInput = { ...input };
  if (out.email !== undefined) out.email = out.email?.trim().toLowerCase() || null;
  if (out.phone !== undefined) out.phone = out.phone ? toE164(out.phone) : null;
  for (const k of ["first_name", "last_name", "title", "source"] as const) {
    if (out[k] !== undefined) out[k] = (out[k] as string | null)?.trim() || null;
  }
  return out;
}

export async function createContact(input: ContactInput) {
  return safe(async () => {
    const profile = await me();
    const supabase = await createClient();
    const row = cleanContact(input);
    if (!row.first_name && !row.last_name && !row.email && !row.phone) throw new Error("Add at least a name, email or phone");
    row.owner_id = isStaffRole(profile.role) ? row.owner_id ?? profile.id : profile.id;
    row.source = row.source || "manual";
    const { data, error } = await supabase.from("contacts").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    await supabase.from("activities").insert({ type: "system", contact_id: data.id, title: "Contact created", actor_id: profile.id });
    await emitEvent({ type: "lead_created", contactId: data.id, data: { source: row.source } });
    for (const tag of row.tags ?? []) await emitEvent({ type: "tag_added", contactId: data.id, data: { tag } });
    revalidatePath("/contacts");
    return { id: data.id as string };
  });
}

export async function updateContact(id: string, patch: ContactInput) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const row = cleanContact(patch);
    let newTags: string[] = [];
    if (row.tags) {
      const { data: cur } = await supabase.from("contacts").select("tags").eq("id", id).single();
      const before = new Set<string>(cur?.tags ?? []);
      row.tags = [...new Set(row.tags.map((t) => t.trim()).filter(Boolean))];
      newTags = row.tags.filter((t) => !before.has(t));
    }
    const { error } = await supabase.from("contacts").update(row).eq("id", id);
    if (error) throw new Error(error.message);
    for (const tag of newTags) await emitEvent({ type: "tag_added", contactId: id, data: { tag } });
    revalidatePath(`/contacts/${id}`);
    revalidatePath("/contacts");
    return null;
  });
}

export async function bulkUpdateContacts(ids: string[], patch: Pick<ContactInput, "owner_id" | "status">) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("contacts").update(patch).in("id", ids);
    if (error) throw new Error(error.message);
    revalidatePath("/contacts");
    return null;
  });
}

export async function addTagToContacts(ids: string[], tag: string) {
  return safe(async () => {
    await me();
    const t = tag.trim();
    if (!t) throw new Error("Tag is empty");
    const supabase = await createClient();
    const { data: rows } = await supabase.from("contacts").select("id, tags").in("id", ids);
    for (const r of rows ?? []) {
      if ((r.tags ?? []).includes(t)) continue;
      await supabase.from("contacts").update({ tags: [...(r.tags ?? []), t] }).eq("id", r.id);
      await emitEvent({ type: "tag_added", contactId: r.id, data: { tag: t } });
    }
    revalidatePath("/contacts");
    return null;
  });
}

export async function deleteContacts(ids: string[]) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error, count } = await supabase.from("contacts").delete({ count: "exact" }).in("id", ids);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("You don't have permission to delete these records");
    revalidatePath("/contacts");
    return { deleted: count };
  });
}

export interface ImportRow {
  first_name?: string; last_name?: string; full_name?: string; email?: string; phone?: string;
  title?: string; company?: string; source?: string; tags?: string; status?: string;
}

export async function importContacts(rows: ImportRow[], opts: { triggerAutomations: boolean; ownerId?: string | null; source?: string }) {
  return safe(async () => {
    const profile = await me();
    const supabase = await createClient();
    // company lookup / creation by name
    const companyNames = [...new Set(rows.map((r) => r.company?.trim()).filter(Boolean) as string[])];
    const companyIds = new Map<string, string>();
    if (companyNames.length) {
      const { data: existing } = await supabase.from("companies").select("id, name").in("name", companyNames);
      for (const c of existing ?? []) companyIds.set(c.name.toLowerCase(), c.id);
      const missing = companyNames.filter((n) => !companyIds.has(n.toLowerCase()));
      if (missing.length) {
        const { data: created } = await supabase.from("companies").insert(missing.map((name) => ({ name, owner_id: profile.id }))).select("id, name");
        for (const c of created ?? []) companyIds.set(c.name.toLowerCase(), c.id);
      }
    }
    // skip emails that already exist
    const emails = rows.map((r) => r.email?.trim().toLowerCase()).filter(Boolean) as string[];
    const existingEmails = new Set<string>();
    for (let i = 0; i < emails.length; i += 200) {
      const { data } = await supabase.from("contacts").select("email").in("email", emails.slice(i, i + 200));
      for (const d of data ?? []) if (d.email) existingEmails.add(d.email.toLowerCase());
    }
    const statuses = ["lead", "prospect", "client", "churned", "unqualified"];
    const ownerId = opts.ownerId && isStaffRole(profile.role) ? opts.ownerId : profile.id;
    const toInsert: ContactInput[] = [];
    let skipped = 0;
    for (const r of rows) {
      let first = r.first_name?.trim() || null;
      let last = r.last_name?.trim() || null;
      if (!first && !last && r.full_name) {
        const parts = r.full_name.trim().split(/\s+/);
        first = parts.shift() || null;
        last = parts.join(" ") || null;
      }
      const email = r.email?.trim().toLowerCase() || null;
      if (!first && !last && !email && !r.phone) { skipped++; continue; }
      if (email && existingEmails.has(email)) { skipped++; continue; }
      if (email) existingEmails.add(email);
      const status = (r.status?.trim().toLowerCase() ?? "") as Contact["status"];
      toInsert.push(cleanContact({
        first_name: first, last_name: last, email, phone: r.phone || null, title: r.title || null,
        company_id: r.company ? companyIds.get(r.company.trim().toLowerCase()) ?? null : null,
        source: r.source?.trim() || opts.source || "import",
        tags: r.tags ? r.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [],
        status: statuses.includes(status) ? status : "lead",
        owner_id: ownerId,
      }));
    }
    const ids: string[] = [];
    for (let i = 0; i < toInsert.length; i += 500) {
      const { data, error } = await supabase.from("contacts").insert(toInsert.slice(i, i + 500)).select("id");
      if (error) throw new Error(error.message);
      ids.push(...(data ?? []).map((d) => d.id));
    }
    if (opts.triggerAutomations) {
      for (const id of ids) await emitEvent({ type: "lead_created", contactId: id, data: { source: opts.source || "import" } });
    }
    revalidatePath("/contacts");
    return { imported: ids.length, skipped };
  });
}

// ───────────── Companies ─────────────

export async function createCompany(input: Partial<Company>) {
  return safe(async () => {
    const profile = await me();
    if (!input.name?.trim()) throw new Error("Company name is required");
    const supabase = await createClient();
    const { data, error } = await supabase.from("companies")
      .insert({ ...input, name: input.name.trim(), owner_id: input.owner_id ?? profile.id }).select("id, name").single();
    if (error) throw new Error(error.message);
    revalidatePath("/companies");
    return data as { id: string; name: string };
  });
}

export async function updateCompany(id: string, patch: Partial<Company>) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("companies").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(`/companies/${id}`);
    revalidatePath("/companies");
    return null;
  });
}

export async function deleteCompanies(ids: string[]) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("companies").delete().in("id", ids);
    if (error) throw new Error(error.message);
    revalidatePath("/companies");
    return null;
  });
}

// ───────────── Deals ─────────────

export async function createDeal(input: Partial<Deal> & { name: string }) {
  return safe(async () => {
    const profile = await me();
    const supabase = await createClient();
    if (!input.name.trim()) throw new Error("Deal name is required");
    let stageId = input.stage_id;
    if (!stageId) {
      const { data } = await supabase.from("pipeline_stages").select("id").order("position").limit(1).single();
      stageId = data?.id;
    }
    let companyId = input.company_id ?? null;
    if (!companyId && input.contact_id) {
      const { data: c } = await supabase.from("contacts").select("company_id").eq("id", input.contact_id).single();
      companyId = c?.company_id ?? null;
    }
    const { data, error } = await supabase.from("deals").insert({
      ...input, name: input.name.trim(), stage_id: stageId, company_id: companyId,
      owner_id: input.owner_id ?? profile.id,
    }).select("id, deal_number").single();
    if (error) throw new Error(error.message);
    await supabase.from("activities").insert({ type: "system", deal_id: data.id, contact_id: input.contact_id ?? null, title: `Deal ${data.deal_number} created`, actor_id: profile.id });
    if (input.contact_id) await supabase.from("contacts").update({ status: "prospect" }).eq("id", input.contact_id).eq("status", "lead");
    revalidatePath("/deals");
    return data as { id: string; deal_number: string };
  });
}

export async function updateDeal(id: string, patch: Partial<Deal>) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { stage_id, ...rest } = patch;
    if (Object.keys(rest).length) {
      const { error } = await supabase.from("deals").update(rest).eq("id", id);
      if (error) throw new Error(error.message);
    }
    if (stage_id) await moveStage(id, stage_id, patch.lost_reason ?? null);
    revalidatePath(`/deals/${id}`);
    revalidatePath("/deals");
    return null;
  });
}

async function moveStage(dealId: string, stageId: string, lostReason: string | null) {
  const supabase = await createClient();
  const { data: stage } = await supabase.from("pipeline_stages").select("key, is_lost").eq("id", stageId).single();
  if (!stage) throw new Error("Unknown stage");
  const { data: deal, error } = await supabase.from("deals")
    .update({ stage_id: stageId, ...(stage.is_lost ? { lost_reason: lostReason } : {}) })
    .eq("id", dealId).select("contact_id").single();
  if (error) throw new Error(error.message);
  await emitEvent({ type: "stage_changed", dealId, contactId: deal?.contact_id ?? null, data: { stage_key: stage.key } });
}

export async function moveDealStage(dealId: string, stageId: string, lostReason?: string | null) {
  return safe(async () => {
    await me();
    await moveStage(dealId, stageId, lostReason ?? null);
    revalidatePath("/deals");
    revalidatePath(`/deals/${dealId}`);
    return null;
  });
}

export async function deleteDeals(ids: string[]) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error, count } = await supabase.from("deals").delete({ count: "exact" }).in("id", ids);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("You don't have permission to delete this deal");
    revalidatePath("/deals");
    return null;
  });
}

export async function upsertLineItem(item: Partial<DealLineItem> & { deal_id: string }) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const row = {
      ...item,
      name: item.name?.trim() || "Untitled item",
      unit_price: Number(item.unit_price ?? 0),
      quantity: Math.max(1, Number(item.quantity ?? 1)),
      interval_months: Math.max(1, Number(item.interval_months ?? 1)),
    };
    const q = item.id
      ? supabase.from("deal_line_items").update(row).eq("id", item.id).select("*").single()
      : supabase.from("deal_line_items").insert(row).select("*").single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    revalidatePath(`/deals/${item.deal_id}`);
    return data as DealLineItem;
  });
}

export async function deleteLineItem(id: string, dealId: string) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("deal_line_items").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(`/deals/${dealId}`);
    return null;
  });
}

// ───────────── Tasks ─────────────

export async function saveTask(task: Partial<Task> & { title: string }) {
  return safe(async () => {
    const profile = await me();
    const supabase = await createClient();
    const { id, ...rest } = task;
    const row = { ...rest, title: task.title.trim() };
    if (!row.title) throw new Error("Task title is required");
    if (id) {
      const { error } = await supabase.from("tasks").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from("tasks")
        .insert({ ...row, assignee_id: row.assignee_id ?? profile.id, created_by: profile.id }).select("id").single();
      if (error) throw new Error(error.message);
      await supabase.from("activities").insert({
        type: "task", title: `Task created: ${row.title}`, contact_id: row.contact_id ?? null, deal_id: row.deal_id ?? null,
        client_id: row.client_id ?? null, actor_id: profile.id, metadata: { task_id: data.id },
      });
    }
    revalidatePath("/tasks");
    return null;
  });
}

export async function setTaskCompleted(id: string, done: boolean) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update({ completed_at: done ? new Date().toISOString() : null }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/tasks");
    return null;
  });
}

export async function deleteTask(id: string) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/tasks");
    return null;
  });
}

// ───────────── Notes / activities ─────────────

export async function addNote(target: { contact_id?: string | null; deal_id?: string | null; company_id?: string | null; client_id?: string | null }, body: string) {
  return safe(async () => {
    const profile = await me();
    if (!body.trim()) throw new Error("Note is empty");
    const supabase = await createClient();
    const { error } = await supabase.from("activities").insert({
      type: "note", title: "Note", body: body.trim(), actor_id: profile.id,
      contact_id: target.contact_id ?? null, deal_id: target.deal_id ?? null, company_id: target.company_id ?? null, client_id: target.client_id ?? null,
    });
    if (error) throw new Error(error.message);
    if (target.contact_id) revalidatePath(`/contacts/${target.contact_id}`);
    if (target.deal_id) revalidatePath(`/deals/${target.deal_id}`);
    if (target.company_id) revalidatePath(`/companies/${target.company_id}`);
    return null;
  });
}

export async function deleteActivity(id: string) {
  return safe(async () => {
    await me();
    const supabase = await createClient();
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}
