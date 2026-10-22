"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { safe } from "./util";
import { AUTOMATION_TEMPLATES, blankAutomation } from "@/lib/automations/templates";
import { validateGraph } from "@/lib/automations/validate";
import { cancelRun, retryRun, testAutomation, enrollContact } from "@/lib/automations/engine";
import type { Automation, AutomationEdge, AutomationNode } from "@/lib/types";

async function staff() {
  const p = await getProfile();
  if (!p || (p.role !== "admin" && p.role !== "ops")) throw new Error("Only admins and ops can manage automations");
  return p;
}

/** Trigger node data is the source of truth for trigger_type / trigger_config. */
function deriveTrigger(nodes: AutomationNode[]) {
  const t = nodes.find((n) => n.type === "trigger");
  const d = (t?.data ?? {}) as Record<string, unknown>;
  const { trigger_type, label: _label, ...config } = d;
  void _label;
  return { trigger_type: (trigger_type as string) || "manual", trigger_config: config };
}

export async function createAutomation(templateKey?: string) {
  return safe(async () => {
    const p = await staff();
    const tpl = AUTOMATION_TEMPLATES.find((t) => t.key === templateKey);
    const base = tpl ?? { name: "Untitled automation", description: null, ...blankAutomation() };
    const sb = await createClient();
    const { data, error } = await sb.from("automations").insert({
      name: base.name, description: base.description, status: "draft",
      trigger_type: base.trigger_type, trigger_config: base.trigger_config, nodes: base.nodes, edges: base.edges, created_by: p.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/automations");
    return data.id as string;
  });
}

export async function saveAutomation(id: string, input: { name: string; description?: string | null; nodes: AutomationNode[]; edges: AutomationEdge[]; allow_reentry: boolean }) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    const { data: current } = await sb.from("automations").select("status").eq("id", id).single();
    if (current?.status === "active") {
      const issues = validateGraph(input.nodes, input.edges);
      if (issues.length) throw new Error(`Can't save an active workflow with errors: ${issues[0].message} (pause it first to save a draft).`);
    }
    const { error } = await sb.from("automations").update({
      name: input.name.trim() || "Untitled automation", description: input.description ?? null,
      nodes: input.nodes, edges: input.edges, allow_reentry: input.allow_reentry, ...deriveTrigger(input.nodes),
    }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/automations");
    return true;
  });
}

export async function setAutomationStatus(id: string, status: Automation["status"]) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    if (status === "active") {
      const { data } = await sb.from("automations").select("nodes, edges").eq("id", id).single();
      const issues = validateGraph((data?.nodes ?? []) as AutomationNode[], (data?.edges ?? []) as AutomationEdge[]);
      if (issues.length) throw new Error(issues.map((i) => i.message).slice(0, 3).join(" · "));
    }
    const { error } = await sb.from("automations").update({ status }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/automations");
    return status;
  });
}

export async function duplicateAutomation(id: string) {
  return safe(async () => {
    const p = await staff();
    const sb = await createClient();
    const { data: a } = await sb.from("automations").select("*").eq("id", id).single();
    if (!a) throw new Error("Automation not found");
    const { data, error } = await sb.from("automations").insert({
      name: `${a.name} (copy)`, description: a.description, status: "draft", trigger_type: a.trigger_type, trigger_config: a.trigger_config,
      nodes: a.nodes, edges: a.edges, allow_reentry: a.allow_reentry, created_by: p.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/automations");
    return data.id as string;
  });
}

export async function deleteAutomation(id: string) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    const { error } = await sb.from("automations").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/automations");
    return true;
  });
}

export async function testAutomationAction(id: string, contactId: string, skipWaits: boolean) {
  return safe(async () => {
    await staff();
    return testAutomation(id, contactId, skipWaits);
  });
}

export async function enrollContactsAction(id: string, contactIds: string[]) {
  return safe(async () => {
    await staff();
    const ids: string[] = [];
    for (const c of contactIds) ids.push(await enrollContact(id, c));
    revalidatePath("/automations");
    return ids;
  });
}

export async function cancelRunAction(runId: string) {
  return safe(async () => { await staff(); await cancelRun(runId); return true; });
}

export async function retryRunAction(runId: string) {
  return safe(async () => { await staff(); await retryRun(runId); return true; });
}
