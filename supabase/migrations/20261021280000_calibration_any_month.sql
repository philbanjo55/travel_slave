-- Calibration history for any station and month (the first version was May
-- at EKVG only). New names so the May functions stay as they are:
--   calib_queue_month(site, month, years[], forecast_years[]) queues one IEM
--     METAR request per year (that month only) and one Open-Meteo
--     previous-runs request per forecast year; calib_load_history() loads
--     them as before (kind 'metar' / 'forecast:<cell>').
--   solver_fit_calibration_months(site, source, months[]) fits the same
--     reliability bins, daylight = sun above 3 deg at the station.
--   metar_climatology: base rates per station, month and UTC hour.
-- First use: KJAC, December and January, for the Grand Teton winter trip.

create or replace function public.calib_queue_month(p_site text, p_month int, p_years int[], p_forecast_years int[] default '{}')
returns integer language plpgsql set search_path = public as $$
declare y int; n int := 0; v_lat double precision; v_lng double precision; v_cell text; v_req bigint;
        y2 int; m2 int; d0 date; d1 date;
begin
  select lat, lng into v_lat, v_lng from metar_stations where icao = p_site;
  if v_lat is null then raise exception 'unknown station %', p_site; end if;
  v_cell := (round(v_lat / 0.25) * 0.25)::float8::text || ',' || (round(v_lng / 0.25) * 0.25)::float8::text;
  foreach y in array coalesce(p_years, '{}') loop
    y2 := case when p_month = 12 then y + 1 else y end;
    m2 := case when p_month = 12 then 1 else p_month + 1 end;
    select net.http_get(url := format('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=%s'
      || '&data=tmpf&data=dwpf&data=vsby&data=skyc1&data=skyc2&data=skyc3&data=skyc4'
      || '&data=skyl1&data=skyl2&data=skyl3&data=skyl4&data=wxcodes'
      || '&year1=%s&month1=%s&day1=1&year2=%s&month2=%s&day2=1&tz=Etc/UTC&format=onlycomma'
      || '&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3&report_type=4', p_site, y, p_month, y2, m2),
      timeout_milliseconds := 60000) into v_req;
    insert into calib_requests (req_id, kind, site, period) values (v_req, 'metar', p_site, y || '-' || lpad(p_month::text, 2, '0'));
    n := n + 1;
  end loop;
  foreach y in array coalesce(p_forecast_years, '{}') loop
    d0 := make_date(y, p_month, 1);
    d1 := (d0 + interval '1 month' - interval '1 day')::date;
    select net.http_get(url := format('https://previous-runs-api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s'
      || '&models=ecmwf_ifs025&start_date=%s&end_date=%s&timezone=GMT&hourly=%s',
      round(v_lat / 0.25) * 0.25, round(v_lng / 0.25) * 0.25, d0, d1,
      (select string_agg(v || s, ',') from unnest(array['cloud_cover_low','cloud_cover_mid','cloud_cover',
              'relative_humidity_2m','precipitation','temperature_2m','dew_point_2m']) v,
              unnest(array['','_previous_day1','_previous_day2','_previous_day3','_previous_day4','_previous_day5']) s)),
      timeout_milliseconds := 60000) into v_req;
    insert into calib_requests (req_id, kind, site, period) values (v_req, 'forecast:' || v_cell, p_site, y || '-' || lpad(p_month::text, 2, '0'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace view public.metar_climatology as
select e.station, extract(month from e.hr)::int as month, extract(hour from e.hr)::int as utc_hour, count(*) as n,
       round(avg(e.low_cloud::int)::numeric, 3) as p_low_cloud,
       round(avg(e.fog::int)::numeric, 3) as p_fog,
       round(avg(e.mostly_clear::int)::numeric, 3) as p_mostly_clear,
       round(avg(e.rain::int)::numeric, 3) as p_precip
  from metar_history_events e
 group by e.station, extract(month from e.hr), extract(hour from e.hr);

create or replace function public.solver_fit_calibration_months(p_site text, p_source text, p_months int[])
returns integer language plpgsql set search_path = public as $$
declare v_rows integer; v_lat double precision; v_lng double precision;
begin
  select lat, lng into v_lat, v_lng from metar_stations where icao = p_site;
  with x as (
    select f.lead_day, f.cloud_low, f.cloud_mid, f.cloud_total, f.rh, f.precip, o.*
      from hist_forecast f
      join metar_history_events o on o.station = f.site and o.hr = f.valid_at
     where f.site = p_site and extract(month from f.valid_at) = any(p_months)
       and (select sp.altitude from sun_position(f.valid_at, v_lat, v_lng) sp) > 3
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
