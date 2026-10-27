-- Rerun the two contenders with the hidden-peaks fit on airport + camera truth
-- (20261027040000), everything else unchanged (Phil, 27 Oct 2026: "run both"):
-- hid3 = v3 (cover3 config), hidmc = v3 + Monte Carlo (mc56 config).
update replay_places set fitted_at = now();
insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status, night, state)
select trip_id, start_date, trip_dates, nights, (config - 'fm_version') || jsonb_build_object('name','hid3'), 'queued', 0, '{}'::jsonb
  from replay_runs where config->>'name'='cover3' order by start_date;
insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status, night, state)
select trip_id, start_date, trip_dates, nights, config || jsonb_build_object('name','hidmc'), 'queued', 0, '{}'::jsonb
  from replay_runs where config->>'name'='mc56' order by start_date;
select cron.schedule('replay-run', '* * * * *', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
