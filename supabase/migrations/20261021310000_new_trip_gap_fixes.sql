-- One-time fixes from the new-trip audit (docs/NEW_TRIP_SOP.md, known gaps).
-- None of these change what the real app reads.
--
-- 1. model-grid-refresh probed stops only while trips.start_date >= today, so
--    stops added or moved during a trip never got model grid points (and
--    archived future trips were still probed). Now: live trips (not archived,
--    end_date not past), the definition every other job uses.
-- 2. The scoreboard (solver_verify_run) took every METAR station within 30 km
--    of a live trip's stops, but observations are fetched only for the trip
--    stations (active_metar_stations), so stations like KDIJ added nothing.
--    Now only stations with an observation in the last 3 days.
-- 3. solver_light_cache was never pruned (~0.5 MB a night per live trip).
--    solver_prune_light_cache() drops dates more than 3 days past (nothing
--    reads past dates: plans, scores and light-only plans are all forward);
--    weekly pg_cron 'solver-light-prune' (Sun 04:23 UTC).
-- 4. Faroe Islands 2027 had no trips.timezone (it resolved to Atlantic/Faroe
--    only through its forecasts). The app doesn't read the column; the
--    solver, sun plan and trip_readiness do.

do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.refresh_model_grid_points_step(uuid, integer)'::regprocedure);
  n := replace(d, 'else t.start_date >= current_date end)',
                  'else t.archived is not true and (t.end_date is null or t.end_date >= current_date) end)');
  if n = d or n like '%start_date >= current_date%' then raise exception 'refresh_model_grid_points_step text not matched'; end if;
  execute n;

  d := pg_get_functiondef('public.solver_verify_run'::regproc);
  n := replace(d,
$a$                      and s.lat is not null and gc_km(m.lat, m.lng, s.lat, s.lng) <= 30)$a$,
$b$                      and s.lat is not null and gc_km(m.lat, m.lng, s.lat, s.lng) <= 30)
       -- only stations whose observations are actually fetched
       and exists (select 1 from station_obs_hourly so where so.station = m.icao and so.hr > now() - interval '3 days')$b$);
  if n = d then raise exception 'solver_verify_run text not matched'; end if;
  execute n;
end $do$;

create or replace function public.solver_prune_light_cache()
returns integer language plpgsql set search_path = public as $$
declare v int;
begin
  delete from solver_light_cache where local_date < current_date - 3;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.solver_prune_light_cache() from public, anon, authenticated;

select cron.schedule('solver-light-prune', '23 4 * * 0', 'select public.solver_prune_light_cache()');

update trips set timezone = 'Atlantic/Faroe'
 where id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and timezone is null;
