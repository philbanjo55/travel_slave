-- Test every planner version on the new data (Phil, 28 Oct 2026, board b07): the
-- weeks since 1 Oct 2026 are a clean test that no version was built or tuned on.
--  * Truth for those weeks: the live hourly airport reports (station_obs_hourly,
--    same hidden rule as the METAR history: ceiling under the place's limit,
--    visibility under 1 km or fog) and our own live labels of the place's truth
--    camera (webcam_frames, Claude's hills_visible, stale / dark / broken frames
--    left out), next to the history sources. Nothing changes before Sep 2026.
--  * The fits (peaks hidden, morning look) learn only from data before 1 Oct 2026,
--    so the winter results stay exactly as they are and the new weeks stay out of
--    training. Season = replay_season(date): Oct 2026 is season 2026, so its own
--    replays are fitted on the two winters only.

create or replace view public.replay_hidden_obs with (security_invoker = true) as
  select p.trip_id, m.hr,
         (coalesce(m.ceiling_ft < p.ceiling_ft, false) or coalesce(m.visibility_m < 1000, false) or coalesce(m.fog, false))::int as hidden
    from replay_places p join metar_history m on m.station = p.station
  union all
  select p.trip_id, o.hr,
         (coalesce(o.ceiling_ft < p.ceiling_ft, false) or coalesce(o.visibility_m < 1000, false) or coalesce(o.fog, false))::int
    from replay_places p join station_obs_hourly o on o.station = p.station
   where o.hr >= timestamptz '2026-09-01'
     and not exists (select 1 from metar_history m where m.station = p.station and m.hr = o.hr);

create or replace view public.replay_hidden_truth with (security_invoker = true) as
  select o.trip_id, o.hr,
         greatest(o.hidden,
                  coalesce((select max((not l.hills_visible)::integer) from webcam_history_labels l
                             where l.camera_code = p.truth_cam and l.taken_at = o.hr and l.status = 'done'
                               and l.label <> all (array['dark', 'camera_problem'])), 0),
                  coalesce((select max((not f.hills_visible)::integer) from webcam_frames f
                             where f.camera_code = p.truth_cam and f.captured_at = o.hr and f.hills_visible is not null
                               and not coalesce(f.stale, false) and coalesce(f.label, '') <> all (array['dark', 'camera_problem'])), 0)) as hidden
    from replay_hidden_obs o join replay_places p on p.trip_id = o.trip_id;

do $$
declare d text;
begin
  d := pg_get_functiondef('replay_fit_hidden()'::regprocedure);
  if position('and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0' in d) = 0 then raise exception 'replay_fit_hidden: text not found'; end if;
  d := replace(d, 'and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0',
               'and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0
       and o.hr < timestamptz ''2026-10-01''  -- new-data test weeks stay out of training');
  execute d;

  d := pg_get_functiondef('replay_fit_morning()'::regprocedure);
  if position('join metar_stations s on s.icao = p.station
     where exists' in d) = 0 then raise exception 'replay_fit_morning: text not found'; end if;
  d := replace(d, 'join metar_stations s on s.icao = p.station
     where exists',
               'join metar_stations s on s.icao = p.station
     where o.hr < timestamptz ''2026-10-01''  -- new-data test weeks stay out of training
       and exists');
  execute d;
end $$;

-- Then (28 Oct, by hand): October 2026 METAR for KJAC and EKVG loaded into
-- metar_history from the same Iowa State archive as the winters
-- (calib_queue_month(site, 10, array[2026]) + calib_load_history(), 655 / 660 rows),
-- so the new weeks' airport truth comes from the same source as the old ones.
