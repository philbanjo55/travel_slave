-- Test lane (18 Nov 2026, Phil: "build the lane and put ideal light on it"; "make sure ... it doesn't affect T").
-- A run whose config has lane = 'lab' is planned by the separate edge function solver-replay-lab instead of
-- solver-replay. Every other run (live T, drafts, bench) keeps calling solver-replay exactly as before:
-- replay_fn_url returns the same address for any config without lane = 'lab'.
-- Lab runs are never publish runs (config publish false), so none of the "the trip's T run" lookups
-- (planner_t_now, planner_t_note_replan, planner_t_replan_mode, planner_t_week, webcam_paid_slots) can pick
-- one; the lab function itself writes no app plan for them (see solver-replay-lab).

create or replace function public.replay_fn_url(p_cfg jsonb) returns text
language sql immutable set search_path to 'public' as $$
  select 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/'
      || case when p_cfg ->> 'lane' = 'lab' then 'solver-replay-lab' else 'solver-replay' end
$$;

CREATE OR REPLACE FUNCTION public.replay_run_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare r record; v_day bigint; i int; v_started int := 0; v_built int := 0; v_cleared int := 0; k int; v_l int; v_hz int;
  v_slots int := 6; v_all text[] := array['fc3', 'fc1', 'lt3', 'hs3', 'my']; v_kinds text[];
  v_t0 timestamptz := clock_timestamp();
  v_live boolean; v_tz text; v_d date;
