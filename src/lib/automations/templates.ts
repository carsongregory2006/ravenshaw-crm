// Starter workflows offered on "New automation".
import type { AutomationEdge, AutomationNode, AutomationNodeType, AutomationTrigger } from "@/lib/types";

export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, unknown>;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

const X = 300;

/** Tiny DSL: build a left-to-right graph from steps. */
function graph(steps: { id: string; type: AutomationNodeType; data: Record<string, unknown>; x: number; y?: number }[], links: [string, string, ("yes" | "no")?][]) {
  const nodes: AutomationNode[] = steps.map((s) => ({ id: s.id, type: s.type, position: { x: s.x * X, y: (s.y ?? 0) * 160 }, data: s.data }));
  const edges: AutomationEdge[] = links.map(([source, target, h]) => ({ id: `e-${source}-${target}${h ? "-" + h : ""}`, source, target, sourceHandle: h ?? null }));
  return { nodes, edges };
}

function linear(trigger: Record<string, unknown>, steps: { type: AutomationNodeType; data: Record<string, unknown> }[]) {
  const all = [{ id: "trigger", type: "trigger" as const, data: trigger, x: 0 }, ...steps.map((s, i) => ({ id: `n${i + 1}`, ...s, x: i + 1 }))];
  return graph(all, all.slice(1).map((s, i) => [all[i].id, s.id] as [string, string]));
}

