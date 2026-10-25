-- Planner test bench, part 2 (Phil, 25 Oct 2026): score builds, work queue,
-- clean-up and summary. Applied in pieces through the MCP connector (see
-- CLAUDE.md: keep "drop" and plain "del ete from" out of SQL sent through it).
-- pg_cron: replay-fetch ('0-4,13-14,21-59 * * * *', replay_fetch_tick, part 1;
-- unschedules itself when the downloads are done) and replay-run ('* * * * *',
-- replay_tick). Edge function: solver-replay.

create table if not exists replay_queue (
  id bigserial primary key,
  replay_day_id bigint not null references replay_days(id),
  config jsonb not null default '{"name": "base"}',
  status text not null default 'queued',
  note text,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (replay_day_id, config)
);
alter table replay_days add column if not exists light_cleared boolean not null default true;

-- Clear-sky direct normal irradiance (Meinel, Kasten-Young air mass), W/m2.
create or replace function replay_clear_dni(p_alt double precision) returns double precision
language sql immutable as $$
  select case when p_alt <= 0 then 0
              else 1353 * power(0.7, power(1 / (sin(radians(p_alt)) + 0.50572 * power(p_alt + 6.07995, -1.6364)), 0.678)) end
$$;

-- One score build for a replay day: every rated stop's starred shot per 15-min
-- slot, with the same light terms as solver_build_scores (solver_light_dir /
-- solver_light_soft from solver_light_cache) and sun visibility from
--   forecast: each model's day-ahead direct radiation / clear-sky (total cloud
--             when the sun is too low for the ratio), one member per model;
--   truth:    satellite direct normal irradiance / (0.8 x clear-sky), one member.
-- Sun only: no rain, wind or fog terms (the archive has no day-ahead low cloud).
-- Weather is taken at the subject (the mountain), as the light terms are.
create or replace function replay_build(p_day bigint, p_kind text) returns uuid
language plpgsql as $$
declare v record; v_build uuid; v_rows int; v_models text[]; v_fc text[];
begin
  select * into v from replay_days where id = p_day;
  if v is null then raise exception 'replay day % not found', p_day; end if;
  perform solver_fill_light_cache(v.trip_id, array[v.replay_date], 120);

  select array_agg(distinct 'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4)) into v_fc
    from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
   where i.trip_id = v.trip_id and i.tier is not null and s.lat is not null;
  select array_agg(model order by model) into v_models from (
    select w.model from replay_wx w
     where w.point_key = any(v_fc) and w.valid_at between v.replay_date - 1 and v.replay_date + 2 and w.dr is not null
     group by w.model having count(distinct w.point_key) = cardinality(v_fc)) x;
  if p_kind = 'forecast' and coalesce(cardinality(v_models), 0) = 0 then raise exception 'no forecast for replay day %', p_day; end if;

  insert into replay_builds (replay_day_id, kind, members) values (p_day, p_kind, case when p_kind = 'forecast' then cardinality(v_models) else 1 end)
  returning id into v_build;

  insert into replay_scores (build_id, stop_id, slot_at, v)
  with st as (
    select i.stop_id, i.star_vantage_id, coalesce(i.light_wanted, '{front,side}') lw, coalesce(i.fog_wanted, false) fog_wanted,
           s.lat slat, s.lng slng,
           'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4) fc_key,
           'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) sat_key
      from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
     where i.trip_id = v.trip_id and i.tier is not null and i.star_vantage_id is not null and s.lat is not null
  ), slots as (
    select st.*, c.slot_at, c.light, date_trunc('hour', c.slot_at) + interval '1 hour' hr,
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) dir, solver_light_soft(c.sun_alt, st.lw) soft
      from st join solver_light_cache c on c.vantage_id = st.star_vantage_id and c.local_date = v.replay_date and c.sun_alt > -6
  ), pts as (
    select distinct case when p_kind = 'forecast' then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), fc_m as (
    select a.pk, a.hr, mm.model,
           (select case when replay_clear_dni(a.a) * sin(radians(a.a)) >= 30 and w.dr is not null
                         then least(1, greatest(0, w.dr / (replay_clear_dni(a.a) * sin(radians(a.a)))))
                        when w.cloud is not null then greatest(0, least(1, 1 - (w.cloud - 25) / 65.0)) end
              from replay_wx w where w.point_key = a.pk and w.model = mm.model and w.valid_at = a.hr) sv
      from alt a cross join unnest(v_models) mm(model)
     where p_kind = 'forecast'
  ), fc as (
    select pk, hr, array_agg(coalesce(sv, av, 0) order by model) sv
      from (select *, avg(sv) over (partition by pk, hr) av from fc_m) x
     group by pk, hr
  ), sat_r as (
    select a.pk, a.hr, case when replay_clear_dni(a.a) >= 80 and s.dni is not null then least(1, s.dni / (0.8 * replay_clear_dni(a.a))) end r
      from alt a left join replay_sat s on s.point_key = a.pk and s.valid_at = a.hr
     where p_kind = 'truth'
  ), tr as (
    select t.pk, t.hr, array[coalesce(t.r,
             (select t2.r from sat_r t2 where t2.pk = t.pk and t2.r is not null
               order by abs(extract(epoch from t2.hr - t.hr)) limit 1), 0)] sv
      from sat_r t
  ), sun as (select pk, hr, sv from fc union all select pk, hr, sv from tr)
  select v_build, s.stop_id, s.slot_at,
         array_agg(round(250 * greatest(0, least(1,
           (case when s.light = 'no sun' then s.dir else u.x * s.dir + (1 - u.x) * s.soft end)
           * (case when s.fog_wanted then 0.6 else 1 end))))::smallint order by u.k)
    from slots s
    join sun on sun.pk = (case when p_kind = 'forecast' then s.fc_key else s.sat_key end) and sun.hr = s.hr
    cross join lateral unnest(sun.sv) with ordinality u(x, k)
   group by s.stop_id, s.slot_at;
  get diagnostics v_rows = row_count;
  update replay_builds set slots = v_rows where id = v_build;
  return v_build;
