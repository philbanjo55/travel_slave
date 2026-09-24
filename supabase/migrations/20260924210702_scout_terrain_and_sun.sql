-- Terrain + sun geometry for scouting pins.
--
-- Give a vantage (where you stand) and its subject (what you shoot) a lat/lng
-- and the rest is automatic:
--   * bearing, compass facing, distance: computed live in scout_vantage_geometry
--   * ground elevation + terrain skyline for each point: fetched from
--     Open-Meteo's elevation API (Copernicus DEM, ~90 m) into terrain_profiles
--   * sun position and light type through the day: vantage_light(vantage, date)
--
-- Fetching is done by refresh_terrain_step(), which runs on a cron and at the
-- end of every weather-pull, so the app's weather refresh button drives it too.
--
-- The DEM is ~90 m. A sea stack or cliff-edge viewpoint is finer than that,
-- so manual heights win: scout_vantages.elevation_m (where you stand) and
-- scout_subjects.height_m (top of the subject) override the DEM when set.

-- ── Profiles ────────────────────────────────────────────────
-- One per distinct coordinate. samples[1] is the point itself; samples[2..]
-- are 120 azimuths (every 3 deg) x 20 distances (150 m .. 28 km), azimuth-major.
create table if not exists public.terrain_profiles (
  id           uuid primary key default gen_random_uuid(),
  lat          double precision not null,
  lng          double precision not null,
  ground_m     double precision,
  samples      double precision[] not null
               default array_fill(null::double precision, array[2401]),
  status       text not null default 'pending'
               check (status in ('pending', 'complete', 'error')),
  failures     integer not null default 0,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (lat, lng)
);
alter table public.terrain_profiles enable row level security;

-- In-flight elevation requests (pg_net is async; harvested on the next step).
create table if not exists public.terrain_probe (
  req_id       bigint primary key,
  profile_id   uuid not null references public.terrain_profiles(id) on delete cascade,
  first_idx    integer not null,
  n            integer not null,
  requested_at timestamptz not null default now()
);
alter table public.terrain_probe enable row level security;

alter table public.scout_vantages
  add column if not exists terrain_profile_id uuid
    references public.terrain_profiles(id) on delete set null;
alter table public.scout_subjects
  add column if not exists terrain_profile_id uuid
    references public.terrain_profiles(id) on delete set null,
  add column if not exists height_m double precision;

comment on column public.scout_vantages.elevation_m is
  'Manual standing elevation (m above sea level). Overrides the DEM when set.';
comment on column public.scout_subjects.height_m is
  'Manual top-of-subject elevation (m above sea level), e.g. a sea stack the 90 m DEM cannot resolve. Overrides the DEM when set.';

-- ── Geometry helpers ────────────────────────────────────────
create or replace function public.terrain_distances()
returns double precision[] language sql immutable as $$
  select array[150, 250, 400, 600, 850, 1150, 1500, 2000, 2600, 3300,
               4200, 5300, 6600, 8200, 10000, 12500, 15500, 19000, 23000, 28000
         ]::double precision[]
$$;

create or replace function public.geo_bearing(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case when lat1 is null or lat2 is null then null else
    (degrees(atan2(
       sin(radians(lng2 - lng1)) * cos(radians(lat2)),
       cos(radians(lat1)) * sin(radians(lat2))
         - sin(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2 - lng1))))
     + 360)::numeric % 360 end::double precision
$$;

create or replace function public.geo_distance_m(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371008.8 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2))
$$;

create or replace function public.compass_point(deg double precision)
returns text language sql immutable as $$
  select (array['N','NNE','NE','ENE','E','ESE','SE','SSE',
                'S','SSW','SW','WSW','W','WNW','NW','NNW'])
         [floor(((deg + 11.25)::numeric % 360) / 22.5)::int + 1]
$$;

-- Coordinates of sample p_idx in a profile around (p_lat, p_lng).
create or replace function public.terrain_sample_coord(
  p_lat double precision, p_lng double precision, p_idx integer,
  out s_lat double precision, out s_lng double precision)
language plpgsql immutable as $$
declare
  j     integer;
  th    double precision;
  delta double precision;
  phi1  double precision := radians(p_lat);
  phi2  double precision;
