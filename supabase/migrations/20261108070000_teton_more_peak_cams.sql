-- 8 Nov 2026 (Phil: add them all, read every camera that shows the peaks): three more SeeJH
-- streams that look at the Teton peaks, live this morning (printed times 9:46-9:50 AM MST).
-- Read from now. Positions approximate. The Idaho-side two look at the back of the range,
-- like GT-TETONIA.
insert into webcam_cameras (code, name, island, lat, lng, hint, active, region, image_url, source, permission_note, tz, label_paused)
values
 ('GT-DORNANS', 'Teton Range from Dornan''s, Moose', 'Dornan''s, Moose, WY', 43.659, -110.716,
  'Camera at Dornan''s in Moose looking west over the sagebrush at the Teton Range, the Grand Teton right of centre. Judge whether the Grand and the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/o4fKtgPVpoU/maxresdefault_live.jpg',
  'Dornan''s live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', false),
 ('GT-IDAHO', 'Grand Teton from the Idaho side', 'Teton Valley, ID (Thistle Dew Cabin)', 43.800, -111.100,
  'Camera in Teton Valley, Idaho, looking east across farmland at the back (west) side of the Teton Range, the Grand Teton the tallest peak in the centre. Judge whether the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/r-7zA9fAg1c/maxresdefault_live.jpg',
  'Grand Tetons Idaho side live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', false),
 ('GT-TARGHEE-SUMMIT', 'Grand Teton from Grand Targhee summit', 'Grand Targhee Resort summit, WY', 43.784, -110.942,
  'Camera at the summit of Grand Targhee Resort looking east at the back (west) side of the Grand Teton, close up, over snowy ridges. Judge whether the Grand and the peaks are visible to their tops.',
  true, 'Grand Teton', 'https://i.ytimg.com/vi/a5jEZeNTAsE/maxresdefault_live.jpg',
  'Grand Targhee summit live stream (SeeJH, YouTube)', 'Public, free to use: confirmed by Phil (8 Nov 2026)', 'America/Denver', false)
on conflict (code) do nothing;
