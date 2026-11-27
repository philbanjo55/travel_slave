-- Honest error bars for bench comparisons (Phil, 3 Nov 2026: "is this the proper testing?").
-- The 56 Teton test weeks start 2 days apart, so each real day is in ~3-4 of them and the
-- weekly differences are not independent: a plain standard error over 56 weeks is ~2x too
-- small. replay_paired(a, b) pairs two configs week by week (same start date, latest done
-- run each, realized summed per run day first) and reports the plain SE next to a
-- block SE: weeks grouped into calendar blocks of block_days (default 7, a week's length),
-- the block means treated as the independent units. Per season too.
create or replace function public.replay_paired(p_a text, p_b text, p_kind text default 'mrmc', p_block_days int default 7)
returns table(n_weeks int, n_blocks int, a_pts numeric, b_pts numeric, diff numeric, se_plain numeric, se_block numeric,
              better int, worse int, by_season jsonb)
language sql stable set search_path to 'public' as $$
  with runs as (
    select distinct on (config ->> 'name', start_date) id, config ->> 'name' cfg, start_date
      from replay_runs where config ->> 'name' in (p_a, p_b) and status = 'done'
     order by config ->> 'name', start_date, id desc),
  pts as (
    select r.cfg, r.start_date, sum(d.realized)::numeric pts
      from runs r join replay_run_days d on d.run_id = r.id and d.kind = p_kind group by 1, 2),
  x as (
    select a.start_date, a.pts av, b.pts bv, a.pts - b.pts d, replay_season(a.start_date) season,
           a.start_date - ((a.start_date - date '2000-01-01') % p_block_days) blk
      from pts a join pts b on b.cfg = p_b and b.start_date = a.start_date where a.cfg = p_a),
  blocks as (select blk, avg(d) d from x group by blk),
  seasons as (select season, count(*) n, avg(d) d, count(distinct blk) nb from x group by season)
  select count(*)::int, (select count(*) from blocks)::int, round(avg(av), 2), round(avg(bv), 2), round(avg(d), 2),
         round((stddev(d) / sqrt(count(*)))::numeric, 2),
         round((select stddev(d) / sqrt(count(*)) from blocks)::numeric, 2),
         (count(*) filter (where d > 0.05))::int, (count(*) filter (where d < -0.05))::int,
         (select jsonb_object_agg(season, jsonb_build_object('weeks', n, 'diff', round(d, 2), 'blocks', nb)) from seasons)
    from x
$$;
