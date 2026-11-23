-- One-pass Re-plan live (Phil, 18 Nov 2026: "Ok let it rip", after the shadow readout: 10 shadow plans 15-18 Nov, no
-- errors, no once-only repeats, no rule breaks; identical once the day's stops are over; while today still had stops
-- ahead it re-placed dropped stops at once (Faroes 8 vs 5 places, +11 / +5 predicted points); Teton 17 Nov graded a
-- tie on the camera truth). On for both practice trips and both real trips (trip configs + their live T runs);
-- chain_nights left off (untested live). Version BH = BA + one-pass is the winner (the bench plans are BA's).
-- First live run, Teton Live 18 Nov 11:25 AM ET: Re-plan now re-planned today, the rest of the trip (Thu-Sun) in
-- ~80 s; today's dropped stops (Teton Point, Emily's Pond, Teton Pines) went straight to Thursday.
-- Undo: one_pass back to null (or "shadow") in the same rows.
update planner_t_trips set config = jsonb_set(config, '{one_pass}', 'true')
 where trip_id in ('7e57bed0-0000-4000-8000-000000000003', '7e57bed0-0000-4000-8000-000000000002',
                   '5e247891-d800-4d07-b5e0-8ad748ae2754', 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d');
update replay_runs set config = jsonb_set(config, '{one_pass}', 'true') where id in (3916, 3920, 5028, 9477);
update planner_versions set status = 'contender' where letter = 'BA';
update planner_versions set status = 'winner' where letter = 'BH';
