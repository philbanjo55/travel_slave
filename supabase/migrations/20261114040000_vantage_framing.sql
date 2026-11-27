-- Saved framing for a shot (Phil, 14 Nov 2026: go through every shot of both trips in the 3D view, walk to the spot,
-- frame the picture and keep that framing). DRAFT: not applied yet.
--
-- A shot (scout_vantages row) gets the direction the camera points (compass heading of the frame's middle), its tilt
-- (degrees up, as the 3D page measures it), the lens (the app's lens id: '75', '90', '135', '300', 'gw690') and the
-- orientation of the frame box. The 3D view opens on it instead of aiming at the subject pin. A vantage row is shared
-- by the real trip and its practice copy (training_sync links the same rows), so a framing saved on either is the
-- framing on both; the app says so before saving.
--
-- Doors (security definer, like sun_vantage_move: the app calls them with the public key):
--   sun_vantage_frame(stop, vantage, heading, pitch, lens, orient, at?)   save; `at` = when it was framed on the
--     phone (a save queued with no signal is sent later), never in the future
--   sun_vantage_unframe(stop, vantage)   forget it: the view aims at the subject again
-- trip_sun_plan gives each pair `framing` {heading, pitch, lens, orient, at} (null when not framed) and `starred`
-- (the stop's starred shot, solver_stop_settings.star_vantage_id), so the app can open on the framing and step
-- through the trip's shots starred first without another request. Everything else in trip_sun_plan is as before.

alter table public.scout_vantages
  add column if not exists frame_heading_deg real,
  add column if not exists frame_pitch_deg real,
  add column if not exists frame_lens text,
  add column if not exists frame_orient text,
  add column if not exists framed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scout_vantages_frame_check' and conrelid = 'public.scout_vantages'::regclass) then
alter table public.scout_vantages add constraint scout_vantages_frame_check check (
  (frame_heading_deg is null and frame_pitch_deg is null and frame_lens is null and frame_orient is null and framed_at is null)
  or (frame_heading_deg >= 0 and frame_heading_deg < 360
      and frame_pitch_deg between -90 and 90
      and frame_lens is not null and length(frame_lens) <= 20
      and frame_orient in ('landscape', 'portrait')
      and framed_at is not null));
  end if;
end $$;

comment on column public.scout_vantages.frame_heading_deg is '3D view saved framing: compass heading of the frame middle, degrees (app, sun_vantage_frame)';
comment on column public.scout_vantages.frame_pitch_deg is '3D view saved framing: tilt, degrees up';
comment on column public.scout_vantages.frame_lens is '3D view saved framing: the app lens id (75, 90, 135, 300, gw690)';
comment on column public.scout_vantages.frame_orient is '3D view saved framing: landscape | portrait';
comment on column public.scout_vantages.framed_at is '3D view saved framing: when it was framed on the phone';

create or replace function public.sun_vantage_frame(p_stop_id uuid, p_vantage_id uuid, p_heading double precision,
  p_pitch double precision, p_lens text, p_orient text, p_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_h double precision;
begin
  -- (NaN sorts above every number in Postgres, so the range test also refuses it)
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
  v_h := p_heading - 360 * floor(p_heading / 360);
  if v_h >= 360 then v_h := 0; end if;
  update public.scout_vantages
     set frame_heading_deg = round(v_h::numeric, 2)::real,
         frame_pitch_deg = round(p_pitch::numeric, 2)::real,
         frame_lens = p_lens,
         frame_orient = p_orient,
         framed_at = least(coalesce(p_at, now()), now()),
         updated_at = now()
   where id = p_vantage_id;
  return (select jsonb_build_object('vantage_id', v.id, 'heading', v.frame_heading_deg, 'pitch', v.frame_pitch_deg,
                                    'lens', v.frame_lens, 'orient', v.frame_orient, 'at', v.framed_at)
            from public.scout_vantages v where v.id = p_vantage_id);
end $$;
revoke all on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz) from public;
grant execute on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz) to anon, authenticated, service_role;

create or replace function public.sun_vantage_unframe(p_stop_id uuid, p_vantage_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id) then
    raise exception 'That shot is not on this stop';
  end if;
  update public.scout_vantages
     set frame_heading_deg = null, frame_pitch_deg = null, frame_lens = null, frame_orient = null, framed_at = null,
         updated_at = now()
   where id = p_vantage_id and framed_at is not null;
  return jsonb_build_object('vantage_id', p_vantage_id, 'framing', null);
end $$;
revoke all on function public.sun_vantage_unframe(uuid, uuid) from public;
grant execute on function public.sun_vantage_unframe(uuid, uuid) to anon, authenticated, service_role;

-- trip_sun_plan: the live definition (read 14 Nov 2026) plus `framing` and `starred` on each pair.
create or replace function public.trip_sun_plan(p_trip_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$
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
             'orient', v.frame_orient, 'at', v.framed_at) end as framing,
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
