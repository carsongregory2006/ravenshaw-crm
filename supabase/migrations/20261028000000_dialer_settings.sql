-- Recycled leads, inbound voicemail. Additive only.

-- Lead list items: when they were added (shown on lists), when a recycled lead becomes callable again,
-- and how many times it has been recycled.
alter table lead_list_items add column if not exists added_at timestamptz;
alter table lead_list_items alter column added_at set default now();
alter table lead_list_items add column if not exists available_at timestamptz;
alter table lead_list_items add column if not exists attempts int not null default 0;

-- Inbound voicemail left on one of our numbers (audio stored in the private voicemails bucket).
alter table calls add column if not exists voicemail_path text;
alter table calls add column if not exists voicemail_duration_sec int;
