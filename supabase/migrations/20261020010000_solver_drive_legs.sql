-- Drive times for the solver, stored per spot pair (coordinates rounded to
-- 3 dp, ~100 m) so trips share them and a stop that hasn't moved is never
-- re-fetched. Filled by the solver-drive-matrix edge function. Backend only:
-- RLS on (ensure_rls) with no policy.

create table public.solver_drive_legs (
  from_lat numeric(7,3) not null,
  from_lng numeric(7,3) not null,
  to_lat numeric(7,3) not null,
  to_lng numeric(7,3) not null,
  minutes integer,            -- null: Google found no drivable route
  distance_km numeric(7,1),
  status text,
  source text not null check (source in ('routes','distancematrix')),
  fetched_at timestamptz not null default now(),
  primary key (from_lat, from_lng, to_lat, to_lng)
);

-- Stop-to-stop drive minutes for a trip. Stops at the same spot are 0 min
-- apart; pairs with no stored leg are absent (call the function again).
create or replace view public.solver_drive_matrix with (security_invoker = true) as
with sp as (
  select id, trip_id, round(lat::numeric, 3) as lat, round(lng::numeric, 3) as lng
    from public.stops where lat is not null and lng is not null
)
select a.trip_id, a.id as from_stop_id, b.id as to_stop_id,
       case when a.lat = b.lat and a.lng = b.lng then 0 else l.minutes end as minutes,
       case when a.lat = b.lat and a.lng = b.lng then 0 else l.distance_km end as distance_km,
       l.status
  from sp a
  join sp b on b.trip_id = a.trip_id and b.id <> a.id
  left join public.solver_drive_legs l
    on l.from_lat = a.lat and l.from_lng = a.lng and l.to_lat = b.lat and l.to_lng = b.lng
 where (a.lat = b.lat and a.lng = b.lng) or l.from_lat is not null;
