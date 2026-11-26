-- One-pass week draft (planner_t_rest): seed from today's plan only when today is a trip day.
-- Found 26 Nov 2026 when Teton Live was restarted with Day 1 = 27 Nov: the old round's 26 Nov camera plan seeded the
-- new week (rest_of.seeded 2), counting Swan Lake as done, so the mock week planned 16 of 17 places.
CREATE OR REPLACE FUNCTION public.planner_t_rest(p_trip uuid, p_at timestamp with time zone DEFAULT now(), p_req bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; v_tz text; v_today date; v_dates date[]; v_seed jsonb; v_run bigint; v_chain boolean; i int; v_shadow boolean;
begin
  select * into p from planner_t_trips where trip_id = p_trip;
  if p.trip_id is null then return jsonb_build_object('ok', false, 'error', 'T does not plan this trip'); end if;
  v_shadow := coalesce(p.config ->> 'one_pass' = 'shadow', false);
  select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = p_trip;
  v_today := (p_at at time zone v_tz)::date;
  v_dates := array(select d.date from days d where d.trip_id = p_trip and d.date >= v_today + 1 order by d.date);
  if coalesce(cardinality(v_dates), 0) = 0 then return jsonb_build_object('ok', true, 'run', null, 'reason', 'no days after today'); end if;
  -- 26 Nov 2026: seed only from a plan for today when today is a day of this trip. A practice round restarted
  -- mid-week (Teton Live, Day 1 = tomorrow) still had the old round's plan for today, and its afternoon
  -- visits (Swan Lake) counted as done, so the new week left them out.
  v_seed := case when exists (select 1 from days d where d.trip_id = p_trip and d.date = v_today)
                 then planner_t_rest_seed(p_trip, v_today, p_at)
                 else jsonb_build_object('plan', null, 'step', null, 'state', '{}'::jsonb, 'seen', '[]'::jsonb, 'n', 0) end;
  update replay_runs set status = 'stopped', updated_at = now()
   where trip_id = p_trip and config ->> 'name' = case when v_shadow then 'op_shadow_T' else 'draft_T' end and status in ('queued', 'running');
  v_chain := coalesce((p.config ->> 'chain_nights')::boolean, false);
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  values (p_trip, v_dates[1], v_dates, cardinality(v_dates),
          p.config || jsonb_build_object('name', case when v_shadow then 'op_shadow_T' else 'draft_T' end, 'draft', true, 'live', true, 'publish', true,
                                         'fc_days', 0, 'kinds', '["mrmc"]'::jsonb, 'made', now(),
                                         'rest_of', jsonb_build_object('date', v_today, 'at', p_at, 'req', p_req,
                                                                        'plan', v_seed -> 'plan', 'step', v_seed -> 'step', 'seeded', v_seed -> 'n'))
            || case when v_chain then jsonb_build_object('chain', true, 'chain_nights', true) else '{}'::jsonb end
            || case when v_shadow then jsonb_build_object('whatif', true) else '{}'::jsonb end,
          case when v_chain then 'running' else 'queued' end)
  returning id into v_run;
  -- v53: the past counts through Phil's ticks (solver-replay reads them); today's plan still ahead counts as done.
  insert into replay_run_state (run_id, kind, night, state, sets, status, started_at)
  values (v_run, 'mrmc', 0, v_seed -> 'state', jsonb_build_object('seen', v_seed -> 'seen'),
          case when v_chain then 'planning' else 'idle' end, case when v_chain then now() end);
  if v_chain then
    -- What the tick does before a run's first night: its days, the light geometry (topped up nightly anyway).
    for i in 1 .. least(3, cardinality(v_dates)) loop
      insert into replay_days (trip_id, replay_date, trip_date) values (p_trip, v_dates[i], v_dates[i]) on conflict do nothing;
    end loop;
    perform solver_fill_light_cache(p_trip, v_dates, 5);
    perform net.http_post(url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay',
      body := jsonb_build_object('run_id', v_run, 'kind', 'mrmc'),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  elsif not exists (select 1 from cron.job where jobname = 'replay-run') then
    perform cron.schedule('replay-run', '20 seconds', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
  end if;
  return jsonb_build_object('ok', true, 'run', v_run, 'seeded', v_seed -> 'n', 'from', v_seed -> 'step', 'chain', v_chain, 'shadow', v_shadow);
end $function$
;
