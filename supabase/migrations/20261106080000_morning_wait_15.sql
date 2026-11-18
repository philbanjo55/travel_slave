-- Worksheet B3: morning re-plan waits at most 15 min for the airport report.
CREATE OR REPLACE FUNCTION public.replay_live_morning_ready(p_trip uuid, p_date date, p_stagger integer DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_look timestamptz := replay_look_at(p_trip, p_date) + make_interval(mins => coalesce(p_stagger, 0));
begin
  if now() < v_look + interval '5 minutes' then return false; end if;
  -- Worksheet B3 (6 Nov 2026): wait at most 15 min for the airport report (was 30: on 5 Nov it never came
  -- and the dawn re-plan landed at sunrise). Without it the build uses the latest report it has.
  if now() >= v_look + interval '15 minutes' then return true; end if;
  if exists (select 1 from station_obs_hourly o join replay_places p on p.station = o.station
              where p.trip_id = p_trip and o.hr >= v_look - interval '60 minutes'
                and o.fetched_at >= v_look - interval '45 minutes') then
    perform harvest_obs_extras();
    return true;
  end if;
  return false;
end $function$

;
