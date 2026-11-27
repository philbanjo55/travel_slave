-- Planner test bench: run config fc_days (1-7, default 3) = how many days of
-- forecast the week plans (fm1 / blk / imp) see each night (Phil, 27 Oct 2026:
-- upgrade #2, the planner looks further ahead). replay_run_tick builds the
-- forecasts made 1..fc_days ahead (leads 4-7 from 20261027010000) and fills
-- light geometry only beyond them. Runs without fc_days behave as before.
do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  a text := 'v_hz := case when v_kinds && array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1''] then 2 else 0 end;';
  b text := 'if v_kinds && array[''blk'', ''imp''] and r.night + 3 <= r.nights - 1 then';
  c text := 'generate_series(r.night + 3, r.nights - 1)';
begin
  if position(a in d) = 0 or position(b in d) = 0 or position(c in d) = 0 then raise exception 'replay_run_tick: text not found'; end if;
  d := replace(d, a, 'v_hz := case when v_kinds && array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1''] then least(greatest(coalesce((r.config ->> ''fc_days'')::int, 3), 3), 7) - 1 else 0 end;');
  d := replace(d, b, 'if v_kinds && array[''blk'', ''imp''] and r.night + coalesce((r.config ->> ''fc_days'')::int, 3) <= r.nights - 1 then');
  d := replace(d, c, 'generate_series(r.night + coalesce((r.config ->> ''fc_days'')::int, 3), r.nights - 1)');
  execute d;
end $$;
