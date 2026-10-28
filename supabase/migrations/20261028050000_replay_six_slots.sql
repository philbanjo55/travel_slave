-- Bench: 6 runs at a time instead of 12 (28 Oct 2026). Faroes nights load 15 days
-- of scores in parallel; 12 runs x up to 5 plans ran the API's connection pool dry
-- ("Timed out acquiring connection from connection pool", loads of 55-75 s), and a
-- plan with no answer in 2 minutes is retried once, then the run stops.
do $$
declare d text;
begin
  d := pg_get_functiondef('replay_run_tick()'::regprocedure);
  if position('v_slots int := 12' in d) = 0 then raise exception 'replay_run_tick: slots not found'; end if;
  execute replace(d, 'v_slots int := 12', 'v_slots int := 6');
end $$;
