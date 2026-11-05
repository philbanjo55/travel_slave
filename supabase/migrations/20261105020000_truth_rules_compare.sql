-- Four ways to say whether the peaks / hills were hidden in an hour (Phil, 5 Nov 2026: "do all three and
-- let's compare"). Grading only: T's plans and its dawn look are unchanged.
--   old: replay_hidden_truth (the airport's ceiling OR the place's truth camera: KJAC + TetonCam, EKVG alone)
--   a:   majority of the airport and every labelled camera within 80 km of the airport (a tie = hidden)
--   b:   the camera nearest the stop (the hour check uses the middle of the trip's stops)
--   c:   visible if any camera saw the peaks (hidden only when every camera did not)
-- Since 24 Oct, Teton Live: old said hidden 81 of 109 daylight hours, the majority 55.
create or replace function public.t_truth(p_trip uuid, p_hr timestamptz, p_lat double precision, p_lng double precision)
returns jsonb language sql stable set search_path to 'public' as $$
  with pl as (
    select s.lat slat, s.lng slng from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = p_trip
  ), apt as (
    select o.hidden from replay_hidden_obs o where o.trip_id = p_trip and o.hr = p_hr limit 1
  ), cams as (
    select c.code, (not f.hills_visible)::int hidden,
           sqrt(power((c.lat - p_lat) * 111, 2) + power((c.lng - p_lng) * 111 * cos(radians(p_lat)), 2)) km
      from webcam_frames f join webcam_cameras c on c.code = f.camera_code cross join pl
     where f.captured_at = p_hr and f.hills_visible is not null and not coalesce(f.stale, false)
       and coalesce(f.label, '') not in ('dark', 'camera_problem')
       and sqrt(power((c.lat - pl.slat) * 111, 2) + power((c.lng - pl.slng) * 111 * cos(radians(pl.slat)), 2)) < 80
  ), n as (select count(*) n, coalesce(sum(hidden), 0) h, min(hidden) mn from cams)
  select jsonb_build_object(
    'old', (select o.hidden from replay_hidden_truth o where o.trip_id = p_trip and o.hr = p_hr limit 1),
    'a', case when n.n >= 2 then ((n.h + coalesce((select hidden from apt), 0)) * 2 >= n.n + (select count(*) from apt))::int end,
    'b', (select hidden from cams order by km limit 1),
    'b_cam', (select code from cams order by km limit 1),
    'c', case when n.n >= 1 then n.mn end,
    'cams', n.n, 'cams_hidden', n.h, 'airport', (select hidden from apt))
  from n
$$;

-- The day check judges every stop under all four rules (detail.visits[].rules, detail.rules, summary line).
create or replace function public.t_day_check(p_trip uuid, p_date date)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare v_tz text; v_lat double precision; v_lng double precision; v_hours jsonb; v_visits jsonb; v_miss jsonb;
        v_sum text; v_rules jsonb; v_clear int; v_day int; v_first text; v_last text; v_n int; v_m int;
begin
  select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = p_trip;
  select avg(s.lat), avg(s.lng) into v_lat, v_lng from stops s where s.trip_id = p_trip and s.lat is not null;
  if v_tz is null or v_lat is null then return null; end if;

  -- Daylight hours: what the truth said, and the nearby cameras.
  with hrs as (
    select g.hr from generate_series(((p_date + time '05:00') at time zone v_tz), ((p_date + time '19:00') at time zone v_tz), interval '1 hour') g(hr)
     where (select sp.altitude from sun_position(g.hr, v_lat, v_lng) sp) > 0
  ), cams as (
    select f.captured_at hr, count(*) filter (where f.hills_visible) clear, count(*) n
      from webcam_frames f join webcam_cameras c on c.code = f.camera_code
     where c.active and abs(c.lat - v_lat) < 0.45 and abs(c.lng - v_lng) < 0.65
       and f.captured_at >= (p_date::timestamp at time zone v_tz) - interval '1 hour'
       and f.captured_at < ((p_date + 1)::timestamp at time zone v_tz)
       and f.hills_visible is not null and not coalesce(f.stale, false)
       and coalesce(f.label, '') not in ('dark', 'camera_problem')
     group by 1
  )
  select jsonb_agg(jsonb_build_object('at', to_char(h.hr at time zone v_tz, 'HH24:MI'),
           'hidden', (select o.hidden from replay_hidden_truth o where o.trip_id = p_trip and o.hr = h.hr limit 1),
           'cams_clear', c.clear, 'cams', c.n, 'rules', t_truth(p_trip, h.hr, v_lat, v_lng)) order by h.hr)
    into v_hours
    from hrs h left join cams c on c.hr = h.hr;
  select count(*) filter (where (x->>'hidden')::int = 0), count(*) filter (where x->>'hidden' is not null),
         min(x->>'at') filter (where (x->>'hidden')::int = 0), max(x->>'at') filter (where (x->>'hidden')::int = 0)
    into v_clear, v_day, v_first, v_last
    from jsonb_array_elements(coalesce(v_hours, '[]')) x;

  -- T's plans for the day: the newest evening plan, morning re-plan, and its "your day".
  with runs as (
    select distinct on (p.note) r.id, p.rank, p.note, p.visits
      from solver_runs r join solver_plans p on p.run_id = r.id
     where r.trip_id = p_trip and r.plan_date = p_date
       and coalesce(r.stats->>'planner', r.stats->>'variant') = 'T'
       and p.note in ('T: evening plan', 'T: morning re-plan', 'T: your day')
     order by p.note, r.created_at desc
  ), vis as (
    select r.note, v->>'name' name, (v->>'stop_id')::uuid sid, (v->>'start')::timestamptz st, coalesce((v->>'chance')::float8, (v->>'p_good')::float8) pg, (v->>'value')::float8 val,
           coalesce((v->>'peak_at')::timestamptz, (v->>'start')::timestamptz) pk,
           coalesce((select i.fog_wanted from solver_stop_inputs i where i.stop_id = (v->>'stop_id')::uuid), false) fog
      from runs r cross join jsonb_array_elements(r.visits) v
     where (v ? 'p_good' or v ? 'chance') and (v->>'value') is not null
       -- only stops T expected in daylight (visible = good shot applies there; blue hour depends on light too)
       and (select sp.altitude from sun_position(coalesce((v->>'peak_at')::timestamptz, (v->>'start')::timestamptz), v_lat, v_lng) sp) > 0
  ), j as (
    -- Judged at the time T expected the stop at its best (peak_at), on the nearest hourly report.
    -- Fog shots (fog_wanted) want the hills in cloud: their "hidden" is a good outcome (4 Nov 2026).
    select vis.*, date_trunc('hour', vis.pk + interval '30 minutes') hr,
           (select case when vis.fog then 1 - o.hidden else o.hidden end from replay_hidden_truth o
             where o.trip_id = p_trip and o.hr = date_trunc('hour', vis.pk + interval '30 minutes') limit 1) hidden
      from vis
  ), k as (
    -- The same stop under the four rules of t_truth (5 Nov 2026), fog shots reversed the same way.
    select j.*, (select jsonb_build_object(
                   'old', case when j.fog then 1 - (t->>'old')::int else (t->>'old')::int end,
                   'a', case when j.fog then 1 - (t->>'a')::int else (t->>'a')::int end,
                   'b', case when j.fog then 1 - (t->>'b')::int else (t->>'b')::int end,
                   'c', case when j.fog then 1 - (t->>'c')::int else (t->>'c')::int end,
                   'b_cam', t->>'b_cam')
                  from (select t_truth(p_trip, j.hr, coalesce(s.lat, v_lat), coalesce(s.lng, v_lng)) t from stops s where s.id = j.sid
                        union all select t_truth(p_trip, j.hr, v_lat, v_lng) where j.sid is null) x) tr
      from j
  )
  select jsonb_agg(jsonb_build_object('plan', replace(note, 'T: ', ''), 'stop', name, 'at', to_char(st at time zone v_tz, 'HH24:MI'), 'fog_shot', fog,
                                      'said', round(pg::numeric, 2), 'value', round(val::numeric, 2), 'hidden', hidden,
                                      'miss', case when hidden = 0 and pg <= 0.2 then 'too gloomy' when hidden = 1 and pg >= 0.6 then 'too hopeful' end,
                                      'rules', tr)
                   order by note, st),
         count(*) filter (where hidden is not null),
         count(*) filter (where (hidden = 0 and pg <= 0.2) or (hidden = 1 and pg >= 0.6))
    into v_visits, v_n, v_m
    from k;
  -- Misses per truth rule over the stops each rule could judge.
  select jsonb_object_agg(r, jsonb_build_object('checked', n, 'misses', m, 'too_gloomy', g, 'too_hopeful', hh)) into v_rules
    from (select r, count(*) filter (where (x->'rules'->>r) is not null) n,
                 count(*) filter (where ((x->'rules'->>r)::int = 0 and (x->>'said')::float8 <= 0.2) or ((x->'rules'->>r)::int = 1 and (x->>'said')::float8 >= 0.6)) m,
                 count(*) filter (where (x->'rules'->>r)::int = 0 and (x->>'said')::float8 <= 0.2) g,
                 count(*) filter (where (x->'rules'->>r)::int = 1 and (x->>'said')::float8 >= 0.6) hh
            from jsonb_array_elements(coalesce(v_visits, '[]')) x cross join unnest(array['old', 'a', 'b', 'c']) r group by r) z;
  select jsonb_agg(x) into v_miss from jsonb_array_elements(coalesce(v_visits, '[]')) x where x->>'miss' is not null;

  v_sum := case when coalesce(v_day, 0) = 0 then 'No truth for this day yet.'
                when v_clear = 0 then format('Peaks hidden all %s daylight hours.', v_day)
                when v_clear = v_day then format('Peaks visible all %s daylight hours.', v_day)
                else format('Peaks visible %s of %s daylight hours (%s-%s).', v_clear, v_day, v_first, v_last) end
           || case when coalesce(v_n, 0) = 0 then ' No T plan to check.'
                   else format(' T: %s of %s planned stops misjudged', v_m, v_n)
                        || coalesce(': ' || (select string_agg(format('%s %s %s said %s%%', x->>'plan', x->>'stop', x->>'at', round(100 * (x->>'said')::numeric))
                                                                 || case when (x->>'fog_shot')::boolean then case x->>'miss' when 'too gloomy' then ', fog came (fog shot)' else ', no fog (fog shot)' end
                                                                         when x->>'miss' = 'too gloomy' then ', peaks out' else ', peaks hidden' end, '; ')
                                               from jsonb_array_elements(v_miss) x), '') || '.' end
           || coalesce(format(' Misses by rule: now %s, majority %s, nearest camera %s, any camera %s.',
                              v_rules->'old'->>'misses', v_rules->'a'->>'misses', v_rules->'b'->>'misses', v_rules->'c'->>'misses'), '');

  insert into t_day_checks (trip_id, plan_date, made_at, summary, misses, checked, detail)
  values (p_trip, p_date, now(), v_sum, coalesce(v_m, 0), coalesce(v_n, 0),
          jsonb_build_object('hours', v_hours, 'visits', v_visits, 'rules', v_rules))
  on conflict (trip_id, plan_date) do update set made_at = excluded.made_at, summary = excluded.summary,
         misses = excluded.misses, checked = excluded.checked, detail = excluded.detail;
  return jsonb_build_object('summary', v_sum, 'misses', v_miss, 'rules', v_rules);
end $function$;

