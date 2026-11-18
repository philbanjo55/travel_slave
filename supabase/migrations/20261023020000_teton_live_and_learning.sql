-- 🧪 Teton Live (Phil, 23 Oct 2026: "run live planning on this trip too and
-- let both live trip planners adjust"). The Grand Teton itinerary moved to
-- now, side by side with 🧪 Faroes Live, and the corrected ("calib") planner
-- on both live trips now learns from what actually happened.

-- 1. Teton Live: trip day N = p_start + N - 1. Stops, hotel, shots and solver
-- settings copied once (terrain profiles and drive legs are shared by
-- location). Create-only. The itinerary is 7 days, so after the first week
-- live_trip_shift() moves the same days on by a week (dates only) to run it
-- a second time to 6 Nov, without copying the stops twice.
create or replace function public.make_teton_live_trip(p_start date)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  lt  constant uuid := '7e57bed0-0000-4000-8000-000000000003';
  src constant uuid := '5e247891-d800-4d07-b5e0-8ad748ae2754';
  n_days int; n_stops int; n_pairs int; n_set int;
begin
  if exists (select 1 from public.trips where id = lt) then raise exception 'Teton Live already exists'; end if;

  insert into public.trips (id, title, subtitle, owner, start_date, end_date, accent_color, travelers, timezone, archived, metar_station)
  select lt, '🧪 Teton Live', 'Live-weather test of the planner: the Grand Teton itinerary moved to now. Safe to break.', owner,
         p_start, p_start + 6, accent_color, travelers, timezone, false, metar_station
    from public.trips where id = src;

  create temp table tl_days as
    select d.id as old_id, gen_random_uuid() as new_id from public.days d where d.trip_id = src;
  insert into public.days (id, trip_id, day_number, date, title, subtitle, region, map_center_lat, map_center_lng, map_zoom, metar_station)
  select m.new_id, lt, d.day_number, p_start + d.day_number - 1, d.title, d.subtitle, d.region, d.map_center_lat, d.map_center_lng, d.map_zoom, d.metar_station
    from public.days d join tl_days m on m.old_id = d.id;
  get diagnostics n_days = row_count;

  create temp table tl_stops as
    select s.id as old_id, gen_random_uuid() as new_id from public.stops s join tl_days m on m.old_id = s.day_id;
  insert into public.stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes,
                            lat, lng, place_id, alltrails_url, map_url, google_maps_url, signal_status, info, log, hist, photo_note,
                            shot_type, tide_station_id, time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
  select ms.new_id, md.new_id, lt, s.position, s.name, s.emoji, s.time_label, s.duration_minutes, s.drive_override_minutes,
         s.lat, s.lng, s.place_id, s.alltrails_url, s.map_url, s.google_maps_url, s.signal_status, s.info, s.log, s.hist, s.photo_note,
         s.shot_type, s.tide_station_id, s.time_locked, s.movable, s.elevation_m, s.elevation_lat, s.elevation_lng, s.elevation_probed_at
    from public.stops s join tl_stops ms on ms.old_id = s.id join tl_days md on md.old_id = s.day_id;
  get diagnostics n_stops = row_count;

  create temp table tl_subj as
    select x.old_id, gen_random_uuid() as new_id from (
      select distinct v.subject_id as old_id
        from public.stop_sun_pairs p join tl_stops ms on ms.old_id = p.stop_id join public.scout_vantages v on v.id = p.vantage_id) x;
  insert into public.scout_subjects (id, trip_id, name, island, lat, lng, coord_confidence, priority, best_light, faces, notes, status,
                                     phil_tier, subject_kind, movable, height_m)
  select m.new_id, lt, s.name, s.island, s.lat, s.lng, s.coord_confidence, s.priority, s.best_light, s.faces, s.notes, s.status,
         s.phil_tier, s.subject_kind, s.movable, s.height_m
    from public.scout_subjects s join tl_subj m on m.old_id = s.id;

  create temp table tl_vant as
    select x.old_id, gen_random_uuid() as new_id from (
      select distinct p.vantage_id as old_id from public.stop_sun_pairs p join tl_stops ms on ms.old_id = p.stop_id) x;
  insert into public.scout_vantages (id, subject_id, code, name, shot_name, lat, lng, coord_confidence, elevation_m, distance_to_subject_km,
                                     access, walk_minutes, notes)
  select mv.new_id, msub.new_id, v.code, v.name, v.shot_name, v.lat, v.lng, v.coord_confidence, v.elevation_m, v.distance_to_subject_km,
         v.access, v.walk_minutes, v.notes
    from public.scout_vantages v join tl_vant mv on mv.old_id = v.id join tl_subj msub on msub.old_id = v.subject_id;

  insert into public.stop_sun_pairs (stop_id, vantage_id, position)
  select ms.new_id, mv.new_id, p.position
    from public.stop_sun_pairs p join tl_stops ms on ms.old_id = p.stop_id join tl_vant mv on mv.old_id = p.vantage_id;
  get diagnostics n_pairs = row_count;

  insert into public.solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note, fog_wanted)
  select ms.new_id, x.tier, mv.new_id, x.light_wanted, x.time_locked, x.source, x.note, x.fog_wanted
    from public.solver_stop_settings x join tl_stops ms on ms.old_id = x.stop_id
    left join tl_vant mv on mv.old_id = x.star_vantage_id;
  get diagnostics n_set = row_count;

  insert into public.accommodations (day_id, type, name, lat, lng, map_url, booked_via, check_in, check_out, nights, trip_id, lodging_type)
  select null, a.type, a.name, a.lat, a.lng, a.map_url, a.booked_via, p_start, p_start + 6, 6, lt, a.lodging_type
    from public.accommodations a where a.trip_id = src;

  return jsonb_build_object('trip_id', lt, 'days', n_days, 'stops', n_stops, 'sun_pairs', n_pairs, 'settings', n_set);
