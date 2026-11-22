-- 3D sun view for the day shoot 'Bethlehem Steel Stacks' (trip 138477e5-0c0c-44b6-8958-25a31660eef7, Bethlehem PA, 25 Nov 2026), 22 Nov 2026. NOT applied.
-- Built by tools/sun3d/bethlehem/build_bethlehem.py (README.md there). The whole NEW_TRIP_SOP 4b stack, new rows only (ids bth*):
--   wide region 'bethlehem' (60 x 61 km): terrarium tiles zoom 12 (~29 m), a 720 m spike and a source seam SW of Allentown
--     fixed (despike + Copernicus GLO-30 over the seam). Colour: Sentinel-2 16 Nov 2023 (late-autumn, light of 11 AM divided out);
--   near box (6 km, ~7 m): terrarium zoom 14, colour USDA NAIP 29 Apr 2022 (bare trees, first leaves);
--   range 'bthr_south_mountain' (10.24 km at 5 m): USGS 3DEP 1 m DEM PA_Northcentral_2019_B19 over the site and South Mountain (feeds sun times);
--   close-up box 'bthd15_steel_stacks_2m' (3 km at 2 m, n 1504): USGS 3DEP lidar PA_Northcentral_B5_2019, bare ground + water
--     (Lehigh River, the canal), mask v6 trees (bare / evergreen from Sentinel-2 16 Nov 2023 NDVI), NAIP colour;
--   9 house tiles (bthb_*, 15,866 blocks): every building and structure the survey saw in the box, found by the returns
--     (one return = solid) and the NAIP photo (no plant), the furnaces / casino as 4 m columns at the laser's height;
--   4 tree tiles (bthc_*, 7 m cells over the near box, bare bit in leaf_path).
-- Before applying: upload the 27 files listed in upload.txt (bucket terrain, same names, 13,376,037 bytes).
-- No 'Teton' or 'Faroes' row is touched.
insert into public.terrain_regions (id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground, note, color_path, color_bytes, color_credit) values
  ('bethlehem', 40.89, 40.34, -75.72, -75.01, 2048, 59997.2, 61122.6, 0, 0.5, 'bethlehem_z12.png', 1709491, 'green', 'Public terrarium tiles, zoom 12 (~29 m), glitches fixed. Late November, no snow.', 'bethlehem_s2_nov.jpg', 846611, 'Heights: USGS 3DEP (lidar 2019, 1 m DEM, terrarium tiles beyond). Ground colour: Copernicus Sentinel-2 (ESA), 16 Nov 2023. Aerial photos: USDA NAIP via USGS, April 2022. Buildings and trees: USGS 3DEP lidar 2019.')
on conflict (id) do nothing;
insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, note, color_path, color_bytes) values
  ('bth_bethlehem_steel_stacks', 'bethlehem', 40.642, 40.5875, -75.403, -75.3315, 896, 6042.0, 6056.7, 0, 0.5, 'bth_bethlehem_steel_stacks_z14.png', 189389, 'Public terrarium tiles, zoom 14, about 7 m a point.', 'bth_bethlehem_steel_stacks_colour.jpg', 1222355)
on conflict (id) do nothing;
insert into public.terrain_range_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, note) values
  ('bthr_south_mountain', 'bethlehem', 40.638363, 40.54622, -75.457458, -75.33632, 2048, 10240.0, 10240.0, 60, 0.05, 5.0, 'bthr_south_mountain.png', 2570805, 'USGS 3DEP 1 m DEM (PA_Northcentral_2019_B19), bare earth at 5 m: the site and South Mountain toward the late-autumn sunset.')
