-- Calibration from history (Phil, 20 Oct 2026: "learn from past Mays now").
--
-- metar_history: hourly airport observations for past Mays from the Iowa
--   Environmental Mesonet METAR archive (free), same event definitions as
--   station_obs_hourly / solver_verify_run.
-- hist_forecast: what ECMWF IFS (deterministic, 0.25 deg) said for those
--   hours, from Open-Meteo's previous-runs archive. Lead 0 = the first day of
--   each run; the archive keeps low/mid cloud only for lead 0, total cloud,
--   humidity, rain, temperature and dew point for leads 0-5 days.
-- solver_calibration: per event, predictor bin and lead, how often the event
--   was observed (p_obs) when the forecast was in that bin. Fitted by
--   solver_fit_calibration(); read-only for now, the builder does not use it
--   until the backtest shows it helps.
--
-- Loading is two steps because pg_net is asynchronous: queue the requests
-- (calib_queue_history), then load the responses (calib_load_history).

create table if not exists public.metar_history (
  station text not null,
  hr timestamptz not null,
  reports smallint not null,
  cloud_pct real,             -- mean of the hour's reports, metar_cloud_pct(max cover)
  ceiling_ft integer,         -- lowest BKN/OVC/VV base
  lowest_cloud_ft integer,
  visibility_m integer,
  fog boolean,
  mist boolean,
  wet boolean,
  temp_c real,
  dew_c real,
  wx text,
  primary key (station, hr)
);

create table if not exists public.hist_forecast (
  site text not null,         -- station the cell was chosen for (EKVG)
  cell_key text not null,     -- weather_ensemble cell convention
  model text not null,
  lead_day smallint not null, -- 0 = first day of the run, n = run from n days earlier
  valid_at timestamptz not null,
  cloud_low real, cloud_mid real, cloud_total real,
  rh real, precip real, temp_c real, dew_c real,
  primary key (site, model, lead_day, valid_at)
);

create table if not exists public.solver_calibration (
  source text not null,       -- e.g. 'history_may'
  site text not null,
  event text not null,        -- low_cloud | mostly_clear | fog | rain
  predictor text not null,    -- forecast field the bin is on
  lead_day smallint not null,
  bin_lo real not null,
  bin_hi real not null,
  n integer not null,
  p_obs real not null,        -- observed frequency of the event in this bin
  p_rule real not null,       -- share of these hours where the solver's rule says "event"
  fitted_at timestamptz not null default now(),
  primary key (source, site, event, predictor, lead_day, bin_lo)
);

create table if not exists public.calib_requests (
  req_id bigint primary key,
  kind text not null,         -- metar | forecast
  site text not null,
  period text not null,
  loaded_at timestamptz,
  rows integer
);

-- Queue one METAR request per May and one forecast request per May with an
-- archive (2024 on). Call, wait ~30 s, then calib_load_history().
create or replace function public.calib_queue_history(p_site text default 'EKVG',
  p_years int[] default null, p_forecast_years int[] default '{2024,2025,2026}')
