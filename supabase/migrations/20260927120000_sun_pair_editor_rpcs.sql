-- Let the phone app add, edit and remove a stop's vantage -> subject pairs.
--
-- The scout tables stay private (RLS on, no policies); the app writes only
-- through these three functions, which validate their input and touch only
-- what they need. Terrain follows automatically: saving coordinates fires
-- scout_attach_terrain (profile) and scout_warm_skyline (skyline).
--
--   sun_stop_pairs(stop)                      the stop's pairs, each with checks
--   sun_pair_save(stop, vantage_id|null, ...) add a pair, or edit one on this stop
--   sun_pair_remove(stop, vantage_id)         unlink a pair from this stop
--
-- Removing only unlinks: the vantage and subject stay in the scout tables.
--
-- Undo:
--   drop function if exists public.sun_pair_remove(uuid, uuid);
--   drop function if exists public.sun_pair_save(uuid, uuid, text, text, double precision, double precision, text, double precision, double precision, double precision);
--   drop function if exists public.sun_stop_pairs(uuid);
--   drop function if exists public.sun_pair_check(uuid);

-- One pair as the editor shows it, with the checks worth knowing before a trip.
create or replace function public.sun_pair_check(p_vantage_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'vantage_id', v.id, 'code', v.code, 'vantage_name', v.name,
    'v_lat', v.lat, 'v_lng', v.lng, 'v_ground_m', round(pv.ground_m::numeric, 1), 'v_status', pv.status,
    'subject_id', s.id, 'subject_name', s.name,
    's_lat', s.lat, 's_lng', s.lng, 's_height_m', s.height_m, 's_ground_m', round(ps.ground_m::numeric, 1), 's_status', ps.status,
    'bearing', case when d.m >= 20 then round(public.geo_bearing(v.lat, v.lng, s.lat, s.lng)::numeric, 1) end,
    'dist_m', round(d.m::numeric),
    'warnings', to_jsonb(array_remove(array[
      case when pv.status = 'outside_dem' or ps.status = 'outside_dem'
           then 'No terrain data here, so SHADE cannot be worked out.' end,
      case when pv.status = 'complete' and pv.ground_m < 2
           then 'Where you stand is at sea level in the elevation data. If it is a clifftop or viewpoint, the pin is probably past the edge.' end,
      case when d.m < 20 then 'The two pins are almost on top of each other, so there is no direction to measure.' end,
      case when d.m > 60000 then 'The subject is more than 60 km away. Check the coordinates.' end
    ], null))
  )
  from public.scout_vantages v
  join public.scout_subjects s on s.id = v.subject_id
  left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
  left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
  cross join lateral (select public.geo_distance_m(v.lat, v.lng, s.lat, s.lng) as m) d
  where v.id = p_vantage_id;
$$;

create or replace function public.sun_stop_pairs(p_stop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(public.sun_pair_check(p.vantage_id) order by p.position, p.created_at), '[]'::jsonb)
    from public.stop_sun_pairs p where p.stop_id = p_stop_id;
$$;

create or replace function public.sun_pair_save(
  p_stop_id uuid,
  p_vantage_id uuid,            -- null to add; an id already on this stop to edit
  p_code text,                  -- optional short label, e.g. 'A1'
  p_vantage_name text,
  p_v_lat double precision, p_v_lng double precision,
  p_subject_name text,
  p_s_lat double precision, p_s_lng double precision,
  p_s_height double precision   -- optional, metres above sea level
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_trip uuid;
  v_subject uuid;
  v_vantage uuid := p_vantage_id;
  v_name text := nullif(btrim(p_vantage_name), '');
  s_name text := nullif(btrim(p_subject_name), '');
  v_code text := nullif(btrim(p_code), '');
begin
  select trip_id into v_trip from public.stops where id = p_stop_id;
  if v_trip is null then raise exception 'Stop not found'; end if;
  if v_name is null or s_name is null then raise exception 'Both names are needed'; end if;
  if length(v_name) > 120 or length(s_name) > 120 or length(coalesce(v_code, '')) > 12 then raise exception 'A name is too long'; end if;
  if p_v_lat is null or p_v_lng is null or p_s_lat is null or p_s_lng is null
     or abs(p_v_lat) > 90 or abs(p_s_lat) > 90 or abs(p_v_lng) > 180 or abs(p_s_lng) > 180 then
    raise exception 'Coordinates are missing or out of range';
  end if;
  if p_s_height is not null and (p_s_height < 0 or p_s_height > 3000) then raise exception 'Height must be 0 to 3000 m'; end if;

  if v_vantage is not null then
    -- Edit a pair already on this stop, in place. The subject may be shared
    -- with other vantages (one subject, several places to stand), so moving
    -- it moves it for all of them, which is what a correction should do.
    if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = v_vantage) then
      raise exception 'That pair is not on this stop';
    end if;
    select subject_id into v_subject from public.scout_vantages where id = v_vantage;
    update public.scout_subjects
       set name = s_name, lat = p_s_lat, lng = p_s_lng, height_m = p_s_height, updated_at = now()
     where id = v_subject;
    update public.scout_vantages
       set name = v_name, code = v_code, lat = p_v_lat, lng = p_v_lng, updated_at = now()
     where id = v_vantage;
  else
    -- Add: reuse the trip's subject of the same name, and that subject's
    -- vantage of the same name, rather than making duplicates.
    select id into v_subject from public.scout_subjects
     where trip_id = v_trip and lower(name) = lower(s_name) order by created_at limit 1;
    if v_subject is null then
      insert into public.scout_subjects (trip_id, name, lat, lng, height_m)
      values (v_trip, s_name, p_s_lat, p_s_lng, p_s_height) returning id into v_subject;
    else
      update public.scout_subjects
         set lat = p_s_lat, lng = p_s_lng, height_m = coalesce(p_s_height, height_m), updated_at = now()
       where id = v_subject;
    end if;

    select id into v_vantage from public.scout_vantages
     where subject_id = v_subject and lower(name) = lower(v_name) order by created_at limit 1;
    if v_vantage is null then
      insert into public.scout_vantages (subject_id, code, name, lat, lng)
      values (v_subject, v_code, v_name, p_v_lat, p_v_lng) returning id into v_vantage;
    else
      update public.scout_vantages
         set code = coalesce(v_code, public.scout_vantages.code), lat = p_v_lat, lng = p_v_lng, updated_at = now()
       where id = v_vantage;
    end if;

    insert into public.stop_sun_pairs (stop_id, vantage_id, position)
    values (p_stop_id, v_vantage,
            coalesce((select max(position) + 1 from public.stop_sun_pairs where stop_id = p_stop_id), 0))
    on conflict (stop_id, vantage_id) do nothing;
  end if;

  return public.sun_pair_check(v_vantage);
end $$;

create or replace function public.sun_pair_remove(p_stop_id uuid, p_vantage_id uuid)
returns void
language sql
volatile
security definer
set search_path to 'public'
as $$
  delete from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id;
$$;

revoke all on function public.sun_pair_check(uuid) from public, anon, authenticated;
revoke all on function public.sun_stop_pairs(uuid) from public;
revoke all on function public.sun_pair_save(uuid, uuid, text, text, double precision, double precision, text, double precision, double precision, double precision) from public;
revoke all on function public.sun_pair_remove(uuid, uuid) from public;
grant execute on function public.sun_stop_pairs(uuid) to anon, authenticated;
grant execute on function public.sun_pair_save(uuid, uuid, text, text, double precision, double precision, text, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.sun_pair_remove(uuid, uuid) to anon, authenticated;