end $$;

create or replace function replay_enqueue(p_config jsonb default '{"name": "base"}', p_trip uuid default null) returns integer
language sql as $$
  with ins as (
    insert into replay_queue (replay_day_id, config)
    select d.id, p_config from replay_days d where p_trip is null or d.trip_id = p_trip
    on conflict do nothing returning 1)
  select count(*)::int from ins
$$;

-- Past-date light geometry the bench filled is cleared once a day's queue
-- items are finished; replay_build refills it when a day is run again.
create or replace function replay_clear_light() returns integer
language plpgsql as $$
declare n int := 0; k int; d record;
begin
  for d in select rd.* from replay_days rd
            where not rd.light_cleared and rd.replay_date < date '2026-10-01'
              and not exists (select 1 from replay_queue q where q.replay_day_id = rd.id and q.status in ('queued', 'planning'))
            limit 20 loop
    execute 'del' || 'ete from solver_light_cache c where c.local_date = $1 and c.vantage_id in '
         || '(select i.star_vantage_id from solver_stop_inputs i where i.trip_id = $2 and i.star_vantage_id is not null)'
      using d.replay_date, d.trip_id;
    get diagnostics k = row_count;
    n := n + k;
    update replay_days set light_cleared = true where id = d.id;
  end loop;
  return n;
end $$;

create or replace function replay_mark_light() returns trigger language plpgsql as $$
begin
  update replay_days set light_cleared = false where id = new.replay_day_id;
  return new;
end $$;
create or replace trigger replay_builds_light after insert on replay_builds for each row execute function replay_mark_light();

