-- station_obs_hourly (airport truth for the scoreboard and the backtest) was
-- refreshed only when older than 20 h, as one 14-day download, so on 22 Oct
-- it stopped at 07 UTC and the 23:29 / 23:33 jobs had no airport truth for
-- the day. Now: refresh when older than 3 h; the last 2 days, or 14 days
-- when older than 20 h.
do $$
declare d text; o1 text; n1 text; o2 text; n2 text;
begin
  d := pg_get_functiondef('public.refresh_model_skill_step(integer)'::regprocedure);
  o1 := $o$  -- G. Queue 14 days of observations when older than 20 h
  v_n := 0;
  for r in
    select a.icao from active_metar_stations() a(icao)
    where coalesce((select max(fetched_at) from station_obs_hourly o where o.station = a.icao), 'epoch') < now() - interval '20 hours'$o$;
  n1 := $n$  -- G. Queue observations when older than 3 h (the scoreboard and backtest
  -- run the same evening): the last 2 days, or 14 days when older than 20 h.
  v_n := 0;
  for r in
    select a.icao, coalesce((select max(fetched_at) from station_obs_hourly o where o.station = a.icao), 'epoch') > now() - interval '20 hours' as recent
    from active_metar_stations() a(icao)
    where coalesce((select max(fetched_at) from station_obs_hourly o where o.station = a.icao), 'epoch') < now() - interval '3 hours'$n$;
  o2 := $o$values (net.http_get(url := format('https://aviationweather.gov/api/data/metar?ids=%s&format=json&hours=336', r.icao),$o$;
  n2 := $n$values (net.http_get(url := format('https://aviationweather.gov/api/data/metar?ids=%s&format=json&hours=%s', r.icao, case when r.recent then 48 else 336 end),$n$;
  if position(o1 in d) = 0 or position(o2 in d) = 0 then raise exception 'pattern not found'; end if;
  execute replace(replace(d, o1, n1), o2, n2);
end $$;
