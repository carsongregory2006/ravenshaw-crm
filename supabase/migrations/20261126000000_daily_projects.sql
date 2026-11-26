-- Daily checklist (resets each day) + project management. Additive only.

create table if not exists daily_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per item ticked on a given day (America/Toronto date). A new day has no rows, so the list "resets".
create table if not exists daily_checks (
  item_id uuid not null references daily_items(id) on delete cascade,
  day date not null,
  done_at timestamptz not null default now(),
  primary key (item_id, day)
);
create index if not exists daily_checks_day on daily_checks (day);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'building' check (status in ('idea','building','live','paused')),
  due_date date,
  position int not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due_date date,
  position int not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists project_tasks_project on project_tasks (project_id, status, position);

alter table daily_items enable row level security;
alter table daily_checks enable row level security;
alter table projects enable row level security;
alter table project_tasks enable row level security;
create policy "staff daily_items" on daily_items for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff daily_checks" on daily_checks for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff projects" on projects for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff project_tasks" on project_tasks for all to authenticated using (is_staff()) with check (is_staff());
