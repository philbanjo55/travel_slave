-- Planner test bench: camera truth for hidden peaks (Phil, 25 Oct 2026: "yeah
-- do the re-run"). The TetonCam check (webcam_history_labels) found KJAC
-- misses about 1 in 4 hours with cloud on the peaks, so truth builds now count
-- an hour as hidden when the airport or the place's camera says so (camera
-- frames read as dark or camera_problem don't count). The planner's own
-- hidden-peaks fit (replay_fit_hidden) still learns from the airport only, as
-- a real trip would. The 56 Teton trips are re-run as config "camera"; the
-- "base" results stay for comparison (replay_run_summary('camera')).

alter table replay_places add column if not exists truth_cam text references webcam_cameras(code);
update replay_places set truth_cam = 'GT-TETONIA' where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754';

create or replace view replay_hidden_truth with (security_invoker = true) as
select o.trip_id, o.hr,
       greatest(o.hidden, coalesce((
         select max((not l.hills_visible)::int) from webcam_history_labels l
          where l.camera_code = p.truth_cam and l.taken_at = o.hr and l.status = 'done'
            and l.label not in ('dark', 'camera_problem')), 0)) hidden
  from replay_hidden_obs o join replay_places p on p.trip_id = o.trip_id;

-- replay_build's truth branch reads the new view (one occurrence; the forecast
-- branch and replay_fit_hidden are unchanged).
do $$
declare d text := pg_get_functiondef('replay_build(bigint,text,integer)'::regprocedure);
begin
  if position('from replay_hidden_obs o' in d) = 0 then raise exception 'replay_build: truth lookup not found'; end if;
  execute replace(d, 'from replay_hidden_obs o', 'from replay_hidden_truth o');
end $$;

insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select trip_id, start_date, trip_dates, nights, '{"name": "camera"}'::jsonb
  from replay_runs where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and config ->> 'name' = 'base'
on conflict do nothing;

-- Result (25 Oct 2026, 56 trips each, good shots >= 150/250 per trip):
--   kind   base  camera
--   hs3     9.4   7.3
--   fc1     8.4   6.3   (beat "my" in 49 of 56 trips with camera truth)
--   fc3     8.6   6.6
--   lt3     7.9   6.0
--   my      4.3   2.9
-- The bench is idle after this, so its minute cron was removed (25 Oct 2026):
-- select cron.unschedule('replay-run');  -- re-add from 20261025080000 to run more
