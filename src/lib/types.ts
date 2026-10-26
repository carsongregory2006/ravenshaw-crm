// Row types mirroring supabase/migrations/*_init.sql. Keep in sync with the schema.

export type UserRole = "admin" | "sales_rep" | "ops";
export type ContactStatus = "lead" | "prospect" | "client" | "churned" | "unqualified";
export type LineItemType = "one_time" | "recurring" | "milestone";
export type ClientStatus = "onboarding" | "active" | "paused" | "churned";
export type ContractStatus = "draft" | "sent" | "viewed" | "completed" | "declined" | "voided" | "error";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void" | "error";
export type CommissionStatus = "pending" | "approved" | "paid" | "clawed_back";
export type PlClass =
  | "cogs" | "payroll" | "marketing" | "software" | "opex" | "tax" | "interest"
  | "depreciation" | "amortization" | "owner_draw" | "transfer" | "other";
export type ActivityType =
  | "note" | "email" | "sms" | "call" | "meeting" | "task" | "stage_change"
  | "contract" | "invoice" | "payment" | "system" | "ai" | "form";
export type Channel = "sms" | "email";
export type Direction = "inbound" | "outbound";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  available_for_rr: boolean;
  commission_rate_setup: number;
  commission_rate_recurring: number;
  commission_recurring_months: number | null;
  timezone: string;
  created_at: string;
}