returns integer language plpgsql set search_path = public as $$
declare y int; n int := 0; v_lat double precision; v_lng double precision; v_cell text; v_req bigint;
begin
  select lat, lng into v_lat, v_lng from metar_stations where icao = p_site;
  if v_lat is null then raise exception 'unknown station %', p_site; end if;
  -- weather_ensemble cell convention: round to 0.25 deg.
  v_cell := (round(v_lat / 0.25) * 0.25)::float8::text || ',' || (round(v_lng / 0.25) * 0.25)::float8::text;
  foreach y in array coalesce(p_years, array(select generate_series(2010, extract(year from now())::int))) loop
    select net.http_get(url := format('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=%s'
      || '&data=tmpf&data=dwpf&data=vsby&data=skyc1&data=skyc2&data=skyc3&data=skyc4'
      || '&data=skyl1&data=skyl2&data=skyl3&data=skyl4&data=wxcodes'
      || '&year1=%s&month1=5&day1=1&year2=%s&month2=6&day2=1&tz=Etc/UTC&format=onlycomma'
      || '&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3&report_type=4', p_site, y, y),
      timeout_milliseconds := 60000) into v_req;
    insert into calib_requests (req_id, kind, site, period) values (v_req, 'metar', p_site, y || '-05');
    n := n + 1;
  end loop;
  foreach y in array p_forecast_years loop
    select net.http_get(url := format('https://previous-runs-api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s'
      || '&models=ecmwf_ifs025&start_date=%s-05-01&end_date=%s-05-31&timezone=GMT&hourly=%s',
      round(v_lat / 0.25) * 0.25, round(v_lng / 0.25) * 0.25, y, y,
      (select string_agg(v || s, ',') from unnest(array['cloud_cover_low','cloud_cover_mid','cloud_cover',
              'relative_humidity_2m','precipitation','temperature_2m','dew_point_2m']) v,
              unnest(array['','_previous_day1','_previous_day2','_previous_day3','_previous_day4','_previous_day5']) s)),
      timeout_milliseconds := 60000) into v_req;
    insert into calib_requests (req_id, kind, site, period) values (v_req, 'forecast:' || v_cell, p_site, y || '-05');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.calib_load_history()
