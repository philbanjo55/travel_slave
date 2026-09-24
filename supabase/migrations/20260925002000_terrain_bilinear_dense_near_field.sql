-- Terrain skyline accuracy fix, found by testing 20 random vantage/subject
-- pairs against an independent 5 m-step ray march on the original float
-- Copernicus tiles.
--
-- Profiles sampled the nearest DEM cell. Close to the observer that snaps a
-- sample 30 m out to a cell that may really be ~50 m away (or 10 m), so on a
-- slope the skyline angle was off by up to 22 deg and the sun read as hidden
-- when it was not. Now:
--   * bilinear interpolation of the four surrounding cells, and
--   * distances every 10 m out to 290 m, then +3 % per step to 30 km
--     (185 per ray; was 30 m, +5 %, 142 per ray).
-- Against the reference: median error 0.05 deg, 95th pct 0.4, 99th 1.4,
-- worst 2.1 deg (was 22). Azimuth spacing stays at 2 deg (1 deg measured no
-- better).

create or replace function public.terrain_distances()
returns double precision[] language sql immutable set search_path = public as $$
  select array_agg(d order by d)::double precision[] from (
    select (10 * k)::double precision as d from generate_series(1, 29) k
    union all
    select 300 * power(1.03, k) from generate_series(0, 155) k) x
$$;

create or replace function public.terrain_profile_compute(p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p      record;
  ground double precision;
  arr    double precision[];
begin
  select * into p from public.terrain_profiles where id = p_profile;
  if not found then return; end if;

  ground := public.dem_elevation(p.lat, p.lng);
  if ground is null then
    update public.terrain_profiles
       set status = 'outside_dem', ground_m = null, samples = null, completed_at = now()
     where id = p_profile;
    return;
  end if;

  with dd as (select public.terrain_distances() as d),
  pts as (
    select a, k,
           (62.45 - s.s_lat) * 3600 as fr,
           (s.s_lng + 7.75) * 1800  as fc
    from dd
    cross join generate_series(0, 179) a
    cross join generate_series(0, array_length(dd.d, 1) - 1) k
    cross join lateral public.terrain_sample_coord(p.lat, p.lng, a * 2, dd.d[k + 1]) s
  ),
  cells as (
    select a, k, floor(fr)::int as r0, floor(fc)::int as c0,
           fr - floor(fr) as tr, fc - floor(fc) as tc
    from pts
  )
  select array_agg(
           case when c.r0 between 0 and 3958 and c.c0 between 0 and 2788 then
             (b00.cells[(c.c0 % 90) + 1] * (1 - c.tc) + b01.cells[((c.c0 + 1) % 90) + 1] * c.tc) * (1 - c.tr)
           + (b10.cells[(c.c0 % 90) + 1] * (1 - c.tc) + b11.cells[((c.c0 + 1) % 90) + 1] * c.tc) * c.tr
           else 0 end
           order by c.a, c.k)
    into arr
    from cells c
    left join public.dem_blocks b00 on b00.r = c.r0     and b00.b = c.c0 / 90
    left join public.dem_blocks b01 on b01.r = c.r0     and b01.b = (c.c0 + 1) / 90
    left join public.dem_blocks b10 on b10.r = c.r0 + 1 and b10.b = c.c0 / 90
    left join public.dem_blocks b11 on b11.r = c.r0 + 1 and b11.b = (c.c0 + 1) / 90;

  update public.terrain_profiles
     set ground_m = ground, samples = arr, status = 'complete', completed_at = now()
   where id = p_profile;
end $$;
revoke execute on function public.terrain_profile_compute(uuid) from public, anon, authenticated;

create or replace function public.terrain_horizon(p_profile uuid, p_observer_m double precision)
returns double precision[] language sql stable set search_path = public as $$
  select array_agg(h order by a) from (
    select (u.i - 1) / n as a,
           max(degrees(atan2(
             u.v - p_observer_m
               - (dd.d[((u.i - 1) % n) + 1] ^ 2) / (2 * 6371008.8) * (1 - 0.13),
             dd.d[((u.i - 1) % n) + 1]))) as h
    from public.terrain_profiles p
    cross join (select public.terrain_distances() as d,
                       array_length(public.terrain_distances(), 1) as n) dd
    cross join lateral unnest(p.samples) with ordinality as u(v, i)
    where p.id = p_profile and p.status = 'complete'
    group by 1) x
$$;

-- Existing profiles must be recomputed: select public.terrain_recompute_all();
