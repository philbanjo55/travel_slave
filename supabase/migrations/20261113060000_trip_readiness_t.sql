-- trip_readiness: covers planner T (run, week draft, rules, notes, plan check), the peaks-hidden rule, camera reading,
-- 3D terrain and the practice copy; drive-matrix warning counts only legs between stops on the trip; job times updated (13 Nov 2026).
CREATE OR REPLACE FUNCTION public.trip_readiness(p_trip uuid)
 RETURNS TABLE(step text, item text, status text, detail text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  t trips%rowtype;
  v_tz_ok boolean := false;
  n int; m int; k int; j int;
  v_txt text;
  v_km double precision;
  v_obs timestamptz;
  v_at timestamptz;
begin
  select * into t from trips where id = p_trip;
  if not found then raise exception 'no trip %', p_trip; end if;

  -- 1. Trip row ---------------------------------------------------------------
  return query select '1 trip', 'dates',
    case when t.start_date is not null and t.end_date >= t.start_date then 'ok' else 'todo' end,
    coalesce(t.start_date::text, '?') || ' to ' || coalesce(t.end_date::text, '?');
  return query select '1 trip', 'live',
    case when t.archived is true then 'warn' else 'ok' end,
    case when t.archived is true then 'archived: the nightly weather, solver and camera jobs skip it' else 'not archived' end;
  if t.timezone is not null then
    begin perform now() at time zone t.timezone; v_tz_ok := true; exception when others then v_tz_ok := false; end;
  end if;
  return query select '1 trip', 'timezone',
    case when v_tz_ok then 'ok' else 'todo' end,
    case when t.timezone is null then 'not set: solver and sun plans fall back to the forecasts'' zone, else UTC'
         when not v_tz_ok then t.timezone || ' is not a valid IANA zone' else t.timezone end;

  -- 2. Itinerary ----------------------------------------------------------------
  select count(*), count(*) filter (where d.date is null),
         count(*) filter (where d.date < t.start_date or d.date > t.end_date)
    into n, m, k from days d where d.trip_id = p_trip;
  select count(*) into j from generate_series(t.start_date, t.end_date, interval '1 day') g(d)
   where not exists (select 1 from days d where d.trip_id = p_trip and d.date = g.d::date);
  return query select '2 itinerary', 'days',
    case when n = 0 or m > 0 then 'todo' when k > 0 or j > 0 then 'warn' else 'ok' end,
    n || ' days' || case when m > 0 then ', ' || m || ' without a date' else '' end
      || case when k > 0 then ', ' || k || ' outside the trip dates' else '' end
      || case when j > 0 then ', ' || j || ' trip dates with no day' else '' end;

  select count(*), count(*) filter (where s.lat is null or s.lng is null), count(*) filter (where s.day_id is null),
         count(*) filter (where s.shot_type = 'logistics')
    into n, m, k, j from stops s where s.trip_id = p_trip;
  return query select '2 itinerary', 'stops',
    case when n = 0 or m > 0 then 'todo' else 'ok' end,
    n || ' stops (' || (n - j) || ' to shoot, ' || j || ' logistics)'
      || case when m > 0 then ', ' || m || ' without coordinates' else '' end
      || case when k > 0 then ', ' || k || ' set aside (no day)' else '' end;

  select count(*) into n from stops s
   where s.trip_id = p_trip and s.shot_type is null;
  return query select '2 itinerary', 'shot types',
    case when n > 0 then 'warn' else 'ok' end,
    case when n > 0 then n || ' stops with no shot_type: no weather score; use logistics for airports, hotels, food'
         else 'every stop has a shot_type' end;

  select count(*), string_agg(s.name || ' "' || s.time_label || '"', '; ' order by s.name)
    into n, v_txt from stops s
   where s.trip_id = p_trip and nullif(btrim(s.time_label), '') is not null
     and s.time_label !~* '^\s*~?\s*\d{1,2}:\d{2}\s*(AM|PM)';
  return query select '2 itinerary', 'time labels',
    case when n > 0 then 'warn' else 'ok' end,
    case when n > 0 then n || ' not "h:mm AM/PM" (the solver ignores them as bookings): ' || left(v_txt, 300)
         else 'all "h:mm AM/PM"' end;

  select count(*), string_agg(to_char(g.night, 'DD Mon'), ', ' order by g.night)
    into n, v_txt from generate_series(t.start_date, t.end_date - 1, interval '1 day') g(night)
   where not exists (select 1 from accommodations a where a.trip_id = p_trip and a.lat is not null
                       and a.check_in <= g.night::date and a.check_out > g.night::date);
  select count(*) into m from accommodations a where a.trip_id = p_trip;
  return query select '2 itinerary', 'hotels',
    case when m = 0 then 'todo' when n > 0 then 'warn' else 'ok' end,
    m || ' accommodations' || case when n > 0 then ', no hotel with coordinates on the night of ' || v_txt
      || ' (fine for an overnight flight; otherwise the solver can''t plan that day)' else ', every night covered' end;

  -- 3. Automatic within minutes / hours --------------------------------------
  select count(*) filter (where s.elevation_m is null),
         count(*) filter (where not exists (select 1 from model_grid_points g where g.stop_id = s.id))
    into n, m from stops s where s.trip_id = p_trip and s.lat is not null and s.day_id is not null;
  return query select '3 automatic', 'elevation and model grid',
    case when n + m = 0 then 'ok' else 'wait' end,
    case when n + m = 0 then 'all stops probed'
         else n || ' stops without elevation, ' || m || ' without model grid points (5-minute jobs; grid points only while start_date >= today)' end;

  select count(*), count(*) filter (where exists (select 1 from weather_forecasts w where w.stop_id = s.id and w.fetched_at > now() - interval '30 hours'))
    into n, m from stops s where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from 'logistics' and s.day_id is not null;
  return query select '3 automatic', 'display weather',
    case when n = 0 then 'info' when m = n then 'ok' else 'wait' end,
    m || ' of ' || n || ' shooting stops have a forecast from the last 30 h (hourly within 15 days, else a daily 05:10 UTC preview)';

  select count(*), count(*) filter (where exists (select 1 from weather_ensemble e where e.cell_key = c.cell_key and e.valid_at > now() + interval '1 day'))
    into n, m from (select distinct cell_key from stop_cell_map where trip_id = p_trip) c;
  return query select '3 automatic', 'ensemble cells',
    case when n = 0 then 'todo' when m = n then 'ok' else 'wait' end,
    m || ' of ' || n || ' 0.25 deg cells in the latest ensemble (10:17 and 19:17 UTC)';

  -- 4. Ground truth -------------------------------------------------------------
  if t.metar_station is null then
    select string_agg(distinct d.metar_station, ', ') into v_txt from days d where d.trip_id = p_trip;
    return query select '4 truth', 'METAR station', 'todo',
      'trips.metar_station not set (days picked: ' || coalesce(v_txt, 'none') || '); set the airport within 30 km of the stops';
  else
    select min(gc_km(ms.lat, ms.lng, s.lat, s.lng)) into v_km
      from metar_stations ms join stops s on s.trip_id = p_trip and s.lat is not null
     where ms.icao = t.metar_station;
    select max(o.hr) into v_obs from station_obs_hourly o where o.station = t.metar_station;
    return query select '4 truth', 'METAR station',
      case when v_km is null then 'wait' when v_km > 30 then 'warn' when v_obs is null or v_obs < now() - interval '2 days' then 'wait' else 'ok' end,
      t.metar_station || case when v_km is null then ' not in metar_stations yet (10-minute job)'
                              else ', ' || round(v_km::numeric, 1) || ' km from the nearest stop' end
        || case when v_obs is null then ', no observations yet' else ', last observation ' || to_char(v_obs at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' end
        || case when v_km > 30 then ' (over 30 km: the scoreboard will not use it)' else '' end;
    select count(*) into n from solver_calibration c where c.site = t.metar_station;
    return query select '4 truth', 'calibration history',
      case when n > 0 then 'ok' else 'info' end,
      case when n > 0 then n || ' calibration bins for ' || t.metar_station
           else 'optional: calib_queue_month / calib_load_history / solver_fit_calibration_months for the trip months' end;
  end if;

  select count(*), count(*) filter (where exists (select 1 from webcam_frames f where f.camera_code = c.code
                                                     and coalesce(f.fetched_at, f.captured_at) > now() - interval '24 hours' and f.stale is false))
    into n, m from webcam_cameras c
   where c.active and exists (select 1 from stops s where s.trip_id = p_trip and s.lat is not null and gc_km(c.lat, c.lng, s.lat, s.lng) <= 50);
  return query select '4 truth', 'webcams within 50 km',
    case when n = 0 then 'info' when m = n then 'ok' else 'warn' end,
    case when n = 0 then 'none: optional, only with the owner''s permission'
         else n || ' cameras, ' || m || ' with a fresh frame in the last 24 h' end;

  -- 5. Sun shots and terrain ------------------------------------------------------
  select count(*), count(*) filter (where not exists (select 1 from stop_sun_pairs p where p.stop_id = s.id))
    into n, m from stops s where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from 'logistics' and s.day_id is not null;
  return query select '5 sun', 'shots',
    case when m > 0 then 'todo' else 'ok' end,
    (n - m) || ' of ' || n || ' shooting stops have a shot (vantage + subject)';

  select count(*) filter (where tp.status = 'complete'), count(*) filter (where tp.status = 'outside_dem'),
         count(*) filter (where tp.status is distinct from 'complete' and tp.status is distinct from 'outside_dem')
    into n, m, k
    from (select v.terrain_profile_id pid from stop_sun_pairs p join stops s on s.id = p.stop_id and s.trip_id = p_trip
            join scout_vantages v on v.id = p.vantage_id
          union
          select sj.terrain_profile_id from stop_sun_pairs p join stops s on s.id = p.stop_id and s.trip_id = p_trip
            join scout_vantages v on v.id = p.vantage_id join scout_subjects sj on sj.id = v.subject_id) x
    left join terrain_profiles tp on tp.id = x.pid;
  return query select '5 sun', 'terrain (shade)',
    case when m > 0 then 'todo' when k > 0 then 'wait' when n = 0 then 'info' else 'ok' end,
    n || ' terrain profiles complete'
      || case when m > 0 then ', ' || m || ' outside any DEM: run dem-region-load for the area, then dem_region_recompute(region)' else '' end
      || case when k > 0 then ', ' || k || ' pending or missing' else '' end;

  -- 6. Solver -------------------------------------------------------------------
  select count(*), count(*) filter (where ss.stop_id is null), count(*) filter (where ss.source = 'suggested')
    into n, m, k
    from stops s left join solver_stop_settings ss on ss.stop_id = s.id and ss.tier is not null
   where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from 'logistics' and s.day_id is not null;
  return query select '6 solver', 'stop settings',
    case when n > 0 and m = n then 'todo' when m > 0 then 'warn' else 'ok' end,
    (n - m) || ' of ' || n || ' shooting stops rated' || case when k > 0 then ', ' || k || ' still Claude''s suggestion (Phil to confirm)' else '' end;

  select count(*) into j from solver_trip_spots(p_trip);
  -- only legs between stops on a day count as missing (legs to set-aside / "Idea:" spots never get planned anyway)
  select count(*), count(*) filter (where dm.minutes is null and a.day_id is not null and b.day_id is not null)
    into n, m from solver_drive_matrix dm join stops a on a.id = dm.from_stop_id join stops b on b.id = dm.to_stop_id
   where dm.trip_id = p_trip;
  return query select '6 solver', 'drive matrix',
    case when n = 0 then 'todo' when m > 0 then 'warn' else 'ok' end,
    case when n = 0 then 'no legs: POST solver-drive-matrix {trip_id} (repeat while it reports more to do)'
         else n || ' stop pairs over ' || j || ' spots' || case when m > 0 then ', ' || m || ' between stops on the trip without a route (ferry? over 300 km?): never planned together' else '' end end;

  select count(distinct (l.vantage_id, l.local_date)), count(distinct x.vantage_id) * (t.end_date - t.start_date + 1)
    into n, m
    from (select distinct si.star_vantage_id vantage_id from solver_stop_inputs si where si.trip_id = p_trip and si.tier is not null) x
    left join solver_light_cache l on l.vantage_id = x.vantage_id and l.local_date between t.start_date and t.end_date;
  return query select '6 solver', 'light cache (trip days)',
    case when m = 0 then 'info' when n >= m then 'ok' else 'wait' end,
    n || ' of ' || m || ' shot-days cached (solver_nightly tops it up at 10:41 and 19:41 UTC)';

  select max(b.built_at) into v_at from solver_score_builds b where b.trip_id = p_trip and b.variant = 'raw';
  return query select '6 solver', 'nightly score build',
    case when v_at > now() - interval '30 hours' then 'ok' else 'wait' end,
    coalesce('last ' || to_char(v_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'none yet: runs at 10:41 and 19:41 UTC once stops are rated');
  select max(r.created_at) into v_at from solver_runs r where r.trip_id = p_trip;
  return query select '6 solver', 'plans',
    case when v_at > now() - interval '30 hours' then 'ok' else 'wait' end,
    coalesce('last ' || to_char(v_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'none yet: T plans each evening; the week draft at 04:23 UTC');

  -- 6b. Planner T, cameras, 3D, practice copy (13 Nov 2026) ----------------------
  declare
    v_cfg jsonb; v_rules boolean; v_review boolean; v_run record; v_ceil int; v_cams int; v_read int; v_shots int; v_wide int; v_box int;
    v_copy record;
  begin
    select ptt.config, ptt.rules_checked, ptt.review into v_cfg, v_rules, v_review from planner_t_trips ptt where ptt.trip_id = p_trip;
    return query select '8 planner T', 'T plans this trip',
      case when v_cfg is null then 'todo' when not coalesce(v_rules, false) then 'warn' else 'ok' end,
      case when v_cfg is null then 'not in planner_t_trips: planner_t_autoadd() adds it at the next 04:23 UTC week draft'
           else 'rules ' || case when v_rules then 'checked by Phil' else 'NOT checked yet (bookings, once-only, keep-together)' end
             || ', notes (Tell T) ' || case when coalesce((v_cfg->>'tell')::boolean, false) then 'on' else 'off' end
             || ', plan check ' || case when coalesce(v_review, false) then 'on' else 'off' end end;
    select r.id, r.status, r.night, r.start_date into v_run from replay_runs r
     where r.trip_id = p_trip and r.config->>'name' = 'trip_T' order by r.id desc limit 1;
    return query select '8 planner T', 'live T run (evening plan + morning re-plans)',
      case when v_run.id is null then 'todo' when v_run.status in ('running', 'queued') then 'ok' else 'warn' end,
      case when v_run.id is null then 'no trip_T run: create one like Teton Live''s app_T (see CLAUDE.md)'
           else 'run ' || v_run.id || ', ' || v_run.status || ', night ' || v_run.night || ', first plan the evening before ' || v_run.start_date end;
    select max(r.created_at) into v_at from solver_runs r where r.trip_id = p_trip and r.stats->>'planner' = 'T';
    return query select '8 planner T', 'week draft',
      case when v_at > now() - interval '30 hours' then 'ok' else 'wait' end,
      coalesce('last T plan ' || to_char(v_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'none yet: 04:23 UTC nightly');

    select ms.hidden_ceiling_ft into v_ceil from metar_stations ms where ms.icao = t.metar_station;
    return query select '8 planner T', 'peaks-hidden rule at the airport',
      case when t.metar_station is null then 'warn' when v_ceil is null then 'info' else 'ok' end,
      case when t.metar_station is null then 'no airport station: only cameras can say the peaks are hidden'
           when v_ceil is null then t.metar_station || ': the default rule, cloud below 2,000 ft counts as peaks hidden'
           else t.metar_station || ': cloud below ' || v_ceil || ' ft counts as peaks hidden' end;

    select count(*) filter (where coalesce(c.label_paused, false)) into v_box
      from webcam_cameras c
     where c.active and coalesce(c.votes, true)
       and exists (select 1 from stops s where s.trip_id = p_trip and s.lat is not null and gc_km(c.lat, c.lng, s.lat, s.lng) <= 50);
    select count(*), count(*) filter (where not coalesce(c.label_paused, false)
                                           and exists (select 1 from webcam_frames f where f.camera_code = c.code and f.label_model like 'claude-%'
                                                         and f.captured_at > now() - interval '24 hours'))
      into v_cams, v_read
      from webcam_cameras c
     where c.active and coalesce(c.votes, true)
       and exists (select 1 from stops s where s.trip_id = p_trip and s.lat is not null and gc_km(c.lat, c.lng, s.lat, s.lng) <= 50);
    return query select '8 planner T', 'cameras read (they decide "peaks out" live)',
      case when v_cams = 0 then 'info' when v_read >= 2 then 'ok' else 'warn' end,
      case when v_cams = 0 then 'no voting cameras within 50 km: the airport alone decides'
           else v_read || ' of ' || v_cams || ' voting cameras within 50 km read by Claude in the last 24 h (2 or more needed for the camera vote)'
             || case when v_box > 0 then '; ' || v_box || ' have reading paused (label_paused): turn them back on before the trip' else '' end end;

    select count(*), count(*) filter (where exists (select 1 from terrain_regions r where v.lat between r.south and r.north and v.lng between r.west and r.east)),
           count(*) filter (where exists (select 1 from terrain_detail_regions d where v.lat between d.south and d.north and v.lng between d.west and d.east)
                               or exists (select 1 from terrain_near_regions d where v.lat between d.south and d.north and v.lng between d.west and d.east))
      into v_shots, v_wide, v_box
      from (select distinct v.id, v.lat, v.lng from stop_sun_pairs p join stops s on s.id = p.stop_id join days d on d.id = s.day_id
              join scout_vantages v on v.id = p.vantage_id where d.trip_id = p_trip) v;
    return query select '9 3D view', 'terrain for every shot',
      case when v_shots = 0 then 'info' when v_wide < v_shots then 'todo' when v_box < v_shots then 'warn' else 'ok' end,
      v_wide || ' of ' || v_shots || ' shots inside a 3D area, ' || v_box || ' with a sharp close-up box'
        || case when v_wide < v_shots then ': build the area (docs/NEW_TRIP_SOP.md, 3D terrain)' else '' end;

    select tr.id, tr.title, tr.training_until into v_copy from trips tr where tr.training_of = p_trip order by tr.training_until desc nulls last limit 1;
    return query select '10 practice', 'practice copy',
      case when v_copy.id is null then 'warn' when v_copy.training_until >= current_date then 'ok' else 'info' end,
      case when v_copy.id is null then 'none: training_autocreate() makes one for trips starting more than 3 days out'
           else v_copy.title || ', repeats until ' || coalesce(v_copy.training_until::text, '?') end;
  end;

  -- 7. Manual extras ------------------------------------------------------------
  return query select '7 extras', 'web viewer', 'info',
    'optional: copy faroes-web/, change TRIP_ID, title, travellers, footer; commit to master; add a Netlify site for the folder';
  return query select '7 extras', 'after the trip', 'info',
    'archive the trip: stops the nightly weather, ensemble and solver jobs (they run until archived)';
end $function$;
