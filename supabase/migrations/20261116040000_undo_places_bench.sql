-- Undo the Places bench run (Phil, 15 Nov 2026: "without changing anything in the backend ... undo anything").
-- foV_my runs stopped; replay_feed_fov back to its 9 Nov form (foV_A / foV_B only); the feeder stays unscheduled.
update replay_runs set status = 'stopped', updated_at = now()
 where config ->> 'name' = 'foV_my' and status <> 'stopped';

create or replace function public.replay_feed_fov()
 returns integer language plpgsql set search_path to 'public'
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
