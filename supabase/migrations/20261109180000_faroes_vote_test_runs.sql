-- Faroes truth rule test runs (worksheet h5, planner version BG). Both arms are BA as the real Faroes trip
-- runs it (planner_t_trips config, without the camera look and live weather: no Faroes camera history),
-- judged by the camera vote (truth_vote), which for past Faroes Mays is the 1,000 ft airport rule
-- (20261109170000). foV_A = today's odds (learned on the 2,000 ft rule); foV_B = + vfit (odds learned on
-- the vote, i.e. the 1,000 ft rule). 33 May periods each, released by feeder job 'foV-feeder' (at most 3
-- Faroes runs at a time: more kill each other on CPU), arms interleaved so they finish together.
insert into public.planner_versions (letter, name, kind, settings, built_on, result_config, code, status, note)
values ('BG', 'BA + Faroes odds learned on the 1,000 ft airport rule (Faroes only)', 'mrmc',
        '{"vfit": true, "truth_vote": true, "mustfix": true, "tickfix": true}'::jsonb, 'BA', 'foV_B', 'solver-replay v95', 'testing',
        'Worksheet h5. The Faroes airport rule (EKVG ceiling under 2,000 ft) calls the peaks hidden 58% of daylight hours vs 24% by the camera majority (19 days, Oct-Nov 2026); 1,000 ft agrees with the cameras 78% of hours. Test: 33 Faroes May periods, foV_B (odds learned on the 1,000 ft rule) vs foV_A (today''s odds), both judged by the 1,000 ft rule. Teton unchanged.')
on conflict do nothing;

insert into public.replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select r.trip_id, r.start_date, r.trip_dates, r.nights,
       (t.config - 'early' - 'wx') || jsonb_build_object('name', a.name, 'truth_vote', true) || a.extra, 'held'
  from public.replay_runs r
  cross join (values ('foV_A', '{}'::jsonb), ('foV_B', '{"vfit": true}'::jsonb)) a(name, extra)
  join public.planner_t_trips t on t.trip_id = r.trip_id
 where r.config ->> 'name' = 'foR_T'
   and not exists (select 1 from public.replay_runs x where x.config ->> 'name' = a.name);

create or replace function public.replay_feed_fov()
 returns int
 language plpgsql
 set search_path to 'public'
as $function$
declare n int;
begin
  update replay_runs set status = 'queued', updated_at = now()
   where id in (select id from replay_runs where status = 'held' and config ->> 'name' in ('foV_A', 'foV_B')
                 order by start_date, config ->> 'name'
                 limit greatest(0, 3 - (select count(*) from replay_runs where status in ('queued', 'running')
                                                                   and config ->> 'name' in ('foV_A', 'foV_B'))));
  get diagnostics n = row_count;
  if not exists (select 1 from replay_runs where status = 'held' and config ->> 'name' in ('foV_A', 'foV_B')) then
    perform cron.unschedule('foV-feeder');
  end if;
  return n;
end
$function$;
revoke all on function public.replay_feed_fov() from public, anon, authenticated;
