-- planner_lab_follow: an experiment's extra settings can no longer override the lab keys (publish, lane, as_app, lab_of, lab_name, name); independent audit 18 Nov 2026.
CREATE OR REPLACE FUNCTION public.planner_lab_follow()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare l record; t record; s record; v_run bigint; n int := 0; k int;
begin
  -- A lab copy stops when its T run is no longer going or its experiment is switched off.
  update replay_runs x set status = 'stopped', note = 'lab: T run ended or experiment off', updated_at = now()
   where x.config ->> 'lane' = 'lab' and x.config ? 'lab_of' and x.status in ('queued', 'running')
     and (not exists (select 1 from replay_runs y where y.id = (x.config ->> 'lab_of')::bigint and y.status in ('queued', 'running', 'done'))
          or not exists (select 1 from planner_lab p where p.trip_id = x.trip_id and p.name = x.config ->> 'lab_name' and p.active));
  get diagnostics k = row_count;
  for l in select * from planner_lab where active order by id loop
    select x.* into t from replay_runs x
     where x.trip_id = l.trip_id and x.status = 'running' and coalesce((x.config ->> 'live')::boolean, false)
       and coalesce((x.config ->> 'publish')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false)
       and x.config ->> 'lane' is null
     order by x.id desc limit 1;
    continue when t.id is null;
    continue when exists (select 1 from replay_runs y where y.config ->> 'lane' = 'lab' and y.config ->> 'lab_of' = t.id::text and y.config ->> 'lab_name' = l.name);
    -- only between nights: T's state is at its current night, idle, nothing half done, tonight not planned yet
    select * into s from replay_run_state where run_id = t.id and kind = 'mrmc';
    continue when s.run_id is null or s.night <> t.night or s.status <> 'idle' or coalesce(s.sets, '{}'::jsonb) ? 'pending'
      or exists (select 1 from replay_run_days d where d.run_id = t.id and d.night = t.night);
    insert into replay_runs (trip_id, start_date, trip_dates, nights, night, config, status, note)
    values (t.trip_id, t.start_date, t.trip_dates, t.nights, t.night,
            -- extra first, the lab's own keys last, so no experiment can make a lab copy look like a T run
            ((t.config - 'publish') || (l.extra - 'publish' - 'lane' - 'as_app' - 'lab_of' - 'lab_name' - 'name')) || jsonb_build_object('publish', false, 'lane', 'lab', 'as_app', true,
              'lab_of', t.id, 'lab_name', l.name, 'name', 'lab_' || l.name,
              'plan_local', to_char(coalesce((t.config ->> 'plan_local')::time, time '20:30') + interval '10 minutes', 'HH24:MI')),
            'running', 'lab copy of run ' || t.id || ' from night ' || t.night)
    returning id into v_run;
    insert into replay_run_state (run_id, kind, night, state, sets, status, updated_at)
    values (v_run, 'mrmc', s.night, s.state, s.sets, 'idle', now());
    n := n + 1;
  end loop;
  return jsonb_build_object('started', n, 'stopped', k);
end $function$

;
