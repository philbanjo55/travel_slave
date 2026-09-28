-- Ground elevation per stop, from Open-Meteo's elevation API (Copernicus DEM
-- GLO-90, 90 m). Up to 100 coordinates per request, so the whole Faroes trip
-- is one call.
--
-- This is the height of the ground where you are STANDING. It is not the
-- height of what you are photographing: Drangarnir is a 70 m stack seen from
-- a clifftop, and the DEM at that coordinate returns the clifftop.
--
-- Self-healing on the same principle as model_grid_points: the coordinates
-- the value was fetched at are stored alongside it, so a moved stop stops
-- matching and is re-fetched. elevation_probed_at rather than elevation_m
-- drives that test, so an ocean coordinate that legitimately returns null is
-- not retried forever.
alter table public.stops
  add column if not exists elevation_m         double precision,
  add column if not exists elevation_lat       double precision,
  add column if not exists elevation_lng       double precision,
  add column if not exists elevation_probed_at timestamptz;

create table if not exists public.stop_elevation_probe (
  req_id       bigint primary key,
  stop_ids     uuid[] not null,
  requested_at timestamptz not null default now()
);

create or replace function public.refresh_stop_elevations_step(
  p_trip_id uuid default null,
  p_batch   integer default 100
)
returns table (harvested integer, queued integer, remaining bigint)
language plpgsql as $$
declare
  n_harvested integer := 0;
  n_queued    integer := 0;
begin
  -- Harvest. The response is a bare array in request order, so position is
  -- the only thing tying a number back to a stop — hence stop_ids is an
  -- ordered array and both sides are matched by ordinality.
  with settled as (
    select p.stop_ids, (r.content::jsonb -> 'elevation') as elev
    from public.stop_elevation_probe p
    join net._http_response r on r.id = p.req_id
    where r.status_code = 200
      and jsonb_typeof(r.content::jsonb -> 'elevation') = 'array'
  ), pairs as (
    select s.stop_ids[e.i] as stop_id, (e.value #>> '{}')::float as elevation_m
    from settled s,
         lateral jsonb_array_elements(s.elev) with ordinality as e(value, i)
    where s.stop_ids[e.i] is not null
  ), upd as (
    update public.stops st
       set elevation_m         = pr.elevation_m,
           elevation_lat       = st.lat,
           elevation_lng       = st.lng,
           elevation_probed_at = now()
      from pairs pr
     where st.id = pr.stop_id
    returning 1
  )
  select count(*) into n_harvested from upd;

  -- Clear everything settled, successes and failures alike; a failure simply
  -- becomes missing again and is retried on a later call.
  delete from public.stop_elevation_probe p
   using net._http_response r
   where r.id = p.req_id;

  -- Queue. Upcoming trips only, same guard as the weather crons.
  with todo as (
    select s.id, s.lat, s.lng, row_number() over (order by s.id) as rn
    from public.stops s
    join public.days  d on d.id = s.day_id
    join public.trips t on t.id = d.trip_id
    where s.lat is not null and s.lng is not null
      and t.archived is not true
      and (t.end_date is null or t.end_date >= current_date)
      and (p_trip_id is null or d.trip_id = p_trip_id)
      and (s.elevation_probed_at is null
           or s.elevation_lat is distinct from s.lat
           or s.elevation_lng is distinct from s.lng)
      and not exists (
        select 1 from public.stop_elevation_probe pr where s.id = any(pr.stop_ids))
    order by s.id
    limit p_batch
  ), req as (
    select array_agg(id order by rn)            as ids,
           string_agg(lat::text, ',' order by rn) as lats,
           string_agg(lng::text, ',' order by rn) as lngs
    from todo
  )
  insert into public.stop_elevation_probe (req_id, stop_ids)
  select net.http_get(url :=
           'https://api.open-meteo.com/v1/elevation?latitude=' || req.lats
           || '&longitude=' || req.lngs),
         req.ids
  from req
  where req.ids is not null;
  get diagnostics n_queued = row_count;

  return query
  select n_harvested, n_queued,
    (select count(*)
       from public.stops s
       join public.days  d on d.id = s.day_id
       join public.trips t on t.id = d.trip_id
      where s.lat is not null
        and t.archived is not true
        and (t.end_date is null or t.end_date >= current_date)
        and (p_trip_id is null or d.trip_id = p_trip_id)
        and (s.elevation_probed_at is null
             or s.elevation_lat is distinct from s.lat
             or s.elevation_lng is distinct from s.lng));
end $$;

select cron.schedule('stop-elevation-refresh', '*/5 * * * *',
  $job$select public.refresh_stop_elevations_step();$job$);
