-- Phil, 24 Oct 2026: grooming by section (Google summary citing NPS / Buckrail,
-- still to confirm on the grooming line): Fridays groom 2 lanes north toward
-- Signal Mountain; Tuesdays and Sundays groom 4 lanes Taggart -> South Jenny
-- Lake, the Day 3 route. So the Friday swap does not freshen the Day 3 tracks;
-- Sunday (Day 6) does. The Lucas-Fabian idea is on the Day 3 route itself.
update stops set info = replace(info,
  'If grey, swap with Day 4 (Fri Jan 1, a grooming day) or Day 5 (Sat Jan 2). Grooming runs Tue/Fri/Sun: on this trip Tue Dec 29, Fri Jan 1, Sun Jan 3 (ask the grooming line which section each day). Today (Thu Dec 31) is not a grooming day, so tracks are two days old.',
  'If grey, swap with Day 6 (Sun Jan 3, the Taggart-Jenny section is groomed that day) or Day 5 (Sat Jan 2). Grooming by section: Tue and Sun groom 4 lanes Taggart -> South Jenny Lake (this route); Fri grooms 2 lanes north toward Signal Mountain (not this route). On this trip the south section is groomed Tue Dec 29 and Sun Jan 3, so today the tracks are two days old (confirm on the grooming line).')
 where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and name = 'Wyoming Inn — Depart'
   and info like '%swap with Day 4 (Fri Jan 1, a grooming day)%';

update stops set info = 'On the Day 3 Jenny Lake route: the trail crosses Cottonwood Creek at the Lucas-Fabian bridge, by the homestead, so it is a viewpoint on that day, not a separate outing. ' || info
 where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and name = 'Idea: Lucas-Fabian Homestead (ski/snowshoe)'
   and info not like 'On the Day 3 Jenny Lake route%';
