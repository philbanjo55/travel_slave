-- Keep the newest three score builds per trip; their solver_scores rows go
-- with them (on delete cascade). Solver tables only, approved by Phil
-- 20 Oct 2026. Any past night can be rebuilt from weather_ensemble.
create or replace function public.solver_prune_builds(p_trip_id uuid, p_keep integer default 3)
returns integer language plpgsql set search_path to 'public' as $$
declare n integer;
begin
  delete from solver_score_builds b
   where b.trip_id = p_trip_id
     and b.id not in (select id from solver_score_builds where trip_id = p_trip_id
                       order by built_at desc limit greatest(p_keep, 1));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.solver_prune_builds(uuid, integer) from public, anon, authenticated;

create or replace function public.solver_nightly(p_trip_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $$
declare r jsonb;
begin
  r := solver_build_scores(p_trip_id);
  return r || jsonb_build_object('pruned', solver_prune_builds(p_trip_id));
end $$;
revoke execute on function public.solver_nightly(uuid) from public, anon, authenticated;

select cron.schedule('solver-build-scores', '41 22 * * *', $cron$
  select public.solver_nightly(t.id)
    from public.trips t
   where t.archived is not true
     and exists (select 1 from public.solver_stop_settings ss join public.stops s on s.id = ss.stop_id
                  where s.trip_id = t.id and ss.tier is not null);
$cron$);
