-- Progress for the Re-plan bar (27 Nov 2026; applied 27 Nov 2026, Phil OK'd the before / after).
-- planner_t_now_status(trip) also returns, for the newest request:
--   planned_at  when the planner took it (status planning)
--   cams        how many cameras the finished plan used (result.cams)
--   while queued only:
--   cams_now    this hour's labelled camera pictures near the trip (t_truth ... ->> 'cams', the same count the tick waits on)
--   cams_need   2 (replay_run_tick plans once 2 or more are labelled, or after 4 minutes)
--   cams_wait   whether the tick waits for pictures at all (false with a sky report, or in the dark: no picture the hour before)
--   wait_until  requested_at + 4 minutes (the tick's longest wait)
-- Everything the function returned before is unchanged; the app works with or without the new keys.
-- Cost: two t_truth calls (~0.1 s each) only while a request is queued; the app asks every 5 s while one runs.
create or replace function public.planner_t_now_status(p_trip uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('id', q.id, 'status', q.status, 'requested_at', q.requested_at, 'done_at', q.done_at,
                            'note', q.note, 'changed', q.result -> 'changed', 'hidden', q.result -> 'hidden')
         || case when q.result ? 'rest' then jsonb_build_object('rest', q.result -> 'rest') else '{}'::jsonb end
         || jsonb_build_object('planned_at', q.planned_at, 'cams', q.result -> 'cams')
         || case when q.status = 'queued' then coalesce((
              select jsonb_build_object(
                       'cams_now', coalesce((t_truth(p.trip_id, date_trunc('hour', now()), s.lat, s.lng) ->> 'cams')::int, 0),
                       'cams_need', 2,
                       'cams_wait', (q.here ->> 'sky') is null
                                    and coalesce((t_truth(p.trip_id, date_trunc('hour', now()) - interval '1 hour', s.lat, s.lng) ->> 'cams')::int, 0) >= 1,
                       'wait_until', q.requested_at + interval '4 minutes')
                from replay_places p join metar_stations s on s.icao = p.station
               where p.trip_id = p_trip limit 1), '{}'::jsonb)
           else '{}'::jsonb end
    from planner_t_now q where q.trip_id = p_trip order by q.id desc limit 1
$function$;
