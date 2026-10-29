-- Live runs (Phil, 29 Oct 2026: move the winner into the live planner). The tested bench
-- engine runs live, unchanged: a replay_runs row with run config live = true plans real
-- upcoming dates as the trip's days, on tonight's forecasts from the same models, stored
-- the way the bench reads them (replay_wx_day: 'x' = lead 1, 'x@2', 'x@3').
--  * replay_fetch kind 'live' (one row per forecast cell per date D, models as the bench):
--    the newest run for UTC D .. D+3. Lead 1 covers D and D+1 (a local day spans two UTC
--    days), lead 2 D+1 and D+2, lead 3 D+2 and D+3. Upserted (the newest wins).
--  * replay_live_queue() (cron every 10 min): the evening's forecasts from 19:30 local the
--    day before, ECMWF's overnight run for the morning (morning_fresh) from 07:00 UTC, and
--    satellite truth once both UTC days are complete.
--  * replay_run_tick for live runs: night plan from plan_local (default 20:30) the evening
--    before once the forecasts are in; no truth build at night; the morning step and its
--    build from 75 min after the look; nights scored later by a rescore request once the
--    day's satellite truth is in (throttled to one try per 15 min per night and plan).
--  * Live downloads never trigger the refit: only fetches of training data (before
--    30 Jun 2026, what the fits learn from) do.
--  * replay_live_roll() (daily): when a live run has planned its last night, the same
--    config starts again on the next dates (until the trip starts).

do $$
declare d text;
  pairs text[][];
  k int;
