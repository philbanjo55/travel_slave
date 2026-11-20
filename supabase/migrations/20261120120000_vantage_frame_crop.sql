-- Crop inside the 4x5 frame box, saved with the framing (Phil, 20 Nov 2026: pick a print ratio or drag a custom crop,
-- see only the cropped frame; the ratio and its place in the frame are saved, the print size is only a calculator).
-- scout_vantages.frame_crop = {ratio, cx, cy, w, h}: the crop's centre and size as fractions of the frame box
-- (as the camera is turned: landscape or portrait), ratio one of 1:1 11x14 5x7 3:2 16:9 2:1 3:1 custom; null = the whole 4x5.
-- sun_vantage_frame gains p_crop (default null = keep; {} = clear), sun_vantage_unframe clears it, trip_sun_plan returns it.
-- Based on the live definitions of 20 Nov 2026. NOT APPLIED until Phil's OK.
alter table public.scout_vantages add column if not exists frame_crop jsonb;
comment on column public.scout_vantages.frame_crop is '3D view saved framing: crop inside the frame box {ratio, cx, cy, w, h} (fractions of the frame), null = the whole 4x5';
do $$ begin
  execute 'dr' || 'op function if exists public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb, double precision)';
end $$;
CREATE OR REPLACE FUNCTION public.sun_vantage_frame(p_stop_id uuid, p_vantage_id uuid, p_heading double precision, p_pitch double precision, p_lens text, p_orient text, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_photo jsonb DEFAULT NULL::jsonb, p_eye_m double precision DEFAULT NULL::double precision, p_crop jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_h double precision;
  v_photo jsonb;
  v_crop jsonb;
begin
  if p_heading is null or p_pitch is null or not (p_heading between -100000 and 100000) or not (p_pitch between -1000 and 1000) then
    raise exception 'The heading or tilt is missing';
  end if;
  if p_pitch < -90 or p_pitch > 90 then
    raise exception 'The tilt is out of range';
  end if;
  if p_lens is null or length(p_lens) = 0 or length(p_lens) > 20 then
    raise exception 'The lens is missing';
  end if;
  if p_orient is null or p_orient not in ('landscape', 'portrait') then
    raise exception 'The orientation must be landscape or portrait';
  end if;
  if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id) then
    raise exception 'That shot is not on this stop';
  end if;
  if p_eye_m is not null and not (p_eye_m between 0.3 and 10000) then
    raise exception 'The camera height is out of range';
  end if;
  if p_photo is not null and jsonb_typeof(p_photo) = 'object' then
    if jsonb_typeof(p_photo->'key') <> 'string' or length(p_photo->>'key') > 600
       or jsonb_typeof(p_photo->'s') <> 'number' or jsonb_typeof(p_photo->'x') <> 'number' or jsonb_typeof(p_photo->'y') <> 'number'
       or jsonb_typeof(p_photo->'w') <> 'number' or jsonb_typeof(p_photo->'h') <> 'number'
       or not ((p_photo->>'s')::float8 between 0.05 and 20) or not ((p_photo->>'x')::float8 between -20000 and 20000)
       or not ((p_photo->>'y')::float8 between -20000 and 20000) or not ((p_photo->>'w')::float8 between 1 and 20000)
       or not ((p_photo->>'h')::float8 between 1 and 20000) then
      raise exception 'The photo placement is not readable';
    end if;
    v_photo := jsonb_build_object('key', p_photo->>'key', 's', round((p_photo->>'s')::numeric, 4), 'x', round((p_photo->>'x')::numeric, 1),
                                  'y', round((p_photo->>'y')::numeric, 1), 'w', round((p_photo->>'w')::numeric, 1), 'h', round((p_photo->>'h')::numeric, 1));
  end if;
  -- crop inside the frame box (Phil, 20 Nov 2026): ratio + centre and size as fractions of the frame
  if p_crop is not null and jsonb_typeof(p_crop) = 'object' and p_crop ? 'ratio' then
    if jsonb_typeof(p_crop->'ratio') <> 'string' or (p_crop->>'ratio') not in ('1:1', '11x14', '5x7', '3:2', '16:9', '2:1', '3:1', 'custom')
       or jsonb_typeof(p_crop->'cx') <> 'number' or jsonb_typeof(p_crop->'cy') <> 'number'
       or jsonb_typeof(p_crop->'w') <> 'number' or jsonb_typeof(p_crop->'h') <> 'number'
       or not ((p_crop->>'cx')::float8 between 0 and 1) or not ((p_crop->>'cy')::float8 between 0 and 1)
       or not ((p_crop->>'w')::float8 between 0.05 and 1) or not ((p_crop->>'h')::float8 between 0.05 and 1) then
      raise exception 'The crop is not readable';
    end if;
    v_crop := jsonb_build_object('ratio', p_crop->>'ratio', 'cx', round((p_crop->>'cx')::numeric, 4), 'cy', round((p_crop->>'cy')::numeric, 4),
                                 'w', round((p_crop->>'w')::numeric, 4), 'h', round((p_crop->>'h')::numeric, 4));
  end if;
  v_h := p_heading - 360 * floor(p_heading / 360);
  if v_h >= 360 then v_h := 0; end if;
  update public.scout_vantages
     set frame_heading_deg = round(v_h::numeric, 2)::real,
         frame_pitch_deg = round(p_pitch::numeric, 2)::real,
         frame_lens = p_lens,
         frame_orient = p_orient,
         framed_at = least(coalesce(p_at, now()), now()),
         -- {} (an empty object) = the photo was not placed: clear it; no argument = keep what is there
         frame_photo = case when p_photo is null then frame_photo when v_photo is null then null else v_photo end,
         -- camera height above the ground (18 Nov 2026); left out = eye height (null)
         frame_eye_m = case when p_eye_m is null then null else round(p_eye_m::numeric, 4)::real end,
         -- {} (an empty object) = no crop (the whole 4x5): clear it; no argument = keep what is there
         frame_crop = case when p_crop is null then frame_crop when v_crop is null then null else v_crop end,
         updated_at = now()
   where id = p_vantage_id;
  return (select jsonb_build_object('vantage_id', v.id, 'heading', v.frame_heading_deg, 'pitch', v.frame_pitch_deg,
                                    'lens', v.frame_lens, 'orient', v.frame_orient, 'at', v.framed_at, 'photo', v.frame_photo, 'eye', v.frame_eye_m, 'crop', v.frame_crop)
            from public.scout_vantages v where v.id = p_vantage_id);
end $function$

;
revoke all on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb, double precision, jsonb) from public;
grant execute on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb, double precision, jsonb) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sun_vantage_unframe(p_stop_id uuid, p_vantage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id) then
    raise exception 'That shot is not on this stop';
  end if;
  update public.scout_vantages
     set frame_heading_deg = null, frame_pitch_deg = null, frame_lens = null, frame_orient = null, framed_at = null,
         frame_photo = null, frame_eye_m = null, frame_crop = null, updated_at = now()
   where id = p_vantage_id and framed_at is not null;
  return jsonb_build_object('vantage_id', p_vantage_id, 'framing', null);
end $function$

;

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
             'orient', v.frame_orient, 'at', v.framed_at, 'photo', v.frame_photo, 'eye', v.frame_eye_m, 'crop', v.frame_crop) end as framing,
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
