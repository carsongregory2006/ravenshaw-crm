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
