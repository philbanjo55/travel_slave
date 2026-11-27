-- Each vantage can have one reference photo: one of the trip's stop photos.
-- The photo stays a normal stop photo (upload, delete and ordering unchanged);
-- deleting it clears the link. trip_sun_plan carries the photo's id and URL so
-- the app downloads it with the rest of the planner data and shows it offline.

alter table public.scout_vantages
  add column if not exists photo_id uuid references public.stop_photos(id) on delete set null;

create index if not exists scout_vantages_photo_id_idx on public.scout_vantages(photo_id);

-- The editor's per-pair check now includes the photo.
create or replace function public.sun_pair_check(p_vantage_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'vantage_id', v.id, 'code', v.code, 'vantage_name', v.name,
    'v_lat', v.lat, 'v_lng', v.lng, 'v_ground_m', round(pv.ground_m::numeric, 1), 'v_status', pv.status,
    'subject_id', s.id, 'subject_name', s.name,
    's_lat', s.lat, 's_lng', s.lng, 's_height_m', s.height_m, 's_ground_m', round(ps.ground_m::numeric, 1), 's_status', ps.status,
    'photo_id', ph.id, 'photo_url', ph.storage_url,
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
  left join public.stop_photos ph on ph.id = v.photo_id
  cross join lateral (select public.geo_distance_m(v.lat, v.lng, s.lat, s.lng) as m) d
  where v.id = p_vantage_id;
$function$;

-- Set or clear (p_photo_id null) a vantage's reference photo.
create or replace function public.sun_vantage_set_photo(p_vantage_id uuid, p_photo_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.scout_vantages where id = p_vantage_id) then
    raise exception 'Vantage not found';
  end if;
  if p_photo_id is not null and not exists (select 1 from public.stop_photos where id = p_photo_id) then
    raise exception 'Photo not found';
  end if;
  update public.scout_vantages set photo_id = p_photo_id where id = p_vantage_id;
  return public.sun_pair_check(p_vantage_id);
end $function$;

revoke all on function public.sun_vantage_set_photo(uuid, uuid) from public;
grant execute on function public.sun_vantage_set_photo(uuid, uuid) to anon, authenticated;

-- The planner download: each pair gains photo_id and photo_url.
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
           ph.id as photo_id, ph.storage_url as photo_url
      from public.stop_sun_pairs p
      join public.stops st on st.id = p.stop_id and st.trip_id = p_trip_id
      join public.scout_vantages v on v.id = p.vantage_id
      join public.scout_subjects s on s.id = v.subject_id
      left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
      left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
      left join public.stop_photos ph on ph.id = v.photo_id
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
             'photo_id', pr.photo_id, 'photo_url', pr.photo_url
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
