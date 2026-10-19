-- Sun & Moon planner for the phone app. Additive only: one new table, one new
-- read-only function, and TOP LIGHT added to vantage_light. Nothing the
-- weather pull, the edge functions or the existing app reads is changed.
--
-- Undo:
--   drop function if exists public.trip_sun_plan(uuid);
--   drop table if exists public.stop_sun_pairs;
--   (and re-apply 20260925000000_sun_up_threshold_and_no_direction.sql for vantage_light)

-- Which vantage -> subject pairs show on which stop. A scout_vantages row is
-- already one vantage aimed at one subject, so a pair is just a vantage id.
create table if not exists public.stop_sun_pairs (
  stop_id    uuid not null references public.stops(id) on delete cascade,
  vantage_id uuid not null references public.scout_vantages(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (stop_id, vantage_id)
);
create index if not exists stop_sun_pairs_vantage_idx on public.stop_sun_pairs (vantage_id);

-- Private like the scout tables: no policies, so the anon key cannot read or
-- write it directly. The app reads it only through trip_sun_plan below.
alter table public.stop_sun_pairs enable row level security;

-- Everything the app needs to draw the planner offline, for one trip: per
-- stop, the time zone offset on that day and each pair's pins, direction,
-- distance and both terrain skylines (180 values, 2-degree steps from north).
-- Sun and moon positions are computed on the phone from these, so the result
-- is small, changes only when pins change, and works with no signal.
create or replace function public.trip_sun_plan(p_trip_id uuid)
returns jsonb
language sql
stable
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
      left join public.terrain_profiles pv on pv.id = v.terrain_profile_id and pv.status = 'complete'
      left join public.terrain_profiles ps on ps.id = s.terrain_profile_id and ps.status = 'complete'
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
                         from unnest(public.terrain_horizon(pr.vp_id, pr.v_obs)) with ordinality u(h, i)),
             's_sky', (select jsonb_agg(round(h::numeric, 2) order by i)
                         from unnest(public.terrain_horizon(pr.sp_id, pr.s_obs)) with ordinality u(h, i))
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

-- TOP LIGHT: with the sun 35 degrees or more above the horizon the light
-- comes from above whatever its compass direction, so front/side/backlit
-- stop meaning much. Same rule the app uses.
create or replace function public.vantage_light(p_vantage uuid, p_date date, p_step_min integer DEFAULT 5, p_tz text DEFAULT 'Atlantic/Faroe'::text)
 returns table(local_time timestamp without time zone, sun_azimuth numeric, sun_altitude numeric, sun_vs_facing_deg numeric, light text, phase text, sun_visible_from_vantage boolean, sun_on_subject boolean)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  sun_up constant double precision := -0.436;
  top_light constant double precision := 35;
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
              when sp.altitude >= top_light then 'top'
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
end $function$;
