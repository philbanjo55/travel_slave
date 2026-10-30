-- Bench runs retry a failed night (30 Oct 2026, Phil: rerun the Faroes for L, N and T on
-- solver-replay v46). Heavy Faroes nights can run out of CPU when they share a worker; a failed
-- night of a run whose config name matches p_like is tried again step by step (note 'retry'),
-- up to 3 times a night (sets.live_retries, cleared when the night is done). Cron
-- replay-bench-retry every 10 min; it unschedules itself once no matching run is left.
create or replace function public.replay_bench_retry(p_like text default 'fo46_%')
returns int language plpgsql set search_path to 'public', 'extensions' as $$
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
  if not exists (select 1 from replay_runs where config ->> 'name' like p_like and status in ('queued', 'running')) then
    perform cron.unschedule('replay-bench-retry');
  end if;
  return n;
end $$;
revoke all on function public.replay_bench_retry(text) from public, anon, authenticated;

select cron.schedule('replay-bench-retry', '4-59/10 * * * *', $$select public.replay_bench_retry('fo46_%')$$);
