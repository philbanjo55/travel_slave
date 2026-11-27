-- The TEST stop page's "Today" chart (Phil, 1 Nov 2026, redesign E-all b): one stop's chance per
-- 15-min slot on one trip day (trip-local date). Forecast slots from the trip's newest raw score
-- build; a day the forecast doesn't reach yet gets the light-only scores (solver_light_scores).
-- Backend only: the app asks solver-actions (stop_curve), which calls this with the service key.
create or replace function public.solver_stop_curve(p_stop uuid, p_date date)
returns table (slot_at timestamptz, mean numeric, p_good numeric, source text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_trip uuid; v_tz text; v_build uuid;
begin
  select s.trip_id into v_trip from stops s where s.id = p_stop;
  if v_trip is null then return; end if;
  v_tz := solver_trip_tz(v_trip);
  select b.id into v_build from solver_score_builds b
   where b.trip_id = v_trip and b.variant = 'raw' order by b.built_at desc limit 1;
  return query
    select x.slot_at,
           round((select avg(v) from unnest(x.v) v) / 250.0, 3),
           round((select avg((v >= 150)::int) from unnest(x.v) v), 3),
           'forecast'::text
      from solver_scores x
     where x.build_id = v_build and x.stop_id = p_stop
       and x.slot_at >= (p_date::timestamp at time zone v_tz)
       and x.slot_at < ((p_date + 1)::timestamp at time zone v_tz)
     order by x.slot_at;
  if found then return; end if;
  return query
    select l.slot_at,
           round((select avg(v) from unnest(l.v) v) / 250.0, 3),
           round((select avg((v >= 150)::int) from unnest(l.v) v), 3),
           'light'::text
      from solver_light_scores(v_trip, array[p_date]) l
     where l.stop_id = p_stop
     order by l.slot_at;
end $$;
revoke all on function public.solver_stop_curve(uuid, date) from public, anon, authenticated;
