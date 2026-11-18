-- Planner test bench, part 4: whole-trip runs (Phil, 25 Oct 2026). The trip's
-- days in order on consecutive past days; each night solver-replay plans the
-- next 3 days, does the first and marks what it got as shot (see the edge
-- function header). replay_run_tick (pg_cron replay-run, every minute) keeps
-- 4 runs going, makes the score builds each night needs (forecast made 1, 2,
-- 3 days ahead + truth), and clears builds and past-date light geometry no
-- pending run needs any more.

create table if not exists replay_runs (
  id bigserial primary key,
  trip_id uuid not null references trips(id),
  start_date date not null,        -- past day that is trip day 1
  trip_dates date[] not null,      -- the trip days, in order
  nights integer not null,
  config jsonb not null default '{"name": "base"}',
  status text not null default 'queued',  -- queued / running / planning / done / error
  night integer not null default 0,       -- next night to plan
  state jsonb not null default '{}',      -- per plan: {group stop id: truth value x250 shot}
  note text,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (trip_id, start_date, config)
);

-- The hidden-peaks fit is redone once a place's downloads have all arrived.
alter table replay_places add column if not exists fitted_at timestamptz;

create table if not exists replay_run_days (
  run_id bigint not null references replay_runs(id),
  night integer not null,
  kind text not null,              -- fc3 / fc1 / lt3 / hs3 / my
  replay_date date not null,
  trip_date date,
  predicted real,
  realized real,                   -- new value against the truth (tier points), over what was already shot
  drive_minutes integer,
  visits jsonb,
  stats jsonb,
  primary key (run_id, night, kind)
);

-- Teton: 7-day trip started every 2 days, 1 Dec - 25 Jan of both winters.
-- Faroes: the 15 days after the flight day, started every 3 days, 1 May - 1 Jun 2024-2026.
create or replace function replay_runs_setup(p_config jsonb default '{"name": "base"}') returns integer
language plpgsql as $$
declare n int; v_teton uuid := '5e247891-d800-4d07-b5e0-8ad748ae2754'; v_faroe uuid := 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d';
  td date[]; fd date[];
begin
  select array_agg(date order by date) into td from days where trip_id = v_teton;
  select array_agg(date order by date) into fd from days where trip_id = v_faroe and date > date '2027-05-13';
  with ins as (
    insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
    select v_teton, s::date, td, cardinality(td), p_config
      from (select generate_series(date '2024-12-01', date '2025-01-25', interval '2 days') s
            union all select generate_series(date '2025-12-01', date '2026-01-25', interval '2 days')) x
    union all
    select v_faroe, s::date, fd, cardinality(fd), p_config
      from (select generate_series(date '2024-05-01', date '2024-06-01', interval '3 days') s
            union all select generate_series(date '2025-05-01', date '2025-06-01', interval '3 days')
            union all select generate_series(date '2026-05-01', date '2026-06-01', interval '3 days')) y
    order by 1, 2
    on conflict do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;

create or replace function replay_run_tick() returns jsonb
language plpgsql as $$
declare r record; v_day bigint; i int; v_started int := 0; v_built int := 0; v_cleared int := 0; k int;
  v_slots int := 4;
begin
  -- No answer in 5 minutes: try the night once more, then give up on the run.
  update replay_runs set status = case when note = 'retry' then 'error' else 'running' end,
         note = case when note = 'retry' then 'no answer from solver-replay' else 'retry' end, updated_at = now()
   where status = 'planning' and started_at < now() - interval '5 minutes';

  -- Builds and past-date light geometry before every pending run's next day.
  for r in select t.trip_id, (select min(x.start_date + x.night) from replay_runs x
                               where x.trip_id = t.trip_id and x.status in ('queued', 'running', 'planning')) lo
             from replay_places t loop
    execute 'del' || 'ete from replay_scores s using replay_builds b, replay_days d where s.build_id = b.id and d.id = b.replay_day_id '
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

  -- Keep 4 runs going (oldest first).
  update replay_runs set status = 'running', updated_at = now()
   where id in (select id from replay_runs where status = 'queued' order by id
                 limit greatest(0, v_slots - (select count(*) from replay_runs where status in ('running', 'planning'))));

  for r in select * from replay_runs where status = 'running' order by id loop
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
    update replay_runs set status = 'planning', started_at = now(), updated_at = now() where id = r.id;
    perform net.http_post(
      url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay',
      body := jsonb_build_object('run_id', r.id),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
    v_started := v_started + 1;
  end loop;
  return jsonb_build_object('started', v_started, 'built', v_built, 'cleared', v_cleared);
end $$;

-- Per trip and plan, over finished runs: mean trip total (tier points against
-- the truth), as a share of the hindsight plan (hs3), and how often it beat
-- light-only and Phil's own days.
create or replace function replay_run_summary(p_config text default 'base') returns table (
  trip text, kind text, runs bigint, mean_total numeric, share_of_best numeric, beat_light numeric, beat_my numeric, mean_drive_day numeric)
language sql stable as $$
  with t as (
    select r.id, tr.title trip, d.kind, sum(d.realized) total, avg(d.drive_minutes) drive
      from replay_runs r join trips tr on tr.id = r.trip_id join replay_run_days d on d.run_id = r.id
     where r.status = 'done' and r.config ->> 'name' = p_config
     group by 1, 2, 3),
  w as (select t.*, max(total) filter (where kind = 'hs3') over (partition by id) best,
               max(total) filter (where kind = 'lt3') over (partition by id) light,
               max(total) filter (where kind = 'my') over (partition by id) mine from t)
  select trip, kind, count(*), round(avg(total)::numeric, 1),
         round((sum(total) / nullif(sum(best), 0))::numeric, 2),
         round(avg(case when total > light + 0.05 then 1 when total < light - 0.05 then 0 else 0.5 end)::numeric, 2),
         round(avg(case when total > mine + 0.05 then 1 when total < mine - 0.05 then 0 else 0.5 end)::numeric, 2),
         round(avg(drive)::numeric, 0)
    from w group by trip, kind order by trip, kind
$$;

-- Run once: select replay_fit_hidden(); select replay_runs_setup();
-- The free plan goes read-only at 500 MB (Phil: keep an eye on it): the bench
-- pauses itself at 470 MB.
-- select cron.schedule('replay-run', '* * * * *',
--   'select case when pg_database_size(current_database()) < 470 * 1024 * 1024 then public.replay_run_tick() end;');
