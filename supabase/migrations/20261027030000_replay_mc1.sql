-- Planner test bench: plan type mc1 (fm1 + a Monte Carlo choice between
-- candidate plans for tomorrow, the rest of the week played out in 51 weather
-- versions; Phil, 27 Oct 2026). It sees the whole remaining week like blk/imp,
-- so replay_run_tick builds its forecast days and fills the light geometry of
-- the later days for it too.
do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  a text := 'array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1'']';
  b text := 'if v_kinds && array[''blk'', ''imp''] and';
begin
  if position(a in d) = 0 or position(b in d) = 0 then raise exception 'replay_run_tick: text not found'; end if;
  d := replace(d, a, 'array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1'', ''mc1'']');
  d := replace(d, b, 'if v_kinds && array[''blk'', ''imp'', ''mc1''] and');
  execute d;
end $$;