end $function$;
revoke execute on function public.make_teton_live_trip(date) from public, anon, authenticated;

-- Moves a live test trip's days, hotel and trip dates on by p_days (dates
-- only; stops stay on their days). Live test trips only.
create or replace function public.live_trip_shift(p_trip uuid, p_days integer)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  if p_trip not in ('7e57bed0-0000-4000-8000-000000000002', '7e57bed0-0000-4000-8000-000000000003') then
    raise exception 'live_trip_shift is for the live test trips only';
  end if;
  update public.days set date = date + p_days where trip_id = p_trip;
  get diagnostics n = row_count;
  update public.accommodations set check_in = check_in + p_days, check_out = check_out + p_days where trip_id = p_trip;
  update public.trips set start_date = start_date + p_days, end_date = end_date + p_days, updated_at = now() where id = p_trip;
  return jsonb_build_object('trip', p_trip, 'days', n, 'start', (select start_date from public.trips where id = p_trip));
end $function$;
revoke execute on function public.live_trip_shift(uuid, integer) from public, anon, authenticated;

select public.make_teton_live_trip('2026-10-24');

-- Second week: on 30 Oct at 12:00 UTC (06:00 in Jackson, after the morning
-- plans), days 1-7 move to 31 Oct - 6 Nov. The job removes itself.
select cron.schedule('teton-live-week2', '0 12 30 10 *', $cmd$
  select public.live_trip_shift('7e57bed0-0000-4000-8000-000000000003', 7);
  select cron.unschedule('teton-live-week2');
$cmd$);

-- KJAC Oct/Nov history (prior for Teton Live): loaded one year at a time by a
-- temporary cron job (tmp-kjac-octnov-load, every 2 min: calib_load_history,
-- then calib_queue_month('KJAC', m, {y}) for the next of 2016-2025 x Oct/Nov;
-- ECMWF 2024-2025 queued by hand), which at the end ran
-- solver_fit_calibration_months('KJAC', 'history_octnov', {10,11}) and
-- removed itself.

-- 2. Learning: refit the corrected planner's tables from the live record.
-- For one station: every ECMWF member of the last p_days of pulls at the
-- station's cell (each member weighs 1/members, so one forecast hour counts
-- once) against what happened there, daylight only:
--   mostly_clear (METAR cloud <= 50%) by the member's max(low, mid) cloud, per lead day;
--   low_cloud (ceiling below 2000 ft or fog) by its low cloud, all leads pooled,
--   together with the webcams within 60 km (Phil's tap, else Claude's label:
--   hills hidden; all cameras together weigh one hour), so both kinds of truth count.
-- The result blends the prior (history) with the live counts:
--   p = (K x p_prior + n_live x p_live) / (K + n_live), K = min(prior n, p_k),
-- so history leads for the first days and the live record takes over as it
-- grows. A bin the prior lacks takes the nearest bin's value at weight 10. Writes source
-- 'live' (live counts only, for the review) and p_out (the blend).
create or replace function public.solver_fit_calibration_live(p_site text, p_prior text, p_out text default 'adaptive',
                                                               p_k real default 100, p_days integer default 30)
 returns jsonb language plpgsql set search_path to 'public'
