import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDaily, setDailyCheck } from "@/lib/daily";
import { addProjectTask, createProject, getProject, listProjects, updateProject, updateProjectTask, PROJECT_STATUSES, TASK_STATUSES } from "@/lib/projects";
import { ensureClientAccount } from "@/lib/clients";
import { contactLabel, toE164 } from "@/lib/utils";

/** Context for a tool call: service-role DB client acting as the admin who created the connector key. */
export interface ToolCtx { db: SupabaseClient; userId: string }

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
export interface Tool { name: string; description: string; inputSchema: JsonSchema; run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown> }

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown, d: number, max: number) => Math.min(max, Math.max(1, Number.isFinite(Number(v)) ? Number(v) : d));
const CONTACT_STATUSES = ["lead", "prospect", "client", "churned", "unqualified"];
const person = (c: Record<string, unknown> & { company?: { name: string } | null }) => ({
  id: c.id, name: contactLabel(c as never) || "Unnamed", phone: c.phone ?? null, email: c.email ?? null, status: c.status, title: c.title ?? null,
  company: c.company?.name ?? null, tags: c.tags ?? [], custom_fields: c.custom_fields ?? {}, do_not_contact: c.do_not_contact ?? false,
});
const PERSON_COLS = "id, first_name, last_name, phone, email, status, title, tags, custom_fields, do_not_contact, created_at, company:companies(name)";

async function findDailyItem(db: SupabaseClient, ref: string) {
  const { items } = await getDaily(db);
  const n = ref.toLowerCase();
  return items.find((i) => i.id === ref) ?? items.find((i) => i.title.toLowerCase() === n) ?? items.find((i) => i.title.toLowerCase().includes(n));
}

