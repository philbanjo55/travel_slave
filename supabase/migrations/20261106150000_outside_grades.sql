drop function if exists replay_paired_visible(text, text, text);
drop function if exists replay_paired_by_sky(text, text, text);
-- Worksheet D1 (Phil, 6 Nov 2026): an outside grade that ignores T's own light model: the distinct places a
-- run visited while the peaks were visible (camera vote, else the old truth), all rated places and the
-- S / GOD ones, per test week, paired between two configs like replay_paired.
create or replace function replay_paired_visible(p_a text, p_b text, p_kind text default 'mrmc', p_kind_b text default null)
returns table (n_weeks int, a_places numeric, b_places numeric, diff numeric, se numeric, a_top numeric, b_top numeric, diff_top numeric, se_top numeric)
language sql stable set search_path = public as $$
  with runs as (
    select distinct on (config ->> 'name', start_date) id, config ->> 'name' cfg, start_date, trip_id
      from replay_runs where config ->> 'name' in (p_a, p_b) and status = 'done'
     order by config ->> 'name', start_date, id desc),
  v as materialized (
    select r.cfg, r.start_date, r.trip_id, x ->> 'name' place, (x ->> 'stop_id')::uuid stop_id,
           date_trunc('hour', (x ->> 'start')::timestamptz) hr
      from runs r join replay_run_days d on d.run_id = r.id and d.kind = case when r.cfg = p_a then p_kind else coalesce(p_kind_b, p_kind) end
      cross join jsonb_array_elements(d.visits) x
     where (x ->> 'truth') is not null),
  hrs as materialized (select distinct trip_id, hr from v),
  vote as materialized (
    select h.trip_id, h.hr, coalesce(o.hidden, t.hidden, 0) hidden
      from hrs h
      left join replay_hidden_vote o on o.trip_id = h.trip_id and o.hr = h.hr
      left join replay_hidden_truth t on t.trip_id = h.trip_id and t.hr = h.hr),
  w as (
    select v.cfg, v.start_date,
           count(distinct v.place) filter (where vo.hidden = 0)::numeric places,
           count(distinct v.place) filter (where vo.hidden = 0 and ss.tier in ('S', 'GOD'))::numeric top
      from v join vote vo using (trip_id, hr) left join solver_stop_settings ss on ss.stop_id = v.stop_id
     group by 1, 2),
  x as (select a.places ap, b.places bp, a.top at, b.top bt from w a join w b on b.cfg = p_b and b.start_date = a.start_date where a.cfg = p_a)
  select count(*)::int, round(avg(ap), 2), round(avg(bp), 2), round(avg(ap - bp), 2), round((stddev(ap - bp) / sqrt(count(*)))::numeric, 2),
         round(avg(at), 2), round(avg(bt), 2), round(avg(at - bt), 2), round((stddev(at - bt) / sqrt(count(*)))::numeric, 2)
    from x $$;

-- p_kind_b (worksheet D4): the second config's plan kind when it differs (e.g. 'my' = Phil's schedule).
-- Worksheet D2: the same paired points split by the day's sky (share of daylight hours with the peaks
-- hidden by the camera vote, else the old truth: clear < 25%, cloudy > 75%, mixed between). Forecast skill
-- matters most on mixed days.
create or replace function replay_paired_by_sky(p_a text, p_b text, p_kind text default 'mrmc', p_kind_b text default null)
returns table (sky text, n_days int, a_pts numeric, b_pts numeric, diff numeric, se numeric, better int, worse int)
language sql stable set search_path = public as $$
  with runs as (
    select distinct on (config ->> 'name', start_date) id, config ->> 'name' cfg, start_date, trip_id
      from replay_runs where config ->> 'name' in (p_a, p_b) and status = 'done'
     order by config ->> 'name', start_date, id desc),
  dd as materialized (
    select r.cfg, r.start_date, r.trip_id, d.replay_date, d.realized
      from runs r join replay_run_days d on d.run_id = r.id and d.kind = case when r.cfg = p_a then p_kind else coalesce(p_kind_b, p_kind) end),
  days as materialized (select distinct trip_id, replay_date from dd),
  sky as materialized (
    select ds.trip_id, ds.replay_date,
           avg(coalesce(o.hidden, t.hidden)::numeric) hid
      from days ds
      join replay_places p on p.trip_id = ds.trip_id
      join metar_stations s on s.icao = p.station
      cross join lateral generate_series(ds.replay_date::timestamptz, ds.replay_date::timestamptz + interval '23 hours', interval '1 hour') g(hr)
      left join replay_hidden_vote o on o.trip_id = ds.trip_id and o.hr = g.hr
      left join replay_hidden_truth t on t.trip_id = ds.trip_id and t.hr = g.hr
     where (select sp.altitude from sun_position(g.hr, s.lat, s.lng) sp) > 0
       and coalesce(o.hidden, t.hidden) is not null
     group by 1, 2),
  x as (
    select case when k.hid < 0.25 then 'clear' when k.hid > 0.75 then 'cloudy' else 'mixed' end sky,
           a.realized - b.realized d, a.realized ar, b.realized br
      from dd a join dd b on b.cfg = p_b and b.start_date = a.start_date and b.replay_date = a.replay_date
      join sky k on k.trip_id = a.trip_id and k.replay_date = a.replay_date
     where a.cfg = p_a)
  select sky, count(*)::int, round(avg(ar)::numeric, 2), round(avg(br)::numeric, 2), round(avg(d)::numeric, 2),
         round((stddev(d) / sqrt(count(*)))::numeric, 2), (count(*) filter (where d > 0.05))::int, (count(*) filter (where d < -0.05))::int
    from x group by sky order by sky $$;
