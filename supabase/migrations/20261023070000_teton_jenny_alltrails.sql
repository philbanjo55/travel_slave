-- Phil's own AllTrails route for Day 3 (23 Oct 2026), on the clip-in and
-- South Jenny stops of the real trip and the Teton Live copy.
update stops set alltrails_url = 'https://www.alltrails.com/explore/map/jenny-lake-snow-shoe-d12008c?p=-1&sh=jrrmvi'
 where id in ('283db46f-4585-435c-b132-58b38057e9df', '6d93b189-c83f-446f-86af-bda655b450bf', '2fa07f0c-7853-4cce-ad53-0ca5cc7d9413', 'fb31567b-f7c2-4f12-a7b1-6b89506bc6f4');
update stops set info = regexp_replace(info, 'AllTrails has NO dedicated winter page[^\n]*', 'AllTrails: Phil''s own route "jenny lake snow shoe" (the AllTrails link on this stop).')
 where id in ('283db46f-4585-435c-b132-58b38057e9df', '6d93b189-c83f-446f-86af-bda655b450bf');

-- Replaced the same day by Phil's better route, "jenny lake ski route".
update stops set alltrails_url = 'https://www.alltrails.com/explore/map/jenny-lake-ski-route-69e8d76?p=-1&sh=jrrmvi'
 where id in ('283db46f-4585-435c-b132-58b38057e9df', '6d93b189-c83f-446f-86af-bda655b450bf', '2fa07f0c-7853-4cce-ad53-0ca5cc7d9413', 'fb31567b-f7c2-4f12-a7b1-6b89506bc6f4');
update stops set info = replace(info, 'Phil''s own route "jenny lake snow shoe"', 'Phil''s own route "jenny lake ski route"')
 where id in ('283db46f-4585-435c-b132-58b38057e9df', '6d93b189-c83f-446f-86af-bda655b450bf');
