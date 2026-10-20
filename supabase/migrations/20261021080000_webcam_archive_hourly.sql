-- Webcam archive hourly (night hours are skipped inside the function), so
-- the scoreboard and the camera card get more ground truth. :37 avoids the
-- Open-Meteo minute (:07).
select cron.unschedule('webcam-archive');
select cron.schedule('webcam-archive', '37 * * * *', $cron$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/webcam-archive',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 1000);
$cron$);
