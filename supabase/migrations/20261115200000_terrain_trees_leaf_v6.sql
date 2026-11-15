-- 3D sun view, trees A2 (15 Nov 2026; tools/sun3d/lidar/build_leaf.py, mask v6). DRAFT: not applied.
-- After Phil's Snake River Overlook scan: firs on the bluff below the overlook were drawn bare (a bright patch of the
-- summer photo). Mask v6 adds a 'weak bare' class that the page draws evergreen within 200 m of the stand spot:
--   a tree cell = 8 + 3 x round(height / 0.6 m) + class (0 evergreen, 1 bare, 2 bare by the summer photo only).
-- ORDER: ship the app code that reads v6 first (services/terrain.ts detailLeaf picks the format from the *_mask_v6.png
-- name). An older build reads a v6 byte as v5: heights within 0.2 m, but a scrambled bare bit.
-- Before applying: upload the 16 *_mask_v6.png to bucket terrain (the v5 files stay for older builds).
update public.terrain_detail_regions_v4 t set leaf_mask_path = v.p, leaf_mask_bytes = v.b from (values
  ('gtd15_blacktail_ponds_overlook', 'gtd_blacktail_ponds_overlook_mask_v6.png', 331682),
  ('gtd15_chapel_of_the', 'gtd_chapel_of_the_mask_v6.png', 267272),
  ('gtd15_cunningham_cabin', 'gtd_cunningham_cabin_mask_v6.png', 131185),
  ('gtd15_elk_ranch_flats', 'gtd_elk_ranch_flats_mask_v6.png', 100872),
  ('gtd15_glacier_view_turnout', 'gtd_glacier_view_turnout_mask_v6.png', 120270),
  ('gtd15_jenny_lake', 'gtd_jenny_lake_mask_v6.png', 177836),
  ('gtd15_jenny_lake_2', 'gtd_jenny_lake_2_mask_v6.png', 596866),
  ('gtd15_t_a_moulton', 'gtd_t_a_moulton_mask_v6.png', 38178),
  ('gtd15_oxbow_bend', 'gtd_oxbow_bend_mask_v6.png', 538590),
  ('gtd15_shane_cabins_gros', 'gtd_shane_cabins_gros_mask_v6.png', 437582),
  ('gtd15_snake_river_overlook', 'gtd_snake_river_overlook_mask_v6.png', 474569),
  ('gtd15_swan_lake_heron', 'gtd_swan_lake_heron_mask_v6.png', 646718),
  ('gtd15_taggart_bradley_lakes', 'gtd_taggart_bradley_lakes_mask_v6.png', 796957),
  ('gtd15_taggart_bradley_lakes_2', 'gtd_taggart_bradley_lakes_2_mask_v6.png', 1081257),
  ('gtd15_teton_point_turnout', 'gtd_teton_point_turnout_mask_v6.png', 72562),
  ('gtd15_willow_flats_overlook', 'gtd_willow_flats_overlook_mask_v6.png', 419380)
) v(id, p, b) where t.id = v.id;
