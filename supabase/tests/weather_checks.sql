-- Live checks for the weather pipeline (weather-pull v35, model_skill,
-- weather_score). Read-only: one SELECT, one row per check, columns
-- (n, check_name, status, detail). status is PASS, FAIL or WARN.
--
-- Written as a single statement with no semicolons anywhere, because the
-- Supabase MCP connector silently cancels some SQL that contains them.
-- Paste into the SQL editor or run through execute_sql as-is.
--
-- Day ids used:
--   Faroes D2 (resolution trip)  370523e6-035f-4fd6-ae11-ab8219d9f546
--   Tetons D1 (skill trip)       80982967-2312-487a-98b6-b16b1f2b66dd
-- Run weather-pull on both (test=true) first. "v35" below is the newest
-- preview pull per stop and "prev" the one before it, which is what the
-- Faroes before/after checks compare.

with
fx as (
  select '{"is_dark":false,"cloud_cover_pct":100,"cloud_cover_low_pct":20,"cloud_cover_mid_pct":100,"visibility_m":30000,"wind_gusts_kmh":5,"wind_speed_kmh":3,"precip_probability_pct":0}'::jsonb j
),
score as (
  select
    (weather_score(jsonb_populate_record(null::weather_forecasts, j || '{"raw":{"provenance":{"stop_elevation_m":50}}}'), 'mountain') -> 'components' ->> 'visibility')::float as faroes_mid_deck,
    (weather_score(jsonb_populate_record(null::weather_forecasts, j || '{"raw":{"provenance":{"stop_elevation_m":2000}}}'), 'mountain') -> 'components' ->> 'visibility')::float as teton_mid_deck,
    (weather_score(jsonb_populate_record(null::weather_forecasts, j), 'mountain') -> 'components' ->> 'visibility')::float as no_elev_mid_deck,
    (weather_score(jsonb_populate_record(null::weather_forecasts, j || '{"cloud_cover_low_pct":95,"cloud_cover_mid_pct":0,"raw":{"provenance":{"stop_elevation_m":50}}}'), 'mountain') -> 'components' ->> 'visibility')::float as faroes_low_deck,
    (weather_score(jsonb_populate_record(null::weather_forecasts, j || '{"cloud_cover_low_pct":95,"cloud_cover_mid_pct":0,"raw":{"provenance":{"stop_elevation_m":2000}}}'), 'mountain') -> 'components' ->> 'visibility')::float as teton_low_deck,
    (weather_score(jsonb_populate_record(null::weather_forecasts, j || '{"raw":{"provenance":{"stop_elevation_m":2000}}}'), 'waterfall') -> 'components' ->> 'visibility')::float as teton_nonmountain
  from fx
),
-- Newest pull per stop for the two test days, and the pull before it.
pulls as (
  select f.*, row_number() over (partition by f.stop_id order by f.fetched_at desc) rn
  from weather_forecasts f
  where f.day_id in ('370523e6-035f-4fd6-ae11-ab8219d9f546', '80982967-2312-487a-98b6-b16b1f2b66dd')
    and f.raw -> 'provenance' ->> 'date_mode' = 'preview'
),
v35 as (select * from pulls where rn = 1),
prev as (select * from pulls where rn = 2),
far as (select * from v35 where day_id = '370523e6-035f-4fd6-ae11-ab8219d9f546'),
tet as (select * from v35 where day_id = '80982967-2312-487a-98b6-b16b1f2b66dd'),
-- Expected skill pick: lowest skill_score at this station and lead, enough
-- hours, fresh, and the model returned cloud layers for this hour.
skill_expect as (
  select t.stop_id, t.primary_model as got,
    (select ms.model from model_skill ms
      where ms.station = t.raw -> 'provenance' ->> 'metar_station'
        and ms.lead_day = (t.raw -> 'provenance' ->> 'skill_lead_day')::int
        and ms.n_hours >= 120
        and ms.computed_at > t.fetched_at - interval '3 days'
        and t.raw -> 'models' -> ms.model ->> 'cloud_cover_low_pct' is not null
      order by ms.skill_score, ms.model limit 1) as want
  from tet t
  where t.raw -> 'provenance' ->> 'primary_selection' = 'skill'
),
dupes as (
  select a.station, a.lead_day, a.model m1, b.model m2
  from model_skill a
  join model_skill b on b.station = a.station and b.lead_day = a.lead_day and a.model < b.model
  join weather_models wa on wa.model = a.model
  join weather_models wb on wb.model = b.model and wb.centre <> wa.centre
  where a.n_hours = b.n_hours and a.temp_mae_c = b.temp_mae_c and a.cloud_mae_pct = b.cloud_mae_pct
    and a.n_hours >= 120
),
cov as (
  select st, (select count(distinct lead_day) from model_skill ms
               where ms.station = st and ms.n_hours >= 120 and ms.computed_at > now() - interval '2 days') leads,
             (select count(*) from model_skill ms
               where ms.station = st and ms.n_hours >= 120 and ms.computed_at > now() - interval '2 days') rows_ok,
             (select count(*) from station_obs_hourly o where o.station = st and o.hr > now() - interval '14 days') obs_hours
  from active_metar_stations() st
),
-- Days that rely on the automatic pick: upcoming trips with no manual
-- trips.metar_station override.
active_days as (
  select d.id, d.metar_station from days d join trips t on t.id = d.trip_id
  where t.archived is not true and (t.end_date is null or t.end_date >= current_date)
    and nullif(trim(t.metar_station), '') is null
),
-- Every automatic pick made so far, with how far the airport is from the
-- middle of that day's stops.
picks as (
  select d.id, d.metar_station,
    gc_km(m.lat, m.lng,
          percentile_cont(0.5) within group (order by s.lat),
          percentile_cont(0.5) within group (order by s.lng)) km
  from days d
  join metar_stations m on m.icao = d.metar_station
  join stops s on s.day_id = d.id and s.lat is not null
  group by d.id, d.metar_station, m.lat, m.lng
)

