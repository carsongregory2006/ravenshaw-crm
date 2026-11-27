-- Marketing: your own ad campaigns (manual entry / Ads Manager CSV), past campaigns, landers & forms. Additive only. Admin only.

-- Landing pages and lead forms ads send people to. Either linked to a CRM landing page (visits/leads tracked
-- automatically) or a manual entry (outside page or Meta lead form; visits = clicks, leads = ad leads).
create table if not exists mkt_landers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'page' check (kind in ('page','form')),
  url text,
  landing_page_id uuid references landing_pages(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists mkt_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null default 'meta',
  created_at timestamptz not null default now(),
  unique (platform, name)
);

create table if not exists mkt_ad_sets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references mkt_campaigns(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, name)
);

create table if not exists mkt_ads (
  id uuid primary key default gen_random_uuid(),
  ad_set_id uuid not null references mkt_ad_sets(id) on delete cascade,
  name text not null,
  lander_id uuid references mkt_landers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ad_set_id, name)
);

-- One row per ad per day. Imports upsert on (ad_id, date).
create table if not exists mkt_ad_stats (
  ad_id uuid not null references mkt_ads(id) on delete cascade,
  date date not null,
  spend numeric(14,2) not null default 0,
  impressions int not null default 0,
  clicks int not null default 0,
  leads int not null default 0,
  won_jobs int not null default 0,
  primary key (ad_id, date)
);
create index if not exists mkt_ad_stats_date on mkt_ad_stats (date);

create table if not exists mkt_past_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null default 'meta',
  start_date date,
  end_date date,
  notes text,
  learnings text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uploaded CSVs (Ads Manager exports), stored parsed so they can be shown as tables.
create table if not exists mkt_past_campaign_files (
  id uuid primary key default gen_random_uuid(),
  past_campaign_id uuid not null references mkt_past_campaigns(id) on delete cascade,
  file_name text not null,
  headers jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['mkt_landers','mkt_campaigns','mkt_ad_sets','mkt_ads','mkt_ad_stats','mkt_past_campaigns','mkt_past_campaign_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "admin %s" on %I for all to authenticated using (is_admin()) with check (is_admin())', t, t);
  end loop;
end $$;
