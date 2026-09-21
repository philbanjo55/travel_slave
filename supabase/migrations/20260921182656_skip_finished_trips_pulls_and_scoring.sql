-- Finished trips are done: no more pulls, and no more re-scoring.
--
-- The crons only avoided them by accident. Both selected days by DATE, so a
-- finished trip was skipped because its dates had passed, not because anyone
-- checked whether the trip was over. Re-date an old trip and it starts
-- fetching again. The guard is now on the trip itself.
select cron.schedule('hourly-weather-pull', '7 * * * *', $job$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    FOR r IN
      SELECT d.id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.date BETWEEN current_date AND current_date + 15
        AND t.archived IS NOT TRUE
        AND (t.end_date IS NULL OR t.end_date >= current_date)
      ORDER BY d.date, d.id
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/weather-pull',
        body := jsonb_build_object('day_id', r.id),
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
      PERFORM pg_sleep(2.5);
    END LOOP;
  END $do$;
$job$);

select cron.schedule('daily-preview-refresh', '10 5 * * *', $job$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    FOR r IN
      SELECT d.id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.date > current_date + 15
        AND t.archived IS NOT TRUE
        AND (t.end_date IS NULL OR t.end_date >= current_date)
      ORDER BY d.date, d.id
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/weather-pull',
        body := jsonb_build_object('day_id', r.id, 'test', true),
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
      PERFORM pg_sleep(2.5);
    END LOOP;
  END $do$;
$job$);

-- A finished trip's stars are a record of what was shown at the time. Scoring
-- is now a view-side projection, so without this a rule change would silently
-- rewrite the rating of every shot already taken. Returning null here makes
-- the app fall back to the stored score_* columns — the value the edge
-- function computed on the day — with no client change, because readScore
-- already prefers `score` and falls back to those columns.
create or replace view public.latest_weather_per_stop as
select l.*,
       public.weather_display(l.*) as display,
       case
         when tr.archived is true
           or (tr.end_date is not null and tr.end_date < current_date)
         then null
         else public.weather_score(l.*, st.shot_type)
       end as score
from (
  select distinct on (stop_id) *
  from public.weather_forecasts
  order by
    stop_id,
    ((raw -> 'provenance' ->> 'date_mode') = 'trip-date') desc nulls last,
    fetched_at desc
) l
left join public.stops st on st.id = l.stop_id
left join public.trips tr on tr.id = l.trip_id;
