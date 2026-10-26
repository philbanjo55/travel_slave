-- The four-way test's scoreboard (Phil, 26 Oct 2026). Per plan, over the
-- finished runs of one config:
--   per_week      tier points against what happened, a whole 7-day week
--   places        rated places visited at least once (by name: Snake River
--                 Overlook on three days is one place), of `places_total`
--   top_visited   S/GOD places visited at least once, of `top_total`
--   top_good      S/GOD places with at least one good shot (truth >= 0.6)
-- Tiers are the trip's current settings, read by stop id.
create or replace function public.replay_week_summary(p_config text)
returns table (kind text, weeks bigint, per_week numeric, per_day numeric, places numeric, places_total bigint,
               top_visited numeric, top_good numeric, top_total bigint)
language sql stable set search_path = public as $$
  with runs as (
    select id, trip_id from replay_runs where config ->> 'name' = p_config and status = 'done'),
  rated as (
    select i.stop_id, s.name, i.tier from solver_stop_inputs i join stops s on s.id = i.stop_id
     where i.trip_id in (select trip_id from runs) and i.tier is not null and s.day_id is not null),
  v as (
    select d.run_id, d.kind, r.name, r.tier in ('S', 'GOD') top, coalesce((x ->> 'truth')::numeric, 0) truth
      from replay_run_days d cross join jsonb_array_elements(coalesce(d.visits, '[]')) x
      join rated r on r.stop_id = (x ->> 'stop_id')::uuid
     where d.run_id in (select id from runs)),
  per_run as (
    select run_id, kind, count(distinct name) places, count(distinct name) filter (where top) top_visited,
           count(distinct name) filter (where top and truth >= 0.6) top_good
      from v group by 1, 2),
  pts as (
    select run_id, kind, sum(realized) pts, avg(realized) per_day from replay_run_days
     where run_id in (select id from runs) group by 1, 2)
  select p.kind, count(*), round(avg(p.pts)::numeric, 1), round(avg(p.per_day)::numeric, 2),
         round(avg(coalesce(r.places, 0)), 1), (select count(distinct name) from rated),
         round(avg(coalesce(r.top_visited, 0)), 1), round(avg(coalesce(r.top_good, 0)), 1),
         (select count(distinct name) filter (where tier in ('S', 'GOD')) from rated)
    from pts p left join per_run r on r.run_id = p.run_id and r.kind = p.kind
   group by p.kind order by 3 desc
$$;
revoke execute on function public.replay_week_summary(text) from public, anon, authenticated;
