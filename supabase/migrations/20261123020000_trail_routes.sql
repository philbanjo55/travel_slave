-- Trail routes from Phil's AllTrails GPX exports (23 Nov 2026). One row per route,
-- linked to the main trip's stop (practice copies reach it through training_copy_map).
-- geom = GeoJSON LineString of [lng, lat, ele_m] exactly as exported (no smoothing).
-- The raw .gpx files are kept in the private bucket uploads at alltrails/<file>.
-- Planned use: drawn on the stop's 3D view (overhead and walk mode) and a shot-to-route check.
create table if not exists public.trail_routes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id),
  stop_id uuid references public.stops(id),
  name text not null,
  kind text not null check (kind in ('own', 'public')),
  source text not null default 'alltrails_gpx',
  alltrails_url text,
  gpx_path text,
  points int,
  length_m numeric,
  gain_m numeric,
  closed_loop boolean,
  north double precision, south double precision, west double precision, east double precision,
  geom jsonb not null,
  check_notes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trail_routes_stop on public.trail_routes (stop_id);
alter table public.trail_routes enable row level security;
create policy app_read on public.trail_routes for select using (true);
