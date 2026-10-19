-- 1. Fog truth: keep visibility / ceiling / fog codes that the skill harvest
-- already downloads (refresh_model_skill_step stage C drops them).
alter table public.station_obs_hourly
  add column if not exists visibility_m double precision,
  add column if not exists ceiling_ft integer,
  add column if not exists lowest_cloud_ft integer,
  add column if not exists dew_point_c double precision,
  add column if not exists fog boolean,
  add column if not exists mist boolean,
  add column if not exists wx_string text;

create or replace function public.metar_visibility_m(p text)
returns double precision language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~ '\+' then 10000
    when p ~ '^\s*\d+\s+\d+/\d+\s*$' then
      (split_part(btrim(p), ' ', 1)::float
       + split_part(split_part(btrim(p), ' ', 2), '/', 1)::float
         / nullif(split_part(split_part(btrim(p), ' ', 2), '/', 2)::float, 0)) * 1609.34
    when p ~ '^\s*\d+/\d+\s*$' then
      split_part(btrim(p), '/', 1)::float / nullif(split_part(btrim(p), '/', 2)::float, 0) * 1609.34
    when p ~ '^\s*\d+(\.\d+)?\s*$' then least(btrim(p)::float * 1609.34, 10000)
    else null end
$$;

-- Reads obs responses still held by pg_net (6 h) and fills the new columns.
-- Runs after refresh_model_skill_step has inserted the base rows.
create or replace function public.harvest_obs_extras()
returns integer language plpgsql set search_path to 'public' as $$
declare v_rows integer := 0;
begin
  with src as (
    select p.station, try_jsonb(h.content) j
    from skill_probe p join net._http_response h on h.id = p.req_id
    where p.kind = 'obs' and h.status_code = 200
  ), obs as (
    select s.station,
           date_trunc('hour', (e->>'reportTime')::timestamptz + interval '10 minutes') hr,
           metar_visibility_m(e->>'visib') vis,
           (select min((c->>'base')::int) from jsonb_array_elements(coalesce(e->'clouds','[]'::jsonb)) c
              where c->>'cover' in ('BKN','OVC','OVX','VV')) ceil_ft,
           (select min((c->>'base')::int) from jsonb_array_elements(coalesce(e->'clouds','[]'::jsonb)) c
              where c->>'base' is not null) low_ft,
           (e->>'dewp')::float dew,
           coalesce(e->>'wxString','') wx
    from src s, jsonb_array_elements(s.j) e
    where jsonb_typeof(s.j) = 'array' and e->>'reportTime' is not null
  ), agg as (
    select station, hr, min(vis) vis, min(ceil_ft) ceil_ft, min(low_ft) low_ft, avg(dew) dew,
           bool_or(wx ~ '(^|\s)[-+]?(MI|BC|PR|FZ)?FG') fog,
           bool_or(wx ~ '(^|\s)BR') mist,
           nullif(string_agg(distinct nullif(wx,''), ' | '), '') wx
    from obs group by station, hr
  )
  update station_obs_hourly o set
    visibility_m = a.vis, ceiling_ft = a.ceil_ft, lowest_cloud_ft = a.low_ft,
    dew_point_c = a.dew, fog = a.fog, mist = a.mist, wx_string = a.wx
  from agg a
  where o.station = a.station and o.hr = a.hr
    and (o.visibility_m is distinct from a.vis or o.ceiling_ft is distinct from a.ceil_ft
         or o.fog is distinct from a.fog or o.lowest_cloud_ft is distinct from a.low_ft);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

select cron.schedule('obs-extras-harvest', '5-59/10 * * * *', 'select public.harvest_obs_extras();');

-- 2. Ensemble archive. One row per pull x cell x model x valid hour, members
-- as arrays (index 0 = control). Stored at the model's native step only.
create table if not exists public.weather_ensemble_pulls (
  id uuid primary key default gen_random_uuid(),
  pulled_at timestamptz not null default now(),
  run_at jsonb,              -- model -> initialisation time, from Open-Meteo meta.json
  cells int, rows_written int,
  degraded boolean not null default false,
  errors jsonb,
  duration_ms int
);

create table if not exists public.weather_ensemble (
  pull_id uuid not null references public.weather_ensemble_pulls(id) on delete cascade,
  cell_key text not null,          -- 'lat,lng' rounded to 0.25 deg (same as weather-pull cellKey)
  model text not null,             -- ecmwf_ifs025 | gfs025 | ukmo_global_ensemble_20km | dmi_harmonie_arome_europe
  valid_at timestamptz not null,
  cloud_total smallint[], cloud_low smallint[], cloud_mid smallint[], cloud_2m smallint[],
  rh smallint[], temp real[], dew real[], wind real[], gust real[], precip real[],
  wcode smallint[], vis real[], cloud_base real[],
  primary key (pull_id, cell_key, model, valid_at)
);
create index if not exists weather_ensemble_cell_valid on public.weather_ensemble (cell_key, valid_at);

-- Which cell each shooting stop reads its ensemble from.
create or replace view public.stop_cell_map as
  select s.id stop_id, s.trip_id,
         (round(s.lat/0.25)*0.25)::text || ',' || (round(s.lng/0.25)*0.25)::text cell_key
  from public.stops s
  where s.lat is not null and s.shot_type is distinct from 'logistics';

-- 3. Free-plan guard: log DB size daily, warn at 400 MB.
create or replace function public.db_size_check()
returns bigint language plpgsql set search_path to 'public' as $$
declare v bigint := pg_database_size(current_database());
begin
  insert into app_logs(level, message, data)
  values (case when v > 400*1024*1024 then 'warn' else 'info' end,
          'db_size_check: ' || pg_size_pretty(v),
          jsonb_build_object('bytes', v,
            'weather_ensemble', pg_total_relation_size('public.weather_ensemble'),
            'weather_forecasts', pg_total_relation_size('public.weather_forecasts')));
  return v;
end $$;

select cron.schedule('db-size-check', '40 4 * * *', 'select public.db_size_check();');
