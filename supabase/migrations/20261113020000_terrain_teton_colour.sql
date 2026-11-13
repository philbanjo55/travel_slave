-- 3D sun view, Grand Teton in real winter colour (13 Nov 2026). Built by tools/sun3d/teton_colour/build_teton_colour.py;
-- drawn by tools/sun3d/app_view.js (albedo files baked into the light passes where the ground is snow).
--   terrain_regions.color_path    NEW: a winter colour file of the whole wide grid, JPEG 4096 x 4096 (~13 m), north up on
--                                 the grid's lat / lng: Copernicus Sentinel-2 L2A, tile 12TWP, 30 Dec 2025 18:32 UTC
--                                 (11 Jan 2026 where 30 Dec had no data or cloud), the light of that day taken out.
--   terrain_regions.color_credit  NEW: the credit line the app shows under the view when the colour is drawn.
--   terrain_near_regions.color_path   the 8 gt_* fine boxes: USDA NAIP (July 2022, 0.6 m) at the box's own cell size,
--                                 turned to winter (snow where the 30 Dec 2025 picture says snow, conifers kept dark,
--                                 broadleaf crowns as bare twigs, water frozen or open as on 30 Dec).
--   terrain_detail_regions.color_path the 19 gtd_* laser boxes: NAIP at 0.5 m turned to winter the same way (water, buildings
--                                 and trees keep the page's own drawing).
-- Colour only: no sun time reads these files. Ship together with the app code that knows them (branch
-- claude/sun3d-teton-colour): an app from before would draw the box files the Faroes way.
-- Before applying: upload the 28 files listed below to the public bucket `terrain` (7021127 bytes).
-- Files: grand_teton_s2_winter.jpg gt_cunningham_cabin_colour.jpg gt_emilys_pond_levee_colour.jpg gt_glacier_view_turnout_colour.jpg gt_shane_cabins_gros_colour.jpg gt_snake_river_overlook_colour.jpg gt_swan_lake_heron_colour.jpg gt_taggart_bradley_lakes_colour.jpg gt_willow_flats_overlook_colour.jpg gtd_blacktail_ponds_overlook_colour.jpg gtd_blacktail_ponds_overlook_2_colour.jpg gtd_chapel_of_the_colour.jpg gtd_cunningham_cabin_colour.jpg gtd_elk_ranch_flats_colour.jpg gtd_glacier_view_turnout_colour.jpg gtd_jenny_lake_colour.jpg gtd_jenny_lake_2_colour.jpg gtd_john_moulton_barn_colour.jpg gtd_menors_ferry_colour.jpg gtd_oxbow_bend_colour.jpg gtd_shane_cabins_gros_colour.jpg gtd_snake_river_overlook_colour.jpg gtd_swan_lake_heron_colour.jpg gtd_t_a_moulton_colour.jpg gtd_taggart_bradley_lakes_colour.jpg gtd_taggart_bradley_lakes_2_colour.jpg gtd_teton_point_turnout_colour.jpg gtd_willow_flats_overlook_colour.jpg
alter table public.terrain_regions add column if not exists color_path text, add column if not exists color_bytes integer,
  add column if not exists color_credit text;
alter table public.terrain_near_regions add column if not exists color_path text, add column if not exists color_bytes integer;
alter table public.terrain_detail_regions add column if not exists color_path text, add column if not exists color_bytes integer;

update public.terrain_regions set color_path = 'grand_teton_s2_winter.jpg', color_bytes = 3356600, color_credit = 'Ground colour: Copernicus Sentinel-2 (ESA), 30 Dec 2025. Aerial photos: USDA NAIP via USGS, July 2022, snow added.' where id = 'grand_teton';

update public.terrain_near_regions t set color_path = v.p, color_bytes = v.b from (values
  ('gt_cunningham_cabin', 'gt_cunningham_cabin_colour.jpg', 348317),
  ('gt_emilys_pond_levee', 'gt_emilys_pond_levee_colour.jpg', 296890),
  ('gt_glacier_view_turnout', 'gt_glacier_view_turnout_colour.jpg', 301092),
  ('gt_shane_cabins_gros', 'gt_shane_cabins_gros_colour.jpg', 78694),
  ('gt_snake_river_overlook', 'gt_snake_river_overlook_colour.jpg', 77908),
  ('gt_swan_lake_heron', 'gt_swan_lake_heron_colour.jpg', 130327),
  ('gt_taggart_bradley_lakes', 'gt_taggart_bradley_lakes_colour.jpg', 528356),
  ('gt_willow_flats_overlook', 'gt_willow_flats_overlook_colour.jpg', 336476)
) as v(id, p, b) where t.id = v.id;

update public.terrain_detail_regions t set color_path = v.p, color_bytes = v.b from (values
  ('gtd_blacktail_ponds_overlook', 'gtd_blacktail_ponds_overlook_colour.jpg', 74979),
  ('gtd_blacktail_ponds_overlook_2', 'gtd_blacktail_ponds_overlook_2_colour.jpg', 93420),
  ('gtd_chapel_of_the', 'gtd_chapel_of_the_colour.jpg', 101244),
  ('gtd_cunningham_cabin', 'gtd_cunningham_cabin_colour.jpg', 64380),
  ('gtd_elk_ranch_flats', 'gtd_elk_ranch_flats_colour.jpg', 46546),
  ('gtd_glacier_view_turnout', 'gtd_glacier_view_turnout_colour.jpg', 33145),
  ('gtd_jenny_lake', 'gtd_jenny_lake_colour.jpg', 94772),
  ('gtd_jenny_lake_2', 'gtd_jenny_lake_2_colour.jpg', 42699),
  ('gtd_john_moulton_barn', 'gtd_john_moulton_barn_colour.jpg', 40385),
  ('gtd_menors_ferry', 'gtd_menors_ferry_colour.jpg', 109766),
  ('gtd_oxbow_bend', 'gtd_oxbow_bend_colour.jpg', 96880),
  ('gtd_shane_cabins_gros', 'gtd_shane_cabins_gros_colour.jpg', 90312),
  ('gtd_snake_river_overlook', 'gtd_snake_river_overlook_colour.jpg', 98928),
  ('gtd_swan_lake_heron', 'gtd_swan_lake_heron_colour.jpg', 110355),
  ('gtd_t_a_moulton', 'gtd_t_a_moulton_colour.jpg', 47200),
  ('gtd_taggart_bradley_lakes', 'gtd_taggart_bradley_lakes_colour.jpg', 121665),
  ('gtd_taggart_bradley_lakes_2', 'gtd_taggart_bradley_lakes_2_colour.jpg', 157217),
  ('gtd_teton_point_turnout', 'gtd_teton_point_turnout_colour.jpg', 47533),
  ('gtd_willow_flats_overlook', 'gtd_willow_flats_overlook_colour.jpg', 95041)
) as v(id, p, b) where t.id = v.id;