begin
  if p_idx = 1 then s_lat := p_lat; s_lng := p_lng; return; end if;
  j     := p_idx - 2;
  th    := radians((j / 20) * 3);
  delta := (public.terrain_distances())[(j % 20) + 1] / 6371008.8;
  phi2  := asin(sin(phi1) * cos(delta) + cos(phi1) * sin(delta) * cos(th));
  s_lat := degrees(phi2);
  s_lng := p_lng + degrees(atan2(sin(th) * sin(delta) * cos(phi1),
                                 cos(delta) - sin(phi1) * sin(phi2)));
end $$;

-- Skyline seen from an observer at p_observer_m: 120 angles (deg above the
-- flat horizon), index a+1 = azimuth a*3. Earth curvature and standard
-- refraction (k = 0.13) are applied. Null until the profile is complete.
create or replace function public.terrain_horizon(p_profile uuid, p_observer_m double precision)
returns double precision[] language sql stable as $$
  select array_agg(h order by a) from (
    select a, max(degrees(atan2(
             p.samples[2 + a * 20 + k] - p_observer_m
               - (d * d) / (2 * 6371008.8) * (1 - 0.13),
             d))) as h
    from public.terrain_profiles p
    cross join generate_series(0, 119) a
    cross join lateral (
      select k, (public.terrain_distances())[k + 1] as d from generate_series(0, 19) k) kk
    where p.id = p_profile and p.status = 'complete'
    group by a) x
$$;

-- Skyline angle at any azimuth, interpolated between the 3-degree rays.
create or replace function public.horizon_at(h double precision[], az double precision)
returns double precision language sql immutable as $$
  select case when h is null then null else
    h[(floor(az / 3)::int % 120) + 1] * (1 - (az / 3 - floor(az / 3)))
    + h[((floor(az / 3)::int + 1) % 120) + 1] * (az / 3 - floor(az / 3)) end
$$;

-- ── Sun position ────────────────────────────────────────────
-- NOAA solar position algorithm (Meeus), with atmospheric refraction.
-- Azimuth in degrees clockwise from true north; altitude in degrees.
create or replace function public.sun_position(
  p_ts timestamptz, p_lat double precision, p_lng double precision,
  out azimuth double precision, out altitude double precision)
language plpgsql immutable as $$
declare
  ep   double precision := extract(epoch from p_ts);
  t    double precision;
  l0   double precision;
  m    double precision;
  e    double precision;
  c    double precision;
  om   double precision;
  lam  double precision;
  eps  double precision;
  decl double precision;
  y    double precision;
  eot  double precision;
  tst  double precision;
  ha   double precision;
  phi  double precision := radians(p_lat);
  el   double precision;
  te   double precision;
  refr double precision;
begin
  t   := (ep / 86400.0 + 2440587.5 - 2451545.0) / 36525.0;
  l0  := 280.46646 + t * (36000.76983 + t * 0.0003032);
  l0  := l0 - 360 * floor(l0 / 360);
  m   := 357.52911 + t * (35999.05029 - 0.0001537 * t);
  e   := 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  c   := sin(radians(m)) * (1.914602 - t * (0.004817 + 0.000014 * t))
       + sin(radians(2 * m)) * (0.019993 - 0.000101 * t)
       + sin(radians(3 * m)) * 0.000289;
  om  := 125.04 - 1934.136 * t;
  lam := l0 + c - 0.00569 - 0.00478 * sin(radians(om));
  eps := 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
       + 0.00256 * cos(radians(om));
  decl := asin(sin(radians(eps)) * sin(radians(lam)));
  y   := tan(radians(eps / 2)) ^ 2;
  eot := 4 * degrees(y * sin(2 * radians(l0)) - 2 * e * sin(radians(m))
       + 4 * e * y * sin(radians(m)) * cos(2 * radians(l0))
       - 0.5 * y * y * sin(4 * radians(l0)) - 1.25 * e * e * sin(2 * radians(m)));
  tst := (ep - 86400 * floor(ep / 86400)) / 60 + eot + 4 * p_lng;
  tst := tst - 1440 * floor(tst / 1440);
  ha  := radians(tst / 4 - 180);
  el  := degrees(asin(greatest(-1, least(1,
           sin(phi) * sin(decl) + cos(phi) * cos(decl) * cos(ha)))));
  if el > 85 then
    refr := 0;
  else
    te := tan(radians(el));
    if el > 5 then
      refr := 58.1 / te - 0.07 / te ^ 3 + 0.000086 / te ^ 5;
    elsif el > -0.575 then
      refr := 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
    else
      refr := -20.774 / te;
    end if;
    refr := refr / 3600;
  end if;
  altitude := el + refr;
  azimuth  := degrees(atan2(sin(ha), cos(ha) * sin(phi) - tan(decl) * cos(phi))) + 180;
  azimuth  := azimuth - 360 * floor(azimuth / 360);
