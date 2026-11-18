-- 3D sun view, detail level, round 3: the trees' own laser returns and the water of the 6 km around each stand spot.
-- Adds columns to terrain_detail_regions and fills them for the 19 Grand Teton rows. Written from the round 3 build
-- (tools/sun3d/lidar/build_detail.py --suffix _v3); nothing in round 2's files or names changes unless listed below.
--   trees_path: 8-bit PNG, n lines of n x 8 bytes: per cell 64 bits, bit k = a laser return in the slice
--               k x trees_bin_m .. (k + 1) x trees_bin_m above the ground (tree cells only). The page puts its tree
--               points there instead of making them up under the canopy top.
--   water_path: 8-bit PNG, water_n x water_n cells over water_north .. water_east (6 km, 4 m cells): 0 no water,
--               1 moving water (a river), 2 still water (a lake, a pond, a slow backwater). The page lays it on the
--               ground beyond the box, and uses it to tell the box's own water still from moving.
-- An app build from before round 3 reads only the old columns and keeps working: heights and mask keep round 2's
-- format (mask: 0 ground, 2 building, 3 water, 8+ tree with canopy height).
--
-- Before applying: upload the files listed in upload_v3.txt to bucket `terrain`.
alter table public.terrain_detail_regions
  add column if not exists trees_path text, add column if not exists trees_bytes integer,
  add column if not exists trees_bins integer, add column if not exists trees_bin_m double precision,
  add column if not exists water_path text, add column if not exists water_bytes integer, add column if not exists water_n integer,
  add column if not exists water_north double precision, add column if not exists water_south double precision,
  add column if not exists water_west double precision, add column if not exists water_east double precision;

update public.terrain_detail_regions t set
  path = v.path, bytes = v.bytes, mask_path = v.mask_path, mask_bytes = v.mask_bytes, base_m = v.base_m,
  trees_path = v.trees_path, trees_bytes = v.trees_bytes, trees_bins = v.trees_bins, trees_bin_m = v.trees_bin_m,
  water_path = v.water_path, water_bytes = v.water_bytes, water_n = v.water_n,
  water_north = v.water_north, water_south = v.water_south, water_west = v.water_west, water_east = v.water_east
