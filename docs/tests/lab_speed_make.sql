create or replace function lab_speed_make(p_trip uuid, p_variant text, p_tag text, p_at timestamptz) returns bigint
language plpgsql security definer set search_path to 'public' as $f$
declare p record; v_tz text; v_today date; v_dates date[]; v_seed jsonb; v_run bigint; d date; v_b boolean := p_variant like 'B%';
begin
  select * into p from planner_t_trips where trip_id = p_trip;
  select coalesce(t.timezone,'UTC') into v_tz from trips t where t.id = p_trip;
  v_today := (p_at at time zone v_tz)::date;
  v_dates := array(select dd.date from days dd where dd.trip_id = p_trip and dd.date >= v_today + 1 order by dd.date);
  v_seed := case when exists (select 1 from days dd where dd.trip_id = p_trip and dd.date = v_today)
                 then planner_t_rest_seed(p_trip, v_today, p_at)
                 else jsonb_build_object('plan', null, 'step', null, 'state', '{}'::jsonb, 'seen', '[]'::jsonb, 'n', 0) end;
  foreach d in array v_dates loop
    insert into replay_days (trip_id, replay_date, trip_date) values (p_trip, d, d) on conflict do nothing;
  end loop;
  perform solver_fill_light_cache(p_trip, v_dates, 5);
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  values (p_trip, v_dates[1], v_dates, cardinality(v_dates),
    p.config || jsonb_build_object('name', 'lab_speed_' || p_variant, 'draft', true, 'live', true, 'publish', false, 'lane', 'lab', 'as_app', true,
      'one_pass', false, 'fc_days', 0, 'kinds', '["mrmc"]'::jsonb, 'made', p_at,
      'rest_of', jsonb_build_object('date', v_today, 'at', p_at, 'req', null, 'plan', v_seed -> 'plan', 'step', v_seed -> 'step', 'seeded', v_seed -> 'n'))
    || jsonb_build_object('chain', v_b, 'chain_nights', v_b),
    case when v_b then 'running' else 'queued' end)
  returning id into v_run;
  insert into replay_run_state (run_id, kind, night, state, sets, status, started_at)
  values (v_run, 'mrmc', 0, v_seed -> 'state', jsonb_build_object('seen', v_seed -> 'seen'),
          case when v_b then 'planning' else 'idle' end, case when v_b then now() end);
  insert into lab_speed_runs (run_id, tag, trip_id, variant, made) values (v_run, p_tag, p_trip, p_variant, now());
  if v_b then
    perform net.http_post(url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay-lab',
      body := jsonb_build_object('run_id', v_run, 'kind', 'mrmc'), headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  end if;
  return v_run;
end $f$;
revoke all on function lab_speed_make(uuid, text, text, timestamptz) from public, anon, authenticated;
