-- 3D sun view, third terrain level (detail): real foreground around the stand spots from a public laser survey
-- (USGS 3DEP lidar, WY_GrandTetonNP_1_D22, public domain). Written by tools/sun3d/lidar/build_detail.py.
-- terrain_regions = the wide grid per area, terrain_near_regions = fine boxes (about 6 m), terrain_detail_regions =
-- small boxes (about 500 m across, 0.5 or 1 m cells) around a stand spot. Each row has two files in bucket `terrain`:
-- the heights = the bare ground with the buildings on it (the page's 16-bit format, height = base_m + value * step_m,
-- step_m 0.02 here) and a class mask (8-bit: 0 ground / snow, 2 building, 3 water, 8 and up = tree, its canopy top
-- (value - 8) x 0.2 m above the ground). The page (tools/sun3d/app_view.js, cfg.detail) draws the box inside the
-- shot's fine box (or the wide grid), buildings as blocks and trees as points; sun times use ground and buildings only.
-- A table of its own for the same reason as terrain_near_regions: older app builds read the other two tables whole.
--
-- Before applying: upload the files listed in upload.txt to bucket `terrain`.
create table if not exists public.terrain_detail_regions (
  id text primary key,
  parent text not null references public.terrain_regions(id),   -- the wide region this box sits inside
  north double precision not null, south double precision not null,
  west double precision not null, east double precision not null,
  n integer not null,                 -- the grid is n x n points, row 0 at the north edge
  width_m double precision not null, depth_m double precision not null,
  base_m double precision not null default 0,     -- height = base_m + value * step_m
  step_m double precision not null default 0.02,
  cell_m double precision,            -- metres a point
  path text not null,                 -- heights, object path in bucket terrain
  bytes integer,
  mask_path text,                     -- class mask, object path in bucket terrain
  mask_bytes integer,
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_detail_regions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_detail_regions' and policyname = 'app_read') then
    create policy app_read on public.terrain_detail_regions for select using (true);
  end if;
end $$;

insert into public.terrain_detail_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes, note) values
  ('gtd_blacktail_ponds_overlook', 'grand_teton', 43.668788, 43.664288, -110.699973, -110.693763, 1000, 500.1, 500.1, 1965, 0.02, 0.5, 'gtd_blacktail_ponds_overlook_lidar.png', 279353, 'gtd_blacktail_ponds_overlook_mask.png', 83117, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_blacktail_ponds_overlook_2', 'grand_teton', 43.670018, 43.665518, -110.702038, -110.695828, 1000, 500.1, 500.1, 1965, 0.02, 0.5, 'gtd_blacktail_ponds_overlook_2_lidar.png', 286226, 'gtd_blacktail_ponds_overlook_2_mask.png', 185444, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_chapel_of_the', 'grand_teton', 43.662237, 43.657737, -110.718317, -110.712109, 1000, 500.0, 500.1, 1960, 0.02, 0.5, 'gtd_chapel_of_the_lidar.png', 299173, 'gtd_chapel_of_the_mask.png', 133169, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_cunningham_cabin', 'grand_teton', 43.780869, 43.776369, -110.561239, -110.555019, 1000, 499.9, 500.1, 2047, 0.02, 0.5, 'gtd_cunningham_cabin_lidar.png', 248526, 'gtd_cunningham_cabin_mask.png', 25183, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_elk_ranch_flats', 'grand_teton', 43.813055, 43.808555, -110.530011, -110.523787, 1000, 500.0, 500.1, 2042, 0.02, 0.5, 'gtd_elk_ranch_flats_lidar.png', 211765, 'gtd_elk_ranch_flats_mask.png', 1173, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_glacier_view_turnout', 'grand_teton', 43.693105, 43.688605, -110.675511, -110.669299, 1000, 500.0, 500.1, 1994, 0.02, 0.5, 'gtd_glacier_view_turnout_lidar.png', 244609, 'gtd_glacier_view_turnout_mask.png', 1625, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_jenny_lake', 'grand_teton', 43.711954, 43.707454, -110.734201, -110.727987, 1000, 500.0, 500.1, 2028, 0.02, 0.5, 'gtd_jenny_lake_lidar.png', 259812, 'gtd_jenny_lake_mask.png', 153683, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_jenny_lake_2', 'grand_teton', 43.740755, 43.736255, -110.72776, -110.721544, 1000, 499.9, 500.1, 2053, 0.02, 0.5, 'gtd_jenny_lake_2_lidar.png', 207104, 'gtd_jenny_lake_2_mask.png', 3286, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_t_a_moulton', 'grand_teton', 43.662773, 43.658273, -110.667527, -110.661319, 1000, 500.0, 500.1, 2005, 0.02, 0.5, 'gtd_t_a_moulton_lidar.png', 229504, 'gtd_t_a_moulton_mask.png', 24399, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_john_moulton_barn', 'grand_teton', 43.668509, 43.664009, -110.66734, -110.66113, 1000, 500.1, 500.1, 2006, 0.02, 0.5, 'gtd_john_moulton_barn_lidar.png', 233186, 'gtd_john_moulton_barn_mask.png', 4380, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_menors_ferry', 'grand_teton', 43.661533, 43.656926, -110.714846, -110.708488, 1024, 512.0, 512.0, 1960, 0.02, 0.5, 'gtd_menors_ferry_lidar.png', 303814, 'gtd_menors_ferry_mask.png', 131498, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_oxbow_bend', 'grand_teton', 43.868429, 43.863929, -110.550805, -110.544575, 1000, 500.0, 500.1, 2046, 0.02, 0.5, 'gtd_oxbow_bend_lidar.png', 254634, 'gtd_oxbow_bend_mask.png', 143803, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_shane_cabins_gros', 'grand_teton', 43.646344, 43.641737, -110.608001, -110.601646, 1024, 511.9, 512.0, 2059, 0.02, 0.5, 'gtd_shane_cabins_gros_lidar.png', 259918, 'gtd_shane_cabins_gros_mask.png', 163896, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_snake_river_overlook', 'grand_teton', 43.755695, 43.751195, -110.626934, -110.620716, 1000, 500.0, 500.1, 2011, 0.02, 0.5, 'gtd_snake_river_overlook_lidar.png', 280536, 'gtd_snake_river_overlook_mask.png', 213328, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_swan_lake_heron', 'grand_teton', 43.907686, 43.903186, -110.651026, -110.644792, 1000, 500.0, 500.1, 2050, 0.02, 0.5, 'gtd_swan_lake_heron_lidar.png', 206503, 'gtd_swan_lake_heron_mask.png', 232942, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_taggart_bradley_lakes', 'grand_teton', 43.702585, 43.698085, -110.755682, -110.74947, 1000, 499.9, 500.1, 2096, 0.02, 0.5, 'gtd_taggart_bradley_lakes_lidar.png', 236946, 'gtd_taggart_bradley_lakes_mask.png', 326221, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_taggart_bradley_lakes_2', 'grand_teton', 43.71875, 43.71425, -110.747107, -110.740893, 1000, 500.0, 500.1, 2091, 0.02, 0.5, 'gtd_taggart_bradley_lakes_2_lidar.png', 299541, 'gtd_taggart_bradley_lakes_2_mask.png', 530629, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_teton_point_turnout', 'grand_teton', 43.720223, 43.715723, -110.662966, -110.656752, 1000, 500.0, 500.1, 2001, 0.02, 0.5, 'gtd_teton_point_turnout_lidar.png', 252486, 'gtd_teton_point_turnout_mask.png', 18223, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.'),
  ('gtd_willow_flats_overlook', 'grand_teton', 43.875307, 43.870807, -110.57688, -110.57065, 1000, 499.9, 500.1, 2062, 0.02, 0.5, 'gtd_willow_flats_overlook_lidar.png', 277661, 'gtd_willow_flats_overlook_mask.png', 129109, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, ground + buildings per 0.5 m cell, tree canopy heights in the mask.')
on conflict (id) do nothing;

-- Not covered by the survey, no detail there: Emily's Pond Levee (outside the survey area); Teton Pines Nordic Center — Groomed Ski (outside the survey area)
