-- 3D sun view: one more 1.5 km close-up box on the Grand Teton trip, gtd15_jenny_lake_3 (23 Nov 2026, NOT applied).
-- Before applying: upload these 6 files (2,317,014 bytes) to the public bucket `terrain`: gtd_jenny_lake_3_lidar_v4.png, gtd_jenny_lake_3_mask_v4.png, gtd_jenny_lake_3_trees_v4.png, gtd_jenny_lake_3_water_v4.png, gtd_jenny_lake_3_colour_v4.jpg, gtd_jenny_lake_3_mask_v6.png.
-- Why: the Jenny Lake shot 'Grand (your photo)' stands at 43.69885, -110.72699 (Teton Park Road shoulder just north of the
-- Cottonwood Creek bridge) and no close-up box held it (its 3D had only the fine box gt_taggart_bradley_lakes). Find spot
-- put the same photo at 43.69608, -110.72750. The box is centred at 43.6975, -110.7285: both points about 600 m inside,
-- the Cottonwood Creek belt and the Taggart Lake trailhead lot west of them. The app (src/services/terrain.ts pickDetail)
-- picks it for both points, and changes the pick of no other shot (88 Teton shots checked).
-- Same steps and formats as the 16 laser boxes of 20261114010000_terrain_sharp_teton.sql + 20261115200000_terrain_trees_leaf_v6.sql:
--   tools/sun3d/lidar/build_detail.py build <work> --box 43.6975,-110.7285 --name jenny_lake_3 --side 1504 --cell 1
--     --max-depth 10 --no-buildings --wide-file grand_teton_z12.png --suffix _v4 --out files_v4
--   tools/sun3d/teton_colour/build_teton_colour.py rows <work> detail.json files_v4      (winter colour)
--   tools/sun3d/lidar/build_leaf.py boxes <work> --rows detail.json --files files_v4      (mask v6, bare / evergreen)
-- Pipeline check: gtd15_jenny_lake_2 rebuilt the same way came out byte-identical to the bucket's six files.
-- In the box: 281,132 tree cells (28 ha, 10 % of the trees over 4 m called bare), no building cells (ground only),
-- no water cells (the survey has no water returns on Cottonwood Creek here), water layer of the 6 km around 88.6 ha.
insert into public.terrain_detail_regions_v4 (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes,
  trees_path, trees_bytes, trees_bins, trees_bin_m, water_path, water_bytes, water_n, water_north, water_south, water_west, water_east, color_path, color_bytes, bare, leaf_mask_path, leaf_mask_bytes, note) values
  ('gtd15_jenny_lake_3', 'grand_teton', 43.704267, 43.690733, -110.737843, -110.719157, 1504, 1503.9, 1504.1, 2005, 0.02, 1.0, 'gtd_jenny_lake_3_lidar_v4.png', 627250, 'gtd_jenny_lake_3_mask_v4.png', 309457, 'gtd_jenny_lake_3_trees_v4.png', 897121, 64, 0.6, 'gtd_jenny_lake_3_water_v4.png', 7397, 1500, 43.724495, 43.670505, -110.765774, -110.691226, 'gtd_jenny_lake_3_colour_v4.jpg', 205999, true, 'gtd_jenny_lake_3_mask_v6.png', 269790, 'USGS 3DEP lidar WY_GrandTetonNP_1_D22, 1.5 km at 1 m, ground only (buildings from terrain_house_tiles), tree canopy in the mask.')
on conflict (id) do nothing;
