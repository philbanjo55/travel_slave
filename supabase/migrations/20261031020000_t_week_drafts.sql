-- The whole Planner on T (Phil, 31 Oct 2026). Two kinds of T runs per trip, both published to
-- solver_runs / solver_plans for the TEST app (solver-replay v50):
--  * live (evening plan for tomorrow from real forecasts + morning re-plan): app_T on the
--    Teton Live practice trip (20261031010000) and trip_T on the real trip from 28 Dec evening;
--  * draft (run config draft): every remaining trip day planned night after night from light
--    only, starting from what the trip has already shot (the live run's state), rebuilt every
--    night by planner_t_week() (cron planner-t-week, 04:23 UTC, after the Wyoming evening plans).
-- planner_t_trips holds each trip's T settings (gear window, bookings, fixed days: the run
-- config of the tested T on that trip's own stop ids and dates).

create table if not exists public.planner_t_trips (
  trip_id uuid primary key references trips(id),
  config jsonb not null,
  note text,
  updated_at timestamptz not null default now()
);

insert into planner_t_trips (trip_id, config, note)
select '5e247891-d800-4d07-b5e0-8ad748ae2754',
       config - 'name' - 'live' - 'plan_local' - 'stagger_min' - 'publish' || '{"req_budget_ms": 900}'::jsonb,
       'Grand Teton Winter 2026: T (live_T settings)'
  from replay_runs where config ->> 'name' = 'live_T' and coalesce((config ->> 'live')::boolean, false) order by id limit 1
on conflict (trip_id) do nothing;
insert into planner_t_trips (trip_id, config, note)
select '7e57bed0-0000-4000-8000-000000000003',
       config - 'name' - 'live' - 'plan_local' - 'stagger_min' - 'publish',
       'Teton Live practice copy: T (app_T settings)'
  from replay_runs where config ->> 'name' = 'app_T' order by id limit 1
on conflict (trip_id) do nothing;

-- The real trip's live T run: plans 29 Dec on the evening of 28 Dec, and so on to 4 Jan.
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select '5e247891-d800-4d07-b5e0-8ad748ae2754', date '2026-12-29',
       array(select d.date from days d where d.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' order by d.date), 7,
       p.config || '{"name": "trip_T", "live": true, "publish": true, "plan_local": "20:45", "stagger_min": 6}'::jsonb
  from planner_t_trips p where p.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754'
on conflict do nothing;

create or replace function public.planner_t_week(p_trip uuid default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare p record; v_tz text; v_from date; v_dates date[]; v_run bigint; v_state jsonb; v_sets jsonb; n int := 0;
begin
  for p in select * from planner_t_trips where p_trip is null or trip_id = p_trip loop
    select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = p.trip_id;
    v_from := (now() at time zone v_tz)::date + 1;
    v_dates := array(select d.date from days d where d.trip_id = p.trip_id and d.date >= v_from order by d.date);
    continue when coalesce(cardinality(v_dates), 0) = 0;
    -- What the trip has already shot: the live T run's state (newest), if it has started.
    select s.state, jsonb_build_object('seen', coalesce(s.sets -> 'seen', '[]'::jsonb)) into v_state, v_sets
      from replay_runs x join replay_run_state s on s.run_id = x.id and s.kind = 'mrmc'
     where x.trip_id = p.trip_id and coalesce((x.config ->> 'publish')::boolean, false)
       and not coalesce((x.config ->> 'draft')::boolean, false) and x.status in ('running', 'done')
     order by x.start_date desc limit 1;
    insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
    values (p.trip_id, v_dates[1], v_dates, cardinality(v_dates),
            p.config || jsonb_build_object('name', 'draft_T', 'draft', true, 'live', true, 'publish', true,
                                           'fc_days', 0, 'kinds', '["mrmc"]'::jsonb, 'made', now()),
            'queued')
    returning id into v_run;
    insert into replay_run_state (run_id, kind, night, state, sets)
    values (v_run, 'mrmc', 0, coalesce(v_state, '{}'::jsonb), v_sets);
    n := n + 1;
  end loop;
  if n > 0 and not exists (select 1 from cron.job where jobname = 'replay-run') then
    perform cron.schedule('replay-run', '20 seconds', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
  end if;
  return jsonb_build_object('drafts', n);
end $$;
revoke all on function public.planner_t_week(uuid) from public, anon, authenticated;

-- Tick: draft runs go straight through (no evening / morning wait, no forecast or morning
-- builds, light geometry for every day from tonight), and are never rescored.
do $$
declare d text; k int;
begin
  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);
  if position($o$    if v_live then
      select coalesce(t.timezone, 'UTC') into v_tz$o$ in d) = 0 then raise exception 'live gate not found'; end if;
  d := replace(d, $o$    if v_live then
      select coalesce(t.timezone, 'UTC') into v_tz$o$, $n$    if v_live and not coalesce((r.config ->> 'draft')::boolean, false) then
      select coalesce(t.timezone, 'UTC') into v_tz$n$);
  if position($o$        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then$o$ in d) = 0 then raise exception 'forecast build not found'; end if;
  d := replace(d, $o$        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then$o$,
                  $n$        if not coalesce((r.config ->> 'draft')::boolean, false) and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then$n$);
  k := (length(d) - length(replace(d, $o$        if i = r.night and v_kinds && array['mr1', 'mrmc'] and$o$, ''))) / length($o$        if i = r.night and v_kinds && array['mr1', 'mrmc'] and$o$);
  if k <> 2 then raise exception 'morning builds: found %', k; end if;
  d := replace(d, $o$        if i = r.night and v_kinds && array['mr1', 'mrmc'] and$o$,
                  $n$        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and$n$);
  if position($o$            where coalesce((x.config ->> 'live')::boolean, false) and d.realized is null$o$ in d) = 0 then raise exception 'rescore not found'; end if;
  d := replace(d, $o$            where coalesce((x.config ->> 'live')::boolean, false) and d.realized is null$o$,
                  $n$            where coalesce((x.config ->> 'live')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false) and d.realized is null$n$);
  execute d;
end $$;

select cron.schedule('planner-t-week', '23 4 * * *', $$select public.planner_t_week()$$);