on conflict (id) do nothing;
insert into public.terrain_detail_regions_v4 (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes, water_path, water_bytes, water_n, water_north, water_south, water_west, water_east, color_path, color_bytes, bare, leaf_mask_path, leaf_mask_bytes, note) values
  ('bthd15_steel_stacks_2m', 'bethlehem', 40.627995, 40.600928, -75.386473, -75.350876, 1504, 3008.1, 3008.0, 57, 0.02, 2.0, 'bthd15_steel_stacks_2m_lidar.png', 850280, 'bthd15_steel_stacks_2m_mask.png', 475983, 'bthd15_steel_stacks_2m_water.png', 8072, 1500, 40.641456, 40.587467, -75.404176, -75.333173, 'bthd_steel_stacks_colour.jpg', 1354251, true, 'bthd15_steel_stacks_2m_mask_v6.png', 411844, 'USGS 3DEP lidar PA_Northcentral_B5_2019 (2019), 3 km at 2 m around the parking and the stand pin: bare ground and water, trees in the mask (bare or evergreen in late November). Buildings and the furnaces are the bthb_* house tiles.')
on conflict (id) do nothing;
insert into public.terrain_house_tiles (id, parent, north, south, west, east, path, bytes, count, note) values
  ('bthb_0_0', 'bethlehem', 40.627995, 40.618973, -75.386473, -75.374607, 'bthb_0_0.json', 480124, 2270, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_0_1', 'bethlehem', 40.627995, 40.618973, -75.374607, -75.362742, 'bthb_0_1.json', 269090, 1194, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_0_2', 'bethlehem', 40.627995, 40.618973, -75.362742, -75.350876, 'bthb_0_2.json', 259739, 1300, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_1_0', 'bethlehem', 40.618973, 40.60995, -75.386473, -75.374607, 'bthb_1_0.json', 441481, 2216, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_1_1', 'bethlehem', 40.618973, 40.60995, -75.374607, -75.362742, 'bthb_1_1.json', 542351, 2749, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_1_2', 'bethlehem', 40.618973, 40.60995, -75.362742, -75.350876, 'bthb_1_2.json', 455081, 2292, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_2_0', 'bethlehem', 40.60995, 40.600928, -75.386473, -75.374607, 'bthb_2_0.json', 551569, 2712, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_2_1', 'bethlehem', 40.60995, 40.600928, -75.374607, -75.362742, 'bthb_2_1.json', 160575, 707, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.'),
  ('bthb_2_2', 'bethlehem', 40.60995, 40.600928, -75.362742, -75.350876, 'bthb_2_2.json', 87793, 426, 'USGS 3DEP lidar 2019: buildings (walls + fitted roof) and structures of many heights (furnaces, trestle, casino) as 4 m columns, roof colour from NAIP.')
on conflict (id) do nothing;
insert into public.terrain_tree_tiles (id, parent, north, south, west, east, n, lod, step_m, cell_m, path, bytes, trees, note, leaf_path, leaf_bytes) values
  ('bthc_0_0', 'bethlehem', 40.642, 40.61475, -75.403, -75.36725, 433, 0, 2.0, 6.99, 'bthc_0_0.png', 55773, 71318, 'USGS 3DEP lidar 2019, 7 m cells, bare in late November from Sentinel-2 16 Nov 2023.', 'bthcl_0_0.png', 61460),
  ('bthc_0_1', 'bethlehem', 40.642, 40.61475, -75.36725, -75.3315, 433, 0, 2.0, 6.99, 'bthc_0_1.png', 53379, 66606, 'USGS 3DEP lidar 2019, 7 m cells, bare in late November from Sentinel-2 16 Nov 2023.', 'bthcl_0_1.png', 59447),
  ('bthc_1_0', 'bethlehem', 40.61475, 40.5875, -75.403, -75.36725, 433, 0, 2.0, 6.99, 'bthc_1_0.png', 70735, 115974, 'USGS 3DEP lidar 2019, 7 m cells, bare in late November from Sentinel-2 16 Nov 2023.', 'bthcl_1_0.png', 76909),
  ('bthc_1_1', 'bethlehem', 40.61475, 40.5875, -75.36725, -75.3315, 433, 0, 2.0, 6.99, 'bthc_1_1.png', 53423, 79418, 'USGS 3DEP lidar 2019, 7 m cells, bare in late November from Sentinel-2 16 Nov 2023.', 'bthcl_1_1.png', 58027)
on conflict (id) do nothing;
