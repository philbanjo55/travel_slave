-- One-pass Re-plan on by default for any new trip T plans (Phil, 18 Nov 2026: "Keep it on as standard").
-- planner_t_autoadd: the live definition with one_pass true in its default config.
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
           "morning_fresh": true, "split_morning": true, "sbfix": true, "mustfix": true, "tickfix": true, "one_pass": true, "req_budget_ms": 900}'::jsonb,
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
