alter table weather_models
  add column if not exists native_model text references weather_models(model),
  add column if not exists outside_native text,
  add column if not exists outside_resolution_km numeric;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'weather_models_outside_native_chk') then
    alter table weather_models add constraint weather_models_outside_native_chk check (
      (native_model is null and outside_native is null and outside_resolution_km is null)
      or (native_model is not null and outside_native = 'exclude' and outside_resolution_km is null)
      or (native_model is not null and outside_native = 'downgrade' and outside_resolution_km is not null));
  end if;
end $$;

comment on column weather_models.native_model is
  'For a blend: the regional model it equals inside that model''s coverage (per model_grid_points.has_data). Null = same everywhere.';
comment on column weather_models.outside_native is
  'Outside native_model coverage: downgrade = use outside_resolution_km; exclude = skip it (it repeats a centre that already votes). Verified Oct 2026 by exact series match.';
comment on column weather_models.resolution_km is
  'Resolution where the model is at its native best. A blend without native_model must carry its COARSEST (global) resolution so it can never over-claim anywhere.';

-- Verified 13 Oct 2026: at Teton stops icon_seamless == icon_global (72/72 h)
-- and dmi_seamless == ECMWF IFS 9 km (72/72 h); at Faroes stops they equal
-- icon_eu / dmi_harmonie_arome_europe (48/48 h).
update weather_models set native_model = 'icon_eu', outside_native = 'downgrade', outside_resolution_km = 13
 where model = 'icon_seamless';
update weather_models set native_model = 'dmi_harmonie_arome_europe', outside_native = 'exclude', outside_resolution_km = null
 where model = 'dmi_seamless';

alter table trips add column if not exists primary_selection text not null default 'skill';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trips_primary_selection_chk') then
    alter table trips add constraint trips_primary_selection_chk check (primary_selection in ('skill','resolution'));
  end if;
end $$;
comment on column trips.primary_selection is
  'skill = main model chosen by measured accuracy near the trip (falls back to resolution when data is thin); resolution = finest grid with cloud layers.';
update trips set primary_selection = 'resolution'
 where id in ('e04fbc9d-86b1-42b2-bf08-fc65a18e665d','7e57bed0-0000-4000-8000-000000000001');

alter table days add column if not exists metar_station text;
comment on column days.metar_station is
  'Auto-picked nearest METAR station for this day''s stops (used when trips.metar_station is null). ''-'' = none within 100 km.';

create table if not exists metar_stations (
  icao text primary key, name text, lat double precision, lng double precision,
  elev_m double precision, has_taf boolean, fetched_at timestamptz not null default now());

create table if not exists station_obs_hourly (
  station text not null, hr timestamptz not null, temperature_c double precision,
  cloud_pct double precision, wet boolean, fetched_at timestamptz not null default now(),
  primary key (station, hr));

create table if not exists model_skill (
  station text not null, model text not null,
  lead_day integer not null check (lead_day between 1 and 7),
  n_hours integer not null, temp_mae_c numeric, cloud_mae_pct numeric,
  overcast_hit_pct numeric, precip_hit_pct numeric, skill_score numeric,
  window_start timestamptz, window_end timestamptz,
  computed_at timestamptz not null default now(),
  primary key (station, model, lead_day));
comment on table model_skill is
  'Per station and lead (forecast issued N days ahead): each model''s error over the last 14 days vs that station''s METARs. skill_score (lower = better) = cloud error % + 0.5 x missed overcast calls % + 0.25 x missed wet/dry calls %. Temperature recorded, not scored.';

create table if not exists skill_probe (
  req_id bigint primary key, station text, day_id uuid,
  kind text not null,
  done boolean not null default false,
  created_at timestamptz not null default now());

alter table metar_stations enable row level security;
alter table station_obs_hourly enable row level security;
alter table model_skill enable row level security;
alter table skill_probe enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='metar_stations' and policyname='metar_stations_read') then
    create policy metar_stations_read on metar_stations for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='model_skill' and policyname='model_skill_read') then
    create policy model_skill_read on model_skill for select using (true);
  end if;
end $$;

create or replace function public.gc_km(lat1 double precision, lng1 double precision,
                                        lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371.0 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create or replace function public.metar_cloud_pct(cover text)
returns double precision language sql immutable as $$
  select case upper(coalesce(cover,''))
    when 'SKC' then 0 when 'CLR' then 0 when 'NCD' then 0 when 'NSC' then 0 when 'CAVOK' then 0
    when 'FEW' then 19 when 'SCT' then 44 when 'BKN' then 75
    when 'OVC' then 100 when 'OVX' then 100 when 'VV' then 100
    else null end::double precision
$$;

create or replace view model_skill_ranked as
select s.*, rank() over (partition by station, lead_day order by skill_score) as rank_in_lead
from model_skill s;
