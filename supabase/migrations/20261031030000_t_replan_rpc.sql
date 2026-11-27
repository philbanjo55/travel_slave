-- "Plan again" in the TEST app runs T (Phil, 31 Oct 2026: the whole Planner on T): a new week
-- draft for the trip from tomorrow, at most one every 2 minutes per trip (one already queued or
-- running is reused). Callable with the app's public key, like the sun-planner RPCs: it only
-- starts T on trips listed in planner_t_trips.
create or replace function public.planner_t_replan(p_trip uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run bigint; v_at timestamptz;
begin
  if not exists (select 1 from planner_t_trips where trip_id = p_trip) then
    return jsonb_build_object('ok', false, 'error', 'T does not plan this trip');
  end if;
  select id, (config ->> 'made')::timestamptz into v_run, v_at from replay_runs
   where trip_id = p_trip and config ->> 'name' = 'draft_T'
     and (status in ('queued', 'running') or (config ->> 'made')::timestamptz > now() - interval '2 minutes')
   order by id desc limit 1;
  if v_run is not null then
    return jsonb_build_object('ok', true, 'run', v_run, 'since', v_at, 'reused', true);
  end if;
  perform planner_t_week(p_trip);
  select id, (config ->> 'made')::timestamptz into v_run, v_at from replay_runs where trip_id = p_trip and config ->> 'name' = 'draft_T' order by id desc limit 1;
  return jsonb_build_object('ok', true, 'run', v_run, 'since', v_at, 'reused', false);
end $$;
revoke all on function public.planner_t_replan(uuid) from public;
grant execute on function public.planner_t_replan(uuid) to anon, authenticated;

-- Which trips T plans (the app asks once per screen).
create or replace function public.planner_t_trip(p_trip uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from planner_t_trips where trip_id = p_trip)
$$;
revoke all on function public.planner_t_trip(uuid) from public;
grant execute on function public.planner_t_trip(uuid) to anon, authenticated;
