-- 3D sun view: Cottonwood Creek as water and the Highlands road bridge in the close-up box gtd15_jenny_lake_2 (23 Nov 2026, NOT applied).
-- Before applying: upload these 4 files (1,324,713 bytes) to the public bucket `terrain`: gtd_jenny_lake_2_mask_v4w.png, gtd_jenny_lake_2w_mask_v6.png, gtd_jenny_lake_2_water_v4w.png, gtd_jenny_lake_2_bld.json.
-- Why: the 2022 park survey has no water-class point on Cottonwood Creek, so tools/sun3d/lidar/build_detail.py found no water
-- in this box (the creek drew as snow) and the box had no bridge. Shot 'highlands bridge' stands on the east bank at
-- 43.709423, -110.730954 looking ~308 deg at the bridge.
-- Built by tools/sun3d/lidar/build_detail_water.py from the box's own files (heights, colour and tree files unchanged):
--   water = the survey's empty cells (water swallows the laser), in patches confirmed by the NAIP photo's near-infrared and
--   lying at the local low, gaps under the bridge and under crowns closed: 16,402 m2 in the box (15,148 moving, 1,254 still),
--   class 3 in mask v4 and mask v6 (tree cells over the channel are water now), the wide layer + 2.0 ha of creek (moving).
--   buildings_path: deck 17.0 x 5.4 m (laser 15.0 m), top 2037.05 m, bearing 67.1, a deck slab open below with a low railing (laser bridge class 17).
-- The NAIP photo (19 Jul 2022) sits up to ~20 m off the survey (24 Sep 2022) here, so it only confirms the water, it does not
-- outline it; the box's colour file (NAIP-based) is unchanged.
-- Older app builds read the same columns: they get the water too (the bridge needs the buildings file reader, in every
-- build since the Faroes colour page, 13 Nov 2026). Undo: set the four pairs back to the old names / bytes
-- (gtd_jenny_lake_2_mask_v4.png 714815, gtd_jenny_lake_2_mask_v6.png 596866, gtd_jenny_lake_2_water_v4.png 5390, buildings null).
update public.terrain_detail_regions_v4 set mask_path = 'gtd_jenny_lake_2_mask_v4w.png', mask_bytes = 716705, leaf_mask_path = 'gtd_jenny_lake_2w_mask_v6.png', leaf_mask_bytes = 599071, water_path = 'gtd_jenny_lake_2_water_v4w.png', water_bytes = 6383, buildings_path = 'gtd_jenny_lake_2_bld.json', buildings_bytes = 2554
where id = 'gtd15_jenny_lake_2';
