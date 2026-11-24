-- Several framings on one shot (Phil, 24 Nov 2026: "I'd like to be able to have multiple lens/format for the same shot";
-- mockup docs/mockups/framings_mockup.png, "Ya build it"). One stand spot, a list of framings (camera, lens, heading,
-- tilt, landscape / portrait, camera height, crop, photo placement). The first framing stays in the frame_* columns, so
-- everything that reads a shot's framing today (3D view opening, overhead cone, Walk to shot, the Stops page count, older
-- app builds) keeps reading the shot's default; the rest go in frame_more (a json array, in order). The planner reads none
-- of it. The stop's star (starred shot) is unrelated and unchanged.
-- sun_framing_clean(jsonb): one framing checked and tidied (same rules as sun_vantage_frame).
-- sun_vantage_framings(stop, vantage, list): writes the shot's whole list ([] = no framing); the app's only save from now on.
-- sun_vantage_unframe also clears frame_more; trip_sun_plan returns 'framing_more'. Based on the live definitions of
-- 24 Nov 2026 (trip_sun_plan = 20261120120000 byte for byte).
alter table public.scout_vantages add column if not exists frame_more jsonb;
comment on column public.scout_vantages.frame_more is '3D view: the shot''s other saved framings after the default one (frame_* columns), json array of {heading, pitch, lens, orient, at, photo, eye, crop}';

