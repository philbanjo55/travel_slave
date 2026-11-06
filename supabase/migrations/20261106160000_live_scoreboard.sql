-- Worksheet H2 (Phil, 6 Nov 2026): practice-trip scoreboard, the planners run side by side on real days
-- (configs live_old / live_L / live_T on the real Teton trip's places, app_T on the practice trips), scored
-- once satellite truth covers the day. Per config: days scored, points, points a day, and paired vs live_T.
create or replace function replay_live_scoreboard()
returns table (planner text, trip text, days int, points numeric, per_day numeric, vs_t_days int, vs_t numeric, vs_t_se numeric)
language sql stable set search_path = public as $$
  with d as (
    select r.config ->> 'name' cfg, r.trip_id, t.title, dd.replay_date, sum(dd.realized) pts
      from replay_runs r join trips t on t.id = r.trip_id join replay_run_days dd on dd.run_id = r.id
     where coalesce((r.config ->> 'live')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false)
       and dd.realized is not null
     group by 1, 2, 3, 4),
  p as (
    select a.cfg, a.trip_id, a.pts - b.pts df from d a join d b on b.cfg = 'live_T' and b.trip_id = a.trip_id and b.replay_date = a.replay_date
     where a.cfg <> 'live_T')
  select d.cfg, d.title, count(*)::int, round(sum(d.pts)::numeric, 1), round(avg(d.pts)::numeric, 2),
         (select count(*) from p where p.cfg = d.cfg and p.trip_id = d.trip_id)::int,
         (select round(avg(df)::numeric, 2) from p where p.cfg = d.cfg and p.trip_id = d.trip_id),
         (select round((stddev(df) / sqrt(count(*)))::numeric, 2) from p where p.cfg = d.cfg and p.trip_id = d.trip_id)
    from d group by d.cfg, d.title, d.trip_id order by 2, 1 $$;
