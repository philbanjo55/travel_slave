-- C6 (9 Nov 2026, Phil: yes): bench weeks were lost to the 2 s edge CPU limit. About 1 request in 20
-- to solver-replay ends 546 "CPU Time exceeded" under load (8 Nov 19:30-22:00 UTC: 103 of 2,257 while
-- BAm56r and BCm56 ran together); a week died when the tick's own retries on one step all failed, and
-- the per-test retry cron (replay_bench_retry(pattern)) had to be armed by hand, so BAm56r kept 5
-- dead weeks and every BC-BF comparison ran on 51 weeks. Now every bench run (not live, not draft)
-- gets up to 3 retries of an errored step automatically, 2 min after the error.
create or replace function public.replay_bench_retry_all()
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare n int;
begin
  with f as (
    update replay_run_state s
       set status = 'idle', note = 'retry', updated_at = now(),
           sets = coalesce(s.sets, '{}'::jsonb) || jsonb_build_object('live_retries', coalesce((s.sets ->> 'live_retries')::int, 0) + 1)
      from replay_runs x
     where x.id = s.run_id and x.status in ('running', 'error')
       and coalesce((x.config ->> 'live')::boolean, false) = false
       and coalesce((x.config ->> 'draft')::boolean, false) = false
       and s.status = 'error' and s.updated_at < now() - interval '2 minutes'
       and coalesce((s.sets ->> 'live_retries')::int, 0) < 3
    returning s.run_id)
  update replay_runs set status = 'running', note = null, updated_at = now()
   where id in (select run_id from f) and status = 'error';
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.replay_bench_retry_all() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'replay-bench-retry') then perform cron.unschedule('replay-bench-retry'); end if;
  perform cron.schedule('replay-bench-retry-all', '*/3 * * * *', 'select public.replay_bench_retry_all()');
end $$;
