-- 7 Nov 2026: two of the 6 Nov Teton cameras had dead addresses (copied from NWS Riverton's
-- out-of-date Teton cams page). Same cameras, current addresses, same permission (Phil, 6 Nov).
-- Hatchet Resort now streams on YouTube (SeeJH, streams.seejh.com/hatchet-resort): live thumbnail,
-- like GT-MOOSE. Climbers' Ranch: the AAC's own camera address (americanalpineclub.org/gtcr-webcam);
-- icons.wunderground.com no longer resolves. It timed out on 7 Nov (offline outside summer).
-- GT-ANTELOPE (Vaisala) left as is: it times out from the server too.
update webcam_cameras set image_url = 'https://i.ytimg.com/vi/pUQf75fPvzE/maxresdefault_live.jpg',
       source = 'Hatchet Resort live stream (SeeJH, YouTube), listed by NWS Riverton'
 where code = 'GT-HATCHET';
update webcam_cameras set image_url = 'http://cameras.americanalpineclub.org/cameras/gtcr/webcam.jpg',
       source = 'American Alpine Club (americanalpineclub.org/gtcr-webcam)'
 where code = 'GT-CLIMBERS';
