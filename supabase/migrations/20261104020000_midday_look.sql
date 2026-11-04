-- Midday re-plan (Phil, 4 Nov 2026: "do all of them"; planner version AF testing).
-- T re-plans the day at the morning look (30 min before sunrise) from the latest report on the
-- peaks. This adds a second look at local noon: the report in the hour before noon re-conditions
-- the hidden-peaks odds for every slot from 13:00 (replay_morning_counts / replay_morning_fit
-- lk 1, leave-one-season-out like the morning fit), and solver-replay (run config midday, v62)
-- re-plans the afternoon from where the morning plan is at noon. Bench only: replay_build kinds
-- 'midday' / 'middayf' (the morning build's models), built by replay_run_tick for runs with
-- midday on. Morning rows are lk 0 and unchanged.
alter table public.replay_morning_counts add column if not exists lk smallint not null default 0;

create or replace view public.replay_morning_fit as
WITH g AS (
         SELECT c.trip_id,
            c.mg,
            c.lk,
            min(c.season) AS lo,
            max(c.season) AS hi
           FROM replay_morning_counts c
          GROUP BY c.trip_id, c.mg, c.lk
        ), s AS (
         SELECT g.trip_id,
            g.mg,
            g.lk,
            generate_series(g.lo, GREATEST(g.hi, ((EXTRACT(year FROM CURRENT_DATE))::integer + 1))) AS season
           FROM g
        ), agg AS (
         SELECT s.trip_id,
            s.season,
            s.mg,
            s.lk,
            c.model,
            c.m8,
            c.bin,
            sum(c.n) AS n,
            sum(c.hits) AS hits
           FROM (s
             JOIN replay_morning_counts c ON (((c.trip_id = s.trip_id) AND (c.mg = s.mg) AND (c.lk = s.lk) AND (c.season <> s.season))))
          GROUP BY s.trip_id, s.season, s.mg, s.lk, c.model, c.m8, c.bin
        ), base AS (
         SELECT agg.trip_id,
            agg.season,
            agg.mg,
            agg.lk,
            agg.model,
            agg.m8,
            ((sum(agg.hits))::real / (NULLIF(sum(agg.n), (0)::numeric))::double precision) AS p0
           FROM agg
          GROUP BY agg.trip_id, agg.season, agg.mg, agg.lk, agg.model, agg.m8
        )
 SELECT a.trip_id,
    a.season,
    a.model,
    a.m8,
    a.bin,
    a.n,
    ((((a.hits)::double precision + ((2)::double precision * b.p0)) / ((a.n + 2))::double precision))::real AS p,
    a.mg,
    a.lk
   FROM (agg a
     JOIN base b USING (trip_id, season, mg, lk, model, m8));

CREATE OR REPLACE FUNCTION public.replay_fit_morning()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare n int;
begin
  truncate replay_morning_counts;
  insert into replay_morning_counts (trip_id, season, model, m8, bin, n, hits, mg, lk)
  with tr as materialized (
    -- Every report on a forecast day (the view is costly: read it once).
    select p.trip_id, t.timezone tz, o.hr, o.hidden, (o.hr at time zone t.timezone)::date ld, s.lat, s.lng
      from replay_places p
      join trips t on t.id = p.trip_id
      join replay_hidden_truth o on o.trip_id = p.trip_id
      join metar_stations s on s.icao = p.station
     where o.hr < timestamptz '2026-06-30'  -- new-data test weeks stay out of training
       and exists (select 1 from replay_wx_day w where w.point_key = p.fc_point and w.day = (o.hr at time zone 'UTC')::date)
  ), hrs as (
    select distinct trip_id, tz, hr, hidden, ld from tr
     where (select sp.altitude from sun_position(tr.hr, tr.lat, tr.lng) sp) > 0
  ), days as materialized (
    -- Once per day (inlined, the look was recomputed for every joined row: 10+ min).
    -- lk 0 = the morning look (30 min before sunrise), lk 1 = the midday look (local noon, 4 Nov 2026).
    select d.trip_id, d.ld, 0::smallint lk, replay_look_at(d.trip_id, d.ld) look from (select distinct trip_id, ld from hrs) d
    union all
    select d.trip_id, d.ld, 1::smallint, (d.ld + time '12:00') at time zone d.tz from (select distinct trip_id, tz, ld from hrs) d
  ), looks as materialized (
    select d.trip_id, d.ld, d.lk, d.look,
           (select o.hidden from tr o
             where o.trip_id = d.trip_id and o.hr between d.look - interval '1 hour' and d.look
             order by o.hr desc limit 1) m8
      from days d
  )
  select h.trip_id, replay_season((h.hr at time zone 'UTC')::date), w.model, l.m8,
         replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]), count(*), sum(h.hidden), replay_month_group((h.hr at time zone 'UTC')::date), l.lk
    from hrs h
    join looks l on l.trip_id = h.trip_id and l.ld = h.ld and l.m8 is not null
    join replay_places p on p.trip_id = h.trip_id
    join replay_wx_day w on w.point_key = p.fc_point and w.day = (h.hr at time zone 'UTC')::date
   where h.hr >= l.look + interval '1 hour'
     and w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
     and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = w.day)
   group by 1, 2, 3, 4, 5, 8, 9;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.replay_build(p_day bigint, p_kind text, p_lead integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare v record; v_build uuid; v_rows int; v_models text[]; v_fc text[]; v_season int; v_fit jsonb; v_sfit jsonb; v_mfit jsonb; v_m8 int; v_tz text; v_look timestamptz;
  v_lead int := p_lead % 10; v_cal boolean := (p_lead % 20) >= 10; v_wx boolean := (p_lead % 40) >= 20; v_xm text[];
  v_learn boolean := p_lead >= 40; v_mg smallint := 0; v_mmg smallint := 0; v_ltz text; v_fcp text; v_lk smallint := case when p_kind in ('midday', 'middayf') then 1 else 0 end; v_slat double precision; v_slng double precision;
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
  if p_kind in ('morningf', 'middayf')
     and (select count(distinct w.point_key) from replay_wx_day w
           where w.point_key = any(v_fc) and w.model = 'ecmwf_ifs@f' and w.day = v.replay_date) = cardinality(v_fc) then
    v_models := array_replace(v_models, 'ecmwf_ifs025', 'ecmwf_ifs@f');
  end if;
  if p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf') and coalesce(cardinality(v_models), 0) = 0 then
    raise exception 'no lead % forecast for replay day %', p_lead, p_day;
  end if;
  v_xm := case when p_kind = 'truth' then array['era5'] else array_replace(v_models, 'ecmwf_ifs@f', 'ecmwf_ifs025') end;
  if v_wx and v.replay_date < current_date - 7 and p_kind <> 'truth'
     and not exists (select 1 from replay_wx_x x where x.point_key = any(v_fc) and x.model = any(v_xm) and x.day = v.replay_date) then
    raise exception 'no rain / wind data for replay day %', p_day;
  end if;
  -- Month group (3 Nov 2026): the day's own group when it has a fit, else group 0.
  v_mg := replay_month_group(v.replay_date);
  if v_mg <> 0 and not exists (select 1 from replay_hidden_fit where trip_id = v.trip_id and season = v_season and mg = v_mg) then v_mg := 0; end if;
  v_mmg := replay_month_group(v.replay_date);
  if v_mmg <> 0 and not exists (select 1 from replay_morning_fit where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_lk) then v_mmg := 0; end if;
  select jsonb_object_agg(model, ps) into v_fit from (
    select model, jsonb_agg(p order by bin) ps from replay_hidden_fit
     where trip_id = v.trip_id and season = v_season and mg = v_mg group by model having count(*) = 5) f;
  if v_learn and p_kind = 'forecast' then
    select coalesce(t.timezone, 'UTC'), p.fc_point, s.lat, s.lng into v_ltz, v_fcp, v_slat, v_slng
      from replay_places p join metar_stations s on s.icao = p.station join trips t on t.id = p.trip_id
     where p.trip_id = v.trip_id limit 1;
    select jsonb_object_agg(model, ps) into v_fit from (
      select f.model, jsonb_agg(case when r.n is null then f.p
                                     else ((least(f.n, 100)::double precision * f.p + r.hits) / (least(f.n, 100)::double precision + r.n))::real end
                                order by f.bin) ps
        from replay_hidden_fit f
        left join (
          select w.model, replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]) bin,
                 count(*)::double precision n, sum(h.hidden)::double precision hits
            from (select distinct o.hr, o.hidden
                    from replay_hidden_truth o
                   where o.trip_id = v.trip_id
                     and o.hr >= ((v.replay_date - 30)::timestamp at time zone v_ltz)
                     and o.hr < (v.replay_date::timestamp at time zone v_ltz)
                     and replay_season((o.hr at time zone 'UTC')::date) = v_season
                     and (select sp.altitude from sun_position(o.hr, v_slat, v_slng) sp) > 0) h
            join replay_wx_day w on w.point_key = v_fcp and w.day = (h.hr at time zone 'UTC')::date
           where w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
             and not exists (select 1 from replay_model_dups dm where dm.point_key = w.point_key and dm.model = w.model and dm.day = w.day)
           group by 1, 2) r on r.model = f.model and r.bin = f.bin
       where f.trip_id = v.trip_id and f.season = v_season and f.mg = v_mg
       group by f.model having count(*) = 5) x;
  end if;
  if p_kind in ('morning', 'morningf', 'midday', 'middayf') then
    select coalesce(timezone, 'UTC') into v_tz from trips where id = v.trip_id;
    -- Midday re-plan (4 Nov 2026): the look is at local noon, with its own fit (lk 1).
    v_look := case when v_lk = 1 then (v.replay_date + time '12:00') at time zone v_tz else replay_look_at(v.trip_id, v.replay_date) end;
    select o.hidden into v_m8 from replay_hidden_truth o
     where o.trip_id = v.trip_id
       and o.hr between v_look - interval '1 hour' and v_look
     order by o.hr desc limit 1;
    select jsonb_object_agg(model, ps) into v_mfit from (
      select model, jsonb_object_agg(m8::text, bs) ps from (
        select model, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
         where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_lk group by model, m8) a group by model) f;
  end if;
  if v_cal then
    select jsonb_object_agg(model, ps) into v_sfit from (
      select model, jsonb_object_agg(bin::text, p) ps from replay_sun_fit
       where trip_id = v.trip_id and season = v_season group by model) f;
  end if;

  insert into replay_builds (replay_day_id, kind, lead, members)
  values (p_day, p_kind,
          case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf') then p_lead when v_wx then 20 else 0 end,
          case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf') then cardinality(v_models) else 1 end)
  returning id into v_build;

  insert into replay_scores_c (build_id, stop_id, t0, offs, v)
  with st as (
    select i.stop_id, i.star_vantage_id, coalesce(i.light_wanted, '{front,side}') lw, coalesce(i.fog_wanted, false) fog_wanted,
           coalesce(i.rain_bonus, false) rain_bonus, s.lat slat, s.lng slng,
           'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4) fc_key,
           'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) sat_key
      from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
     where i.trip_id = v.trip_id and i.tier is not null and i.star_vantage_id is not null and s.lat is not null
  ), slots as (
    select st.*, c.slot_at, c.light, date_trunc('hour', c.slot_at) + interval '1 hour' hr, date_trunc('hour', c.slot_at) obs_hr,
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) dir, solver_light_soft(c.sun_alt, st.lw) soft
      from st join solver_light_cache c on c.vantage_id = st.star_vantage_id and c.local_date = v.replay_date and c.sun_alt > -6
  ), pts as (
    select distinct case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf') then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), fc_m as (
    select a.pk, a.hr, mm.model,
           case when v_cal and x.sv is not null
                then coalesce((v_sfit -> mm.model ->> replay_sv_bin(x.sv)::text)::real, x.sv) else x.sv end sv,
           coalesce(case when p_kind in ('morning', 'morningf', 'midday', 'middayf') and v_m8 is not null and a.hr >= v_look + interval '1 hour'
                         then (v_mfit -> mm.model -> v_m8::text ->> replay_cloud_bin(x.cloud)::text)::real end,
                    (v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,
                    case when x.cloud is null then null else greatest(0, least(1, (x.cloud - 70) / 30.0)) end) ph
      from alt a cross join unnest(v_models) mm(model)
      cross join lateral (
        select w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] cloud,
               replay_fc_sv(w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1], w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1], a.a) sv
          from (select 1) one
          left join replay_wx_day w on w.point_key = a.pk
                 and w.model = case when mm.model = 'ecmwf_ifs@f' and (a.hr at time zone 'UTC')::date > v.replay_date then 'ecmwf_ifs@f1' else mm.model end
                 and w.day = (a.hr at time zone 'UTC')::date) x
     where p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf')
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
    select s.obs_hr, (select o.hidden from replay_hidden_truth o
                       where o.trip_id = v.trip_id and o.hr between s.obs_hr - interval '2 hours' and s.obs_hr + interval '2 hours'
                       order by abs(extract(epoch from o.hr - s.obs_hr)) limit 1) hidden
      from (select distinct obs_hr from slots) s
     where p_kind = 'truth'
  ), wx_m as (
    select f.fk, f.hr, m.k,
           (select x.precip[extract(hour from f.hr at time zone 'UTC')::int + 1] from replay_wx_x x
             where x.point_key = f.fk and x.model = m.xm and x.day = (f.hr at time zone 'UTC')::date) pr,
           (select x.gust[extract(hour from f.hr at time zone 'UTC')::int + 1] from replay_wx_x x
             where x.point_key = f.fk and x.model = m.xm and x.day = (f.hr at time zone 'UTC')::date) gu,
           (select sum(q.p) from replay_wx_x x cross join lateral unnest(x.precip) with ordinality q(p, i)
             where x.point_key = f.fk and x.model = m.xm and x.day between (f.hr at time zone 'UTC')::date - 1 and (f.hr at time zone 'UTC')::date
               and x.day + (q.i - 1) * interval '1 hour' > (f.hr at time zone 'UTC') - interval '24 hours'
               and x.day + (q.i - 1) * interval '1 hour' <= (f.hr at time zone 'UTC')) r24
      from (select distinct fc_key fk, hr from slots) f
      cross join unnest(v_xm) with ordinality m(xm, k)
     where v_wx
  ), wx as (
    select fk, hr, k,
           1 - 0.8 * least(coalesce(pr, apr, 0) / 1.5, 1) rain_f,
           case when coalesce(gu, agu, 0) <= 35 then 1.0 else greatest(0.2, 1 - (coalesce(gu, agu) - 35) / 45.0) end wind_f,
           coalesce(r24, ar24, 0) r24
      from (select *, avg(pr) over (partition by fk, hr) apr, avg(gu) over (partition by fk, hr) agu,
                   avg(r24) over (partition by fk, hr) ar24 from wx_m) z
  ), per_slot as (
    select s.stop_id, s.slot_at,
           array_agg(round(250 * greatest(0, least(1,
             (case when s.light = 'no sun' then s.dir else u.x * s.dir + (1 - u.x) * s.soft end)
             * (case when s.fog_wanted then 0.6 + 0.4 * u.h else 1 - 0.9 * u.h end)
             * coalesce(w.rain_f * w.wind_f * (case when s.rain_bonus then 1 + 0.3 * least(w.r24 / 10.0, 1) else 1 end), 1))))::smallint order by u.k) vals
      from slots s
      join sun on sun.pk = (case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf') then s.fc_key else s.sat_key end) and sun.hr = s.hr
      left join obs on obs.obs_hr = s.obs_hr
      cross join lateral (
        select x, coalesce(case when p_kind = 'truth' then obs.hidden::real else hh end, 0) h, k
          from unnest(sun.sv, coalesce(sun.ph, array[null::real])) with ordinality q(x, hh, k)) u
      left join wx w on v_wx and w.fk = s.fc_key and w.hr = s.hr and w.k = u.k
     group by s.stop_id, s.slot_at
  ), first_slot as (select *, min(slot_at) over (partition by stop_id) t0 from per_slot)
  select v_build, stop_id, t0, array_agg((extract(epoch from slot_at - t0) / 900)::smallint order by slot_at),
         array_agg(vals order by slot_at)
    from first_slot group by stop_id, t0;
  get diagnostics v_rows = row_count;
  update replay_builds set slots = v_rows where id = v_build;
  return v_build;
end $function$;

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
         || 'and d.trip_id = $1 and b.created_at < (select pl.fitted_at from replay_places pl where pl.trip_id = $1)' using r.trip_id, r.lo;
    get diagnostics k = row_count; v_cleared := v_cleared + k;
    execute 'del' || 'ete from replay_builds b using replay_days d where d.id = b.replay_day_id '
         || 'and d.trip_id = $1 and b.created_at < (select pl.fitted_at from replay_places pl where pl.trip_id = $1)' using r.trip_id, r.lo;
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
             + case when coalesce((r.config ->> 'learn')::boolean, false) then 40 else 0 end;
        if not coalesce((r.config ->> 'draft')::boolean, false) and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'forecast' and lead = v_l) then
          perform replay_build(v_day, 'forecast', v_l); v_built := v_built + 1;
        end if;
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and (not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'morning' and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end) then
          perform replay_build(v_day, 'morning', 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end); v_built := v_built + 1;
        end if;
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'morning_fresh')::boolean, false)
           and (not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'morningf' and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end) then
          perform replay_build(v_day, 'morningf', 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end); v_built := v_built + 1;
        end if;
        -- Midday re-plan (run config midday, bench only, 4 Nov 2026): the noon look's build.
        if i = r.night and not v_live and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'midday')::boolean, false)
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'middayf' else 'midday' end
                             and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end) then
          perform replay_build(v_day, case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'middayf' else 'midday' end,
                               1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end); v_built := v_built + 1;
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
