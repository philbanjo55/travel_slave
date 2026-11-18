-- Version BF (9 Nov 2026): BA + UK day-ahead visibility shared by every model's hidden-peak odds (run config svis,
-- solver-replay v95). Paired test on the 56 Teton winter weeks against BAm56r. Visibility is missing for
-- ~22 Dec 2024 - 31 Jan 2025 in the archive, so those days plan exactly as BA.
insert into planner_versions (letter, name, kind, settings, built_on, result_config, code, status, note)
values ('BF', 'BA + UK visibility shared by every model''s hidden-peak odds', 'mrmc',
        '{"mustfix": true, "tickfix": true, "svis": true}', 'BA', 'BFm56', 'solver-replay v95', 'testing',
        'Worksheet F6, after BE lost. Every member''s hidden chance = fit on its own total cloud x UK day-ahead visibility (replay_svis_fit). Baseline BAm56r.')
on conflict (letter) do nothing;

insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select r.trip_id, r.start_date, r.trip_dates, r.nights, (r.config - 'trace') || '{"name": "BFm56", "svis": true}'::jsonb
  from replay_runs r
 where r.config ->> 'name' = 'BAm56'
   and not exists (select 1 from replay_runs x where x.config ->> 'name' = 'BFm56' and x.start_date = r.start_date);
