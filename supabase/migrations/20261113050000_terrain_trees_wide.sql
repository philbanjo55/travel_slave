-- 3D sun view, park-wide trees (Grand Teton): a coarse canopy layer from the 2022 laser survey (USGS 3DEP lidar,
-- WY_GrandTetonNP_1_D22, public domain), written by tools/sun3d/lidar/build_canopy.py. The wide Teton grid is cut into
-- 10 x 10 tiles of 0.05 deg x 0.068 deg (~5.6 x 5.5 km), each n x n cells (~7 m); a tile with no tree is not listed.
-- Each row is one file in bucket `terrain`: an 8-bit greyscale PNG, row 0 = north, 0 = no tree, else the canopy's top
-- over the ground = value x step_m. The page (tools/sun3d/app_view.js, park-wide trees) draws one tree a cell close by
-- and clumps farther off, beyond the laser detail box, within 12 km of the stand spot; never in the sun times.
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
  step_m double precision not null default 0.5,   -- canopy height = value x step_m (0 = no tree)
  cell_m double precision,            -- metres a cell (north-south)
  path text not null,                 -- object path in bucket terrain
  bytes integer,
  trees integer,                      -- cells with a tree
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_tree_tiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_tree_tiles' and policyname = 'app_read') then
    create policy app_read on public.terrain_tree_tiles for select using (true);
  end if;
end $$;

