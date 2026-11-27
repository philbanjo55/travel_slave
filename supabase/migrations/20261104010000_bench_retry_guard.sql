-- replay_bench_retry: only unschedule the retry job when it exists (4 Nov 2026: a retry with
-- nothing else queued raised "could not find valid entry for job" and rolled the retry back).
create or replace function public.replay_bench_retry(p_like text default 'fo46_%')
returns integer language plpgsql set search_path to 'public' as $function$
declare n int;
begin
  with f as (
    update replay_run_state s
       set status = 'idle', note = 'retry', updated_at = now(),
           sets = coalesce(s.sets, '{}'::jsonb) || jsonb_build_object('live_retries', coalesce((s.sets ->> 'live_retries')::int, 0) + 1)
      from replay_runs x
     where x.id = s.run_id and x.config ->> 'name' like p_like and x.status in ('running', 'error')
       and s.status = 'error' and coalesce((s.sets ->> 'live_retries')::int, 0) < 3
    returning s.run_id)
  update replay_runs set status = 'running', note = null, updated_at = now()
   where id in (select run_id from f) and status = 'error';
  get diagnostics n = row_count;
  if not exists (select 1 from replay_runs where config ->> 'name' like p_like and status in ('queued', 'running'))
     and exists (select 1 from cron.job where jobname = 'replay-bench-retry') then
    perform cron.unschedule('replay-bench-retry');
  end if;
  return n;
end $function$;
