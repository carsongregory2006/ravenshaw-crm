-- Security advisor fixes: keep trigger functions and server-only helpers out of the REST API,
-- and stop anonymous visitors from calling RLS helper functions.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.deal_stage_changed() from public, anon, authenticated;
revoke execute on function public.guard_profile_fields() from public, anon, authenticated;
revoke execute on function public.sync_deal_amounts() from public, anon, authenticated;
revoke execute on function public.rr_next_rep(uuid) from public, anon, authenticated;
grant execute on function public.rr_next_rep(uuid) to service_role;
revoke execute on function public.can_see_contact(uuid) from public, anon;
revoke execute on function public.can_see_deal(uuid) from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.next_deal_number() from public, anon;
alter function public.touch_updated_at() set search_path = public;
