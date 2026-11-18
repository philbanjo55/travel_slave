-- Tell T: after a note is saved or deleted, re-plan the days it touches (called by edge function t-notes).
--   - the day T is planning or living now (the live run's night) inside the note's dates:
--       evening plan made, morning not yet  -> the saved evening plan is set aside, so the scheduler makes it again
--                                              with the note (same path as the first time, a new 'T: evening plan');
--       the day is under way (morning plan) -> Re-plan now (planner_t_now: the rest of today from where the plan is);
--       no evening plan yet                 -> nothing to do, the evening plan reads the note.
--   - any later day in the note's dates     -> the week draft is made again (planner_t_replan).
-- A step in flight is never touched: the answer is busy and the caller tries again a few seconds later.
create or replace function public.planner_t_note_replan(p_trip uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v record; s record; v_d date; v_did text[] := '{}'; v_now jsonb; v_week jsonb; v_last date;
begin
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
        v_did := v_did || 'evening';
      elsif exists (select 1 from replay_live_today t where t.run_id = v.id and t.replay_date = v_d) then
        v_now := planner_t_now(p_trip);
        v_did := v_did || 'now';
      end if;
    end if;
    -- A note for today while the run already points at tomorrow (today's morning plan is done).
    if v_d - 1 >= coalesce(p_from, v_d - 1) and (p_to is null or v_d - 1 <= p_to) and not ('now' = any (v_did))
       and exists (select 1 from replay_live_today t where t.run_id = v.id and t.replay_date = v_d - 1)
       and (now() at time zone (select coalesce(timezone, 'UTC') from trips where id = p_trip))::date = v_d - 1 then
      v_now := planner_t_now(p_trip);
      v_did := v_did || 'now';
    end if;
  end if;
  select max(date) into v_last from days where trip_id = p_trip;
  if exists (select 1 from planner_t_trips where trip_id = p_trip and coalesce((config ->> 'tell')::boolean, false))
     and (p_to is null or p_to > coalesce(v_d, current_date)) and coalesce(p_from, current_date) <= v_last then
    v_week := planner_t_replan(p_trip);
    v_did := v_did || 'week';
  end if;
  return jsonb_build_object('ok', true, 'did', to_jsonb(v_did), 'now', v_now, 'week', v_week);
end $$;
revoke all on function public.planner_t_note_replan(uuid, date, date) from public, anon, authenticated;