select 1 n, 'score: Faroes (50 m) mid-level deck does NOT hide summits' check_name,
  case when faroes_mid_deck = 0 then 'PASS' else 'FAIL' end status,
  'visibility penalty ' || faroes_mid_deck || ' (want 0, same as before)' detail from score
union all select 2, 'score: Faroes (50 m) low deck still hides summits',
  case when faroes_low_deck >= 2 then 'PASS' else 'FAIL' end,
  'visibility penalty ' || faroes_low_deck || ' (want 2)' from score
union all select 3, 'score: Tetons (2000 m) mid-level deck DOES hide summits',
  case when teton_mid_deck >= 2 then 'PASS' else 'FAIL' end,
  'visibility penalty ' || teton_mid_deck || ' (want 2)' from score
union all select 4, 'score: Tetons (2000 m) low deck still hides summits',
  case when teton_low_deck >= 2 then 'PASS' else 'FAIL' end,
  'visibility penalty ' || teton_low_deck || ' (want 2)' from score
union all select 5, 'score: rows with no elevation behave exactly as before',
  case when no_elev_mid_deck = faroes_mid_deck then 'PASS' else 'FAIL' end,
  'no-elevation ' || no_elev_mid_deck || ' vs Faroes ' || faroes_mid_deck from score
union all select 6, 'score: elevation rule only touches mountain shots',
  case when teton_nonmountain = 0 then 'PASS' else 'FAIL' end,
  'waterfall at 2000 m penalty ' || teton_nonmountain from score

union all select 7, 'metar_cloud_pct: CLR/SKC = 0, OVC = 100, FEW < SCT < BKN < OVC',
  case when metar_cloud_pct('CLR') = 0 and metar_cloud_pct('SKC') = 0 and metar_cloud_pct('OVC') = 100
        and metar_cloud_pct('FEW') < metar_cloud_pct('SCT') and metar_cloud_pct('SCT') < metar_cloud_pct('BKN')
        and metar_cloud_pct('BKN') < metar_cloud_pct('OVC') then 'PASS' else 'FAIL' end,
  'FEW ' || metar_cloud_pct('FEW') || ', SCT ' || metar_cloud_pct('SCT') || ', BKN ' || metar_cloud_pct('BKN')
union all select 8, 'gc_km: one degree of longitude at the equator = 111.2 km',
  case when gc_km(0, 0, 0, 1) between 111.1 and 111.3 then 'PASS' else 'FAIL' end,
  round(gc_km(0, 0, 0, 1)::numeric, 2) || ' km'

union all select 9, 'grading location: KJAC graded at the airport (within 1 km of published coords)',
  case when gc_km(m.lat, m.lng, 43.6074, -110.7379) < 1 then 'PASS' else 'FAIL' end,
  round(gc_km(m.lat, m.lng, 43.6074, -110.7379)::numeric, 2) || ' km from the FAA reference point'
  from metar_stations m where m.icao = 'KJAC'
