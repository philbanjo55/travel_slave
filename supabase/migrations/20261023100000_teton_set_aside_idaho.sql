-- Phil, 23 Oct 2026: take the Idaho side out of the Grand Teton trip (day 5,
-- Sat 2 Jan: Tetonia ID-33 Overlook, Bates Bridge, Forage Bistro lunch,
-- Driggs ID-33 farm pullouts). Set aside (no day, no tier), real trip and
-- Teton Live. Day 5 is now Taggart Lake, then the rest of the day open.
update stops set day_id = null, position = 0
 where id in ('3884e65a-6a6a-48fb-8f68-5c40795c9750','663b37a1-3b6f-4f54-9190-637c89c94458','4c2ff16a-23b6-458f-9ddf-4fb5a0a54173','34b368d4-a164-447d-972b-6759ec293c72',
              '86e71757-2649-48f9-9eaf-595b2c639b7c','b7193087-acaf-4878-9058-a68f92981f80','9f0ae8c7-594f-493b-b446-2b3da66a4a62','26228824-0e0c-4ae1-b631-5556eb5f0dec');
update solver_stop_settings set tier = null, source = 'phil', note = 'Removed from the trip by Phil, 23 Oct 2026 (unscheduled, kept for its notes)'
 where stop_id in ('3884e65a-6a6a-48fb-8f68-5c40795c9750','663b37a1-3b6f-4f54-9190-637c89c94458','4c2ff16a-23b6-458f-9ddf-4fb5a0a54173','34b368d4-a164-447d-972b-6759ec293c72',
                   '86e71757-2649-48f9-9eaf-595b2c639b7c','b7193087-acaf-4878-9058-a68f92981f80','9f0ae8c7-594f-493b-b446-2b3da66a4a62','26228824-0e0c-4ae1-b631-5556eb5f0dec');
update stops set position = 2, drive_override_minutes = 27,
       info = coalesce(info || E'\n', '') || 'No Idaho side any more (23 Oct): the rest of the day is open.'
 where id in ('63c6bed6-6fb1-4863-bca1-5471e29faf51', '110f4442-ce3e-4f03-ad84-acea1618346a');
update days set title = 'Taggart Lake', subtitle = 'Taggart Lake sunrise · rest of the day open', metar_station = 'KJAC'
 where id in ('a9719a71-29c8-4d78-99ea-bd973bac7c97', '3c0a0177-fe0a-49e1-a9f5-68696f3eceba');
