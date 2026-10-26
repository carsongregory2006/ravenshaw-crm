-- Ravenshaw CRM: all migrations combined. Paste into Supabase → SQL Editor → Run (once, on a fresh project).

-- ===== 20261022000000_init.sql =====
-- Ravenshaw AI CRM — initial schema
create extension if not exists "pgcrypto";
create extension if not exists "pg_net";
create extension if not exists "pg_cron";

-- ───────────────────────── Enums ─────────────────────────
create type user_role as enum ('admin', 'sales_rep', 'ops');
create type contact_status as enum ('lead', 'prospect', 'client', 'churned', 'unqualified');
create type line_item_type as enum ('one_time', 'recurring', 'milestone');
create type client_status as enum ('onboarding', 'active', 'paused', 'churned');
create type contract_status as enum ('draft', 'sent', 'viewed', 'completed', 'declined', 'voided', 'error');
create type invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'void', 'error');
create type commission_status as enum ('pending', 'approved', 'paid', 'clawed_back');
create type pl_class as enum ('cogs', 'payroll', 'marketing', 'software', 'opex', 'tax', 'interest', 'depreciation', 'amortization', 'owner_draw', 'transfer', 'other');
create type activity_type as enum ('note', 'email', 'sms', 'call', 'meeting', 'task', 'stage_change', 'contract', 'invoice', 'payment', 'system', 'ai', 'form');
create type msg_channel as enum ('sms', 'email');
create type msg_direction as enum ('inbound', 'outbound');
create type automation_status as enum ('draft', 'active', 'paused');
create type run_status as enum ('running', 'waiting', 'completed', 'failed', 'cancelled');

-- ───────────────────────── Users ─────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  phone text,
  role user_role not null default 'sales_rep',
  is_active boolean not null default true,
  available_for_rr boolean not null default true,
  commission_rate_setup numeric(6,4) not null default 0.10,      -- 10% of one-time/milestone cash collected
  commission_rate_recurring numeric(6,4) not null default 0.10,  -- 10% of recurring cash collected
  commission_recurring_months int,                               -- null = forever
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create or replace function public.current_user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin') from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_staff() returns boolean  -- admin or ops: sees everything
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','ops') from profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists(select 1 from profiles) into first_user;
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when first_user then 'admin'::user_role
               else coalesce((new.raw_user_meta_data->>'role')::user_role, 'sales_rep') end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Workspace ─────────────────────────
create table workspace_settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'Ravenshaw AI',
  logo_url text,
  timezone text not null default 'America/New_York',
  currency text not null default 'USD',
  ai_model text not null default 'anthropic/claude-sonnet-4.5',
  deal_number_prefix text not null default 'RAV',
  email_from_name text default 'Ravenshaw AI',
  email_from_address text,
  sms_from_number text,
  default_calendly_url text,
  onboarding_calendly_url text,
  pandadoc_template_id text,
  invoice_due_days int not null default 7,
  monthly_overhead_budget numeric(14,2) default 0,
  tax_rate_estimate numeric(6,4) default 0.25,
  onboarding_checklist jsonb not null default '["Kickoff call booked","Access & credentials collected","Discovery questionnaire completed","Project plan delivered","Build started","First deliverable shipped","30-day review"]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into workspace_settings (id) values (1);

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  position int not null,
  color text not null default 'gray',
  probability int not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false
);
insert into pipeline_stages (key, name, position, color, probability, is_won, is_lost) values
  ('new','New',0,'gray',5,false,false),
  ('contacted','Contacted',1,'blue',10,false,false),
  ('booked','Booked',2,'sky',25,false,false),
  ('showed','Showed',3,'purple',40,false,false),
  ('proposal','Proposal',4,'orange',60,false,false),
  ('contract_sent','Contract Sent',5,'yellow',80,false,false),
  ('won','Won',6,'green',100,true,false),
  ('lost','Lost',7,'red',0,false,true);

-- ───────────────────────── Core CRM ─────────────────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  website text,
  industry text,
  employees int,
  annual_revenue numeric(14,2),
  phone text,
  address text,
  linkedin_url text,
  owner_id uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table landing_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  seo_title text,
  seo_description text,
  rr_enabled boolean not null default true,
  rr_mode text not null default 'weighted' check (rr_mode in ('weighted','strict')),
  default_owner_id uuid references profiles(id) on delete set null,
  after_submit text not null default 'calendly' check (after_submit in ('message','redirect','calendly')),
  success_message text default 'Thanks! We''ll be in touch shortly.',
  redirect_url text,
  calendly_url text,
  theme jsonb not null default '{"accent":"#1961ED","font":"Inter","mode":"light"}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table landing_page_variants (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references landing_pages(id) on delete cascade,
  name text not null default 'Variant A',
  is_control boolean not null default false,
  is_active boolean not null default true,
  weight int not null default 50 check (weight >= 0),
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  title text,
  company_id uuid references companies(id) on delete set null,
  status contact_status not null default 'lead',
  source text,
  landing_page_id uuid references landing_pages(id) on delete set null,
  variant_id uuid references landing_page_variants(id) on delete set null,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  owner_id uuid references profiles(id) on delete set null,
  tags text[] not null default '{}',
  lead_score int default 0,
  do_not_contact boolean not null default false,
  sms_opt_out boolean not null default false,
  email_opt_out boolean not null default false,
  ai_summary text,
  ai_summary_at timestamptz,
  custom_fields jsonb not null default '{}'::jsonb,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on contacts (owner_id);
