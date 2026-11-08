-- 8 Nov 2026 (Phil asked whether to remove them): GT-CLIMBERS and GT-ANTELOPE
-- have never saved a picture. From the database side both hosts resolve but
-- never accept a connection (20 s timeouts): the AAC camera server is off
-- (offline in winter), and Vaisala's image host refuses outside callers. Turned
-- off (not deleted) so each hourly run stops waiting 20 s on them; turn back
-- on to retry (AAC in spring).
update webcam_cameras set active = false
 where code in ('GT-CLIMBERS','GT-ANTELOPE');
