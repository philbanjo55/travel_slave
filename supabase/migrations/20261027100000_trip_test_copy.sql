-- Plan execution test (Phil's #7, 27 Oct 2026): a scratch copy of a trip on the
-- SAME dates, to apply a planner week to and undo it, without touching the real
-- trip. Like make_training_trip, but: same dates as the source, never "running"
-- (training_until = yesterday, so no nightly build / plan / sync / roll picks it
-- up), archived (hidden in both apps), and the together / once settings copied too.
-- Ids are recorded in training_copy_map (trip_id = the copy) for mapping plans.
create or replace function public.make_trip_test_copy(p_src uuid, p_label text default 'execution test')
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  lt uuid := gen_random_uuid();
  n_days int; n_stops int; n_set int;
begin
  if exists (select 1 from trips where id = p_src and training_of is not null) then raise exception 'source is itself a copy'; end if;
  select count(*) into n_days from days where trip_id = p_src;
  if n_days = 0 then raise exception 'trip % has no days', p_src; end if;

  insert into trips (id, title, subtitle, owner, start_date, end_date, accent_color, travelers, timezone, archived, metar_station,
                     training_of, training_until)
  select lt, '🧪 ' || title || ' · ' || p_label, 'Scratch copy of ' || title || ' for planner tests. Safe to break.', owner,
         start_date, end_date, accent_color, travelers, timezone, true, metar_station, p_src, current_date - 1
    from trips where id = p_src;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
  select lt, 'day', d.id, gen_random_uuid() from days d where d.trip_id = p_src;
  insert into days (id, trip_id, day_number, date, title, subtitle, region, map_center_lat, map_center_lng, map_zoom, metar_station)
  select m.new_id, lt, d.day_number, d.date, d.title, d.subtitle, d.region, d.map_center_lat, d.map_center_lng, d.map_zoom, d.metar_station
    from days d join training_copy_map m on m.trip_id = lt and m.kind = 'day' and m.old_id = d.id;

  -- Every stop, set-aside ones too (day_id null).
  insert into training_copy_map (trip_id, kind, old_id, new_id)
  select lt, 'stop', s.id, gen_random_uuid() from stops s where s.trip_id = p_src;
  insert into stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes,
                     lat, lng, place_id, alltrails_url, map_url, google_maps_url, signal_status, info, log, hist, photo_note,
                     shot_type, tide_station_id, time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
  select ms.new_id, md.new_id, lt, s.position, s.name, s.emoji, s.time_label, s.duration_minutes, s.drive_override_minutes,
         s.lat, s.lng, s.place_id, s.alltrails_url, s.map_url, s.google_maps_url, s.signal_status, s.info, s.log, s.hist, s.photo_note,
         s.shot_type, s.tide_station_id, s.time_locked, s.movable, s.elevation_m, s.elevation_lat, s.elevation_lng, s.elevation_probed_at
    from stops s join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = s.id
    left join training_copy_map md on md.trip_id = lt and md.kind = 'day' and md.old_id = s.day_id
   where s.trip_id = p_src;
  get diagnostics n_stops = row_count;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
    select lt, 'subject', x.old_id, gen_random_uuid() from (
      select distinct v.subject_id as old_id
        from stop_sun_pairs p join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = p.stop_id
        join scout_vantages v on v.id = p.vantage_id) x;
  insert into scout_subjects (id, trip_id, name, island, lat, lng, coord_confidence, priority, best_light, faces, notes, status,
                              phil_tier, subject_kind, movable, height_m)
  select m.new_id, lt, s.name, s.island, s.lat, s.lng, s.coord_confidence, s.priority, s.best_light, s.faces, s.notes, s.status,
         s.phil_tier, s.subject_kind, s.movable, s.height_m
    from scout_subjects s join training_copy_map m on m.trip_id = lt and m.kind = 'subject' and m.old_id = s.id;

  insert into training_copy_map (trip_id, kind, old_id, new_id)
    select lt, 'vantage', x.old_id, gen_random_uuid() from (
      select distinct p.vantage_id as old_id from stop_sun_pairs p
        join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = p.stop_id) x;
  insert into scout_vantages (id, subject_id, code, name, shot_name, lat, lng, coord_confidence, elevation_m, distance_to_subject_km,
                              access, walk_minutes, notes)
  select mv.new_id, msub.new_id, v.code, v.name, v.shot_name, v.lat, v.lng, v.coord_confidence, v.elevation_m, v.distance_to_subject_km,
         v.access, v.walk_minutes, v.notes
    from scout_vantages v join training_copy_map mv on mv.trip_id = lt and mv.kind = 'vantage' and mv.old_id = v.id
    join training_copy_map msub on msub.trip_id = lt and msub.kind = 'subject' and msub.old_id = v.subject_id;

  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select ms.new_id, mv.new_id, p.position
    from stop_sun_pairs p join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = p.stop_id
    join training_copy_map mv on mv.trip_id = lt and mv.kind = 'vantage' and mv.old_id = p.vantage_id;

  insert into solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note, fog_wanted, together, once)
  select ms.new_id, x.tier, mv.new_id, x.light_wanted, x.time_locked, x.source, x.note, x.fog_wanted, x.together, x.once
    from solver_stop_settings x join training_copy_map ms on ms.trip_id = lt and ms.kind = 'stop' and ms.old_id = x.stop_id
    left join training_copy_map mv on mv.trip_id = lt and mv.kind = 'vantage' and mv.old_id = x.star_vantage_id;
  get diagnostics n_set = row_count;

  insert into accommodations (day_id, type, name, lat, lng, map_url, booked_via, check_in, check_out, nights, trip_id, lodging_type)
  select md.new_id, a.type, a.name, a.lat, a.lng, a.map_url, a.booked_via, a.check_in, a.check_out, a.nights, lt, a.lodging_type
    from accommodations a left join training_copy_map md on md.trip_id = lt and md.kind = 'day' and md.old_id = a.day_id
   where a.trip_id = p_src;

  return jsonb_build_object('trip_id', lt, 'days', n_days, 'stops', n_stops, 'settings', n_set);
end $function$;

revoke execute on function public.make_trip_test_copy(uuid, text) from public, anon, authenticated;
