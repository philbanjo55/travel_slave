-- Day 5 Taggart Lake already links the AllTrails loop (Phil, 23 Oct 2026):
-- the saved idea is the same route; add the 2026 closure dates to the stop
-- (real trip and Teton Live).
update stops set info = 'Same route as the Day 5 Taggart Lake stop (AllTrails Taggart Lake Loop, 3.8 mi, 426 ft). ' || info
 where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and name = 'Idea: Taggart Lake-Beaver Creek Loop (ski/snowshoe)';
update stops set info = info || E'\n' || 'NPS: the northern segment (first junction to the Bradley trail) is shut 1 May to 15 Nov 2026 for repairs, so it should be open again by the trip.'
 where id in ('f42654fa-0bc4-49a1-b45d-612be84d6259', 'b32c3c18-0a3e-4fe8-8691-64f2770247f2');