export interface WorkspaceSettings {
  id: 1;
  name: string;
  logo_url: string | null;
  timezone: string;
  currency: string;
  ai_model: string;
  deal_number_prefix: string;
  email_from_name: string | null;
  email_from_address: string | null;
  sms_from_number: string | null;
  default_calendly_url: string | null;
  onboarding_calendly_url: string | null;
  pandadoc_template_id: string | null;
  invoice_due_days: number;
  monthly_overhead_budget: number | null;
  tax_rate_estimate: number | null;
  onboarding_checklist: string[];
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  key: string;
  name: string;
  position: number;
  color: string;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employees: number | null;
  annual_revenue: number | null;
  phone: string | null;
  address: string | null;
  linkedin_url: string | null;
  owner_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  company_id: string | null;
  status: ContactStatus;
  source: string | null;
  landing_page_id: string | null;
  variant_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  owner_id: string | null;
  tags: string[];
  lead_score: number | null;
  do_not_contact: boolean;
  phone_bad: boolean;
  phone_bad_at: string | null;
  folder_id: string | null;
  folder_updated_at: string | null;
  sms_opt_out: boolean;
  email_opt_out: boolean;
  ai_summary: string | null;
  ai_summary_at: string | null;
  custom_fields: Record<string, unknown>;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  deal_number: string;
  name: string;
  contact_id: string | null;
  company_id: string | null;
  owner_id: string | null;
  stage_id: string;
  amount_one_time: number;
  amount_recurring: number;
  term_months: number | null;
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  source: string | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface DealLineItem {
  id: string;
  deal_id: string;
  name: string;
  description: string | null;
  type: LineItemType;
  unit_price: number;
  quantity: number;
  interval_months: number;
  billing_cycles: number | null;
  due_on: string | null;
  position: number;
}

export interface Client {
  id: string;
  contact_id: string;
  company_id: string | null;
  deal_id: string | null;
  account_manager_id: string | null;
  status: ClientStatus;
  start_date: string;
  mrr: number;
  health_score: number | null;
  mercury_customer_id: string | null;
  stripe_customer_id: string | null;
  churned_at: string | null;
  churn_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingStep {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  position: number;
  due_date: string | null;
  assignee_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

export interface Contract {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  name: string;
  pandadoc_document_id: string | null;
  pandadoc_template_id: string | null;
  status: ContractStatus;
  document_url: string | null;
  error: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  deal_id: string | null;
  client_id: string | null;
  contact_id: string | null;
  line_item_id: string | null;
  kind: LineItemType;
  description: string | null;
  amount: number;
  status: InvoiceStatus;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  mercury_invoice_id: string | null;
  mercury_customer_id: string | null;
  stripe_invoice_id: string | null;
  stripe_customer_id: string | null;
  payment_url: string | null;
  error: string | null;
  created_at: string;
}

export interface BillingSchedule {
  id: string;
  client_id: string | null;
  deal_id: string | null;
  line_item_id: string | null;
  description: string;
  amount: number;
  interval_months: number;
  next_invoice_date: string;
  cycles_remaining: number | null;
  active: boolean;
  created_at: string;
}

export interface MercuryTransaction {
  id: string;
  account_id: string | null;
  amount: number;
  status: string | null;
  kind: string | null;
  counterparty_name: string | null;
  bank_description: string | null;
  note: string | null;
  posted_at: string | null;
  created_at: string | null;
  raw: unknown;
  pl_class: PlClass | null;
  category: string | null;
  matched_invoice_id: string | null;
  ignored: boolean;
  synced_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string | null;
  client_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  amount: number;
  kind: LineItemType;
  received_at: string;
  method: string | null;
  mercury_transaction_id: string | null;
  stripe_payment_ref: string | null;
  note: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  date: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  pl_class: PlClass;
  category: string | null;
  client_id: string | null;
  mercury_transaction_id: string | null;
  recurring: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ExpenseRule {
  id: string;
  match: string;
  pl_class: PlClass;
  category: string | null;
  created_at: string;
}

export interface MarketingSpend {
  id: string;
  date: string;
  channel: string;
  campaign: string | null;
  landing_page_id: string | null;
  amount: number;
  impressions: number | null;
  clicks: number | null;
  created_at: string;
}

export interface Commission {
  id: string;
  rep_id: string;
  payment_id: string | null;
  deal_id: string | null;
  client_id: string | null;
  basis: LineItemType;
  base_amount: number;
  rate: number;
  amount: number;
  status: CommissionStatus;
  payout_id: string | null;
  note: string | null;
  created_at: string;
}

export interface CommissionPayout {
  id: string;
  rep_id: string;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
  created_by: string | null;
}

export interface Message {
  id: string;
  contact_id: string | null;
  channel: Channel;
  direction: Direction;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  body: string | null;
  html: string | null;
  status: string;
  provider_id: string | null;
  error: string | null;
  sent_by: string | null;
  automation_run_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Call {
  id: string;
  contact_id: string | null;
  user_id: string | null;
  direction: Direction;
  from_number: string | null;
  to_number: string | null;
  status: string;
  duration_sec: number | null;
  recording_url: string | null;
  telnyx_call_id: string | null;
  disposition: string | null;
  notes: string | null;
  transcript: string | null;
  ai_summary: string | null;
  started_at: string;
  ended_at: string | null;
  dial_session_id: string | null;
  voicemail_drop_id: string | null;
  voicemail_path: string | null;
  voicemail_duration_sec: number | null;
}

export type FolderKey = "new" | "attempted" | "contacted" | "callback" | "interested" | "not_interested" | "bad_dnc";

export interface ContactFolder {
  id: string;
  name: string;
  color: string;
  system_key: FolderKey | null;
  position: number;
  created_by: string | null;
  created_at: string;
}

export interface LeadList {
  id: string;
  name: string;
  source: string;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface LeadListItem {
  id: string;
  list_id: string;
  contact_id: string;
  position: number;
  notes: string | null;
  status: "pending" | "called" | "skipped";
  last_outcome: string | null;
  last_called_at: string | null;
}

export interface VoicemailDrop {
  id: string;
  name: string;
  storage_path: string;
  duration_sec: number | null;
  created_by: string | null;
  created_at: string;
}

export interface DialSession {
  id: string;
  user_id: string | null;
  list_id: string | null;
  name: string | null;
  from_mode: "fixed" | "local";
  from_number: string | null;
  queue: string[];
  position: number;
  skipped: string[];
  conversation_threshold_sec: number;
  advance_delay_sec: number;
  voicemail_drop_id: string | null;
  started_at: string;
  ended_at: string | null;
  stats: import("@/lib/dialer/stats").DialStats | null;
}

export interface Template {
  id: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  contact_id: string | null;
  deal_id: string | null;
  company_id: string | null;
  client_id: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  completed_at: string | null;
  assignee_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  client_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CalendarRow {
  id: string;
  owner_id: string | null;
  name: string;
  color: string;
  source: "internal" | "google" | "calendly";
  google_calendar_id: string | null;
  sync_token: string | null;
  is_visible: boolean;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurrence: string | null;
  color: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  attendees: { email: string; name?: string; status?: string }[];
  reminders: { minutes: number }[];
  contact_id: string | null;
  deal_id: string | null;
  external_source: string | null;
  external_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A landing page is a list of typed sections. */
export type LandingSection =
  | { id: string; type: "hero"; headline: string; subheadline?: string; cta?: string; image?: string; align?: "left" | "center" }
  | { id: string; type: "features"; heading?: string; items: { title: string; body: string; icon?: string }[] }
  | { id: string; type: "social_proof"; heading?: string; logos?: string[]; testimonials?: { quote: string; name: string; role?: string }[] }
  | { id: string; type: "stats"; items: { value: string; label: string }[] }
  | { id: string; type: "faq"; heading?: string; items: { q: string; a: string }[] }
  | { id: string; type: "form"; heading?: string; subheading?: string; button?: string; fields: ("first_name" | "last_name" | "email" | "phone" | "company" | "website" | "message")[] }
  | { id: string; type: "cta"; headline: string; body?: string; button?: string }
  | { id: string; type: "video"; url: string; heading?: string }
  | { id: string; type: "rich_text"; markdown: string };

export interface LandingPage {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  seo_title: string | null;
  seo_description: string | null;
  rr_enabled: boolean;
  rr_mode: "weighted" | "strict";
  default_owner_id: string | null;
  after_submit: "message" | "redirect" | "calendly";
  success_message: string | null;
  redirect_url: string | null;
  calendly_url: string | null;
  theme: { accent: string; font: string; mode: "light" | "dark" };
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LandingPageVariant {
  id: string;
  page_id: string;
  name: string;
  is_control: boolean;
  is_active: boolean;
  weight: number;
  sections: LandingSection[];
  created_at: string;
  updated_at: string;
}

export interface RrMember {
  id: string;
  page_id: string | null;
  rep_id: string;
  weight: number;
  active: boolean;
  assigned_count: number;
  last_assigned_at: string | null;
}

export type AutomationTrigger =
  | "lead_created"      // any new contact (config: { page_id?, source? })
  | "form_submitted"    // landing page form (config: { page_id? })
  | "stage_changed"     // deal stage (config: { stage_key? })
  | "tag_added"         // config: { tag }
  | "contract_signed"
  | "invoice_paid"
  | "booking_created"   // calendly
  | "inbound_sms"
  | "inbound_email"
  | "manual";

export type AutomationNodeType =
  | "trigger" | "send_sms" | "send_email" | "wait" | "condition" | "update_contact"
  | "add_tag" | "remove_tag" | "assign_owner" | "create_task" | "move_stage" | "notify" | "ai_generate" | "webhook" | "end";

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // "yes" | "no" for conditions
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, unknown>;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  allow_reentry: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  contact_id: string | null;
  deal_id: string | null;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  current_node_id: string | null;
  next_run_at: string;
  context: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AutomationRunLog {
  id: string;
  run_id: string;
  node_id: string | null;
  node_type: string | null;
  status: string;
  message: string | null;
  created_at: string;
}
