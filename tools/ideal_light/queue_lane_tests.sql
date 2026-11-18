with base as (select r.trip_id, r.trip_dates, r.nights, (r.config - 'local' - 'name') || '{"lane": "lab"}'::jsonb cfg
                from replay_runs r where r.config->>'name' = 'IdA' order by r.id limit 1),
cfgs(sfx, extra) as (values
  ('off', '{}'::jsonb),
  ('you_g', '{"ideal": true}'), ('you_s', '{"ideal": true, "ideal_strong": true}'),
  ('r1_g', '{"ideal": true, "ideal_set": 1}'), ('r2_g', '{"ideal": true, "ideal_set": 2}'), ('r3_g', '{"ideal": true, "ideal_set": 3}'),
  ('r1_s', '{"ideal": true, "ideal_strong": true, "ideal_set": 1}'), ('r2_s', '{"ideal": true, "ideal_strong": true, "ideal_set": 2}'), ('r3_s', '{"ideal": true, "ideal_strong": true, "ideal_set": 3}')),
nov as (
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
  select b.trip_id, d::date, b.trip_dates, b.nights,
         b.cfg || jsonb_build_object('name', 'LN_' || c.sfx) || case when c.extra ? 'ideal_set' then c.extra || jsonb_build_object('ideal_set', (c.extra->>'ideal_set')::int + 10) else c.extra end
    from base b cross join cfgs c cross join generate_series(date '2026-11-01', date '2026-11-09', interval '2 days') d
  returning id),
win as (
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
  select r.trip_id, r.start_date, r.trip_dates, r.nights, (r.config - 'local' - 'name') || '{"lane": "lab"}'::jsonb || jsonb_build_object('name', 'LW_' || c.sfx) || c.extra
    from replay_runs r cross join cfgs c where r.config->>'name' = 'IdA'
   order by c.sfx = 'off' desc, r.start_date
  returning id)
select (select count(*) from nov) nov, (select count(*) from win) win
