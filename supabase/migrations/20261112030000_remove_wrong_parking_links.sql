-- Phil, 11 Nov 2026 ("just remove them, does it even need them?"): three roadside pull-offs had a "Parking:" map link in
-- their notes that pointed far from the stop's own (correct) pin: Glacier View Turnout and Teton Point Turnout ~10 km
-- south, Snake River Overlook 3.6 km south. Claude's plan check kept flagging them. Only that piece of the notes' first
-- line is removed (the real trip and the Teton Live copy); pins and everything else stay. Re-runnable.
update stops s
   set info = regexp_replace(s.info, ' · Parking: https://www\.google\.com/maps\?q=[-0-9.,]+( \((map estimate, )?confirm\))?', '')
 where s.trip_id in ('5e247891-d800-4d07-b5e0-8ad748ae2754', '7e57bed0-0000-4000-8000-000000000003')
   and s.name in ('Glacier View Turnout', 'Teton Point Turnout', 'Snake River Overlook')
   and s.info ~ ' · Parking: https://www\.google\.com/maps\?q=';
