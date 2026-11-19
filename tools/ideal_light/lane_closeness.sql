-- Ideal light test on the lane (18-19 Nov 2026): how close each setup's visits come to a target set of ideal sun
-- positions. Target 0 = Phil's saved ideals (scout_vantages), k > 0 = random test set k (ideal_test_sets).
-- :prefix = 'LN' (1-15 Nov) or 'LW' (winters). Only start dates every compared config finished are used.
with pairs(cfg, tgt) as (values
  (':prefix_off', 0), (':prefix_you_g', 0), (':prefix_you_s', 0),
  (':prefix_off', :s1), (':prefix_r1_g', :s1), (':prefix_r1_s', :s1),
  (':prefix_off', :s2), (':prefix_r2_g', :s2), (':prefix_r2_s', :s2),
  (':prefix_off', :s3), (':prefix_r3_g', :s3), (':prefix_r3_s', :s3)),
tg as (
  select 0 tgt, i.stop_id, v.lat, v.lng, v.ideal_sun_az az, v.ideal_sun_alt alt
    from solver_stop_inputs i join scout_vantages v on v.id = i.star_vantage_id
   where i.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and v.ideal_sun_az is not null
  union all
  select x.set_id, i.stop_id, v.lat, v.lng, x.az, x.alt
    from solver_stop_inputs i join scout_vantages v on v.id = i.star_vantage_id join ideal_test_sets x on x.vantage_id = v.id
   where i.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754'),
ok as (select start_date from replay_runs where config->>'name' like ':prefix\_%' and id > 9590 and status = 'done'
        group by start_date having count(*) = 9),
vis as (
  select p.cfg, p.tgt, r.id run_id, (x->>'start')::timestamptz + ((x->>'end')::timestamptz - (x->>'start')::timestamptz) / 2 mid, t.lat, t.lng, t.az, t.alt
    from pairs p join replay_runs r on r.config->>'name' = p.cfg and r.id > 9590 and r.start_date in (select start_date from ok)
    join replay_run_days d on d.run_id = r.id and d.kind = 'mrmc'
    cross join lateral jsonb_array_elements(d.visits) x
    join tg t on t.tgt = p.tgt and t.stop_id::text = x->>'stop_id'),
off as (
  select cfg, tgt, run_id, degrees(acos(least(1, greatest(-1, sin(radians(alt)) * sin(radians(sp.altitude)) +
         cos(radians(alt)) * cos(radians(sp.altitude)) * cos(radians(az - sp.azimuth)))))) d
    from vis cross join lateral sun_position(vis.mid, vis.lat, vis.lng) sp)
select case when tgt = 0 then 'yours' else 'random' end target,
       case when cfg like '%off' then 'off' when cfg like '%_g' then 'gentle' else 'strong' end mode,
       count(distinct tgt) draws, count(*) visits, round(percentile_cont(0.5) within group (order by d)::numeric, 1) median_off,
       round(100.0 * avg((d <= 10)::int), 0) pct_within10, round(100.0 * avg((d <= 20)::int), 0) pct_within20
  from off group by 1, 2, (case when cfg like '%off' then 0 when cfg like '%_g' then 1 else 2 end) order by 1 desc, (case when cfg like '%off' then 0 when cfg like '%_g' then 1 else 2 end);
