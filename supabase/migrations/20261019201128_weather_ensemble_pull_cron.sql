-- 20:17 UTC year-round: after ECMWF's 12z ensemble is normally published
-- (21:17 Faroe in summer, 20:17 in winter), and off the :07 hourly-weather-pull
-- so the two do not share Open-Meteo's per-minute quota.
select cron.schedule('weather-ensemble-pull', '17 20 * * *', $cmd$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/weather-ensemble-pull',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 1000);
$cmd$);
