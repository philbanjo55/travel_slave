-- Dry run reports the summary (all tiers, lead 0 included) instead of rows.
do $do$
declare d text := pg_get_functiondef('public.solver_backtest_run(boolean)'::regprocedure);
declare n text;
begin
  n := replace(d,
$a$      (select jsonb_agg(jsonb_build_object('kind', plan_kind, 'tier', tier, 'src', truth_source, 'km', truth_km,
                                           'at', to_char(visit_at, 'HH24:MI'), 'hidden', hidden, 'sun', sun,
                                           'realized', realized, 'baseline', round(baseline::numeric, 2), 'p_good', p_good)
                        order by plan_kind, visit_at)
         from solver_backtest where scored_at = now());$a$,
$b$      (select jsonb_agg(to_jsonb(s)) from solver_backtest_summary(30, null, 0) s);$b$);
  if n = d then raise exception 'solver_backtest_run text not matched'; end if;
  execute n;
end $do$;
