-- 8 Nov 2026: the camera look after sunrise (first capture at :37 at least 30 min after sunrise, + 13 min for
-- its labels) ran an hour late when look_at + 60 min (= sunrise + 30) landed exactly on :37 (Teton Live 8 Nov:
-- 8:50 AM MST instead of 7:50). +82 min instead of +83 keeps that capture.
CREATE OR REPLACE FUNCTION public.replay_early_at(p_trip uuid, p_date date)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select date_trunc('hour', replay_look_at(p_trip, p_date) + interval '82 minutes') + interval '50 minutes'
$function$

;
