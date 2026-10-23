-- Backtest summaries counted untiered visits (airport, groceries, hotels),
-- which have no chance to judge. Only rated stops count now.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.solver_backtest_compare(integer,text[],integer)'::regprocedure);
  if position('and (p_tiers is null or b.tier = any(p_tiers))' in d) = 0 then raise exception 'pattern not found'; end if;
  execute replace(d, 'and (p_tiers is null or b.tier = any(p_tiers))', 'and b.tier is not null and (p_tiers is null or b.tier = any(p_tiers))');
  d := pg_get_functiondef('public.solver_backtest_summary(integer,text[],integer)'::regprocedure);
  if position('and (p_tiers is null or b.tier = any(p_tiers))' in d) = 0 then raise exception 'pattern not found (summary)'; end if;
  execute replace(d, 'and (p_tiers is null or b.tier = any(p_tiers))', 'and b.tier is not null and (p_tiers is null or b.tier = any(p_tiers))');
end $$;
