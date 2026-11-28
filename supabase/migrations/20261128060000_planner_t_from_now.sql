-- Re-plan from now on (Phil, 28 Nov 2026: "it should be 'replan from now on' using the missed it or not missed it
-- stuff"; "If I'm replanning in the middle of the day it's bc I'm trying to see if there's a better end of the same
-- day"). One call for the app's one button, any time:
--   today still has a stop not yet begun (today's live plan, replay_live_today) -> planner_t_now: the rest of today
--     planned afresh from where you are (cameras of this hour, your ticks decide what is still wanted), then, with
--     one_pass, the rest of the trip around that new end of today (planner_t_rest);
--   otherwise (evening, before the trip, a day off) -> planner_t_rest: every later day.
-- With fc_live in the trip's config, the later days use the forecast where it reaches (solver-replay).
create or replace function planner_t_from_now(p_trip uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $f$
declare v_tz text; v_today date; v_run bigint; v_left boolean := false; r jsonb;
begin
  if not exists (select 1 from planner_t_trips where trip_id = p_trip) then
    return jsonb_build_object('ok', false, 'error', 'T does not plan this trip');
  end if;
  select coalesce(timezone, 'UTC') into v_tz from trips where id = p_trip;
  v_today := (now() at time zone v_tz)::date;
  select x.id into v_run from replay_runs x
   where x.trip_id = p_trip and x.status = 'running' and coalesce((x.config ->> 'live')::boolean, false)
     and coalesce((x.config ->> 'publish')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false)
     and v_today between x.start_date and x.start_date + x.nights - 1
   order by x.id desc limit 1;
  if v_run is not null then
    select exists (select 1 from replay_live_today t, jsonb_array_elements(t.visits) v
                    where t.run_id = v_run and t.replay_date = v_today
                      and to_timestamp((v ->> 'startMs')::double precision / 1000) > now())
      into v_left;
  end if;
  if v_left then
    r := planner_t_now(p_trip);
    if coalesce((r ->> 'ok')::boolean, false) then return r || jsonb_build_object('mode', 'today'); end if;
  end if;
  return planner_t_rest(p_trip) || jsonb_build_object('mode', 'rest');
end $f$;
grant execute on function planner_t_from_now(uuid) to anon, authenticated;
