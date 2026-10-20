-- F-23 (Vatnsoyrar north) shows only road and a rock cutting, no sky or hills
-- (Phil checked the 20 Oct 12 UTC frame), so it can't show weather. Archiving
-- stops (active = false); its stored frames and rows stay. The hint from
-- 20261021120000 was wrong and is replaced.
update public.webcam_cameras
   set active = false,
       hint = 'Near Sørvágsvatn on Vágar. Points at the road and a rock cutting, no sky or hills in view. Archiving stopped 20 Oct 2026 (Phil).'
 where code = 'F-23';
