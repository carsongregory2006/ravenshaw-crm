-- Network leads (warm intros, friends-of-friends) and external lander tracking. Additive only.

-- ───────── Network: people to hit up later, kept out of the dialer until moved to the CRM ─────────
create table if not exists network_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business text,
  phone text,
  email text,
  connection text,                              -- how you know them
  introduced_by text,                           -- who can make the intro
  warmth text not null default 'warm' check (warmth in ('hot','warm','cold')),
  status text not null default 'idea' check (status in ('idea','intro_asked','reached_out','talking','converted','not_fit')),
  follow_up_on date,
  notes text,
  contact_id uuid references contacts(id) on delete set null,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists network_leads_status_idx on network_leads (status, follow_up_on);

alter table network_leads enable row level security;
create policy "network read" on network_leads for select to authenticated using (is_staff() or created_by = auth.uid());
create policy "network write" on network_leads for all to authenticated
  using (is_staff() or created_by = auth.uid())
  with check (is_staff() or created_by = auth.uid());

-- ───────── Landers: pages you built elsewhere, tracked with a script tag ─────────
alter table landing_pages add column if not exists external_url text;
alter table landing_pages add column if not exists has_vsl boolean not null default false;

-- One row per page load. The tracker resends running totals; the upsert keeps the highest values.
create table if not exists lander_visits (
  id text primary key,                          -- visit id generated in the browser
  page_id uuid not null references landing_pages(id) on delete cascade,
  visitor_id text,
  variant text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  time_on_page_s int not null default 0,
  max_scroll_pct int not null default 0,
  cta_clicks int not null default 0,
  vsl_started boolean not null default false,
  vsl_watch_s int not null default 0,
  vsl_duration_s int,
  vsl_max_pct int not null default 0,
  converted boolean not null default false,
  booked boolean not null default false,
  referrer text,
  utm jsonb,
  device text,
  country text
);
create index if not exists lander_visits_page_idx on lander_visits (page_id, started_at);

alter table lander_visits enable row level security;
create policy "lander visits read" on lander_visits for select to authenticated using (is_staff());

create or replace function public.lander_track(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into lander_visits as v (id, page_id, visitor_id, variant, time_on_page_s, max_scroll_pct, cta_clicks,
    vsl_started, vsl_watch_s, vsl_duration_s, vsl_max_pct, converted, booked, referrer, utm, device, country)
  values (
    p->>'visit_id', (p->>'page_id')::uuid, p->>'visitor_id', nullif(p->>'variant', ''),
    least(coalesce((p->>'time_on_page_s')::int, 0), 86400),
    least(greatest(coalesce((p->>'max_scroll_pct')::int, 0), 0), 100),
    least(coalesce((p->>'cta_clicks')::int, 0), 1000),
    coalesce((p->>'vsl_started')::boolean, false),
    least(coalesce((p->>'vsl_watch_s')::int, 0), 86400),
    nullif((p->>'vsl_duration_s')::int, 0),
    least(greatest(coalesce((p->>'vsl_max_pct')::int, 0), 0), 100),
    coalesce((p->>'converted')::boolean, false),
    coalesce((p->>'booked')::boolean, false),
    left(p->>'referrer', 2000), p->'utm', p->>'device', p->>'country'
  )
  on conflict (id) do update set
    last_seen_at = now(),
    time_on_page_s = greatest(v.time_on_page_s, excluded.time_on_page_s),
    max_scroll_pct = greatest(v.max_scroll_pct, excluded.max_scroll_pct),
    cta_clicks = greatest(v.cta_clicks, excluded.cta_clicks),
    vsl_started = v.vsl_started or excluded.vsl_started,
    vsl_watch_s = greatest(v.vsl_watch_s, excluded.vsl_watch_s),
    vsl_duration_s = coalesce(excluded.vsl_duration_s, v.vsl_duration_s),
    vsl_max_pct = greatest(v.vsl_max_pct, excluded.vsl_max_pct),
    converted = v.converted or excluded.converted,
    booked = v.booked or excluded.booked
  where v.page_id = excluded.page_id;
end $$;
revoke all on function public.lander_track(jsonb) from public, anon, authenticated;
