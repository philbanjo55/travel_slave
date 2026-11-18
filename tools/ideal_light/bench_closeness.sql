-- Ideal light bench test (18 Nov 2026): for each config, the visits to shots with a saved ideal light (the shot T plans)
-- and how far the sun was from the ideal at the middle of each visit (degrees), plus how many came within 10 / 20 deg.
with ideal as (
  select i.stop_id, v.lat, v.lng, v.ideal_sun_az az, v.ideal_sun_alt alt
    from solver_stop_inputs i join scout_vantages v on v.id = i.star_vantage_id
   where i.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and v.ideal_sun_az is not null),
vis as (
  select r.config->>'name' cfg, r.id run_id, (x->>'start')::timestamptz + ((x->>'end')::timestamptz - (x->>'start')::timestamptz) / 2 mid, i.*
    from replay_runs r join replay_run_days d on d.run_id = r.id and d.kind = 'mrmc'
    cross join lateral jsonb_array_elements(d.visits) x
    join ideal i on i.stop_id::text = x->>'stop_id'
   where r.config->>'name' in ('IdA', 'IdB', 'IdC') and r.status = 'done'
     and r.start_date in (select start_date from replay_runs where config->>'name' in ('IdA','IdB','IdC') and status = 'done'
                          group by start_date having count(*) = 3)),
off as (
  select cfg, run_id, degrees(acos(least(1, greatest(-1, sin(radians(alt)) * sin(radians(sp.altitude)) +
         cos(radians(alt)) * cos(radians(sp.altitude)) * cos(radians(az - sp.azimuth)))))) d
    from vis cross join lateral sun_position(vis.mid, vis.lat, vis.lng) sp)
select cfg, count(distinct run_id) weeks, count(*) visits, round(percentile_cont(0.5) within group (order by d)::numeric, 1) median_off,
       round(100.0 * avg((d <= 10)::int), 0) pct_within10, round(100.0 * avg((d <= 20)::int), 0) pct_within20
  from off group by cfg order by cfg;
