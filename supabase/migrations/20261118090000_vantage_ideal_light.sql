-- Ideal light per shot (Phil, 18 Nov 2026: "For each shot, I'd like to save an ideal time/lighting scenario. And then
-- the starred one is what T uses ... First, let's get the save ability in there"). Step 1: save only, T does not read it
-- yet. Saved as where the sun is (azimuth / altitude, degrees, as the app's sun engine gives them) plus the moment it was
-- picked, so it carries to any date: the app finds the time on another day when the sun is closest to that position.
alter table public.scout_vantages
  add column if not exists ideal_sun_az real,
  add column if not exists ideal_sun_alt real,
  add column if not exists ideal_at timestamptz;
comment on column public.scout_vantages.ideal_sun_az is 'Ideal light for the shot: sun azimuth, deg from north (app, sun_vantage_ideal)';
comment on column public.scout_vantages.ideal_sun_alt is 'Ideal light for the shot: sun altitude, deg';
comment on column public.scout_vantages.ideal_at is 'Ideal light for the shot: the moment it was picked on (the time slider''s date and time)';

create or replace function public.sun_vantage_ideal(p_stop_id uuid, p_vantage_id uuid, p_az double precision,
  p_alt double precision, p_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id) then
    raise exception 'That shot is not on this stop';
  end if;
  if p_az is null then   -- forget it
    update public.scout_vantages set ideal_sun_az = null, ideal_sun_alt = null, ideal_at = null, updated_at = now()
     where id = p_vantage_id;
    return jsonb_build_object('vantage_id', p_vantage_id, 'ideal', null);
  end if;
  if not (p_az between -720 and 720) or p_alt is null or not (p_alt between -20 and 90) then
    raise exception 'The sun position is out of range';
  end if;
  update public.scout_vantages
     set ideal_sun_az = round((p_az - 360 * floor(p_az / 360))::numeric, 2)::real,
         ideal_sun_alt = round(p_alt::numeric, 2)::real,
         ideal_at = p_at,
         updated_at = now()
   where id = p_vantage_id;
  return (select jsonb_build_object('vantage_id', v.id, 'ideal', jsonb_build_object('az', v.ideal_sun_az, 'alt', v.ideal_sun_alt, 'at', v.ideal_at))
            from public.scout_vantages v where v.id = p_vantage_id);
end $$;
revoke all on function public.sun_vantage_ideal(uuid, uuid, double precision, double precision, timestamptz) from public;
grant execute on function public.sun_vantage_ideal(uuid, uuid, double precision, double precision, timestamptz) to anon, authenticated, service_role;

-- trip_sun_plan: the live definition with 'ideal' on each shot
CREATE OR REPLACE FUNCTION public.trip_sun_plan(p_trip_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pairs as (
    select p.stop_id, p.position, st.day_id,
           v.id as vantage_id, v.code, v.name as vantage_name,
           v.lat as vlat, v.lng as vlng,
           s.id as subject_id, s.name as subject_name, s.lat as slat, s.lng as slng,
           coalesce(v.elevation_m, pv.ground_m, 0) + 1.6 as v_obs,
           coalesce(s.height_m, ps.ground_m, 0) + 2     as s_obs,
           v.terrain_profile_id as vp_id, s.terrain_profile_id as sp_id,
           ph.id as photo_id, ph.storage_url as photo_url,
           coalesce(v.shot_name, s.name) as shot_name,
           case when v.framed_at is not null then jsonb_build_object(
             'heading', v.frame_heading_deg, 'pitch', v.frame_pitch_deg, 'lens', v.frame_lens,
             'orient', v.frame_orient, 'at', v.framed_at, 'photo', v.frame_photo, 'eye', v.frame_eye_m) end as framing,
           case when v.ideal_sun_az is not null then jsonb_build_object('az', v.ideal_sun_az, 'alt', v.ideal_sun_alt, 'at', v.ideal_at) end as ideal,
           coalesce(ss.star_vantage_id = v.id, false) as starred
      from public.stop_sun_pairs p
      join public.stops st on st.id = p.stop_id and st.trip_id = p_trip_id
      join public.scout_vantages v on v.id = p.vantage_id
      join public.scout_subjects s on s.id = v.subject_id
      left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
      left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
      left join public.stop_photos ph on ph.id = v.photo_id
      left join public.solver_stop_settings ss on ss.stop_id = p.stop_id
     where v.lat is not null and v.lng is not null and s.lat is not null and s.lng is not null
  ),
  stop_meta as (
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
                         from unnest(public.skyline_cached(pr.sp_id, pr.s_obs)) with ordinality u(h, i)),
             'photo_id', pr.photo_id, 'photo_url', pr.photo_url,
             'shot_name', pr.shot_name,
             'framing', pr.framing,
             'ideal', pr.ideal,
             'starred', pr.starred
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
$function$
;
