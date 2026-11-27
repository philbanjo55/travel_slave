-- F5 version BC (8 Nov 2026): BA + ECMWF low-cloud odds (run config layers). Paired test on the 56 Teton
-- winter weeks against a fresh BA rerun on the same code (solver-replay v90), judged by the camera vote.
insert into planner_versions (letter, name, kind, settings, built_on, result_config, code, status, note)
values ('BC', 'BA + low-cloud odds for ECMWF (cloud layers)', 'mrmc', '{"mustfix": true, "tickfix": true, "layers": true}',
        'BA', 'BCm56', 'solver-replay v90', 'testing',
        'Worksheet F5. ECMWF member hidden-peak odds from its low cloud (single ECMWF runs, replay_layer_fit). Baseline rerun BAm56r on the same code.')
on conflict (letter) do nothing;

insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select r.trip_id, r.start_date, r.trip_dates, r.nights,
       (r.config - 'trace') || jsonb_build_object('name', v.name) || case when v.layers then '{"layers": true}'::jsonb else '{}'::jsonb end
  from replay_runs r
  cross join (values ('BAm56r', false), ('BCm56', true)) v(name, layers)
 where r.config ->> 'name' = 'BAm56'
   and not exists (select 1 from replay_runs x where x.config ->> 'name' = v.name and x.start_date = r.start_date);
