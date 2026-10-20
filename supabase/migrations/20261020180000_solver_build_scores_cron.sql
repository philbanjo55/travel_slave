-- Nightly score build, after weather-ensemble-pull (22:17 UTC) has landed.
-- Not at :07 (hourly-weather-pull). Only trips with rated stops.
select cron.schedule('solver-build-scores', '41 22 * * *', $cron$
  select public.solver_build_scores(t.id)
    from public.trips t
   where t.archived is not true
     and exists (select 1 from public.solver_stop_settings ss join public.stops s on s.id = ss.stop_id
                  where s.trip_id = t.id and ss.tier is not null);
$cron$);
