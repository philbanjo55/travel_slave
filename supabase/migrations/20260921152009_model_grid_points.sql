-- Where each weather model ACTUALLY samples, per stop.
-- A multi-model request reports only one grid point (the finest model's),
-- so without this the row implicitly claims all 18 describe the same
-- place. They do not: at Drangarnir, DMI lands 0.5 km away and MET Norway
-- 14.5 km away. Grid points are static per (model, coordinate), so this is
-- resolved once and reused forever.
create table if not exists public.model_grid_points (
  id            uuid primary key default gen_random_uuid(),
  model         text not null,
  stop_id       uuid not null references public.stops(id) on delete cascade,
  requested_lat double precision not null,
  requested_lng double precision not null,
  grid_lat      double precision,
  grid_lng      double precision,
  distance_km   double precision,
  has_data      boolean not null default false,
  probed_at     timestamptz not null default now(),
  constraint model_grid_points_model_stop_key unique (model, stop_id)
);

create index if not exists model_grid_points_stop_idx
  on public.model_grid_points (stop_id, distance_km);

alter table public.model_grid_points enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                 join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname='model_grid_points'
                   and p.polname='full_access') then
    create policy full_access on public.model_grid_points
      for all using (true) with check (true);
  end if;
end $$;

-- Great-circle distance, so the probe and every later query agree.
create or replace function public.km_between(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
      power(sin(radians(lat2-lat1)/2),2)
    + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2)
  ));
$$;

-- Scratch: maps a pg_net request id back to the (model, stop) it was for.
create table if not exists public.model_grid_probe (
  req_id  bigint primary key,
  model   text not null,
  stop_id uuid not null
);;
