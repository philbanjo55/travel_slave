-- Airport reports (station_obs_hourly) refreshed only when older than 3 h, so the Feeds page
-- showed Jackson's report 3 h old (Phil, 3 Nov 2026: yes to hourly). Now when older than
-- 55 min: each new hourly METAR is in within about an hour. model-skill-refresh runs every 10 min.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.refresh_model_skill_step(integer)'::regprocedure);
  if position($p$< now() - interval '3 hours'$p$ in d) = 0 then raise exception 'pattern not found'; end if;
  execute replace(d, $p$< now() - interval '3 hours'$p$, $p$< now() - interval '55 minutes'$p$);
end $$;
