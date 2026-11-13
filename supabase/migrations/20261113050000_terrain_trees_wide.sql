-- 3D sun view, park-wide trees (Grand Teton): a coarse canopy layer from the 2022 laser survey (USGS 3DEP lidar,
-- WY_GrandTetonNP_1_D22, public domain), written by tools/sun3d/lidar/build_canopy.py. The wide Teton grid is cut into
-- 10 x 10 tiles of 0.05 deg x 0.068 deg (~5.6 x 5.5 km); a tile with no tree is not listed. Each tile has two rows,
-- each one file in bucket `terrain` (8-bit greyscale PNG, row 0 = north, 0 = no tree):
--   lod 0: n = 800 (~7 m cells), value = the canopy's top over the ground / step_m (used within 3 km of a stand spot);
--   lod 1: n = 400 (~14 m, 2 x 2 cells in one), value = (tree cells of the four - 1) x 64 + tallest height / step_m
--          (used farther off: a third of the bytes).
-- The page (tools/sun3d/app_view.js, park-wide trees) draws one tree a cell close by and clumps farther off, beyond
-- the laser detail box, within 12 km of the stand spot; never in the sun times.
-- Outside the survey (Wilson, the east of the grid) there are no rows: no trees are drawn there.
-- A table of its own: older app builds read the other terrain tables whole and never see these rows.
-- Idempotent: the table is made if missing and the rows are written over.
--
-- Before applying: upload the files listed in upload.txt to bucket `terrain`.
create table if not exists public.terrain_tree_tiles (
  id text primary key,
  parent text not null references public.terrain_regions(id),   -- the wide region the tile sits in
  north double precision not null, south double precision not null,
  west double precision not null, east double precision not null,
  n integer not null,                 -- n x n cells, row 0 at the north edge
  lod integer not null default 0,     -- 0 every cell; 1 two by two cells in one (see above)
  step_m double precision not null default 2,     -- canopy height = value (lod 1: value & 63) x step_m (0 = no tree)
  cell_m double precision,            -- metres a cell (north-south)
  path text not null,                 -- object path in bucket terrain
  bytes integer,
  trees integer,                      -- cells with a tree
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_tree_tiles add column if not exists lod integer not null default 0;
alter table public.terrain_tree_tiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_tree_tiles' and policyname = 'app_read') then
    create policy app_read on public.terrain_tree_tiles for select using (true);
  end if;
end $$;

insert into public.terrain_tree_tiles (id, parent, north, south, west, east, n, lod, step_m, cell_m, path, bytes, trees) values
  ('gtc_0_0', 'grand_teton', 43.95, 43.9, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_0_0.png', 2695, 1509),
  ('gtcc_0_0', 'grand_teton', 43.95, 43.9, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_0_0.png', 1276, 1509),
  ('gtc_0_1', 'grand_teton', 43.95, 43.9, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_0_1.png', 197449, 255342),
  ('gtcc_0_1', 'grand_teton', 43.95, 43.9, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_0_1.png', 75331, 255342),
  ('gtc_0_2', 'grand_teton', 43.95, 43.9, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_0_2.png', 132506, 154122),
  ('gtcc_0_2', 'grand_teton', 43.95, 43.9, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_0_2.png', 58789, 154122),
  ('gtc_0_3', 'grand_teton', 43.95, 43.9, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_0_3.png', 50279, 70579),
  ('gtcc_0_3', 'grand_teton', 43.95, 43.9, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_0_3.png', 17816, 70579),
  ('gtc_0_4', 'grand_teton', 43.95, 43.9, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_0_4.png', 209613, 366511),
  ('gtcc_0_4', 'grand_teton', 43.95, 43.9, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_0_4.png', 65269, 366511),
  ('gtc_0_5', 'grand_teton', 43.95, 43.9, -110.58, -110.512, 800, 0, 2.0, 6.95, 'gtc_0_5.png', 157727, 260313),
  ('gtcc_0_5', 'grand_teton', 43.95, 43.9, -110.58, -110.512, 400, 1, 2.0, 13.89, 'gtcc_0_5.png', 49368, 260313),
  ('gtc_0_6', 'grand_teton', 43.95, 43.9, -110.512, -110.444, 800, 0, 2.0, 6.95, 'gtc_0_6.png', 116891, 190620),
  ('gtcc_0_6', 'grand_teton', 43.95, 43.9, -110.512, -110.444, 400, 1, 2.0, 13.89, 'gtcc_0_6.png', 35632, 190620),
  ('gtc_1_0', 'grand_teton', 43.9, 43.85, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_1_0.png', 34152, 35274),
  ('gtcc_1_0', 'grand_teton', 43.9, 43.85, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_1_0.png', 14008, 35274),
  ('gtc_1_1', 'grand_teton', 43.9, 43.85, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_1_1.png', 150787, 176076),
  ('gtcc_1_1', 'grand_teton', 43.9, 43.85, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_1_1.png', 66084, 176076),
  ('gtc_1_2', 'grand_teton', 43.9, 43.85, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_1_2.png', 177883, 223424),
  ('gtcc_1_2', 'grand_teton', 43.9, 43.85, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_1_2.png', 74024, 223424),
  ('gtc_1_3', 'grand_teton', 43.9, 43.85, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_1_3.png', 47599, 74647),
  ('gtcc_1_3', 'grand_teton', 43.9, 43.85, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_1_3.png', 15593, 74647),
  ('gtc_1_4', 'grand_teton', 43.9, 43.85, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_1_4.png', 132237, 200269),
  ('gtcc_1_4', 'grand_teton', 43.9, 43.85, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_1_4.png', 45603, 200269),
  ('gtc_1_5', 'grand_teton', 43.9, 43.85, -110.58, -110.512, 800, 0, 2.0, 6.95, 'gtc_1_5.png', 213794, 348768),
  ('gtcc_1_5', 'grand_teton', 43.9, 43.85, -110.58, -110.512, 400, 1, 2.0, 13.89, 'gtcc_1_5.png', 71537, 348768),
  ('gtc_1_6', 'grand_teton', 43.9, 43.85, -110.512, -110.444, 800, 0, 2.0, 6.95, 'gtc_1_6.png', 159529, 230345),
  ('gtcc_1_6', 'grand_teton', 43.9, 43.85, -110.512, -110.444, 400, 1, 2.0, 13.89, 'gtcc_1_6.png', 55560, 230345),
  ('gtc_2_0', 'grand_teton', 43.85, 43.8, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_2_0.png', 42405, 42783),
  ('gtcc_2_0', 'grand_teton', 43.85, 43.8, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_2_0.png', 18601, 42783),
  ('gtc_2_1', 'grand_teton', 43.85, 43.8, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_2_1.png', 119340, 129544),
  ('gtcc_2_1', 'grand_teton', 43.85, 43.8, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_2_1.png', 57421, 129544),
  ('gtc_2_2', 'grand_teton', 43.85, 43.8, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_2_2.png', 181343, 261994),
  ('gtcc_2_2', 'grand_teton', 43.85, 43.8, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_2_2.png', 66191, 261994),
  ('gtc_2_3', 'grand_teton', 43.85, 43.8, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_2_3.png', 104685, 166455),
  ('gtcc_2_3', 'grand_teton', 43.85, 43.8, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_2_3.png', 38480, 166455),
  ('gtc_2_4', 'grand_teton', 43.85, 43.8, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_2_4.png', 137574, 244046),
  ('gtcc_2_4', 'grand_teton', 43.85, 43.8, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_2_4.png', 41692, 244046),
  ('gtc_2_5', 'grand_teton', 43.85, 43.8, -110.58, -110.512, 800, 0, 2.0, 6.95, 'gtc_2_5.png', 143269, 200146),
  ('gtcc_2_5', 'grand_teton', 43.85, 43.8, -110.58, -110.512, 400, 1, 2.0, 13.89, 'gtcc_2_5.png', 54050, 200146),
  ('gtc_2_6', 'grand_teton', 43.85, 43.8, -110.512, -110.444, 800, 0, 2.0, 6.95, 'gtc_2_6.png', 112615, 152122),
  ('gtcc_2_6', 'grand_teton', 43.85, 43.8, -110.512, -110.444, 400, 1, 2.0, 13.89, 'gtcc_2_6.png', 43675, 152122),
  ('gtc_2_7', 'grand_teton', 43.85, 43.8, -110.444, -110.376, 800, 0, 2.0, 6.95, 'gtc_2_7.png', 19070, 20434),
  ('gtcc_2_7', 'grand_teton', 43.85, 43.8, -110.444, -110.376, 400, 1, 2.0, 13.89, 'gtcc_2_7.png', 7969, 20434),
  ('gtc_3_0', 'grand_teton', 43.8, 43.75, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_3_0.png', 2936, 1309),
  ('gtcc_3_0', 'grand_teton', 43.8, 43.75, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_3_0.png', 1715, 1309),
  ('gtc_3_1', 'grand_teton', 43.8, 43.75, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_3_1.png', 138477, 160668),
  ('gtcc_3_1', 'grand_teton', 43.8, 43.75, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_3_1.png', 61447, 160668),
  ('gtc_3_2', 'grand_teton', 43.8, 43.75, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_3_2.png', 162718, 205903),
  ('gtcc_3_2', 'grand_teton', 43.8, 43.75, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_3_2.png', 66529, 205903),
  ('gtc_3_3', 'grand_teton', 43.8, 43.75, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_3_3.png', 87797, 140968),
  ('gtcc_3_3', 'grand_teton', 43.8, 43.75, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_3_3.png', 30476, 140968),
  ('gtc_3_4', 'grand_teton', 43.8, 43.75, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_3_4.png', 92467, 118465),
  ('gtcc_3_4', 'grand_teton', 43.8, 43.75, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_3_4.png', 37088, 118465),
  ('gtc_3_5', 'grand_teton', 43.8, 43.75, -110.58, -110.512, 800, 0, 2.0, 6.95, 'gtc_3_5.png', 77517, 95188),
  ('gtcc_3_5', 'grand_teton', 43.8, 43.75, -110.58, -110.512, 400, 1, 2.0, 13.89, 'gtcc_3_5.png', 32316, 95188),
  ('gtc_3_6', 'grand_teton', 43.8, 43.75, -110.512, -110.444, 800, 0, 2.0, 6.95, 'gtc_3_6.png', 56245, 75756),
  ('gtcc_3_6', 'grand_teton', 43.8, 43.75, -110.512, -110.444, 400, 1, 2.0, 13.89, 'gtcc_3_6.png', 23097, 75756),
  ('gtc_3_7', 'grand_teton', 43.8, 43.75, -110.444, -110.376, 800, 0, 2.0, 6.95, 'gtc_3_7.png', 23096, 28831),
  ('gtcc_3_7', 'grand_teton', 43.8, 43.75, -110.444, -110.376, 400, 1, 2.0, 13.89, 'gtcc_3_7.png', 8549, 28831),
  ('gtc_4_0', 'grand_teton', 43.75, 43.7, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_4_0.png', 960, 139),
  ('gtcc_4_0', 'grand_teton', 43.75, 43.7, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_4_0.png', 415, 139),
  ('gtc_4_1', 'grand_teton', 43.75, 43.7, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_4_1.png', 60798, 58291),
  ('gtcc_4_1', 'grand_teton', 43.75, 43.7, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_4_1.png', 29584, 58291),
  ('gtc_4_2', 'grand_teton', 43.75, 43.7, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_4_2.png', 213172, 311017),
  ('gtcc_4_2', 'grand_teton', 43.75, 43.7, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_4_2.png', 77612, 311017),
  ('gtc_4_3', 'grand_teton', 43.75, 43.7, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_4_3.png', 66850, 85774),
  ('gtcc_4_3', 'grand_teton', 43.75, 43.7, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_4_3.png', 24235, 85774),
  ('gtc_4_4', 'grand_teton', 43.75, 43.7, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_4_4.png', 22940, 28005),
  ('gtcc_4_4', 'grand_teton', 43.75, 43.7, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_4_4.png', 8553, 28005),
  ('gtc_4_5', 'grand_teton', 43.75, 43.7, -110.58, -110.512, 800, 0, 2.0, 6.95, 'gtc_4_5.png', 3813, 4005),
  ('gtcc_4_5', 'grand_teton', 43.75, 43.7, -110.58, -110.512, 400, 1, 2.0, 13.89, 'gtcc_4_5.png', 1319, 4005),
  ('gtc_5_0', 'grand_teton', 43.7, 43.65, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_5_0.png', 77378, 85487),
  ('gtcc_5_0', 'grand_teton', 43.7, 43.65, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_5_0.png', 32963, 85487),
  ('gtc_5_1', 'grand_teton', 43.7, 43.65, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_5_1.png', 167210, 206229),
  ('gtcc_5_1', 'grand_teton', 43.7, 43.65, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_5_1.png', 69621, 206229),
  ('gtc_5_2', 'grand_teton', 43.7, 43.65, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_5_2.png', 244953, 402347),
  ('gtcc_5_2', 'grand_teton', 43.7, 43.65, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_5_2.png', 79350, 402347),
  ('gtc_5_3', 'grand_teton', 43.7, 43.65, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_5_3.png', 70794, 87498),
  ('gtcc_5_3', 'grand_teton', 43.7, 43.65, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_5_3.png', 27406, 87498),
  ('gtc_5_4', 'grand_teton', 43.7, 43.65, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_5_4.png', 49839, 71556),
  ('gtcc_5_4', 'grand_teton', 43.7, 43.65, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_5_4.png', 19525, 71556),
  ('gtc_6_0', 'grand_teton', 43.65, 43.6, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_6_0.png', 176500, 230496),
  ('gtcc_6_0', 'grand_teton', 43.65, 43.6, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_6_0.png', 67896, 230496),
  ('gtc_6_1', 'grand_teton', 43.65, 43.6, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_6_1.png', 248962, 386332),
  ('gtcc_6_1', 'grand_teton', 43.65, 43.6, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_6_1.png', 83678, 386332),
  ('gtc_6_2', 'grand_teton', 43.65, 43.6, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_6_2.png', 103993, 152106),
  ('gtcc_6_2', 'grand_teton', 43.65, 43.6, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_6_2.png', 35959, 152106),
  ('gtc_6_3', 'grand_teton', 43.65, 43.6, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_6_3.png', 71381, 101733),
  ('gtcc_6_3', 'grand_teton', 43.65, 43.6, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_6_3.png', 25304, 101733),
  ('gtc_6_4', 'grand_teton', 43.65, 43.6, -110.648, -110.58, 800, 0, 2.0, 6.95, 'gtc_6_4.png', 39148, 50127),
  ('gtcc_6_4', 'grand_teton', 43.65, 43.6, -110.648, -110.58, 400, 1, 2.0, 13.89, 'gtcc_6_4.png', 16382, 50127),
  ('gtc_7_0', 'grand_teton', 43.6, 43.55, -110.92, -110.852, 800, 0, 2.0, 6.95, 'gtc_7_0.png', 39261, 47744),
  ('gtcc_7_0', 'grand_teton', 43.6, 43.55, -110.92, -110.852, 400, 1, 2.0, 13.89, 'gtcc_7_0.png', 14887, 47744),
  ('gtc_7_1', 'grand_teton', 43.6, 43.55, -110.852, -110.784, 800, 0, 2.0, 6.95, 'gtc_7_1.png', 7348, 7612),
  ('gtcc_7_1', 'grand_teton', 43.6, 43.55, -110.852, -110.784, 400, 1, 2.0, 13.89, 'gtcc_7_1.png', 2752, 7612),
  ('gtc_7_2', 'grand_teton', 43.6, 43.55, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_7_2.png', 19307, 18937),
  ('gtcc_7_2', 'grand_teton', 43.6, 43.55, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_7_2.png', 8665, 18937),
  ('gtc_7_3', 'grand_teton', 43.6, 43.55, -110.716, -110.648, 800, 0, 2.0, 6.95, 'gtc_7_3.png', 4485, 3388),
  ('gtcc_7_3', 'grand_teton', 43.6, 43.55, -110.716, -110.648, 400, 1, 2.0, 13.89, 'gtcc_7_3.png', 2002, 3388),
  ('gtc_8_2', 'grand_teton', 43.55, 43.5, -110.784, -110.716, 800, 0, 2.0, 6.95, 'gtc_8_2.png', 1268, 445),
  ('gtcc_8_2', 'grand_teton', 43.55, 43.5, -110.784, -110.716, 400, 1, 2.0, 13.89, 'gtcc_8_2.png', 536, 445)
on conflict (id) do update set parent = excluded.parent, north = excluded.north, south = excluded.south, west = excluded.west,
  east = excluded.east, n = excluded.n, lod = excluded.lod, step_m = excluded.step_m, cell_m = excluded.cell_m, path = excluded.path,
  bytes = excluded.bytes, trees = excluded.trees;
