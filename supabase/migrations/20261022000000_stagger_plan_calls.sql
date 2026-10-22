-- 21 Oct 19:55: the plan cron fired ~47 solver-plan calls at once (three
-- trips, every forecast day) and one (🧪 Faroes Live, 25 Oct) was lost; the
-- same call alone worked. Send them one a second instead.
select cron.schedule('solver-plan', '55 10,19 * * *', $cmd$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    -- One call a second: ~45 at once (three trips) dropped one on 21 Oct.
    -- Time zone looked up once per trip.
    FOR r IN
      with b as (
        select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
          from public.solver_score_builds sb
          join public.trips t on t.id = sb.trip_id and t.archived is not true
         where sb.variant = 'raw'
         order by sb.trip_id, sb.built_at desc),
      d as (
        select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
          from b join public.solver_scores s on s.build_id = b.id)
      select jsonb_build_object('trip_id', d.trip_id, 'date', d.d) as body from d
      union all
      select jsonb_build_object('trip_id', b.trip_id,
               'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                          from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
        from b
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
        body := r.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
      PERFORM pg_sleep(1);
    END LOOP;
  END $do$;
$cmd$);
select cron.schedule('solver-plan-calib', '3 11,20 * * *', $cmd$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    -- 🧪 Faroes Live only: the same calls as solver-plan, from the calibrated build, one a second.
    FOR r IN
      with b as (
        select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
          from public.solver_score_builds sb
         where sb.variant = 'calib' and sb.trip_id = '7e57bed0-0000-4000-8000-000000000002'
         order by sb.trip_id, sb.built_at desc),
      d as (
        select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
          from b join public.solver_scores s on s.build_id = b.id)
      select jsonb_build_object('trip_id', d.trip_id, 'date', d.d, 'variant', 'calib') as body from d
      union all
      select jsonb_build_object('trip_id', b.trip_id, 'variant', 'calib',
               'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                          from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
        from b
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
        body := r.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
      PERFORM pg_sleep(1);
    END LOOP;
  END $do$;
$cmd$);