create index on contacts (lower(email));
create index on contacts (phone);
create index on contacts (status);

create sequence deal_number_seq start 1001;
create table deals (
  id uuid primary key default gen_random_uuid(),
  deal_number text unique not null default ('RAV-' || nextval('deal_number_seq')),
  name text not null,
  contact_id uuid references contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  owner_id uuid references profiles(id) on delete set null,
  stage_id uuid not null references pipeline_stages(id),
  amount_one_time numeric(14,2) not null default 0,
  amount_recurring numeric(14,2) not null default 0,   -- monthly recurring
  term_months int default 12,
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text,
  source text,
  notes text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on deals (stage_id);
create index on deals (owner_id);
create index on deals (contact_id);

create table deal_line_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  name text not null,
  description text,
  type line_item_type not null default 'one_time',
  unit_price numeric(14,2) not null default 0,
  quantity int not null default 1,
  interval_months int not null default 1,       -- for recurring
  billing_cycles int,                            -- recurring: null = until cancelled
  due_on date,                                   -- for milestones
  position int not null default 0
);

-- keep deal totals in sync with line items
create or replace function public.sync_deal_amounts() returns trigger
language plpgsql security definer set search_path = public as $$
declare d uuid := coalesce(new.deal_id, old.deal_id);
begin
  update deals set
    amount_one_time = coalesce((select sum(unit_price*quantity) from deal_line_items where deal_id=d and type in ('one_time','milestone')),0),
    amount_recurring = coalesce((select sum(unit_price*quantity/greatest(interval_months,1)) from deal_line_items where deal_id=d and type='recurring'),0),
    updated_at = now()
  where id = d;
  return null;
end $$;
create trigger deal_line_items_sync after insert or update or delete on deal_line_items
  for each row execute function public.sync_deal_amounts();

