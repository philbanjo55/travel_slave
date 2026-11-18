-- 8 Nov 2026: the East Gros Ventre Butte stream prints its clock in UTC (17:34 on a 10:37 AM MST
-- fetch), so its first picture was flagged stale ("camera clock 17:34"). Read its clock as UTC
-- and clear that one false flag.
update webcam_cameras set tz = 'UTC' where code = 'GT-EGVB';
update webcam_frames set stale = false, stale_reason = null
 where camera_code = 'GT-EGVB' and stale_reason like 'camera clock%' and captured_at >= '2026-11-08';
