-- Two fixes found by validation against JPL DE421 and Open-Meteo sunrise times.
--
-- 1. Sun-up threshold. sun_position() returns the apparent (refracted)
--    altitude, but vantage_light compared it with -0.833 deg, the standard
--    sunrise threshold for the *geometric* altitude, so refraction was counted
--    twice and the sun read as up ~2.5 min too early and too late. With the
--    NOAA refraction model used here, geometric -0.833 deg is apparent
--    -0.436 deg; with that threshold sunrise/sunset match JPL within seconds.
--
-- 2. No direction without separation. A vantage sitting on its subject's
--    coordinates (placeholders copied from the subject) has no bearing; it
--    read as 0 deg / "N". Under 20 m apart, bearing, facing, look angle and
--    the front/side/back label are now null ('no direction').

create or replace view public.scout_vantage_geometry with (security_invoker = true) as
select v.id   as vantage_id,
       v.code as vantage_code,
       v.name as vantage_name,
       s.id   as subject_id,
       s.name as subject_name,
       s.trip_id,
       case when g.dist_m >= 20 then round(g.bearing::numeric, 1) end        as bearing_deg,
       case when g.dist_m >= 20 then public.compass_point(g.bearing) end     as facing,
       round((g.dist_m / 1000)::numeric, 2)                                  as distance_km,
       vp.ground_m                                                           as vantage_dem_m,
       v.elevation_m                                                         as vantage_override_m,
       coalesce(v.elevation_m, vp.ground_m)                                  as vantage_elevation_m,
       sp.ground_m                                                           as subject_dem_m,
       s.height_m                                                            as subject_override_m,
       coalesce(s.height_m, sp.ground_m)                                     as subject_elevation_m,
       case when g.dist_m >= 20 then round(degrees(atan2(
         coalesce(s.height_m, sp.ground_m) - (coalesce(v.elevation_m, vp.ground_m) + 1.6),
         g.dist_m))::numeric, 2) end                                         as look_angle_deg,
       vp.status                                                             as vantage_terrain,
       sp.status                                                             as subject_terrain
from public.scout_vantages v
join public.scout_subjects s on s.id = v.subject_id
left join public.terrain_profiles vp on vp.id = v.terrain_profile_id
left join public.terrain_profiles sp on sp.id = s.terrain_profile_id
cross join lateral (
  select public.geo_bearing(v.lat, v.lng, s.lat, s.lng)    as bearing,
         public.geo_distance_m(v.lat, v.lng, s.lat, s.lng) as dist_m) g
where v.lat is not null and s.lat is not null;

create or replace function public.vantage_light(
  p_vantage  uuid,
  p_date     date,
  p_step_min integer default 5,
  p_tz       text    default 'Atlantic/Faroe')
returns table (
  local_time               timestamp,
  sun_azimuth              numeric,
  sun_altitude             numeric,
  sun_vs_facing_deg        numeric,
  light                    text,
  phase                    text,
  sun_visible_from_vantage boolean,
  sun_on_subject           boolean)
language plpgsql stable set search_path = public as $$
declare
  -- Apparent altitude of the sun's centre at sunrise/sunset (geometric -0.833).
  sun_up constant double precision := -0.436;
  g  record;
  hv double precision[];
  hs double precision[];
begin
  select v.lat as vlat, v.lng as vlng,
         case when public.geo_distance_m(v.lat, v.lng, s.lat, s.lng) >= 20
              then public.geo_bearing(v.lat, v.lng, s.lat, s.lng) end as bearing,
         v.terrain_profile_id as vp_id, s.terrain_profile_id as sp_id,
         coalesce(v.elevation_m, pv.ground_m, 0) + 1.6 as v_obs,
         coalesce(s.height_m, ps.ground_m, 0) + 2     as s_obs
    into g
    from public.scout_vantages v
    join public.scout_subjects s on s.id = v.subject_id
    left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
    left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
   where v.id = p_vantage and v.lat is not null and s.lat is not null;
  if not found then return; end if;

  hv := public.terrain_horizon(g.vp_id, g.v_obs);
  hs := public.terrain_horizon(g.sp_id, g.s_obs);

  return query
  select (t at time zone p_tz)::timestamp,
         round(sp.azimuth::numeric, 1),
         round(sp.altitude::numeric, 1),
         round(d.delta, 0),
         case when sp.altitude < sun_up then 'no sun'
              when hs is not null and sp.altitude <= public.horizon_at(hs, sp.azimuth) then 'in shadow'
              when d.delta is null then 'no direction'
              when d.delta <= 45   then 'backlit'
              when d.delta <= 135  then 'side'
              else 'front' end,
         case when sp.altitude < -6     then 'night'
              when sp.altitude < sun_up then 'blue hour'
              when sp.altitude < 6      then 'golden hour'
              else 'day' end,
         case when hv is null then null
              else sp.altitude > public.horizon_at(hv, sp.azimuth) end,
         case when hs is null then null
              else sp.altitude > public.horizon_at(hs, sp.azimuth) end
  from generate_series(p_date::timestamp at time zone p_tz,
                       (p_date + 1)::timestamp at time zone p_tz - interval '1 second',
                       make_interval(mins => p_step_min)) as t
  cross join lateral public.sun_position(t, g.vlat, g.vlng) sp
  cross join lateral (
    select abs(((sp.azimuth - g.bearing + 540)::numeric % 360) - 180) as delta) d;
end $$;
