-- Phil, 25 Oct 2026: add Emily's Pond Levee (Day 2, after the gear pickup), Swan Lake-Heron Pond (Day 4, before
-- Colter Bay; Colter Bay to 2:30 PM) and Teton Pines (Day 6 after Cunningham; ski return to 1:00 PM), on the real
-- trip and Teton Live. Real trip: the saved ideas are moved onto their days; Teton Live reuses the set-aside copies
-- of 24 Oct and gets a new Teton Pines stop. New stops are unrated until Phil adds viewpoints. Applied base64-wrapped.
begin;
update stops set position = 7, time_label = '5:15 PM', drive_override_minutes = 15 where id = '022fe2fb-8e41-47b3-a07b-a117c0cbe38e';
update stops set position = 8 where id = '8a32f2d1-4fa3-4662-9ec3-52c84f9359ff';
update stops set position = 7, time_label = '2:30 PM', duration_minutes = 145, drive_override_minutes = 0 where id = 'f3240a23-baea-419e-af8c-957b1c713d2f';
update stops set position = 5 where id = '4a0c6bd6-a638-4286-b0e5-07bfd3344ac0';
update stops set position = 4, time_label = '1:00 PM', drive_override_minutes = 20 where id = 'ad52beaf-9a1c-466d-94b7-9f469e207794';
update stops set day_id = '843a0e31-fa1e-4076-9603-1eb54b288f81', position = 6, name = 'Emily''s Pond Levee — Sunset Ski', emoji = '⛷️', time_label = '3:00 PM', duration_minutes = 110, drive_override_minutes = 15, info = 'SKI / SNOWSHOE · easy, flat · groomed (Teton County Parks & Rec), skate and classic · free (donations) · MOVABLE
Parking: off WY-22 about 2 mi east of Wilson, just past the Snake River bridge; lot and restroom (map estimate, confirm): https://www.google.com/maps?q=43.4950,-110.8650
ROUTE: along the Snake River levee and back the same way, as far as you like. Sources disagree on length: JH Nordic ~5 km (3 mi) out and back, Hiking Project 2.7 mi one way. First 80 yards slope a little toward the river. Walkers, fat bikes and horses use it too.
VIEW: river, cottonwoods and the south end of the range. Sunset about 4:55 PM.
Check the JH Nordic trail report the day before for grooming. First go on the rental skis, straight after the gear pickup. Added by Phil, 25 Oct 2026.', movable = true where id = 'e24ab209-e8c2-429d-b9df-4d44bdec601a';
update stops set day_id = '50374065-0d29-4f0b-96fc-41496c1877cc', position = 6, name = 'Swan Lake–Heron Pond Loop', emoji = '⛷️', time_label = '12:15 PM', duration_minutes = 120, drive_override_minutes = 13, info = 'SKI / SNOWSHOE · easy, 3.0 mi loop, 300 ft (NPS ski and snowshoe handout, rev. 2/2017; AllTrails 3.2 mi, 209 ft) · MOVABLE
Parking: in front of the closed Colter Bay Visitor Center, Hermitage Point Trailhead, the same lot as the Colter Bay stop (map estimate, confirm): https://www.google.com/maps?q=43.9020,-110.6420
ROUTE: Hermitage Point trail to Heron Pond, back past Swan Lake. Not groomed, unmarked in winter. Can extend south toward Hermitage Point.
VIEW: Mt Moran across Heron Pond (backlit at midday, fine for B&W).
Added by Phil, 25 Oct 2026.', movable = true where id = 'fe08c4e1-4a37-42ba-852f-1c3eac921d92';
update stops set day_id = 'eafe2ea3-90e0-4325-924c-c1069a4b7b37', position = 3, name = 'Teton Pines Nordic Center — Groomed Ski', emoji = '⛷️', time_label = '10:15 AM', duration_minutes = 120, drive_override_minutes = 50, info = 'SKI · groomed daily, skate and classic · 16 km of loops (outer loop ~6 mi), flat to rolling · trail fee about $20–28 (2024/25) · MOVABLE
Parking: Teton Pines clubhouse on the Moose-Wilson Road; check in and buy a trail pass at the Cross Country Center on the south side of the clubhouse (map estimate, confirm): https://www.google.com/maps?q=43.5380,-110.8240
Drive from Cunningham Cabin goes round through Jackson (the middle of the Moose-Wilson Road is closed in winter), about 50 min.
VIEW: the south end of the range.
Confirm it is open Sun 3 Jan (holiday week) and the pass price. Trail map: https://jhnordic.com/trails/teton-pines-nordic-center/ Added by Phil, 25 Oct 2026.', movable = true where id = '093ce0ad-9252-4c1b-ac00-ed66a2ec5028';
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup · Emily''s Pond sunset ski' where id = '843a0e31-fa1e-4076-9603-1eb54b288f81';
update days set subtitle = 'Moulton barns at sunrise · Oxbow late morning · Heron Pond loop · Colter Bay to sunset' where id = '50374065-0d29-4f0b-96fc-41496c1877cc';
update days set subtitle = 'Oxbow sunrise · Cunningham window · Teton Pines ski · return skis · afternoon open' where id = 'eafe2ea3-90e0-4325-924c-c1069a4b7b37';
update stops set position = 7, time_label = '5:15 PM', drive_override_minutes = 15 where id = '5eb02171-3114-4747-902e-1e98e1398c6e';
update stops set position = 8 where id = 'ef208b7c-e88d-4045-ba37-bf9a42abc824';
update stops set position = 7, time_label = '2:30 PM', duration_minutes = 145, drive_override_minutes = 0 where id = 'e2177d94-5f77-42f5-9adc-45d73608fe52';
update stops set position = 5 where id = '5d372403-94d8-4fa6-810c-711af4d56192';
update stops set position = 4, time_label = '1:00 PM', drive_override_minutes = 20 where id = '65a049aa-3f0e-4976-bd7f-f04c15d8c1d0';
update stops set day_id = '7fdec3ac-ffff-4fb8-8d63-5d9981dc366a', position = 6, name = 'Emily''s Pond Levee — Sunset Ski', emoji = '⛷️', time_label = '3:00 PM', duration_minutes = 110, drive_override_minutes = 15, info = 'SKI / SNOWSHOE · easy, flat · groomed (Teton County Parks & Rec), skate and classic · free (donations) · MOVABLE
Parking: off WY-22 about 2 mi east of Wilson, just past the Snake River bridge; lot and restroom (map estimate, confirm): https://www.google.com/maps?q=43.4950,-110.8650
ROUTE: along the Snake River levee and back the same way, as far as you like. Sources disagree on length: JH Nordic ~5 km (3 mi) out and back, Hiking Project 2.7 mi one way. First 80 yards slope a little toward the river. Walkers, fat bikes and horses use it too.
VIEW: river, cottonwoods and the south end of the range. Sunset about 4:55 PM.
Check the JH Nordic trail report the day before for grooming. First go on the rental skis, straight after the gear pickup. Added by Phil, 25 Oct 2026.', movable = true where trip_id = '7e57bed0-0000-4000-8000-000000000003' and name = 'Emily''s Pond Levee — Sunset Ski';
update stops set day_id = '13a684c6-f74b-40cf-b73b-0d03522cb287', position = 6, name = 'Swan Lake–Heron Pond Loop', emoji = '⛷️', time_label = '12:15 PM', duration_minutes = 120, drive_override_minutes = 13, info = 'SKI / SNOWSHOE · easy, 3.0 mi loop, 300 ft (NPS ski and snowshoe handout, rev. 2/2017; AllTrails 3.2 mi, 209 ft) · MOVABLE
Parking: in front of the closed Colter Bay Visitor Center, Hermitage Point Trailhead, the same lot as the Colter Bay stop (map estimate, confirm): https://www.google.com/maps?q=43.9020,-110.6420
ROUTE: Hermitage Point trail to Heron Pond, back past Swan Lake. Not groomed, unmarked in winter. Can extend south toward Hermitage Point.
VIEW: Mt Moran across Heron Pond (backlit at midday, fine for B&W).
Added by Phil, 25 Oct 2026.', movable = true where trip_id = '7e57bed0-0000-4000-8000-000000000003' and name = 'Swan Lake–Heron Pond Loop';
insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable) values ('d6651858-a3e4-428b-9211-9cfe694fa654', '7e57bed0-0000-4000-8000-000000000003', 3, 'Teton Pines Nordic Center — Groomed Ski', '⛷️', '10:15 AM', 120, 50, 43.538, -110.824, 'mountain', 'SKI · groomed daily, skate and classic · 16 km of loops (outer loop ~6 mi), flat to rolling · trail fee about $20–28 (2024/25) · MOVABLE
Parking: Teton Pines clubhouse on the Moose-Wilson Road; check in and buy a trail pass at the Cross Country Center on the south side of the clubhouse (map estimate, confirm): https://www.google.com/maps?q=43.5380,-110.8240
Drive from Cunningham Cabin goes round through Jackson (the middle of the Moose-Wilson Road is closed in winter), about 50 min.
VIEW: the south end of the range.
Confirm it is open Sun 3 Jan (holiday week) and the pass price. Trail map: https://jhnordic.com/trails/teton-pines-nordic-center/ Added by Phil, 25 Oct 2026.', false, true);
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup · Emily''s Pond sunset ski' where id = '7fdec3ac-ffff-4fb8-8d63-5d9981dc366a';
update days set subtitle = 'Moulton barns at sunrise · Oxbow late morning · Heron Pond loop · Colter Bay to sunset' where id = '13a684c6-f74b-40cf-b73b-0d03522cb287';
update days set subtitle = 'Oxbow sunrise · Cunningham window · Teton Pines ski · return skis · afternoon open' where id = 'd6651858-a3e4-428b-9211-9cfe694fa654';
commit;
