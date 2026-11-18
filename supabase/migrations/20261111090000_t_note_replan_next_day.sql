-- Tell T: a note about tomorrow, saved before tomorrow's evening plan is made, re-plans the week draft at once
-- (the day card shows the draft until the evening plan; found in the first live trial, 11 Nov 2026). Same trial:
-- the list of what was re-planned is built with array_append (text[] || 'week' failed: malformed array literal),
-- and a note removed within a minute of its save got no re-plan of its own (the finished request was reused).
CREATE OR REPLACE FUNCTION public.planner_t_note_replan(p_trip uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v record; s record; v_d date; v_did text[] := '{}'; v_now jsonb; v_week jsonb; v_last date;
begin
  -- planner_t_now reuses a request made in the last minute, finished or not (a double tap in the app). A note saved
  -- or removed right after another re-plan still needs its own: a finished one no longer counts as recent.
  update planner_t_now set requested_at = requested_at - interval '2 minutes'
   where trip_id = p_trip and status in ('done', 'error') and requested_at > now() - interval '1 minute';
  select x.* into v from replay_runs x
   where x.trip_id = p_trip and x.status = 'running' and coalesce((x.config ->> 'live')::boolean, false)
     and coalesce((x.config ->> 'publish')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false)
     and coalesce((x.config ->> 'tell')::boolean, false)
   order by x.id desc limit 1;
  if v.id is not null then
    v_d := v.start_date + v.night;
    if (p_from is null or v_d >= p_from) and (p_to is null or v_d <= p_to) then
      select * into s from replay_run_state where run_id = v.id and night = v.night order by kind limit 1;
      if s.run_id is not null and s.status <> 'idle' then
        return jsonb_build_object('ok', true, 'busy', true);
      end if;
      if s.run_id is not null and (s.sets -> 'pending' ->> 'night')::int = v.night
         and coalesce(s.sets -> 'pending' ->> 'stage', 'night') in ('cands', 'mc', 'night') then
        update replay_run_state set sets = sets - 'pending', updated_at = now() where run_id = v.id and kind = s.kind and status = 'idle';
        v_did := array_append(v_did, 'evening'::text);
      elsif exists (select 1 from replay_live_today t where t.run_id = v.id and t.replay_date = v_d) then
        v_now := planner_t_now(p_trip);
        v_did := array_append(v_did, 'now'::text);
      end if;
    end if;
    -- A note for today while the run already points at tomorrow (today's morning plan is done).
    if v_d - 1 >= coalesce(p_from, v_d - 1) and (p_to is null or v_d - 1 <= p_to) and not ('now' = any (v_did))
       and exists (select 1 from replay_live_today t where t.run_id = v.id and t.replay_date = v_d - 1)
       and (now() at time zone (select coalesce(timezone, 'UTC') from trips where id = p_trip))::date = v_d - 1 then
      v_now := planner_t_now(p_trip);
      v_did := array_append(v_did, 'now'::text);
    end if;
  end if;
  select max(date) into v_last from days where trip_id = p_trip;
  if exists (select 1 from planner_t_trips where trip_id = p_trip and coalesce((config ->> 'tell')::boolean, false))
     -- (Also for the run's own next day while its evening plan is not made yet: the card shows the week draft till then.)
     and (p_to is null or p_to > coalesce(v_d, current_date) or (p_to = v_d and not ('evening' = any (v_did)) and not ('now' = any (v_did))
          and not exists (select 1 from replay_live_today t where t.run_id = v.id and t.replay_date = v_d)))
     and coalesce(p_from, current_date) <= v_last then
    -- A week draft in flight, or made in the last 2 minutes, may already have planned this note's days without it
    -- (planner_t_replan would hand that one back): it is stopped / no longer counted as recent, and a new one starts.
    update replay_runs set status = 'stopped', updated_at = now()
     where trip_id = p_trip and config ->> 'name' = 'draft_T' and status in ('queued', 'running');
    update replay_runs set config = jsonb_set(config, '{made}', to_jsonb(now() - interval '3 minutes'))
     where trip_id = p_trip and config ->> 'name' = 'draft_T' and (config ->> 'made')::timestamptz > now() - interval '2 minutes';
    v_week := planner_t_replan(p_trip);
    v_did := array_append(v_did, 'week'::text);
  end if;
  return jsonb_build_object('ok', true, 'did', to_jsonb(v_did), 'now', v_now, 'week', v_week);
end $function$;
