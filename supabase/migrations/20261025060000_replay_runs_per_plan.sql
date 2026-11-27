-- Planner test bench, part 5: one solver-replay request per plan and night
-- (a whole night in one request ran over the 2 s edge CPU limit on some nights).
-- Existing runs were moved over with: insert into replay_run_state (run_id, kind,
-- night, state) select id, k, night, state -> k from replay_runs, unnest(kinds) k.
-- pg_cron replay-run: 'select public.replay_run_tick();' every minute; the tick
-- itself starts nothing new over 2 GB but always clears. 6 runs at a time.

-- Per plan and night of a whole-trip run (one solver-replay request each:
-- the edge CPU limit is 2 s).
create table if not exists replay_run_state (
  run_id bigint not null references replay_runs(id),
  kind text not null,                     -- fc3 / fc1 / lt3 / hs3 / my
  night integer not null default 0,       -- next night this plan plans
  state jsonb not null default '{}',      -- {group stop id: truth value x250 shot}
  status text not null default 'idle',    -- idle / planning / error
  note text,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (run_id, kind)
);

create or replace function replay_run_tick() returns jsonb
language plpgsql as $$
declare r record; v_day bigint; i int; v_started int := 0; v_built int := 0; v_cleared int := 0; k int;
  v_slots int := 6; v_kinds text[] := array['fc3', 'fc1', 'lt3', 'hs3', 'my'];
  v_t0 timestamptz := clock_timestamp();
begin
  -- A plan with no answer in 5 minutes: once more, then the run stops with a note.
  update replay_run_state set status = case when note = 'retry' then 'error' else 'idle' end,
         note = case when note = 'retry' then 'no answer from solver-replay' else 'retry' end, updated_at = now()
   where status = 'planning' and started_at < now() - interval '5 minutes';
  update replay_runs rr set status = 'error', note = s.kind || ': ' || s.note, updated_at = now()
    from replay_run_state s where s.run_id = rr.id and s.status = 'error' and rr.status = 'running';

  -- All five plans have done the night: on to the next (or the run is done).
  update replay_runs rr set night = rr.night + 1, status = case when rr.night + 1 >= rr.nights then 'done' else 'running' end, updated_at = now()
   where rr.status = 'running'
     and (select count(*) from replay_run_state s where s.run_id = rr.id and s.night > rr.night and s.status = 'idle') = cardinality(v_kinds);

  -- Builds and past-date light geometry before every pending run's next day.
  for r in select t.trip_id, (select min(x.start_date + x.night) from replay_runs x
                               where x.trip_id = t.trip_id and x.status in ('queued', 'running')) lo
             from replay_places t loop
    execute 'del' || 'ete from replay_scores_c s using replay_builds b, replay_days d where s.build_id = b.id and d.id = b.replay_day_id '
         || 'and d.trip_id = $1 and ($2::date is null or d.replay_date < $2)' using r.trip_id, r.lo;
    get diagnostics k = row_count; v_cleared := v_cleared + k;
    execute 'del' || 'ete from replay_builds b using replay_days d where d.id = b.replay_day_id '
         || 'and d.trip_id = $1 and ($2::date is null or d.replay_date < $2)' using r.trip_id, r.lo;
    for v_day in select d.id from replay_days d
                  where d.trip_id = r.trip_id and not d.light_cleared and d.replay_date < date '2026-10-01'
                    and (r.lo is null or d.replay_date < r.lo) limit 20 loop
      execute 'del' || 'ete from solver_light_cache c using replay_days d where d.id = $1 and c.local_date = d.replay_date and c.vantage_id in '
           || '(select i.star_vantage_id from solver_stop_inputs i where i.trip_id = d.trip_id and i.star_vantage_id is not null)' using v_day;
      update replay_days set light_cleared = true where id = v_day;
    end loop;
  end loop;

  -- Keep an eye on the database size (Phil): clean up always, start nothing
  -- new over 2 GB (Pro plan since 25 Oct 2026: 8 GB disk, spend cap on; it was
  -- 470 MB on the free plan's 500 MB).
  if pg_database_size(current_database()) > 2048::bigint * 1024 * 1024 then
    return jsonb_build_object('paused', 'database over 2 GB', 'cleared', v_cleared);
  end if;

  -- Keep 6 runs going (oldest first).
  update replay_runs set status = 'running', updated_at = now()
   where id in (select id from replay_runs where status = 'queued' order by id
                 limit greatest(0, v_slots - (select count(*) from replay_runs where status = 'running')));
  insert into replay_run_state (run_id, kind, night)
  select rr.id, kk, rr.night from replay_runs rr cross join unnest(v_kinds) kk where rr.status = 'running'
  on conflict do nothing;

  -- Runs with nothing in flight and a plan still to do tonight (a plan that
  -- got no answer is sent again on its own).
  for r in select * from replay_runs x where x.status = 'running'
              and not exists (select 1 from replay_run_state s where s.run_id = x.id and s.status <> 'idle')
              and exists (select 1 from replay_run_state s where s.run_id = x.id and s.night = x.night)
            order by id loop
    -- A Faroes truth build takes ~9 s: leave the rest for the next minute
    -- (pg_cron cancels a tick after 2 min, and nothing it did is kept).
    exit when clock_timestamp() - v_t0 > interval '60 seconds';
    -- Wait for the place's downloads, then refit hidden peaks on them.
    continue when exists (select 1 from replay_fetch f join replay_points p on p.point_key = f.point_key
                           where f.status in ('queued', 'sent') and (p.lat > 55) = (r.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'));
    if exists (select 1 from replay_places pl where pl.trip_id = r.trip_id
                and (pl.fitted_at is null or pl.fitted_at < (select max(f.updated_at) from replay_fetch f join replay_points p on p.point_key = f.point_key
                                                             where f.status = 'done' and (p.lat > 55) = (pl.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')))) then
      perform replay_fit_hidden();
      update replay_places set fitted_at = now();
    end if;
    begin
      for i in r.night .. least(r.night + 2, r.nights - 1) loop
        insert into replay_days (trip_id, replay_date, trip_date) values (r.trip_id, r.start_date + i, r.trip_dates[i + 1])
        on conflict do nothing;
        select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.start_date + i;
        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth') then
          perform replay_build(v_day, 'truth'); v_built := v_built + 1;
        end if;
        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = i - r.night + 1) then
          perform replay_build(v_day, 'forecast', i - r.night + 1); v_built := v_built + 1;
        end if;
      end loop;
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
  return jsonb_build_object('started', v_started, 'built', v_built, 'cleared', v_cleared);
end $$;
