-- 3D sun view, Faroes close-ups (12 Nov 2026): a second, fine level of terrain.
-- terrain_regions stays the wide grid per area (about 30 m a point). terrain_near_regions lists small fine boxes
-- (about 4 m a point) inside a region. A shot whose stand spot and subject both sit in one box gets that file
-- as well, and the page draws the fine box inside the wide grid (tools/sun3d/app_view.js, cfg.near).
-- A table of its own on purpose: an app build from before this change reads every terrain_regions row and takes
-- the first that holds the stand spot, so fine boxes listed there could replace the whole area for it.
--
-- Before applying: upload the 12 files to bucket `terrain` under the names below
-- (faroes_adem32.png and the 11 <id>_4m.png, built by tools/sun3d/build_faroes.sh).
create table if not exists public.terrain_near_regions (
  id text primary key,
  parent text not null references public.terrain_regions(id),   -- the wide region this box sits inside
  north double precision not null, south double precision not null,
  west double precision not null, east double precision not null,
  n integer not null,                 -- the grid is n x n points, row 0 at the north edge
  width_m double precision not null, depth_m double precision not null,
  base_m double precision not null default 0,     -- height = base_m + value * step_m
  step_m double precision not null default 0.5,
  path text not null,                 -- object path in bucket terrain
  bytes integer,
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_near_regions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_near_regions' and policyname = 'app_read') then
    create policy app_read on public.terrain_near_regions for select using (true);
  end if;
end $$;

-- The boxes cover every Faroe Islands 2027 shot whose stand spot and subject are under about 5.6 km apart
-- (54 of 57). Hvithamar, the Velbastadur view of Koltur and Klakkur are wide views and use the wide grid alone.
insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes) values
  ('fo_vagar_west', 'faroes', 62.135, 62.058, -7.475, -7.33, 2048, 7554, 8557, 0, 0.5, 'fo_vagar_west_4m.png', 705209),
  ('fo_vagar_south', 'faroes', 62.062, 62.008, -7.345, -7.2, 2048, 7569, 6001, 0, 0.5, 'fo_vagar_south_4m.png', 458959),
  ('fo_sandavagur', 'faroes', 62.092, 62.036, -7.175, -7.07, 1536, 5476, 6223, 0, 0.5, 'fo_sandavagur_4m.png', 436043),
  ('fo_kvivik', 'faroes', 62.133, 62.106, -7.095, -7.058, 1024, 1926, 3001, 0, 0.5, 'fo_kvivik_4m.png', 140762),
  ('fo_streymoy_north', 'faroes', 62.335, 62.235, -7.24, -7.065, 2048, 9060, 11113, 0, 0.5, 'fo_streymoy_north_4m.png', 754133),
  ('fo_eysturoy_north', 'faroes', 62.348, 62.278, -7.02, -6.925, 2048, 4914, 7779, 0, 0.5, 'fo_eysturoy_north_4m.png', 681354),
  ('fo_kalsoy_north', 'faroes', 62.38, 62.328, -6.835, -6.745, 1536, 4649, 5779, 0, 0.5, 'fo_kalsoy_north_4m.png', 278180),
  ('fo_torshavn_south', 'faroes', 62.016, 61.944, -6.9, -6.755, 2048, 7583, 8002, 0, 0.5, 'fo_torshavn_south_4m.png', 666546),
  ('fo_nordradalur', 'faroes', 62.096, 62.035, -7.0, -6.85, 2048, 7822, 6779, 0, 0.5, 'fo_nordradalur_4m.png', 964025),
  ('fo_vidoy', 'faroes', 62.38, 62.338, -6.6, -6.52, 1024, 4132, 4668, 0, 0.5, 'fo_vidoy_4m.png', 199211),
  ('fo_sandoy', 'faroes', 61.885, 61.833, -6.94, -6.88, 1536, 3150, 5779, 0, 0.5, 'fo_sandoy_4m.png', 254433)
on conflict (id) do nothing;
update public.terrain_near_regions set note = 'ArcticDEM v4.1 2 m mosaic (PGC, CC-BY-4.0) at about 4 m, sea level taken off, under 2 m = sea.' where parent = 'faroes' and note is null;

-- The wide Faroes grid, rebuilt from ArcticDEM v4.1 (32 m product). The first file (terrarium tiles, zoom 12) had the
-- land about 58 m too high and the fjords and sounds filled in at 0-130 m, so the sea between the islands drew as grass.
-- Same box and grid size. The app saves files by id and size, so phones fetch the new one by themselves.
update public.terrain_regions
set path = 'faroes_adem32.png', bytes = 784387,
    note = 'ArcticDEM v4.1 32 m mosaic (PGC, CC-BY-4.0), sea level taken off, under 2 m = sea. Spring trip: grass, rock, sea.'
where id = 'faroes';
