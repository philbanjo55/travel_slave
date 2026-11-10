-- 8 Nov 2026 (Phil: "Turn on all cameras, ok going over 100"): read the four
-- new front-side Teton cameras now instead of from 1 Dec.
update webcam_cameras set label_paused = false
 where code in ('GT-LOSTCREEK','GT-MORAN','GT-EGVB','GT-GOLF');
select cron.unschedule('teton-seejh-read-dec');
