-- Signup hardening.
-- * Never trust a role from user-supplied signup metadata (anyone can call auth.signUp with data.role = 'admin').
-- * The first account is the admin. Invited users (invited_at set by Supabase) are active; their role is applied
--   by the server-side invite action. Anyone else who self-registers starts inactive until an admin approves them.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists(select 1 from profiles) into first_user;
  insert into profiles (id, email, full_name, role, is_active, available_for_rr)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when first_user then 'admin'::user_role else 'sales_rep'::user_role end,
          first_user or new.invited_at is not null,
          first_user or new.invited_at is not null);
  if not first_user and new.invited_at is null then
    insert into notifications (user_id, title, body, link)
    select p.id, 'New sign-up awaiting approval', coalesce(new.email, 'A user') || ' created an account. Activate them in Settings → Team.', '/settings?tab=team'
    from profiles p where p.role = 'admin' and p.is_active;
  end if;
  return new;
end $$;

-- Inactive (unapproved or deactivated) accounts get no data access at all, even via the REST API.
-- RESTRICTIVE policies are AND-ed with every permissive policy on the table.
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from profiles where id = auth.uid()), false)
$$;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'profiles' loop
    execute format('drop policy if exists "active users only" on %I', t);
    execute format('create policy "active users only" on %I as restrictive for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()))', t);
  end loop;
end $$;
drop policy if exists "active users only" on profiles;
create policy "active users only" on profiles as restrictive for all to authenticated
  using ((select public.is_active_user()) or id = auth.uid()) with check ((select public.is_active_user()) or id = auth.uid());
