-- Tell T on for both Faroes trips (Phil, 15 Nov 2026: "Switch notes on for faroes too"):
-- the trip config (read by planner_t_tell, the app and t-notes; a new round's app_T copies it)
-- and the running live T runs (trip_T 3920 = Faroe Islands 2027, app_T 5028 = Faroes Live).
update planner_t_trips set config = config || '{"tell": true}'::jsonb
 where trip_id in ('e04fbc9d-86b1-42b2-bf08-fc65a18e665d', '7e57bed0-0000-4000-8000-000000000002');
update replay_runs set config = config || '{"tell": true}'::jsonb
 where id in (3920, 5028) and trip_id in ('e04fbc9d-86b1-42b2-bf08-fc65a18e665d', '7e57bed0-0000-4000-8000-000000000002');
