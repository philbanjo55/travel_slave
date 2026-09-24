-- Terrain from a local copy of the Copernicus GLO-30 DEM instead of
-- Open-Meteo's elevation API.
--
-- Open-Meteo meters each coordinate as roughly one API call. A skyline needs
-- thousands of points per pin, which would eat the free allowance the weather
-- pulls depend on. The Faroes DEM is instead loaded once into dem_blocks
-- (by the dem-load edge function) and every lookup is local: no API calls,
-- no rate limits, and a pin's profile is computed the moment it is saved.
--
-- Grid: the Faroes plus ~28 km of sea around them, at native resolution
-- (1 arcsec lat x 2 arcsec lng, ~30 m).
--   row r = 0..3959  ->  lat = 62.45 - r / 3600
--   col c = 0..2789  ->  lng = -7.75 + c / 1800
-- Stored as 31 blocks of 90 columns per row, metres rounded, sea = 0.
--
-- Sea stacks are narrower than the DEM resolves (Drangarnir reads as sea),
-- so scout_subjects.height_m remains the way to give a stack its height.

-- ── Retire the Open-Meteo queue ─────────────────────────────
drop function if exists public.refresh_terrain_step(integer);
drop table if exists public.terrain_probe;

-- ── DEM storage ─────────────────────────────────────────────
create table if not exists public.dem_blocks (
  r     smallint not null,
  b     smallint not null,
  cells smallint[] not null,
  primary key (r, b)
);
alter table public.dem_blocks enable row level security;

-- Nearest-cell elevation; null outside the grid.
create or replace function public.dem_cell(p_lat double precision, p_lng double precision)
returns double precision language sql stable as $$
  select d.cells[(c % 90) + 1]::double precision
  from (select round((62.45 - p_lat) * 3600)::int as r,
               round((p_lng + 7.75) * 1800)::int  as c) rc
  join public.dem_blocks d on d.r = rc.r and d.b = rc.c / 90
  where rc.r between 0 and 3959 and rc.c between 0 and 2789
$$;

-- Bilinear elevation for a single point (ground under a pin).
create or replace function public.dem_elevation(p_lat double precision, p_lng double precision)
returns double precision language plpgsql stable as $$
declare
  fr double precision := (62.45 - p_lat) * 3600;
  fc double precision := (p_lng + 7.75) * 1800;
  r0 integer := floor(fr);
  c0 integer := floor(fc);
  tr double precision := fr - floor(fr);
  tc double precision := fc - floor(fc);
  e00 double precision; e01 double precision; e10 double precision; e11 double precision;
begin
  if r0 < 0 or r0 >= 3959 or c0 < 0 or c0 >= 2789 then return null; end if;
  e00 := public.dem_cell(62.45 - r0 / 3600.0,       -7.75 + c0 / 1800.0);
  e01 := public.dem_cell(62.45 - r0 / 3600.0,       -7.75 + (c0 + 1) / 1800.0);
  e10 := public.dem_cell(62.45 - (r0 + 1) / 3600.0, -7.75 + c0 / 1800.0);
  e11 := public.dem_cell(62.45 - (r0 + 1) / 3600.0, -7.75 + (c0 + 1) / 1800.0);
  return (e00 * (1 - tc) + e01 * tc) * (1 - tr) + (e10 * (1 - tc) + e11 * tc) * tr;
end $$;

-- ── Profiles: 180 azimuths (every 2 deg) x 142 distances ────
-- Distances grow 5 % per step from 30 m to ~29 km, so nearby cliffs are
-- sampled every few metres and distant ridges every kilometre or so.
create or replace function public.terrain_distances()
returns double precision[] language sql immutable as $$
  select array_agg(30 * power(1.05, k) order by k)::double precision[]
  from generate_series(0, 141) k
$$;

create or replace function public.terrain_sample_coord(
  p_lat double precision, p_lng double precision,
  p_az_deg double precision, p_dist_m double precision,
  out s_lat double precision, out s_lng double precision)
