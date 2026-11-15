-- One-pass Re-plan (Phil, 15 Nov 2026; planner version BH; solver-replay v102). DRAFT: not applied.
-- "if my initial plan has stop A on it but when I replan stop A is no longer there I want that to trickle down to the
-- rest of the week so it gets planned somewhere automatically, at the same time."
--
-- Today a Re-plan now plans the rest of TODAY and Plan again a week draft from TOMORROW, and neither knows the other:
-- a place the re-plan drops waits for the nightly draft, and the draft re-plans places still planned today.
-- With the switch on (planner_t_trips.config.one_pass, copied into the trip's live T run config), every Re-plan now
-- (button, Tell T note about today, "I'm at X", sky report) goes straight on to a week draft from tomorrow that starts
-- from today's NEW plan: its visits still ahead count as done at their expected value (the way a draft counts its own
-- earlier days), so a dropped place is open again and lands on its best later day, and places still planned today are
-- not planned again for nothing. The nightly / Plan again draft starts from today's plan the same way while today's
-- stops are not over (the Faroes 04:23 UTC draft is made at dawn: it re-planned today's places from tomorrow).
-- Switch off = every function below that already existed behaves exactly as before.
--
-- Optional speed (planner_t_trips.config.chain_nights, also copied into the drafts): the draft's nights and their
-- steps start each other at once (solver-replay calls itself) instead of one per 20-s tick; a call that gets lost is
-- reset by the tick after 2 minutes and then planned as usual.

-- The rest-of-trip seed: today's newest T plan (evening plan, morning re-plans or re-plan now), visits still ahead at
-- p_at (not marked done, ending after it) with a value (rated places): state = expected value x 250 per stop, seen.
create or replace function public.planner_t_rest_seed(p_trip uuid, p_date date, p_at timestamptz default now(), p_asof timestamptz default now())
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with r as (
    select r.id, r.params ->> 'step' step from solver_runs r
     where r.trip_id = p_trip and r.plan_date = p_date and r.params ->> 'planner' = 'T'
       and r.params ->> 'step' in ('night', 'morning', 'early', 'now') and r.created_at <= p_asof
     order by r.created_at desc limit 1),
  v as (
    select x ->> 'stop_id' stop_id, max(round(250 * (x ->> 'value')::numeric))::int val
      from r join solver_plans p on p.run_id = r.id and p.rank = 1
     cross join jsonb_array_elements(p.visits) x
     where x ->> 'value' is not null and not coalesce((x ->> 'done')::boolean, false)
       and (x ->> 'end')::timestamptz > p_at
     group by 1)
  select jsonb_build_object('plan', (select id from r), 'step', (select step from r),
                            'state', coalesce((select jsonb_object_agg(stop_id, val) from v), '{}'::jsonb),
                            'seen', coalesce((select jsonb_agg(stop_id order by stop_id) from v), '[]'::jsonb),
                            'n', (select count(*) from v))
$$;
revoke all on function public.planner_t_rest_seed(uuid, date, timestamptz, timestamptz) from public, anon, authenticated;

-- The rest of the trip from tomorrow, planned around today's plan as it stands at p_at (backend only: solver-replay's
-- one-pass step, planner_t_week with the switch on). Stops older drafts still in flight (they planned without it).
create or replace function public.planner_t_rest(p_trip uuid, p_at timestamptz default now(), p_req bigint default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare p record; v_tz text; v_today date; v_dates date[]; v_seed jsonb; v_run bigint; v_chain boolean; i int;
begin
  select * into p from planner_t_trips where trip_id = p_trip;
  if p.trip_id is null then return jsonb_build_object('ok', false, 'error', 'T does not plan this trip'); end if;
  select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = p_trip;
  v_today := (p_at at time zone v_tz)::date;
  v_dates := array(select d.date from days d where d.trip_id = p_trip and d.date >= v_today + 1 order by d.date);
  if coalesce(cardinality(v_dates), 0) = 0 then return jsonb_build_object('ok', true, 'run', null, 'reason', 'no days after today'); end if;
  v_seed := planner_t_rest_seed(p_trip, v_today, p_at);
  update replay_runs set status = 'stopped', updated_at = now()
   where trip_id = p_trip and config ->> 'name' = 'draft_T' and status in ('queued', 'running');
  v_chain := coalesce((p.config ->> 'chain_nights')::boolean, false);
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  values (p_trip, v_dates[1], v_dates, cardinality(v_dates),
          p.config || jsonb_build_object('name', 'draft_T', 'draft', true, 'live', true, 'publish', true,
                                         'fc_days', 0, 'kinds', '["mrmc"]'::jsonb, 'made', now(),
                                         'rest_of', jsonb_build_object('date', v_today, 'at', p_at, 'req', p_req,
                                                                        'plan', v_seed -> 'plan', 'step', v_seed -> 'step', 'seeded', v_seed -> 'n'))
            || case when v_chain then jsonb_build_object('chain', true, 'chain_nights', true) else '{}'::jsonb end,
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
  return jsonb_build_object('ok', true, 'run', v_run, 'seeded', v_seed -> 'n', 'from', v_seed -> 'step', 'chain', v_chain);
end $$;
revoke all on function public.planner_t_rest(uuid, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.planner_t_rest(uuid, timestamptz, bigint) to service_role;

-- planner_t_week: as before, except a trip with the switch on gets the seeded draft (planner_t_rest).
CREATE OR REPLACE FUNCTION public.planner_t_week(p_trip uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare p record; v_tz text; v_from date; v_dates date[]; v_run bigint; v_state jsonb; v_sets jsonb; n int := 0; v_r jsonb;
begin
  perform planner_t_autoadd();
  for p in select * from planner_t_trips where p_trip is null or trip_id = p_trip loop
    -- One-pass Re-plan (15 Nov 2026): the draft starts from today's plan while today's stops are not over.
    if coalesce((p.config ->> 'one_pass')::boolean, false) then
      v_r := planner_t_rest(p.trip_id);
      if (v_r ->> 'run') is not null then n := n + 1; end if;
      continue;
    end if;
    select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = p.trip_id;
    v_from := (now() at time zone v_tz)::date + 1;
    v_dates := array(select d.date from days d where d.trip_id = p.trip_id and d.date >= v_from order by d.date);
    continue when coalesce(cardinality(v_dates), 0) = 0;
    v_state := null; v_sets := null;
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
    -- v53: the past counts through Phil's ticks only (solver-replay reads them).
    insert into replay_run_state (run_id, kind, night, state, sets)
    values (v_run, 'mrmc', 0, '{}'::jsonb, '{"seen": []}'::jsonb);
    n := n + 1;
  end loop;
  if n > 0 and not exists (select 1 from cron.job where jobname = 'replay-run') then
    perform cron.schedule('replay-run', '20 seconds', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
  end if;
  return jsonb_build_object('drafts', n);
end $function$;

-- What the app's one Re-plan button will do now (TEST app, flag off on Phil's phone): 'today' = today's stops are
-- not over and T is re-planning today (Re-plan now, then the rest of the trip), 'rest' = tomorrow on (the week draft).
create or replace function public.planner_t_replan_mode(p_trip uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_tz text; v_today date; v record; v_one boolean;
begin
  if not exists (select 1 from planner_t_trips where trip_id = p_trip) then
    return jsonb_build_object('ok', false, 'error', 'T does not plan this trip');
  end if;
  select coalesce(timezone, 'UTC') into v_tz from trips where id = p_trip;
  v_today := (now() at time zone v_tz)::date;
  select x.* into v from replay_runs x
   where x.trip_id = p_trip and x.status = 'running' and coalesce((x.config ->> 'live')::boolean, false)
     and coalesce((x.config ->> 'publish')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false)
     and v_today between x.start_date and x.start_date + x.nights - 1
   order by x.id desc limit 1;
  v_one := coalesce((v.config ->> 'one_pass')::boolean, false);
  if v.id is not null and exists (select 1 from replay_live_today t where t.run_id = v.id and t.replay_date = v_today)
     and exists (select 1 from solver_runs r join solver_plans p on p.run_id = r.id and p.rank = 1
                  cross join jsonb_array_elements(p.visits) x
                  where r.id = (select r2.id from solver_runs r2 where r2.trip_id = p_trip and r2.plan_date = v_today
                                   and r2.params ->> 'planner' = 'T' and r2.params ->> 'step' in ('night', 'morning', 'early', 'now')
                                 order by r2.created_at desc limit 1)
                    and not coalesce((x ->> 'done')::boolean, false) and (x ->> 'end')::timestamptz > now()) then
    return jsonb_build_object('ok', true, 'mode', 'today', 'one_pass', v_one);
  end if;
  return jsonb_build_object('ok', true, 'mode', 'rest', 'one_pass', v_one);
end $$;
revoke all on function public.planner_t_replan_mode(uuid) from public;
grant execute on function public.planner_t_replan_mode(uuid) to anon, authenticated;

-- The one Re-plan button: today + the rest of the trip, or tomorrow on once today's stops are over.
-- Without the switch on the live run it does what the two old buttons did together (Re-plan now + Plan again).
create or replace function public.planner_t_replan_one(p_trip uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m jsonb; r jsonb; w jsonb;
begin
  m := planner_t_replan_mode(p_trip);
  if not coalesce((m ->> 'ok')::boolean, false) then return m; end if;
  if m ->> 'mode' = 'today' then
    r := planner_t_now(p_trip);
    if not coalesce((r ->> 'ok')::boolean, false) then
      w := planner_t_replan(p_trip);
      return jsonb_build_object('ok', coalesce((w ->> 'ok')::boolean, false), 'mode', 'rest', 'week', w, 'now_error', r ->> 'error');
    end if;
    if not coalesce((m ->> 'one_pass')::boolean, false) then w := planner_t_replan(p_trip); end if;
    return jsonb_build_object('ok', true, 'mode', 'today', 'now', r, 'week', w, 'one_pass', (m -> 'one_pass'));
  end if;
  w := planner_t_replan(p_trip);
  return jsonb_build_object('ok', coalesce((w ->> 'ok')::boolean, false), 'mode', 'rest', 'week', w);
end $$;
revoke all on function public.planner_t_replan_one(uuid) from public;
grant execute on function public.planner_t_replan_one(uuid) to anon, authenticated;

-- The Re-plan now status also hands back the rest-of-trip draft it started (only when it did: unchanged otherwise).
CREATE OR REPLACE FUNCTION public.planner_t_now_status(p_trip uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', q.id, 'status', q.status, 'requested_at', q.requested_at, 'done_at', q.done_at,
                            'note', q.note, 'changed', q.result -> 'changed', 'hidden', q.result -> 'hidden')
         || case when q.result ? 'rest' then jsonb_build_object('rest', q.result -> 'rest') else '{}'::jsonb end
    from planner_t_now q where q.trip_id = p_trip order by q.id desc limit 1
$function$;

-- Planner versions registry: BH = BA + one-pass Re-plan (live only; the bench plans are BA's).
insert into planner_versions (letter, name, kind, settings, built_on, result_config, code, status, note, updated_at)
values ('BH', 'BA + one-pass Re-plan: today, then the rest of the trip planned around today''s new plan', 'mrmc',
        '{"one_pass": true, "mustfix": true, "tickfix": true}'::jsonb, 'BA', 'op_sim', 'solver-replay v102', 'testing',
        'Live switch one_pass (and chain_nights for speed). Night and morning plans unchanged. Bench test: shown rest-of-trip plan after a noon re-plan, one-pass vs the stale draft.',
        now())
on conflict (letter) do nothing;
