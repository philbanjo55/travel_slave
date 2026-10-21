-- 🧪 Faroes Live (Phil, 21 Oct 2026): the Faroes itinerary moved to now, so
-- the planner runs on real forecasts for two weeks and the backtest scores it
-- against the webcams and EKVG. Trip day N = p_start + N (day 0 = the flight
-- day). Stops, hotels, shots and solver settings are copied once; nothing is
-- shared with the real trip except terrain profiles (by location) and drive
-- legs (by coordinates). Create-only: refuses if the trip already exists.

create or replace function public.make_live_test_trip(p_start date)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  lt  constant uuid := '7e57bed0-0000-4000-8000-000000000002';
  src constant uuid := 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d';
  last_day constant int := 14;
  n_days int; n_stops int; n_pairs int; n_set int;
begin
  if exists (select 1 from public.trips where id = lt) then raise exception 'Faroes Live already exists'; end if;

  insert into public.trips (id, title, subtitle, owner, start_date, end_date, accent_color, travelers, timezone, archived, metar_station)
  select lt, '🧪 Faroes Live', 'Live-weather test of the planner: the Faroes itinerary moved to now. Safe to break.', owner,
         p_start, p_start + last_day, accent_color, travelers, 'Atlantic/Faroe', false, metar_station
    from public.trips where id = src;

  create temp table lt_days on commit drop as
    select d.id as old_id, gen_random_uuid() as new_id from public.days d where d.trip_id = src and d.day_number between 0 and last_day;
  insert into public.days (id, trip_id, day_number, date, title, subtitle, region, map_center_lat, map_center_lng, map_zoom, metar_station)
  select m.new_id, lt, d.day_number, p_start + d.day_number, d.title, d.subtitle, d.region, d.map_center_lat, d.map_center_lng, d.map_zoom, d.metar_station
    from public.days d join lt_days m on m.old_id = d.id;
  get diagnostics n_days = row_count;

  create temp table lt_stops on commit drop as
    select s.id as old_id, gen_random_uuid() as new_id from public.stops s join lt_days m on m.old_id = s.day_id;
  insert into public.stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes,
                            lat, lng, place_id, alltrails_url, map_url, google_maps_url, signal_status, info, log, hist, photo_note,
                            shot_type, tide_station_id, time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
  select ms.new_id, md.new_id, lt, s.position, s.name, s.emoji, s.time_label, s.duration_minutes, s.drive_override_minutes,
         s.lat, s.lng, s.place_id, s.alltrails_url, s.map_url, s.google_maps_url, s.signal_status, s.info, s.log, s.hist, s.photo_note,
         s.shot_type, s.tide_station_id, s.time_locked, s.movable, s.elevation_m, s.elevation_lat, s.elevation_lng, s.elevation_probed_at
    from public.stops s join lt_stops ms on ms.old_id = s.id join lt_days md on md.old_id = s.day_id;
  get diagnostics n_stops = row_count;

  create temp table lt_subj on commit drop as
    select x.old_id, gen_random_uuid() as new_id from (
      select distinct v.subject_id as old_id
        from public.stop_sun_pairs p join lt_stops ms on ms.old_id = p.stop_id join public.scout_vantages v on v.id = p.vantage_id) x;
  insert into public.scout_subjects (id, trip_id, name, island, lat, lng, coord_confidence, priority, best_light, faces, notes, status,
                                     phil_tier, subject_kind, movable, height_m)
  select m.new_id, lt, s.name, s.island, s.lat, s.lng, s.coord_confidence, s.priority, s.best_light, s.faces, s.notes, s.status,
         s.phil_tier, s.subject_kind, s.movable, s.height_m
    from public.scout_subjects s join lt_subj m on m.old_id = s.id;

  create temp table lt_vant on commit drop as
    select x.old_id, gen_random_uuid() as new_id from (
      select distinct p.vantage_id as old_id from public.stop_sun_pairs p join lt_stops ms on ms.old_id = p.stop_id) x;
  insert into public.scout_vantages (id, subject_id, code, name, shot_name, lat, lng, coord_confidence, elevation_m, distance_to_subject_km,
                                     access, walk_minutes, notes)
  select mv.new_id, msub.new_id, v.code, v.name, v.shot_name, v.lat, v.lng, v.coord_confidence, v.elevation_m, v.distance_to_subject_km,
         v.access, v.walk_minutes, v.notes
    from public.scout_vantages v join lt_vant mv on mv.old_id = v.id join lt_subj msub on msub.old_id = v.subject_id;

  insert into public.stop_sun_pairs (stop_id, vantage_id, position)
  select ms.new_id, mv.new_id, p.position
    from public.stop_sun_pairs p join lt_stops ms on ms.old_id = p.stop_id join lt_vant mv on mv.old_id = p.vantage_id;
  get diagnostics n_pairs = row_count;

  insert into public.solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note, fog_wanted)
  select ms.new_id, x.tier, mv.new_id, x.light_wanted, x.time_locked, x.source, x.note, x.fog_wanted
    from public.solver_stop_settings x join lt_stops ms on ms.old_id = x.stop_id
    left join lt_vant mv on mv.old_id = x.star_vantage_id;
  get diagnostics n_set = row_count;

  return jsonb_build_object('trip_id', lt, 'days', n_days, 'stops', n_stops, 'sun_pairs', n_pairs, 'settings', n_set);
end $function$;
revoke execute on function public.make_live_test_trip(date) from public, anon, authenticated;

select public.make_live_test_trip('2026-10-21');

-- Hotels, moved by the same offset (day 0 = 13 May 2027 -> 21 Oct 2026),
-- clipped to the trip's last day.
with shift as (select '2026-10-21'::date - (select date from days where trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and day_number = 0) as n)
insert into accommodations (day_id, type, name, lat, lng, map_url, booked_via, check_in, check_out, nights, trip_id, lodging_type)
select nd.id, a.type, a.name, a.lat, a.lng, a.map_url, a.booked_via, a.check_in + (select n from shift),
       least(a.check_out + (select n from shift), '2026-11-04'::date),
       least(a.check_out + (select n from shift), '2026-11-04'::date) - (a.check_in + (select n from shift)),
       '7e57bed0-0000-4000-8000-000000000002', a.lodging_type
  from accommodations a
  left join days od on od.id = a.day_id
  left join days nd on nd.trip_id = '7e57bed0-0000-4000-8000-000000000002' and nd.day_number = od.day_number
 where a.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and a.check_in + (select n from shift) <= '2026-11-04'::date;

-- Display weather: days within 15 days were pulled every hour (3-4 Open-Meteo
-- requests per stop, ~8,000 a day for a full trip, over the free quota and
-- starving the ensemble pull). Now today and tomorrow hourly, later days at
-- 05, 11, 17 and 23 UTC. Applies to every live trip (the real trips too once
-- they are within 15 days).
select cron.schedule('hourly-weather-pull', '7 * * * *', $cmd$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    FOR r IN
      SELECT d.id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.date BETWEEN current_date AND current_date + 15
        AND (d.date <= current_date + 1 OR extract(hour from now() at time zone 'UTC') IN (5, 11, 17, 23))
        AND t.archived IS NOT TRUE
        AND (t.end_date IS NULL OR t.end_date >= current_date)
      ORDER BY d.date, d.id
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/weather-pull',
        body := jsonb_build_object('day_id', r.id),
        headers := '{"Content-Type":"application/json"}'::jsonb
      );
      PERFORM pg_sleep(2.5);
    END LOOP;
  END $do$;
$cmd$);