begin
  -- A plan with no answer in 5 minutes: once more, then the run stops with a note.
  update replay_run_state set status = case when note = 'retry' then 'error' else 'idle' end,
         note = case when note = 'retry' then 'no answer from solver-replay' else 'retry' end, updated_at = now()
   where status = 'planning' and started_at < now() - interval '2 minutes';
  update replay_runs rr set status = 'error', note = s.kind || ': ' || s.note, updated_at = now()
    from replay_run_state s where s.run_id = rr.id and s.status = 'error' and rr.status = 'running';
  -- Re-plan now (Phil, 5 Nov 2026): requests queued by planner_t_now. In daylight each waits for this
  -- hour's camera pictures (2 or more labelled, at most 4 min), then gets its own build (look = now) and
  -- goes to solver-replay.
  update planner_t_now set status = 'error', note = 'no answer from the planner', done_at = now()
   where status = 'planning' and planned_at < now() - interval '6 minutes';
  for r in select q.id, q.run_id, q.night, q.replay_date, q.requested_at, q.here, x.trip_id, x.config
             from planner_t_now q join replay_runs x on x.id = q.run_id where q.status = 'queued' order by q.id loop
    -- a sky report ("peaks are out / socked in", Phil's own word for this hour) needs no camera pictures: plan at once (13 Nov 2026)
    continue when now() < r.requested_at + interval '4 minutes' and (r.here ->> 'sky') is null
      and coalesce((select (t_truth(r.trip_id, date_trunc('hour', now()), s.lat, s.lng) ->> 'cams')::int from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = r.trip_id), 0) < 2
      and coalesce((select (t_truth(r.trip_id, date_trunc('hour', now()) - interval '1 hour', s.lat, s.lng) ->> 'cams')::int from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = r.trip_id), 0) >= 1;
    begin
      select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.replay_date;
      update planner_t_now set status = 'planning', planned_at = now(), build_id = replay_build(v_day,
               case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'nowf' else 'now' end,
               1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end
                 + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end,
               now())
       where id = r.id;
      perform net.http_post(
        url := replay_fn_url(r.config),
        body := jsonb_build_object('run_id', r.run_id, 'kind', coalesce(r.config -> 'kinds' ->> 0, 'mrmc'), 'now', true, 'night', r.night,
                                   'build_id', (select build_id from planner_t_now where id = r.id), 'req_id', r.id, 'at', now()),
        headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
    exception when others then
      update planner_t_now set status = 'error', note = left(sqlerrm, 300), done_at = now() where id = r.id;
    end;
  end loop;
  -- All of the run's plans have done the night: on to the next (or the run is done).
  update replay_runs rr set night = rr.night + 1, status = case when rr.night + 1 >= rr.nights then 'done' else 'running' end, updated_at = now()
   where rr.status = 'running'
     and (select count(*) from replay_run_state s where s.run_id = rr.id and s.night > rr.night and s.status = 'idle')
         = coalesce(jsonb_array_length(rr.config -> 'kinds'), cardinality(v_all));
  -- Builds and past-date light geometry before every pending run's next day.
  for r in select t.trip_id, (select min(x.start_date + x.night) from replay_runs x
                               where x.trip_id = t.trip_id and x.status in ('queued', 'running')) lo
             from replay_places t loop
    execute 'del' || 'ete from replay_scores_c s using replay_builds b, replay_days d where s.build_id = b.id and d.id = b.replay_day_id '
         || 'and d.trip_id = $1 and b.created_at < (select pl.fitted_at from replay_places pl where pl.trip_id = $1) '
         || 'and not exists (select 1 from replay_run_days rd join replay_runs x on x.id = rd.run_id where x.trip_id = $1 '
         || 'and coalesce((x.config ->> ''live'')::boolean, false) and rd.realized is null and rd.replay_date between d.replay_date - 2 and d.replay_date)' using r.trip_id, r.lo;
    get diagnostics k = row_count; v_cleared := v_cleared + k;
    execute 'del' || 'ete from replay_builds b using replay_days d where d.id = b.replay_day_id '
         || 'and d.trip_id = $1 and b.created_at < (select pl.fitted_at from replay_places pl where pl.trip_id = $1) '
         || 'and not exists (select 1 from replay_run_days rd join replay_runs x on x.id = rd.run_id where x.trip_id = $1 '
         || 'and coalesce((x.config ->> ''live'')::boolean, false) and rd.realized is null and rd.replay_date between d.replay_date - 2 and d.replay_date)' using r.trip_id, r.lo;
    for v_day in select d.id from replay_days d
                  where d.trip_id = r.trip_id and not d.light_cleared and d.replay_date < date '2026-10-01'
                    and db_size_cached() > 1536::bigint * 1024 * 1024 limit 20 loop
      execute 'del' || 'ete from solver_light_cache c using replay_days d where d.id = $1 and c.local_date = d.replay_date and c.vantage_id in '
           || '(select i.star_vantage_id from solver_stop_inputs i where i.trip_id = d.trip_id and i.star_vantage_id is not null)' using v_day;
      update replay_days set light_cleared = true where id = v_day;
    end loop;
  end loop;
  -- Keep an eye on the database size (Phil): clean up always, start nothing new over 2 GB.
  if db_size_cached() > 2048::bigint * 1024 * 1024 then
    return jsonb_build_object('paused', 'database over 2 GB', 'cleared', v_cleared);
  end if;
  -- Keep 8 runs going (oldest first).
  update replay_runs set status = 'running', updated_at = now()
   where coalesce((config ->> 'live')::boolean, false) and status = 'queued'
      or id in (select id from replay_runs where status = 'queued' and not coalesce((config ->> 'live')::boolean, false) order by id
                 limit greatest(0, v_slots - (select count(*) from replay_runs where status = 'running' and not coalesce((config ->> 'live')::boolean, false))));
  insert into replay_run_state (run_id, kind, night)
  select rr.id, kk, rr.night from replay_runs rr
   cross join lateral unnest(case when rr.config ? 'kinds' then array(select jsonb_array_elements_text(rr.config -> 'kinds')) else v_all end) kk
   where rr.status = 'running'
  on conflict do nothing;
  -- Refit once a place's downloads have all arrived.
  if exists (select 1 from replay_places pl
              where (pl.fitted_at is null or pl.fitted_at < (select max(f.updated_at) from replay_fetch f join replay_points p on p.point_key = f.point_key
                                                             where f.status = 'done' and f.kind <> 'live' and f.start_date < date '2026-06-30' and (p.lat > 55) = replay_trip_north(pl.trip_id)))
                and not exists (select 1 from replay_fetch f join replay_points p on p.point_key = f.point_key
                                 where f.status in ('queued', 'sent') and (p.lat > 55) = replay_trip_north(pl.trip_id))) then
    perform replay_fit_hidden();
    perform replay_fit_morning();
    perform replay_fit_sun();
    update replay_places set fitted_at = now();
  end if;
  -- Runs with nothing in flight and a plan still to do tonight.
  for r in select * from replay_runs x where x.status = 'running'
              and not exists (select 1 from replay_run_state s where s.run_id = x.id and s.status <> 'idle')
              and exists (select 1 from replay_run_state s where s.run_id = x.id and s.night = x.night)
            order by id loop
    exit when clock_timestamp() - v_t0 > interval '60 seconds';
    -- Wait for the place's downloads (the newest runs only if the run uses them).
    continue when exists (select 1 from replay_fetch f join replay_points p on p.point_key = f.point_key
                           where f.status in ('queued', 'sent') and (p.lat > 55) = (select replay_trip_north(r.trip_id))
                             and (f.model not like '%@0' or r.config ->> 'day1_lead' = '0'));
    continue when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false)
                  and exists (select 1 from replay_fetchx f join replay_points p on p.point_key = f.point_key
                               where f.kind = 'live' and f.status in ('queued', 'sent') and (p.lat > 55) = (select replay_trip_north(r.trip_id)));
    continue when coalesce((r.config ->> 'calsun')::boolean, false)
                  and exists (select 1 from replay_fit_queue fq where fq.trip_id = r.trip_id and fq.status = 'queued');
    v_live := coalesce((r.config ->> 'live')::boolean, false);
    if v_live and not coalesce((r.config ->> 'draft')::boolean, false) then
      select coalesce(t.timezone, 'UTC') into v_tz from trips t where t.id = r.trip_id;
      v_d := r.start_date + r.night;
      continue when now() < ((v_d - 1) + coalesce((r.config ->> 'plan_local')::time, time '20:30')) at time zone v_tz;
      continue when not exists (select 1 from replay_fetch f where f.kind = 'live' and f.start_date = v_d and f.status = 'done'
                                   and (select p.lat > 55 from replay_points p where p.point_key = f.point_key) = (select replay_trip_north(r.trip_id)));
      if exists (select 1 from replay_run_state s where s.run_id = r.id and s.night = r.night
                  and (s.sets -> 'pending' ->> 'night')::int = r.night and s.sets -> 'pending' ->> 'stage' = 'night') then
        continue when not replay_live_morning_ready(r.trip_id, v_d, (r.config ->> 'stagger_min')::int);
        continue when coalesce((r.config ->> 'morning_fresh')::boolean, false)
          and not exists (select 1 from replay_wx_day w where w.model = 'ecmwf_ifs@f' and w.day = v_d
                            and (select p.lat > 55 from replay_points p where p.point_key = w.point_key) = (select replay_trip_north(r.trip_id)));
      end if;
      -- Early look (run config early, 5 Nov 2026): the morning re-plan is saved (stage 'morning') and the
      -- camera re-plan waits for the first pictures after sunrise.
      if coalesce((r.config ->> 'early')::boolean, false)
         and exists (select 1 from replay_run_state s where s.run_id = r.id and s.night = r.night
                      and (s.sets -> 'pending' ->> 'night')::int = r.night and s.sets -> 'pending' ->> 'stage' = 'morning') then
        continue when not replay_live_early_ready(r.trip_id, v_d, (r.config ->> 'stagger_min')::int);
      end if;
    end if;
    v_kinds := case when r.config ? 'kinds' then array(select jsonb_array_elements_text(r.config -> 'kinds')) else v_all end;
    v_hz := case when v_kinds && array['fc3', 'lt3', 'hs3', 'blk', 'imp', 'fm1', 'mc1', 'mr1', 'mrmc'] then least(greatest(coalesce((r.config ->> 'fc_days')::int, 3), 3), 7) - 1 else 0 end;
    begin
      for i in r.night .. least(r.night + v_hz, r.nights - 1) loop
        insert into replay_days (trip_id, replay_date, trip_date) values (r.trip_id, r.start_date + i, r.trip_dates[i + 1])
        on conflict do nothing;
        select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.start_date + i;
        -- truth_vote (6 Nov 2026): the day judged by the camera vote (truth lead + 5).
        if not v_live and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth' and lead = case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'truth_vote')::boolean, false) then 5 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) or coalesce((r.config ->> 'nopk_judge')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) or coalesce((r.config ->> 'blue_judge')::boolean, false) then 10240 else 0 end) then
          perform replay_build(v_day, 'truth', greatest(1, case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'truth_vote')::boolean, false) then 5 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) or coalesce((r.config ->> 'nopk_judge')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) or coalesce((r.config ->> 'blue_judge')::boolean, false) then 10240 else 0 end)); v_built := v_built + 1;
        end if;
        v_l := (case when i = r.night and r.config ? 'day1_lead' then (r.config ->> 'day1_lead')::int else i - r.night + 1 end)
             + case when coalesce((r.config ->> 'calsun')::boolean, false) then 10 else 0 end + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end
             + case when coalesce((r.config ->> 'learn')::boolean, false) then 40 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end;
        if not coalesce((r.config ->> 'draft')::boolean, false) and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then
          perform replay_build(v_day, 'forecast', v_l); v_built := v_built + 1;
        end if;
        -- Worksheet C4 (6 Nov 2026): the plain morning build is only read without morning_fresh.
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and not coalesce((r.config ->> 'morning_fresh')::boolean, false)
           and (not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'morning' and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end) then
          perform replay_build(v_day, 'morning', 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end); v_built := v_built + 1;
        end if;
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'morning_fresh')::boolean, false)
           and (not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'morningf' and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end) then
          perform replay_build(v_day, 'morningf', 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end); v_built := v_built + 1;
        end if;
        -- Midday re-plan (run config midday, bench only, 4 Nov 2026): the noon look's build.
        if i = r.night and not v_live and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'midday')::boolean, false)
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'middayf' else 'midday' end
                             and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end) then
          perform replay_build(v_day, case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'middayf' else 'midday' end,
                               1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end); v_built := v_built + 1;
        end if;
        -- Early look (run config early, 5 Nov 2026): the first camera pictures after sunrise (live: once they are in).
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'early')::boolean, false)
           and (not v_live or replay_live_early_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'earlyf' else 'early' end and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end) then
          perform replay_build(v_day, case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'earlyf' else 'early' end, 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end); v_built := v_built + 1;
        end if;
        -- Look before you leave (run config predawn, bench only, 5 Nov 2026): sunrise - 2 h.
        if i = r.night and not v_live and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'predawn')::boolean, false)
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'predawnf' else 'predawn' end and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end) then
          perform replay_build(v_day, case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'predawnf' else 'predawn' end, 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end + case when coalesce((r.config ->> 'vfit')::boolean, false) then 640 else 0 end + case when coalesce((r.config ->> 'nopk')::boolean, false) then 1280 else 0 end + case when coalesce((r.config ->> 'cons')::boolean, false) then 2560 else 0 end + case when coalesce((r.config ->> 'sbfix')::boolean, false) then 5120 else 0 end + case when coalesce((r.config ->> 'blue')::boolean, false) then 10240 else 0 end + case when coalesce((r.config ->> 'layers')::boolean, false) then 40960 else 0 end + case when coalesce((r.config ->> 'runs')::boolean, false) then 81920 else 0 end + case when coalesce((r.config ->> 'slay')::boolean, false) then 163840 else 0 end + case when coalesce((r.config ->> 'svis')::boolean, false) then 327680 else 0 end + case when coalesce((r.config ->> 'ideal')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 655360 else 0 end + case when coalesce((r.config ->> 'ideal_strong')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 1310720 else 0 end); v_built := v_built + 1;
        end if;
      end loop;
      if v_kinds && array['blk', 'imp', 'mc1', 'mrmc'] and r.night + coalesce((r.config ->> 'fc_days')::int, 3) <= r.nights - 1 then
        perform solver_fill_light_cache(r.trip_id, array(select (r.start_date + j)::date from generate_series(r.night + coalesce((r.config ->> 'fc_days')::int, 3), r.nights - 1) j), 30);
      end if;
    exception when others then
      update replay_runs set status = 'error', note = left(sqlerrm, 300), updated_at = now() where id = r.id;
      continue;
    end;
    update replay_run_state set status = 'planning', started_at = now(), updated_at = now() where run_id = r.id and night = r.night;
    perform net.http_post(
      url := replay_fn_url(r.config),
      body := jsonb_build_object('run_id', r.id, 'kind', s2.kind),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000)
      from replay_run_state s2 where s2.run_id = r.id and s2.night = r.night
       and not coalesce((r.config ->> 'local')::boolean, false);  -- run config local (C6, 9 Nov 2026): tools/bench_local picks the step up
    v_started := v_started + 1;
  end loop;
  -- Live runs: score each planned night once its day's satellite truth is in.
  for r in select x.id, x.trip_id, x.state, x.config, d.night dn, d.kind dk, d.replay_date dd,
                    case when coalesce((x.config ->> 'wx')::boolean, false) then 20 else 0 end tl
             from replay_runs x join replay_run_days d on d.run_id = x.id
            where coalesce((x.config ->> 'live')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false) and d.realized is null and d.replay_date < current_date
              and coalesce((x.state ->> ('rs' || d.night || d.kind))::timestamptz, '-infinity') < now() - interval '15 minutes'
              and not exists (select 1 from replay_live_points(x.trip_id, 'sat') sp
                               where exists (select 1 from replay_points rp where rp.point_key = sp.point_key)
                                 and (select count(*) from replay_sat_day sd where sd.point_key = sp.point_key and sd.day in (d.replay_date, d.replay_date + 1)) < 2) loop
    exit when clock_timestamp() - v_t0 > interval '90 seconds';
    select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.dd;
    begin
      if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth' and lead = r.tl) then
        perform replay_build(v_day, 'truth', greatest(1, r.tl)); v_built := v_built + 1;
      end if;
    exception when others then
      continue;
    end;
    update replay_runs set state = state || jsonb_build_object('rs' || r.dn || r.dk, now()) where id = r.id;
    perform net.http_post(
      url := replay_fn_url(r.config),
      body := jsonb_build_object('run_id', r.id, 'kind', r.dk, 'night', r.dn, 'rescore', true),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  end loop;
  return jsonb_build_object('started', v_started, 'built', v_built, 'cleared', v_cleared);
end $function$

;

CREATE OR REPLACE FUNCTION public.replay_live_roll(p_until date DEFAULT '2026-12-28'::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  select x.trip_id, x.start_date + x.nights, x.trip_dates, x.nights, x.config, 'queued'
    from replay_runs x
   where coalesce((x.config ->> 'live')::boolean, false) and x.status = 'done' and not coalesce((x.config ->> 'publish')::boolean, false)
     and x.config ->> 'lane' is null  -- lab runs follow T through planner_lab_follow (18 Nov 2026)
     and x.start_date + x.nights <= p_until
     and not exists (select 1 from replay_runs y where y.config = x.config and y.trip_id = x.trip_id and y.start_date = x.start_date + x.nights)
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('started', n);
end $function$

;

-- Experiments that follow a live T run: planner_lab_follow (cron, every 10 min) gives each active row a lab
-- copy of the trip's current live T run (same dates, same settings, config || extra), started at a night
-- boundary (T's state between nights, before its next evening plan) from T's own state, so both plan the
-- rest of the round from the same point. A new T round gets a new lab copy; the old one stops with it.
create table if not exists public.planner_lab (
  id bigserial primary key,
  trip_id uuid not null references public.trips(id),
  name text not null,
  extra jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (trip_id, name)
);

create or replace function public.planner_lab_follow() returns jsonb
language plpgsql set search_path to 'public' as $$
declare l record; t record; s record; v_run bigint; n int := 0; k int;
begin
  -- A lab copy stops when its T run is no longer going or its experiment is switched off.
  update replay_runs x set status = 'stopped', note = 'lab: T run ended or experiment off', updated_at = now()
   where x.config ->> 'lane' = 'lab' and x.config ? 'lab_of' and x.status in ('queued', 'running')
     and (not exists (select 1 from replay_runs y where y.id = (x.config ->> 'lab_of')::bigint and y.status in ('queued', 'running', 'done'))
          or not exists (select 1 from planner_lab p where p.trip_id = x.trip_id and p.name = x.config ->> 'lab_name' and p.active));
  get diagnostics k = row_count;
  for l in select * from planner_lab where active order by id loop
    select x.* into t from replay_runs x
     where x.trip_id = l.trip_id and x.status = 'running' and coalesce((x.config ->> 'live')::boolean, false)
       and coalesce((x.config ->> 'publish')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false)
       and x.config ->> 'lane' is null
     order by x.id desc limit 1;
    continue when t.id is null;
    continue when exists (select 1 from replay_runs y where y.config ->> 'lane' = 'lab' and y.config ->> 'lab_of' = t.id::text and y.config ->> 'lab_name' = l.name);
    -- only between nights: T's state is at its current night, idle, nothing half done, tonight not planned yet
    select * into s from replay_run_state where run_id = t.id and kind = 'mrmc';
    continue when s.run_id is null or s.night <> t.night or s.status <> 'idle' or coalesce(s.sets, '{}'::jsonb) ? 'pending'
      or exists (select 1 from replay_run_days d where d.run_id = t.id and d.night = t.night);
    insert into replay_runs (trip_id, start_date, trip_dates, nights, night, config, status, note)
    values (t.trip_id, t.start_date, t.trip_dates, t.nights, t.night,
            (t.config - 'publish') || jsonb_build_object('publish', false, 'lane', 'lab', 'as_app', true,
              'lab_of', t.id, 'lab_name', l.name, 'name', 'lab_' || l.name,
              'plan_local', to_char(coalesce((t.config ->> 'plan_local')::time, time '20:30') + interval '10 minutes', 'HH24:MI'))
            || l.extra,
            'running', 'lab copy of run ' || t.id || ' from night ' || t.night)
    returning id into v_run;
    insert into replay_run_state (run_id, kind, night, state, sets, status, updated_at)
    values (v_run, 'mrmc', s.night, s.state, s.sets, 'idle', now());
    n := n + 1;
  end loop;
  return jsonb_build_object('started', n, 'stopped', k);
end $$;

select cron.schedule('planner-lab-follow', '4-59/10 * * * *', 'select public.planner_lab_follow()');
