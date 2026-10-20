-- solver_trip_tz scanned pg_timezone_names (~0.5 s per call), which made the
-- backtest (one call per visit) time out. Same answer, checked by using the
-- name instead: the trip's own timezone, else the latest forecast's, else UTC.
create or replace function public.solver_trip_tz(p_trip_id uuid)
returns text language plpgsql stable set search_path = public as $$
declare tz text;
begin
  select t.timezone into tz from trips t where t.id = p_trip_id;
  if not found then return null; end if;
  if tz is not null then
    begin perform now() at time zone tz; return tz; exception when others then null; end;
  end if;
  select f.raw->'provenance'->>'timezone' into tz from weather_forecasts f join stops s on s.id = f.stop_id
   where s.trip_id = p_trip_id and f.raw->'provenance'->>'timezone' is not null
   order by f.fetched_at desc limit 1;
  if tz is not null then
    begin perform now() at time zone tz; return tz; exception when others then null; end;
  end if;
  return 'UTC';
end $$;

-- Backtest: one timezone lookup per trip, not per visit.
do $do$
declare d text := pg_get_functiondef('public.solver_backtest_run(boolean)'::regprocedure);
declare n text;
begin
  n := replace(d,
$a$           solver_trip_tz(r.trip_id) as tz, r.created_at
      from solver_runs r
      join solver_plans p on p.run_id = r.id$a$,
$b$           tzs.tz, r.created_at
      from solver_runs r
      join (select t.id, solver_trip_tz(t.id) as tz from trips t
             where t.id in (select distinct trip_id from solver_runs)) tzs on tzs.id = r.trip_id
      join solver_plans p on p.run_id = r.id$b$);
  if n = d then raise exception 'solver_backtest_run text not matched'; end if;
  execute n;
end $do$;

-- The planner still called it per row; materialize the per-trip lookup.
do $do$
declare d text := pg_get_functiondef('public.solver_backtest_run(boolean)'::regprocedure);
declare n text;
begin
  n := replace(replace(d,
$a$  with visits as ($a$,
$b$  with tzs as materialized (
    select t.id, solver_trip_tz(t.id) as tz from trips t where t.id in (select distinct trip_id from solver_runs)
  ), visits as ($b$),
$a$      join (select t.id, solver_trip_tz(t.id) as tz from trips t
             where t.id in (select distinct trip_id from solver_runs)) tzs on tzs.id = r.trip_id$a$,
$b$      join tzs on tzs.id = r.trip_id$b$);
  if n = d or n not like '%as materialized%' or n like '%) tzs on%' then raise exception 'solver_backtest_run text not matched'; end if;
  execute n;
end $do$;
