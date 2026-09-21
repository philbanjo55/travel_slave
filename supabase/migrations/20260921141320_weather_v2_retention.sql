-- Retention. Bounds growth without discarding what history is FOR:
-- measuring how each model actually performed at these stops.
--   < 21 days  keep everything, full resolution
--   > 21 days  one row per stop per day, model/ensemble blobs stripped,
--              scalar columns kept (skill scoring reads those)
create or replace function public.prune_weather_forecasts(
  full_res_days integer default 21
)
returns table (thinned bigint, stripped bigint)
language plpgsql security definer set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => full_res_days);
  n_thin bigint := 0; n_strip bigint := 0;
begin
  with ranked as (
    select id, row_number() over (
             partition by stop_id, (fetched_at at time zone 'UTC')::date
             order by fetched_at desc) as rn
    from weather_forecasts where fetched_at < cutoff
  ), gone as (
    delete from weather_forecasts w using ranked r
    where w.id = r.id and r.rn > 1 returning 1
  ) select count(*) into n_thin from gone;

  with slimmed as (
    update weather_forecasts
    set raw = jsonb_build_object(
      'provenance', raw -> 'provenance', 'score', raw -> 'score',
      'comparison', raw -> 'comparison', 'pruned_at', to_jsonb(now()))
    where fetched_at < cutoff and raw ? 'models' returning 1
  ) select count(*) into n_strip from slimmed;

  return query select n_thin, n_strip;
end $$;

-- Already scheduled in the live database as cron job 'weather-retention'
-- ('35 4 * * 0'). Do not schedule it again.
