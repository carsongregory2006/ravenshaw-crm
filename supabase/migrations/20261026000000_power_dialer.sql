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