export const TOOLS: Tool[] = [
  {
    name: "crm_overview",
    description: "Snapshot of the CRM right now: people by status, clients, open deals, open tasks due today/overdue, today's daily inputs progress, and projects by status.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, { db }) {
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      const [statuses, clients, stages, deals, tasks, daily, projects] = await Promise.all([
        Promise.all(CONTACT_STATUSES.map(async (s) => [s, (await db.from("contacts").select("id", { count: "exact", head: true }).eq("status", s)).count ?? 0] as const)),
        db.from("clients").select("id, status, mrr").neq("status", "churned"),
        db.from("pipeline_stages").select("id, name, is_won, is_lost"),
        db.from("deals").select("id, stage_id, amount_one_time, amount_recurring"),
        db.from("tasks").select("id, due_at").is("completed_at", null).lte("due_at", endOfDay.toISOString()),
        getDaily(db),
        listProjects(db),
      ]);
      const open = new Set((stages.data ?? []).filter((s) => !s.is_won && !s.is_lost).map((s) => s.id));
      const openDeals = (deals.data ?? []).filter((d) => open.has(d.stage_id));
      return {
        people: Object.fromEntries(statuses),
        clients: { count: clients.data?.length ?? 0, mrr: (clients.data ?? []).reduce((s, c) => s + Number(c.mrr ?? 0), 0) },
        open_deals: { count: openDeals.length, one_time: openDeals.reduce((s, d) => s + Number(d.amount_one_time), 0), monthly: openDeals.reduce((s, d) => s + Number(d.amount_recurring), 0) },
        tasks_due_today_or_overdue: tasks.data?.length ?? 0,
        daily_inputs: { day: daily.day, done: daily.done, total: daily.total, remaining: daily.items.filter((i) => !i.done).map((i) => i.title) },
        projects: Object.fromEntries(PROJECT_STATUSES.map((s) => [s, projects.filter((p) => p.status === s).length])),
      };
    },
  },
  {
    name: "search_people",
    description: "Search people (contacts) by name, phone, email or company. Optionally filter by status (lead, prospect, client, churned, unqualified).",
    inputSchema: { type: "object", properties: { query: { type: "string" }, status: { type: "string", enum: CONTACT_STATUSES }, limit: { type: "number", description: "Max results (default 20, max 100)" } } },
    async run(a, { db }) {
      let q = db.from("contacts").select(PERSON_COLS).order("updated_at", { ascending: false }).limit(num(a.limit, 20, 100));
      if (str(a.status)) q = q.eq("status", str(a.status));
      const term = str(a.query).replace(/[%,()]/g, " ").trim();
      if (term) {
        const like = `%${term}%`;
        const digits = term.replace(/\D/g, "");
        q = q.or([`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`, digits.length >= 4 ? `phone.ilike.%${digits}%` : null].filter(Boolean).join(","));
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((c) => person(c as never));
    },
  },
  {
    name: "get_person",
    description: "Full details for one person: fields, client account, deals, open tasks and recent timeline.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async run(a, { db }) {
      const id = str(a.id);
      const [{ data: c }, { data: client }, { data: deals }, { data: tasks }, { data: acts }] = await Promise.all([
        db.from("contacts").select(PERSON_COLS).eq("id", id).maybeSingle(),
        db.from("clients").select("id, status, mrr, start_date").eq("contact_id", id).maybeSingle(),
        db.from("deals").select("id, name, amount_one_time, amount_recurring, stage:pipeline_stages(name)").eq("contact_id", id),
        db.from("tasks").select("id, title, due_at").eq("contact_id", id).is("completed_at", null),
        db.from("activities").select("type, title, body, created_at").eq("contact_id", id).order("created_at", { ascending: false }).limit(15),
      ]);
      if (!c) throw new Error("Person not found");
      return { ...person(c as never), client, deals, open_tasks: tasks, recent_activity: acts };
    },
  },
  {
    name: "create_person",
    description: "Add a new person to the CRM.",
    inputSchema: { type: "object", properties: {
      first_name: { type: "string" }, last_name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, title: { type: "string" },
      company: { type: "string", description: "Company name (found or created)" }, status: { type: "string", enum: CONTACT_STATUSES }, note: { type: "string" },
    } },
    async run(a, { db, userId }) {
      if (!str(a.first_name) && !str(a.last_name) && !str(a.phone) && !str(a.email)) throw new Error("Give at least a name, phone or email");
      let company_id: string | null = null;
      if (str(a.company)) {
        const { data: found } = await db.from("companies").select("id").ilike("name", str(a.company)).limit(1).maybeSingle();
        company_id = found?.id ?? (await db.from("companies").insert({ name: str(a.company), owner_id: userId }).select("id").single()).data?.id ?? null;
      }
      const status = CONTACT_STATUSES.includes(str(a.status)) ? str(a.status) : "lead";
      const { data, error } = await db.from("contacts").insert({
        first_name: str(a.first_name) || null, last_name: str(a.last_name) || null, phone: toE164(str(a.phone) || null), email: str(a.email).toLowerCase() || null,
        title: str(a.title) || null, company_id, status, owner_id: userId, source: "grok",
      }).select(PERSON_COLS).single();
      if (error) throw new Error(error.message);
      if (str(a.note)) await db.from("activities").insert({ type: "note", contact_id: data.id, title: "Note", body: str(a.note), actor_id: userId, metadata: {} });
      if (status === "client") await ensureClientAccount(db, data.id, userId);
      return person(data as never);
    },
  },
  {
    name: "update_person",
    description: "Update a person's fields or status. Setting status to 'client' also creates their client account (no contract).",
    inputSchema: { type: "object", properties: {
      id: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, title: { type: "string" },
      status: { type: "string", enum: CONTACT_STATUSES }, do_not_contact: { type: "boolean" },
    }, required: ["id"] },
    async run(a, { db, userId }) {
      const row: Record<string, unknown> = {};
      for (const k of ["first_name", "last_name", "title"]) if (typeof a[k] === "string") row[k] = str(a[k]) || null;
      if (typeof a.phone === "string") row.phone = toE164(str(a.phone) || null);
      if (typeof a.email === "string") row.email = str(a.email).toLowerCase() || null;
      if (typeof a.do_not_contact === "boolean") row.do_not_contact = a.do_not_contact;
      if (typeof a.status === "string") { if (!CONTACT_STATUSES.includes(a.status)) throw new Error("Unknown status"); row.status = a.status; }
      if (!Object.keys(row).length) throw new Error("Nothing to update");
      const { data, error } = await db.from("contacts").update(row).eq("id", str(a.id)).select(PERSON_COLS).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Person not found");
      if (row.status === "client") await ensureClientAccount(db, data.id, userId);
      return person(data as never);
    },
  },
  {
    name: "add_note",
    description: "Add a note to a person's timeline.",
    inputSchema: { type: "object", properties: { person_id: { type: "string" }, text: { type: "string" } }, required: ["person_id", "text"] },
    async run(a, { db, userId }) {
      if (!str(a.text)) throw new Error("Note is empty");
      const { error } = await db.from("activities").insert({ type: "note", contact_id: str(a.person_id), title: "Note (Grok)", body: str(a.text), actor_id: userId, metadata: {} });
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "list_clients",
    description: "List client accounts with status and monthly revenue.",
    inputSchema: { type: "object", properties: { include_churned: { type: "boolean" } } },
    async run(a, { db }) {
      let q = db.from("clients").select("id, status, mrr, start_date, contact:contacts(id, first_name, last_name, email, phone), company:companies(name)").order("created_at", { ascending: false });
      if (!a.include_churned) q = q.neq("status", "churned");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((c) => { const ct = c.contact as unknown as { id: string; first_name: string | null; last_name: string | null } | null; return { ...c, contact: ct ? { ...ct, name: contactLabel(ct) } : null }; });
    },
  },
  {
    name: "list_deals",
    description: "List deals with their pipeline stage and amounts. By default only open deals.",
    inputSchema: { type: "object", properties: { include_closed: { type: "boolean" } } },
    async run(a, { db }) {
      const { data, error } = await db.from("deals").select("id, deal_number, name, amount_one_time, amount_recurring, created_at, stage:pipeline_stages(name, is_won, is_lost), contact:contacts(id, first_name, last_name)").order("created_at", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []).filter((d) => { const s = d.stage as unknown as { is_won: boolean; is_lost: boolean } | null; return a.include_closed || !(s?.is_won || s?.is_lost); });
    },
  },
  {
    name: "list_tasks",
    description: "List open CRM tasks (follow-ups, callbacks), soonest due first.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    async run(a, { db }) {
      const { data, error } = await db.from("tasks").select("id, title, description, due_at, priority, contact:contacts(id, first_name, last_name)").is("completed_at", null).order("due_at", { ascending: true, nullsFirst: false }).limit(num(a.limit, 30, 200));
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: "create_task",
    description: "Create a CRM task / follow-up, optionally for a person.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, due_at: { type: "string", description: "ISO date-time" }, person_id: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] }, description: { type: "string" } }, required: ["title"] },
    async run(a, { db, userId }) {
      if (!str(a.title)) throw new Error("Title is empty");
      const due = str(a.due_at) && !Number.isNaN(Date.parse(str(a.due_at))) ? new Date(str(a.due_at)).toISOString() : null;
      const { data, error } = await db.from("tasks").insert({
        title: str(a.title), description: str(a.description) || null, due_at: due, priority: ["low", "medium", "high", "urgent"].includes(str(a.priority)) ? str(a.priority) : "medium",
        contact_id: str(a.person_id) || null, assignee_id: userId, created_by: userId,
      }).select("id, title, due_at").single();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: "complete_task",
    description: "Mark a CRM task done (or not done).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, done: { type: "boolean" } }, required: ["id"] },
    async run(a, { db }) {
      const { error } = await db.from("tasks").update({ completed_at: a.done === false ? null : new Date().toISOString() }).eq("id", str(a.id));
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },
  {
    name: "list_lead_lists",
    description: "List Power Dialer lead lists with how many leads are left to call.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, { db }) {
      const { data: lists } = await db.from("lead_lists").select("id, name, source, created_at").is("archived_at", null).order("created_at", { ascending: false });
      const out = [];
      for (const l of lists ?? []) {
        const [{ count: total }, { count: pending }] = await Promise.all([
          db.from("lead_list_items").select("contact_id", { count: "exact", head: true }).eq("list_id", l.id),
          db.from("lead_list_items").select("contact_id", { count: "exact", head: true }).eq("list_id", l.id).eq("status", "pending"),
        ]);
        out.push({ ...l, total: total ?? 0, to_call: pending ?? 0 });
      }
      return out;
    },
  },
  {
    name: "daily_checklist",
    description: "Today's daily inputs checklist (resets every day, Montreal time): each item and whether it's done.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, { db }) { return getDaily(db); },
  },
  {
    name: "check_daily_item",
    description: "Tick (or untick) one of today's daily inputs. 'item' can be the item id or its name.",
    inputSchema: { type: "object", properties: { item: { type: "string" }, done: { type: "boolean", description: "Default true" } }, required: ["item"] },
    async run(a, { db }) {
      const it = await findDailyItem(db, str(a.item));
      if (!it) throw new Error(`No daily input matches "${str(a.item)}"`);
      await setDailyCheck(db, it.id, a.done !== false);
      return getDaily(db);
    },
  },
  {
    name: "add_daily_item",
    description: "Add a new item to the daily inputs checklist (it repeats every day).",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    async run(a, { db }) {
      if (!str(a.title)) throw new Error("Title is empty");
      const { data: last } = await db.from("daily_items").select("position").eq("active", true).order("position", { ascending: false }).limit(1).maybeSingle();
      const { error } = await db.from("daily_items").insert({ title: str(a.title).slice(0, 200), position: (last?.position ?? -1) + 1 });
      if (error) throw new Error(error.message);
      return getDaily(db);
    },
  },
  {
    name: "list_projects",
    description: "List projects being built, with status (idea, building, live, paused) and task counts.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: [...PROJECT_STATUSES] } } },
    async run(a, { db }) { return listProjects(db, { status: str(a.status) || undefined }); },
  },
  {
    name: "get_project",
    description: "One project with all its tasks (todo, doing, done).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async run(a, { db }) { return getProject(db, str(a.id)); },
  },
  {
    name: "create_project",
    description: "Create a project.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: [...PROJECT_STATUSES] }, due_date: { type: "string", description: "YYYY-MM-DD" } }, required: ["name"] },
    async run(a, { db, userId }) { return createProject(db, { name: str(a.name), description: str(a.description), status: str(a.status) || undefined, due_date: str(a.due_date) || null, created_by: userId }); },
  },
  {
    name: "update_project",
    description: "Update a project's name, description, status or due date.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: [...PROJECT_STATUSES] }, due_date: { type: "string" } }, required: ["id"] },
    async run(a, { db }) {
      const patch: Record<string, string> = {};
      for (const k of ["name", "description", "status", "due_date"]) if (typeof a[k] === "string") patch[k] = a[k] as string;
      return updateProject(db, str(a.id), patch);
    },
  },
  {
    name: "add_project_task",
    description: "Add a task to a project's board.",
    inputSchema: { type: "object", properties: { project_id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: [...TASK_STATUSES] }, due_date: { type: "string" }, notes: { type: "string" } }, required: ["project_id", "title"] },
    async run(a, { db }) { return addProjectTask(db, str(a.project_id), { title: str(a.title), status: str(a.status) || undefined, due_date: str(a.due_date) || null, notes: str(a.notes) || null }); },
  },
  {
    name: "update_project_task",
    description: "Update or move a project task (status: todo, doing, done).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: [...TASK_STATUSES] }, due_date: { type: "string" }, notes: { type: "string" } }, required: ["id"] },
    async run(a, { db }) {
      const patch: Record<string, string> = {};
      for (const k of ["title", "status", "due_date", "notes"]) if (typeof a[k] === "string") patch[k] = a[k] as string;
      return updateProjectTask(db, str(a.id), patch);
    },
  },
];
