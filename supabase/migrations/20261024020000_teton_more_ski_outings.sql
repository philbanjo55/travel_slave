-- Phil, 24 Oct 2026: a ski or snowshoe outing every full day (real trip and Teton Live).
-- Day 2 Emily's Pond Levee at sunset, Day 4 Swan Lake-Heron Pond before Colter Bay, Day 5 Phelps Lake Overlook
-- in the afternoon, Day 6 the groomed Teton Park Road (Sunday grooming); ski return moved to Day 7 morning.
-- Real trip: the three saved ideas are moved onto their days (UPDATE); Teton Live gets copies. New stops are
-- unrated (no tier, no shot) until Phil picks viewpoints. Applied base64-wrapped (MCP connector, see CLAUDE.md).
begin;
update stops set position = 7, time_label = '5:15 PM', drive_override_minutes = 15 where id = '022fe2fb-8e41-47b3-a07b-a117c0cbe38e';
update stops set position = 8 where id = '8a32f2d1-4fa3-4662-9ec3-52c84f9359ff';
update stops set position = 7, time_label = '2:30 PM', duration_minutes = 145, drive_override_minutes = 0 where id = 'f3240a23-baea-419e-af8c-957b1c713d2f';
update stops set position = 4, time_label = '4:40 PM', drive_override_minutes = 35 where id = '63c6bed6-6fb1-4863-bca1-5471e29faf51';
update stops set position = 4, drive_override_minutes = 27 where id = '4a0c6bd6-a638-4286-b0e5-07bfd3344ac0';
update stops set position = 5 where id = '35a0dccd-1db7-47c0-9dac-992cd00ae40b';
update stops set position = 4, drive_override_minutes = 25 where id = '10c370a1-acfb-46a2-8db0-bf738b304f63';
update stops set day_id = '55f87e81-41f3-4cb5-bca6-94da23d83a49', position = 3, time_label = '9:00 AM', drive_override_minutes = 30, info = 'Moved to Mon 4 Jan, before the flight (Phil, 24 Oct 2026): rental not booked yet; book Wed 30 Dec to Mon 4 Jan and check the shop''s Monday opening time.
' || coalesce(info, '') where id = 'ad52beaf-9a1c-466d-94b7-9f469e207794';
update stops set info = 'Rental runs Wed 30 Dec to Mon 4 Jan (returned Day 7 before the flight). Not booked yet (Phil, 24 Oct 2026).
' || coalesce(info, '') where id = 'e8cd127e-cee8-4376-a8a2-7a4808513019';
update stops set day_id = '843a0e31-fa1e-4076-9603-1eb54b288f81', position = 6, name = 'Emily''s Pond Levee — Sunset Ski', emoji = '⛷️', time_label = '3:00 PM', duration_minutes = 110, drive_override_minutes = 15, info = 'SKI / SNOWSHOE · easy, flat · MOVABLE
Parking: the levee access at Wilson by the Snake River bridge on WY-22 (map estimate, confirm): https://www.google.com/maps?q=43.4950,-110.8650
ROUTE: along the Snake River levee as far as you like and back the same way, 2 to 4.5 mi (sources disagree). Outside the park, not groomed. First go on the rental skis.
VIEW: river, cottonwoods and the south end of the range. Sunset about 4:55 PM.
Needs the gear pickup done by about 2:45 PM. From local ski and snowshoe guides (JH Nordic Alliance, Jackson Hole Chamber). Added by Phil, 24 Oct 2026.', movable = true where id = 'e24ab209-e8c2-429d-b9df-4d44bdec601a';
update stops set day_id = '50374065-0d29-4f0b-96fc-41496c1877cc', position = 6, name = 'Swan Lake–Heron Pond Loop', emoji = '⛷️', time_label = '12:15 PM', duration_minutes = 120, drive_override_minutes = 13, info = 'SKI / SNOWSHOE · easy, 3.0 mi loop, 300 ft (NPS ski and snowshoe handout, rev. 2/2017) · MOVABLE
Parking: in front of the closed Colter Bay Visitor Center, Hermitage Point Trailhead, the same lot as the Colter Bay stop (map estimate, confirm): https://www.google.com/maps?q=43.9020,-110.6420
ROUTE: Hermitage Point trail to Heron Pond, back past Swan Lake. Not groomed, unmarked in winter. Can extend south toward Hermitage Point.
VIEW: Mt Moran across Heron Pond.
Added by Phil, 24 Oct 2026.', movable = true where id = 'fe08c4e1-4a37-42ba-852f-1c3eac921d92';
update stops set day_id = 'a9719a71-29c8-4d78-99ea-bd973bac7c97', position = 3, name = 'Phelps Lake Overlook', emoji = '⛷️', time_label = '12:30 PM', duration_minutes = 210, drive_override_minutes = 20, info = 'SKI / SNOWSHOE · moderate, 5.2 mi round trip, 730 ft (NPS ski and snowshoe handout, rev. 2/2017) · MOVABLE
Parking: Moose-Wilson Road about 3 mi south of the Moose visitor center, at the Death Canyon Road gate, west side (map estimate, confirm): https://www.google.com/maps?q=43.6556,-110.7790
ROUTE: up to the overlook above Phelps Lake and back the same way. Not groomed, unmarked in winter. Shorter option: Phelps Lake shore, 4.0 mi, 300 ft, same start.
VIEW: down onto Phelps Lake and up into Death Canyon (south end of the range). Afternoon sun is behind the range.
Confirm the Moose-Wilson Road is plowed to the gate this winter. Added by Phil, 24 Oct 2026.', movable = true where id = 'a32d49b4-f969-448a-a1c6-f246369d90bb';
insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable) values ('eafe2ea3-90e0-4325-924c-c1069a4b7b37', '5e247891-d800-4d07-b5e0-8ad748ae2754', 3, 'Teton Park Road — Groomed Ski', '⛷️', '10:00 AM', 210, 30, 43.693, -110.733, 'mountain', 'SKI · easy, flat to rolling, as far as you like · MOVABLE
Parking: Taggart Lake Trailhead (end of plowing): https://www.google.com/maps?q=43.6930,-110.7330
ROUTE: north on the closed Teton Park Road toward South Jenny Lake (about 4.4 mi one way) and back the same way. Sunday is the grooming day for the Taggart to South Jenny Lake section (4 lanes), so fresh tracks; confirm on the grooming line 307-739-3682. One lane is ski only, the other is for walking and snowshoes.
VIEW: the range the whole way, morning light on the east faces.
Added by Phil, 24 Oct 2026.', false, true);
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup · Emily''s Pond sunset ski' where id = '843a0e31-fa1e-4076-9603-1eb54b288f81';
update days set subtitle = 'Moulton barns at sunrise · Oxbow late morning · Heron Pond loop · Colter Bay to sunset' where id = '50374065-0d29-4f0b-96fc-41496c1877cc';
update days set subtitle = 'Taggart + Bradley sunrise · Phelps Lake Overlook afternoon' where id = 'a9719a71-29c8-4d78-99ea-bd973bac7c97';
update days set subtitle = 'Oxbow sunrise · Cunningham window · groomed road ski · afternoon open' where id = 'eafe2ea3-90e0-4325-924c-c1069a4b7b37';
update days set subtitle = 'SRO reshoot · Teton Point · ski return · Glacier View · JAC 4:19 PM' where id = '55f87e81-41f3-4cb5-bca6-94da23d83a49';
update stops set position = 7, time_label = '5:15 PM', drive_override_minutes = 15 where id = '5eb02171-3114-4747-902e-1e98e1398c6e';
update stops set position = 8 where id = 'ef208b7c-e88d-4045-ba37-bf9a42abc824';
update stops set position = 7, time_label = '2:30 PM', duration_minutes = 145, drive_override_minutes = 0 where id = 'e2177d94-5f77-42f5-9adc-45d73608fe52';
update stops set position = 4, time_label = '4:40 PM', drive_override_minutes = 35 where id = '110f4442-ce3e-4f03-ad84-acea1618346a';
update stops set position = 4, drive_override_minutes = 27 where id = '5d372403-94d8-4fa6-810c-711af4d56192';
update stops set position = 5 where id = 'b592e1e7-455d-49a0-bbb7-c18646db4b92';
update stops set position = 4, drive_override_minutes = 25 where id = '75d5662a-1978-4c23-9e44-977f642f00e4';
update stops set day_id = 'c0acd1d5-4dbe-4bc1-9354-b5ca2bc0beb1', position = 3, time_label = '9:00 AM', drive_override_minutes = 30, info = 'Moved to Mon 4 Jan, before the flight (Phil, 24 Oct 2026): rental not booked yet; book Wed 30 Dec to Mon 4 Jan and check the shop''s Monday opening time.
' || coalesce(info, '') where id = '65a049aa-3f0e-4976-bd7f-f04c15d8c1d0';
update stops set info = 'Rental runs Wed 30 Dec to Mon 4 Jan (returned Day 7 before the flight). Not booked yet (Phil, 24 Oct 2026).
' || coalesce(info, '') where id = 'f901bcf5-2213-4969-ae38-611a9bcaa5a3';
insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable) values ('7fdec3ac-ffff-4fb8-8d63-5d9981dc366a', '7e57bed0-0000-4000-8000-000000000003', 6, 'Emily''s Pond Levee — Sunset Ski', '⛷️', '3:00 PM', 110, 15, 43.495, -110.865, 'mountain', 'SKI / SNOWSHOE · easy, flat · MOVABLE
Parking: the levee access at Wilson by the Snake River bridge on WY-22 (map estimate, confirm): https://www.google.com/maps?q=43.4950,-110.8650
ROUTE: along the Snake River levee as far as you like and back the same way, 2 to 4.5 mi (sources disagree). Outside the park, not groomed. First go on the rental skis.
VIEW: river, cottonwoods and the south end of the range. Sunset about 4:55 PM.
Needs the gear pickup done by about 2:45 PM. From local ski and snowshoe guides (JH Nordic Alliance, Jackson Hole Chamber). Added by Phil, 24 Oct 2026.', false, true);
insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable) values ('13a684c6-f74b-40cf-b73b-0d03522cb287', '7e57bed0-0000-4000-8000-000000000003', 6, 'Swan Lake–Heron Pond Loop', '⛷️', '12:15 PM', 120, 13, 43.902, -110.642, 'mountain', 'SKI / SNOWSHOE · easy, 3.0 mi loop, 300 ft (NPS ski and snowshoe handout, rev. 2/2017) · MOVABLE
Parking: in front of the closed Colter Bay Visitor Center, Hermitage Point Trailhead, the same lot as the Colter Bay stop (map estimate, confirm): https://www.google.com/maps?q=43.9020,-110.6420
ROUTE: Hermitage Point trail to Heron Pond, back past Swan Lake. Not groomed, unmarked in winter. Can extend south toward Hermitage Point.
VIEW: Mt Moran across Heron Pond.
Added by Phil, 24 Oct 2026.', false, true);
insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable) values ('3c0a0177-fe0a-49e1-a9f5-68696f3eceba', '7e57bed0-0000-4000-8000-000000000003', 3, 'Phelps Lake Overlook', '⛷️', '12:30 PM', 210, 20, 43.6556, -110.779, 'mountain', 'SKI / SNOWSHOE · moderate, 5.2 mi round trip, 730 ft (NPS ski and snowshoe handout, rev. 2/2017) · MOVABLE
Parking: Moose-Wilson Road about 3 mi south of the Moose visitor center, at the Death Canyon Road gate, west side (map estimate, confirm): https://www.google.com/maps?q=43.6556,-110.7790
ROUTE: up to the overlook above Phelps Lake and back the same way. Not groomed, unmarked in winter. Shorter option: Phelps Lake shore, 4.0 mi, 300 ft, same start.
VIEW: down onto Phelps Lake and up into Death Canyon (south end of the range). Afternoon sun is behind the range.
Confirm the Moose-Wilson Road is plowed to the gate this winter. Added by Phil, 24 Oct 2026.', false, true);
insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable) values ('d6651858-a3e4-428b-9211-9cfe694fa654', '7e57bed0-0000-4000-8000-000000000003', 3, 'Teton Park Road — Groomed Ski', '⛷️', '10:00 AM', 210, 30, 43.693, -110.733, 'mountain', 'SKI · easy, flat to rolling, as far as you like · MOVABLE
Parking: Taggart Lake Trailhead (end of plowing): https://www.google.com/maps?q=43.6930,-110.7330
ROUTE: north on the closed Teton Park Road toward South Jenny Lake (about 4.4 mi one way) and back the same way. Sunday is the grooming day for the Taggart to South Jenny Lake section (4 lanes), so fresh tracks; confirm on the grooming line 307-739-3682. One lane is ski only, the other is for walking and snowshoes.
VIEW: the range the whole way, morning light on the east faces.
Added by Phil, 24 Oct 2026.', false, true);
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup · Emily''s Pond sunset ski' where id = '7fdec3ac-ffff-4fb8-8d63-5d9981dc366a';
update days set subtitle = 'Moulton barns at sunrise · Oxbow late morning · Heron Pond loop · Colter Bay to sunset' where id = '13a684c6-f74b-40cf-b73b-0d03522cb287';
update days set subtitle = 'Taggart + Bradley sunrise · Phelps Lake Overlook afternoon' where id = '3c0a0177-fe0a-49e1-a9f5-68696f3eceba';
update days set subtitle = 'Oxbow sunrise · Cunningham window · groomed road ski · afternoon open' where id = 'd6651858-a3e4-428b-9211-9cfe694fa654';
update days set subtitle = 'SRO reshoot · Teton Point · ski return · Glacier View · JAC 4:19 PM' where id = 'c0acd1d5-4dbe-4bc1-9354-b5ca2bc0beb1';
commit;