returns jsonb language plpgsql set search_path = public as $$
declare q record; v_rows integer; v_out jsonb := '[]'::jsonb; v_cell text;
begin
  for q in select c.*, r.status_code, r.content from calib_requests c
             join net._http_response r on r.id = c.req_id
            where c.loaded_at is null loop
    if q.status_code is distinct from 200 then
      v_out := v_out || jsonb_build_object('req', q.req_id, 'period', q.period, 'status', q.status_code);
      continue;
    end if;
    if q.kind = 'metar' then
      with lines as (
        select string_to_array(l, ',') f from unnest(string_to_array(q.content, E'\n')) l
         where l like q.site || ',%'
      ), rep as (
        select date_trunc('hour', (f[2] || '+00')::timestamptz + interval '10 minutes') hr,
               nullif(f[3], 'M')::real tf, nullif(f[4], 'M')::real df, nullif(f[5], 'M')::real vsby,
               array[f[6], f[7], f[8], f[9]] sc,
               array[nullif(f[10], 'M')::real, nullif(f[11], 'M')::real, nullif(f[12], 'M')::real, nullif(f[13], 'M')::real] sl,
               coalesce(nullif(f[14], 'M'), '') wx
          from lines
      ), rep2 as (
        select r.*,
               (select max(case c when 'FEW' then 1 when 'SCT' then 2 when 'BKN' then 3 when 'OVC' then 4 when 'VV' then 5
                                  when 'CLR' then 0 when 'SKC' then 0 when 'NSC' then 0 when 'NCD' then 0 end)
                  from unnest(r.sc) c) cover_rank,
               (select min(r.sl[i]) from generate_subscripts(r.sc, 1) i where r.sc[i] in ('BKN', 'OVC', 'VV')) ceil_ft,
               (select min(r.sl[i]) from generate_subscripts(r.sc, 1) i where r.sc[i] in ('FEW', 'SCT', 'BKN', 'OVC', 'VV')) low_ft
          from rep r
      )
      insert into metar_history (station, hr, reports, cloud_pct, ceiling_ft, lowest_cloud_ft, visibility_m,
                                 fog, mist, wet, temp_c, dew_c, wx)
      select q.site, hr, count(*),
             avg(case cover_rank when 0 then 0 when 1 then 19 when 2 then 44 when 3 then 75 when 4 then 100 when 5 then 100 end),
             min(ceil_ft), min(low_ft), round(min(vsby) * 1609.34),
             bool_or(wx ~ '(^|\s)[-+]?(MI|BC|PR|FZ)?FG'), bool_or(wx ~ '(^|\s)BR'),
             bool_or(wx ~ '(RA|DZ|SN|SG|GR|GS|PL|UP)'),
             avg((tf - 32) / 1.8), avg((df - 32) / 1.8),
             nullif(string_agg(distinct nullif(wx, ''), ' | '), '')
        from rep2 group by hr
      on conflict (station, hr) do update set reports = excluded.reports, cloud_pct = excluded.cloud_pct,
        ceiling_ft = excluded.ceiling_ft, lowest_cloud_ft = excluded.lowest_cloud_ft, visibility_m = excluded.visibility_m,
        fog = excluded.fog, mist = excluded.mist, wet = excluded.wet, temp_c = excluded.temp_c, dew_c = excluded.dew_c, wx = excluded.wx;
      get diagnostics v_rows = row_count;
    else
      v_cell := split_part(q.kind, ':', 2);
      with j as (select try_jsonb(q.content)->'hourly' h),
      leads as (select l, case when l = 0 then '' else '_previous_day' || l end sfx from generate_series(0, 5) l)
      insert into hist_forecast (site, cell_key, model, lead_day, valid_at, cloud_low, cloud_mid, cloud_total, rh, precip, temp_c, dew_c)
      select q.site, v_cell, 'ecmwf_ifs025', ld.l, (t.v #>> '{}' || ':00+00')::timestamptz,
             (j.h -> ('cloud_cover_low' || ld.sfx) ->> (t.i - 1)::int)::real,
             (j.h -> ('cloud_cover_mid' || ld.sfx) ->> (t.i - 1)::int)::real,
             (j.h -> ('cloud_cover' || ld.sfx) ->> (t.i - 1)::int)::real,
             (j.h -> ('relative_humidity_2m' || ld.sfx) ->> (t.i - 1)::int)::real,
             (j.h -> ('precipitation' || ld.sfx) ->> (t.i - 1)::int)::real,
             (j.h -> ('temperature_2m' || ld.sfx) ->> (t.i - 1)::int)::real,
             (j.h -> ('dew_point_2m' || ld.sfx) ->> (t.i - 1)::int)::real
        from j cross join leads ld
        cross join lateral jsonb_array_elements(j.h -> 'time') with ordinality t(v, i)
       where (j.h -> ('cloud_cover' || ld.sfx) ->> (t.i - 1)::int) is not null
      on conflict (site, model, lead_day, valid_at) do update set cloud_low = excluded.cloud_low,
        cloud_mid = excluded.cloud_mid, cloud_total = excluded.cloud_total, rh = excluded.rh,
        precip = excluded.precip, temp_c = excluded.temp_c, dew_c = excluded.dew_c;
      get diagnostics v_rows = row_count;
    end if;
    update calib_requests set loaded_at = now(), rows = v_rows where req_id = q.req_id;
    v_out := v_out || jsonb_build_object('period', q.period, 'kind', q.kind, 'rows', v_rows);
  end loop;
  return v_out;
end $$;

-- Observed events per hour, same definitions as solver_verify_run. Hours with
-- no cloud data are unknown, not clear (May 2010 in the IEM archive has
-- almost no cloud groups, so it drops out of everything but fog-free counts).
create or replace view public.metar_history_events as
select station, hr,
       case when cloud_pct is not null then cloud_pct <= 50 end as mostly_clear,
       case when ceiling_ft is not null or cloud_pct is not null or fog
            then coalesce(ceiling_ft < 2000, false) or coalesce(fog, false) end as low_cloud,
       case when cloud_pct is not null and (fog is not null or visibility_m is not null)
            then coalesce(fog, false) or coalesce(visibility_m < 1000, false) end as fog,
       case when cloud_pct is not null then wet end as rain
  from metar_history;

-- May base rates by UTC hour (all years in metar_history).
create or replace view public.may_climatology as
select station, extract(hour from hr)::int as utc_hour, count(*) as n,
       round(avg(low_cloud::int)::numeric, 3) as p_low_cloud,
       round(avg(fog::int)::numeric, 3) as p_fog,
       round(avg(mostly_clear::int)::numeric, 3) as p_mostly_clear,
       round(avg(rain::int)::numeric, 3) as p_rain
  from metar_history_events
 where extract(month from hr) = 5
 group by station, extract(hour from hr);

-- Reliability tables: for each forecast bin, how often the event happened.
-- Daylight hours only (04-21 UTC in May at Vagar). p_rule is how often the
-- solver's own member rule (the one solver_verify_run uses) says "event".
create or replace function public.solver_fit_calibration(p_site text default 'EKVG', p_source text default 'history_may')
returns integer language plpgsql set search_path = public as $$
declare v_rows integer;
begin
  with x as (
    select f.lead_day, f.cloud_low, f.cloud_mid, f.cloud_total, f.rh, f.precip, o.*
      from hist_forecast f
      join metar_history_events o on o.station = f.site and o.hr = f.valid_at
     where f.site = p_site and extract(month from f.valid_at) = 5
       and extract(hour from f.valid_at) between 4 and 21
  ), long as (
    select lead_day, 'low_cloud' as event, 'cloud_low' as predictor, cloud_low as v, low_cloud as obs,
           (cloud_low >= 70) as rule_says from x where cloud_low is not null
    union all
    select lead_day, 'mostly_clear', 'max_low_mid', greatest(cloud_low, cloud_mid), mostly_clear,
           greatest(cloud_low, cloud_mid) <= 50 from x where cloud_low is not null and cloud_mid is not null
    union all
    select lead_day, 'mostly_clear', 'cloud_total', cloud_total, mostly_clear, cloud_total <= 50
      from x where cloud_total is not null
    union all
    select lead_day, 'fog', 'rh', rh, fog, (rh >= 97 and coalesce(cloud_low, 0) >= 90) from x where rh is not null
    union all
    select lead_day, 'rain', 'precip', precip, rain, precip >= 0.2 from x where precip is not null
  ), binned as (
    select l.*, b.lo, b.hi
      from long l
      join lateral (select bb.lo, bb.hi from (values
          ('cloud_low', 0, 10), ('cloud_low', 10, 30), ('cloud_low', 30, 50), ('cloud_low', 50, 70), ('cloud_low', 70, 90), ('cloud_low', 90, 101),
          ('max_low_mid', 0, 10), ('max_low_mid', 10, 30), ('max_low_mid', 30, 50), ('max_low_mid', 50, 70), ('max_low_mid', 70, 90), ('max_low_mid', 90, 101),
          ('cloud_total', 0, 10), ('cloud_total', 10, 30), ('cloud_total', 30, 50), ('cloud_total', 50, 70), ('cloud_total', 70, 90), ('cloud_total', 90, 101),
          ('rh', 0, 85), ('rh', 85, 90), ('rh', 90, 94), ('rh', 94, 97), ('rh', 97, 101),
          ('precip', 0, 0.1), ('precip', 0.1, 0.5), ('precip', 0.5, 2), ('precip', 2, 1000)
        ) bb(p, lo, hi) where bb.p = l.predictor and l.v >= bb.lo and l.v < bb.hi) b on true
     where l.obs is not null
  )
  insert into solver_calibration (source, site, event, predictor, lead_day, bin_lo, bin_hi, n, p_obs, p_rule, fitted_at)
  select p_source, p_site, event, predictor, lead_day, lo, hi, count(*),
         avg(obs::int), avg(rule_says::int), now()
    from binned group by event, predictor, lead_day, lo, hi
  on conflict (source, site, event, predictor, lead_day, bin_lo) do update set
    bin_hi = excluded.bin_hi, n = excluded.n, p_obs = excluded.p_obs, p_rule = excluded.p_rule, fitted_at = excluded.fitted_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Loaded 20 Oct 2026: select calib_queue_history(); then calib_load_history()
-- (IEM throttles parallel requests: re-queue failed years one at a time with
-- calib_queue_history('EKVG', '{year}', '{}')), then solver_fit_calibration().