create table clients (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  account_manager_id uuid references profiles(id) on delete set null,
  status client_status not null default 'onboarding',
  start_date date not null default current_date,
  mrr numeric(14,2) not null default 0,
  health_score int default 80,
  mercury_customer_id text,
  churned_at timestamptz,
  churn_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on clients (deal_id) where deal_id is not null;

create table onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  description text,
  position int not null default 0,
  due_date date,
  assignee_id uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references profiles(id) on delete set null
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  name text not null,
  pandadoc_document_id text unique,
  pandadoc_template_id text,
  status contract_status not null default 'draft',
  document_url text,
  error text,
  sent_at timestamptz,
  viewed_at timestamptz,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create sequence invoice_number_seq start 1001;
create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null default ('INV-' || nextval('invoice_number_seq')),
  deal_id uuid references deals(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  line_item_id uuid references deal_line_items(id) on delete set null,
  kind line_item_type not null default 'one_time',
  description text,
  amount numeric(14,2) not null,
  status invoice_status not null default 'draft',
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  period_start date,
  period_end date,
  mercury_invoice_id text unique,
  mercury_customer_id text,
  payment_url text,
  error text,
  created_at timestamptz not null default now()
);
create index on invoices (status);

create table billing_schedules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  line_item_id uuid references deal_line_items(id) on delete cascade,
  description text not null,
  amount numeric(14,2) not null,
  interval_months int not null default 1,
  next_invoice_date date not null,
  cycles_remaining int,  -- null = until cancelled
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table mercury_transactions (
  id text primary key,
  account_id text,
  amount numeric(14,2) not null,       -- positive = money in
  status text,
  kind text,
  counterparty_name text,
  bank_description text,
  note text,
  posted_at timestamptz,
  created_at timestamptz,
  raw jsonb,
  pl_class pl_class,
  category text,
  matched_invoice_id uuid references invoices(id) on delete set null,
  ignored boolean not null default false,
  synced_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  amount numeric(14,2) not null,
  kind line_item_type not null default 'one_time',
  received_at timestamptz not null default now(),
  method text default 'mercury',
  mercury_transaction_id text unique references mercury_transactions(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  amount numeric(14,2) not null check (amount >= 0),
  vendor text,
  description text,
  pl_class pl_class not null default 'opex',
  category text,
  client_id uuid references clients(id) on delete set null,
  mercury_transaction_id text unique references mercury_transactions(id) on delete set null,
  recurring boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- vendor → category rules for auto-categorizing Mercury expenses
create table expense_rules (
  id uuid primary key default gen_random_uuid(),
  match text not null,               -- case-insensitive substring of counterparty
  pl_class pl_class not null,
  category text,
  created_at timestamptz not null default now()
);

create table marketing_spend (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  channel text not null,             -- e.g. facebook, google, linkedin
  campaign text,
  landing_page_id uuid references landing_pages(id) on delete set null,
  amount numeric(14,2) not null,
  impressions int, clicks int,
  created_at timestamptz not null default now()
);

create table commissions (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references profiles(id) on delete cascade,
  payment_id uuid references payments(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  basis line_item_type not null,
  base_amount numeric(14,2) not null,
  rate numeric(6,4) not null,
  amount numeric(14,2) not null,
  status commission_status not null default 'pending',
  payout_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create unique index on commissions (payment_id, rep_id);

create table commission_payouts (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references profiles(id) on delete cascade,
  amount numeric(14,2) not null,
  paid_at timestamptz not null default now(),
  method text,
  note text,
  created_by uuid references profiles(id) on delete set null
);
alter table commissions add constraint commissions_payout_fk foreign key (payout_id) references commission_payouts(id) on delete set null;

-- ───────────────────────── Communications ─────────────────────────
create table messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  channel msg_channel not null,
  direction msg_direction not null,
  from_addr text,
  to_addr text,
  subject text,
  body text,
  html text,
  status text not null default 'queued',  -- queued|sent|delivered|failed|received|opened|clicked|bounced
  provider_id text,
  error text,
  sent_by uuid references profiles(id) on delete set null,
  automation_run_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (contact_id, created_at desc);
create index on messages (provider_id);

create table calls (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  direction msg_direction not null default 'outbound',
  from_number text,
  to_number text,
  status text not null default 'initiated', -- initiated|ringing|answered|completed|missed|failed|voicemail
  duration_sec int,
  recording_url text,
  telnyx_call_id text,
  disposition text,                          -- connected|no_answer|voicemail|wrong_number|booked|not_interested
  notes text,
  transcript text,
  ai_summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on calls (contact_id, started_at desc);
create index on calls (telnyx_call_id);

create table templates (
  id uuid primary key default gen_random_uuid(),
  channel msg_channel not null,
  name text not null,
  subject text,
  body text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  type activity_type not null,
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on activities (contact_id, created_at desc);
create index on activities (deal_id, created_at desc);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  completed_at timestamptz,
  assignee_id uuid references profiles(id) on delete set null,
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

-- ───────────────────────── Calendar ─────────────────────────
create table calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  name text not null,
  color text not null default '#1a73e8',
  source text not null default 'internal' check (source in ('internal','google','calendly')),
  google_calendar_id text,
  sync_token text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id) on delete cascade,
  title text not null default '(No title)',
  description text,
  location text,
  meeting_url text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  recurrence text,                   -- RRULE string
  color text,
  status text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled')),
  attendees jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[{"minutes":10}]'::jsonb,
  contact_id uuid references contacts(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  external_source text,              -- google|calendly
  external_id text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on calendar_events (external_source, external_id) where external_id is not null;
create index on calendar_events (start_at);

create table google_accounts (
  user_id uuid primary key references profiles(id) on delete cascade,
  email text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Landing pages & routing ─────────────────────────
create table landing_page_events (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references landing_pages(id) on delete cascade,
  variant_id uuid references landing_page_variants(id) on delete set null,
  visitor_id text,
  type text not null check (type in ('view','conversion','cta_click','booking')),
  contact_id uuid references contacts(id) on delete set null,
  referrer text,
  utm jsonb,
  created_at timestamptz not null default now()
);
create index on landing_page_events (page_id, type, created_at);
create index on landing_page_events (variant_id, type);

create table rr_members (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references landing_pages(id) on delete cascade,  -- null = global pool
  rep_id uuid not null references profiles(id) on delete cascade,
  weight int not null default 1 check (weight >= 0),
  active boolean not null default true,
  assigned_count int not null default 0,
  last_assigned_at timestamptz,
  unique (page_id, rep_id)
);

-- Picks the next rep for a page (weighted = lowest assigned/weight ratio; strict = least recently assigned).
create or replace function public.rr_next_rep(p_page_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_mode text; v_member rr_members%rowtype;
begin
  select rr_mode into v_mode from landing_pages where id = p_page_id;
  select m.* into v_member from rr_members m join profiles p on p.id = m.rep_id
   where m.page_id is not distinct from p_page_id and m.active and m.weight > 0 and p.is_active and p.available_for_rr
   order by case when coalesce(v_mode,'weighted') = 'weighted' then (m.assigned_count + 1)::numeric / m.weight else 0 end,
            m.last_assigned_at nulls first
   limit 1 for update of m;
  if v_member.id is null and p_page_id is not null then
    return rr_next_rep(null);
  end if;
  if v_member.id is null then return null; end if;
  update rr_members set assigned_count = assigned_count + 1, last_assigned_at = now() where id = v_member.id;
  return v_member.rep_id;
end $$;

-- ───────────────────────── Automations ─────────────────────────
create table automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status automation_status not null default 'draft',
  trigger_type text not null default 'lead_created',
  trigger_config jsonb not null default '{}'::jsonb,
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  allow_reentry boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  status run_status not null default 'running',
  current_node_id text,
  next_run_at timestamptz not null default now(),
  context jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on automation_runs (status, next_run_at);
create index on automation_runs (automation_id, contact_id);

create table automation_run_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references automation_runs(id) on delete cascade,
  node_id text,
  node_type text,
  status text not null,  -- ok|error|skipped|waiting
  message text,
  created_at timestamptz not null default now()
);
create index on automation_run_logs (run_id, created_at);

-- ───────────────────────── Misc ─────────────────────────
create table saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  object text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text,
  external_id text,
  payload jsonb,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create unique index on webhook_events (provider, external_id) where external_id is not null;

-- updated_at triggers
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['companies','contacts','deals','clients','landing_pages','landing_page_variants','automations','calendar_events','workspace_settings'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- deal stage change → activity log + closed_at
create or replace function public.deal_stage_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare s_old text; s_new text; won bool; lost bool;
begin
  if new.stage_id is distinct from old.stage_id then
    select name into s_old from pipeline_stages where id = old.stage_id;
    select name, is_won, is_lost into s_new, won, lost from pipeline_stages where id = new.stage_id;
    if (won or lost) and new.closed_at is null then new.closed_at = now(); end if;
    if not (won or lost) then new.closed_at = null; end if;
    insert into activities (type, deal_id, contact_id, title, metadata, actor_id)
    values ('stage_change', new.id, new.contact_id, format('Stage changed: %s → %s', s_old, s_new),
            jsonb_build_object('from', s_old, 'to', s_new), auth.uid());
  end if;
  return new;
end $$;
create trigger deals_stage_change before update on deals for each row execute function public.deal_stage_changed();

-- ───────────────────────── Row Level Security ─────────────────────────
-- Admin/Ops see everything. Sales reps see records they own (or unassigned leads),
-- and data hanging off those records. Finance tables are staff-only except a rep's own commissions.

create or replace function public.can_see_contact(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from contacts c where c.id = cid and (c.owner_id = auth.uid() or c.owner_id is null)
  ) or exists (select 1 from deals d where d.contact_id = cid and d.owner_id = auth.uid())
$$;

create or replace function public.can_see_deal(did uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from deals d where d.id = did and (d.owner_id = auth.uid() or d.owner_id is null)
  )
$$;

do $$ declare t text; begin
  foreach t in array array[
    'profiles','workspace_settings','pipeline_stages','companies','landing_pages','landing_page_variants','contacts','deals',
    'deal_line_items','clients','onboarding_steps','contracts','invoices','billing_schedules','mercury_transactions','payments',
    'expenses','expense_rules','marketing_spend','commissions','commission_payouts','messages','calls','templates','activities',
    'tasks','notifications','calendars','calendar_events','google_accounts','landing_page_events','rr_members','automations',
    'automation_runs','automation_run_logs','saved_views','webhook_events'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- everyone signed in can read shared reference data
create policy "read profiles" on profiles for select to authenticated using (true);
create policy "update own profile" on profiles for update to authenticated using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());
create policy "admin manage profiles" on profiles for all to authenticated using (is_admin()) with check (is_admin());

create policy "read settings" on workspace_settings for select to authenticated using (true);
create policy "admin settings" on workspace_settings for update to authenticated using (is_admin());

create policy "read stages" on pipeline_stages for select to authenticated using (true);
create policy "admin stages" on pipeline_stages for all to authenticated using (is_admin()) with check (is_admin());

create policy "read templates" on templates for select to authenticated using (true);
create policy "write templates" on templates for all to authenticated using (true) with check (true);

create policy "companies all" on companies for all to authenticated using (true) with check (true);

create policy "contacts select" on contacts for select to authenticated using (can_see_contact(id));
create policy "contacts insert" on contacts for insert to authenticated with check (true);
create policy "contacts update" on contacts for update to authenticated using (can_see_contact(id));
create policy "contacts delete" on contacts for delete to authenticated using (is_staff() or owner_id = auth.uid());

create policy "deals select" on deals for select to authenticated using (can_see_deal(id) or can_see_contact(contact_id));
create policy "deals insert" on deals for insert to authenticated with check (true);
create policy "deals update" on deals for update to authenticated using (can_see_deal(id));
create policy "deals delete" on deals for delete to authenticated using (is_staff() or owner_id = auth.uid());

create policy "line items" on deal_line_items for all to authenticated using (can_see_deal(deal_id)) with check (can_see_deal(deal_id));
create policy "contracts" on contracts for all to authenticated using (can_see_deal(deal_id)) with check (can_see_deal(deal_id));

create policy "clients select" on clients for select to authenticated using (is_staff() or account_manager_id = auth.uid() or can_see_contact(contact_id));
create policy "clients write" on clients for all to authenticated using (is_staff()) with check (is_staff());
create policy "onboarding" on onboarding_steps for all to authenticated
  using (is_staff() or exists (select 1 from clients c where c.id = client_id and (c.account_manager_id = auth.uid() or can_see_contact(c.contact_id))))
  with check (true);

create policy "invoices select" on invoices for select to authenticated using (is_staff() or can_see_deal(deal_id));
create policy "invoices write" on invoices for all to authenticated using (is_staff()) with check (is_staff());

do $$ declare t text; begin
  foreach t in array array['billing_schedules','mercury_transactions','payments','expenses','expense_rules','marketing_spend','commission_payouts','webhook_events'] loop
    execute format('create policy "staff only" on %I for all to authenticated using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;
create policy "rep reads own payouts" on commission_payouts for select to authenticated using (rep_id = auth.uid());

create policy "commissions select" on commissions for select to authenticated using (is_staff() or rep_id = auth.uid());
create policy "commissions write" on commissions for all to authenticated using (is_admin()) with check (is_admin());

create policy "messages" on messages for all to authenticated using (can_see_contact(contact_id)) with check (can_see_contact(contact_id));
create policy "calls" on calls for all to authenticated using (is_staff() or user_id = auth.uid() or can_see_contact(contact_id)) with check (true);
create policy "activities" on activities for all to authenticated
  using (is_staff() or (contact_id is not null and can_see_contact(contact_id)) or (deal_id is not null and can_see_deal(deal_id)) or actor_id = auth.uid())
  with check (true);
create policy "tasks" on tasks for all to authenticated
  using (is_staff() or assignee_id = auth.uid() or created_by = auth.uid()) with check (true);
create policy "own notifications" on notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "calendars" on calendars for all to authenticated using (owner_id = auth.uid() or owner_id is null or is_staff())
  with check (owner_id = auth.uid() or is_staff());
create policy "events" on calendar_events for all to authenticated
  using (exists (select 1 from calendars c where c.id = calendar_id and (c.owner_id = auth.uid() or c.owner_id is null or is_staff())))
  with check (exists (select 1 from calendars c where c.id = calendar_id and (c.owner_id = auth.uid() or c.owner_id is null or is_staff())));
-- google tokens are only touched by the server (service role); users may see that they are connected
create policy "own google account" on google_accounts for select to authenticated using (user_id = auth.uid());

create policy "lp read" on landing_pages for select to authenticated using (true);
create policy "lp write" on landing_pages for all to authenticated using (is_staff()) with check (is_staff());
create policy "lpv read" on landing_page_variants for select to authenticated using (true);
create policy "lpv write" on landing_page_variants for all to authenticated using (is_staff()) with check (is_staff());
create policy "lpe read" on landing_page_events for select to authenticated using (true);
create policy "rr read" on rr_members for select to authenticated using (true);
create policy "rr write" on rr_members for all to authenticated using (is_staff()) with check (is_staff());

create policy "automations read" on automations for select to authenticated using (true);
create policy "automations write" on automations for all to authenticated using (is_staff()) with check (is_staff());
create policy "runs read" on automation_runs for select to authenticated using (is_staff() or can_see_contact(contact_id));
create policy "runs write" on automation_runs for update to authenticated using (is_staff());
create policy "run logs read" on automation_run_logs for select to authenticated using (true);

create policy "views" on saved_views for all to authenticated using (user_id = auth.uid() or user_id is null) with check (user_id = auth.uid());

-- ───────────────────────── Realtime ─────────────────────────
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table messages, calls, notifications, activities;
  end if;
end $$;

-- ───────────────────────── Scheduler ─────────────────────────
-- After deploy, run once (SQL editor) or via the Settings → System page:
--   select public.schedule_crm_tick('https://YOUR-APP.vercel.app', 'YOUR_CRON_SECRET');
create or replace function public.schedule_crm_tick(app_url text, secret text) returns void
language plpgsql security definer set search_path = public, cron as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'crm-tick';
  perform cron.schedule('crm-tick', '* * * * *', format(
    $f$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type','application/json'), body := '{}'::jsonb)$f$,
    rtrim(app_url,'/') || '/api/cron/tick', secret));
end $$;
revoke all on function public.schedule_crm_tick(text, text) from public, anon, authenticated;
grant execute on function public.schedule_crm_tick(text, text) to service_role;

-- non-admins may edit their own profile but not role / commission terms
create or replace function public.guard_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role = old.role;
    new.is_active = old.is_active;
    new.commission_rate_setup = old.commission_rate_setup;
    new.commission_rate_recurring = old.commission_rate_recurring;
    new.commission_recurring_months = old.commission_recurring_months;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on profiles for each row execute function public.guard_profile_fields();

-- ===== 20261022030000_billing.sql =====
-- Billing module: small key/value store for scheduler bookkeeping (e.g. last Mercury sync).
create table if not exists app_kv (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table app_kv enable row level security;
create policy "staff kv" on app_kv for all to authenticated using (is_staff()) with check (is_staff());

create index if not exists invoices_deal_idx on invoices (deal_id);
create index if not exists invoices_client_idx on invoices (client_id);
create index if not exists payments_client_idx on payments (client_id);
create index if not exists commissions_rep_idx on commissions (rep_id, client_id, basis);
create index if not exists billing_schedules_due_idx on billing_schedules (active, next_invoice_date);

-- A single payment can earn a rep both a setup and a recurring commission (mixed first invoice).
drop index if exists commissions_payment_id_rep_id_idx;
create unique index if not exists commissions_payment_rep_basis_idx on commissions (payment_id, rep_id, basis);

-- ===== 20261022040000_analytics.sql =====
-- Analytics: cached AI business briefings (one stream per user; reps get their own scoped briefing)
create table if not exists ai_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null default 'weekly' check (kind in ('weekly','answer')),
  question text,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_briefings_user_idx on ai_briefings (user_id, kind, created_at desc);
alter table ai_briefings enable row level security;
create policy "own briefings" on ai_briefings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- helpful indexes for reporting windows
create index if not exists payments_received_idx on payments (received_at);
create index if not exists expenses_date_idx on expenses (date);
create index if not exists commissions_rep_idx on commissions (rep_id, status);
create index if not exists marketing_spend_date_idx on marketing_spend (date);
create index if not exists mercury_txn_created_idx on mercury_transactions (created_at);
create index if not exists activities_type_idx on activities (type, deal_id);

-- ===== 20261022050000_landing.sql =====
-- Landing page analytics helpers (aggregate in SQL instead of shipping raw events to the app)

create or replace function public.lp_variant_stats(p_page_id uuid default null)
returns table (page_id uuid, variant_id uuid, views bigint, visitors bigint, conversions bigint, cta_clicks bigint, bookings bigint)
language sql stable set search_path = public as $$
  select e.page_id, e.variant_id,
         count(*) filter (where e.type = 'view'),
         count(distinct e.visitor_id) filter (where e.type = 'view'),
         count(*) filter (where e.type = 'conversion'),
         count(*) filter (where e.type = 'cta_click'),
         count(*) filter (where e.type = 'booking')
  from landing_page_events e
  where p_page_id is null or e.page_id = p_page_id
  group by e.page_id, e.variant_id
$$;

create or replace function public.lp_daily_stats(p_page_id uuid, p_days int default 30)
returns table (day date, variant_id uuid, views bigint, conversions bigint)
language sql stable set search_path = public as $$
  select (e.created_at at time zone 'utc')::date, e.variant_id,
         count(*) filter (where e.type = 'view'),
         count(*) filter (where e.type = 'conversion')
  from landing_page_events e
  where e.page_id = p_page_id and e.created_at >= now() - make_interval(days => p_days)
  group by 1, 2
  order by 1
$$;

grant execute on function public.lp_variant_stats(uuid) to authenticated, service_role;
grant execute on function public.lp_daily_stats(uuid, int) to authenticated, service_role;

-- ===== 20261022070000_calendar.sql =====
-- Calendar module additions

-- Google event ids can repeat across calendars; scope external ids to their calendar.
drop index if exists calendar_events_external_source_external_id_idx;
create unique index if not exists calendar_events_calendar_external_uniq
  on calendar_events (calendar_id, external_source, external_id);

-- Google "singleEvents" instances keep a pointer to their recurring master.
alter table calendar_events add column if not exists external_recurring_id text;
alter table calendars add column if not exists last_synced_at timestamptz;
alter table calendars add column if not exists sync_error text;

-- Tracks reminder notifications already sent (per occurrence + reminder offset).
create table if not exists calendar_reminders_sent (
  event_id uuid not null references calendar_events(id) on delete cascade,
  occurrence_start timestamptz not null,
  minutes int not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occurrence_start, minutes)
);
alter table calendar_reminders_sent enable row level security;
-- server-only (service role); no policies for authenticated users

-- ===== 20261022080000_settings.sql =====
-- Deal numbers use the workspace prefix (Settings → General). Existing numbers are unchanged.
create or replace function public.next_deal_number() returns text
language sql volatile security definer set search_path = public as $$
  select coalesce((select nullif(trim(deal_number_prefix), '') from workspace_settings where id = 1), 'RAV') || '-' || nextval('deal_number_seq')
$$;
alter table deals alter column deal_number set default public.next_deal_number();

-- ===== 20261022090000_payment_split.sql =====
-- Portion of each payment attributable to recurring line items (mixed first invoices contain both).
alter table payments add column if not exists recurring_amount numeric(14,2) not null default 0;
update payments set recurring_amount = amount where kind = 'recurring' and recurring_amount = 0;

-- ===== 20261022095000_signup_security.sql =====
-- Signup hardening.
-- * Never trust a role from user-supplied signup metadata (anyone can call auth.signUp with data.role = 'admin').
-- * The first account is the admin. Invited users (invited_at set by Supabase) are active; their role is applied
--   by the server-side invite action. Anyone else who self-registers starts inactive until an admin approves them.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists(select 1 from profiles) into first_user;
  insert into profiles (id, email, full_name, role, is_active, available_for_rr)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when first_user then 'admin'::user_role else 'sales_rep'::user_role end,
          first_user or new.invited_at is not null,
          first_user or new.invited_at is not null);
  if not first_user and new.invited_at is null then
    insert into notifications (user_id, title, body, link)
    select p.id, 'New sign-up awaiting approval', coalesce(new.email, 'A user') || ' created an account. Activate them in Settings → Team.', '/settings?tab=team'
    from profiles p where p.role = 'admin' and p.is_active;
  end if;
  return new;
end $$;

-- Inactive (unapproved or deactivated) accounts get no data access at all, even via the REST API.
-- RESTRICTIVE policies are AND-ed with every permissive policy on the table.
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from profiles where id = auth.uid()), false)
$$;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'profiles' loop
    execute format('drop policy if exists "active users only" on %I', t);
    execute format('create policy "active users only" on %I as restrictive for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()))', t);
  end loop;
end $$;
drop policy if exists "active users only" on profiles;
create policy "active users only" on profiles as restrictive for all to authenticated
  using ((select public.is_active_user()) or id = auth.uid()) with check ((select public.is_active_user()) or id = auth.uid());

-- ===== 20261022096000_rls_row_checks.sql =====
-- Contacts/deals visibility checked against the row's own columns. The previous policies looked the row up
-- by id inside a function, which can't see a row being inserted, so INSERT ... RETURNING failed for sales reps.
drop policy if exists "contacts select" on contacts;
create policy "contacts select" on contacts for select to authenticated using (
  is_staff() or owner_id = auth.uid() or owner_id is null
  or exists (select 1 from deals d where d.contact_id = contacts.id and d.owner_id = auth.uid())
);
drop policy if exists "contacts update" on contacts;
create policy "contacts update" on contacts for update to authenticated using (
  is_staff() or owner_id = auth.uid() or owner_id is null
  or exists (select 1 from deals d where d.contact_id = contacts.id and d.owner_id = auth.uid())
);

drop policy if exists "deals select" on deals;
create policy "deals select" on deals for select to authenticated using (
  is_staff() or owner_id = auth.uid() or owner_id is null or can_see_contact(contact_id)
);
drop policy if exists "deals update" on deals;
create policy "deals update" on deals for update to authenticated using (
  is_staff() or owner_id = auth.uid() or owner_id is null
);

-- ===== 20261022097000_harden_grants.sql =====
-- Security advisor fixes: keep trigger functions and server-only helpers out of the REST API,
-- and stop anonymous visitors from calling RLS helper functions.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.deal_stage_changed() from public, anon, authenticated;
revoke execute on function public.guard_profile_fields() from public, anon, authenticated;
revoke execute on function public.sync_deal_amounts() from public, anon, authenticated;
revoke execute on function public.rr_next_rep(uuid) from public, anon, authenticated;
grant execute on function public.rr_next_rep(uuid) to service_role;
revoke execute on function public.can_see_contact(uuid) from public, anon;
revoke execute on function public.can_see_deal(uuid) from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.next_deal_number() from public, anon;
alter function public.touch_updated_at() set search_path = public;
-- Stripe replaces Mercury for invoicing + payment matching; CAD default; one call row per Telnyx session.

alter table invoices add column if not exists stripe_invoice_id text unique;
alter table invoices add column if not exists stripe_customer_id text;
alter table clients add column if not exists stripe_customer_id text;
alter table payments add column if not exists stripe_payment_ref text unique;
alter table expenses add column if not exists stripe_ref text unique;
alter table payments alter column method set default 'stripe';

alter table workspace_settings alter column currency set default 'CAD';
update workspace_settings set currency = 'CAD' where id = 1;

-- Telnyx sends call.initiated once per leg; concurrent inserts created duplicate rows that never got a hangup.
with ranked as (
  select id, row_number() over (partition by telnyx_call_id order by started_at, id) rn
  from calls where telnyx_call_id is not null
)
delete from calls c using ranked r where c.id = r.id and r.rn > 1;
update calls set status = 'no_answer', ended_at = coalesce(ended_at, started_at), duration_sec = coalesce(duration_sec, 0)
  where status = 'ringing' and started_at < now() - interval '10 minutes';
create unique index if not exists calls_telnyx_call_id_key on calls (telnyx_call_id);

-- 20261025000000_phone_bad
-- "Bad number" call outcome flags the contact's phone. Additive only; editing the phone clears the flag.

alter table contacts add column if not exists phone_bad boolean not null default false;
alter table contacts add column if not exists phone_bad_at timestamptz;

create or replace function contacts_clear_phone_bad() returns trigger language plpgsql set search_path = public as $$
begin
  if new.phone is distinct from old.phone and new.phone_bad = old.phone_bad then
    new.phone_bad := false;
    new.phone_bad_at := null;
  end if;
  return new;
end $$;

create or replace trigger contacts_clear_phone_bad before update of phone on contacts
  for each row execute function contacts_clear_phone_bad();

-- 20261026000000_power_dialer
-- Power dialer: lead lists, dialing sessions, voicemail drops. Additive only.

create table if not exists lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null default 'manual',            -- csv | contacts | quick
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists lead_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lead_lists(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  position int not null default 0,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'called', 'skipped')),
  last_outcome text,
  last_called_at timestamptz,
  created_at timestamptz not null default now(),
  unique (list_id, contact_id)
);
create index if not exists lead_list_items_list_idx on lead_list_items (list_id, position);

create table if not exists voicemail_drops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null,
  duration_sec numeric,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists dial_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null default auth.uid(),
  list_id uuid references lead_lists(id) on delete set null,
  name text,
  from_mode text not null default 'fixed' check (from_mode in ('fixed', 'local')),
  from_number text,
  queue uuid[] not null default '{}',               -- contact ids in dial order
  position int not null default 0,                  -- index of the current lead in queue
  skipped uuid[] not null default '{}',
  conversation_threshold_sec int not null default 30,
  advance_delay_sec int not null default 5,
  voicemail_drop_id uuid references voicemail_drops(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  stats jsonb
);
create index if not exists dial_sessions_started_idx on dial_sessions (started_at desc);

alter table calls add column if not exists dial_session_id uuid references dial_sessions(id) on delete set null;
alter table calls add column if not exists voicemail_drop_id uuid references voicemail_drops(id) on delete set null;
create index if not exists calls_dial_session_idx on calls (dial_session_id);
create index if not exists calls_outbound_started_idx on calls (started_at) where direction = 'outbound';

alter table lead_lists enable row level security;
alter table lead_list_items enable row level security;
alter table voicemail_drops enable row level security;
alter table dial_sessions enable row level security;

create policy "lead lists" on lead_lists for all to authenticated
  using (is_staff() or created_by = auth.uid()) with check (is_staff() or created_by = auth.uid());
create policy "lead list items" on lead_list_items for all to authenticated
  using (exists (select 1 from lead_lists l where l.id = list_id and (is_staff() or l.created_by = auth.uid())))
  with check (exists (select 1 from lead_lists l where l.id = list_id and (is_staff() or l.created_by = auth.uid())));
create policy "voicemail drops read" on voicemail_drops for select to authenticated using (true);
create policy "voicemail drops write" on voicemail_drops for all to authenticated
  using (is_staff() or created_by = auth.uid()) with check (is_staff() or created_by = auth.uid());
create policy "dial sessions" on dial_sessions for all to authenticated
  using (is_staff() or user_id = auth.uid()) with check (is_staff() or user_id = auth.uid());

-- Private bucket for voicemail recordings (accessed via signed URLs from the server).
insert into storage.buckets (id, name, public) values ('voicemails', 'voicemails', false) on conflict (id) do nothing;

-- 20261027000000_contact_folders
-- Contact folders (PhoneBurner-style): system folders filled by call outcomes, plus custom folders. Additive only.
-- A contact with no folder counts as "New".

create table if not exists contact_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default 'gray',
  system_key text unique,                       -- new | attempted | contacted | callback | interested | not_interested | bad_dnc
  position int not null default 100,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table contacts add column if not exists folder_id uuid references contact_folders(id) on delete set null;
alter table contacts add column if not exists folder_updated_at timestamptz;
create index if not exists contacts_folder_idx on contacts (folder_id);

insert into contact_folders (name, color, system_key, position, created_by) values
  ('New', 'blue', 'new', 0, null),
  ('Attempted', 'yellow', 'attempted', 1, null),
  ('Contacted', 'sky', 'contacted', 2, null),
  ('Call Back', 'orange', 'callback', 3, null),
  ('Interested', 'green', 'interested', 4, null),
  ('Not Interested', 'gray', 'not_interested', 5, null),
  ('Bad Number / DNC', 'red', 'bad_dnc', 6, null)
on conflict (system_key) do nothing;

alter table contact_folders enable row level security;
create policy "folders read" on contact_folders for select to authenticated using (true);
create policy "folders write" on contact_folders for all to authenticated
  using (system_key is null and (is_staff() or created_by = auth.uid()))
  with check (system_key is null and (is_staff() or created_by = auth.uid()));
