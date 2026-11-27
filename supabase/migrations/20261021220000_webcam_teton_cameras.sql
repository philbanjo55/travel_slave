-- First Grand Teton cameras (Phil phoned the owners and got permission, Oct
-- 2026). Cameras belong to a place, not a trip: any trip with stops within
-- 50 km uses them (solver-actions MAX_CAMERA_KM, backtest 12 km).
--   GT-MOOSE: NPS / Grand Teton National Park Foundation livestream at the
--     Craig Thomas Discovery & Visitor Center, Moose; still taken from the
--     YouTube live thumbnail.
--   GT-TETONIA: TetonCam, Tetonia, Idaho (west face, Teton Valley).
insert into public.webcam_cameras (code, name, island, region, source, image_url, lat, lng, tz, active, permission_note, hint)
values
  ('GT-MOOSE', 'Teton Range from Moose', 'Moose, WY', 'Grand Teton', 'NPS / Grand Teton National Park Foundation',
   'https://i.ytimg.com/vi/XhBUrjhJm1A/maxresdefault_live.jpg', 43.6545, -110.7172, 'America/Denver', true,
   'Archiving approved by phone (Phil, Oct 2026)',
   'Craig Thomas Visitor Center at Moose, looking west at the Teton Range over sagebrush flats. Judge cloud on the peaks and fog or haze in the valley.'),
  ('GT-TETONIA', 'TetonCam, Tetonia', 'Tetonia, ID', 'Grand Teton', 'TetonCam',
   'https://images.tetoncam.com/panorama.jpg', 43.8135, -111.1580, 'America/Denver', true,
   'Archiving approved by phone (Phil, Oct 2026)',
   'Tetonia, Idaho, looking east across Teton Valley farmland at the west face of the Teton Range. Judge cloud on the peaks and fog in the valley.')
on conflict (code) do nothing;
