-- Worksheet F2/F3 (Phil, 6 Nov 2026: the cameras are public and free to use). Teton: Antelope Flats road
-- weather station, Climbers' Ranch, Hatchet Resort (addresses from NWS Riverton's Teton cams page). Faroes:
-- 29 more Landsverk views (www.lv.fo/tmp/<code>.jpg, names from landsverk.fo vevmyndatol), road-only and frozen
-- views left out; saved hourly, read later (label_paused).
insert into webcam_cameras (code, name, island, lat, lng, hint, active, trip_id, region, image_url, source, permission_note, tz, label_paused) values
('GT-ANTELOPE','Antelope Flats road weather station','US 89/191 at Antelope Flats, WY',43.664,-110.716,
 'Road weather station camera on the highway at Antelope Flats, in the open sagebrush valley east of the Teton Range. It may look along the road; judge the Teton peaks and any valley fog or low cloud where they show.',
 true,null,'Grand Teton','https://birice.vaisala.com/photos/036F71CE_0641440C_cam1.jpg','WYDOT road weather (Vaisala), listed by NWS Riverton','Public, free to use: confirmed by Phil (6 Nov 2026)','America/Denver',false),
('GT-CLIMBERS','Grand Teton Climbers'' Ranch','American Alpine Club Climbers'' Ranch, Moose, WY',43.712,-110.737,
 'American Alpine Club camera at the Grand Teton Climbers'' Ranch, close under the Teton Range. Judge whether the peaks are visible to their tops and where the cloud sits on them. Often offline outside summer.',
 true,null,'Grand Teton','https://icons.wunderground.com/webcamramdisk/g/t/GTCR/1/current.jpg','American Alpine Club (via Weather Underground)','Public, free to use: confirmed by Phil (6 Nov 2026)','America/Denver',false),
('GT-HATCHET','Mount Moran from Hatchet Resort','Hatchet Resort, east of Moran Junction, WY',43.84,-110.36,
 'Hatchet Resort camera east of Moran Junction looking west at Mount Moran and the northern Teton Range. Judge whether Mount Moran and the peaks are visible to their tops.',
 true,null,'Grand Teton','https://www.hatchetresort.com/webcam/camera1.1.jpg','Hatchet Resort, listed by NWS Riverton','Public, free to use: confirmed by Phil (6 Nov 2026)','America/Denver',false)
on conflict (code) do nothing;
insert into webcam_cameras (code, name, island, lat, lng, hint, active, trip_id, region, image_url, source, permission_note, tz, label_paused)
select v.code, v.name, v.island, v.lat, v.lng, v.hint, true, null, 'Faroe Islands', 'https://www.lv.fo/tmp/' || v.code || '.jpg', 'Landsverk',
       'Public, free to use: confirmed by Phil (6 Nov 2026)', 'Atlantic/Faroe', true
from (values
 ('F-10','Kambsdalur','Eysturoy',62.22,-6.82,'Road above a fjord with a town and fish farms. Judge the hills across the fjord.'),
 ('F-12','Høgareyn','Streymoy',61.99,-6.84,'Road above a fjord. Judge the hills across the water and the sky.'),
 ('F-21','Sund','Streymoy',62.06,-6.82,'Road along a hillside above a harbour. Judge the hillsides and any sky in view.'),
 ('F-24','Klaksvík','Borðoy',62.23,-6.58,'Road at the edge of a village by the sea. Judge the hills behind and across the water.'),
 ('F-25','Brekkan Stóra','Sandoy',61.85,-6.80,'Road over moorland with the sea behind. Judge the hills and the sea horizon.'),
 ('F-27','Porkerishálsur','Suðuroy',61.47,-6.75,'Mountain road over a pass. Judge the ridges and the sky.'),
 ('F-28','Krambatangi, bilrað','Suðuroy',61.55,-6.79,'Ferry terminal car lanes with the village and hillside behind. Judge the hillside and the sky.'),
 ('F-29','Skopun, portur','Sandoy',61.90,-6.88,'Harbour with islands and cliffs on the horizon. Judge the distant islands and their tops.'),
 ('F-36','Kollafjørður, norðuri í Sundum','Streymoy',62.12,-6.93,'Road along a steep valley side. Judge the ridge line and the sky.'),
 ('F-40','Viðareiðisvegurin','Viðoy',62.33,-6.53,'Coastal road with the sea and village. Judge the hills and the sea horizon.'),
 ('F-44','Hvalba','Suðuroy',61.60,-6.94,'Road by a lake with cliffs behind. Judge the cliffs and the hills.'),
 ('F-45','Streymnes','Streymoy',62.19,-7.02,'Road into a village under a steep mountainside. Judge whether the mountain tops are clear or in cloud.'),
 ('F-48','við Velbastaðháls','Streymoy',61.99,-6.83,'Road over a pass with hills on both sides. Judge the hilltops and the sky.')
) v(code, name, island, lat, lng, hint)
on conflict (code) do nothing;
insert into webcam_cameras (code, name, island, lat, lng, hint, active, trip_id, region, image_url, source, permission_note, tz, label_paused)
select v.code, v.name, v.island, coalesce(p.lat, v.lat), coalesce(p.lng, v.lng), v.hint, true, null, 'Faroe Islands', 'https://www.lv.fo/tmp/' || v.code || '.jpg', 'Landsverk',
       'Public, free to use: confirmed by Phil (6 Nov 2026)', 'Atlantic/Faroe', true
