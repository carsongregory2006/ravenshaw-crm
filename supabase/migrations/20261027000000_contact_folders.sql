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
