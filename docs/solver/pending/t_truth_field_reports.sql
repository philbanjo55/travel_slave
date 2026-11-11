-- Tell T, the last piece: Phil's own word on the peaks ("peaks are out", "socked in") goes above the cameras for
-- that hour. One function, t_truth. With no report its answer is the same as before plus two empty keys.
-- Not applied: the session's safety check will not let Claude replace this shared function. Phil can run it himself:
-- Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
create or replace function public.t_truth(p_trip uuid, p_hr timestamp with time zone, p_lat double precision, p_lng double precision)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  with pl as (
    select s.lat slat, s.lng slng from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = p_trip
  ), apt as (
    select o.hidden from replay_hidden_obs o where o.trip_id = p_trip and o.hr = p_hr limit 1
  ), cams as (
    select c.code, (not f.hills_visible)::int hidden,
           sqrt(power((c.lat - p_lat) * 111, 2) + power((c.lng - p_lng) * 111 * cos(radians(p_lat)), 2)) km
      from webcam_frames f join webcam_cameras c on c.code = f.camera_code cross join pl
     where f.captured_at = p_hr and f.hills_visible is not null and not coalesce(f.stale, false)
       and coalesce(f.label, '') not in ('dark', 'camera_problem')
       and sqrt(power((c.lat - pl.slat) * 111, 2) + power((c.lng - pl.slng) * 111 * cos(radians(pl.slat)), 2)) < 80
  ), n as (select count(*) n, coalesce(sum(hidden), 0) h, min(hidden) mn from cams)
  , maj as (select case when n.n >= 2 then ((n.h + coalesce((select hidden from apt), 0)) * 2 >= n.n + (select count(*) from apt))::int end a from n)
  -- Phil's own word that hour (the newest), above the cameras.
  , phil as (select case r.sky when 'hidden' then 1 else 0 end hidden from t_reports r
              where r.trip_id = p_trip and not r.void and r.sky in ('out', 'hidden') and r.at >= p_hr and r.at < p_hr + interval '1 hour'
              order by r.at desc limit 1)
  select jsonb_build_object(
    'old', (select o.hidden from replay_hidden_truth o where o.trip_id = p_trip and o.hr = p_hr limit 1),
    'a', coalesce((select hidden from phil), (select a from maj)),
    'cam_a', (select a from maj), 'phil', (select hidden from phil),
    'b', (select hidden from cams order by km limit 1),
    'b_cam', (select code from cams order by km limit 1),
    'c', case when n.n >= 1 then n.mn end,
    'cams', n.n, 'cams_hidden', n.h, 'airport', (select hidden from apt))
  from n
$function$;
