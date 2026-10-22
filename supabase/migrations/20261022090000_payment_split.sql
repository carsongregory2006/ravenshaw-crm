-- Portion of each payment attributable to recurring line items (mixed first invoices contain both).
alter table payments add column if not exists recurring_amount numeric(14,2) not null default 0;
update payments set recurring_amount = amount where kind = 'recurring' and recurring_amount = 0;
