-- Whole-week Accept (Phil, 2-3 Nov 2026: "do all 3"; "what if I'm already on day 3?").
-- solver_apply_week(trip, apply) applies T's newest plan for TODAY (only the visits still ahead)
-- and every later trip day at once, so stops move as T's week has them and nothing is borrowed
-- from a day and left behind. Days before today, and today's stops whose time has passed, are
-- frozen: never moved, used for a visit or set aside (solver_apply_plan reads the setting
-- solver.frozen_after). A preview runs the same steps and rolls them back.

-- 1. solver_apply_plan: honour solver.frozen_after (stops before it count as time-locked).
do $$
declare d text; o1 text; n1 text; o2 text; n2 text;
begin
  d := pg_get_functiondef('public.solver_apply_plan(uuid,integer,boolean)'::regprocedure);
  o1 := $o$  r record; v_entry uuid;$o$;
  n1 := $n$  r record; v_entry uuid; v_frozen timestamptz;$n$;
  o2 := $o$  insert into _ap2_stop
  select s.id, s.day_id, s.position, s.time_label, s.drive_override_minutes, s.name, lower(trim(s.name)), s.duration_minutes,
         coalesce(s.time_locked, false), false
    from stops s where s.trip_id = v_trip;$o$;
  n2 := $n$  -- solver_apply_week: days before now, and today's stops whose time has passed, are frozen
  -- (treated as time-locked: never moved, used for a visit or set aside).
  v_frozen := nullif(current_setting('solver.frozen_after', true), '')::timestamptz;
  insert into _ap2_stop
  select s.id, s.day_id, s.position, s.time_label, s.drive_override_minutes, s.name, lower(trim(s.name)), s.duration_minutes,
         coalesce(s.time_locked, false)
           or (v_frozen is not null and dd.date is not null
               and ((dd.date + make_interval(mins => coalesce(solver_label_minutes(s.time_label), 0)))::timestamp at time zone v_tz) < v_frozen),
         false
    from stops s left join days dd on dd.id = s.day_id where s.trip_id = v_trip;$n$;
  if position(o1 in d) = 0 then raise exception 'declare not found'; end if;
  if position(o2 in d) = 0 then raise exception '_ap2_stop insert not found'; end if;
  execute replace(replace(d, o1, n1), o2, n2);
end $$;

-- 2. The backtest skips the combined week plans (they repeat T's own day plans).
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.solver_backtest_run(boolean)'::regprocedure);
  o := $o$     where coalesce(p.note, '') <> 'apply test'$o$;
  n := $n$     where coalesce(p.note, '') <> 'apply test' and coalesce(r.stats ->> 'kind', '') <> 'week_apply'$n$;
  if position(o in d) = 0 then raise exception 'backtest filter not found'; end if;
  execute replace(d, o, n);
end $$;

-- 3. The week accept itself.
create or replace function public.solver_apply_week(p_trip uuid, p_apply boolean default false)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_tz text := solver_trip_tz(p_trip);
  v_now timestamptz := now();
  v_today date := (now() at time zone solver_trip_tz(p_trip))::date;
  v_visits jsonb := '[]'::jsonb; v_days jsonb := '[]'::jsonb;
  r record; v_run uuid; v_res jsonb; v_add jsonb;
begin
  for r in select d.date from days d where d.trip_id = p_trip and d.date >= v_today order by d.date loop
    -- T's newest plan for the day, forecast plans before light-only drafts (as the app shows it).
    select coalesce(jsonb_agg(v order by v ->> 'start'), '[]'::jsonb) into v_add
      from (select p.visits from solver_runs sr join solver_plans p on p.run_id = sr.id and p.rank = 1
             where sr.trip_id = p_trip and sr.stats ->> 'planner' = 'T' and sr.stats ->> 'kind' = 'day'
               and sr.stats -> 'days' -> 0 ->> 'trip_date' = r.date::text
             order by coalesce((sr.stats -> 'days' -> 0 ->> 'light_only')::boolean, false), sr.created_at desc
             limit 1) x,
           jsonb_array_elements(x.visits) v
     where (v ->> 'start')::timestamptz > v_now;
    if jsonb_array_length(v_add) > 0 then
      v_visits := v_visits || v_add;
      v_days := v_days || to_jsonb(r.date);
    end if;
  end loop;
  if jsonb_array_length(v_visits) = 0 then
    return jsonb_build_object('applied', false, 'nothing', true, 'week_days', v_days);
  end if;

  perform set_config('solver.frozen_after', v_now::text, true);
  if p_apply then
    insert into solver_runs (trip_id, plan_date, params, stats)
    values (p_trip, v_today, jsonb_build_object('planner', 'T', 'week_apply', true, 'tz', v_tz),
            jsonb_build_object('kind', 'week_apply', 'planner', 'T', 'week_days', v_days))
    returning id into v_run;
    insert into solver_plans (run_id, rank, objective, mean, cvar11, visits, note)
    values (v_run, 1, 0, 0, 0, v_visits, 'T: whole week');
    v_res := solver_apply_plan(v_run, 1, true);
  else
    begin
      insert into solver_runs (trip_id, plan_date, params, stats)
      values (p_trip, v_today, jsonb_build_object('planner', 'T', 'week_apply', true, 'tz', v_tz),
              jsonb_build_object('kind', 'week_apply', 'planner', 'T', 'week_days', v_days))
      returning id into v_run;
      insert into solver_plans (run_id, rank, objective, mean, cvar11, visits, note)
      values (v_run, 1, 0, 0, 0, v_visits, 'T: whole week');
      v_res := solver_apply_plan(v_run, 1, false);
      raise exception using errcode = 'U0001', message = 'preview rollback';
    exception when sqlstate 'U0001' then
      v_run := null;
    end;
  end if;
  perform set_config('solver.frozen_after', '', true);
  return v_res || jsonb_build_object('week_days', v_days, 'run_id', v_run, 'frozen_after', v_now);
end $$;
revoke all on function public.solver_apply_week(uuid, boolean) from public, anon, authenticated;