begin
  execute 'alter table replay_fetch dr' || 'op constraint replay_fetch_kind_check';
  alter table replay_fetch add constraint replay_fetch_kind_check check (kind = any (array['fc', 'sat', 'run', 'live']));

  -- Downloader: parse and send 'live' rows.
  d := pg_get_functiondef('replay_fetch_tick()'::regprocedure);
  pairs := array[
    array['      elsif r.kind = ''run'' then',
          '      elsif r.kind = ''live'' then
        -- The newest run: lead 1 for UTC D and D+1, lead 2 for D+1 and D+2, lead 3 for D+2 and D+3.
        insert into replay_wx_day (point_key, model, day, dr, cloud)
        select r.point_key, r.model || case l.lead when 1 then '''' else ''@'' || l.lead end, x.day, x.dr, x.cloud
          from (select (t.v #>> ''{}'')::timestamp::date as day, array_agg((a.v #>> ''{}'')::real order by t.i) dr, array_agg((b.v #>> ''{}'')::real order by t.i) cloud
                  from jsonb_array_elements(c->''hourly''->''time'') with ordinality t(v, i)
                  join jsonb_array_elements(c->''hourly''->''direct_radiation'') with ordinality a(v, j) on a.j = t.i
                  join jsonb_array_elements(c->''hourly''->''cloud_cover'') with ordinality b(v, k) on b.k = t.i
                 group by 1 having count(*) = 24 and (count(a.v #>> ''{}'') > 0 or count(b.v #>> ''{}'') > 0)) x
          join (values (1, 0), (1, 1), (2, 1), (2, 2), (3, 2), (3, 3)) l(lead, off) on x.day = r.start_date + l.off
        on conflict (point_key, model, day) do update set dr = excluded.dr, cloud = excluded.cloud;
      elsif r.kind = ''run'' then'],
    array['    v_url := case when r.kind = ''run''',
          '    v_url := case when r.kind = ''live''
      then ''https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&models='' || r.model
      when r.kind = ''run''']];
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_fetch_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;

  -- Runner.
  d := pg_get_functiondef('replay_run_tick()'::regprocedure);
  pairs := array[
    array['v_t0 timestamptz := clock_timestamp();',
          'v_t0 timestamptz := clock_timestamp();
  v_live boolean; v_tz text; v_d date;'],
    -- refit only on training downloads
    array['where f.status = ''done'' and (p.lat > 55)',
          'where f.status = ''done'' and f.kind <> ''live'' and f.start_date < date ''2026-06-30'' and (p.lat > 55)'],
    -- live timing
    array['and exists (select 1 from replay_fit_queue fq where fq.trip_id = r.trip_id and fq.status = ''queued'');',
          'and exists (select 1 from replay_fit_queue fq where fq.trip_id = r.trip_id and fq.status = ''queued'');
    v_live := coalesce((r.config ->> ''live'')::boolean, false);
    if v_live then
      select coalesce(t.timezone, ''UTC'') into v_tz from trips t where t.id = r.trip_id;
      v_d := r.start_date + r.night;
      continue when now() < ((v_d - 1) + coalesce((r.config ->> ''plan_local'')::time, time ''20:30'')) at time zone v_tz;
      continue when not exists (select 1 from replay_fetch f where f.kind = ''live'' and f.start_date = v_d and f.status = ''done''
                                   and (select p.lat > 55 from replay_points p where p.point_key = f.point_key) = (r.trip_id = ''e04fbc9d-86b1-42b2-bf08-fc65a18e665d''));
      if exists (select 1 from replay_run_state s where s.run_id = r.id and s.night = r.night
                  and (s.sets -> ''pending'' ->> ''night'')::int = r.night and s.sets -> ''pending'' ->> ''stage'' = ''night'') then
        continue when now() < replay_look_at(r.trip_id, v_d) + interval ''75 minutes'';
        continue when coalesce((r.config ->> ''morning_fresh'')::boolean, false)
          and not exists (select 1 from replay_wx_day w where w.model = ''ecmwf_ifs@f'' and w.day = v_d
                            and (select p.lat > 55 from replay_points p where p.point_key = w.point_key) = (r.trip_id = ''e04fbc9d-86b1-42b2-bf08-fc65a18e665d''));
      end if;
    end if;'],
    -- no truth build at night for live runs
    array['        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''truth'') then',
          '        if not v_live and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''truth'') then'],
    -- morning builds only after the look
    array['if i = r.night and v_kinds && array[''mr1'', ''mrmc''] and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''morning'') then',
          'if i = r.night and v_kinds && array[''mr1'', ''mrmc''] and (not v_live or now() >= replay_look_at(r.trip_id, r.start_date + i) + interval ''75 minutes'')
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''morning'') then'],
    array['        if i = r.night and v_kinds && array[''mr1'', ''mrmc''] and coalesce((r.config ->> ''morning_fresh'')::boolean, false)',
          '        if i = r.night and v_kinds && array[''mr1'', ''mrmc''] and coalesce((r.config ->> ''morning_fresh'')::boolean, false)
           and (not v_live or now() >= replay_look_at(r.trip_id, r.start_date + i) + interval ''75 minutes'')'],
    -- rescore live nights once their truth is in
    array['  return jsonb_build_object(''started'', v_started, ''built'', v_built, ''cleared'', v_cleared);',
          '  -- Live runs: score each planned night once its day''s satellite truth is in.
  for r in select x.id, x.trip_id, x.state, d.night dn, d.kind dk, d.replay_date dd
             from replay_runs x join replay_run_days d on d.run_id = x.id
            where coalesce((x.config ->> ''live'')::boolean, false) and d.realized is null and d.replay_date < current_date
              and coalesce((x.state ->> (''rs'' || d.night || d.kind))::timestamptz, ''-infinity'') < now() - interval ''15 minutes''
              and not exists (select 1 from replay_live_points(x.trip_id, ''sat'') sp
                               where (select count(*) from replay_sat_day sd where sd.point_key = sp.point_key and sd.day in (d.replay_date, d.replay_date + 1)) < 2) loop
    exit when clock_timestamp() - v_t0 > interval ''90 seconds'';
    select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.dd;
    begin
      if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''truth'') then
        perform replay_build(v_day, ''truth''); v_built := v_built + 1;
      end if;
    exception when others then
      continue;
    end;
    update replay_runs set state = state || jsonb_build_object(''rs'' || r.dn || r.dk, now()) where id = r.id;
    perform net.http_post(
      url := ''https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay'',
      body := jsonb_build_object(''run_id'', r.id, ''kind'', r.dk, ''night'', r.dn, ''rescore'', true),
      headers := ''{"Content-Type":"application/json"}''::jsonb, timeout_milliseconds := 1000);
  end loop;
  return jsonb_build_object(''started'', v_started, ''built'', v_built, ''cleared'', v_cleared);']];
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_run_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;

-- The forecast cells ('fc') or satellite points ('sat') a trip's rated shots use, as replay_build keys them.
create or replace function public.replay_live_points(p_trip uuid, p_kind text)
returns table (point_key text) language sql stable set search_path = public as $$
  select distinct case when p_kind = 'fc'
           then 'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4)
           else 'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) end
    from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
   where i.trip_id = p_trip and i.tier is not null and i.star_vantage_id is not null and s.lat is not null
$$;

create or replace function public.replay_live_queue() returns jsonb
language plpgsql set search_path = public, extensions as $$
declare r record; v_tz text; v_d date; n int := 0; k int; c int;
begin
  for r in select distinct x.trip_id, x.start_date, x.nights, x.night,
                  bool_or(coalesce((x.config ->> 'morning_fresh')::boolean, false)) over (partition by x.trip_id) fresh
             from replay_runs x
            where coalesce((x.config ->> 'live')::boolean, false) and x.status in ('queued', 'running') loop
    select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = r.trip_id;
    for k in r.night .. r.nights - 1 loop
      v_d := r.start_date + k;
      -- the evening's forecasts (from 19:30 local the day before)
      if now() >= ((v_d - 1) + time '19:30') at time zone v_tz then
        insert into replay_fetch (kind, point_key, model, start_date, end_date)
        select 'live', p.point_key, m.model, v_d, v_d + 3
          from replay_live_points(r.trip_id, 'fc') p
          cross join lateral (select distinct w.model from replay_wx_day w
                               where w.point_key = p.point_key and w.model not like '%@%' and w.day < date '2026-06-30') m
        on conflict do nothing;
        get diagnostics c = row_count; n := n + c;
      end if;
      -- ECMWF's overnight (00 UTC) run for the morning re-plan
      if r.fresh and now() >= v_d + time '07:00' then
        insert into replay_fetch (kind, point_key, model, start_date, end_date)
        select 'run', p.point_key, 'ecmwf_ifs', v_d, v_d + 1 from replay_live_points(r.trip_id, 'fc') p
        on conflict do nothing;
        get diagnostics c = row_count; n := n + c;
      end if;
    end loop;
    -- satellite truth for every planned day once both UTC days it covers are complete
    for k in 0 .. r.nights - 1 loop
      v_d := r.start_date + k;
      if v_d < current_date - 2 then
        insert into replay_fetch (kind, point_key, model, start_date, end_date)
        select 'sat', p.point_key, 'satellite', v_d, v_d + 1 from replay_live_points(r.trip_id, 'sat') p
         where exists (select 1 from replay_points rp where rp.point_key = p.point_key)
        on conflict do nothing;
        get diagnostics c = row_count; n := n + c;
      end if;
    end loop;
  end loop;
  if n > 0 and not exists (select 1 from cron.job where jobname = 'replay-fetch') then
    perform cron.schedule('replay-fetch', '0-6,8-59 * * * *', 'select public.replay_fetch_tick();');
  end if;
  if exists (select 1 from replay_runs x where coalesce((x.config ->> 'live')::boolean, false) and x.status in ('queued', 'running'))
     and not exists (select 1 from cron.job where jobname = 'replay-run') then
    perform cron.schedule('replay-run', '20 seconds', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
  end if;
  return jsonb_build_object('queued', n);
end $$;

create or replace function public.replay_live_roll(p_until date default date '2026-12-28') returns jsonb
language plpgsql set search_path = public as $$
declare n int;
begin
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  select x.trip_id, x.start_date + x.nights, x.trip_dates, x.nights, x.config, 'queued'
    from replay_runs x
   where coalesce((x.config ->> 'live')::boolean, false) and x.status = 'done'
     and x.start_date + x.nights <= p_until
     and not exists (select 1 from replay_runs y where y.config = x.config and y.trip_id = x.trip_id and y.start_date = x.start_date + x.nights)
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('started', n);
end $$;

select cron.schedule('replay-live-queue', '2-59/10 * * * *', 'select public.replay_live_queue();');
select cron.schedule('replay-live-roll', '41 15 * * *', 'select public.replay_live_roll();');

-- Then (29 Oct): live downloads (kind 'live', or anything for recent/upcoming dates) go
-- first, so a long bench download queue never delays the evening plan.
do $$
declare d text;
begin
  d := pg_get_functiondef('replay_fetch_tick()'::regprocedure);
  if position('where status = ''queued'' order by tries, id limit 3' in d) = 0 then raise exception 'replay_fetch_tick: send order not found'; end if;
  execute replace(d, 'where status = ''queued'' order by tries, id limit 3',
                     'where status = ''queued'' order by (kind = ''live'' or start_date >= current_date - 7) desc, tries, id limit 3');
end $$;

-- Then (29 Oct): live runs wait most of the day, so they do not take bench slots.
do $$
declare d text;
begin
  d := pg_get_functiondef('replay_run_tick()'::regprocedure);
  if position('limit greatest(0, v_slots - (select count(*) from replay_runs where status = ''running''))' in d) = 0 then raise exception 'replay_run_tick: slots text not found'; end if;
  d := replace(d, 'limit greatest(0, v_slots - (select count(*) from replay_runs where status = ''running''))',
                  'limit greatest(0, v_slots - (select count(*) from replay_runs where status = ''running'' and not coalesce((config ->> ''live'')::boolean, false)))');
  if position('where id in (select id from replay_runs where status = ''queued'' order by id' in d) = 0 then raise exception 'replay_run_tick: queue text not found'; end if;
  d := replace(d, 'where id in (select id from replay_runs where status = ''queued'' order by id',
                  'where coalesce((config ->> ''live'')::boolean, false) and status = ''queued''
      or id in (select id from replay_runs where status = ''queued'' and not coalesce((config ->> ''live'')::boolean, false) order by id');
  execute d;
end $$;

-- Then (29 Oct): the rescore waits only for the satellite points the bench has
-- (replay_points); a stop whose point the bench never had is scored as on the bench.
do $$
declare d text;
begin
  d := pg_get_functiondef('replay_run_tick()'::regprocedure);
  if position('from replay_live_points(x.trip_id, ''sat'') sp
                               where (select count(*)' in d) = 0 then raise exception 'replay_run_tick: sat gate not found'; end if;
  execute replace(d, 'from replay_live_points(x.trip_id, ''sat'') sp
                               where (select count(*)',
                     'from replay_live_points(x.trip_id, ''sat'') sp
                               where exists (select 1 from replay_points rp where rp.point_key = sp.point_key)
                                 and (select count(*)');
end $$;