const speed = graph(
  [
    { id: "trigger", type: "trigger", data: { trigger_type: "lead_created", stop_on_reply: true }, x: 0 },
    { id: "sms1", type: "send_sms", data: { message: "Hey {{first_name}}, it's {{rep_name}} from {{agency_name}} — just got your request! Want to grab a quick call? Pick a time here: {{booking_link}}", quiet_hours: false }, x: 1 },
    { id: "email1", type: "send_email", data: { subject: "Thanks for reaching out, {{first_name}}", body: "Hi {{first_name}},\n\nThanks for your interest in {{agency_name}}. We help businesses like {{company}} put AI to work — saving hours every week and capturing more revenue.\n\nThe fastest next step is a quick strategy call: {{booking_link}}\n\nTalk soon,\n{{rep_name}}" }, x: 2 },
    { id: "wait1", type: "wait", data: { amount: 5, unit: "minutes" }, x: 3 },
    { id: "if1", type: "condition", data: { match: "any", rules: [{ kind: "booked" }, { kind: "replied" }] }, x: 4 },
    { id: "end1", type: "end", data: {}, x: 5, y: -1 },
    { id: "sms2", type: "send_sms", data: { message: "{{first_name}}, did you get a chance to pick a time? Takes 30 seconds: {{booking_link}}", quiet_hours: true }, x: 5, y: 1 },
    { id: "wait2", type: "wait", data: { amount: 1, unit: "days", until_time: "10:00" }, x: 6, y: 1 },
    { id: "email2", type: "send_email", data: { subject: "Quick question, {{first_name}}", body: "Hi {{first_name}},\n\nWhat's the #1 process at {{company}} you wish ran on autopilot? Reply and I'll send a couple of ideas — or book a time: {{booking_link}}\n\n{{rep_name}}" }, x: 7, y: 1 },
    { id: "wait3", type: "wait", data: { amount: 2, unit: "days", until_time: "11:00", weekdays_only: true }, x: 8, y: 1 },
    { id: "if2", type: "condition", data: { match: "any", rules: [{ kind: "booked" }] }, x: 9, y: 1 },
    { id: "end2", type: "end", data: {}, x: 10, y: 0 },
    { id: "sms3", type: "send_sms", data: { message: "Hey {{first_name}} — still interested in automating some of your workflow? Happy to do a free 15-min audit: {{booking_link}}", quiet_hours: true }, x: 10, y: 2 },
    { id: "wait4", type: "wait", data: { amount: 4, unit: "days", until_time: "10:00", weekdays_only: true }, x: 11, y: 2 },
    { id: "email3", type: "send_email", data: { subject: "Should I close your file?", body: "Hi {{first_name}},\n\nI haven't heard back so I'll assume now isn't the right time. If that changes, grab a time here anytime: {{booking_link}}\n\nAll the best,\n{{rep_name}}" }, x: 12, y: 2 },
    { id: "task", type: "create_task", data: { title: "Call {{full_name}} — finished nurture without booking", due_days: 0, priority: "medium", assignee: "owner" }, x: 13, y: 2 },
  ],
  [["trigger", "sms1"], ["sms1", "email1"], ["email1", "wait1"], ["wait1", "if1"], ["if1", "end1", "yes"], ["if1", "sms2", "no"], ["sms2", "wait2"], ["wait2", "email2"], ["email2", "wait3"], ["wait3", "if2"], ["if2", "end2", "yes"], ["if2", "sms3", "no"], ["sms3", "wait4"], ["wait4", "email3"], ["email3", "task"]],
);

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: "speed_to_lead",
    name: "Speed-to-lead nurture",
    description: "Instant SMS + email, 5-minute check, then day 1 / 3 / 7 follow-ups until they book or reply.",
    trigger_type: "lead_created",
    trigger_config: { stop_on_reply: true },
    ...speed,
  },
  {
    key: "no_show",
    name: "No-show recovery",
    description: "When a contact is tagged no-show: text, email a rebook link, then alert the rep.",
    trigger_type: "tag_added",
    trigger_config: { tag: "no-show", stop_on_reply: true },
    ...linear({ trigger_type: "tag_added", tag: "no-show", stop_on_reply: true }, [
      { type: "send_sms", data: { message: "Hey {{first_name}}, sorry we missed you today! Life happens — here's a link to grab a new time: {{booking_link}}", quiet_hours: true } },
      { type: "wait", data: { amount: 2, unit: "hours" } },
      { type: "send_email", data: { subject: "Let's find a better time", body: "Hi {{first_name}},\n\nWe missed you on our call — no worries at all. You can reschedule in a couple clicks here: {{booking_link}}\n\n{{rep_name}}" } },
      { type: "wait", data: { amount: 1, unit: "days", until_time: "10:00" } },
      { type: "send_sms", data: { message: "{{first_name}}, still want to chat? {{booking_link}}", quiet_hours: true } },
      { type: "notify", data: { to: "owner", title: "No-show still hasn't rebooked: {{full_name}}", body: "Give them a call." } },
      { type: "create_task", data: { title: "Call no-show {{full_name}}", due_days: 0, priority: "high", assignee: "owner" } },
    ]),
  },
  {
    key: "post_booking",
    name: "Post-booking confirmation",
    description: "When someone books on Calendly: move the deal to Booked, confirm by SMS + email, and alert the rep.",
    trigger_type: "booking_created",
    trigger_config: { stop_on_reply: false },
    ...linear({ trigger_type: "booking_created", stop_on_reply: false }, [
      { type: "move_stage", data: { stage_key: "booked", create_if_missing: true } },
      { type: "send_sms", data: { message: "You're booked, {{first_name}}! 🎉 Looking forward to chatting. Reply here if anything changes.", quiet_hours: false } },
      { type: "send_email", data: { subject: "You're confirmed — a few quick questions", body: "Hi {{first_name}},\n\nThanks for booking with {{agency_name}}! To make the most of our time, reply with:\n\n1. What's your biggest bottleneck right now?\n2. What tools does {{company}} use today?\n3. What would a win look like in 90 days?\n\nSee you soon,\n{{rep_name}}" } },
      { type: "notify", data: { to: "owner", title: "New booking: {{full_name}}", body: "{{company}} just booked a call." } },
    ]),
  },
  {
    key: "onboarding",
    name: "Onboarding welcome sequence",
    description: "When a contract is signed: welcome email + SMS with the onboarding call link, kickoff task, reminder if not booked.",
    trigger_type: "contract_signed",
    trigger_config: { stop_on_reply: false },
    ...graph(
      [
        { id: "trigger", type: "trigger", data: { trigger_type: "contract_signed", stop_on_reply: false }, x: 0 },
        { id: "email", type: "send_email", data: { subject: "Welcome to {{agency_name}}, {{first_name}}! 🚀", body: "Hi {{first_name}},\n\nWelcome aboard — we're thrilled to be working with {{company}}.\n\nFirst step: book your onboarding kickoff here: {{onboarding_link}}\n\nOn that call we'll collect access, walk through the plan, and set milestones.\n\n{{rep_name}}" }, x: 1 },
        { id: "sms", type: "send_sms", data: { message: "Welcome to {{agency_name}}, {{first_name}}! Book your kickoff call here: {{onboarding_link}}", quiet_hours: true }, x: 2 },
        { id: "task", type: "create_task", data: { title: "Prepare kickoff for {{company}}", due_days: 1, priority: "high", assignee: "owner" }, x: 3 },
        { id: "wait", type: "wait", data: { amount: 2, unit: "days", until_time: "10:00", weekdays_only: true }, x: 4 },
        { id: "if", type: "condition", data: { match: "any", rules: [{ kind: "booked" }] }, x: 5 },
        { id: "end", type: "end", data: {}, x: 6, y: -1 },
        { id: "sms2", type: "send_sms", data: { message: "Hi {{first_name}}, friendly reminder to grab your onboarding kickoff slot so we can get started: {{onboarding_link}}", quiet_hours: true }, x: 6, y: 1 },
        { id: "notify", type: "notify", data: { to: "both", title: "{{company}} hasn't booked onboarding", body: "Reach out to {{full_name}} directly." }, x: 7, y: 1 },
      ],
      [["trigger", "email"], ["email", "sms"], ["sms", "task"], ["task", "wait"], ["wait", "if"], ["if", "end", "yes"], ["if", "sms2", "no"], ["sms2", "notify"]],
    ),
  },
  {
    key: "invoice_paid",
    name: "Invoice paid thank-you",
    description: "Thank the client when a payment lands and notify admins.",
    trigger_type: "invoice_paid",
    trigger_config: { stop_on_reply: false },
    ...linear({ trigger_type: "invoice_paid", stop_on_reply: false }, [
      { type: "send_email", data: { subject: "Payment received — thank you!", body: "Hi {{first_name}},\n\nJust confirming we received your payment. Thank you for trusting {{agency_name}}!\n\nIf you have any questions, just reply to this email.\n\n{{rep_name}}" } },
      { type: "notify", data: { to: "admins", title: "Payment received from {{full_name}}", body: "{{company}}" } },
    ]),
  },
];

export function blankAutomation() {
  return {
    trigger_type: "lead_created" as AutomationTrigger,
    trigger_config: { stop_on_reply: true },
    nodes: [{ id: "trigger", type: "trigger" as const, position: { x: 0, y: 0 }, data: { trigger_type: "lead_created", stop_on_reply: true } }],
    edges: [] as AutomationEdge[],
  };
}
