-- Version BE (9 Nov 2026): BA + ECMWF low cloud as a shared hint for every model's hidden-peak odds (run config
-- slay, solver-replay v94). Paired test on the 56 Teton winter weeks against BAm56r, judged by the camera vote.
insert into planner_versions (letter, name, kind, settings, built_on, result_config, code, status, note)
values ('BE', 'BA + ECMWF low cloud shared by every model''s hidden-peak odds', 'mrmc',
        '{"mustfix": true, "tickfix": true, "slay": true}', 'BA', 'BEm56', 'solver-replay v94', 'testing',
        'Worksheet F5 retry / F6. Every member''s hidden chance = fit on its own total cloud x ECMWF day-ahead low cloud (replay_slayer_fit). Teton winter check Brier 0.18-0.24 -> 0.10-0.12 per model. Baseline BAm56r.')
on conflict (letter) do nothing;

insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select r.trip_id, r.start_date, r.trip_dates, r.nights, (r.config - 'trace') || '{"name": "BEm56", "slay": true}'::jsonb
  from replay_runs r
 where r.config ->> 'name' = 'BAm56'
   and not exists (select 1 from replay_runs x where x.config ->> 'name' = 'BEm56' and x.start_date = r.start_date);