insert into public.terrain_tree_tiles (id, parent, north, south, west, east, n, step_m, cell_m, path, bytes, trees) values
  ('gtc_0_0', 'grand_teton', 43.95, 43.9, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_0_0.png', 3056, 1509),
  ('gtc_0_1', 'grand_teton', 43.95, 43.9, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_0_1.png', 254561, 255342),
  ('gtc_0_2', 'grand_teton', 43.95, 43.9, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_0_2.png', 167567, 154122),
  ('gtc_0_3', 'grand_teton', 43.95, 43.9, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_0_3.png', 64228, 70579),
  ('gtc_0_4', 'grand_teton', 43.95, 43.9, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_0_4.png', 293649, 366511),
  ('gtc_0_5', 'grand_teton', 43.95, 43.9, -110.58, -110.512, 800, 0.5, 6.95, 'gtc_0_5.png', 216687, 260313),
  ('gtc_0_6', 'grand_teton', 43.95, 43.9, -110.512, -110.444, 800, 0.5, 6.95, 'gtc_0_6.png', 158046, 190620),
  ('gtc_1_0', 'grand_teton', 43.9, 43.85, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_1_0.png', 41777, 35274),
  ('gtc_1_1', 'grand_teton', 43.9, 43.85, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_1_1.png', 191519, 176076),
  ('gtc_1_2', 'grand_teton', 43.9, 43.85, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_1_2.png', 229509, 223424),
  ('gtc_1_3', 'grand_teton', 43.9, 43.85, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_1_3.png', 63044, 74647),
  ('gtc_1_4', 'grand_teton', 43.9, 43.85, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_1_4.png', 174851, 200269),
  ('gtc_1_5', 'grand_teton', 43.9, 43.85, -110.58, -110.512, 800, 0.5, 6.95, 'gtc_1_5.png', 295616, 348768),
  ('gtc_1_6', 'grand_teton', 43.9, 43.85, -110.512, -110.444, 800, 0.5, 6.95, 'gtc_1_6.png', 209866, 230345),
  ('gtc_2_0', 'grand_teton', 43.85, 43.8, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_2_0.png', 51963, 42783),
  ('gtc_2_1', 'grand_teton', 43.85, 43.8, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_2_1.png', 149841, 129544),
  ('gtc_2_2', 'grand_teton', 43.85, 43.8, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_2_2.png', 240878, 261994),
  ('gtc_2_3', 'grand_teton', 43.85, 43.8, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_2_3.png', 144635, 166455),
  ('gtc_2_4', 'grand_teton', 43.85, 43.8, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_2_4.png', 190908, 244046),
  ('gtc_2_5', 'grand_teton', 43.85, 43.8, -110.58, -110.512, 800, 0.5, 6.95, 'gtc_2_5.png', 189017, 200146),
  ('gtc_2_6', 'grand_teton', 43.85, 43.8, -110.512, -110.444, 800, 0.5, 6.95, 'gtc_2_6.png', 146375, 152122),
  ('gtc_2_7', 'grand_teton', 43.85, 43.8, -110.444, -110.376, 800, 0.5, 6.95, 'gtc_2_7.png', 23386, 20434),
  ('gtc_3_0', 'grand_teton', 43.8, 43.75, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_3_0.png', 3321, 1309),
  ('gtc_3_1', 'grand_teton', 43.8, 43.75, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_3_1.png', 175412, 160668),
  ('gtc_3_2', 'grand_teton', 43.8, 43.75, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_3_2.png', 209608, 205903),
  ('gtc_3_3', 'grand_teton', 43.8, 43.75, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_3_3.png', 119491, 140968),
  ('gtc_3_4', 'grand_teton', 43.8, 43.75, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_3_4.png', 118380, 118465),
  ('gtc_3_5', 'grand_teton', 43.8, 43.75, -110.58, -110.512, 800, 0.5, 6.95, 'gtc_3_5.png', 98784, 95188),
  ('gtc_3_6', 'grand_teton', 43.8, 43.75, -110.512, -110.444, 800, 0.5, 6.95, 'gtc_3_6.png', 73301, 75756),
  ('gtc_3_7', 'grand_teton', 43.8, 43.75, -110.444, -110.376, 800, 0.5, 6.95, 'gtc_3_7.png', 29152, 28831),
  ('gtc_4_0', 'grand_teton', 43.75, 43.7, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_4_0.png', 1008, 139),
  ('gtc_4_1', 'grand_teton', 43.75, 43.7, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_4_1.png', 73903, 58291),
  ('gtc_4_2', 'grand_teton', 43.75, 43.7, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_4_2.png', 284021, 311017),
  ('gtc_4_3', 'grand_teton', 43.75, 43.7, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_4_3.png', 84143, 85774),
  ('gtc_4_4', 'grand_teton', 43.75, 43.7, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_4_4.png', 27902, 28005),
  ('gtc_4_5', 'grand_teton', 43.75, 43.7, -110.58, -110.512, 800, 0.5, 6.95, 'gtc_4_5.png', 4578, 4005),
  ('gtc_5_0', 'grand_teton', 43.7, 43.65, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_5_0.png', 96217, 85487),
  ('gtc_5_1', 'grand_teton', 43.7, 43.65, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_5_1.png', 214419, 206229),
  ('gtc_5_2', 'grand_teton', 43.7, 43.65, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_5_2.png', 335973, 402347),
  ('gtc_5_3', 'grand_teton', 43.7, 43.65, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_5_3.png', 89517, 87498),
  ('gtc_5_4', 'grand_teton', 43.7, 43.65, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_5_4.png', 66108, 71556),
  ('gtc_6_0', 'grand_teton', 43.65, 43.6, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_6_0.png', 229585, 230496),
  ('gtc_6_1', 'grand_teton', 43.65, 43.6, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_6_1.png', 337171, 386332),
  ('gtc_6_2', 'grand_teton', 43.65, 43.6, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_6_2.png', 136628, 152106),
  ('gtc_6_3', 'grand_teton', 43.65, 43.6, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_6_3.png', 92811, 101733),
  ('gtc_6_4', 'grand_teton', 43.65, 43.6, -110.648, -110.58, 800, 0.5, 6.95, 'gtc_6_4.png', 50296, 50127),
  ('gtc_7_0', 'grand_teton', 43.6, 43.55, -110.92, -110.852, 800, 0.5, 6.95, 'gtc_7_0.png', 49669, 47744),
  ('gtc_7_1', 'grand_teton', 43.6, 43.55, -110.852, -110.784, 800, 0.5, 6.95, 'gtc_7_1.png', 8902, 7612),
  ('gtc_7_2', 'grand_teton', 43.6, 43.55, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_7_2.png', 24091, 18937),
  ('gtc_7_3', 'grand_teton', 43.6, 43.55, -110.716, -110.648, 800, 0.5, 6.95, 'gtc_7_3.png', 5375, 3388),
  ('gtc_8_2', 'grand_teton', 43.55, 43.5, -110.784, -110.716, 800, 0.5, 6.95, 'gtc_8_2.png', 1366, 445)
on conflict (id) do update set parent = excluded.parent, north = excluded.north, south = excluded.south, west = excluded.west,
  east = excluded.east, n = excluded.n, step_m = excluded.step_m, cell_m = excluded.cell_m, path = excluded.path,
  bytes = excluded.bytes, trees = excluded.trees;
