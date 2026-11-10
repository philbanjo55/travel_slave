-- E4 / E7 version BD (9 Nov 2026): the first BDm56 runs (solver-replay v92) timed out on 11 of 31 weeks (the
-- per-15-min whole-day calculation was too slow), so they are stopped and the test restarts on v93 (hourly steps,
-- repeated members copied) as BDm56b.
update replay_runs set status = 'stopped', note = 'superseded by BDm56b (v93)'
 where config ->> 'name' = 'BDm56' and status in ('queued', 'running', 'error');
update planner_versions set result_config = 'BDm56b', code = 'solver-replay v93' where letter = 'BD';
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select r.trip_id, r.start_date, r.trip_dates, r.nights, (r.config - 'trace') || '{"name": "BDm56b", "runs": true}'::jsonb
  from replay_runs r
 where r.config ->> 'name' = 'BAm56'
   and not exists (select 1 from replay_runs x where x.config ->> 'name' = 'BDm56b' and x.start_date = r.start_date);
