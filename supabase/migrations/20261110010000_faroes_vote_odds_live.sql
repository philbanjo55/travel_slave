-- Faroes trips switch to odds learned on the 1,000 ft rule (Phil, 10 Nov 2026: "Yes switch it"; version BG,
-- result +1.54 +/- 0.86 per period over 31 May periods vs today's odds, every year positive, same places).
-- Faroes Live gets the same vote cutoff the bench place has; both Faroes trips' T configs and their running
-- live runs get vfit (odds from the camera vote, which falls back to the 1,000 ft airport rule where fewer than
-- 2 cameras are labelled). Teton unchanged. The vote odds are refit by hand right after (one-off cron job).
update public.replay_places set vote_ceiling_ft = 1000, fitted_at = now()
 where trip_id in ('7e57bed0-0000-4000-8000-000000000002', 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d');

update public.planner_t_trips set config = config || '{"vfit": true}'::jsonb
 where trip_id in ('7e57bed0-0000-4000-8000-000000000002', 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d');

update public.replay_runs set config = config || '{"vfit": true}'::jsonb, updated_at = now()
 where trip_id in ('7e57bed0-0000-4000-8000-000000000002', 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')
   and coalesce((config ->> 'live')::boolean, false) and status in ('queued', 'running', 'held')
   and config ->> 'name' in ('app_T', 'trip_T');

update public.planner_versions set status = 'check',
       note = note || ' Live on the Faroes trips since 10 Nov 2026 (Phil: yes). Teton stays on BA.'
 where letter = 'BG';