from (values
  ('gtd_blacktail_ponds_overlook', 'gtd_blacktail_ponds_overlook_lidar.png', 279353, 'gtd_blacktail_ponds_overlook_mask.png', 83117, 1965, 'gtd_blacktail_ponds_overlook_trees_v3.png', 202645, 64, 0.6, 'gtd_blacktail_ponds_overlook_water_v3.png', 8182, 1500, 43.693533, 43.639543, -110.734123, -110.659613),
  ('gtd_blacktail_ponds_overlook_2', 'gtd_blacktail_ponds_overlook_2_lidar_v3.png', 286365, 'gtd_blacktail_ponds_overlook_2_mask_v3.png', 185497, 1965, 'gtd_blacktail_ponds_overlook_2_trees_v3.png', 503861, 64, 0.6, 'gtd_blacktail_ponds_overlook_2_water_v3.png', 8515, 1500, 43.694763, 43.640773, -110.736189, -110.661677),
  ('gtd_chapel_of_the', 'gtd_chapel_of_the_lidar.png', 299173, 'gtd_chapel_of_the_mask.png', 133169, 1960, 'gtd_chapel_of_the_trees_v3.png', 318710, 64, 0.6, 'gtd_chapel_of_the_water_v3.png', 8240, 1500, 43.686982, 43.632992, -110.752464, -110.677962),
  ('gtd_cunningham_cabin', 'gtd_cunningham_cabin_lidar.png', 248526, 'gtd_cunningham_cabin_mask.png', 25183, 2047, 'gtd_cunningham_cabin_trees_v3.png', 46750, 64, 0.6, 'gtd_cunningham_cabin_water_v3.png', 6532, 1500, 43.805614, 43.751624, -110.595454, -110.520804),
  ('gtd_elk_ranch_flats', 'gtd_elk_ranch_flats_lidar.png', 211765, 'gtd_elk_ranch_flats_mask.png', 1173, 2042, 'gtd_elk_ranch_flats_trees_v3.png', 8156, 64, 0.6, 'gtd_elk_ranch_flats_water_v3.png', 10028, 1500, 43.8378, 43.78381, -110.564244, -110.489554),
  ('gtd_glacier_view_turnout', 'gtd_glacier_view_turnout_lidar.png', 244609, 'gtd_glacier_view_turnout_mask.png', 1625, 1994, 'gtd_glacier_view_turnout_trees_v3.png', 9054, 64, 0.6, 'gtd_glacier_view_turnout_water_v3.png', 8072, 1500, 43.71785, 43.66386, -110.709675, -110.635135),
  ('gtd_jenny_lake', 'gtd_jenny_lake_lidar.png', 259812, 'gtd_jenny_lake_mask.png', 153683, 2028, 'gtd_jenny_lake_trees_v3.png', 401929, 64, 0.6, 'gtd_jenny_lake_water_v3.png', 5385, 1500, 43.736699, 43.682709, -110.768376, -110.693812),
  ('gtd_jenny_lake_2', 'gtd_jenny_lake_2_lidar.png', 207104, 'gtd_jenny_lake_2_mask.png', 3286, 2053, 'gtd_jenny_lake_2_trees_v3.png', 12541, 64, 0.6, 'gtd_jenny_lake_2_water_v3.png', 4785, 1500, 43.7655, 43.71151, -110.761952, -110.687352),
  ('gtd_t_a_moulton', 'gtd_t_a_moulton_lidar.png', 229504, 'gtd_t_a_moulton_mask.png', 24399, 2005, 'gtd_t_a_moulton_trees_v3.png', 73906, 64, 0.6, 'gtd_t_a_moulton_water_v3.png', 3569, 1500, 43.687518, 43.633528, -110.701674, -110.627172),
  ('gtd_john_moulton_barn', 'gtd_john_moulton_barn_lidar.png', 233186, 'gtd_john_moulton_barn_mask.png', 4380, 2006, 'gtd_john_moulton_barn_trees_v3.png', 15939, 64, 0.6, 'gtd_john_moulton_barn_water_v3.png', 4311, 1500, 43.693254, 43.639264, -110.70149, -110.62698),
  ('gtd_menors_ferry', 'gtd_menors_ferry_lidar.png', 303814, 'gtd_menors_ferry_mask.png', 131498, 1960, 'gtd_menors_ferry_trees_v3.png', 334744, 64, 0.6, 'gtd_menors_ferry_water_v3.png', 7873, 1500, 43.686224, 43.632235, -110.748918, -110.674416),
  ('gtd_oxbow_bend', 'gtd_oxbow_bend_lidar_v3.png', 254637, 'gtd_oxbow_bend_mask_v3.png', 143806, 2046, 'gtd_oxbow_bend_trees_v3.png', 320111, 64, 0.6, 'gtd_oxbow_bend_water_v3.png', 12070, 1500, 43.893174, 43.839184, -110.58507, -110.51031),
  ('gtd_shane_cabins_gros', 'gtd_shane_cabins_gros_lidar.png', 259918, 'gtd_shane_cabins_gros_mask.png', 163896, 2059, 'gtd_shane_cabins_gros_trees_v3.png', 369531, 64, 0.6, null, null, null, null, null, null, null),
  ('gtd_snake_river_overlook', 'gtd_snake_river_overlook_lidar.png', 280536, 'gtd_snake_river_overlook_mask.png', 213328, 2011, 'gtd_snake_river_overlook_trees_v3.png', 442181, 64, 0.6, 'gtd_snake_river_overlook_water_v3.png', 7941, 1500, 43.78044, 43.72645, -110.661134, -110.586516),
  ('gtd_swan_lake_heron', 'gtd_swan_lake_heron_lidar.png', 206503, 'gtd_swan_lake_heron_mask.png', 232942, 2050, 'gtd_swan_lake_heron_trees_v3.png', 528696, 64, 0.6, 'gtd_swan_lake_heron_water_v3.png', 15318, 1500, 43.932431, 43.878441, -110.685313, -110.610505),
  ('gtd_taggart_bradley_lakes', 'gtd_taggart_bradley_lakes_lidar.png', 236946, 'gtd_taggart_bradley_lakes_mask.png', 326221, 2096, 'gtd_taggart_bradley_lakes_trees_v3.png', 816595, 64, 0.6, 'gtd_taggart_bradley_lakes_water_v3.png', 4394, 1500, 43.72733, 43.67334, -110.789852, -110.7153),
  ('gtd_taggart_bradley_lakes_2', 'gtd_taggart_bradley_lakes_2_lidar.png', 299541, 'gtd_taggart_bradley_lakes_2_mask.png', 530629, 2091, 'gtd_taggart_bradley_lakes_2_trees_v3.png', 1466815, 64, 0.6, 'gtd_taggart_bradley_lakes_2_water_v3.png', 4624, 1500, 43.743495, 43.689505, -110.781286, -110.706714),
  ('gtd_teton_point_turnout', 'gtd_teton_point_turnout_lidar.png', 252486, 'gtd_teton_point_turnout_mask.png', 18223, 2001, 'gtd_teton_point_turnout_trees_v3.png', 43292, 64, 0.6, 'gtd_teton_point_turnout_water_v3.png', 9304, 1500, 43.744968, 43.690978, -110.697146, -110.622572),
  ('gtd_willow_flats_overlook', 'gtd_willow_flats_overlook_lidar.png', 277661, 'gtd_willow_flats_overlook_mask.png', 129109, 2062, 'gtd_willow_flats_overlook_trees_v3.png', 270564, 64, 0.6, 'gtd_willow_flats_overlook_water_v3.png', 11911, 1500, 43.900052, 43.846062, -110.611149, -110.536381)
) as v(id, path, bytes, mask_path, mask_bytes, base_m, trees_path, trees_bytes, trees_bins, trees_bin_m, water_path, water_bytes, water_n, water_north, water_south, water_west, water_east)
where t.id = v.id;
