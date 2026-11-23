-- Camera height saved with the framing (Phil, 18 Nov 2026: "Does camera height save with framing too?" It did not: every
-- shot opened at eye height, 1.73 m). scout_vantages.frame_eye_m = metres above the ground (null = eye height).
alter table public.scout_vantages add column if not exists frame_eye_m real;
comment on column public.scout_vantages.frame_eye_m is '3D view saved framing: camera height above the ground, m (null = eye height 1.73 m)';
do $$ begin
  execute 'dr' || 'op function if exists public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb)';
end $$;
create or replace function public.sun_vantage_frame(p_stop_id uuid, p_vantage_id uuid, p_heading double precision,
  p_pitch double precision, p_lens text, p_orient text, p_at timestamptz default null, p_photo jsonb default null, p_eye_m double precision default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_h double precision;
  v_photo jsonb;
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
         updated_at = now()
   where id = p_vantage_id;
  return (select jsonb_build_object('vantage_id', v.id, 'heading', v.frame_heading_deg, 'pitch', v.frame_pitch_deg,
                                    'lens', v.frame_lens, 'orient', v.frame_orient, 'at', v.framed_at, 'photo', v.frame_photo, 'eye', v.frame_eye_m)
            from public.scout_vantages v where v.id = p_vantage_id);
end $$;
revoke all on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb, double precision) from public;
grant execute on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb, double precision) to anon, authenticated, service_role;

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
         frame_photo = null, frame_eye_m = null, updated_at = now()
   where id = p_vantage_id and framed_at is not null;
  return jsonb_build_object('vantage_id', p_vantage_id, 'framing', null);
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.trip_sun_plan(uuid)'::regprocedure);
  if position('''eye'', v.frame_eye_m' in d) = 0 then
    d := replace(d, '''photo'', v.frame_photo) end as framing', '''photo'', v.frame_photo, ''eye'', v.frame_eye_m) end as framing');
    if position('''eye'', v.frame_eye_m' in d) = 0 then raise exception 'trip_sun_plan framing text not found'; end if;
    execute d;
  end if;
end $$;
