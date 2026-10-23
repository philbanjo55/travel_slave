-- More Teton live views (Phil, 23 Oct 2026; permission already given by phone
-- for Jackson Hole Mountain Resort and Teton Science Schools):
-- two Roundshot panoramas on Rendezvous Mountain and the NPS air quality
-- camera at the TSS Kelly campus. Coordinates are map estimates.
-- WYDOT (also permitted) is not added: its picture links are one-time tokens
-- that answer a 47-49 byte placeholder to anything but its own page.
insert into webcam_cameras (code, name, island, lat, lng, hint, active, trip_id, region, image_url, source, permission_note, tz)
values
 ('GT-JHMR-SUMMIT', 'Jackson Hole summit panorama', 'Rendezvous Mountain, Teton Village, WY', 43.5958, -110.8475,
  '360-degree panorama from the top of Rendezvous Mountain (about 10,450 ft) at Jackson Hole Mountain Resort, at the south end of the Teton Range. The range runs north from here; the flat Jackson Hole valley lies east and below. Judge cloud on the peaks and fog or low cloud in the valley.',
  true, null, 'Grand Teton', 'https://backend.roundshot.com/cams/12a4b2c24cd515e0a115d4a0f59ef7f8/quarter', 'Jackson Hole Mountain Resort (Roundshot)', 'Archiving approved by phone (Phil, Oct 2026)', 'America/Denver'),
 ('GT-JHMR-RENDEZVOUS', 'Jackson Hole Rendezvous panorama', 'Rendezvous Mountain, Teton Village, WY', 43.5935, -110.8430,
  '360-degree panorama on Rendezvous Mountain at Jackson Hole Mountain Resort, south end of the Teton Range, looking over the ski terrain and down to the Jackson Hole valley. Judge cloud on the peaks and fog or low cloud in the valley.',
  true, null, 'Grand Teton', 'https://backend.roundshot.com/cams/6f7dc91857e22fe329e8bdeef5ee5750/quarter', 'Jackson Hole Mountain Resort (Roundshot)', 'Archiving approved by phone (Phil, Oct 2026)', 'America/Denver'),
 ('GT-KELLY', 'Teton Range from Kelly (air quality cam)', 'Teton Science Schools Kelly campus, WY', 43.6400, -110.6150,
  'National Park Service air quality camera at the Teton Science Schools Kelly campus, on the east side of the valley, looking west across sagebrush flats at the Teton Range. Judge cloud on the peaks and haze, fog or low cloud in the valley.',
  true, null, 'Grand Teton', 'https://www.nps.gov/featurecontent/ard/webcams/images/grtelarge.jpg', 'NPS / Teton Science Schools', 'Archiving approved by phone (Phil, Oct 2026)', 'America/Denver')
on conflict (code) do nothing;
