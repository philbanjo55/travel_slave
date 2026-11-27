-- Planner forecasts twice a day (Phil, 21 Oct 2026). On Open-Meteo the ECMWF
-- ensemble run is out ~9.5 h after it starts (06 UTC run: 15:37), so the old
-- 22:17 pull got the 06 UTC run anyway. Now:
--   10:17 pull (00 UTC run, full 15 days) -> 10:41 build, 10:49 calib build,
--         10:55 plans, 11:03 calib plans: re-plans today's afternoon/evening;
--   19:17 pull (06 UTC run)              -> 19:41 / 19:49 / 19:55 / 20:03;
--   the TEST app's brief reminder at 20:15 UTC (21:15 Faroe summer time).
select cron.alter_job((select jobid from cron.job where jobname = 'weather-ensemble-pull'), schedule := '17 10,19 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'solver-build-scores'), schedule := '41 10,19 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'solver-build-calib'), schedule := '49 10,19 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'solver-plan'), schedule := '55 10,19 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'solver-plan-calib'), schedule := '3 11,20 * * *');

-- The ensemble archive grows ~1.5 MB per pull and was never pruned; at two
-- pulls a day it would pass the 500 MB free-plan limit before May 2027.
-- Keep member data 30 days (the scoreboard verifies each night, the backtest
-- within 3 days); keep the pull rows, so solver_verify results (which
-- cascade from weather_ensemble_pulls) stay forever.
create or replace function public.prune_weather_ensemble(p_days integer default 30)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n integer;
begin
  delete from weather_ensemble e
   using weather_ensemble_pulls p
   where p.id = e.pull_id and p.pulled_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function public.prune_weather_ensemble(integer) from public, anon, authenticated;

select cron.schedule('weather-ensemble-retention', '44 4 * * *', $cmd$select public.prune_weather_ensemble(30);$cmd$);
