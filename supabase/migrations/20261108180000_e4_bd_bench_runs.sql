-- E4 / E7 version BD (8 Nov 2026): BA + whole-day weather (run config runs, solver-replay v92). Paired test
-- on the 56 Teton winter weeks against BAm56r (same code, v90+), judged by the camera vote.
insert into planner_versions (letter, name, kind, settings, built_on, result_config, code, status, note)
values ('BD', 'BA + whole-day weather (hidden / clear spells persist through a visit)', 'mrmc',
        '{"mustfix": true, "tickfix": true, "runs": true}', 'BA', 'BDm56', 'solver-replay v92', 'testing',
        'Worksheet E4 / E7. A visit is valued by its expected best moment while hidden and clear spells persist (rho 0.8 per hour), not the single best hour. Baseline BAm56r.')
on conflict (letter) do nothing;

insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select r.trip_id, r.start_date, r.trip_dates, r.nights, (r.config - 'trace') || '{"name": "BDm56", "runs": true}'::jsonb
  from replay_runs r
 where r.config ->> 'name' = 'BAm56'
   and not exists (select 1 from replay_runs x where x.config ->> 'name' = 'BDm56' and x.start_date = r.start_date);
