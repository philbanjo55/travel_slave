-- Grand Teton booked (Phil, 23 Oct 2026; United C6V8S8, Phil + Holly):
--   out  Tue 29 Dec  IAD 6:10 AM -> JAC 12:00 PM (1 stop)
--   back Mon 4 Jan   JAC 4:19 PM -> IAD 12:59 AM Tue 5 Jan
-- The six planned days move +2 (27 Dec - 1 Jan -> 29 Dec - 3 Jan) and a
-- seventh day (4 Jan) takes the check-out, a last morning and the flight.
-- Stops only move (UPDATE day_id/position); two hotel logistics stops are
-- inserted for the new middle day. Nothing is deleted.

do $$
declare
  t  constant uuid := '5e247891-d800-4d07-b5e0-8ad748ae2754';
  d6 uuid; d7 uuid := gen_random_uuid();
begin
  if exists (select 1 from days where trip_id = t and day_number = 7) then raise exception 'already moved'; end if;
  update trips set start_date = '2026-12-29', end_date = '2027-01-04', travelers = '{Phil,Holly}', updated_at = now() where id = t;
  update days set date = date + 2 where trip_id = t;
  select id into d6 from days where trip_id = t and day_number = 6;

  insert into days (id, trip_id, day_number, date, title, subtitle, region, map_center_lat, map_center_lng, map_zoom, metar_station)
  select d7, t, 7, '2027-01-04', 'Last Morning + Wheels Up', 'SRO reshoot · Teton Point · Glacier View · JAC 4:19 PM',
         region, map_center_lat, map_center_lng, map_zoom, metar_station
    from days where id = d6;

  -- Day 1 (Tue 29 Dec): landing 20 min later, every stop 20 min later
  -- (Oxbow 4:00-5:10 PM still holds sunset ~4:52).
  update stops s set time_label = to_char(s.time_label::time + interval '20 minutes', 'FMHH12:MI AM')
    from days d where d.id = s.day_id and d.trip_id = t and d.day_number = 1 and s.time_label ~ '^\d{1,2}:\d\d [AP]M$';
  update stops set info = 'ARRIVE JAC 12:00 PM Tue Dec 29 (United from IAD, 1 stop, conf C6V8S8). Bags + rental car, aim to roll by 12:50. Wyoming Inn check-in is 3 PM, so keep bags in the car and check in after dark. Airport is inside the park, 10 min from Glacier View.'
   where id = '16185fe8-2a29-4ac8-969b-be638771796b';
  update days set subtitle = 'Land JAC 12:00 · six pullouts north · Oxbow at last light' where trip_id = t and day_number = 1;

  -- Day 3 is now Thu 31 Dec. Grooming runs Tue/Fri/Sun.
  update stops set info = '⚠️ GOD DAY — hold for the CLEAREST forecast. If grey, swap with Day 4 (Fri Jan 1, a grooming day) or Day 5 (Sat Jan 2). Grooming runs Tue/Fri/Sun: on this trip Tue Dec 29, Fri Jan 1, Sun Jan 3 (ask the grooming line which section each day). Today (Thu Dec 31) is not a grooming day, so tracks are two days old. Grooming has started late two seasons running (Jan 12 2024, Jan 9 2026) — if not groomed, the road is still skiable on packed tracks, just slower. Grooming line 307-739-3682. Park entrance fee required.'
   where id = '2e451da0-499b-4a93-8b60-8405da9696a3';

  -- Day 7 (Mon 4 Jan): check out, last sunrise, flight.
  update stops set day_id = d7, position = 0, time_label = '6:15 AM',
         info = 'Check out before you leave — no room tonight, bags ride in the car. Flight 4:19 PM.'
   where id = 'e8eab18c-1844-49f8-a5d2-b1555d72d43c';
  update stops set day_id = d7, position = 1, time_label = '7:05 AM' where id = 'a0c6552c-cf12-40aa-96bf-73157aaa914c';
  update stops set day_id = d7, position = 2, time_label = '8:00 AM' where id = '384cb937-25cf-410d-bb0f-39bc3c3dfa3e';
  update stops set day_id = d7, position = 3, time_label = '2:05 PM',
         info = '[A] · MOVABLE · Sunset ~4:58. The morning and early afternoon before this are open for anything weathered out earlier in the week.' || E'\n' || 'Midday last look on the way to the airport (sunset is after you need to be at JAC).'
   where id = '10c370a1-acfb-46a2-8db0-bf738b304f63';
  update stops set day_id = d7, position = 4, time_label = '3:05 PM',
         info = 'FLIGHT 4:19 PM Mon Jan 4 (United to IAD, 1 stop, lands 12:59 AM Tue Jan 5; conf C6V8S8). Be at JAC by 3:05 for the rental return (airport is inside the park, 10 min from Glacier View). FILM: exposed film in carry-on, request a hand-check — never checked bag.'
   where id = '35a0dccd-1db7-47c0-9dac-992cd00ae40b';

  -- Day 6 (Sun 3 Jan): a full day from the inn and back.
  insert into stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, lat, lng, place_id, map_url, google_maps_url,
                     signal_status, info, shot_type, time_locked, movable)
  select gen_random_uuid(), d6, t, 0, name, emoji, '6:15 AM', null, lat, lng, place_id, map_url, google_maps_url, signal_status,
         'BUFFER DAY. If Day 3 (ski) was grey, this is the ski day — swap the whole day (Sun Jan 3 is a grooming day). Otherwise run the list below; the afternoon is open for anything weathered out.',
         shot_type, false, movable
    from stops where id = '2e451da0-499b-4a93-8b60-8405da9696a3';
  update stops set position = 1 where id = 'e2481a31-a73f-44ee-9839-bc450e69a0f2';
  update stops set position = 2 where id = '6f83a1e6-4acf-4565-b01b-3bdb2a0d846f';
  update stops set position = 3,
         info = 'Return skis + snowshoes (Sun Jan 3). Call ahead for Sunday hours. If the shop is shut, return Mon morning on the way to the airport, or ask them how to leave the gear after hours.'
   where id = 'ad52beaf-9a1c-466d-94b7-9f469e207794';
  insert into stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, lat, lng, place_id, map_url, google_maps_url,
                     signal_status, info, shot_type, time_locked, movable)
  select gen_random_uuid(), d6, t, 4, name, emoji, '5:15 PM', null, lat, lng, place_id, map_url, google_maps_url, signal_status,
         'Back at the inn. Last night.', shot_type, false, movable
    from stops where id = '4ee355de-5cac-415e-92b4-96a8743d79c8';
  update days set title = 'Oxbow Sunrise + Open Afternoon',
         subtitle = 'Oxbow sunrise · Cunningham window · return skis · afternoon open'
   where id = d6;

  update accommodations set check_in = '2026-12-29', check_out = '2027-01-04', nights = 6 where trip_id = t;

  -- Legs that changed (solver_drive_matrix minutes).
  update stops set drive_override_minutes = 39 where id = 'ad52beaf-9a1c-466d-94b7-9f469e207794';  -- Cunningham -> Skinny Skis
  update stops set drive_override_minutes = 43 where id = 'a0c6552c-cf12-40aa-96bf-73157aaa914c';  -- inn -> SRO
  update stops set drive_override_minutes = 3  where id = '10c370a1-acfb-46a2-8db0-bf738b304f63';  -- Teton Point -> Glacier View
  update stops set drive_override_minutes = 4  where day_id = d6 and position = 4;                -- Skinny Skis -> inn
end $$;
