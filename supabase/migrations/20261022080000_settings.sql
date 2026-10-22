-- Deal numbers use the workspace prefix (Settings → General). Existing numbers are unchanged.
create or replace function public.next_deal_number() returns text
language sql volatile security definer set search_path = public as $$
  select coalesce((select nullif(trim(deal_number_prefix), '') from workspace_settings where id = 1), 'RAV') || '-' || nextval('deal_number_seq')
$$;
alter table deals alter column deal_number set default public.next_deal_number();
