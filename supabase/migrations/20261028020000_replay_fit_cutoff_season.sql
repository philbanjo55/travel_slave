-- Fix to 20261028010000: the fits' cutoff was 1 Oct 2026, but the October downloads
-- start on 28 Sep, and replay_season puts 28-30 Sep in season 2026 (seasons run
-- July-June), so 518 hidden-peak hours (and 370 morning ones) from those days went
-- into the winters' training. The cutoff is now the start of season 2026
-- (30 Jun 2026): nothing from the new-data period trains anything. The Faroes
-- history (to 16 Jun 2026, season 2025) is unaffected. Refit and fitted_at bump
-- follow by hand (28 Oct), and the winter weeks built since the 11:46 UTC refit rerun.
do $$
declare d text; f text;
begin
  foreach f in array array['replay_fit_hidden()', 'replay_fit_morning()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('timestamptz ''2026-10-01''' in d) = 0 then raise exception '%: cutoff not found', f; end if;
    d := replace(d, 'timestamptz ''2026-10-01''', 'timestamptz ''2026-06-30''');
    execute d;
  end loop;
end $$;
