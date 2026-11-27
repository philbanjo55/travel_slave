-- Training trips (Phil, 23 Oct 2026: "a separate screen for the live
-- training trips and one for the main trips ... whenever a trip is planned,
-- we just always create a training trip").
--
-- A training trip is a copy of a main trip's itinerary moved to start
-- tomorrow, so the planner runs on real forecasts and the backtest scores
-- it; raw (fixed) and calib (learning) plans run side by side. It keeps
-- training_of (its main trip) and training_until (last date it runs). An
-- itinerary shorter than the window repeats: training_trip_roll() moves the
-- same days on once the last one starts. After training_until the nightly
-- jobs leave it alone; the daily review gives the verdict and Phil decides
-- when to archive it.

alter table public.trips add column if not exists training_of uuid references public.trips(id);
alter table public.trips add column if not exists training_until date;

update public.trips set training_of = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d', training_until = '2026-11-04'
 where id = '7e57bed0-0000-4000-8000-000000000002';
update public.trips set training_of = '5e247891-d800-4d07-b5e0-8ad748ae2754', training_until = '2026-11-06'
 where id = '7e57bed0-0000-4000-8000-000000000003';

-- Old -> new ids of every copy (what each training row came from).
create table if not exists public.training_copy_map (
  trip_id uuid not null, kind text not null, old_id uuid not null, new_id uuid not null,
  primary key (trip_id, kind, old_id));

-- Training trips the nightly jobs work on.
create or replace function public.training_trips_active()
 returns setof uuid language sql stable set search_path to 'public'
as $$
  select id from trips
   where training_of is not null and archived is not true and current_date <= training_until
$$;

-- Copy p_src's itinerary to start on p_start: the first p_days of its days
-- (in day order) become consecutive dates; hotels move by the same offset.
-- Stops, shots and solver settings are copied once (terrain profiles and
-- drive legs are shared by location). Returns the new trip.
create or replace function public.make_training_trip(p_src uuid, p_start date default current_date + 1, p_days integer default 14)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  lt uuid := gen_random_uuid();
  n_days int; n_stops int; n_set int; v_first date; v_off int;
begin
  if exists (select 1 from trips where id = p_src and training_of is not null) then raise exception 'source is itself a training trip'; end if;
  if exists (select 1 from trips where training_of = p_src and archived is not true and current_date <= training_until) then
    raise exception 'trip % already has a running training trip', p_src;
  end if;

  select count(*), min(x.date) into n_days, v_first
    from (select d.date from days d where d.trip_id = p_src order by d.day_number limit p_days) x;
  if n_days = 0 then raise exception 'trip % has no days', p_src; end if;
  v_off := p_start - coalesce(v_first, p_start);

  insert into trips (id, title, subtitle, owner, start_date, end_date, accent_color, travelers, timezone, archived, metar_station,
                     training_of, training_until)
  select lt, '🧪 ' || title || ' · training', 'Live-weather training copy of ' || title || '. Safe to break.', owner,
         p_start, p_start + n_days - 1, accent_color, travelers, timezone, false, metar_station, p_src, p_start + p_days - 1
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

  return jsonb_build_object('trip_id', lt, 'days', n_days, 'stops', n_stops, 'settings', n_set, 'until', p_start + p_days - 1);
end $function$;
revoke execute on function public.make_training_trip(uuid, date, integer) from public, anon, authenticated;

-- Dates only, for training trips.
create or replace function public.live_trip_shift(p_trip uuid, p_days integer)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  if not exists (select 1 from public.trips where id = p_trip and training_of is not null) then
    raise exception 'live_trip_shift is for training trips only';
  end if;
  update public.days set date = date + p_days where trip_id = p_trip;
  get diagnostics n = row_count;
  update public.accommodations set check_in = check_in + p_days, check_out = check_out + p_days where trip_id = p_trip;
  update public.trips set start_date = start_date + p_days, end_date = end_date + p_days, updated_at = now() where id = p_trip;
  return jsonb_build_object('trip', p_trip, 'days', n, 'start', (select start_date from public.trips where id = p_trip));
end $function$;
revoke execute on function public.live_trip_shift(uuid, integer) from public, anon, authenticated;

-- Repeat a short itinerary: once its last day has started (trip time zone)
-- and the window runs past it, move the days on by the itinerary length.
-- pg_cron 12:00 UTC (morning in the Americas, after the 10:55 plans).
create or replace function public.training_trip_roll()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_out jsonb := '[]'::jsonb; n int;
begin
  for r in select t.id, t.end_date, t.training_until, solver_trip_tz(t.id) as tz from trips t
            where t.id in (select training_trips_active()) loop
    if (now() at time zone r.tz)::date >= r.end_date and r.end_date < r.training_until then
      select count(*) into n from days where trip_id = r.id;
      v_out := v_out || live_trip_shift(r.id, n);
    end if;
  end loop;
  return v_out;
end $function$;

-- "Always create a training trip": once a main trip has rated stops and
-- starts more than 3 days out, it gets one (once; at most 3 run at a time,
-- for the database size and the weather quota). Starts tomorrow, 14 days.
create or replace function public.training_autocreate()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_out jsonb := '[]'::jsonb;
begin
  for r in select t.id from trips t
            where t.training_of is null and t.archived is not true and t.title not like '🧪%'
              and t.start_date > current_date + 3
              and not exists (select 1 from trips x where x.training_of = t.id)
              and exists (select 1 from stops s join solver_stop_settings ss on ss.stop_id = s.id
                           where s.trip_id = t.id and ss.tier is not null)
            order by t.start_date loop
    exit when (select count(*) from training_trips_active()) >= 3;
    v_out := v_out || make_training_trip(r.id);
  end loop;
  return v_out;
end $function$;

-- Which history fit is the prior in which months.
create table if not exists public.solver_calib_sources (source text primary key, months integer[] not null);
insert into public.solver_calib_sources values ('history_may', '{5}'), ('history_octnov', '{10,11}'), ('history_winter', '{12,1}')
  on conflict (source) do update set months = excluded.months;

-- Learn at every training trip's station, from the history fit for this month.
create or replace function public.solver_fit_live_all()
 returns jsonb language plpgsql set search_path to 'public'
as $function$
declare r record; v_out jsonb := '[]'::jsonb; v_prior text;
begin
  for r in select distinct t.metar_station as site from trips t
            where t.id in (select training_trips_active()) and t.metar_station is not null loop
    select cs.source into v_prior from solver_calib_sources cs
     where extract(month from current_date)::int = any(cs.months)
       and exists (select 1 from solver_calibration c where c.source = cs.source and c.site = r.site)
     limit 1;
    if v_prior is null then
      v_out := v_out || jsonb_build_object('site', r.site, 'skipped', 'no history for this month');
    else
      v_out := v_out || solver_fit_calibration_live(r.site, v_prior);
    end if;
  end loop;
  return v_out;
end $function$;

-- Corrected build for every running training trip; one failing (e.g. no
-- history for its station yet) does not stop the others.
create or replace function public.solver_build_calib_all()
 returns jsonb language plpgsql set search_path to 'public'
as $function$
declare t uuid; v_out jsonb := '[]'::jsonb;
begin
  for t in select training_trips_active() loop
    begin
      v_out := v_out || jsonb_build_object('trip', t, 'r', solver_build_calib(t, 'adaptive') - 'dates');
    exception when others then
      v_out := v_out || jsonb_build_object('trip', t, 'error', sqlerrm);
      insert into app_logs (level, message, data) values ('error', 'solver_build_calib_all: ' || sqlerrm, jsonb_build_object('trip', t));
    end;
  end loop;
  return v_out;
end $function$;

select cron.schedule('training-autocreate', '13 9 * * *', $cmd$ select public.training_autocreate(); $cmd$);
select cron.schedule('training-roll', '0 12 * * *', $cmd$ select public.training_trip_roll(); $cmd$);
select cron.unschedule('teton-live-week2');
select cron.schedule('solver-fit-live', '45 10,19 * * *', $cmd$ select public.solver_fit_live_all(); $cmd$);
select cron.schedule('solver-build-calib', '49 10,19 * * *', $cmd$ select public.solver_build_calib_all(); $cmd$);

-- Nightly raw builds: every main trip with rated stops, and training trips
-- only while they run.
select cron.schedule('solver-build-scores', '41 10,19 * * *', $cmd$
  select public.solver_nightly(t.id)
    from public.trips t
   where t.archived is not true
     and (t.training_of is null or t.id in (select public.training_trips_active()))
     and exists (select 1 from public.solver_stop_settings ss join public.stops s on s.id = ss.stop_id
                  where s.trip_id = t.id and ss.tier is not null);
$cmd$);

select cron.schedule('solver-plan', '55 10,19 * * *', $cmd$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    -- One call a second: ~45 at once (three trips) lost one on 21 Oct.
    -- Time zone looked up once per trip. Training trips only while they run.
    FOR r IN
      with b as (
        select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
          from public.solver_score_builds sb
          join public.trips t on t.id = sb.trip_id and t.archived is not true
                             and (t.training_of is null or t.id in (select public.training_trips_active()))
         where sb.variant = 'raw'
         order by sb.trip_id, sb.built_at desc),
      d as (
        select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
          from b join public.solver_scores s on s.build_id = b.id)
      select jsonb_build_object('trip_id', d.trip_id, 'date', d.d) as body from d
      union all
      select jsonb_build_object('trip_id', b.trip_id,
               'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                          from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
        from b
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
        body := r.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
      PERFORM pg_sleep(1);
    END LOOP;
  END $do$;
$cmd$);

select cron.schedule('solver-plan-calib', '3 11,20 * * *', $cmd$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    -- Running training trips only: the same calls as solver-plan, from the calibrated build, one a second.
    FOR r IN
      with b as (
        select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
          from public.solver_score_builds sb
         where sb.variant = 'calib' and sb.trip_id in (select public.training_trips_active())
         order by sb.trip_id, sb.built_at desc),
      d as (
        select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
          from b join public.solver_scores s on s.build_id = b.id)
      select jsonb_build_object('trip_id', d.trip_id, 'date', d.d, 'variant', 'calib') as body from d
      union all
      select jsonb_build_object('trip_id', b.trip_id, 'variant', 'calib',
               'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                          from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
        from b
    LOOP
      PERFORM net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
        body := r.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
      PERFORM pg_sleep(1);
    END LOOP;
  END $do$;
$cmd$);
