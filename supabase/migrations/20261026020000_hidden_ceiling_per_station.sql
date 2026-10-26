-- "Low cloud / peaks hidden" from an airport = ceiling below that station's
-- metar_stations.hidden_ceiling_ft (default 2000 ft, right for Vagar; KJAC
-- 7000: the Grand is ~7,300 ft above the airport). Phil, 25 Oct 2026: fix it
-- for the learning planner too. Same rule in the backtest (20261026010000),
-- the history events (calibration priors), the live fit (learning planner)
-- and the scoreboard. Then the KJAC priors are refitted (history_octnov,
-- history_winter), one call each, and solver-fit-live / solver-build-calib
-- pick them up on their next run.

create or replace view metar_history_events as
 select h.station, h.hr,
        case when h.cloud_pct is not null then h.cloud_pct <= 50::double precision else null::boolean end as mostly_clear,
        case when h.ceiling_ft is not null or h.cloud_pct is not null or h.fog
             then coalesce(h.ceiling_ft < coalesce(m.hidden_ceiling_ft, 2000), false) or coalesce(h.fog, false) else null::boolean end as low_cloud,
        case when h.cloud_pct is not null and (h.fog is not null or h.visibility_m is not null)
             then coalesce(h.fog, false) or coalesce(h.visibility_m < 1000, false) else null::boolean end as fog,
        case when h.cloud_pct is not null then h.wet else null::boolean end as rain
   from metar_history h left join metar_stations m on m.icao = h.station;

do $$
declare d text;
begin
  d := pg_get_functiondef('solver_fit_calibration_live(text,text,text,real,integer)'::regprocedure);
  if position('o.ceiling_ft < 2000' in d) = 0 then raise exception 'solver_fit_calibration_live: rule not found'; end if;
  execute replace(d, 'o.ceiling_ft < 2000',
    'o.ceiling_ft < (select coalesce(max(ms.hidden_ceiling_ft), 2000) from metar_stations ms where ms.icao = o.station)');
  d := pg_get_functiondef('solver_verify_run()'::regprocedure);
  if position('coalesce(ceiling_ft < 2000, false)' in d) = 0 then raise exception 'solver_verify_run: rule not found'; end if;
  execute replace(d, 'coalesce(ceiling_ft < 2000, false)',
    'coalesce(ceiling_ft < (select coalesce(max(ms.hidden_ceiling_ft), 2000) from metar_stations ms where ms.icao = air.site), false)');
end $$;

-- Then, one at a time:
-- select solver_fit_calibration_months('KJAC', 'history_octnov', array[10, 11]);
-- select solver_fit_calibration_months('KJAC', 'history_winter', array[12, 1]);
-- select solver_fit_live_all();

-- Ran 25 Oct 2026 ~10:15 PM EDT (each call a few seconds). KJAC low cloud
-- after the refit (history_winter, lead 0): ECMWF low cloud <10% -> peaks
-- hidden 32% of hours (was 9%), 10-30% -> 80% (was 29%), 30-50% -> 88%.