union all select 10, 'grading location: EKVG graded at the airport (within 1 km of published coords)',
  case when gc_km(m.lat, m.lng, 62.0633, -7.2764) < 1 then 'PASS' else 'FAIL' end,
  round(gc_km(m.lat, m.lng, 62.0633, -7.2764)::numeric, 2) || ' km from the AIP reference point'
  from metar_stations m where m.icao = 'EKVG'
union all select 11, 'grading location: model forecasts requested at the station coords, not a stop',
  case when position('join metar_stations m on m.icao = a.icao' in pg_get_functiondef('public.refresh_model_skill_step(integer)'::regprocedure)) > 0
        and position('latitude=%s&longitude=%s' in pg_get_functiondef('public.refresh_model_skill_step(integer)'::regprocedure)) > 0
       then 'PASS' else 'FAIL' end,
  'previous-runs request built from metar_stations.lat/lng'

union all select 12, 'skill coverage: ' || st || ' graded at all 7 lead days, fresh',
  case when leads = 7 then 'PASS' else 'FAIL' end,
  leads || ' leads, ' || rows_ok || ' model-lead scores, ' || obs_hours || ' obs hours in 14 days'
  from cov
union all select 13, 'skill coverage: ' || st || ' has a full 14 days of observations',
  case when obs_hours >= 300 then 'PASS' else 'WARN' end,
  obs_hours || ' of ~336 hours (aviationweather caps history for some stations)'
  from cov

union all select 14, 'deploy: newest pulls were written by v35-tested',
  case when count(*) > 0 and bool_and(raw -> 'provenance' ->> 'version' = 'v35-tested') then 'PASS' else 'FAIL' end,
  count(*) || ' rows, versions ' || string_agg(distinct raw -> 'provenance' ->> 'version', ',')
  from v35

