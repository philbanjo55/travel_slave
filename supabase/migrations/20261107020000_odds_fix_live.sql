-- 7 Nov 2026 (Phil: OK): the odds-bug fix (run config sbfix, planner version AX) goes live: every
-- T trip config, every running live run (both real trips, both practice trips, the live side-by-side
-- runs) and the default config for new trips. Bench result: -0.41 +/- 0.56 points a week vs the
-- buggy T, same places: the fix is the correct code and costs nothing. AX becomes the winner.
update planner_t_trips set config = config || '{"sbfix": true}'::jsonb, updated_at = now() where trip_id is not null;
update replay_runs set config = config || '{"sbfix": true}'::jsonb, updated_at = now()
 where coalesce((config->>'live')::boolean, false) and status in ('queued','running');
CREATE OR REPLACE FUNCTION public.planner_t_autoadd()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  insert into planner_t_trips (trip_id, config, note)
  select t.id,
         '{"kinds": ["mrmc"], "fc_days": 3, "polish_k": 7, "split_mc": true, "budget_ms": 700, "mr_commit": "departure",
           "morning_fresh": true, "split_morning": true, "sbfix": true, "req_budget_ms": 900}'::jsonb,
         'T by default: no once-only / keep-together / booking rules beyond the stops'' own settings yet.'
    from trips t
   where not coalesce(t.archived, false)
     and t.id <> '7e57bed0-0000-4000-8000-000000000001'
     and exists (select 1 from stops s join solver_stop_settings ss on ss.stop_id = s.id where s.trip_id = t.id and ss.tier is not null)
     and exists (select 1 from days d where d.trip_id = t.id and d.date >= current_date)
  on conflict (trip_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $function$

;
update planner_versions set status = 'contender', updated_at = now() where letter = 'T';
update planner_versions set status = 'winner', vs_winner = '0 (winner since 7 Nov 2026: T with the odds bug fixed)', updated_at = now() where letter = 'AX';
