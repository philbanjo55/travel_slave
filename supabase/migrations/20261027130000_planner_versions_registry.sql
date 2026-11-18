-- One registry of planner versions (Phil, 27 Oct 2026: "I'm worried we have all
-- these versions and you're not keeping track of which is which and that we might
-- pick the wrong one when iterating"). Each row is exactly how to run a version on
-- the bench: the plan kind and the run-config switches on top of the base Teton
-- config (gear, anchors_on, fixed_days), plus where its result lives. Every new
-- version gets the next letter here BEFORE it runs; exactly one row is the winner.
-- Code: solver-replay keeps every version runnable (fm_version, run-config
-- switches), so a row is reproducible with the current function.
create table if not exists public.planner_versions (
  letter        text primary key,
  name          text not null,
  kind          text not null,                     -- solver-replay plan kind
  settings      jsonb not null default '{}'::jsonb, -- run-config switches beyond the base config
  built_on      text,                              -- the letter it extends
  result_config text,                              -- replay_runs.config->>'name' holding its 56-week result
  code          text,                              -- solver-replay version that produced the result
  per_week      numeric, places numeric, sgod numeric,
  vs_winner     text,                              -- paired difference vs the winner, +/- SE
  status        text not null check (status in ('winner','contender','retired','testing','check')),
  note          text,
  updated_at    timestamptz not null default now()
);
create unique index if not exists planner_versions_one_winner on public.planner_versions ((true)) where status = 'winner';

insert into public.planner_versions (letter, name, kind, settings, built_on, result_config, code, per_week, places, sgod, vs_winner, status, note) values
 ('A','Your own schedule','my','{}',null,'pfA','v23',20.5,19.0,0.9,'-11.7 ± 1.2','retired','Phil''s itinerary as written.'),
 ('B','Day-by-day planner','fc1','{}',null,'pfA','v23',34.8,15.3,3.3,'+2.5 ± 0.7','retired','Skips ~4 places a week (long ski days): breaks every-place rule.'),
 ('C','Day-by-day, 3-day view','fc3','{}','B','pfA','v23',34.5,15.5,3.3,'+2.2 ± 0.7','retired','Same as B.'),
 ('D','Swap whole days','blk','{"budget_ms":700}',null,'pfA','v23',23.2,17.4,1.5,'-9.1 ± 1.0','retired',null),
 ('E','Improve my week','imp','{"budget_ms":700}',null,'pfA','v23',24.7,18.0,1.6,'-7.6 ± 0.9','retired',null),
 ('F','Every place once v1','fm1','{"fm_version":1}','B','pfF','v23',33.0,18.1,2.9,'+0.8 ± 0.9','retired','Misses ~1 place a week.'),
 ('G','Every place once v2','fm1','{"fm_version":2}','F','pfG','v23',32.0,18.9,2.7,'-0.3 ± 0.6','contender','Within L''s error bars.'),
 ('H','Every place once v3','fm1','{"fm_version":3}','G','hid3','v23',31.4,18.9,2.6,'-0.9 ± 0.5','retired','Base of J, K, L.'),
 ('I','v3 + 7-day forecasts','fm1','{"fc_days":7}','H','pfI','v23',31.2,18.9,2.6,'-1.1 ± 0.7','retired',null),
 ('J','v3 + Monte Carlo','mc1','{}','H','hidmc','v23',31.9,18.9,2.7,'-0.4 ± 0.5','contender','Within L''s error bars.'),
 ('K','v3 + morning re-plan','mr1','{"mr_commit":"departure"}','H','mr56b','v23',31.8,18.9,2.8,'-0.4 ± 0.4','contender','Within L''s error bars.'),
 ('L','Monte Carlo + morning re-plan','mrmc','{"mr_commit":"departure"}','J','mr56b','v23',32.3,19.0,2.8,'0','winner','All 19 places every week. Day size 80% of daylight - 45 min, fc_days 3, risk mean + 0.5 CVaR, miss penalty 5 (all tested 27 Oct).'),
 ('M','K + polish','mr1','{"mr_commit":"departure","polish_k":7}','K','pol56','v25',null,null,null,null,'testing','Near-exhaustive search improves the night plan and the morning re-plan.'),
 ('N','L + polish','mrmc','{"mr_commit":"departure","polish_k":7}','L','pol56','v25',null,null,null,null,'testing','Near-exhaustive search improves the night plan and the morning re-plan.'),
 ('X1','Brute-force day check','fm1','{"fm_version":3,"exact_k":7}','H','exact7','v24',null,null,null,null,'check','Not a planner: found a better day than the search on 261 of 336 days (~5%).')
on conflict (letter) do nothing;
