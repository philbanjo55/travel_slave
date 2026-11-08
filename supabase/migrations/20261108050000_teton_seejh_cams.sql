-- 8 Nov 2026 (Phil: "Yes everything is ok"): four SeeJH live streams that look
-- at the front (Jackson Hole) side of the range, as stills from the YouTube
-- live thumbnail (like GT-MOOSE / GT-HATCHET). Checked live 8 Nov ~9:40 AM MST.
-- Positions are approximate (from each view). Pictures are saved from now;
-- Claude reads them from 1 Dec (label_paused until then: November budget).
insert into webcam_cameras (code, name, island, lat, lng, hint, active, region, image_url, source, permission_note, tz, label_paused)
values
 ('GT-LOSTCREEK', 'Teton Range from Lost Creek Ranch', 'Lost Creek Ranch, Moose, WY', 43.735, -110.585,
  'Lost Creek Ranch camera in Jackson Hole looking west across the sagebrush flats at the whole Teton Range, the Grand Teton left of centre and Mount Moran to the right. Judge whether the Grand and the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/7Li473oJI30/maxresdefault_live.jpg',
  'Lost Creek Ranch live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', true),
 ('GT-MORAN', 'Teton Range from Moran (Buffalo Valley)', 'Buffalo Valley, east of Moran Junction, WY', 43.820, -110.450,
  'Camera above Buffalo Valley near Moran looking west at the Teton Range, the Grand Teton in the centre and the northern peaks to the right. Judge whether the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/Jqo7Z9QiOEQ/maxresdefault_live.jpg',
  'Teton Range, Moran live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', true),
 ('GT-EGVB', 'Teton Range from East Gros Ventre Butte', 'East Gros Ventre Butte, Jackson, WY', 43.505, -110.790,
  'Camera on East Gros Ventre Butte near Jackson looking north-west up the valley at the southern Teton Range, the resort on the left and the Grand Teton group in the distance right of centre. Judge whether the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/j-0fhrHzEiM/maxresdefault_live.jpg',
  'Grand Tetons PTZ live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', true),
 ('GT-GOLF', 'Teton Range from Jackson Hole Golf & Tennis', 'Jackson Hole Golf & Tennis, north of Jackson, WY', 43.585, -110.758,
  'Camera at Jackson Hole Golf & Tennis looking north-west over the course at the Teton Range, the Grand Teton in the centre. Judge whether the Grand and the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/3mE_mpsx_nU/maxresdefault_live.jpg',
  'Jackson Hole Golf & Tennis live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', true)
on conflict (code) do nothing;

-- Start reading them at midnight Jackson time on 1 Dec (07:05 UTC), then the job removes itself.
select cron.schedule('teton-seejh-read-dec', '5 7 1 12 *', $job$
  update webcam_cameras set label_paused = false where code in ('GT-LOSTCREEK','GT-MORAN','GT-EGVB','GT-GOLF');
  select cron.unschedule('teton-seejh-read-dec');
$job$);
