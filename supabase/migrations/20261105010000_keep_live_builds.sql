-- Keep a live run's builds until its nights are scored (5 Nov 2026). Bumping replay_places.fitted_at
-- (4 Nov, the new light rule) cleared every older build, including the forecasts of live nights still
-- waiting for their satellite truth; their rescore then failed with 'replay builds missing' and the
-- practice scoreboard stopped at 31 Oct. Builds of a day that an unscored live night (that day or up to
-- two days before, its forecast horizon) still needs are now kept.
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
                    and pg_database_size(current_database()) > 1536::bigint * 1024 * 1024 limit 20 loop
      execute 'del' || 'ete from solver_light_cache c using replay_days d where d.id = $1 and c.local_date = d.replay_date and c.vantage_id in '
           || '(select i.star_vantage_id from solver_stop_inputs i where i.trip_id = d.trip_id and i.star_vantage_id is not null)' using v_day;
      update replay_days set light_cleared = true where id = v_day;
    end loop;
  end loop;
  -- Keep an eye on the database size (Phil): clean up always, start nothing new over 2 GB.
  if pg_database_size(current_database()) > 2048::bigint * 1024 * 1024 then
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
    end if;
    v_kinds := case when r.config ? 'kinds' then array(select jsonb_array_elements_text(r.config -> 'kinds')) else v_all end;
    v_hz := case when v_kinds && array['fc3', 'lt3', 'hs3', 'blk', 'imp', 'fm1', 'mc1', 'mr1', 'mrmc'] then least(greatest(coalesce((r.config ->> 'fc_days')::int, 3), 3), 7) - 1 else 0 end;
    begin
      for i in r.night .. least(r.night + v_hz, r.nights - 1) loop
        insert into replay_days (trip_id, replay_date, trip_date) values (r.trip_id, r.start_date + i, r.trip_dates[i + 1])
        on conflict do nothing;
        select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.start_date + i;
        if not v_live and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth' and lead = case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end) then
          perform replay_build(v_day, 'truth', greatest(1, case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end)); v_built := v_built + 1;
        end if;
        v_l := (case when i = r.night and r.config ? 'day1_lead' then (r.config ->> 'day1_lead')::int else i - r.night + 1 end)
             + case when coalesce((r.config ->> 'calsun')::boolean, false) then 10 else 0 end + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end
             + case when coalesce((r.config ->> 'learn')::boolean, false) then 40 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end;
        if not coalesce((r.config ->> 'draft')::boolean, false) and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then
          perform replay_build(v_day, 'forecast', v_l); v_built := v_built + 1;
        end if;
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and (not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'morning' and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end) then
          perform replay_build(v_day, 'morning', 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end); v_built := v_built + 1;
        end if;
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'morning_fresh')::boolean, false)
           and (not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'morningf' and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end) then
          perform replay_build(v_day, 'morningf', 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end); v_built := v_built + 1;
        end if;
        -- Midday re-plan (run config midday, bench only, 4 Nov 2026): the noon look's build.
        if i = r.night and not v_live and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'midday')::boolean, false)
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'middayf' else 'midday' end
                             and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end) then
          perform replay_build(v_day, case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'middayf' else 'midday' end,
                               1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end); v_built := v_built + 1;
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
      url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay',
      body := jsonb_build_object('run_id', r.id, 'kind', s2.kind),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000)
      from replay_run_state s2 where s2.run_id = r.id and s2.night = r.night;
    v_started := v_started + 1;
  end loop;
  -- Live runs: score each planned night once its day's satellite truth is in.
  for r in select x.id, x.trip_id, x.state, d.night dn, d.kind dk, d.replay_date dd,
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
      url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay',
      body := jsonb_build_object('run_id', r.id, 'kind', r.dk, 'night', r.dn, 'rescore', true),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  end loop;
  return jsonb_build_object('started', v_started, 'built', v_built, 'cleared', v_cleared);
end $function$;
