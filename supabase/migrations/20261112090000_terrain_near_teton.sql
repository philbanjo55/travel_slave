-- 3D sun view: fine foreground boxes for Grand Teton (12 Nov 2026, "do the finer data for the Tetons").
-- Here the subject is a peak 10-25 km away, so a box is ground around the STAND spots (2 km each way where it fits):
-- river benches, banks and flats at about 6 m a point instead of 27 m. The peaks stay on the wide grid.
-- The app now picks the smallest box that holds the stand spot (first the ones that also hold the subject).
-- Built and checked by tools/sun3d/build_trip_terrain.py (terrarium tiles zoom 14, US 10 m survey: every box
-- within 2 m of the wide file and of Copernicus). 8 boxes, 1.45 MB together, every Teton shot's stand spot is in one.
-- Honest value: small (the bench edges sharpen, the rivers stay white on white). See tools/sun3d/README.md.
--
-- Before applying: upload the 8 files named below to bucket `terrain`.
insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, note) values
  ('gt_emilys_pond_levee', 'grand_teton', 43.547, 43.4955, -110.871, -110.8035, 896, 5449, 5723, 0, 0.5, 'gt_emilys_pond_levee_z14.png', 104990, 'Public terrarium tiles, zoom 14, about 6 m a point.'),
  ('gt_taggart_bradley_lakes', 'grand_teton', 43.7555, 43.683, -110.7775, -110.6995, 1280, 6275, 8057, 0, 0.5, 'gt_taggart_bradley_lakes_z14.png', 407693, 'Public terrarium tiles, zoom 14, about 6 m a point.'),
  ('gt_glacier_view_turnout', 'grand_teton', 43.7245, 43.652, -110.7375, -110.6375, 1280, 8050, 8057, 0, 0.5, 'gt_glacier_view_turnout_z14.png', 280972, 'Public terrarium tiles, zoom 14, about 6 m a point.'),
  ('gt_swan_lake_heron', 'grand_teton', 43.9235, 43.887, -110.673, -110.623, 640, 4010, 4056, 0, 0.5, 'gt_swan_lake_heron_z14.png', 51885, 'Public terrarium tiles, zoom 14, about 6 m a point.'),
  ('gt_snake_river_overlook', 'grand_teton', 43.7715, 43.735, -110.649, -110.5985, 640, 4061, 4056, 0, 0.5, 'gt_snake_river_overlook_z14.png', 83064, 'Public terrarium tiles, zoom 14, about 6 m a point.'),
  ('gt_shane_cabins_gros', 'grand_teton', 43.662, 43.6255, -110.63, -110.5795, 640, 4068, 4056, 0, 0.5, 'gt_shane_cabins_gros_z14.png', 89584, 'Public terrarium tiles, zoom 14, about 6 m a point.'),
  ('gt_willow_flats_overlook', 'grand_teton', 43.8915, 43.848, -110.599, -110.5225, 896, 6139, 4834, 0, 0.5, 'gt_willow_flats_overlook_z14.png', 168825, 'Public terrarium tiles, zoom 14, about 7 m a point.'),
  ('gt_cunningham_cabin', 'grand_teton', 43.829, 43.7605, -110.583, -110.502, 1152, 6509, 7613, 0, 0.5, 'gt_cunningham_cabin_z14.png', 263368, 'Public terrarium tiles, zoom 14, about 7 m a point.')
on conflict (id) do nothing;
