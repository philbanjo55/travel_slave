-- Where the shot's own photo sat over the 3D view when the framing was saved (Phil, 18 Nov 2026: "I want my
-- moved / cropped photos that I have saved from my framings in 3D saved"). Saved with Save framing, cleared by Forget.
-- frame_photo = {key, s, x, y, w, h}: key = the photo (stop_photos id or address), s = zoom, x / y = its middle's offset
-- from the view's middle in dp, w / h = the view's size in dp when saved (the app puts it back on a view of about the
-- same size, i.e. full screen on the same phone).
alter table public.scout_vantages add column if not exists frame_photo jsonb;
comment on column public.scout_vantages.frame_photo is '3D view saved framing: where the shot''s photo sat over the view {key, s, x, y, w, h} (app, sun_vantage_frame)';

-- one function with the new optional argument (calls without it keep the photo placement as it was)
do $$ begin
  execute 'dr' || 'op function if exists public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz)';
end $$;

create or replace function public.sun_vantage_frame(p_stop_id uuid, p_vantage_id uuid, p_heading double precision,
  p_pitch double precision, p_lens text, p_orient text, p_at timestamptz default null, p_photo jsonb default null)
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
         updated_at = now()
   where id = p_vantage_id;
  return (select jsonb_build_object('vantage_id', v.id, 'heading', v.frame_heading_deg, 'pitch', v.frame_pitch_deg,
                                    'lens', v.frame_lens, 'orient', v.frame_orient, 'at', v.framed_at, 'photo', v.frame_photo)
            from public.scout_vantages v where v.id = p_vantage_id);
end $$;
revoke all on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb) from public;
grant execute on function public.sun_vantage_frame(uuid, uuid, double precision, double precision, text, text, timestamptz, jsonb) to anon, authenticated, service_role;

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
         frame_photo = null, updated_at = now()
   where id = p_vantage_id and framed_at is not null;
  return jsonb_build_object('vantage_id', p_vantage_id, 'framing', null);
end $$;

-- trip_sun_plan: the live definition with 'photo' added to each pair's framing
do $$
declare d text;
begin
  d := pg_get_functiondef('public.trip_sun_plan(uuid)'::regprocedure);
  if position('''photo'', v.frame_photo' in d) = 0 then
    d := replace(d, '''orient'', v.frame_orient, ''at'', v.framed_at) end as framing',
                    '''orient'', v.frame_orient, ''at'', v.framed_at, ''photo'', v.frame_photo) end as framing');
    if position('''photo'', v.frame_photo' in d) = 0 then raise exception 'trip_sun_plan framing text not found'; end if;
    execute d;
  end if;
end $$;
