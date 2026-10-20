-- Car ferries the drive grid can't see (Google returns ROUTE_NOT_FOUND across
-- them). A leg with no direct route is priced as drive to one port + crossing
-- + drive from the other. Crossing time only: timetable waits are the
-- solver's job (the Kalsoy day is time-locked to the sailings anyway).
-- Port coordinates are rounded to 3 dp like solver_drive_legs.

create table public.solver_ferry_links (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  a_lat numeric(7,3) not null, a_lng numeric(7,3) not null,
  b_lat numeric(7,3) not null, b_lng numeric(7,3) not null,
  crossing_minutes integer not null check (crossing_minutes > 0),
  note text
);

-- Klaksvík <-> Syðradalur (Kalsoy), Strandfaraskip Landsins route 56,
-- ~20 min crossing. Ports are the trip's own ferry-port stops.
insert into public.solver_ferry_links (name, a_lat, a_lng, b_lat, b_lng, crossing_minutes, note)
values ('Klaksvík – Syðradalur (Kalsoy)', 62.230, -6.589, 62.246, -6.665, 20,
        'SSL route 56. Be in the vehicle queue 15 min before departure.');

create or replace view public.solver_drive_matrix with (security_invoker = true) as
with sp as (
  select id, trip_id, round(lat::numeric, 3) as lat, round(lng::numeric, 3) as lng
    from public.stops where lat is not null and lng is not null
), ferry as (
  select name, a_lat as p_lat, a_lng as p_lng, b_lat as q_lat, b_lng as q_lng, crossing_minutes from public.solver_ferry_links
  union all
  select name, b_lat, b_lng, a_lat, a_lng, crossing_minutes from public.solver_ferry_links
), pairs as (
  select a.trip_id, a.id as from_stop_id, b.id as to_stop_id,
         a.lat as alat, a.lng as alng, b.lat as blat, b.lng as blng,
         (a.lat = b.lat and a.lng = b.lng) as same_spot
    from sp a join sp b on b.trip_id = a.trip_id and b.id <> a.id
)
select p.trip_id, p.from_stop_id, p.to_stop_id,
       case when p.same_spot then 0 else coalesce(l.minutes, f.minutes) end as minutes,
       case when p.same_spot then 0 else coalesce(l.distance_km, f.distance_km) end as distance_km,
       case when p.same_spot then 'same spot' when l.minutes is not null then 'drive'
            when f.minutes is not null then 'ferry' else l.status end as status,
       f.ferry
  from pairs p
  left join public.solver_drive_legs l
    on l.from_lat = p.alat and l.from_lng = p.alng and l.to_lat = p.blat and l.to_lng = p.blng
  left join lateral (
    select fy.name as ferry,
           coalesce(l1.minutes, 0) + fy.crossing_minutes + coalesce(l2.minutes, 0) as minutes,
           coalesce(l1.distance_km, 0) + coalesce(l2.distance_km, 0) as distance_km
      from ferry fy
      left join public.solver_drive_legs l1
        on l1.from_lat = p.alat and l1.from_lng = p.alng and l1.to_lat = fy.p_lat and l1.to_lng = fy.p_lng
      left join public.solver_drive_legs l2
        on l2.from_lat = fy.q_lat and l2.from_lng = fy.q_lng and l2.to_lat = p.blat and l2.to_lng = p.blng
     where l.minutes is null and not p.same_spot
       and (l1.minutes is not null or (p.alat = fy.p_lat and p.alng = fy.p_lng))
       and (l2.minutes is not null or (p.blat = fy.q_lat and p.blng = fy.q_lng))
     order by 2 limit 1
  ) f on true
 where p.same_spot or l.from_lat is not null or f.minutes is not null;