end $$;

-- ── Attach pins to profiles ─────────────────────────────────
create or replace function public.scout_attach_terrain()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rl  double precision;
  rg  double precision;
  pid uuid;
begin
  if new.lat is null or new.lng is null then
    new.terrain_profile_id := null;
    return new;
  end if;
  rl := round(new.lat::numeric, 6);
  rg := round(new.lng::numeric, 6);
  insert into public.terrain_profiles (lat, lng) values (rl, rg)
    on conflict (lat, lng) do nothing;
  select id into pid from public.terrain_profiles where lat = rl and lng = rg;
  new.terrain_profile_id := pid;
  return new;
end $$;

drop trigger if exists scout_vantages_terrain on public.scout_vantages;
create trigger scout_vantages_terrain
  before insert or update of lat, lng on public.scout_vantages
  for each row execute function public.scout_attach_terrain();

drop trigger if exists scout_subjects_terrain on public.scout_subjects;
create trigger scout_subjects_terrain
  before insert or update of lat, lng on public.scout_subjects
  for each row execute function public.scout_attach_terrain();

-- ── Fetch step ──────────────────────────────────────────────
-- Harvest finished requests, then queue up to p_max_requests more (100 points
-- each; a full profile is 25 requests). Safe to call as often as you like.
create or replace function public.refresh_terrain_step(p_max_requests integer default 25)
returns table (harvested integer, queued integer, pending_profiles bigint)
language plpgsql security definer set search_path = public as $$
declare
  r        record;
  elev     jsonb;
  arr      double precision[];
  lats     text;
  lngs     text;
  last_idx integer;
  rid      bigint;
  n_h      integer := 0;
  n_q      integer := 0;