from (values
 ('F-26-1','Syðradalur, Atløga','Streymoy',null::float8,null::float8,'F-26','Ferry quay looking across the sound at the Kalsoy mountains. Judge whether the peaks are clear to their tops.'),
 ('F-28-1','Krambatangi, Atløga','Suðuroy',null,null,'F-28','Ferry quay looking up the fjord at Tvøroyri and the hills. Judge the hilltops.'),
 ('F-28-2','Krambatangi, Lítli hólmur','Suðuroy',null,null,'F-28','Quay looking across the fjord at the village and hills. Judge the hilltops.'),
 ('F-29-2','Skopun, innsigling','Sandoy',null,null,'F-29','Harbour entrance with cliffs across the water. Judge the cliffs and hilltops.'),
 ('F-29-1','Skopun, bátahylur','Sandoy',null,null,'F-29','Small boat harbour with the village and hillside behind. Judge the hillside and the sky.'),
 ('F-39-1','Gøtueiði, suður','Eysturoy',62.17,-6.78,null,'Road over the Gøtueiði isthmus looking at the high Eysturoy mountains. Judge whether the peaks are clear or in cloud.'),
 ('F-39-2','Gøtueiði, norður','Eysturoy',62.17,-6.78,null,'Road over the Gøtueiði isthmus looking north at the mountains. Judge whether the peaks are clear or in cloud.'),
 ('F-42-1','Gjáarskarð','Eysturoy',null,null,'F-42','Mountain road under a high peak. Judge whether the peak is clear or in cloud.'),
 ('F-25-2','Brekkan Stóra','Sandoy',null,null,'F-25','Hillside looking out to sea at the islands. Judge the islands and their tops.'),
 ('F-47-1','Mykines, lending 2','Mykines',null,null,'F-47','Mykines landing with sea cliffs. Judge the cliffs, the sea and the sky.'),
 ('F-23-1','Vatnsoyrar, vegur','Vágar',null,null,'F-23','Road past the lake with hills behind. Judge the hills and the sky.'),
 ('F-40-1','Viðareiðisvegurin','Viðoy',62.33,-6.53,null,'Hill road on Viðoy. Judge the hillsides and the sky.'),
 ('F-43-1','Oyndarfjørður, Heltnin','Eysturoy',null,null,'F-43','Road over a hillside. Judge the hill and the sky.'),
 ('P-2','Hattarvík','Fugloy',62.33,-6.28,null,'Harbour under sea cliffs on Fugloy. Judge the cliffs and the hilltops.'),
 ('P-4','Víkin, Svínoy','Svínoy',62.28,-6.33,null,'Landing on Svínoy looking at a headland across the bay. Judge the headland and the sea horizon.'),
 ('P-5','Eiði, Svínoy','Svínoy',62.27,-6.35,null,'Svínoy quay looking at high cliffs across the sound. Judge whether the cliff tops are clear.')
) v(code, name, island, lat, lng, parent, hint)
left join webcam_cameras p on p.code = v.parent
on conflict (code) do nothing;
