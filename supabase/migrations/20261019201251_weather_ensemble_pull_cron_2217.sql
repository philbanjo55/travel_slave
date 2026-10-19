-- At 20:11 UTC on 19 Oct 2026 Open-Meteo still served the 06z ECMWF ensemble,
-- so 20:17 would archive a 14 h old run. 22:17 UTC catches the 12z run.
select cron.alter_job((select jobid from cron.job where jobname = 'weather-ensemble-pull'), schedule := '17 22 * * *');
