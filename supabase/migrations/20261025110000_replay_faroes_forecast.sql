-- Planner test bench, part 8: better Faroes forecasts (Phil, 25 Oct 2026: "Do
-- it now"). In the Faroes perfect knowledge of the weather is worth ~5 good
-- shots a trip over the planner, so two cheap ideas are tested there on the
-- 33 replayed trips, tomorrow-only plans (kind fc1), against the base runs:
--   calsun   each model's sun corrected against the satellite record: the
--            forecast sun fraction is binned and replaced by what the
--            satellite saw in that bin, per model and lead, fitted on the
--            other seasons (replay_sun_fit, like replay_hidden_fit)
--   morning  the next day planned on the newest model run instead of the run
--            a day earlier (lead 0: Previous Runs API without _previous_dayN).
--            Lead 0 is the run nearest each hour, so this is an upper bound
--            on re-planning as the day goes, not just a breakfast re-plan.
--   morning_calsun  both.
-- Builds: lead 0 = newest run; lead + 10 = calibrated sun (replay_build).
-- Run config: kinds (plans to run), day1_lead, calsun (solver-replay reads
-- the same keys). Nothing here touches the live planner.

-- Lead-0 forecasts for the Faroes points (one request per point, model, May).
insert into replay_fetch (kind, model, point_key, start_date, end_date, status, tries)
select f.kind, f.model || '@0', f.point_key, f.start_date, f.end_date, 'queued', 0
  from replay_fetch f join replay_points p on p.point_key = f.point_key
 where f.kind <> 'sat' and f.model not like '%@%' and p.lat > 55
   and not exists (select 1 from replay_fetch g where g.model = f.model || '@0' and g.point_key = f.point_key and g.start_date = f.start_date);

create or replace function replay_fetch_tick() returns jsonb
language plpgsql as $$
declare r record; c jsonb; n_done int := 0; n_sent int := 0; v_url text; p record; ld int; v_base text; v_dr text; v_cl text;
begin
  -- Collect what came back.
  for r in select f.*, h.status_code, h.content, h.timed_out, h.error_msg
             from replay_fetch f left join net._http_response h on h.id = f.req_id
            where f.status = 'sent' loop
    if r.status_code is null and coalesce(r.timed_out, false) is false and r.error_msg is null then
      if r.updated_at < now() - interval '10 minutes' then
        update replay_fetch set status = 'queued', tries = tries + 1, note = 'no response', updated_at = now() where id = r.id;
      end if;
      continue;
    end if;
    if r.status_code = 200 then
      c := r.content::jsonb;
      if r.kind = 'sat' then
        insert into replay_sat_day (point_key, day, dni)
        select r.point_key, (t.v #>> '{}')::timestamp::date, array_agg((x.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'direct_normal_irradiance') with ordinality x(v, j) on x.j = t.i
         group by 2 having count(*) = 24
        on conflict do nothing;
      else
        -- model 'x' = day-ahead (lead 1); 'x@23' = made 2 and 3 days ahead, stored as 'x@2', 'x@3';
        -- 'x@0' = the newest run (no _previous_day suffix).
        v_base := split_part(r.model, '@', 1);
        for ld in select unnest(case when r.model like '%@23' then array[2, 3] when r.model like '%@0' then array[0] else array[1] end) loop
          v_dr := case when ld = 0 then 'direct_radiation' else 'direct_radiation_previous_day' || ld end;
          v_cl := case when ld = 0 then 'cloud_cover' else 'cloud_cover_previous_day' || ld end;
          insert into replay_wx_day (point_key, model, day, dr, cloud)
          select r.point_key, v_base || case when ld = 1 then '' else '@' || ld end, (t.v #>> '{}')::timestamp::date,
                 array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i)
            from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
            join jsonb_array_elements(c->'hourly'->v_dr) with ordinality a(v, j) on a.j = t.i
            join jsonb_array_elements(c->'hourly'->v_cl) with ordinality b(v, k) on b.k = t.i
           group by 3
          having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)
          on conflict do nothing;
        end loop;
      end if;
      update replay_fetch set status = 'done', updated_at = now() where id = r.id;
      n_done := n_done + 1;
    elsif (r.status_code = 429 or r.timed_out or r.error_msg is not null) and r.tries < 6 then
      update replay_fetch set status = 'queued', tries = tries + 1, note = coalesce(r.error_msg, 'http ' || r.status_code), updated_at = now() where id = r.id;
    else
      update replay_fetch set status = 'failed', note = left(coalesce(r.content, r.error_msg, 'http ' || r.status_code), 200), updated_at = now() where id = r.id;
    end if;
  end loop;

  -- Send the next three (Open-Meteo returns 429 when too many run at once).
  for r in select * from replay_fetch where status = 'queued' order by tries, id limit 3 loop
    select * into p from replay_points where point_key = r.point_key;
    v_url := case when r.kind = 'sat'
      then 'https://satellite-api.open-meteo.com/v1/archive?hourly=direct_normal_irradiance'
      when r.model like '%@23'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day2,cloud_cover_previous_day2,direct_radiation_previous_day3,cloud_cover_previous_day3&models=' || split_part(r.model, '@', 1)
      when r.model like '%@0'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&models=' || split_part(r.model, '@', 1)
      else 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day1,cloud_cover_previous_day1&models=' || r.model end
      || '&latitude=' || p.lat || '&longitude=' || p.lng || '&start_date=' || r.start_date || '&end_date=' || r.end_date || '&timezone=UTC';
    update replay_fetch set req_id = net.http_get(v_url, timeout_milliseconds := 30000), status = 'sent', updated_at = now() where id = r.id;
    n_sent := n_sent + 1;
  end loop;

  if not exists (select 1 from replay_fetch where status in ('queued', 'sent')) then
    perform cron.unschedule('replay-fetch');
  end if;
  return jsonb_build_object('parsed', n_done, 'sent', n_sent);
end $$;

-- Sun fraction bins for the calibration.
create or replace function replay_sv_bin(p_sv real) returns integer language sql immutable as $$
  select case when p_sv < 0.1 then 1 when p_sv < 0.3 then 2 when p_sv < 0.5 then 3 when p_sv < 0.7 then 4 when p_sv < 0.9 then 5 else 6 end
$$;

-- The forecast sun fraction exactly as replay_build computes it.
create or replace function replay_fc_sv(p_dr real, p_cloud real, p_alt double precision) returns real language sql immutable as $$
  select (case when replay_clear_dni(p_alt) * sin(radians(p_alt)) >= 30 and p_dr is not null
               then least(1, greatest(0, p_dr / (replay_clear_dni(p_alt) * sin(radians(p_alt)))))
               when p_cloud is not null then greatest(0, least(1, 1 - (p_cloud - 25) / 65.0)) end)::real
$$;

create table if not exists replay_sun_counts (
  trip_id uuid not null, season integer not null, model text not null, bin integer not null,
  n integer not null, sum_r real not null,
  primary key (trip_id, season, model, bin));

-- Every daylight hour at each rated stop's subject (satellite cell) with a
-- satellite reading: the model's sun fraction at the stop's forecast cell vs
-- the satellite's (DNI over 0.8 x clear-sky, as in truth builds).
create or replace function replay_fit_sun() returns integer
language plpgsql as $$
declare n int;
begin
  execute 'trunc' || 'ate replay_sun_counts';
  insert into replay_sun_counts (trip_id, season, model, bin, n, sum_r)
  with st as (
    select i.trip_id,
           'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4) fc_key,
           'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) sat_key,
           avg(s.lat) slat, avg(s.lng) slng
      from replay_places pl
      join solver_stop_inputs i on i.trip_id = pl.trip_id
      join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
     where i.tier is not null and s.lat is not null
     group by 1, 2, 3
  ), hrs as (
    select st.trip_id, st.fc_key, st.sat_key, d.day, h, sd.dni[h + 1] dni,
           (select sp.altitude from sun_position(((d.day + make_interval(hours => h))::timestamp at time zone 'UTC') - interval '30 minutes', st.slat, st.slng) sp) a
      from st
      join (select distinct point_key, day from replay_wx_day) d on d.point_key = st.fc_key
      join replay_sat_day sd on sd.point_key = st.sat_key and sd.day = d.day
      cross join generate_series(0, 23) h
     where sd.dni[h + 1] is not null
  ), tr as (
    select hrs.*, least(1, dni / (0.8 * replay_clear_dni(a)))::real r from hrs where replay_clear_dni(a) >= 80
  )
  select tr.trip_id, replay_season(tr.day), w.model, replay_sv_bin(x.sv), count(*), sum(tr.r)
    from tr
    join replay_wx_day w on w.point_key = tr.fc_key and w.day = tr.day
    cross join lateral (select replay_fc_sv(w.dr[tr.h + 1], w.cloud[tr.h + 1], tr.a) sv) x
   where x.sv is not null
     and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = w.day)
   group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end $$;

