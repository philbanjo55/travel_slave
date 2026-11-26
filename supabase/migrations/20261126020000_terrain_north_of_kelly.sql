-- North of Kelly (Phil, 26 Nov 2026: a stop found from an Instagram reel, the spot pinned by Blacktail Butte's outline).
-- One fine (near) box over Blacktail Butte, the sage flats and the Gros Ventre Road to Kelly, so the butte draws at ~6 m
-- in the 3D view (it was on the 27 m wide grid). Built with tools/sun3d/build_dem.py (terrarium zoom 14, n 1280),
-- Bounds larger than the Glacier View box, so a shot whose subject is outside both keeps the smaller Glacier View box.
-- The Moulton barns' and Antelope Flats' 'barn from north-east' shots aim at Blacktail Butte, so those stops now draw
-- this box (the app prefers a box that holds the subject too); their 1.5 km close-up box gtd15_t_a_moulton lies inside
-- it, so it is still drawn. Winter colour (color_path) added once built. Data check PASS (7 stops' heights: middle +2.5 m, Copernicus: middle +0.8 m). File uploaded to bucket terrain first.
insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, note) values
  ('gt_north_of_kelly', 'grand_teton', 43.675, 43.600, -110.720, -110.600, 1280, 9668, 8335, 0, 0.5,
   'gt_north_of_kelly_z14.png', 343232, 'Public terrarium tiles, zoom 14, about 8 m a point.')
on conflict (id) do update set north = excluded.north, south = excluded.south, west = excluded.west, east = excluded.east,
  width_m = excluded.width_m, depth_m = excluded.depth_m, bytes = excluded.bytes, note = excluded.note;
