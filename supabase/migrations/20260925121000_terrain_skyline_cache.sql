-- Skylines cost ~0.2 s each to compute from the DEM, and trip_sun_plan needs
-- two per pair: a trip's worth would run past the API's statement timeout.
-- They only change when a pin moves, so compute each once and keep it.
--
-- Keyed by terrain profile and observer height, the two inputs; a moved pin
-- gets a new profile or height and so a new entry, never a stale one.
-- Warmed when a pair is linked to a stop, so the app's call never pays for it.
--
-- Undo: re-apply 20260925120000 (trip_sun_plan without the cache), then
--   drop trigger if exists stop_sun_pairs_warm on public.stop_sun_pairs;
--   drop function if exists public.stop_sun_pairs_warm();
--   drop function if exists public.skyline_cached(uuid, double precision);
--   drop table if exists public.terrain_skyline_cache;

create table if not exists public.terrain_skyline_cache (
  profile_id  uuid not null references public.terrain_profiles(id) on delete cascade,
  observer_m  double precision not null,
  sky         double precision[] not null,
  computed_at timestamptz not null default now(),
  primary key (profile_id, observer_m)
);
alter table public.terrain_skyline_cache enable row level security;

create or replace function public.skyline_cached(p_profile uuid, p_observer_m double precision)
returns double precision[]
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  h double precision[];
begin
  if p_profile is null or p_observer_m is null then return null; end if;
  select c.sky into h from public.terrain_skyline_cache c
   where c.profile_id = p_profile and c.observer_m = p_observer_m;
  if found then return h; end if;
  if not exists (select 1 from public.terrain_profiles where id = p_profile and status = 'complete') then
    return null;
  end if;
  h := public.terrain_horizon(p_profile, p_observer_m);
  if h is not null then
    insert into public.terrain_skyline_cache (profile_id, observer_m, sky)
    values (p_profile, p_observer_m, h)
    on conflict (profile_id, observer_m) do nothing;
  end if;
  return h;
end $$;
revoke all on function public.skyline_cached(uuid, double precision) from public, anon, authenticated;

-- Observer heights exactly as vantage_light and trip_sun_plan use them.
create or replace function public.stop_sun_pairs_warm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.skyline_cached(v.terrain_profile_id, coalesce(v.elevation_m, pv.ground_m, 0) + 1.6),
          public.skyline_cached(s.terrain_profile_id, coalesce(s.height_m, ps.ground_m, 0) + 2)
     from public.scout_vantages v
     join public.scout_subjects s on s.id = v.subject_id
     left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
     left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
    where v.id = new.vantage_id;
  return new;
end $$;

drop trigger if exists stop_sun_pairs_warm on public.stop_sun_pairs;
create trigger stop_sun_pairs_warm after insert or update of vantage_id on public.stop_sun_pairs
  for each row execute function public.stop_sun_pairs_warm();

-- Same output as before; skylines now come from the cache. Volatile because a
-- cache miss writes (the app calls it with POST, which allows that).
create or replace function public.trip_sun_plan(p_trip_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path to 'public'
as $$
  with pairs as (
    select p.stop_id, p.position, st.day_id,
           v.id as vantage_id, v.code, v.name as vantage_name,
           v.lat as vlat, v.lng as vlng,
           s.id as subject_id, s.name as subject_name, s.lat as slat, s.lng as slng,
           coalesce(v.elevation_m, pv.ground_m, 0) + 1.6 as v_obs,
           coalesce(s.height_m, ps.ground_m, 0) + 2     as s_obs,
           v.terrain_profile_id as vp_id, s.terrain_profile_id as sp_id
      from public.stop_sun_pairs p
      join public.stops st on st.id = p.stop_id and st.trip_id = p_trip_id
      join public.scout_vantages v on v.id = p.vantage_id
      join public.scout_subjects s on s.id = v.subject_id
      left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
      left join public.terrain_profiles ps on ps.id = s.terrain_profile_id
     where v.lat is not null and v.lng is not null and s.lat is not null and s.lng is not null
  ),
  stop_meta as (
    -- The stop's time zone comes from its newest forecast (Open-Meteo
    -- timezone=auto), falling back to UTC; the offset is taken at local noon
    -- on the stop's day, so summer time is right for that date.
    select x.stop_id, x.date, x.tz,
           round((extract(epoch from ((x.date + time '12:00') at time zone 'UTC'))
                - extract(epoch from ((x.date + time '12:00') at time zone x.tz))) / 60)::int as utc_offset_min
      from (
        select distinct on (pr.stop_id) pr.stop_id, d.date,
               coalesce((select n.name from pg_timezone_names n where n.name = wf.tz), 'UTC') as tz
          from pairs pr
          join public.days d on d.id = pr.day_id
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
                         from unnest(public.skyline_cached(pr.sp_id, pr.s_obs)) with ordinality u(h, i))
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
$$;

revoke all on function public.trip_sun_plan(uuid) from public;
grant execute on function public.trip_sun_plan(uuid) to anon, authenticated;

-- Warm the cache for pairs linked before this trigger existed.
select public.skyline_cached(v.terrain_profile_id, coalesce(v.elevation_m, pv.ground_m, 0) + 1.6),
       public.skyline_cached(s.terrain_profile_id, coalesce(s.height_m, ps.ground_m, 0) + 2)
  from public.stop_sun_pairs p
  join public.scout_vantages v on v.id = p.vantage_id
  join public.scout_subjects s on s.id = v.subject_id
  left join public.terrain_profiles pv on pv.id = v.terrain_profile_id
  left join public.terrain_profiles ps on ps.id = s.terrain_profile_id;
