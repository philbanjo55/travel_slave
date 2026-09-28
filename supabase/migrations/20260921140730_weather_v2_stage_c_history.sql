-- Stage C: allow history. The unique index on stop_id meant one row per
-- stop, overwritten every pull, so nothing could be measured over time.
create or replace view public.latest_weather_per_stop as
select distinct on (stop_id) *
from public.weather_forecasts
order by
  stop_id,
  ((raw -> 'provenance' ->> 'date_mode') = 'trip-date') desc nulls last,
  fetched_at desc;

drop index if exists public.weather_forecasts_stop_id_key;

create index if not exists weather_forecasts_stop_valid_fetched_idx
  on public.weather_forecasts (stop_id, forecast_valid_for, fetched_at desc);
create index if not exists weather_forecasts_trip_horizon_idx
  on public.weather_forecasts (trip_id, horizon_hours);
