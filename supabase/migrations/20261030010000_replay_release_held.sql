-- Faroes bench runs that share one edge worker run out of CPU together (30 Oct:
-- 4 fo_T runs sent at once all died with "CPU Time exceeded"). Held runs
-- (replay_runs.status 'held') are let go one at a time: a new one only when no
-- other bench run of the same trip is running. Unschedules itself when none are held.
create or replace function public.replay_release_held()
returns int language plpgsql set search_path to 'public', 'extensions' as $$
declare v_id bigint;
begin
  if now() < timestamptz '2026-10-30 14:50:00+00' then return 0; end if;
  if not exists (select 1 from replay_runs where status = 'held') then
    perform cron.unschedule('replay-release-held');
    return 0;
  end if;
  select h.id into v_id from replay_runs h
   where h.status = 'held'
     and not exists (select 1 from replay_runs r where r.status = 'running' and r.trip_id = h.trip_id
                      and not coalesce((r.config->>'live')::boolean, false))
   order by h.id limit 1;
  if v_id is null then return 0; end if;
  update replay_runs set status = 'running', note = null, updated_at = now() where id = v_id;
  return 1;
end $$;
revoke all on function public.replay_release_held() from public, anon, authenticated;

select cron.schedule('replay-release-held', '* * * * *', $$select public.replay_release_held()$$);
