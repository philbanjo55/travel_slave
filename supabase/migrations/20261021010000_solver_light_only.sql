-- LIGHT-ONLY SCORES: trip days past the forecast (or before the trip).
-- The light terms of solver_build_scores move into two functions so both
-- paths score light the same way. Weather is unknown, so instead of 51 ECMWF
-- members the light-only score uses 51 made-up sun-visibility scenarios,
-- s_k = (k/50)^2 for k = 0..50 (mean 0.34: mostly cloudy, as a Faroese May
-- usually is). Rain, wind and fog are left out; fog-wanted stops get the
-- no-fog factor (0.6), waterfalls no rain bonus. Computed on the fly from
-- solver_light_cache, nothing stored per night.

-- Directional light on the starred shot, 0..1 (see solver_build_scores).
create or replace function public.solver_light_dir(p_light text, p_alt real, p_sun_visible boolean, p_lw text[])
returns real language sql immutable set search_path to 'public' as $$
  select (case
    when p_light in ('front', 'side', 'backlit') then
      (case when p_alt < 6 then 1.0 when p_alt < 12 then 0.85 when p_alt < 20 then 0.65 else 0.45 end)
      * (case when (case p_light when 'backlit' then 'back' else p_light end) = any(p_lw) then 1.0
              when p_lw && '{front,side,back}' then 0.35 else 0.6 end)
      * (case when p_light = 'backlit' and p_sun_visible is false then 0.6 else 1.0 end)
    when p_light = 'no direction' then 0.6
    when p_light = 'top' then 0.25
    when p_light = 'in shadow' then 0.3
    else case when 'soft' = any(coalesce(p_lw, '{}')) then 0.4 else 0.3 end  -- blue hour
  end)::real
$$;

-- Overcast (soft) light, 0..1: good only where light_wanted has 'soft'.
create or replace function public.solver_light_soft(p_alt real, p_lw text[])
returns real language sql immutable set search_path to 'public' as $$
  select (case when p_alt >= 0 then (case when 'soft' = any(coalesce(p_lw, '{}')) then 0.75 else 0.3 end)
               else (case when 'soft' = any(coalesce(p_lw, '{}')) then 0.4 else 0.15 end) end)::real
$$;

-- The trip's timezone, as solver_build_scores picks it.
create or replace function public.solver_trip_tz(p_trip_id uuid)
returns text language sql stable set search_path to 'public' as $$
  select coalesce(
           (select n.name from pg_timezone_names n where n.name = t.timezone),
           (select n.name from pg_timezone_names n where n.name = (
              select f.raw->'provenance'->>'timezone' from weather_forecasts f join stops s on s.id = f.stop_id
               where s.trip_id = t.id and f.raw->'provenance'->>'timezone' is not null
               order by f.fetched_at desc limit 1)),
           'UTC')
    from trips t where t.id = p_trip_id
$$;

-- Fill the light cache for the trip's starred shots on the given dates (all
-- trip days by default), stopping after p_max_seconds; ~0.17 s per shot-day.
-- Nightly after the score build, so new trip days and new stars fill in.
create or replace function public.solver_fill_light_cache(p_trip_id uuid, p_dates date[] default null,
                                                          p_max_seconds integer default 60)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  t0 timestamptz := clock_timestamp();
  v_tz text := solver_trip_tz(p_trip_id);
  r record;
  n integer := 0;
  left_over integer := 0;
begin
  for r in
    select distinct i.star_vantage_id v, d
      from solver_stop_inputs i
      cross join unnest(coalesce(p_dates, (select array_agg(date) from days where trip_id = p_trip_id))) d
     where i.trip_id = p_trip_id and i.tier is not null and i.star_vantage_id is not null
       and not exists (select 1 from solver_light_cache c where c.vantage_id = i.star_vantage_id and c.local_date = d)
     order by d
  loop
    if clock_timestamp() - t0 > make_interval(secs => p_max_seconds) then
      left_over := left_over + 1;
      continue;
    end if;
    insert into solver_light_cache (vantage_id, slot_at, local_date, sun_alt, light, sun_visible)
    select r.v, l.local_time at time zone v_tz, r.d, l.sun_altitude, l.light, l.sun_visible_from_vantage
      from vantage_light(r.v, r.d, 15, v_tz) l
    on conflict do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('filled', n, 'left', left_over,
                            'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $$;
revoke execute on function public.solver_fill_light_cache(uuid, date[], integer) from public, anon, authenticated;

-- Light-only V per starred shot, 15-min slot and scenario, x250, in the same
-- shape as solver_scores rows. Dates whose light is not cached return nothing.
create or replace function public.solver_light_scores(p_trip_id uuid, p_dates date[])
returns table (stop_id uuid, slot_at timestamptz, v smallint[])
language sql stable set search_path to 'public' as $$
  with st as (
    select i.stop_id, i.star_vantage_id, coalesce(i.light_wanted, '{front,side}') lw, i.fog_wanted
      from solver_stop_inputs i
     where i.trip_id = p_trip_id and i.tier is not null and i.star_vantage_id is not null
  ), sl as (
    select st.stop_id, c.slot_at, c.light = 'no sun' as blue, st.fog_wanted,
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) as dir,
           solver_light_soft(c.sun_alt, st.lw) as soft
      from st join solver_light_cache c
        on c.vantage_id = st.star_vantage_id and c.local_date = any(p_dates) and c.sun_alt > -6
  )
  select sl.stop_id, sl.slot_at,
         array(select round(250 * greatest(0, least(1,
                  (case when sl.blue then sl.dir else s * sl.dir + (1 - s) * sl.soft end)
                  * (case when sl.fog_wanted then 0.6 else 1 end))))::smallint
                 from generate_series(0, 50) k cross join lateral (select (k / 50.0) ^ 2 as s) q
                order by k)
    from sl
$$;
revoke execute on function public.solver_light_scores(uuid, date[]) from public, anon, authenticated;

-- Nightly: build, prune, then top up the light cache for every trip day.
create or replace function public.solver_nightly(p_trip_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $$
declare r jsonb;
begin
  r := solver_build_scores(p_trip_id);
  return r || jsonb_build_object('pruned', solver_prune_builds(p_trip_id),
                                 'light_cache', solver_fill_light_cache(p_trip_id, null, 60));
end $$;
revoke execute on function public.solver_nightly(uuid) from public, anon, authenticated;

-- The light terms per starred shot and slot, before the scenarios: what
-- solver-plan reads (it expands the 51 scenarios itself, as
-- solver_light_scores does, because array building in SQL took 3.5 s a day).
create or replace function public.solver_light_terms(p_trip_id uuid, p_dates date[])
returns table (stop_id uuid, slot_at timestamptz, dir real, soft real, blue boolean, fog_wanted boolean)
language sql stable set search_path to 'public' as $$
  select i.stop_id, c.slot_at,
         solver_light_dir(c.light, c.sun_alt, c.sun_visible, coalesce(i.light_wanted, '{front,side}')),
         solver_light_soft(c.sun_alt, coalesce(i.light_wanted, '{front,side}')),
         c.light = 'no sun', i.fog_wanted
    from solver_stop_inputs i
    join solver_light_cache c
      on c.vantage_id = i.star_vantage_id and c.local_date = any(p_dates) and c.sun_alt > -6
   where i.trip_id = p_trip_id and i.tier is not null and i.star_vantage_id is not null
$$;
revoke execute on function public.solver_light_terms(uuid, date[]) from public, anon, authenticated;
