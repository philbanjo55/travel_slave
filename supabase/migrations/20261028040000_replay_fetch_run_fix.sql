-- Fix for 20261028030000: the single-runs API refuses start_date/end_date
-- ("Parameter 'start_date' must not be set"); a 'run' row asks for the run's
-- first two days with forecast_days=2 instead (00 UTC of D to 23 UTC of D + 1).
do $$
declare d text;
  old text := '|| ''&start_date='' || r.start_date || ''&end_date='' || r.end_date || ''&timezone=UTC'';';
begin
  d := pg_get_functiondef('replay_fetch_tick()'::regprocedure);
  if position(old in d) = 0 then raise exception 'replay_fetch_tick: url tail not found'; end if;
  d := replace(d, old, '|| case when r.kind = ''run'' then ''&forecast_days=2''
                 else ''&start_date='' || r.start_date || ''&end_date='' || r.end_date end || ''&timezone=UTC'';');
  execute d;
end $$;

-- Then (by hand): the failed 'run' rows were queued again.
