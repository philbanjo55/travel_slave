-- Scoreboard and backtest used one airport, EKVG. Now every METAR station
-- within 30 km of a live trip's stop (scoreboard) or 12 km of a visit
-- (backtest) counts, so KJAC scores the Grand Teton trip. Backtest daylight
-- at an airport comes from the sun's altitude there (sun_position) instead
-- of "an hour with a daylight Faroe webcam frame".

do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.solver_verify_run'::regproc);
  n := replace(d,
$a$     where m.icao = 'EKVG' and pl.pulled_at > now() - interval '9 days'$a$,
$b$     where pl.pulled_at > now() - interval '9 days'
       and exists (select 1 from stops s join trips t on t.id = s.trip_id
                    where t.archived is not true and (t.end_date is null or t.end_date >= current_date)
                      and s.lat is not null and gc_km(m.lat, m.lng, s.lat, s.lng) <= 30)$b$);
  if n = d then raise exception 'solver_verify_run text not matched'; end if;
  execute n;

  d := pg_get_functiondef('public.solver_backtest_run(boolean)'::regprocedure);
  n := replace(replace(d,
$a$    select icao, 'airport', lat, lng from metar_stations where icao = 'EKVG'$a$,
$b$    select icao, 'airport', lat, lng from metar_stations where lat is not null$b$),
$a$      from station_obs_hourly o
     where o.station = 'EKVG'
       -- daylight hours: an hour with any daylight webcam frame
       and exists (select 1 from webcam_frames f where f.sun_altitude > 3 and date_trunc('hour', f.captured_at) = o.hr)$a$,
$b$      from station_obs_hourly o
      join metar_stations m on m.icao = o.station
     -- daylight hours at the airport itself
     where (select sp.altitude from sun_position(o.hr, m.lat, m.lng) sp) > 3$b$);
  if n = d or n like '%EKVG%' then raise exception 'solver_backtest_run text not matched'; end if;
  execute n;
end $do$;
