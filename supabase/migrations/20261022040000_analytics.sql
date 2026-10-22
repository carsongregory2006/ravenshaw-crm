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
