// Node catalog shared by the builder UI and the engine (no React / server-only imports here).
import type { AutomationNodeType, AutomationTrigger } from "@/lib/types";

export type NodeCategory = "Triggers" | "Messaging" | "Flow" | "CRM" | "AI" | "Advanced";

export interface NodeMeta {
  label: string;
  category: NodeCategory;
  color: string; // icon tile color
  description: string;
  defaults: Record<string, unknown>;
}

export const NODE_CATALOG: Record<AutomationNodeType, NodeMeta> = {
  trigger: { label: "Trigger", category: "Triggers", color: "#ff6d5a", description: "Starts the workflow when a CRM event happens", defaults: { trigger_type: "lead_created", stop_on_reply: true } },
  send_sms: { label: "Send SMS", category: "Messaging", color: "#29a383", description: "Text the contact via Telnyx", defaults: { message: "Hi {{first_name}}, ", quiet_hours: true } },
  send_email: { label: "Send Email", category: "Messaging", color: "#1961ed", description: "Email the contact via Resend", defaults: { subject: "", body: "Hi {{first_name}},\n\n", quiet_hours: false } },
  wait: { label: "Wait", category: "Flow", color: "#e28b00", description: "Delay before the next step", defaults: { amount: 1, unit: "days", until_time: "", weekdays_only: false, business_hours: false } },
  condition: { label: "If / Else", category: "Flow", color: "#7b49e8", description: "Branch on contact data or behavior", defaults: { match: "all", rules: [{ kind: "replied" }] } },
  end: { label: "End", category: "Flow", color: "#666666", description: "Stop the workflow for this contact", defaults: {} },
  update_contact: { label: "Update Contact", category: "CRM", color: "#0e7aa6", description: "Set a field on the contact", defaults: { field: "status", value: "prospect" } },
  add_tag: { label: "Add Tag", category: "CRM", color: "#0f8a78", description: "Add a tag to the contact", defaults: { tag: "" } },
  remove_tag: { label: "Remove Tag", category: "CRM", color: "#0f8a78", description: "Remove a tag from the contact", defaults: { tag: "" } },
  assign_owner: { label: "Assign Owner", category: "CRM", color: "#d1580b", description: "Assign a rep (specific or round robin)", defaults: { mode: "round_robin", user_id: "" } },
  create_task: { label: "Create Task", category: "CRM", color: "#c4317f", description: "Create a task for the owner", defaults: { title: "Follow up with {{full_name}}", due_days: 0, priority: "high", assignee: "owner" } },
  move_stage: { label: "Move Deal Stage", category: "CRM", color: "#a77b00", description: "Move the contact's deal to a stage", defaults: { stage_key: "contacted", create_if_missing: true } },
  notify: { label: "Notify Team", category: "CRM", color: "#e5484d", description: "In-app notification to owner/admins", defaults: { to: "owner", title: "Automation: {{full_name}}", body: "" } },
  ai_generate: { label: "AI Generate", category: "AI", color: "#8e4ec6", description: "Generate text with OpenRouter for later steps", defaults: { prompt: "Write a short, friendly follow-up SMS for {{first_name}} from {{company}}.", variable: "followup" } },
  webhook: { label: "HTTP Request", category: "Advanced", color: "#444444", description: "POST the contact + run data to a URL", defaults: { url: "", method: "POST" } },
};

export const CATEGORIES: NodeCategory[] = ["Messaging", "Flow", "CRM", "AI", "Advanced"];

export const TRIGGERS: { value: AutomationTrigger; label: string; description: string }[] = [
  { value: "lead_created", label: "New lead created", description: "Any new contact enters the CRM" },
  { value: "form_submitted", label: "Landing page form submitted", description: "A landing page form is submitted" },
  { value: "stage_changed", label: "Deal stage changed", description: "A deal moves to a stage" },
  { value: "tag_added", label: "Tag added", description: "A tag is added to a contact" },
  { value: "booking_created", label: "Calendly booking created", description: "A contact books a meeting" },
  { value: "contract_signed", label: "Contract signed", description: "PandaDoc contract completed" },
  { value: "invoice_paid", label: "Invoice paid", description: "A Mercury invoice is paid" },
  { value: "inbound_sms", label: "Inbound SMS received", description: "Contact texts in (optional keyword)" },
  { value: "inbound_email", label: "Inbound email received", description: "Contact emails in" },
  { value: "manual", label: "Manual enrollment", description: "Enroll contacts by hand / test" },
];

