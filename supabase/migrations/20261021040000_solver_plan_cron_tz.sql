-- Nightly plans: build days in the trip's own timezone (solver_trip_tz; the
-- Faroes trip has no timezone set, so UTC split its days an hour off).
-- One call per build day, plus one multi-day plan per trip.
select cron.unschedule('solver-plan');
select cron.schedule('solver-plan', '55 22 * * *', $cron$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
    body := q.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000)
  from (
    select jsonb_build_object('trip_id', b.trip_id, 'date', x.d) as body
      from (select distinct on (trip_id) id, trip_id from public.solver_score_builds order by trip_id, built_at desc) b
      join public.trips t on t.id = b.trip_id and t.archived is not true
      cross join lateral (
        select distinct (s.slot_at at time zone public.solver_trip_tz(t.id))::date::text as d
          from public.solver_scores s where s.build_id = b.id) x
    union all
    select jsonb_build_object('trip_id', b.trip_id, 'multi', true)
      from (select distinct trip_id from public.solver_score_builds) b
      join public.trips t on t.id = b.trip_id and t.archived is not true
  ) q;
$cron$);
