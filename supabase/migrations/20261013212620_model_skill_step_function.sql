-- Stations currently in use: trip override, else each upcoming day's auto pick.
create or replace function public.active_metar_stations()
returns setof text language sql stable set search_path to 'public' as $$
  select distinct upper(coalesce(nullif(trim(t.metar_station), ''), d.metar_station))
  from days d join trips t on t.id = d.trip_id
  where t.archived is not true
    and (t.end_date is null or t.end_date >= current_date)
    and coalesce(nullif(trim(t.metar_station), ''), d.metar_station) is not null
    and coalesce(nullif(trim(t.metar_station), ''), d.metar_station) <> '-'
$$;

-- Cron every 10 min. Each call harvests whatever HTTP responses have landed,
-- then queues the next pieces. Probes are marked done, never removed, so a
-- failed request (429/5xx) is simply re-queued on the next pass.
-- NOTE: the aggregate column "n" below collided with the OUT column "n";
-- fixed by 20261013212924_model_skill_step_fix_ambiguous_n.
create or replace function public.refresh_model_skill_step(p_max_forecast_requests integer default 3)
returns table(stage text, n integer)
language plpgsql
set search_path to 'public'
as $function$
declare
  r record;
  v_n integer;
  v_rows integer;
  v_models text;
  v_vars text;
  v_queued_fc integer := 0;
