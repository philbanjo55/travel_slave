-- Stage A: purely additive. Nothing existing is altered or dropped.
alter table public.weather_forecasts
  add column if not exists cloud_base_m        double precision,
  add column if not exists cloud_top_m         double precision,
  add column if not exists cloud_cover_2m_pct  double precision;

alter table public.weather_forecasts
  add column if not exists wave_height_m        double precision,
  add column if not exists wave_period_s        double precision,
  add column if not exists wave_direction_deg   double precision,
  add column if not exists swell_wave_height_m  double precision,
  add column if not exists swell_wave_period_s  double precision,
  add column if not exists wind_wave_height_m   double precision,
  add column if not exists sea_surface_temp_c   double precision;

alter table public.weather_forecasts
  add column if not exists model_count   integer,
  add column if not exists primary_model text;

alter table public.weather_forecasts
  add column if not exists horizon_hours numeric
  generated always as (
    extract(epoch from (forecast_valid_for - fetched_at)) / 3600.0
  ) stored;

create table if not exists public.weather_observations (
  id uuid primary key default gen_random_uuid(),
  station text not null,
  observed_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  lat double precision, lng double precision,
  temperature_c double precision, dew_point_c double precision,
  wind_dir_deg integer, wind_speed_kt integer, wind_gust_kt integer,
  visibility_m double precision, ceiling_ft integer,
  cover text, flight_category text, wx_string text,
  raw_metar text, raw_taf text, raw jsonb,
  created_at timestamptz not null default now(),
  constraint weather_observations_station_time_key unique (station, observed_at)
);
create index if not exists weather_observations_station_time_idx
  on public.weather_observations (station, observed_at desc);
alter table public.weather_observations enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                 join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname='weather_observations'
                   and p.polname='full_access') then
    create policy full_access on public.weather_observations
      for all using (true) with check (true);
  end if;
end $$;
