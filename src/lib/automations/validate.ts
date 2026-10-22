import type { AutomationEdge, AutomationNode } from "@/lib/types";
import type { ConditionRule } from "./catalog";

export interface GraphIssue { nodeId?: string; message: string }

/** Validates a workflow graph before activation. Returns blocking errors. */
export function validateGraph(nodes: AutomationNode[], edges: AutomationEdge[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) issues.push({ message: `Workflow needs exactly one trigger (found ${triggers.length}).` });
  const trigger = triggers[0];
  if (trigger && !edges.some((e) => e.source === trigger.id)) issues.push({ nodeId: trigger.id, message: "Connect the trigger to a first step." });

  if (trigger) {
    const seen = new Set([trigger.id]);
    const queue = [trigger.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges.filter((x) => x.source === id)) if (!seen.has(e.target)) { seen.add(e.target); queue.push(e.target); }
    }
    for (const n of nodes) if (!seen.has(n.id)) issues.push({ nodeId: n.id, message: `"${label(n)}" is not connected to the trigger.` });
  }

  for (const n of nodes) {
    const d = n.data ?? {};
    const req = (cond: unknown, msg: string) => { if (!cond) issues.push({ nodeId: n.id, message: `${label(n)}: ${msg}` }); };
    switch (n.type) {
      case "trigger":
        req(d.trigger_type, "choose a trigger event");
        if (d.trigger_type === "tag_added") req(d.tag, "enter the tag to watch");
        break;
      case "send_sms": req(String(d.message ?? "").trim(), "message is empty"); break;
      case "send_email": req(String(d.subject ?? "").trim(), "subject is empty"); req(String(d.body ?? "").trim(), "body is empty"); break;
      case "wait": req(Number(d.amount) >= 0 && (Number(d.amount) > 0 || d.until_time || d.business_hours || d.weekdays_only), "set a delay"); break;
      case "condition": {
        const rules = (d.rules as ConditionRule[]) ?? [];
        req(rules.length, "add at least one rule");
        for (const r of rules) {
          if (r.kind === "has_tag") req(r.tag, "rule needs a tag");
          if (r.kind === "stage_is") req(r.stage_key, "rule needs a stage");
          if (r.kind === "field") req(r.field, "rule needs a field");
        }
        req(edges.some((e) => e.source === n.id), "connect the Yes and/or No branch");
        break;
      }
      case "add_tag": case "remove_tag": req(String(d.tag ?? "").trim(), "enter a tag"); break;
      case "update_contact": req(d.field, "choose a field"); break;
      case "assign_owner": if (d.mode === "user") req(d.user_id, "choose a rep"); break;
      case "create_task": req(String(d.title ?? "").trim(), "task title is empty"); break;
      case "move_stage": req(d.stage_key, "choose a stage"); break;
      case "notify": req(String(d.title ?? "").trim(), "notification title is empty"); break;
      case "ai_generate": req(String(d.prompt ?? "").trim(), "prompt is empty"); req(/^\w+$/.test(String(d.variable ?? "")), "output variable must be letters/numbers/_"); break;
      case "webhook": req(/^https?:\/\//.test(String(d.url ?? "")), "enter a valid http(s) URL"); break;
    }
  }
  return issues;
}

function label(n: AutomationNode) {
  return (n.data?.label as string) || n.type.replace(/_/g, " ");
}