begin
  -- A. Harvest auto station lookups (per day)
  v_n := 0;
  for r in
    select p.req_id, p.day_id, h.status_code, try_jsonb(h.content) j
    from skill_probe p join net._http_response h on h.id = p.req_id
    where p.kind = 'station_lookup' and not p.done
  loop
    if r.status_code = 200 and jsonb_typeof(r.j) = 'array' then
      insert into metar_stations(icao, name, lat, lng, elev_m, has_taf, fetched_at)
      select e->>'icaoId', e->>'site', (e->>'lat')::float, (e->>'lon')::float, (e->>'elev')::float,
             coalesce(e->'siteType' ? 'TAF', false), now()
      from jsonb_array_elements(r.j) e
      where e->>'icaoId' is not null and e->'siteType' ? 'METAR'
      on conflict (icao) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
        elev_m = excluded.elev_m, has_taf = excluded.has_taf, fetched_at = now();

      -- Prefer a proper airport (has TAF) within 60 km, else nearest METAR within 100 km.
      with c as (
        select percentile_cont(0.5) within group (order by s.lat) lat,
               percentile_cont(0.5) within group (order by s.lng) lng
        from stops s where s.day_id = r.day_id and s.lat is not null
      ), cand as (
        select (e->>'icaoId') icao, coalesce(e->'siteType' ? 'TAF', false) taf,
               gc_km(c.lat, c.lng, (e->>'lat')::float, (e->>'lon')::float) km
        from jsonb_array_elements(r.j) e, c
        where e->'siteType' ? 'METAR'
      ), pick as (
        select icao from cand
        where (taf and km <= 60) or km <= 100
        order by (taf and km <= 60) desc, km asc limit 1
      )
      update days set metar_station = coalesce((select icao from pick), '-') where id = r.day_id;
      v_n := v_n + 1;
    end if;
    update skill_probe set done = true where req_id = r.req_id;
  end loop;
  stage := 'station_lookup_harvested'; n := v_n; return next;

  -- B. Harvest station info for manually set stations
  v_n := 0;
  for r in
    select p.req_id, h.status_code, try_jsonb(h.content) j
    from skill_probe p join net._http_response h on h.id = p.req_id
    where p.kind = 'station_info' and not p.done
  loop
    if r.status_code = 200 and jsonb_typeof(r.j) = 'array' then
      insert into metar_stations(icao, name, lat, lng, elev_m, has_taf, fetched_at)
      select e->>'icaoId', e->>'site', (e->>'lat')::float, (e->>'lon')::float, (e->>'elev')::float,
             coalesce(e->'siteType' ? 'TAF', false), now()
      from jsonb_array_elements(r.j) e where e->>'icaoId' is not null
      on conflict (icao) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
        elev_m = excluded.elev_m, has_taf = excluded.has_taf, fetched_at = now();
      v_n := v_n + 1;
    end if;
    update skill_probe set done = true where req_id = r.req_id;
  end loop;
  stage := 'station_info_harvested'; n := v_n; return next;

  -- C. Harvest observations
  v_n := 0;
  for r in
    select p.req_id, p.station, h.status_code, try_jsonb(h.content) j
    from skill_probe p join net._http_response h on h.id = p.req_id
    where p.kind = 'obs' and not p.done
  loop
    if r.status_code = 200 and jsonb_typeof(r.j) = 'array' then
      insert into station_obs_hourly(station, hr, temperature_c, cloud_pct, wet, fetched_at)
      select r.station, hr, avg(t), max(c), bool_or(w), now()
      from (
        select date_trunc('hour', (e->>'reportTime')::timestamptz + interval '10 minutes') hr,
               (e->>'temp')::float t,
               metar_cloud_pct(e->>'cover') c,
               coalesce(e->>'wxString','') ~ '(^|\s)[-+]?(SH|TS|FZ)?(RA|SN|DZ|SG|PL|GR|GS|UP)' w
        from jsonb_array_elements(r.j) e
        where e->>'reportTime' is not null
      ) x
      group by hr
      on conflict (station, hr) do update set temperature_c = excluded.temperature_c,
        cloud_pct = excluded.cloud_pct, wet = excluded.wet, fetched_at = now();
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
    end if;
    update skill_probe set done = true where req_id = r.req_id;
  end loop;
  stage := 'obs_harvested'; n := v_n; return next;

  -- D. Harvest forecast leads -> model_skill
  v_n := 0;
  for r in
    select p.req_id, p.station, split_part(p.kind, ':', 2)::int lead, h.status_code,
           try_jsonb(h.content) -> 'hourly' hj
    from skill_probe p join net._http_response h on h.id = p.req_id
    where p.kind like 'lead:%' and not p.done
  loop
    if r.status_code = 200 and r.hj is not null then
      with t as (
        select (tm || ':00+00')::timestamptz hr, (i - 1)::int ix
        from jsonb_array_elements_text(r.hj -> 'time') with ordinality as x(tm, i)
      ), m as (
        select model from weather_models where active
      ), f as (
        select m.model, t.hr,
          (r.hj -> ('temperature_2m_previous_day' || r.lead || '_' || m.model) ->> t.ix)::float ft,
          (r.hj -> ('cloud_cover_previous_day'   || r.lead || '_' || m.model) ->> t.ix)::float fc,
          (r.hj -> ('precipitation_previous_day' || r.lead || '_' || m.model) ->> t.ix)::float fp
        from m cross join t
      ), j as (
        select f.*, o.temperature_c ot, o.cloud_pct oc, o.wet ow
        from f join station_obs_hourly o on o.station = r.station and o.hr = f.hr
        where f.fc is not null and o.cloud_pct is not null
      ), agg as (
        select model, count(*) n,
          avg(abs(ft - ot)) filter (where ft is not null and ot is not null) tmae,
          avg(abs(fc - oc)) cmae,
          100.0 * avg(case when (fc >= 70) = (oc >= 70) then 1 else 0 end) ohit,
          100.0 * avg(case when (coalesce(fp,0) >= 0.1) = coalesce(ow,false) then 1 else 0 end)
            filter (where fp is not null) phit,
          min(hr) w0, max(hr) w1
        from j group by model
      )
      insert into model_skill(station, model, lead_day, n_hours, temp_mae_c, cloud_mae_pct,
                              overcast_hit_pct, precip_hit_pct, skill_score, window_start, window_end, computed_at)
      select r.station, model, r.lead, n, round(tmae::numeric, 2), round(cmae::numeric, 1),
             round(ohit::numeric, 1), round(phit::numeric, 1),
             round((cmae + 0.5 * (100 - ohit) + 0.25 * (100 - coalesce(phit, ohit)))::numeric, 2),
             w0, w1, now()
      from agg
      on conflict (station, model, lead_day) do update set
        n_hours = excluded.n_hours, temp_mae_c = excluded.temp_mae_c, cloud_mae_pct = excluded.cloud_mae_pct,
        overcast_hit_pct = excluded.overcast_hit_pct, precip_hit_pct = excluded.precip_hit_pct,
        skill_score = excluded.skill_score, window_start = excluded.window_start,
        window_end = excluded.window_end, computed_at = now();
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
    end if;
    update skill_probe set done = true where req_id = r.req_id;
  end loop;
  stage := 'skill_harvested'; n := v_n; return next;

  -- E. Queue station lookups for upcoming days that need one
  v_n := 0;
  for r in
    select d.id day_id,
           percentile_cont(0.5) within group (order by s.lat) lat,
           percentile_cont(0.5) within group (order by s.lng) lng
    from days d
    join trips t on t.id = d.trip_id
    join stops s on s.day_id = d.id and s.lat is not null
    where t.archived is not true
      and (t.end_date is null or t.end_date >= current_date)
      and nullif(trim(t.metar_station), '') is null
      and d.metar_station is null
      and not exists (select 1 from skill_probe p where p.day_id = d.id and not p.done)
    group by d.id
    limit 20
  loop
    insert into skill_probe(req_id, day_id, kind)
    values (net.http_get(
      url := format('https://aviationweather.gov/api/data/stationinfo?bbox=%s,%s,%s,%s&format=json',
                    round((r.lat - 1)::numeric, 3), round((r.lng - 1.3)::numeric, 3),
                    round((r.lat + 1)::numeric, 3), round((r.lng + 1.3)::numeric, 3)),
      timeout_milliseconds := 20000), r.day_id, 'station_lookup');
    v_n := v_n + 1;
  end loop;
  stage := 'station_lookups_queued'; n := v_n; return next;

  -- F. Queue station info for stations without coordinates
  v_n := 0;
  for r in
    select a.icao from active_metar_stations() a(icao)
    where not exists (select 1 from metar_stations m where m.icao = a.icao)
      and not exists (select 1 from skill_probe p where p.station = a.icao and p.kind = 'station_info' and not p.done)
  loop
    insert into skill_probe(req_id, station, kind)
    values (net.http_get(url := format('https://aviationweather.gov/api/data/stationinfo?ids=%s&format=json', r.icao),
                         timeout_milliseconds := 20000), r.icao, 'station_info');
    v_n := v_n + 1;
  end loop;
  stage := 'station_info_queued'; n := v_n; return next;

  -- G. Queue 14 days of observations when older than 20 h
  v_n := 0;
  for r in
    select a.icao from active_metar_stations() a(icao)
    where coalesce((select max(fetched_at) from station_obs_hourly o where o.station = a.icao), 'epoch') < now() - interval '20 hours'
      and not exists (select 1 from skill_probe p where p.station = a.icao and p.kind = 'obs' and not p.done)
  loop
    insert into skill_probe(req_id, station, kind)
    values (net.http_get(url := format('https://aviationweather.gov/api/data/metar?ids=%s&format=json&hours=336', r.icao),
                         timeout_milliseconds := 30000), r.icao, 'obs');
    v_n := v_n + 1;
  end loop;
  stage := 'obs_queued'; n := v_n; return next;

  -- H. Queue forecast leads 1-7 once fresh obs exist, a few per pass
  select string_agg(model, ',' order by sort_order) into v_models from weather_models where active;
  v_n := 0;
  for r in
    select a.icao, m.lat, m.lng, l.lead
    from active_metar_stations() a(icao)
    join metar_stations m on m.icao = a.icao
    cross join generate_series(1, 7) l(lead)
    where exists (select 1 from station_obs_hourly o where o.station = a.icao and o.fetched_at > now() - interval '20 hours')
      and coalesce((select max(computed_at) from model_skill s where s.station = a.icao and s.lead_day = l.lead), 'epoch')
          < now() - interval '20 hours'
      and not exists (select 1 from skill_probe p where p.station = a.icao and p.kind = 'lead:' || l.lead and not p.done)
    order by l.lead, a.icao
  loop
    exit when v_queued_fc >= p_max_forecast_requests;
    v_vars := format('temperature_2m_previous_day%1$s,cloud_cover_previous_day%1$s,precipitation_previous_day%1$s', r.lead);
    insert into skill_probe(req_id, station, kind)
    values (net.http_get(
      url := format('https://previous-runs-api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&hourly=%s&models=%s&past_days=14&forecast_days=1&timezone=UTC',
                    r.lat, r.lng, v_vars, v_models),
      timeout_milliseconds := 30000), r.icao, 'lead:' || r.lead);
    v_queued_fc := v_queued_fc + 1;
    v_n := v_n + 1;
  end loop;
  stage := 'leads_queued'; n := v_n; return next;
end
$function$;

comment on function public.refresh_model_skill_step(integer) is
  'Verification job: auto-picks nearest METAR per day, pulls 14 days of obs and previous-run forecasts (leads 1-7), scores every active model into model_skill. Run by cron model-skill-refresh.';
