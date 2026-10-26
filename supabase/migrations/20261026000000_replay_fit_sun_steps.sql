-- Planner test bench, part 9: the sun calibration in small steps. The one-shot
-- replay_fit_sun() (part 8) froze the Micro database on 25 Oct 2026 (~8 PM
-- EDT: out of memory, crash, then frozen again until Phil restarted it): it
-- ran sun_position for every hour at every subject and a self-join view
-- (replay_model_dups) per row, all in one statement. Now:
--   replay_fit_sun()       only queues steps (cheap); trips with a calsun run only
--   replay_fit_sun_step()  runs queued steps for up to ~40 s per call
--     truth (trip, season): the satellite's sun fraction per subject cell and
--       daylight hour into replay_sun_truth, sun height computed once here
--     model (trip, model): that model's forecast at the same hours, binned,
--       into replay_sun_counts (model copies are not skipped: a copy gets the
--       same fit, and replay_build leaves copies out of the members anyway)
-- pg_cron replay-fit-sun runs the steps every minute; replay_run_tick holds
-- calsun runs back while a trip has steps queued.

create table if not exists replay_sun_truth (
  trip_id uuid not null, fc_key text not null, sat_key text not null, day date not null, h integer not null,
  a real not null, r real not null,
  primary key (trip_id, fc_key, sat_key, day, h));

create table if not exists replay_fit_queue (
  id bigserial primary key, trip_id uuid not null, kind text not null, season integer, model text,
  status text not null default 'queued', note text, updated_at timestamptz not null default now());

create or replace function replay_fit_sun() returns integer
language plpgsql as $$
declare n int; t uuid;
begin
  for t in select distinct trip_id from replay_runs where config ? 'calsun' and status in ('queued', 'running') loop
    update replay_fit_queue set status = 'replaced', updated_at = now() where trip_id = t and status = 'queued';
    insert into replay_fit_queue (trip_id, kind, season)
    select distinct t, 'truth', replay_season(sd.day)
      from replay_sat_day sd
     where sd.point_key in (select 'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10)
                              from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
                             where i.trip_id = t and i.tier is not null and s.lat is not null);
    insert into replay_fit_queue (trip_id, kind, model)
    select distinct t, 'model', w.model
      from replay_wx_day w
     where w.point_key in (select 'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4)
                             from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
                            where i.trip_id = t and i.tier is not null and s.lat is not null);
  end loop;
  select count(*) into n from replay_fit_queue where status = 'queued';
  return n;
end $$;

create or replace function replay_fit_sun_step() returns jsonb
language plpgsql as $$
declare q record; v_t0 timestamptz := clock_timestamp(); v_done int := 0;
begin
  loop
    exit when clock_timestamp() - v_t0 > interval '40 seconds';
    -- Truth steps first (the model steps read them).
    select * into q from replay_fit_queue where status = 'queued' order by (kind = 'model'), id limit 1;
    exit when q is null;
    begin
    if q.kind = 'truth' then
      execute 'del' || 'ete from replay_sun_truth where trip_id = $1 and replay_season(day) = $2' using q.trip_id, q.season;
      insert into replay_sun_truth (trip_id, fc_key, sat_key, day, h, a, r)
      with st as (
        select 'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4) fc_key,
               'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) sat_key,
               avg(s.lat) slat, avg(s.lng) slng
          from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
         where i.trip_id = q.trip_id and i.tier is not null and s.lat is not null
         group by 1, 2)
      select q.trip_id, st.fc_key, st.sat_key, sd.day, h.h, x.a, least(1, sd.dni[h.h + 1] / (0.8 * replay_clear_dni(x.a)))
        from st
        join replay_sat_day sd on sd.point_key = st.sat_key and replay_season(sd.day) = q.season
        cross join generate_series(0, 23) h(h)
        cross join lateral (select sp.altitude::real a
                              from sun_position(((sd.day + make_interval(hours => h.h))::timestamp at time zone 'UTC') - interval '30 minutes', st.slat, st.slng) sp) x
       where sd.dni[h.h + 1] is not null and replay_clear_dni(x.a) >= 80
      on conflict do nothing;
    else
      insert into replay_sun_counts (trip_id, season, model, bin, n, sum_r)
      select t.trip_id, replay_season(t.day), w.model, replay_sv_bin(x.sv), count(*), sum(t.r)
        from replay_sun_truth t
        join replay_wx_day w on w.point_key = t.fc_key and w.model = q.model and w.day = t.day
        cross join lateral (select replay_fc_sv(w.dr[t.h + 1], w.cloud[t.h + 1], t.a) sv) x
       where t.trip_id = q.trip_id and x.sv is not null
       group by 1, 2, 3, 4
      on conflict (trip_id, season, model, bin) do update set n = excluded.n, sum_r = excluded.sum_r;
    end if;
    update replay_fit_queue set status = 'done', updated_at = now() where id = q.id;
    exception when others then
      update replay_fit_queue set status = 'error', note = left(sqlerrm, 300), updated_at = now() where id = q.id;
    end;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('done', v_done, 'left', (select count(*) from replay_fit_queue where status = 'queued'));
end $$;

-- replay_run_tick: hold calsun runs back while their trip's fit is queued.
do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  a text := 'and (f.model not like ''%@0'' or r.config ->> ''day1_lead'' = ''0''));';
begin
  if position(a in d) = 0 then raise exception 'replay_run_tick: download wait not found'; end if;
  execute replace(d, a, a || E'\n    continue when coalesce((r.config ->> ''calsun'')::boolean, false)\n'
    || '                  and exists (select 1 from replay_fit_queue fq where fq.trip_id = r.trip_id and fq.status = ''queued'');');
end $$;

-- Run once: select replay_fit_sun();
-- select cron.schedule('replay-fit-sun', '* * * * *', 'select public.replay_fit_sun_step();');
-- then the bench: select cron.schedule('replay-run', '* * * * *', 'set statement_timeout = ''10min''; select public.replay_run_tick();');

-- 25 Oct 2026: all 37 steps ran in under 40 s (60,487 truth hours). The
-- newest-run runs (day1_lead 0) were set to status 'hold' until their
-- downloads finish, so they don't take the 8 run slots while they wait:
--   update replay_runs set status = 'hold' where config ->> 'day1_lead' = '0' and night = 0;
--   later: update replay_runs set status = 'queued' where status = 'hold';
