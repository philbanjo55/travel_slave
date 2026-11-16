-- Places story, bench step (Phil, 15 Nov 2026: "we can start the new test app"):
-- T builds the Faroes trip from places + stays + bookings vs Phil's own hand-made itinerary.
-- foV_B (33 past May periods, T as the real Faroes trip runs it) already has T's side;
-- foV_my plays Phil's schedule (kind 'my') on exactly the same config and periods.
insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select r.trip_id, r.start_date, r.trip_dates, r.nights,
       (r.config - 'name' - 'kinds') || jsonb_build_object('name', 'foV_my', 'kinds', jsonb_build_array('my')), 'held'
  from replay_runs r
 where r.config ->> 'name' = 'foV_B'
   and not exists (select 1 from replay_runs x where x.config ->> 'name' = 'foV_my' and x.start_date = r.start_date);

create or replace function public.replay_feed_fov()
 returns integer language plpgsql set search_path to 'public'
as $function$
declare n int;
begin
  update replay_runs set status = 'queued', updated_at = now()
   where id in (select id from replay_runs where status = 'held' and config ->> 'name' in ('foV_A', 'foV_B', 'foV_my')
                 order by start_date, config ->> 'name'
                 limit greatest(0, 3 - (select count(*) from replay_runs where status in ('queued', 'running')
                                                                   and config ->> 'name' in ('foV_A', 'foV_B', 'foV_my'))));
  get diagnostics n = row_count;
  if not exists (select 1 from replay_runs where status = 'held' and config ->> 'name' in ('foV_A', 'foV_B', 'foV_my')) then
    perform cron.unschedule('foV-feeder');
  end if;
  return n;
end
$function$;

select cron.schedule('foV-feeder', '* * * * *', 'select replay_feed_fov()');
