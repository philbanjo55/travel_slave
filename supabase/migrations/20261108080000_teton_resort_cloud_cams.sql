-- 8 Nov 2026 (Phil: only a few that help see cloud levels): two high Jackson Hole
-- Mountain Resort cameras (resort's own webcams, cams.jacksonhole.com; the resort
-- said its pictures are public and fine to use), live this morning. Picture-only
-- (label_paused): they show the resort ridge, not the Grand, so they must not vote
-- on whether the peaks are visible; they show whether the cloud base is below
-- ~3,000 m. Positions approximate. Town View (Snow King summit) was frozen in the
-- 8 Nov check, so it is left out for now.
insert into webcam_cameras (code, name, island, lat, lng, hint, active, region, image_url, source, permission_note, tz, label_paused)
values
 ('GT-JHMR-CODYBOWL', 'Cody Bowl, Jackson Hole Mountain Resort', 'Jackson Hole Mountain Resort, upper mountain', 43.596, -110.862,
  'Resort camera high on Jackson Hole Mountain Resort looking at the snowy ridge around Cody Bowl. Judge whether the ridge tops are clear or in cloud.',
  true, 'Grand Teton', 'https://cams.jacksonhole.com/webcam/codybowl.jpg',
  'Jackson Hole Mountain Resort webcam (cams.jacksonhole.com, listed on SeeJH)', 'Resort pictures public and fine to use: Phil (6 Nov 2026); added 8 Nov 2026', 'America/Denver', true),
 ('GT-JHMR-TETONLIFT', 'Top of the Teton lift, Jackson Hole Mountain Resort', 'Jackson Hole Mountain Resort, Teton lift summit', 43.611, -110.860,
  'Resort camera at the top of the Teton lift looking east over Jackson Hole from high on the range. Judge whether the camera is in cloud and where the cloud sits below or above it.',
  true, 'Grand Teton', 'https://cams.jacksonhole.com/webcam/teton_lift_summit.jpg',
  'Jackson Hole Mountain Resort webcam (cams.jacksonhole.com, listed on SeeJH)', 'Resort pictures public and fine to use: Phil (6 Nov 2026); added 8 Nov 2026', 'America/Denver', true)
on conflict (code) do nothing;
