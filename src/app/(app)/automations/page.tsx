import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AutomationList, type AutomationRow } from "@/components/automations/automation-list";
import type { Automation } from "@/lib/types";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
  await requireStaff();
  const sb = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: autos }, { data: recent }, { data: active }, { data: completed }] = await Promise.all([
    sb.from("automations").select("id, name, description, status, trigger_type, nodes, updated_at").order("updated_at", { ascending: false }),
    sb.from("automation_runs").select("automation_id, error").gte("started_at", since).limit(20000),
    sb.from("automation_runs").select("automation_id").in("status", ["running", "waiting"]).limit(20000),
    sb.from("automation_runs").select("automation_id").eq("status", "completed").limit(20000),
  ]);
  const tally = (rows: { automation_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.automation_id, (m.get(r.automation_id) ?? 0) + 1);
    return m;
  };
  const enrolled = tally(recent);
  const replied = tally((recent ?? []).filter((r) => r.error === "Contact replied"));
  const act = tally(active);
  const done = tally(completed);

  const rows: AutomationRow[] = ((autos ?? []) as (Automation & { nodes: unknown[] })[]).map((a) => ({
    id: a.id, name: a.name, description: a.description, status: a.status, trigger_type: a.trigger_type, updated_at: a.updated_at,
    steps: Math.max(0, (a.nodes?.length ?? 1) - 1),
    active: act.get(a.id) ?? 0, completed: done.get(a.id) ?? 0, enrolled30: enrolled.get(a.id) ?? 0, replied30: replied.get(a.id) ?? 0,
  }));
  return <AutomationList rows={rows} />;
}
