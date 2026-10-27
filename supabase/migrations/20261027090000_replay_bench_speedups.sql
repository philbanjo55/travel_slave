-- Planner test bench speed-ups (Phil, 27 Oct 2026: "do them all, and run the same
-- tests against them"). None of these change a plan or a score:
--  * a plan with no answer is retried after 2 minutes, not 5 (requests take
--    under 15 s; ~8% died with the worker's memory limit and each cost 5 min);
--  * builds are kept between runs and only rebuilt when the fits change
--    (created before replay_places.fitted_at), instead of rebuilt per test;
--    bump replay_places.fitted_at after any manual refit;
--  * light geometry of past bench days is only cleared when the database is
--    over 1.5 GB (it was cleared and refilled for every test);
--  * 12 runs at a time (was 8);
--  * cron replay-run every 20 seconds (was every minute).
do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  old_clear text := '|| ''and d.trip_id = $1 and ($2::date is null or d.replay_date < $2)'' using r.trip_id, r.lo;';
  pairs text[][] := array[
    array['where status = ''planning'' and started_at < now() - interval ''5 minutes'';',
          'where status = ''planning'' and started_at < now() - interval ''2 minutes'';'],
    array[old_clear,
          '|| ''and d.trip_id = $1 and b.created_at < (select pl.fitted_at from replay_places pl where pl.trip_id = $1)'' using r.trip_id, r.lo;'],
    array['and (r.lo is null or d.replay_date < r.lo) limit 20 loop',
          'and pg_database_size(current_database()) > 1536::bigint * 1024 * 1024 limit 20 loop'],
    array['v_slots int := 8;', 'v_slots int := 12;']
  ];
  k int;
begin
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_run_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;

-- Builds made before this point used older fits (the morning fit was refit by
-- hand at 13:57 UTC): start clean.
update public.replay_places set fitted_at = now() where trip_id is not null;

select cron.alter_job((select jobid from cron.job where jobname = 'replay-run'), schedule := '20 seconds');
