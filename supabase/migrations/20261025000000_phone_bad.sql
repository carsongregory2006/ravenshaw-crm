-- "Bad number" call outcome flags the contact's phone. Additive only; editing the phone clears the flag.

alter table contacts add column if not exists phone_bad boolean not null default false;
alter table contacts add column if not exists phone_bad_at timestamptz;

create or replace function contacts_clear_phone_bad() returns trigger language plpgsql set search_path = public as $$
begin
  if new.phone is distinct from old.phone and new.phone_bad = old.phone_bad then
    new.phone_bad := false;
    new.phone_bad_at := null;
  end if;
  return new;
end $$;

create or replace trigger contacts_clear_phone_bad before update of phone on contacts
  for each row execute function contacts_clear_phone_bad();
