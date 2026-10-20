-- Nightly day plans, one solver-plan call per day in each trip's latest
-- score build. 22:55 UTC: after solver-build-scores (22:41, ~100 s).
select cron.schedule('solver-plan', '55 22 * * *', $cron$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
    body := jsonb_build_object('trip_id', b.trip_id, 'date', x.d),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 1000)
  from (select distinct on (trip_id) id, trip_id from public.solver_score_builds order by trip_id, built_at desc) b
  join public.trips t on t.id = b.trip_id and t.archived is not true
  cross join lateral (
    select distinct (s.slot_at at time zone coalesce(t.timezone, 'UTC'))::date::text as d
      from public.solver_scores s where s.build_id = b.id) x;
$cron$);
