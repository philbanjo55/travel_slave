-- A sandbox trip for testing, rebuilt on demand, plus a trip-level time zone.
--
-- 1. trips.timezone (optional, IANA name such as 'Atlantic/Faroe'). Used by
--    trip_sun_plan when a stop has no weather forecast to take its zone from,
--    instead of falling back to UTC. A trip with no forecasts (a past trip,
--    the test bed) otherwise got sun times an hour off in summer.
--
-- 2. reset_test_bed(): deletes the test trip (fixed id) and rebuilds it from
--    days 1-3 of the Faroe Islands 2027 trip, dated one year earlier (so it
--    is in the past: the weather jobs skip it and it costs no API quota).
--    Stops, times and drive times are copied. Vantage -> subject pairs linked
--    to those stops are copied as new subjects/vantages owned by the test
--    trip, so editing or deleting them never touches the real trip. Photos
--    are not copied (deleting a photo deletes its file, which the real trip
--    would share). Not callable with the app's key: run it from the SQL
--    editor, `select public.reset_test_bed();`, or ask Claude.
--
-- Undo:
--   delete from public.trips where id = '7e57bed0-0000-4000-8000-000000000001';
--   drop function if exists public.reset_test_bed();
--   re-apply 20260925121000_terrain_skyline_cache.sql (trip_sun_plan without the trip zone)
--   alter table public.trips drop column if exists timezone;

alter table public.trips add column if not exists timezone text;

create or replace function public.trip_sun_plan(p_trip_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path to 'public'
as $$
  with pairs as (
    select p.stop_id, p.position, st.day_id,
           v.id as vantage_id, v.code, v.name as vantage_name,
           v.lat as vlat, v.lng as vlng,
           s.id as subject_id, s.name as subject_name, s.lat as slat, s.lng as slng,
           coalesce(v.elevation_m, pv.ground_m, 0) + 1.6 as v_obs,
           coalesce(s.height_m, ps.ground_m, 0) + 2     as s_obs,
           v.terrain_profile_id as vp_id, s.terrain_profile_id as sp_id
      from public.stop_sun_pairs p
      join public.stops st on st.id = p.stop_id and st.trip_id = p_trip_id
      join public.scout_vantages v on v.id = p.vantage_id
      join public.scout_subjects s on s.id = v.subject_id
      left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
      left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
     where v.lat is not null and v.lng is not null and s.lat is not null and s.lng is not null
  ),
  stop_meta as (
    -- The stop's time zone comes from its newest forecast (Open-Meteo
    -- timezone=auto), then the trip's own time zone, then UTC; the offset is
    -- taken at local noon on the stop's day, so summer time is right.
    select x.stop_id, x.date, x.tz,
           round((extract(epoch from ((x.date + time '12:00') at time zone 'UTC'))
                - extract(epoch from ((x.date + time '12:00') at time zone x.tz))) / 60)::int as utc_offset_min
      from (
        select distinct on (pr.stop_id) pr.stop_id, d.date,
               coalesce((select n.name from pg_timezone_names n where n.name = coalesce(wf.tz, t.timezone)), 'UTC') as tz
          from pairs pr
          join public.days d on d.id = pr.day_id
          join public.trips t on t.id = d.trip_id
          left join lateral (
            select f.raw->'provenance'->>'timezone' as tz
              from public.weather_forecasts f
             where f.stop_id = pr.stop_id and f.raw->'provenance'->>'timezone' is not null
             order by f.fetched_at desc
             limit 1) wf on true
      ) x
     where x.date is not null
  ),
  pair_json as (
    select pr.stop_id, pr.position, pr.code,
           jsonb_build_object(
             'vantage_id', pr.vantage_id, 'code', pr.code, 'vantage_name', pr.vantage_name,
             'subject_id', pr.subject_id, 'subject_name', pr.subject_name,
             'v', jsonb_build_object('lat', pr.vlat, 'lng', pr.vlng),
             's', jsonb_build_object('lat', pr.slat, 'lng', pr.slng),
             'bearing', case when public.geo_distance_m(pr.vlat, pr.vlng, pr.slat, pr.slng) >= 20
                             then round(public.geo_bearing(pr.vlat, pr.vlng, pr.slat, pr.slng)::numeric, 2) end,
             'dist_m', round(public.geo_distance_m(pr.vlat, pr.vlng, pr.slat, pr.slng)::numeric),
             'v_sky', (select jsonb_agg(round(h::numeric, 2) order by i)
                         from unnest(public.skyline_cached(pr.vp_id, pr.v_obs)) with ordinality u(h, i)),
             's_sky', (select jsonb_agg(round(h::numeric, 2) order by i)
                         from unnest(public.skyline_cached(pr.sp_id, pr.s_obs)) with ordinality u(h, i))
           ) as j
      from pairs pr
  )
  select jsonb_build_object(
           'trip_id', p_trip_id,
           'generated_at', now(),
           'stops', coalesce((
             select jsonb_object_agg(m.stop_id, jsonb_build_object(
                      'date', m.date, 'tz', m.tz, 'utc_offset_min', m.utc_offset_min,
                      'pairs', (select jsonb_agg(pj.j order by pj.position, pj.code, pj.j->>'subject_name')
                                  from pair_json pj where pj.stop_id = m.stop_id)))
               from stop_meta m), '{}'::jsonb));