as $function$
declare v_lat double precision; v_lng double precision; v_rows int;
begin
  select lat, lng into v_lat, v_lng from metar_stations where icao = p_site;
  if v_lat is null then raise exception 'unknown station %', p_site; end if;

  insert into solver_calibration (source, site, event, predictor, lead_day, bin_lo, bin_hi, n, p_obs, p_rule, fitted_at)
  with pulls as (
    select pl.id, pl.pulled_at, solver_nearest_cell(v_lat, v_lng, pl.id) as cell
      from weather_ensemble_pulls pl where pl.pulled_at > now() - make_interval(days => p_days)
  ), obs as (
    select o.hr,
           case when o.cloud_pct is not null then o.cloud_pct <= 50 end as clear,
           case when o.ceiling_ft is not null or o.cloud_pct is not null or o.fog is not null
                then coalesce(o.ceiling_ft < 2000, false) or coalesce(o.fog, false) end as low
      from station_obs_hourly o
     where o.station = p_site and o.hr > now() - make_interval(days => p_days + 6)
       and (select sp.altitude from sun_position(o.hr, v_lat, v_lng) sp) > 3
  ), air as (
    select least(5, floor(extract(epoch from e.valid_at - p.pulled_at) / 86400))::int as lead_day,
           u.cl, u.cm, o.clear, o.low, 1.0 / cardinality(e.cloud_low) as w
      from pulls p
      join weather_ensemble e on e.pull_id = p.id and e.cell_key = p.cell and e.model = 'ecmwf_ifs025'
                             and e.valid_at > p.pulled_at and e.valid_at < now()
      join obs o on o.hr = e.valid_at
      cross join lateral unnest(e.cloud_low, e.cloud_mid) u(cl, cm)
  ), cam_frames as (
    -- All cameras together count as one observation an hour (ncam splits it).
    select x.*, count(*) over (partition by x.hr) as ncam
      from (select c.code, c.lat, c.lng, date_trunc('hour', f.captured_at + interval '30 minutes') as hr,
                   case when f.phil_label in ('clear', 'cloud_on_hills', 'fog') then f.phil_label <> 'clear'
                        when f.phil_label is null and f.label_model like 'claude%' and f.label not in ('dark', 'camera_problem')
                          then not f.hills_visible end as hidden
              from webcam_cameras c
              join webcam_frames f on f.camera_code = c.code
             where c.lat is not null and gc_km(v_lat, v_lng, c.lat, c.lng) <= 60
               and f.captured_at > now() - make_interval(days => p_days) and f.sun_altitude > 3 and not f.stale) x
     where x.hidden is not null
  ), cam_cells as (
    select distinct c.code, p.id as pull_id, p.pulled_at, solver_nearest_cell(c.lat, c.lng, p.id) as cell
      from (select distinct code, lat, lng from cam_frames) c cross join pulls p
  ), cam as (
    select least(5, floor(extract(epoch from e.valid_at - cc.pulled_at) / 86400))::int as lead_day,
           u.cl, f.hidden, 1.0 / cardinality(e.cloud_low) / f.ncam as w
      from cam_frames f
      join cam_cells cc on cc.code = f.code
      join weather_ensemble e on e.pull_id = cc.pull_id and e.cell_key = cc.cell and e.model = 'ecmwf_ifs025'
                             and e.valid_at = f.hr and e.valid_at > cc.pulled_at
      cross join lateral unnest(e.cloud_low) u(cl)
  ), live as (
    select 'mostly_clear'::text as event, 'max_low_mid'::text as predictor, lead_day, greatest(cl, cm) as v, clear as obs,
           greatest(cl, cm) <= 50 as rule_says, w
      from air where cl is not null and cm is not null and clear is not null
    union all
    select 'low_cloud', 'cloud_low', 0, cl, low, cl >= 70, w from air where cl is not null and low is not null
    union all
    select 'low_cloud', 'cloud_low', 0, cl, hidden, cl >= 70, w from cam where cl is not null
  ), bins(lo, hi) as (values (0::real, 10::real), (10, 30), (30, 50), (50, 70), (70, 90), (90, 101)),
  fit_live as (
    select l.event, l.predictor, l.lead_day, b.lo, b.hi, sum(l.w)::real as n, (sum(l.w * l.obs::int) / sum(l.w))::real as p,
           (sum(l.w * l.rule_says::int) / sum(l.w))::real as r
      from live l join bins b on l.v >= b.lo and l.v < b.hi
     group by 1, 2, 3, 4, 5
  ), grid as (
    select ep.event, ep.predictor, ld.l as lead_day, b.lo, b.hi
      from (values ('mostly_clear', 'max_low_mid'), ('low_cloud', 'cloud_low')) ep(event, predictor)
      cross join generate_series(0, 5) ld(l)
      cross join (values (0::real, 10::real), (10, 30), (30, 50), (50, 70), (70, 90), (90, 101)) b(lo, hi)
     where ep.event = 'mostly_clear' or ld.l = 0
  ), pri as (
    select g.*, pr.p_obs as p_prior, pr.n as n_prior, pr.p_rule
      from grid g
      left join lateral (
        select c.p_obs, case when c.bin_lo = g.lo then c.n else 10 end as n, c.p_rule
          from solver_calibration c
         where c.source = p_prior and c.site = p_site and c.event = g.event and c.predictor = g.predictor
           and c.lead_day <= g.lead_day
         order by c.lead_day desc, abs(c.bin_lo - g.lo), c.bin_lo
         limit 1) pr on true
  )
  select p_out, p_site, pri.event, pri.predictor, pri.lead_day, pri.lo, pri.hi,
         round(least(coalesce(pri.n_prior, 0), p_k) + coalesce(f.n, 0))::int,
         coalesce((least(coalesce(pri.n_prior, 0), p_k) * coalesce(pri.p_prior, 0) + coalesce(f.n, 0) * coalesce(f.p, 0))
                    / nullif(least(coalesce(pri.n_prior, 0), p_k) + coalesce(f.n, 0), 0), pri.p_prior)::real,
         coalesce(pri.p_rule, f.r, 0), now()
    from pri
    left join fit_live f on f.event = pri.event and f.predictor = pri.predictor and f.lead_day = pri.lead_day and f.lo = pri.lo
  union all
  select 'live', p_site, event, predictor, lead_day, lo, hi, round(n)::int, p, r, now() from fit_live
  on conflict (source, site, event, predictor, lead_day, bin_lo) do update set
    bin_hi = excluded.bin_hi, n = excluded.n, p_obs = excluded.p_obs, p_rule = excluded.p_rule, fitted_at = excluded.fitted_at;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('site', p_site, 'rows', v_rows,
    'live_hours', (select sum(n) from solver_calibration where source = 'live' and site = p_site and event = 'mostly_clear'),
    'live_low_hours', (select sum(n) from solver_calibration where source = 'live' and site = p_site and event = 'low_cloud'));
end $function$;

-- Refit both live trips' stations 4 minutes before each calibrated build,
-- then build and plan both live trips with the learnt tables.
select cron.schedule('solver-fit-live', '45 10,19 * * *', $cmd$
  select public.solver_fit_calibration_live('EKVG', 'history_octnov');
  select public.solver_fit_calibration_live('KJAC', 'history_octnov');
$cmd$);

select cron.schedule('solver-build-calib', '49 10,19 * * *', $cmd$
  select public.solver_build_calib(t, 'adaptive')
    from unnest(array['7e57bed0-0000-4000-8000-000000000002', '7e57bed0-0000-4000-8000-000000000003']::uuid[]) t;
$cmd$);

select cron.schedule('solver-plan-calib', '3 11,20 * * *', $cmd$
  DO $do$
  DECLARE r RECORD;
  BEGIN
    -- The live test trips only: the same calls as solver-plan, from the calibrated build, one a second.
    FOR r IN
      with b as (
        select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
          from public.solver_score_builds sb
         where sb.variant = 'calib'
           and sb.trip_id in ('7e57bed0-0000-4000-8000-000000000002', '7e57bed0-0000-4000-8000-000000000003')
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
