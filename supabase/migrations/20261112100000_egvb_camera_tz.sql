-- GT-EGVB (East Gros Ventre Butte camera, added 8 Nov) was left on the column default time zone UTC;
-- every other Teton camera is on America/Denver. Found by the new-trip checklist audit, 12 Nov 2026.
update public.webcam_cameras set tz = 'America/Denver' where code = 'GT-EGVB' and tz = 'UTC';