$$;

revoke all on function public.trip_sun_plan(uuid) from public;
grant execute on function public.trip_sun_plan(uuid) to anon, authenticated;

create or replace function public.reset_test_bed()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  tb  constant uuid := '7e57bed0-0000-4000-8000-000000000001';
  src constant uuid := 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d';   -- Faroe Islands 2027
  n_days int; n_stops int; n_pairs int;
begin
  if not exists (select 1 from public.trips where id = src) then raise exception 'Source trip not found'; end if;

  delete from public.trips where id = tb;   -- cascades to everything the test trip owns
  drop table if exists tb_days, tb_stops, tb_subj, tb_vant;

  insert into public.trips (id, title, subtitle, owner, start_date, end_date, accent_color, travelers, timezone, archived)
  select tb, '🧪 Test Bed — Faroes', 'Sandbox: safe to break. Rebuilt with reset_test_bed().', owner,
         (select min(date) - interval '1 year' from public.days where trip_id = src and day_number between 1 and 3)::date,
         (select max(date) - interval '1 year' from public.days where trip_id = src and day_number between 1 and 3)::date,
         accent_color, travelers, 'Atlantic/Faroe', false
    from public.trips where id = src;

  create temp table tb_days on commit drop as
    select d.id as old_id, gen_random_uuid() as new_id from public.days d where d.trip_id = src and d.day_number between 1 and 3;
  insert into public.days (id, trip_id, day_number, date, title, subtitle, region, map_center_lat, map_center_lng, map_zoom)
  select m.new_id, tb, d.day_number, (d.date - interval '1 year')::date, d.title, d.subtitle, d.region, d.map_center_lat, d.map_center_lng, d.map_zoom
    from public.days d join tb_days m on m.old_id = d.id;
  get diagnostics n_days = row_count;

  create temp table tb_stops on commit drop as
    select s.id as old_id, gen_random_uuid() as new_id from public.stops s join tb_days m on m.old_id = s.day_id;
  insert into public.stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes,
                            lat, lng, alltrails_url, map_url, google_maps_url, signal_status, info, log, hist, photo_note,
                            shot_type, time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
  select ms.new_id, md.new_id, tb, s.position, s.name, s.emoji, s.time_label, s.duration_minutes, s.drive_override_minutes,
         s.lat, s.lng, s.alltrails_url, s.map_url, s.google_maps_url, s.signal_status, s.info, s.log, s.hist, s.photo_note,
         s.shot_type, s.time_locked, s.movable, s.elevation_m, s.elevation_lat, s.elevation_lng, s.elevation_probed_at
    from public.stops s join tb_stops ms on ms.old_id = s.id join tb_days md on md.old_id = s.day_id;
  get diagnostics n_stops = row_count;

  -- Copies of the subjects and vantages used by those stops' pairs.
  -- Distinct ids first, then one new id each (shared pins are copied once).
  create temp table tb_subj on commit drop as
    select x.old_id, gen_random_uuid() as new_id from (
      select distinct v.subject_id as old_id
        from public.stop_sun_pairs p join tb_stops ms on ms.old_id = p.stop_id join public.scout_vantages v on v.id = p.vantage_id) x;
  insert into public.scout_subjects (id, trip_id, name, island, lat, lng, coord_confidence, faces, notes, height_m, subject_kind)
  select m.new_id, tb, s.name, s.island, s.lat, s.lng, s.coord_confidence, s.faces, s.notes, s.height_m, s.subject_kind
    from public.scout_subjects s join tb_subj m on m.old_id = s.id;

  create temp table tb_vant on commit drop as
    select x.old_id, gen_random_uuid() as new_id from (
      select distinct p.vantage_id as old_id
        from public.stop_sun_pairs p join tb_stops ms on ms.old_id = p.stop_id) x;
  insert into public.scout_vantages (id, subject_id, code, name, lat, lng, coord_confidence, elevation_m, notes)
  select mv.new_id, msub.new_id, v.code, v.name, v.lat, v.lng, v.coord_confidence, v.elevation_m, v.notes
    from public.scout_vantages v join tb_vant mv on mv.old_id = v.id join tb_subj msub on msub.old_id = v.subject_id;

  insert into public.stop_sun_pairs (stop_id, vantage_id, position)
  select ms.new_id, mv.new_id, p.position
    from public.stop_sun_pairs p join tb_stops ms on ms.old_id = p.stop_id join tb_vant mv on mv.old_id = p.vantage_id;
  get diagnostics n_pairs = row_count;

  return jsonb_build_object('trip_id', tb, 'days', n_days, 'stops', n_stops, 'sun_pairs', n_pairs);
end $$;

revoke all on function public.reset_test_bed() from public, anon, authenticated;
