-- T plans every trip (Phil, 31 Oct 2026: "yes do both").
--  * Faroe Islands 2027 and its 🧪 Faroes Live practice copy go on T with Claude's guessed trip
--    rules (once-only places, keep-together groups, flights fixed: the fo47_T bench settings),
--    marked as guesses until Phil checks them. On the real Faroes trip the morning re-plan uses
--    the night-before forecast (ECMWF's overnight run is not out by a May sunrise, ~04:30 local).
--  * Every other trip with rated places gets T by default (no trip rules), added by
--    planner_t_autoadd() at the start of each nightly planner_t_week().
-- Week drafts (light only) need nothing more; a live T run (evening plan + morning re-plan) also
-- needs the place set up for the bench (replay_places: station, forecast cell, hidden-peaks fit).

alter table public.planner_t_trips add column if not exists rules_checked boolean not null default false;
update planner_t_trips set rules_checked = true
 where trip_id in ('5e247891-d800-4d07-b5e0-8ad748ae2754', '7e57bed0-0000-4000-8000-000000000003');

-- Real Faroes trip.
insert into planner_t_trips (trip_id, config, note)
select 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d',
       (config - 'name') || '{"morning_fresh": false}'::jsonb,
       'Faroe Islands 2027: T. Once-only places, keep-together groups and fixed flights are Claude''s guesses (31 Oct 2026), not yet checked by Phil. Morning re-plan on the night-before forecast.'
  from replay_runs where config ->> 'name' = 'fo47_T' order by id limit 1
on conflict (trip_id) do nothing;

-- Faroes Live: the same rules on its own stop copies (practice day = real day - 204 days, so real
-- 14 May = practice 22 Oct; the real flight home, 28 May, falls after the practice trip ends).
with c as (select config - 'name' cfg from replay_runs where config ->> 'name' = 'fo47_T' order by id limit 1),
m as (select old_id::text o, new_id::text n from training_copy_map where trip_id = '7e57bed0-0000-4000-8000-000000000002' and kind = 'stop')
insert into planner_t_trips (trip_id, config, note)
select '7e57bed0-0000-4000-8000-000000000002',
       (c.cfg - 'once_add' - 'together_add' - 'locked_add' - 'fixed_days') || jsonb_build_object(
         'once_add', (select coalesce(jsonb_agg(m.n), '[]') from jsonb_array_elements_text(c.cfg -> 'once_add') x(id) join m on m.o = x.id),
         'together_add', (select coalesce(jsonb_object_agg(m.n, x.value), '{}') from jsonb_each(c.cfg -> 'together_add') x join m on m.o = x.key),
         'locked_add', (select coalesce(jsonb_agg(m.n), '[]') from jsonb_array_elements_text(c.cfg -> 'locked_add') x(id) join m on m.o = x.id),
         'fixed_days', '["2026-10-22"]'::jsonb),
       'Faroes Live practice copy: T with the real Faroes trip''s guessed rules (31 Oct 2026).'
  from c
on conflict (trip_id) do nothing;

select public.replay_copy_place('e04fbc9d-86b1-42b2-bf08-fc65a18e665d', '7e57bed0-0000-4000-8000-000000000002');

-- Live T runs: Faroes Live for its last days (1-4 Nov), the real Faroes trip in May.
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select '7e57bed0-0000-4000-8000-000000000002', date '2026-11-01',
       array['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']::date[], 4,
       p.config || '{"name": "app_T", "live": true, "publish": true, "plan_local": "20:45", "stagger_min": 6}'::jsonb
  from planner_t_trips p where p.trip_id = '7e57bed0-0000-4000-8000-000000000002'
on conflict do nothing;
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d', date '2027-05-13',
       array(select d.date from days d where d.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' order by d.date),
       (select count(*)::int from days d where d.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'),
       p.config || '{"name": "trip_T", "live": true, "publish": true, "plan_local": "20:45", "stagger_min": 6}'::jsonb
  from planner_t_trips p where p.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'
on conflict do nothing;

-- Every other trip with rated places: T by default (no trip rules yet).
create or replace function public.planner_t_autoadd()
returns int language plpgsql set search_path to 'public' as $$
declare n int;
begin
  insert into planner_t_trips (trip_id, config, note)
  select t.id,
         '{"kinds": ["mrmc"], "fc_days": 3, "polish_k": 7, "split_mc": true, "budget_ms": 700, "mr_commit": "departure",
           "morning_fresh": true, "split_morning": true, "req_budget_ms": 900}'::jsonb,
         'T by default: no once-only / keep-together / booking rules beyond the stops'' own settings yet.'
    from trips t
   where not coalesce(t.archived, false)
     and t.id <> '7e57bed0-0000-4000-8000-000000000001'
     and exists (select 1 from stops s join solver_stop_settings ss on ss.stop_id = s.id where s.trip_id = t.id and ss.tier is not null)
     and exists (select 1 from days d where d.trip_id = t.id and d.date >= current_date)
  on conflict (trip_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.planner_t_autoadd() from public, anon, authenticated;

do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.planner_t_week(uuid)'::regprocedure);
  o := $o$begin
  for p in select * from planner_t_trips$o$;
  n := $n$begin
  perform planner_t_autoadd();
  for p in select * from planner_t_trips$n$;
  if position(o in d) = 0 then raise exception 'planner_t_week pattern not found'; end if;
  execute replace(d, o, n);
end $$;

select public.planner_t_autoadd();