CREATE OR REPLACE FUNCTION public.sun_framing_clean(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_heading double precision;
  v_pitch double precision;
  v_eye double precision;
  v_at timestamptz;
  v_photo jsonb;
  v_crop jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'A framing is not readable'; end if;
  if jsonb_typeof(p->'heading') <> 'number' or jsonb_typeof(p->'pitch') <> 'number' then
    raise exception 'The heading or tilt is missing';
  end if;
  v_heading := (p->>'heading')::float8;
  v_pitch := (p->>'pitch')::float8;
  if not (v_heading between -100000 and 100000) then raise exception 'The heading is out of range'; end if;
  if not (v_pitch between -90 and 90) then raise exception 'The tilt is out of range'; end if;
  if jsonb_typeof(p->'lens') <> 'string' or length(p->>'lens') = 0 or length(p->>'lens') > 20 then
    raise exception 'The lens is missing';
  end if;
  if coalesce(p->>'orient', '') not in ('landscape', 'portrait') then
    raise exception 'The orientation must be landscape or portrait';
  end if;
  if jsonb_typeof(p->'eye') = 'number' then
    v_eye := (p->>'eye')::float8;
    if not (v_eye between 0.3 and 10000) then raise exception 'The camera height is out of range'; end if;
  end if;
  begin
    v_at := case when jsonb_typeof(p->'at') = 'string' then (p->>'at')::timestamptz end;
  exception when others then v_at := null;
  end;
  if jsonb_typeof(p->'photo') = 'object' then
    if jsonb_typeof(p->'photo'->'key') <> 'string' or length(p->'photo'->>'key') > 600
       or jsonb_typeof(p->'photo'->'s') <> 'number' or jsonb_typeof(p->'photo'->'x') <> 'number' or jsonb_typeof(p->'photo'->'y') <> 'number'
       or jsonb_typeof(p->'photo'->'w') <> 'number' or jsonb_typeof(p->'photo'->'h') <> 'number'
       or not ((p->'photo'->>'s')::float8 between 0.05 and 20) or not ((p->'photo'->>'x')::float8 between -20000 and 20000)
       or not ((p->'photo'->>'y')::float8 between -20000 and 20000) or not ((p->'photo'->>'w')::float8 between 1 and 20000)
       or not ((p->'photo'->>'h')::float8 between 1 and 20000) then
      raise exception 'The photo placement is not readable';
    end if;
    v_photo := jsonb_build_object('key', p->'photo'->>'key', 's', round((p->'photo'->>'s')::numeric, 4), 'x', round((p->'photo'->>'x')::numeric, 1),
                                  'y', round((p->'photo'->>'y')::numeric, 1), 'w', round((p->'photo'->>'w')::numeric, 1), 'h', round((p->'photo'->>'h')::numeric, 1));
  end if;
  if jsonb_typeof(p->'crop') = 'object' and (p->'crop') ? 'ratio' then
    if jsonb_typeof(p->'crop'->'ratio') <> 'string' or (p->'crop'->>'ratio') not in ('1:1', '11x14', '5x7', '3:2', '16:9', '2:1', '3:1', 'custom')
       or jsonb_typeof(p->'crop'->'cx') <> 'number' or jsonb_typeof(p->'crop'->'cy') <> 'number'
       or jsonb_typeof(p->'crop'->'w') <> 'number' or jsonb_typeof(p->'crop'->'h') <> 'number'
       or not ((p->'crop'->>'cx')::float8 between 0 and 1) or not ((p->'crop'->>'cy')::float8 between 0 and 1)
       or not ((p->'crop'->>'w')::float8 between 0.05 and 1) or not ((p->'crop'->>'h')::float8 between 0.05 and 1) then
      raise exception 'The crop is not readable';
    end if;
    v_crop := jsonb_build_object('ratio', p->'crop'->>'ratio', 'cx', round((p->'crop'->>'cx')::numeric, 4), 'cy', round((p->'crop'->>'cy')::numeric, 4),
                                 'w', round((p->'crop'->>'w')::numeric, 4), 'h', round((p->'crop'->>'h')::numeric, 4));
  end if;
  v_heading := v_heading - 360 * floor(v_heading / 360);
  if v_heading >= 360 then v_heading := 0; end if;
  return jsonb_build_object(
    'heading', round(v_heading::numeric, 2), 'pitch', round(v_pitch::numeric, 2),
    'lens', p->>'lens', 'orient', p->>'orient', 'at', v_at,
    'photo', v_photo, 'eye', case when v_eye is null then null else round(v_eye::numeric, 4) end, 'crop', v_crop);
end $function$;
revoke all on function public.sun_framing_clean(jsonb) from public;
grant execute on function public.sun_framing_clean(jsonb) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sun_vantage_framings(p_stop_id uuid, p_vantage_id uuid, p_list jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_list jsonb := '[]'::jsonb;
  v_f jsonb;
  v_first jsonb;
begin
  if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id) then
    raise exception 'That shot is not on this stop';
  end if;
  if p_list is null or jsonb_typeof(p_list) <> 'array' then raise exception 'The framings are not readable'; end if;
  if jsonb_array_length(p_list) > 8 then raise exception 'A shot keeps at most 8 framings'; end if;
  for v_f in select e from jsonb_array_elements(p_list) e loop
    v_f := public.sun_framing_clean(v_f);
    if v_f->>'at' is null or (v_f->>'at')::timestamptz > now() then v_f := jsonb_set(v_f, '{at}', to_jsonb(now())); end if;
    v_list := v_list || jsonb_build_array(v_f);
  end loop;
  v_first := v_list->0;
  update public.scout_vantages
     set frame_heading_deg = (v_first->>'heading')::real,
         frame_pitch_deg = (v_first->>'pitch')::real,
         frame_lens = v_first->>'lens',
         frame_orient = v_first->>'orient',
         framed_at = (v_first->>'at')::timestamptz,
         frame_photo = case when jsonb_typeof(v_first->'photo') = 'object' then v_first->'photo' end,
         frame_eye_m = (v_first->>'eye')::real,
         frame_crop = case when jsonb_typeof(v_first->'crop') = 'object' then v_first->'crop' end,
         frame_more = case when jsonb_array_length(v_list) > 1 then v_list - 0 end,
         updated_at = now()
   where id = p_vantage_id;
  return jsonb_build_object('vantage_id', p_vantage_id, 'framings', v_list);
end $function$;
revoke all on function public.sun_vantage_framings(uuid, uuid, jsonb) from public;
grant execute on function public.sun_vantage_framings(uuid, uuid, jsonb) to anon, authenticated, service_role;

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
         frame_photo = null, frame_eye_m = null, frame_crop = null, frame_more = null, updated_at = now()
   where id = p_vantage_id and (framed_at is not null or frame_more is not null);
  return jsonb_build_object('vantage_id', p_vantage_id, 'framing', null);
end $function$;

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
           case when v.framed_at is not null then v.frame_more end as framing_more,
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
             'framing_more', pr.framing_more,
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
$function$;
