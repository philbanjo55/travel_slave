-- Planner test bench: a Faroes night (truth + forecast builds for 3 dates)
-- can take over pg_cron's 2-minute statement timeout, and the cancel is not
-- caught, so the whole tick was lost. Give the tick 10 minutes (pg_cron never
-- runs two copies of one job at once).
select cron.schedule('replay-run', '* * * * *', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
