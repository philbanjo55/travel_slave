-- Planner test faults (27 Nov 2026). The emulator test asks for a fault (a server error, a timeout, no signal, a slow
-- answer) on calls whose address or action contains `match`; only the emulator's test build (e2e/fetchGuard.ts) reads
-- this table, every few seconds, so the real app never sees it. Faults expire by themselves.
create table if not exists public.e2e_faults (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('error', 'timeout', 'offline', 'slow')),
  match text not null,
  until timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.e2e_faults enable row level security;
create policy e2e_faults_read on public.e2e_faults for select using (true);

create or replace function public.e2e_fault(p_kind text, p_match text, p_secs int default 60)
returns bigint language sql security definer set search_path to 'public' as $f$
  insert into e2e_faults (kind, match, until) values (p_kind, p_match, now() + make_interval(secs => least(greatest(p_secs, 1), 600)))
  returning id;
$f$;
create or replace function public.e2e_fault_clear() returns int language sql security definer set search_path to 'public' as $f$
  with x as (update e2e_faults set until = now() where until > now() returning 1) select count(*)::int from x;
$f$;
grant execute on function public.e2e_fault(text, text, int), public.e2e_fault_clear() to anon, authenticated;

-- What the test reads back from the server about the robot trip (tables it can't read with the public key).
create or replace function public.e2e_state() returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select jsonb_build_object(
    'applies', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'applied_at', a.applied_at, 'undone_at', a.undone_at) order by a.id)
                           from solver_applies a where a.trip_id = '7e57bed0-0000-4000-8000-000000000004' and a.applied_at > now() - interval '1 day'), '[]'),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'name', r.config ->> 'name', 'night', r.night,
                                                          'started_at', r.started_at, 'updated_at', r.updated_at) order by r.id)
                        from replay_runs r where r.trip_id = '7e57bed0-0000-4000-8000-000000000004' and coalesce(r.started_at, r.updated_at) > now() - interval '1 day'), '[]'),
    'now', (select to_jsonb(n) - 'trip_id' from planner_t_now n where n.trip_id = '7e57bed0-0000-4000-8000-000000000004' order by n.requested_at desc limit 1),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'date', s.plan_date, 'note', s.stats ->> 'note') order by s.id)
                         from solver_runs s where s.trip_id = '7e57bed0-0000-4000-8000-000000000004' and s.created_at > now() - interval '1 day'), '[]'));
$f$;
grant execute on function public.e2e_state() to anon, authenticated;
