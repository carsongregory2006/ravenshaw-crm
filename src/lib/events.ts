import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Automation, AutomationTrigger } from "@/lib/types";

export interface CrmEvent {
  type: AutomationTrigger;
  contactId?: string | null;
  dealId?: string | null;
  data?: Record<string, unknown>; // e.g. { page_id, stage_key, tag, message }
}

function matchesConfig(a: Automation, ev: CrmEvent) {
  const cfg = (a.trigger_config ?? {}) as Record<string, unknown>;
  const d = ev.data ?? {};
  for (const key of ["page_id", "stage_key", "tag", "source", "keyword"] as const) {
    const want = cfg[key];
    if (want == null || want === "") continue;
    if (key === "keyword") {
      const text = String(d.message ?? "").toLowerCase();
      if (!text.includes(String(want).toLowerCase())) return false;
      continue;
    }
    if (String(d[key] ?? "") !== String(want)) return false;
  }
  return true;
}

/**
 * Publish a CRM event: enrolls the contact into every active automation whose trigger matches.
 * Also cancels waiting runs configured to stop on reply when the contact replies.
 * Runs are executed by the engine on the next cron tick (and immediately, best-effort).
 */
export async function emitEvent(ev: CrmEvent) {
  const db = createAdminClient();

  if ((ev.type === "inbound_sms" || ev.type === "inbound_email") && ev.contactId) {
    const { data: waiting } = await db.from("automation_runs").select("id, automation:automations(trigger_config)")
      .eq("contact_id", ev.contactId).in("status", ["running", "waiting"]);
    const stop = (waiting ?? []).filter((r: any) => r.automation?.trigger_config?.stop_on_reply !== false).map((r) => r.id);
    if (stop.length) {
      await db.from("automation_runs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: "Contact replied" }).in("id", stop);
    }
  }

  const { data: autos } = await db.from("automations").select("*").eq("status", "active").eq("trigger_type", ev.type);
  const enrolled: string[] = [];
  for (const a of (autos ?? []) as Automation[]) {
    if (!matchesConfig(a, ev)) continue;
    if (ev.contactId && !a.allow_reentry) {
      const { count } = await db.from("automation_runs").select("id", { count: "exact", head: true })
        .eq("automation_id", a.id).eq("contact_id", ev.contactId);
      if (count) continue;
    }
    const trigger = a.nodes.find((n) => n.type === "trigger");
    const first = a.edges.find((e) => e.source === trigger?.id)?.target ?? null;
    const { data: run } = await db.from("automation_runs").insert({
      automation_id: a.id, contact_id: ev.contactId ?? null, deal_id: ev.dealId ?? null,
      status: first ? "running" : "completed", current_node_id: first, next_run_at: new Date().toISOString(),
      context: { event: ev.type, ...(ev.data ?? {}) }, finished_at: first ? null : new Date().toISOString(),
    }).select("id").single();
    if (run) enrolled.push(run.id);
  }

  if (enrolled.length) {
    try {
      const { processRuns } = await import("@/lib/automations/engine");
      await processRuns({ runIds: enrolled });
    } catch (e) {
      console.error("automation immediate processing failed", e);
    }
  }
  return enrolled;
}
