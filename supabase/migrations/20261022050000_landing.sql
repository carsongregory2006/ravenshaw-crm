-- Landing page analytics helpers (aggregate in SQL instead of shipping raw events to the app)

create or replace function public.lp_variant_stats(p_page_id uuid default null)
returns table (page_id uuid, variant_id uuid, views bigint, visitors bigint, conversions bigint, cta_clicks bigint, bookings bigint)
language sql stable set search_path = public as $$
  select e.page_id, e.variant_id,
         count(*) filter (where e.type = 'view'),
         count(distinct e.visitor_id) filter (where e.type = 'view'),
         count(*) filter (where e.type = 'conversion'),
         count(*) filter (where e.type = 'cta_click'),
         count(*) filter (where e.type = 'booking')
  from landing_page_events e
  where p_page_id is null or e.page_id = p_page_id
  group by e.page_id, e.variant_id
$$;

create or replace function public.lp_daily_stats(p_page_id uuid, p_days int default 30)
returns table (day date, variant_id uuid, views bigint, conversions bigint)
language sql stable set search_path = public as $$
  select (e.created_at at time zone 'utc')::date, e.variant_id,
         count(*) filter (where e.type = 'view'),
         count(*) filter (where e.type = 'conversion')
  from landing_page_events e
  where e.page_id = p_page_id and e.created_at >= now() - make_interval(days => p_days)
  group by 1, 2
  order by 1
$$;

grant execute on function public.lp_variant_stats(uuid) to authenticated, service_role;
grant execute on function public.lp_daily_stats(uuid, int) to authenticated, service_role;
