-- 8 Nov 2026 (Phil: yes): the must-list rescue and tick fixes (run config mustfix + tickfix, planner
-- version BA, solver-replay v89) go live on every T trip config, every running live run and the
-- default for new trips. Bench: BAm56 vs AXm56 +0.09 +/- 0.13 points a week, no route-less nights,
-- walk-the-trip with no bad plans. BA becomes the winner.
update planner_t_trips set config = config || '{"mustfix": true, "tickfix": true}'::jsonb, updated_at = now() where trip_id is not null;
update replay_runs set config = config || '{"mustfix": true, "tickfix": true}'::jsonb, updated_at = now()
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
           "morning_fresh": true, "split_morning": true, "sbfix": true, "mustfix": true, "tickfix": true, "req_budget_ms": 900}'::jsonb,
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
update planner_versions set status = 'contender', updated_at = now() where letter = 'AX';
update planner_versions set status = 'winner', per_week = 44.6, vs_winner = '0 (winner since 8 Nov 2026: AX + must-list rescue + tick fixes, +0.09 +/- 0.13 a week vs AX on the merged trip)', updated_at = now() where letter = 'BA';
