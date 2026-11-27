-- Test robot trip (Phil, 27 Nov 2026: "make sure it covers everything and edge cases"). The emulator's planner test
-- needs a trip it may really change (Accept, undo, Re-plan, Tell T notes) without touching Teton Live, where Phil runs
-- his mock week. Trip 7e57bed0-...-0004 is a practice copy of Grand Teton Winter 2026 on Teton Live's dates (it rolls
-- with it, training_trip_roll), with its own planner T (same settings as Teton Live, no paid plan check), no weather
-- pulls of its own (e2e_prepare copies Teton Live's), and e2e_prepare() resets it before every test run.

CREATE OR REPLACE FUNCTION public.e2e_make_trip(p_src uuid, p_start date, p_days integer, p_until date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  lt uuid := '7e57bed0-0000-4000-8000-000000000004';
  n_days int; n_stops int; n_set int; v_first date; v_off int;
begin
  if exists (select 1 from trips where id = p_src and training_of is not null) then raise exception 'source is itself a training trip'; end if;
  if exists (select 1 from trips where id = lt) then raise exception 'the test robot trip already exists'; end if;

  select count(*), min(x.date) into n_days, v_first
    from (select d.date from days d where d.trip_id = p_src order by d.day_number limit p_days) x;
  if n_days = 0 then raise exception 'trip % has no days', p_src; end if;
  v_off := p_start - coalesce(v_first, p_start);

  insert into trips (id, title, subtitle, owner, start_date, end_date, accent_color, travelers, timezone, archived, metar_station,
                     training_of, training_until)
  select lt, '🧪 Test robot (emulator only)', 'The emulator test''s own copy of ' || title || ': it really accepts, re-plans and writes notes here. Ignore it.', owner,
         p_start, p_start + n_days - 1, accent_color, travelers, timezone, false, metar_station, p_src, p_until
    from trips where id = p_src;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
  select lt, 'day', x.id, gen_random_uuid()
    from (select d.id from days d where d.trip_id = p_src order by d.day_number limit p_days) x;
  insert into days (id, trip_id, day_number, date, title, subtitle, region, map_center_lat, map_center_lng, map_zoom, metar_station)
  select m.new_id, lt, d.day_number, p_start + (row_number() over (order by d.day_number) - 1)::int,
         d.title, d.subtitle, d.region, d.map_center_lat, d.map_center_lng, d.map_zoom, d.metar_station
    from days d join training_copy_map m on m.trip_id = lt and m.kind = 'day' and m.old_id = d.id;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
  select lt, 'stop', s.id, gen_random_uuid()
    from stops s join training_copy_map m on m.trip_id = lt and m.kind = 'day' and m.old_id = s.day_id;
  insert into stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes,
                     lat, lng, place_id, alltrails_url, map_url, google_maps_url, signal_status, info, log, hist, photo_note,
                     shot_type, tide_station_id, time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
  select ms.new_id, md.new_id, lt, s.position, s.name, s.emoji, s.time_label, s.duration_minutes, s.drive_override_minutes,
         s.lat, s.lng, s.place_id, s.alltrails_url, s.map_url, s.google_maps_url, s.signal_status, s.info, s.log, s.hist, s.photo_note,
         s.shot_type, s.tide_station_id, s.time_locked, s.movable, s.elevation_m, s.elevation_lat, s.elevation_lng, s.elevation_probed_at
    from stops s join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = s.id join training_copy_map md on md.trip_id = lt and md.kind = 'day' and md.old_id = s.day_id;
  get diagnostics n_stops = row_count;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
    select lt, 'subject', x.old_id, gen_random_uuid() from (
      select distinct v.subject_id as old_id
        from stop_sun_pairs p join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = p.stop_id join scout_vantages v on v.id = p.vantage_id) x;
  insert into scout_subjects (id, trip_id, name, island, lat, lng, coord_confidence, priority, best_light, faces, notes, status,
                              phil_tier, subject_kind, movable, height_m)
  select m.new_id, lt, s.name, s.island, s.lat, s.lng, s.coord_confidence, s.priority, s.best_light, s.faces, s.notes, s.status,
         s.phil_tier, s.subject_kind, s.movable, s.height_m
    from scout_subjects s join training_copy_map m on m.trip_id = lt and m.kind = 'subject' and m.old_id = s.id;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
    select lt, 'vantage', x.old_id, gen_random_uuid() from (
      select distinct p.vantage_id as old_id from stop_sun_pairs p join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = p.stop_id) x;
  insert into scout_vantages (id, subject_id, code, name, shot_name, lat, lng, coord_confidence, elevation_m, distance_to_subject_km,
                              access, walk_minutes, notes)
  select mv.new_id, msub.new_id, v.code, v.name, v.shot_name, v.lat, v.lng, v.coord_confidence, v.elevation_m, v.distance_to_subject_km,
         v.access, v.walk_minutes, v.notes
    from scout_vantages v join training_copy_map mv on mv.trip_id = lt and mv.kind = 'vantage' and mv.old_id = v.id join training_copy_map msub on msub.trip_id = lt and msub.kind = 'subject' and msub.old_id = v.subject_id;

  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select ms.new_id, mv.new_id, p.position
    from stop_sun_pairs p join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = p.stop_id join training_copy_map mv on mv.trip_id = lt and mv.kind = 'vantage' and mv.old_id = p.vantage_id;

  insert into solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note, fog_wanted)
  select ms.new_id, x.tier, mv.new_id, x.light_wanted, x.time_locked, x.source, x.note, x.fog_wanted
    from solver_stop_settings x join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = x.stop_id
    left join training_copy_map mv on mv.trip_id = lt and mv.kind = 'vantage' and mv.old_id = x.star_vantage_id;
  get diagnostics n_set = row_count;

  insert into accommodations (day_id, type, name, lat, lng, map_url, booked_via, check_in, check_out, nights, trip_id, lodging_type)
  select md.new_id, a.type, a.name, a.lat, a.lng, a.map_url, a.booked_via, a.check_in + v_off,
         least(a.check_out + v_off, p_start + n_days - 1),
         least(a.check_out + v_off, p_start + n_days - 1) - (a.check_in + v_off),
         lt, a.lodging_type
    from accommodations a left join training_copy_map md on md.trip_id = lt and md.kind = 'day' and md.old_id = a.day_id
   where a.trip_id = p_src and a.check_in + v_off < p_start + n_days - 1;

  return jsonb_build_object('trip_id', lt, 'days', n_days, 'stops', n_stops, 'settings', n_set, 'until', p_until);
end $function$

;

-- Teton Live's T settings, its stop ids swapped for the robot's twins (both are copies of the same main stops).
create or replace function public.e2e_map_ids(p_cfg jsonb) returns jsonb language plpgsql stable set search_path to 'public' as $f$
declare t text := p_cfg::text; r record;
begin
  for r in select tl.new_id as tl_id, e.new_id as e_id
             from training_copy_map tl join training_copy_map e on e.old_id = tl.old_id and e.kind = tl.kind
            where tl.trip_id = '7e57bed0-0000-4000-8000-000000000003' and e.trip_id = '7e57bed0-0000-4000-8000-000000000004'
              and tl.kind in ('stop', 'vantage') loop
    t := replace(t, r.tl_id::text, r.e_id::text);
  end loop;
  return t::jsonb;
end $f$;

-- Before every emulator run: the robot trip back to the main trip's itinerary (training_sync), Teton Live's newest
-- display weather on its twins, no notes, sky reports or ticks left from the last run. Returns what the test needs
-- to know (today in the trip's time zone, stops still ahead today).
create or replace function public.e2e_prepare() returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  e constant uuid := '7e57bed0-0000-4000-8000-000000000004';
  tl constant uuid := '7e57bed0-0000-4000-8000-000000000003';
  v_sync jsonb; v_wx int; v_cols text; v_tz text; v_today date; v_ahead int; v_notes int;
begin
  if not exists (select 1 from trips where id = e) then raise exception 'no test robot trip'; end if;
  -- extra visits a test's Accept added (no twin on the main trip): set aside (never deleted), so each run starts
  -- from the main trip's itinerary
  update stops s set day_id = null
   where s.trip_id = e and s.day_id is not null
     and not exists (select 1 from training_copy_map m where m.trip_id = e and m.kind = 'stop' and m.new_id = s.id);
  update solver_stop_settings ss set tier = null
    from stops s where s.id = ss.stop_id and s.trip_id = e and s.day_id is null and ss.tier is not null
     and not exists (select 1 from training_copy_map m where m.trip_id = e and m.kind = 'stop' and m.new_id = s.id);
  v_sync := to_jsonb(training_sync(e));
  -- weather: Teton Live's newest row per stop and hour, onto the robot's twin stop and day (same day number)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'weather_forecasts'
     and is_generated = 'NEVER' and column_name not in ('id', 'stop_id', 'day_id', 'trip_id');
  execute format($q$
    insert into weather_forecasts (stop_id, day_id, trip_id, %1$s)
    select es.id, es.day_id, %2$L::uuid, %3$s
      from weather_forecasts w
      join stops ts on ts.id = w.stop_id and ts.trip_id = %4$L
      join training_copy_map mt on mt.trip_id = %4$L and mt.kind = 'stop' and mt.new_id = ts.id
      join training_copy_map me on me.trip_id = %2$L and me.kind = 'stop' and me.old_id = mt.old_id
      join stops es on es.id = me.new_id and es.day_id is not null
     where w.fetched_at > now() - interval '7 hours'   -- later days are pulled at 05, 11, 17, 23 UTC
       and not exists (select 1 from weather_forecasts x where x.stop_id = es.id and x.fetched_at = w.fetched_at)
  $q$, v_cols, e, (select string_agg('w.' || c, ', ') from unnest(string_to_array(replace(v_cols, '"', ''), ', ')) c), tl);
  get diagnostics v_wx = row_count;
  update t_notes set status = 'cleared', cleared_at = now() where trip_id = e and status <> 'cleared';
  get diagnostics v_notes = row_count;
  update t_reports set void = true where trip_id = e and not coalesce(void, false);
  update solver_stop_settings ss set shot_status = null, shot_value = null, shot_at = null
    from stops s where s.id = ss.stop_id and s.trip_id = e and ss.shot_status is not null;
  v_tz := solver_trip_tz(e);
  v_today := (now() at time zone v_tz)::date;
  select count(*) into v_ahead from stops s join days d on d.id = s.day_id
    join solver_stop_settings ss on ss.stop_id = s.id and ss.tier is not null
   where d.trip_id = e and d.date = v_today;
  return jsonb_build_object('trip_id', e, 'tz', v_tz, 'today', v_today, 'local_time', to_char(now() at time zone v_tz, 'HH24:MI'),
    'rated_stops_today', v_ahead, 'weather_rows', v_wx, 'notes_cleared', v_notes, 'sync', v_sync);
end $f$;
grant execute on function public.e2e_prepare() to anon, authenticated;
revoke execute on function public.e2e_make_trip(uuid, date, integer, date) from anon, authenticated, public;

do $do$
declare
  e constant uuid := '7e57bed0-0000-4000-8000-000000000004';
  tl constant uuid := '7e57bed0-0000-4000-8000-000000000003';
  v_start date; v_until date; v_n int; v_dates date[];
begin
  perform set_config('lock_timeout', '5s', true);   -- never queue behind the live planner's readers
  select start_date, training_until, end_date - start_date + 1 into v_start, v_until, v_n from trips where id = tl;
  perform e2e_make_trip('5e247891-d800-4d07-b5e0-8ad748ae2754', v_start, v_n, v_until);
  perform training_sync(e);
  -- T: Teton Live's settings on the robot's stops; Tell T on, no paid plan check
  insert into planner_t_trips (trip_id, config, note, rules_checked, review)
  select e, e2e_map_ids(config), 'Test robot: Teton Live''s T settings (emulator test only)', true, false
    from planner_t_trips where trip_id = tl;
  -- the bench place (replay_places) and odds counts (the triggers that rebuild the odds tables are held: they lock them for minutes and
  -- Teton Live's planner reads them; the nightly refresh, cron replay-fits-refresh 03:11 UTC, picks the robot up)
  alter table replay_hidden_counts disable trigger replay_hidden_counts_refresh;
  alter table replay_morning_counts disable trigger replay_morning_counts_refresh;
  perform replay_copy_place(tl, e);
  alter table replay_hidden_counts enable trigger replay_hidden_counts_refresh;
  alter table replay_morning_counts enable trigger replay_morning_counts_refresh;
  -- the live T run, as training_trip_roll starts one
  v_dates := array(select d.date from days d where d.trip_id = e order by d.date);
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
  select e, v_dates[1], v_dates, cardinality(v_dates),
         p.config || '{"name": "app_T", "live": true, "publish": true, "plan_local": "20:45", "stagger_min": 6}'::jsonb
    from planner_t_trips p where p.trip_id = e;
end $do$;

-- No weather pulls of its own (e2e_prepare copies Teton Live's): the Open-Meteo quota is shared.
select cron.alter_job(jobid, command := replace(command, 'AND t.archived IS NOT TRUE',
         'AND t.archived IS NOT TRUE AND t.id <> ''7e57bed0-0000-4000-8000-000000000004'''))
  from cron.job where jobname in ('hourly-weather-pull', 'daily-preview-refresh') and command not like '%000000000004%';