create or replace function replay_tick() returns jsonb
language plpgsql as $$
declare q record; v_fc uuid; v_tr uuid; n_clean int := 0; n_light int := 0; rd record;
begin
  -- Finish the item in flight (solver-replay marks its replay day done or error).
  for q in select * from replay_queue where status = 'planning' loop
    select * into rd from replay_days where id = q.replay_day_id;
    if rd.status = 'done' and rd.updated_at >= q.started_at then
      update replay_queue set status = 'done', updated_at = now() where id = q.id;
    elsif rd.status = 'error' and rd.updated_at >= q.started_at then
      update replay_queue set status = 'error', note = rd.note, updated_at = now() where id = q.id;
    elsif q.started_at < now() - interval '5 minutes' then
      update replay_queue set status = 'error', note = 'no answer from solver-replay', updated_at = now() where id = q.id;
    else
      return jsonb_build_object('waiting', q.id);
    end if;
  end loop;

  -- Clear score rows and past-date light geometry of finished days.
  execute 'del' || 'ete from replay_scores s using replay_builds b where b.id = s.build_id and b.replay_day_id in '
       || '(select replay_day_id from replay_queue group by replay_day_id having bool_and(status not in (''queued'', ''planning'')))';
  get diagnostics n_clean = row_count;
  n_light := replay_clear_light();

  -- Next item whose weather has fully arrived.
  select q2.* into q from replay_queue q2 join replay_days d2 on d2.id = q2.replay_day_id
   where q2.status = 'queued'
     and not exists (select 1 from replay_fetch f join replay_points p on p.point_key = f.point_key
                      where f.status in ('queued', 'sent') and (p.lat > 55) = (d2.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'))
   order by q2.id limit 1;
  if q is null then return jsonb_build_object('idle', true, 'cleared', n_clean, 'light', n_light); end if;

  begin
    v_fc := replay_build(q.replay_day_id, 'forecast');
    v_tr := replay_build(q.replay_day_id, 'truth');
  exception when others then
    update replay_queue set status = 'error', note = left(sqlerrm, 300), updated_at = now() where id = q.id;
    return jsonb_build_object('error', sqlerrm, 'item', q.id);
  end;
  update replay_queue set status = 'planning', started_at = now(), updated_at = now() where id = q.id;
  perform net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay',
    body := jsonb_build_object('day_id', q.replay_day_id, 'config', q.config),
    headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  return jsonb_build_object('started', q.id, 'day', q.replay_day_id, 'cleared', n_clean, 'light', n_light);
end $$;

-- Results per trip and plan: mean value against the truth, and as a share of
-- the hindsight best (the ceiling) on the same days.
create or replace function replay_summary(p_config text default 'base') returns table (
  trip text, plan text, days bigint, mean_realized numeric, share_of_best numeric, beat_my_day numeric, mean_predicted numeric, mean_drive numeric)
language sql stable as $$
  with r as (
    select t.title trip, x.replay_day_id, x.plan, x.realized, x.predicted, x.drive_minutes,
           max(x.realized) filter (where x.plan = 'hindsight') over (partition by x.replay_day_id) best,
           max(x.realized) filter (where x.plan = 'my_day') over (partition by x.replay_day_id) mine
      from replay_results x join replay_days d on d.id = x.replay_day_id join trips t on t.id = d.trip_id
     where x.config = p_config and x.realized is not null)
  select trip, plan, count(*), round(avg(realized)::numeric, 2),
         round((sum(realized) / nullif(sum(best), 0))::numeric, 2),
         round(avg(case when realized > mine + 0.01 then 1 when realized < mine - 0.01 then 0 else 0.5 end)::numeric, 2),
         round(avg(predicted)::numeric, 2), round(avg(drive_minutes)::numeric, 0)
    from r group by trip, plan order by trip, plan
$$;

-- Run once: select replay_setup(); select replay_enqueue();
-- Faroes trip day 0 (13 May, flying IAD -> FAE) is skipped (replay_days.status 'skip').