language plpgsql immutable as $$
declare
  th    double precision := radians(p_az_deg);
  delta double precision := p_dist_m / 6371008.8;
  phi1  double precision := radians(p_lat);
  phi2  double precision;
begin
  phi2  := asin(sin(phi1) * cos(delta) + cos(phi1) * sin(delta) * cos(th));
  s_lat := degrees(phi2);
  s_lng := p_lng + degrees(atan2(sin(th) * sin(delta) * cos(phi1),
                                 cos(delta) - sin(phi1) * sin(phi2)));
end $$;
drop function if exists public.terrain_sample_coord(double precision, double precision, integer);

alter table public.terrain_profiles
  drop column if exists failures,
  alter column samples drop default,
  alter column samples drop not null;
alter table public.terrain_profiles drop constraint if exists terrain_profiles_status_check;
alter table public.terrain_profiles
  add constraint terrain_profiles_status_check
  check (status in ('pending', 'complete', 'outside_dem'));
alter table public.terrain_profiles alter column status set default 'pending';

-- Fill one profile from the local DEM. Samples are azimuth-major:
-- index a * 142 + k + 1 for azimuth a * 2 deg, distance k.
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

  select array_agg(coalesce(public.dem_cell(s.s_lat, s.s_lng), 0) order by a, k)
    into arr
    from generate_series(0, 179) a
    cross join generate_series(0, 141) k
    cross join lateral public.terrain_sample_coord(
      p.lat, p.lng, a * 2, (public.terrain_distances())[k + 1]) s;

  update public.terrain_profiles
     set ground_m = ground, samples = arr, status = 'complete', completed_at = now()
   where id = p_profile;
end $$;

-- Skyline from an observer at p_observer_m: 180 angles (deg above the flat
-- horizon), index a + 1 = azimuth a * 2. Earth curvature and standard
-- refraction (k = 0.13) are applied. Null unless the profile is complete.
create or replace function public.terrain_horizon(p_profile uuid, p_observer_m double precision)
returns double precision[] language sql stable as $$
  select array_agg(h order by a) from (
    select a, max(degrees(atan2(
             p.samples[a * 142 + k + 1] - p_observer_m
               - (dd.d[k + 1] ^ 2) / (2 * 6371008.8) * (1 - 0.13),
             dd.d[k + 1]))) as h
    from public.terrain_profiles p
    cross join (select public.terrain_distances() as d) dd
    cross join generate_series(0, 179) a
    cross join generate_series(0, 141) k
    where p.id = p_profile and p.status = 'complete'
    group by a) x
$$;

create or replace function public.horizon_at(h double precision[], az double precision)
returns double precision language sql immutable as $$
  select case when h is null then null else
    h[(floor(az / 2)::int % 180) + 1] * (1 - (az / 2 - floor(az / 2)))
    + h[((floor(az / 2)::int + 1) % 180) + 1] * (az / 2 - floor(az / 2)) end
$$;

-- Pins get their profile computed synchronously on save.
create or replace function public.scout_attach_terrain()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rl  double precision;
  rg  double precision;
  pid uuid;
  st  text;
begin
  if new.lat is null or new.lng is null then
    new.terrain_profile_id := null;
    return new;
  end if;
  rl := round(new.lat::numeric, 6);
  rg := round(new.lng::numeric, 6);
  insert into public.terrain_profiles (lat, lng) values (rl, rg)
    on conflict (lat, lng) do nothing;
  select id, status into pid, st from public.terrain_profiles where lat = rl and lng = rg;
  if st = 'pending' then
    perform public.terrain_profile_compute(pid);
  end if;
  new.terrain_profile_id := pid;
  return new;
end $$;

-- Recompute every profile, e.g. after (re)loading the DEM.
create or replace function public.terrain_recompute_all()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.terrain_profiles loop
    perform public.terrain_profile_compute(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.terrain_profile_compute(uuid) from public, anon, authenticated;
revoke execute on function public.terrain_recompute_all() from public, anon, authenticated;
revoke execute on function public.scout_attach_terrain() from public, anon, authenticated;
