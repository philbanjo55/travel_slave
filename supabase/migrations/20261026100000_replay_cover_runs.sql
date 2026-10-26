-- The rerun (Phil, 26 Oct 2026: "do option 2 and rerun the test"): the old
-- planner with every place at least once and ski outings only once (fm1), on
-- the same 56 Teton weeks and settings as config week4. Compare with
-- replay_week_summary('week4') next to replay_week_summary('cover1').
do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  a text := 'array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'']';
begin
  if position(a in d) = 0 then raise exception 'replay_run_tick: text not found'; end if;
  execute replace(d, a, 'array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1'']');
end $$;

insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select trip_id, start_date, trip_dates, nights,
       jsonb_set(jsonb_set(config, '{name}', '"cover1"'), '{kinds}', '["fm1"]'), 'hold'
  from replay_runs where config ->> 'name' = 'week4'
on conflict do nothing;
