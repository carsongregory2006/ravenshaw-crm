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
