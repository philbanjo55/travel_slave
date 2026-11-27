-- solver_subject_grid(trip): each rated stop's best chance on every trip day,
-- for the TEST Planner's Subjects tab (through solver-actions subject_grid).
-- Light-only days use solver_light_terms with the planner's 51 made-up sun
-- scenarios s = (k/50)^2 in closed form (value = blue ? dir : s*dir +
-- (1-s)*soft, x0.6 when fog is wanted; good = value >= 0.6, as GOOD = 150/250
-- in solver-plan). Trip days inside the latest score build use its forecast
-- (solver_score_summary). One row per stop and trip day: the slot with the
-- best p_good (then mean).

create or replace function public.solver_subject_grid(p_trip uuid)
returns table(stop_id uuid, trip_date date, mean real, p_good real, best_at timestamptz, source text)
language sql stable set search_path = public as $$
  with tz as materialized (select solver_trip_tz(p_trip) as tz),
  dates as (select array_agg(distinct d.date) as ds from days d where d.trip_id = p_trip and d.date is not null),
  build as (select b.id from solver_score_builds b where b.trip_id = p_trip order by b.built_at desc limit 1),
  fc as (
    select s.stop_id, (s.slot_at at time zone (select tz from tz))::date as ld, s.slot_at,
           s.mean::real as m, s.p_good::real as pg
      from solver_score_summary s
     where s.build_id = (select id from build)
       and (s.slot_at at time zone (select tz from tz))::date = any ((select ds from dates)::date[])
  ),
  fc_dates as (select distinct ld from fc),
  lt as (
    select t.stop_id, (t.slot_at at time zone (select tz from tz))::date as ld, t.slot_at, t.dir, t.soft, t.blue,
           case when t.fog_wanted then 0.6 else 1 end as f
      from solver_light_terms(p_trip, (select ds from dates)) t
  ),
  lv as (
    select stop_id, ld, slot_at,
           least(1, greatest(0, (case when blue then dir else 0.3367 * dir + 0.6633 * soft end) * f))::real as m,
           (case
              when blue then case when dir * f >= 0.6 then 51 else 0 end
              when abs(dir - soft) < 1e-6 then case when soft * f >= 0.6 then 51 else 0 end
              when dir > soft then (select case when s0 <= 0 then 51 when s0 > 1 then 0 else 51 - ceil(50 * sqrt(s0))::int end
                                      from (select (0.6 / f - soft) / (dir - soft) as s0) x)
              else (select case when s0 < 0 then 0 when s0 >= 1 then 51 else floor(50 * sqrt(s0))::int + 1 end
                      from (select (0.6 / f - soft) / (dir - soft) as s0) x)
            end / 51.0)::real as pg
      from lt
     where ld not in (select ld from fc_dates)
  ),
  allrows as (
    select stop_id, ld, slot_at, m, pg, 'forecast'::text as src from fc
    union all
    select stop_id, ld, slot_at, m, pg, 'light' from lv
  )
  select distinct on (stop_id, ld) stop_id, ld, round(m::numeric, 3)::real, round(pg::numeric, 3)::real, slot_at, src
    from allrows
   order by stop_id, ld, pg desc, m desc, slot_at
$$;

revoke execute on function public.solver_subject_grid(uuid) from public, anon, authenticated;
