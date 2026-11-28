-- Forecast for later days, live shadow in the lab (Phil, 28 Nov 2026: "We need to see the full range of these changes
-- before we deploy ... especially on the live trip data"). Twice a day on Teton Live and Faroes Live (local noon and
-- 20:50, after T's evening plan) two lab drafts of the rest of the trip are made with the same seed: A = as live today
-- (later days on light only), B = + fc_live (later days on the forecast). Lab only (lane 'lab', publish false,
-- solver-replay-lab): nothing reaches the app or T. Graded later on the truth; B's first day is also compared with
-- T's evening plan for that day. Records in lab_fc_runs. Stop: unschedule cron lab-fc-shadow.
create table if not exists lab_fc_runs (run_id bigint primary key, tag text, trip_id uuid, variant text, at timestamptz, made timestamptz default now());
create or replace function lab_fc_make(p_trip uuid, p_variant text, p_tag text, p_at timestamptz, p_extra jsonb default '{}') returns bigint
language plpgsql security definer set search_path to 'public' as $f$
declare p record; v_tz text; v_today date; v_dates date[]; v_seed jsonb; v_run bigint; d date;
begin
  select * into p from planner_t_trips where trip_id = p_trip;
  select coalesce(t.timezone,'UTC') into v_tz from trips t where t.id = p_trip;
  v_today := (p_at at time zone v_tz)::date;
  v_dates := array(select dd.date from days dd where dd.trip_id = p_trip and dd.date >= v_today + 1 order by dd.date);
  if coalesce(cardinality(v_dates), 0) = 0 then return null; end if;
  v_seed := case when exists (select 1 from days dd where dd.trip_id = p_trip and dd.date = v_today)
                 then planner_t_rest_seed(p_trip, v_today, p_at)
                 else jsonb_build_object('plan', null, 'step', null, 'state', '{}'::jsonb, 'seen', '[]'::jsonb, 'n', 0) end;
  foreach d in array v_dates loop
    insert into replay_days (trip_id, replay_date, trip_date) values (p_trip, d, d) on conflict do nothing;
  end loop;
  perform solver_fill_light_cache(p_trip, v_dates, 5);
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  values (p_trip, v_dates[1], v_dates, cardinality(v_dates),
    p.config || jsonb_build_object('name', 'lab_fc_' || p_variant, 'draft', true, 'live', true, 'publish', false, 'lane', 'lab', 'as_app', true,
      'one_pass', false, 'fc_days', 0, 'kinds', '["mrmc"]'::jsonb, 'made', p_at, 'chain', true, 'chain_nights', true,
      'rest_of', jsonb_build_object('date', v_today, 'at', p_at, 'req', null, 'plan', v_seed -> 'plan', 'step', v_seed -> 'step', 'seeded', v_seed -> 'n'))
    || p_extra, 'running')
  returning id into v_run;
  insert into replay_run_state (run_id, kind, night, state, sets, status, started_at)
  values (v_run, 'mrmc', 0, v_seed -> 'state', jsonb_build_object('seen', v_seed -> 'seen'), 'planning', now());
  insert into lab_fc_runs (run_id, tag, trip_id, variant, at) values (v_run, p_tag, p_trip, p_variant, p_at);
  perform net.http_post(url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay-lab',
    body := jsonb_build_object('run_id', v_run, 'kind', 'mrmc'), headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  return v_run;
end $f$;
revoke all on function lab_fc_make(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
-- One pair per trip whose local time is noon or 20:50 this run (cron every 10 min, so it fires once per slot).
create or replace function lab_fc_shadow_tick() returns int
language plpgsql security definer set search_path to 'public' as $f$
declare t record; v_loc timestamp; v_slot text; n int := 0; v_at timestamptz := now();
begin
  for t in select x.id, coalesce(x.timezone, 'UTC') tz from trips x
            where x.id in ('7e57bed0-0000-4000-8000-000000000003', '7e57bed0-0000-4000-8000-000000000002') loop
    v_loc := v_at at time zone t.tz;
    v_slot := case when v_loc::time >= time '12:00' and v_loc::time < time '12:10' then 'noon'
                   when v_loc::time >= time '20:50' and v_loc::time < time '21:00' then 'evening' end;
    continue when v_slot is null;
    continue when exists (select 1 from lab_fc_runs r where r.trip_id = t.id and r.made > v_at - interval '30 minutes');
    perform lab_fc_make(t.id, 'A', v_slot || ' ' || (v_loc::date)::text, v_at, '{}');
    perform lab_fc_make(t.id, 'B', v_slot || ' ' || (v_loc::date)::text, v_at, '{"fc_live": true}');
    n := n + 2;
  end loop;
  return n;
end $f$;
revoke all on function lab_fc_shadow_tick() from public, anon, authenticated;
select cron.schedule('lab-fc-shadow', '*/10 * * * *', 'select public.lab_fc_shadow_tick()');
