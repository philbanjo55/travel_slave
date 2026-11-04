-- Nightly day check (Phil, 4 Nov 2026: "it's important we learn from the previous days to see what T
-- scored and what actually happened"). For a trip day that has passed: every stop on T's evening plan,
-- its morning re-plan and "your day", what T said (p_good = share of weather versions giving a good
-- shot, value) and what the truth said at that hour (replay_hidden_truth = airport OR the trip's truth
-- camera, as the bench scores it, plus how many nearby cameras showed the hills); the daylight hours
-- one by one; and the misses in plain words: T said <= 20% and the peaks were out ("too gloomy"), or
-- >= 60% and they were hidden ("too hopeful"). Stored in t_day_checks, one row per trip day, for the
-- daily review and a running tally of how honest T's odds are on real days.
create table if not exists public.t_day_checks (
  trip_id uuid not null,
  plan_date date not null,
  made_at timestamptz not null default now(),
  summary text,
  misses int,
  checked int,
  detail jsonb,
  primary key (trip_id, plan_date)
);

create or replace function public.t_day_check(p_trip uuid, p_date date)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare v_tz text; v_lat double precision; v_lng double precision; v_hours jsonb; v_visits jsonb; v_miss jsonb;
        v_sum text; v_clear int; v_day int; v_first text; v_last text; v_n int; v_m int;
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
           'cams_clear', c.clear, 'cams', c.n) order by h.hr)
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
    select r.note, v->>'name' name, (v->>'start')::timestamptz st, (v->>'p_good')::float8 pg, (v->>'value')::float8 val,
           coalesce((v->>'peak_at')::timestamptz, (v->>'start')::timestamptz) pk,
           coalesce((select i.fog_wanted from solver_stop_inputs i where i.stop_id = (v->>'stop_id')::uuid), false) fog
      from runs r cross join jsonb_array_elements(r.visits) v
     where v ? 'p_good' and (v->>'value') is not null
       -- only stops T expected in at least civil twilight (a 06:15 November visit is in the dark)
       and (select sp.altitude from sun_position(coalesce((v->>'peak_at')::timestamptz, (v->>'start')::timestamptz), v_lat, v_lng) sp) > -6
  ), j as (
    -- Judged at the time T expected the stop at its best (peak_at), on the nearest hourly report.
    -- Fog shots (fog_wanted) want the hills in cloud: their "hidden" is a good outcome (4 Nov 2026).
    select vis.*, date_trunc('hour', vis.pk + interval '30 minutes') hr,
           (select case when vis.fog then 1 - o.hidden else o.hidden end from replay_hidden_truth o
             where o.trip_id = p_trip and o.hr = date_trunc('hour', vis.pk + interval '30 minutes') limit 1) hidden
      from vis
  )
  select jsonb_agg(jsonb_build_object('plan', replace(note, 'T: ', ''), 'stop', name, 'at', to_char(st at time zone v_tz, 'HH24:MI'), 'fog_shot', fog,
                                      'said', round(pg::numeric, 2), 'value', round(val::numeric, 2), 'hidden', hidden,
                                      'miss', case when hidden = 0 and pg <= 0.2 then 'too gloomy' when hidden = 1 and pg >= 0.6 then 'too hopeful' end)
                   order by note, st),
         count(*) filter (where hidden is not null),
         count(*) filter (where (hidden = 0 and pg <= 0.2) or (hidden = 1 and pg >= 0.6))
    into v_visits, v_n, v_m
    from j;
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
                                               from jsonb_array_elements(v_miss) x), '') || '.' end;

  insert into t_day_checks (trip_id, plan_date, made_at, summary, misses, checked, detail)
  values (p_trip, p_date, now(), v_sum, coalesce(v_m, 0), coalesce(v_n, 0),
          jsonb_build_object('hours', v_hours, 'visits', v_visits))
  on conflict (trip_id, plan_date) do update set made_at = excluded.made_at, summary = excluded.summary,
         misses = excluded.misses, checked = excluded.checked, detail = excluded.detail;
  return jsonb_build_object('summary', v_sum, 'misses', v_miss);
end $function$;

-- Every trip with T plans for a day that has ended in its own time zone, checked once it has
-- truth (re-checked for 3 days as camera labels and airport reports come in).
create or replace function public.t_day_check_all()
returns int language plpgsql set search_path to 'public' as $function$
declare r record; n int := 0;
begin
  for r in
    select distinct x.trip_id, x.plan_date
      from solver_runs x join trips t on t.id = x.trip_id
     where coalesce(x.stats->>'planner', x.stats->>'variant') = 'T'
       and x.plan_date < (now() at time zone coalesce(t.timezone, 'UTC'))::date
       and x.plan_date >= (now() at time zone coalesce(t.timezone, 'UTC'))::date - 3
  loop
    begin
      perform t_day_check(r.trip_id, r.plan_date); n := n + 1;
    exception when others then
      insert into app_logs (level, message) values ('error', 't_day_check ' || r.trip_id || ' ' || r.plan_date || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  return n;
end $function$;

select cron.schedule('t-day-check', '20 8 * * *', 'select t_day_check_all()');