begin
  for r in
    select p.req_id, p.profile_id, p.first_idx, p.n, resp.status_code,
           public.try_jsonb(resp.content) as body
    from public.terrain_probe p
    join net._http_response resp on resp.id = p.req_id
  loop
    elev := r.body -> 'elevation';
    if r.status_code = 200 and jsonb_typeof(elev) = 'array'
       and jsonb_array_length(elev) = r.n then
      select array_agg(coalesce((x.v #>> '{}')::double precision, 0) order by x.i)
        into arr
        from jsonb_array_elements(elev) with ordinality as x(v, i);
      update public.terrain_profiles
         set samples[r.first_idx : r.first_idx + r.n - 1] = arr
       where id = r.profile_id;
      n_h := n_h + 1;
    else
      update public.terrain_profiles
         set failures = failures + 1,
             status = case when failures + 1 >= 10 then 'error' else status end
       where id = r.profile_id;
    end if;
    delete from public.terrain_probe where req_id = r.req_id;
  end loop;

  -- Requests that never got a response are dropped and re-queued.
  delete from public.terrain_probe q
   where q.requested_at < now() - interval '10 minutes'
     and not exists (select 1 from net._http_response x where x.id = q.req_id);

  update public.terrain_profiles
     set status = 'complete', completed_at = now(), ground_m = samples[1]
   where status = 'pending' and array_position(samples, null) is null;

  for r in
    select tp.id, tp.lat, tp.lng, c.first_idx
    from public.terrain_profiles tp
    cross join generate_series(1, 2401, 100) as c(first_idx)
    where tp.status = 'pending'
      and tp.samples[c.first_idx] is null
      and not exists (select 1 from public.terrain_probe q
                       where q.profile_id = tp.id and q.first_idx = c.first_idx)
    order by tp.created_at, c.first_idx
    limit p_max_requests
  loop
    last_idx := least(r.first_idx + 99, 2401);
    select string_agg(round(s.s_lat::numeric, 6)::text, ',' order by i),
           string_agg(round(s.s_lng::numeric, 6)::text, ',' order by i)
      into lats, lngs
      from generate_series(r.first_idx, last_idx) i
      cross join lateral public.terrain_sample_coord(r.lat, r.lng, i) s;
    rid := net.http_get(url := 'https://api.open-meteo.com/v1/elevation?latitude='
                               || lats || '&longitude=' || lngs);
    insert into public.terrain_probe (req_id, profile_id, first_idx, n)
      values (rid, r.id, r.first_idx, last_idx - r.first_idx + 1);
    n_q := n_q + 1;
  end loop;

  return query select n_h, n_q,
    (select count(*) from public.terrain_profiles where status = 'pending');
end $$;

revoke execute on function public.refresh_terrain_step(integer) from public, anon, authenticated;
grant  execute on function public.refresh_terrain_step(integer) to service_role;
revoke execute on function public.scout_attach_terrain() from public, anon, authenticated;

-- ── Outputs ─────────────────────────────────────────────────
-- One row per vantage: which way you face, how far, and the heights used.
create or replace view public.scout_vantage_geometry with (security_invoker = true) as
select v.id   as vantage_id,
       v.code as vantage_code,
       v.name as vantage_name,
       s.id   as subject_id,
       s.name as subject_name,
       s.trip_id,
       round(g.bearing::numeric, 1)          as bearing_deg,
       public.compass_point(g.bearing)       as facing,
       round((g.dist_m / 1000)::numeric, 2)  as distance_km,
       vp.ground_m                           as vantage_dem_m,
       v.elevation_m                         as vantage_override_m,
       coalesce(v.elevation_m, vp.ground_m)  as vantage_elevation_m,
       sp.ground_m                           as subject_dem_m,
       s.height_m                            as subject_override_m,
       coalesce(s.height_m, sp.ground_m)     as subject_elevation_m,
       round(degrees(atan2(
         coalesce(s.height_m, sp.ground_m) - (coalesce(v.elevation_m, vp.ground_m) + 1.6),
         g.dist_m))::numeric, 2)             as look_angle_deg,
       vp.status                             as vantage_terrain,
       sp.status                             as subject_terrain
from public.scout_vantages v
join public.scout_subjects s on s.id = v.subject_id
left join public.terrain_profiles vp on vp.id = v.terrain_profile_id
left join public.terrain_profiles sp on sp.id = s.terrain_profile_id
cross join lateral (
  select public.geo_bearing(v.lat, v.lng, s.lat, s.lng)    as bearing,
         public.geo_distance_m(v.lat, v.lng, s.lat, s.lng) as dist_m) g
where v.lat is not null and s.lat is not null;

-- Light through one day at a vantage, every p_step_min minutes (local time).
--   light: front | side | backlit (sun direction vs. the way you face),
--          'in shadow' when terrain blocks the sun from the subject,
--          'no sun' below the horizon.
--   sun_visible_from_vantage / sun_on_subject: terrain checks; null until the
--          profile has been fetched.
create or replace function public.vantage_light(
  p_vantage  uuid,
  p_date     date,
  p_step_min integer default 5,
  p_tz       text    default 'Atlantic/Faroe')
returns table (
  local_time               timestamp,
  sun_azimuth              numeric,
  sun_altitude             numeric,
  sun_vs_facing_deg        numeric,
  light                    text,
  phase                    text,
  sun_visible_from_vantage boolean,
  sun_on_subject           boolean)
language plpgsql stable as $$
declare
  g  record;
  hv double precision[];
  hs double precision[];
begin
  select v.lat as vlat, v.lng as vlng,
         public.geo_bearing(v.lat, v.lng, s.lat, s.lng) as bearing,
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
         case when sp.altitude < -0.833 then 'no sun'
              when hs is not null and sp.altitude <= public.horizon_at(hs, sp.azimuth) then 'in shadow'
              when d.delta <= 45  then 'backlit'
              when d.delta <= 135 then 'side'
              else 'front' end,
         case when sp.altitude < -6     then 'night'
              when sp.altitude < -0.833 then 'blue hour'
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
end $$;

-- Backstop: keep fetching even when nobody presses refresh.
select cron.schedule('terrain-refresh', '*/2 * * * *',
                     'select public.refresh_terrain_step();');
