-- Terrain horizons outside the Faroes. The original DEM (dem_blocks,
-- dem_elevation) is a fixed Faroe grid, so every Teton profile came out
-- 'outside_dem' and the solver thought low sun reached the valley until true
-- sunset (the Teton Range hides it much earlier; the Gros Ventres hold back
-- sunrise). Region grids: elevation on a regular lat/lng step, loaded once per
-- area by the dem-region-load edge function from the public AWS terrarium
-- tiles (Mapzen/AWS Open Data: SRTM, USGS 3DEP and others; attribution:
-- "Terrain Tiles, AWS Open Data / Mapzen"). terrain_profile_compute uses the
-- Faroe DEM where it covers the point, else the finest region grid that does.

create table if not exists public.dem_regions (
  region text primary key,
  south double precision not null, north double precision not null,
  west double precision not null, east double precision not null,
  step double precision not null,        -- degrees, same in lat and lng
  nrows integer not null, ncols integer not null,
  source text not null,
  loaded_at timestamptz
);

-- Row r is latitude north - r*step; cells[c+1] is longitude west + c*step (metres).
create table if not exists public.dem_region_rows (
  region text not null references public.dem_regions(region) on delete cascade,
  r integer not null,
  cells smallint[] not null,
  primary key (region, r)
);

create or replace function public.dem_region_for(p_lat double precision, p_lng double precision)
returns public.dem_regions language sql stable set search_path = public as $$
  select * from dem_regions
   where p_lat between south and north and p_lng between west and east and loaded_at is not null
   order by step limit 1
$$;

create or replace function public.dem_region_elevation(p_lat double precision, p_lng double precision)
returns double precision language plpgsql stable set search_path = public as $$
declare g dem_regions; fr double precision; fc double precision; r0 int; c0 int; a smallint[]; b smallint[];
begin
  g := dem_region_for(p_lat, p_lng);
  if g.region is null then return null; end if;
  fr := (g.north - p_lat) / g.step; fc := (p_lng - g.west) / g.step;
  r0 := least(floor(fr)::int, g.nrows - 2); c0 := least(floor(fc)::int, g.ncols - 2);
  select cells into a from dem_region_rows where region = g.region and r = r0;
  select cells into b from dem_region_rows where region = g.region and r = r0 + 1;
  if a is null or b is null then return null; end if;
  return (a[c0 + 1] * (1 - (fc - c0)) + a[c0 + 2] * (fc - c0)) * (1 - (fr - r0))
       + (b[c0 + 1] * (1 - (fc - c0)) + b[c0 + 2] * (fc - c0)) * (fr - r0);
end $$;

create or replace function public.terrain_profile_compute(p_profile uuid)
returns void language plpgsql security definer set search_path = public as $function$
declare
  p      record;
  g      dem_regions;
  ground double precision;
  arr    double precision[];
begin
  select * into p from public.terrain_profiles where id = p_profile;
  if not found then return; end if;

  ground := public.dem_elevation(p.lat, p.lng);
  if ground is not null then
    -- Faroe DEM (unchanged).
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
  else
    g := public.dem_region_for(p.lat, p.lng);
    if g.region is null then
      update public.terrain_profiles
         set status = 'outside_dem', ground_m = null, samples = null, completed_at = now()
       where id = p_profile;
      return;
    end if;
    ground := public.dem_region_elevation(p.lat, p.lng);
    with dd as (select public.terrain_distances() as d),
    pts as (
      select a, k, (g.north - s.s_lat) / g.step as fr, (s.s_lng - g.west) / g.step as fc
      from dd
      cross join generate_series(0, 179) a
      cross join generate_series(0, array_length(dd.d, 1) - 1) k
      cross join lateral public.terrain_sample_coord(p.lat, p.lng, a * 2, dd.d[k + 1]) s
    ),
    cells as (
      select a, k, floor(fr)::int as r0, floor(fc)::int as c0, fr - floor(fr) as tr, fc - floor(fc) as tc
      from pts
    )
    -- Samples past the grid's edge count as 0 m (they lie beyond the 29 km reach anyway).
    select array_agg(
             case when c.r0 between 0 and g.nrows - 2 and c.c0 between 0 and g.ncols - 2 then
               (ra.cells[c.c0 + 1] * (1 - c.tc) + ra.cells[c.c0 + 2] * c.tc) * (1 - c.tr)
             + (rb.cells[c.c0 + 1] * (1 - c.tc) + rb.cells[c.c0 + 2] * c.tc) * c.tr
             else 0 end
             order by c.a, c.k)
      into arr
      from cells c
      left join public.dem_region_rows ra on ra.region = g.region and ra.r = c.r0
      left join public.dem_region_rows rb on rb.region = g.region and rb.r = c.r0 + 1;
  end if;

  update public.terrain_profiles
     set ground_m = ground, samples = arr, status = 'complete', completed_at = now()
   where id = p_profile;
end $function$;

-- Recompute every profile a newly loaded region now covers.
create or replace function public.dem_region_recompute(p_region text)
returns integer language plpgsql set search_path = public as $$
declare g dem_regions; r record; n int := 0;
begin
  select * into g from dem_regions where region = p_region;
  for r in select id from terrain_profiles
            where status in ('outside_dem', 'pending')
              and lat between g.south and g.north and lng between g.west and g.east loop
    perform terrain_profile_compute(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
