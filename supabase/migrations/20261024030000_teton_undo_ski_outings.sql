-- Phil, 24 Oct 2026: undo 20261024020000_teton_more_ski_outings (added without his approval).
-- Everything back as it was; stops are never deleted, so the inserted groomed-road stop (and the Teton Live
-- copies) are set aside (no day). Applied base64-wrapped (MCP connector, see CLAUDE.md).
begin;
update stops set day_id = null, position = 0, name = 'Idea: Emily''s Pond Levee, Wilson (ski/snowshoe)', time_label = null, duration_minutes = null, drive_override_minutes = null, info = 'IDEA (not scheduled), saved 23 Oct 2026 from local ski and snowshoe guides (JH Nordic Alliance, Jackson Hole Chamber); details vary between sources. Easy and flat, 2 to 4.5 mi (sources disagree) on the Snake River levee at Wilson. River and cottonwoods in front, the south end of the Tetons behind (map estimate, confirm).' where id = 'e24ab209-e8c2-429d-b9df-4d44bdec601a';
update stops set day_id = null, position = 0, name = 'Idea: Swan Lake-Heron Pond Loop (ski/snowshoe)', time_label = null, duration_minutes = null, drive_override_minutes = null, info = 'IDEA (not scheduled), saved 23 Oct 2026 from the NPS ski and snowshoe handout (rev. 2/2017). Easy, 3.0 mi loop, 300 ft climbing; can extend south toward Hermitage Point. Start: Hermitage Point Trailhead, park in front of the closed Colter Bay Visitor Center (map estimate, confirm). Pairs with the Day 4 Colter Bay stop.' where id = 'fe08c4e1-4a37-42ba-852f-1c3eac921d92';
update stops set day_id = null, position = 0, name = 'Idea: Phelps Lake Overlook (ski/snowshoe)', time_label = null, duration_minutes = null, drive_override_minutes = null, info = 'IDEA (not scheduled), saved 23 Oct 2026 from the NPS ski and snowshoe handout (rev. 2/2017). Moderate, 5.2 mi round trip, 730 ft climbing. Start: Moose-Wilson Road, 3 mi south of the Moose visitor center at the Death Canyon Road gate; park on the west side (map estimate, confirm).' where id = 'a32d49b4-f969-448a-a1c6-f246369d90bb';
update stops set day_id = null, position = 0 where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and name = 'Teton Park Road — Groomed Ski';
update stops set position = 6, time_label = '2:30 PM', drive_override_minutes = 4 where id = '022fe2fb-8e41-47b3-a07b-a117c0cbe38e';
update stops set position = 6, time_label = '1:00 PM', duration_minutes = 230, drive_override_minutes = 13 where id = 'f3240a23-baea-419e-af8c-957b1c713d2f';
update stops set position = 7 where id = '8a32f2d1-4fa3-4662-9ec3-52c84f9359ff';
update stops set position = 3, time_label = '6:00 PM', drive_override_minutes = 27 where id = '63c6bed6-6fb1-4863-bca1-5471e29faf51';
update stops set day_id = 'eafe2ea3-90e0-4325-924c-c1069a4b7b37', position = 3, time_label = '11:30 AM', drive_override_minutes = 39 where id = 'ad52beaf-9a1c-466d-94b7-9f469e207794';
update stops set position = 4, drive_override_minutes = 4 where id = '4a0c6bd6-a638-4286-b0e5-07bfd3344ac0';
update stops set position = 3, drive_override_minutes = 3 where id = '10c370a1-acfb-46a2-8db0-bf738b304f63';
update stops set position = 4 where id = '35a0dccd-1db7-47c0-9dac-992cd00ae40b';
update stops set info = substr(info, 153 + 1) where id = 'ad52beaf-9a1c-466d-94b7-9f469e207794' and left(info, 153) = 'Moved to Mon 4 Jan, before the flight (Phil, 24 Oct 2026): rental not booked yet; book Wed 30 Dec to Mon 4 Jan and check the shop''s Monday opening time.
';
update stops set info = substr(info, 108 + 1) where id = 'e8cd127e-cee8-4376-a8a2-7a4808513019' and left(info, 108) = 'Rental runs Wed 30 Dec to Mon 4 Jan (returned Day 7 before the flight). Not booked yet (Phil, 24 Oct 2026).
';
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup' where id = '843a0e31-fa1e-4076-9603-1eb54b288f81';
update days set subtitle = 'Moulton barns at sunrise · Oxbow late morning · Jackson Lake · Colter Bay to sunset' where id = '50374065-0d29-4f0b-96fc-41496c1877cc';
update days set subtitle = 'Taggart Lake sunrise · rest of the day open' where id = 'a9719a71-29c8-4d78-99ea-bd973bac7c97';
update days set subtitle = 'Oxbow sunrise · Cunningham window · return skis · afternoon open' where id = 'eafe2ea3-90e0-4325-924c-c1069a4b7b37';
update days set subtitle = 'SRO reshoot · Teton Point · Glacier View · JAC 4:19 PM' where id = '55f87e81-41f3-4cb5-bca6-94da23d83a49';
update stops set day_id = null, position = 0 where trip_id = '7e57bed0-0000-4000-8000-000000000003' and name in ('Emily''s Pond Levee — Sunset Ski', 'Swan Lake–Heron Pond Loop', 'Phelps Lake Overlook', 'Teton Park Road — Groomed Ski');
update stops set position = 6, time_label = '2:30 PM', drive_override_minutes = 4 where id = '5eb02171-3114-4747-902e-1e98e1398c6e';
update stops set position = 6, time_label = '1:00 PM', duration_minutes = 230, drive_override_minutes = 13 where id = 'e2177d94-5f77-42f5-9adc-45d73608fe52';
update stops set position = 7 where id = 'ef208b7c-e88d-4045-ba37-bf9a42abc824';
update stops set position = 3, time_label = '6:00 PM', drive_override_minutes = 27 where id = '110f4442-ce3e-4f03-ad84-acea1618346a';
update stops set day_id = 'd6651858-a3e4-428b-9211-9cfe694fa654', position = 3, time_label = '11:30 AM', drive_override_minutes = 39 where id = '65a049aa-3f0e-4976-bd7f-f04c15d8c1d0';
update stops set position = 4, drive_override_minutes = 4 where id = '5d372403-94d8-4fa6-810c-711af4d56192';
update stops set position = 3, drive_override_minutes = 3 where id = '75d5662a-1978-4c23-9e44-977f642f00e4';
update stops set position = 4 where id = 'b592e1e7-455d-49a0-bbb7-c18646db4b92';
update stops set info = substr(info, 153 + 1) where id = '65a049aa-3f0e-4976-bd7f-f04c15d8c1d0' and left(info, 153) = 'Moved to Mon 4 Jan, before the flight (Phil, 24 Oct 2026): rental not booked yet; book Wed 30 Dec to Mon 4 Jan and check the shop''s Monday opening time.
';
update stops set info = substr(info, 108 + 1) where id = 'f901bcf5-2213-4969-ae38-611a9bcaa5a3' and left(info, 108) = 'Rental runs Wed 30 Dec to Mon 4 Jan (returned Day 7 before the flight). Not booked yet (Phil, 24 Oct 2026).
';
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup' where id = '7fdec3ac-ffff-4fb8-8d63-5d9981dc366a';
update days set subtitle = 'Moulton barns at sunrise · Oxbow late morning · Jackson Lake · Colter Bay to sunset' where id = '13a684c6-f74b-40cf-b73b-0d03522cb287';
update days set subtitle = 'Taggart Lake sunrise · rest of the day open' where id = '3c0a0177-fe0a-49e1-a9f5-68696f3eceba';
update days set subtitle = 'Oxbow sunrise · Cunningham window · return skis · afternoon open' where id = 'd6651858-a3e4-428b-9211-9cfe694fa654';
update days set subtitle = 'SRO reshoot · Teton Point · Glacier View · JAC 4:19 PM' where id = 'c0acd1d5-4dbe-4bc1-9354-b5ca2bc0beb1';
commit;
