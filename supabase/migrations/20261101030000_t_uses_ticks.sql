-- T goes by Phil's ticks (Phil, 1 Nov 2026: "make T use the ticks"; solver-replay v53). The
-- app's plans count a day already done only through the stops Phil marked got / nailed, not
-- through what T had planned for it. So a week draft no longer starts from the live T run's
-- state (T's own assumed shots and places done): it starts empty and solver-replay adds the
-- ticks itself.
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.planner_t_week(uuid)'::regprocedure);
  o := $o$    insert into replay_run_state (run_id, kind, night, state, sets)
    values (v_run, 'mrmc', 0, coalesce(v_state, '{}'::jsonb), v_sets);$o$;
  n := $n$    -- v53: the past counts through Phil's ticks only (solver-replay reads them).
    insert into replay_run_state (run_id, kind, night, state, sets)
    values (v_run, 'mrmc', 0, '{}'::jsonb, '{"seen": []}'::jsonb);$n$;
  if position(o in d) = 0 then raise exception 'planner_t_week state insert not found'; end if;
  execute replace(d, o, n);
end $$;