export const triggerLabel = (t: string) => TRIGGERS.find((x) => x.value === t)?.label ?? t;

export const CONTACT_FIELDS = [
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "title", label: "Job title" },
  { value: "status", label: "Status" },
  { value: "source", label: "Source" },
  { value: "lead_score", label: "Lead score" },
  { value: "utm_source", label: "UTM source" },
  { value: "utm_campaign", label: "UTM campaign" },
  { value: "do_not_contact", label: "Do not contact" },
];
export const UPDATABLE_FIELDS = ["first_name", "last_name", "email", "phone", "title", "status", "source", "lead_score", "do_not_contact"];

export type ConditionRule =
  | { kind: "field"; field: string; op: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty"; value?: string }
  | { kind: "has_tag"; tag: string; negate?: boolean }
  | { kind: "stage_is"; stage_key: string }
  | { kind: "replied" }
  | { kind: "opened_email" }
  | { kind: "booked" };

export const RULE_KINDS: { value: ConditionRule["kind"]; label: string }[] = [
  { value: "replied", label: "Contact replied (since enrollment)" },
  { value: "booked", label: "Contact booked a meeting" },
  { value: "opened_email", label: "Contact opened an email" },
  { value: "has_tag", label: "Contact has tag" },
  { value: "stage_is", label: "Deal stage is" },
  { value: "field", label: "Contact field…" },
];

export const MERGE_TAGS = ["first_name", "last_name", "full_name", "email", "phone", "company", "rep_name", "rep_email", "agency_name", "booking_link", "onboarding_link"];

type D = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const clip = (t: string, n = 60) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** One-line description shown on the node card. */
export function nodeSummary(type: AutomationNodeType, d: D): string {
  switch (type) {
    case "trigger": return triggerLabel(s(d.trigger_type));
    case "send_sms": return clip(s(d.message)) || "No message yet";
    case "send_email": return s(d.subject) ? clip(s(d.subject)) : "No subject yet";
    case "wait": {
      const n = Number(d.amount ?? 0);
      let t = n ? `Wait ${n} ${n === 1 ? s(d.unit).replace(/s$/, "") : s(d.unit)}` : "No delay";
      if (d.until_time) t += ` then until ${s(d.until_time)}`;
      if (d.business_hours) t += " · business hrs";
      else if (d.weekdays_only) t += " · weekdays";
      return t;
    }
    case "condition": {
      const rules = (d.rules as ConditionRule[]) ?? [];
      if (!rules.length) return "No rules";
      const first = RULE_KINDS.find((k) => k.value === rules[0].kind)?.label ?? rules[0].kind;
      return rules.length > 1 ? `${clip(first, 34)} +${rules.length - 1} (${s(d.match)})` : clip(first, 44);
    }
    case "update_contact": return `${s(d.field)} → ${s(d.value)}`;
    case "add_tag": return d.tag ? `+ ${s(d.tag)}` : "No tag";
    case "remove_tag": return d.tag ? `− ${s(d.tag)}` : "No tag";
    case "assign_owner": return d.mode === "user" ? "Specific rep" : "Round robin";
    case "create_task": return clip(s(d.title)) || "Untitled task";
    case "move_stage": return `→ ${s(d.stage_key)}`;
    case "notify": return `${d.to === "admins" ? "Admins" : d.to === "both" ? "Owner + admins" : "Owner"}: ${clip(s(d.title), 36)}`;
    case "ai_generate": return d.variable ? `→ {{ai.${s(d.variable)}}}` : "No output variable";
    case "webhook": return clip(s(d.url)) || "No URL";
    case "end": return "Workflow ends";
  }
}