union all select 15, 'Faroes: still in resolution mode (trip setting and every row)',
  case when (select primary_selection from trips where id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d') = 'resolution'
        and bool_and(raw -> 'provenance' ->> 'primary_selection' = 'resolution') then 'PASS' else 'FAIL' end,
  count(*) || ' rows'
  from far
union all select 16, 'Faroes: region rule changed nothing',
  case when bool_and(coalesce(jsonb_array_length(raw -> 'provenance' -> 'region_adjustments'), 0) = 0) then 'PASS' else 'FAIL' end,
  count(*) || ' rows checked'
  from far
union all select 17, 'Faroes: main model per stop identical to the previous pull',
  case when count(*) > 0 and count(*) filter (where c.primary_model is distinct from p.primary_model) = 0 then 'PASS' else 'FAIL' end,
  count(*) filter (where c.primary_model is distinct from p.primary_model) || ' of ' || count(*) || ' stops changed (prev was '
    || coalesce(string_agg(distinct p.raw -> 'provenance' ->> 'version', ','), '?') || ')'
  from far c join prev p on p.stop_id = c.stop_id
union all select 18, 'Faroes: centre representatives identical to the previous pull',
  case when count(*) > 0 and count(*) filter (where c.raw -> 'consensus' -> 'representatives' is distinct from p.raw -> 'consensus' -> 'representatives') = 0 then 'PASS' else 'FAIL' end,
  count(*) filter (where c.raw -> 'consensus' -> 'representatives' is distinct from p.raw -> 'consensus' -> 'representatives') || ' of ' || count(*) || ' stops changed'
  from far c join prev p on p.stop_id = c.stop_id
union all select 19, 'Faroes: ground truth is EKVG',
  case when bool_and(raw -> 'provenance' ->> 'metar_station' = 'EKVG') then 'PASS' else 'FAIL' end,
  string_agg(distinct raw -> 'provenance' ->> 'metar_station', ',')
  from far

union all select 20, 'Tetons: DMI blend excluded (it is ECMWF in disguise outside Europe)',
  case when count(*) > 0 and bool_and(raw -> 'provenance' -> 'region_adjustments' @> '[{"model":"dmi_seamless","action":"excluded"}]'
        and not (raw -> 'models' ? 'dmi_seamless')) then 'PASS' else 'FAIL' end,
  count(*) || ' rows'
  from tet
union all select 21, 'Tetons: ICON blend relabelled at its true 13 km',
  case when count(*) > 0 and bool_and(raw -> 'provenance' -> 'region_adjustments' @> '[{"model":"icon_seamless","action":"downgraded","resolution_km":13}]') then 'PASS' else 'FAIL' end,
  count(*) || ' rows'
  from tet
union all select 22, 'Tetons: no centre votes twice',
  case when count(*) > 0 and bool_and((raw -> 'consensus' ->> 'centre_count')::int = jsonb_array_length(raw -> 'consensus' -> 'centres')) then 'PASS' else 'FAIL' end,
  'centres per stop: ' || string_agg(distinct raw -> 'consensus' ->> 'centre_count', ',')
  from tet
union all select 23, 'Tetons: main model chosen by measured accuracy',
  case when count(*) > 0 and bool_and(raw -> 'provenance' ->> 'primary_selection' = 'skill') then 'PASS' else 'FAIL' end,
  string_agg(distinct (raw -> 'provenance' ->> 'primary_selection') || ' -> ' || primary_model, ', ')
  from tet
union all select 24, 'Tetons: chosen model really is the best-scoring one with cloud layers',
  case when count(*) > 0 and count(*) filter (where got is distinct from want) = 0 then 'PASS' else 'FAIL' end,
  count(*) filter (where got is distinct from want) || ' of ' || count(*) || ' stops mismatched, picked ' || string_agg(distinct got, ',')
  from skill_expect
union all select 25, 'Tetons: ground truth is KJAC',
  case when bool_and(raw -> 'provenance' ->> 'metar_station' = 'KJAC') then 'PASS' else 'FAIL' end,
  string_agg(distinct (raw -> 'provenance' ->> 'metar_station') || ' (' || (raw -> 'provenance' ->> 'metar_station_source') || ')', ',')
  from tet
union all select 26, 'Tetons: every row carries stop elevation for summit scoring',
  case when count(*) > 0 and bool_and(raw -> 'provenance' ->> 'stop_elevation_m' is not null) then 'PASS' else 'FAIL' end,
  'elevations ' || min((raw -> 'provenance' ->> 'stop_elevation_m')::float) || '-' || max((raw -> 'provenance' ->> 'stop_elevation_m')::float) || ' m'
  from tet
union all select 27, 'Tetons: trigger stamped a score on every scorable row',
  case when count(*) > 0 and count(*) filter (where s.shot_type <> 'logistics' and t.score_stars is null) = 0 then 'PASS' else 'FAIL' end,
  count(*) filter (where t.score_stars is not null) || ' of ' || count(*) || ' rows scored'
  from tet t join stops s on s.id = t.stop_id

union all select 28, 'new trips: every day without an override has a station picked',
  case when count(*) filter (where metar_station is null) = 0 then 'PASS' else 'FAIL' end,
  count(*) filter (where metar_station is null) || ' of ' || count(*) || ' days unpicked, '
    || count(*) filter (where metar_station = '-') || ' with no airport in range'
  from active_days
union all select 29, 'new trips: every automatic pick is within 100 km of its day''s stops',
  case when count(*) > 0 and bool_and(km <= 100) then 'PASS' else 'FAIL' end,
  count(*) || ' days picked, farthest ' || round(max(km)::numeric, 1) || ' km, stations ' || string_agg(distinct metar_station, ',')
  from picks

union all select 30, 'hidden duplicates: different centres scoring identically',
  case when count(*) = 0 then 'PASS' else 'WARN' end,
  coalesce(string_agg(distinct m1 || '=' || m2 || '@' || station, ', '), 'none')
  from dupes

union all select 31, 'cron: model-skill-refresh healthy in the last 24 h',
  case when count(*) > 0 and count(*) filter (where r.status <> 'succeeded') = 0 then 'PASS' else 'FAIL' end,
  count(*) || ' runs, ' || count(*) filter (where r.status <> 'succeeded') || ' failed'
  from cron.job_run_details r join cron.job j on j.jobid = r.jobid
  where j.jobname = 'model-skill-refresh' and r.start_time > now() - interval '24 hours'
union all select 32, 'cron: hourly-weather-pull healthy in the last 24 h',
  case when count(*) > 0 and count(*) filter (where r.status <> 'succeeded') = 0 then 'PASS' else 'FAIL' end,
  count(*) || ' runs, ' || count(*) filter (where r.status <> 'succeeded') || ' failed'
  from cron.job_run_details r join cron.job j on j.jobid = r.jobid
  where j.jobname = 'hourly-weather-pull' and r.start_time > now() - interval '24 hours'

order by n
