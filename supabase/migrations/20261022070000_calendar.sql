-- Calendar module additions

-- Google event ids can repeat across calendars; scope external ids to their calendar.
drop index if exists calendar_events_external_source_external_id_idx;
create unique index if not exists calendar_events_calendar_external_uniq
  on calendar_events (calendar_id, external_source, external_id);

-- Google "singleEvents" instances keep a pointer to their recurring master.
alter table calendar_events add column if not exists external_recurring_id text;
alter table calendars add column if not exists last_synced_at timestamptz;
alter table calendars add column if not exists sync_error text;

-- Tracks reminder notifications already sent (per occurrence + reminder offset).
create table if not exists calendar_reminders_sent (
  event_id uuid not null references calendar_events(id) on delete cascade,
  occurrence_start timestamptz not null,
  minutes int not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occurrence_start, minutes)
);
alter table calendar_reminders_sent enable row level security;
-- server-only (service role); no policies for authenticated users
