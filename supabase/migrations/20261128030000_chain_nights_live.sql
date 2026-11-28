-- Faster rest-of-trip re-plan (Phil, 28 Nov 2026: "Ok add it"): every T trip's draft plans its days back to back
-- (planner_t_rest turns on chain + chain_nights and starts the draft itself) instead of one step per 20-s tick.
-- Lab proof 28 Nov (docs/tests/replan_speed_2026-11-27.md on claude/replan-speed-tests): 66 of 66 days identical,
-- 3-7 min -> 18-35 s. Undo: update planner_t_trips set config = config - 'chain_nights' where trip_id is not null
update planner_t_trips set config = config || '{"chain_nights": true}'::jsonb where trip_id is not null;