-- Observed sun fraction for a model, lead and bin, fitted on every season but
-- p_season (shrunk toward the bin's middle with 3 pseudo-hours).
create or replace view replay_sun_fit with (security_invoker = true) as
  with s as (select distinct trip_id, season from replay_sun_counts),
  agg as (
    select s.trip_id, s.season, c.model, c.bin, sum(c.n) n, sum(c.sum_r) sr
      from s join replay_sun_counts c on c.trip_id = s.trip_id and c.season <> s.season
     group by 1, 2, 3, 4)
  select trip_id, season, model, bin, n,
         ((sr + 3 * (array[0.05, 0.2, 0.4, 0.6, 0.8, 0.95])[bin]) / (n + 3))::real as p
    from agg;

-- Score builds: lead 0..3 = the run made that many days ahead (0 = newest);
-- lead + 10 = the same with each model's sun calibrated (replay_sun_fit).
create or replace function replay_build(p_day bigint, p_kind text, p_lead integer default 1) returns uuid
language plpgsql as $$
declare v record; v_build uuid; v_rows int; v_models text[]; v_fc text[]; v_season int; v_fit jsonb; v_sfit jsonb;
  v_lead int := p_lead % 10; v_cal boolean := p_lead >= 10;
begin
  select * into v from replay_days where id = p_day;
  if v is null then raise exception 'replay day % not found', p_day; end if;
  v_season := replay_season(v.replay_date);
  perform solver_fill_light_cache(v.trip_id, array[v.replay_date], 120);

  select array_agg(distinct 'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4)) into v_fc
    from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
   where i.trip_id = v.trip_id and i.tier is not null and s.lat is not null;
  select array_agg(model order by model) into v_models from (
    select w.model from replay_wx_day w
     where w.point_key = any(v_fc) and w.day between v.replay_date - 1 and v.replay_date + 1
       and (case when v_lead = 1 then w.model not like '%@%' else w.model like '%@' || v_lead end)
       and exists (select 1 from unnest(w.dr) x where x is not null)
       and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = v.replay_date)
     group by w.model having count(distinct w.point_key) = cardinality(v_fc)) x;
  if p_kind = 'forecast' and coalesce(cardinality(v_models), 0) = 0 then
    raise exception 'no lead % forecast for replay day %', p_lead, p_day;
  end if;
  -- {model: [p bin 1..5]} for this season (fitted on the others).
  select jsonb_object_agg(model, ps) into v_fit from (
    select model, jsonb_agg(p order by bin) ps from replay_hidden_fit
     where trip_id = v.trip_id and season = v_season group by model having count(*) = 5) f;
  -- {model: {bin: p}} sun calibration for this season (fitted on the others).
  if v_cal then
    select jsonb_object_agg(model, ps) into v_sfit from (
      select model, jsonb_object_agg(bin::text, p) ps from replay_sun_fit
       where trip_id = v.trip_id and season = v_season group by model) f;
  end if;

  insert into replay_builds (replay_day_id, kind, lead, members)
  values (p_day, p_kind, case when p_kind = 'forecast' then p_lead else 0 end, case when p_kind = 'forecast' then cardinality(v_models) else 1 end)
  returning id into v_build;

  insert into replay_scores_c (build_id, stop_id, t0, offs, v)
  with st as (
    select i.stop_id, i.star_vantage_id, coalesce(i.light_wanted, '{front,side}') lw, coalesce(i.fog_wanted, false) fog_wanted,
           s.lat slat, s.lng slng,
           'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4) fc_key,
           'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) sat_key
      from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
     where i.trip_id = v.trip_id and i.tier is not null and i.star_vantage_id is not null and s.lat is not null
  ), slots as (
    select st.*, c.slot_at, c.light, date_trunc('hour', c.slot_at) + interval '1 hour' hr, date_trunc('hour', c.slot_at) obs_hr,
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) dir, solver_light_soft(c.sun_alt, st.lw) soft
      from st join solver_light_cache c on c.vantage_id = st.star_vantage_id and c.local_date = v.replay_date and c.sun_alt > -6
  ), pts as (
    select distinct case when p_kind = 'forecast' then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), fc_m as (
    select a.pk, a.hr, mm.model,
           case when v_cal and x.sv is not null
                then coalesce((v_sfit -> mm.model ->> replay_sv_bin(x.sv)::text)::real, x.sv) else x.sv end sv,
           coalesce((v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,
                    case when x.cloud is null then null else greatest(0, least(1, (x.cloud - 70) / 30.0)) end) ph
      from alt a cross join unnest(v_models) mm(model)
      cross join lateral (
        select w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] cloud,
               replay_fc_sv(w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1], w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1], a.a) sv
          from (select 1) one
          left join replay_wx_day w on w.point_key = a.pk and w.model = mm.model and w.day = (a.hr at time zone 'UTC')::date) x
     where p_kind = 'forecast'
  ), fc as (
    select pk, hr, array_agg(coalesce(sv, av, 0) order by model) sv, array_agg(coalesce(ph, ah, 0) order by model) ph
      from (select *, avg(sv) over (partition by pk, hr) av, avg(ph) over (partition by pk, hr) ah from fc_m) x
     group by pk, hr
  ), sat_r as (
    select a.pk, a.hr,
           case when replay_clear_dni(a.a) >= 80 and s.dni[extract(hour from a.hr at time zone 'UTC')::int + 1] is not null
                then least(1, s.dni[extract(hour from a.hr at time zone 'UTC')::int + 1] / (0.8 * replay_clear_dni(a.a))) end r
      from alt a left join replay_sat_day s on s.point_key = a.pk and s.day = (a.hr at time zone 'UTC')::date
     where p_kind = 'truth'
  ), tr as (
    select t.pk, t.hr, array[coalesce(t.r,
             (select t2.r from sat_r t2 where t2.pk = t.pk and t2.r is not null
               order by abs(extract(epoch from t2.hr - t.hr)) limit 1), 0)] sv
      from sat_r t
  ), sun as (select pk, hr, sv, ph from fc union all select pk, hr, sv, null::real[] from tr),
  obs as (
    -- Truth: hidden as the airport (or the place's camera) reported that hour (nearest report within 2 h).
    select s.obs_hr, (select o.hidden from replay_hidden_truth o
                       where o.trip_id = v.trip_id and o.hr between s.obs_hr - interval '2 hours' and s.obs_hr + interval '2 hours'
                       order by abs(extract(epoch from o.hr - s.obs_hr)) limit 1) hidden
      from (select distinct obs_hr from slots) s
     where p_kind = 'truth'
  )
  , per_slot as (
    select s.stop_id, s.slot_at,
           array_agg(round(250 * greatest(0, least(1,
             (case when s.light = 'no sun' then s.dir else u.x * s.dir + (1 - u.x) * s.soft end)
             * (case when s.fog_wanted then 0.6 + 0.4 * u.h else 1 - 0.9 * u.h end))))::smallint order by u.k) vals
      from slots s
      join sun on sun.pk = (case when p_kind = 'forecast' then s.fc_key else s.sat_key end) and sun.hr = s.hr
      left join obs on obs.obs_hr = s.obs_hr
      cross join lateral (
        select x, coalesce(case when p_kind = 'truth' then obs.hidden::real else hh end, 0) h, k
          from unnest(sun.sv, coalesce(sun.ph, array[null::real])) with ordinality q(x, hh, k)) u
     group by s.stop_id, s.slot_at
  ), first_slot as (select *, min(slot_at) over (partition by stop_id) t0 from per_slot)
  -- One row per stop: slot offsets from t0 in 15 minutes, v[slot][member].
  select v_build, stop_id, t0, array_agg((extract(epoch from slot_at - t0) / 900)::smallint order by slot_at),
         array_agg(vals order by slot_at)
    from first_slot group by stop_id, t0;
  get diagnostics v_rows = row_count;
  update replay_builds set slots = v_rows where id = v_build;
  return v_build;
end $$;

-- Tick: per-run plans (config.kinds), forecast leads from the config, and a
-- run that doesn't use the newest runs doesn't wait for their download.
create or replace function replay_run_tick() returns jsonb
language plpgsql as $$
declare r record; v_day bigint; i int; v_started int := 0; v_built int := 0; v_cleared int := 0; k int; v_l int; v_hz int;
  v_slots int := 8; v_all text[] := array['fc3', 'fc1', 'lt3', 'hs3', 'my']; v_kinds text[];
  v_t0 timestamptz := clock_timestamp();
begin
  -- A plan with no answer in 5 minutes: once more, then the run stops with a note.
  update replay_run_state set status = case when note = 'retry' then 'error' else 'idle' end,
         note = case when note = 'retry' then 'no answer from solver-replay' else 'retry' end, updated_at = now()
   where status = 'planning' and started_at < now() - interval '5 minutes';
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

  -- Keep an eye on the database size (Phil): clean up always, start nothing new over 2 GB.
  if pg_database_size(current_database()) > 2048::bigint * 1024 * 1024 then
    return jsonb_build_object('paused', 'database over 2 GB', 'cleared', v_cleared);
  end if;

  -- Keep 8 runs going (oldest first).
  update replay_runs set status = 'running', updated_at = now()
   where id in (select id from replay_runs where status = 'queued' order by id
                 limit greatest(0, v_slots - (select count(*) from replay_runs where status = 'running')));
  insert into replay_run_state (run_id, kind, night)
  select rr.id, kk, rr.night from replay_runs rr
   cross join lateral unnest(case when rr.config ? 'kinds' then array(select jsonb_array_elements_text(rr.config -> 'kinds')) else v_all end) kk
   where rr.status = 'running'
  on conflict do nothing;

  -- Refit once a place's downloads have all arrived.
  if exists (select 1 from replay_places pl
              where (pl.fitted_at is null or pl.fitted_at < (select max(f.updated_at) from replay_fetch f join replay_points p on p.point_key = f.point_key
                                                             where f.status = 'done' and (p.lat > 55) = (pl.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')))
                and not exists (select 1 from replay_fetch f join replay_points p on p.point_key = f.point_key
                                 where f.status in ('queued', 'sent') and (p.lat > 55) = (pl.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'))) then
    perform replay_fit_hidden();
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
                           where f.status in ('queued', 'sent') and (p.lat > 55) = (r.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')
                             and (f.model not like '%@0' or r.config ->> 'day1_lead' = '0'));
    v_kinds := case when r.config ? 'kinds' then array(select jsonb_array_elements_text(r.config -> 'kinds')) else v_all end;
    v_hz := case when v_kinds && array['fc3', 'lt3', 'hs3'] then 2 else 0 end;
    begin
      for i in r.night .. least(r.night + v_hz, r.nights - 1) loop
        insert into replay_days (trip_id, replay_date, trip_date) values (r.trip_id, r.start_date + i, r.trip_dates[i + 1])
        on conflict do nothing;
        select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.start_date + i;
        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth') then
          perform replay_build(v_day, 'truth'); v_built := v_built + 1;
        end if;
        v_l := (case when i = r.night and r.config ? 'day1_lead' then (r.config ->> 'day1_lead')::int else i - r.night + 1 end)
             + case when coalesce((r.config ->> 'calsun')::boolean, false) then 10 else 0 end;
        if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then
          perform replay_build(v_day, 'forecast', v_l); v_built := v_built + 1;
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

-- The three Faroes tests (tomorrow-only plans).
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select r.trip_id, r.start_date, r.trip_dates, r.nights, c.cfg
  from replay_runs r
 cross join (values ('{"name": "calsun", "kinds": ["fc1"], "calsun": true}'::jsonb),
                    ('{"name": "morning", "kinds": ["fc1"], "day1_lead": 0}'::jsonb),
                    ('{"name": "morning_calsun", "kinds": ["fc1"], "day1_lead": 0, "calsun": true}'::jsonb)) c(cfg)
 where r.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and r.config ->> 'name' = 'base'
on conflict do nothing;

-- Run: select replay_fit_sun();  then
-- select cron.schedule('replay-fetch', '0-6,8-59 * * * *', 'select public.replay_fetch_tick();');
-- select cron.schedule('replay-run', '* * * * *', 'set statement_timeout = ''10min''; select public.replay_run_tick();');
