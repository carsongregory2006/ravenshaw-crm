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
