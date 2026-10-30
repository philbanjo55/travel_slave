-- Live runs keep going after a failure (Phil, 30 Oct 2026: T must always have a plan).
-- A live plan that failed (no answer twice, or an error) is tried again every 10 min by
-- replay_live_queue, up to 3 times a night (sets.live_retries, cleared when the night is
-- done). A retry goes one step per request (solver-replay reads note 'retry').
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.replay_live_queue()'::regprocedure);
  o := $o$  if n > 0 and not exists (select 1 from cron.job where jobname = 'replay-fetch') then$o$;
  n := $n$  -- Failed live plans: again, step by step, up to 3 times a night.
  with f as (
    update replay_run_state s
       set status = 'idle', note = 'retry', updated_at = now(),
           sets = coalesce(s.sets, '{}'::jsonb) || jsonb_build_object('live_retries', coalesce((s.sets ->> 'live_retries')::int, 0) + 1)
      from replay_runs x
     where x.id = s.run_id and coalesce((x.config ->> 'live')::boolean, false) and x.status in ('running', 'error')
       and s.status = 'error' and coalesce((s.sets ->> 'live_retries')::int, 0) < 3
    returning s.run_id)
  update replay_runs set status = 'running', note = null, updated_at = now()
   where id in (select run_id from f) and status = 'error';
  if n > 0 and not exists (select 1 from cron.job where jobname = 'replay-fetch') then$n$;
  if position(o in d) = 0 then raise exception 'live queue pattern not found'; end if;
  execute replace(d, o, n);
end $$;
