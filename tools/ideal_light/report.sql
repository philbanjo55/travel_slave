-- Ideal light, step 1 report (18 Nov 2026): for every shot with a saved ideal light that is the STARRED shot of a
-- stop, T's newest rank-1 plan per day vs that ideal: planned middle of the visit (local), the ideal clock time, and
-- how far the sun is from the ideal spot in the sky at the planned middle (degrees). Read only.
with ideal as (
  select v.id vid, coalesce(v.shot_name, v.code) shot, v.lat, v.lng, v.ideal_sun_az az, v.ideal_sun_alt alt, v.ideal_at
    from scout_vantages v where v.ideal_sun_az is not null),
starred as (
  select s.id stop_id, s.trip_id, s.name, i.* from stops s
    join solver_stop_settings ss on ss.stop_id = s.id
    join ideal i on i.vid = ss.star_vantage_id
   where s.day_id is not null),
runs as (
  select distinct on (r.trip_id, r.plan_date) r.id, r.trip_id, r.plan_date
    from solver_runs r
   where r.trip_id in (select distinct trip_id from starred) and r.stats->>'planner' = 'T'
     and r.plan_date >= current_date - 1
   order by r.trip_id, r.plan_date, r.created_at desc),
visits as (
  select ru.trip_id, ru.plan_date, x->>'stop_id' stop_id,
         (x->>'start')::timestamptz + ((x->>'end')::timestamptz - (x->>'start')::timestamptz) / 2 mid
    from runs ru join solver_plans p on p.run_id = ru.id and p.rank = 1, jsonb_array_elements(p.visits) x)
select t.title trip, st.name stop, st.shot, vi.plan_date,
       to_char(vi.mid at time zone solver_trip_tz(st.trip_id), 'HH24:MI') planned_mid,
       to_char(st.ideal_at at time zone solver_trip_tz(st.trip_id), 'HH24:MI') ideal_time,
       round(degrees(acos(least(1, greatest(-1,
         sin(radians(st.alt)) * sin(radians(sp.altitude)) +
         cos(radians(st.alt)) * cos(radians(sp.altitude)) * cos(radians(st.az - sp.azimuth))))))::numeric, 1) sun_off_deg
  from visits vi join starred st on st.stop_id::text = vi.stop_id
  join trips t on t.id = st.trip_id
  cross join lateral sun_position(vi.mid, st.lat, st.lng) sp
 order by 1, 4, 5;
