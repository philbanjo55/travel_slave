-- Re-plan now (Phil, 5 Nov 2026: "an async planner whenever, even mid day, and it pulls in the photos";
-- "from where the plan says"). The TEST app asks with planner_t_now(trip); the request grabs this hour's
-- camera pictures (webcam-archive, skipped when already taken), the tick waits for them, makes a build whose
-- look is now (kind 'now' / 'nowf': the cameras' majority + airport re-condition the odds from now on) and
-- sends solver-replay {now: true}, which re-plans the rest of today from today's plan as it stands
-- (replay_live_today: what is begun or left for by now is kept) and publishes 'T: re-plan now'.

create table if not exists replay_live_today (
  run_id bigint not null references replay_runs(id),
  kind text not null,
  replay_date date not null,
  step text,
  visits jsonb not null,
  units jsonb not null,
  mr jsonb,
  updated_at timestamptz not null default now(),
  primary key (run_id, kind, replay_date)
);

create table if not exists planner_t_now (
  id bigserial primary key,
  trip_id uuid not null,
  run_id bigint not null references replay_runs(id),
  night int not null,
  replay_date date not null,
  requested_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'planning', 'done', 'error')),
  planned_at timestamptz,
  build_id uuid,
  result jsonb,
  note text,
  done_at timestamptz
);
create index if not exists planner_t_now_trip on planner_t_now (trip_id, id desc);

alter table replay_builds drop constraint replay_builds_kind_check;
alter table replay_builds add constraint replay_builds_kind_check
  check (kind = any (array['forecast', 'truth', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf']));

-- The build gets an optional look time (p_look, Re-plan now): the old 3-argument version goes.
drop function if exists replay_build(bigint, text, integer);

CREATE OR REPLACE FUNCTION public.replay_build(p_day bigint, p_kind text, p_lead integer DEFAULT 1, p_look timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare v record; v_build uuid; v_rows int; v_models text[]; v_fc text[]; v_season int; v_fit jsonb; v_sfit jsonb; v_mfit jsonb; v_m8 int; v_tz text; v_look timestamptz;
  v_lead int := p_lead % 10; v_cal boolean := (p_lead % 20) >= 10; v_wx boolean := (p_lead % 40) >= 20; v_xm text[];
  v_learn boolean := (p_lead % 80) >= 40; v_fog boolean := (p_lead % 160) >= 80; v_ffit jsonb;
  v_fade boolean := (p_lead % 320) >= 160; v_sun boolean := p_lead >= 320; v_mfit2 jsonb; v_sbfit jsonb; v_ftz text; v_mg smallint := 0; v_mmg smallint := 0; v_ltz text; v_fcp text; v_lk smallint := case when p_kind in ('midday', 'middayf') then 1 when p_kind in ('early', 'earlyf') then 2
                       -- Re-plan now (5 Nov 2026): the early look's odds in the morning, the noon look's later.
                       when p_kind in ('now', 'nowf') then case when extract(hour from coalesce(p_look, now()) at time zone
                            (select coalesce(t.timezone, 'UTC') from replay_days d join trips t on t.id = d.trip_id where d.id = p_day)) < 11 then 2 else 1 end
                       else 0 end; v_tt jsonb;
  v_after interval := case when p_kind in ('now', 'nowf') then interval '0' else interval '1 hour' end; v_slat double precision; v_slng double precision;
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
  if p_kind in ('morningf', 'middayf', 'earlyf', 'nowf')
     and (select count(distinct w.point_key) from replay_wx_day w
           where w.point_key = any(v_fc) and w.model = 'ecmwf_ifs@f' and w.day = v.replay_date) = cardinality(v_fc) then
    v_models := array_replace(v_models, 'ecmwf_ifs025', 'ecmwf_ifs@f');
  end if;
  if p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') and coalesce(cardinality(v_models), 0) = 0 then
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
     where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = 0 group by model having count(*) = 5) f;
  -- Fog test (4 Nov 2026, lead + 80): slots before 10:00 local use the odds learned from those
  -- hours alone (valley inversion fog under a clear forecast); the rest as before.
  if v_fog then
    select coalesce(timezone, 'UTC') into v_ftz from trips where id = v.trip_id;
    select jsonb_object_agg(model, ps) into v_ffit from (
      select model, jsonb_agg(p order by bin) ps from replay_hidden_fit
       where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = 1 group by model having count(*) = 5) f;
  end if;
  -- Thin-cloud test (4 Nov 2026, lead + 320): odds split by whether the same model also forecast
  -- sun (sb 1 = direct beam at least 35% of clear sky, 2 = not), so a sunny 'overcast' of thin high
  -- cloud is not read as a grey one.
  if v_sun then
    select jsonb_object_agg(model, ps) into v_sbfit from (
      select model, jsonb_object_agg(sb::text, bs) ps from (
        select model, sb, jsonb_agg(p order by bin) bs from replay_hidden_fit
         where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = 0 and sb in (1, 2)
         group by model, sb having count(*) = 5) a group by model) f;
  end if;
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
       where f.trip_id = v.trip_id and f.season = v_season and f.mg = v_mg and f.hb = 0
       group by f.model having count(*) = 5) x;
  end if;
  if p_kind in ('morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') then
    select coalesce(timezone, 'UTC') into v_tz from trips where id = v.trip_id;
    -- Midday re-plan (4 Nov 2026): the look is at local noon, with its own fit (lk 1).
    -- Early look (5 Nov 2026, lk 2): the first camera pictures after sunrise (replay_early_at), read by
    -- majority: the cameras and the airport each one vote, a tie counts as hidden (t_truth 'a', at
    -- least 2 cameras), else the latest report as before. The fit learns from the latest report.
    v_look := case when v_lk = 1 then (v.replay_date + time '12:00') at time zone v_tz
                   when p_kind in ('now', 'nowf') then coalesce(p_look, now())
                   when v_lk = 2 then replay_early_at(v.trip_id, v.replay_date)
                   else replay_look_at(v.trip_id, v.replay_date) end;
    select o.hidden into v_m8 from replay_hidden_truth o
     where o.trip_id = v.trip_id
       and o.hr between v_look - interval '1 hour' and v_look
     order by o.hr desc limit 1;
    if v_lk = 2 or p_kind in ('now', 'nowf') then
      select t_truth(v.trip_id, date_trunc('hour', v_look), s.lat, s.lng) into v_tt
        from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = v.trip_id;
      -- Re-plan now: this hour's pictures, else the hour before's.
      if p_kind in ('now', 'nowf') and (v_tt ->> 'a') is null then
        select t_truth(v.trip_id, date_trunc('hour', v_look) - interval '1 hour', s.lat, s.lng) into v_tt
          from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = v.trip_id;
      end if;
      v_m8 := coalesce((v_tt ->> 'a')::int, v_m8);
    end if;
    select jsonb_object_agg(model, ps) into v_mfit from (
      select model, jsonb_object_agg(m8::text, bs) ps from (
        select model, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
         where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_lk and ab = 0 group by model, m8) a group by model) f;
    -- Fading look (4 Nov 2026, lead + 160): the look's odds by hours after it (ab 1 < 3 h, 2 3-6 h, 3 6 h+).
    if v_fade then
      select jsonb_object_agg(model, ps) into v_mfit2 from (
        select model, jsonb_object_agg(ab::text, ms) ps from (
          select model, ab, jsonb_object_agg(m8::text, bs) ms from (
            select model, ab, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
             where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_lk and ab in (1, 2, 3) group by model, ab, m8) a
           group by model, ab) b group by model) f;
    end if;
  end if;
  if v_cal then
    select jsonb_object_agg(model, ps) into v_sfit from (
      select model, jsonb_object_agg(bin::text, p) ps from replay_sun_fit
       where trip_id = v.trip_id and season = v_season group by model) f;
  end if;
  insert into replay_builds (replay_day_id, kind, lead, members)
  values (p_day, p_kind,
          case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') then p_lead when v_wx then 20 else 0 end,
          case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') then cardinality(v_models) else 1 end)
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
    select distinct case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), fc_m as (
    select a.pk, a.hr, mm.model,
           case when v_cal and x.sv is not null
                then coalesce((v_sfit -> mm.model ->> replay_sv_bin(x.sv)::text)::real, x.sv) else x.sv end sv,
           coalesce(case when v_fade and p_kind in ('morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') and v_m8 is not null and a.hr >= v_look + v_after
                         then (v_mfit2 -> mm.model -> replay_after_band(a.hr, v_look)::text -> v_m8::text ->> replay_cloud_bin(x.cloud)::text)::real end,
                    case when p_kind in ('morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') and v_m8 is not null and a.hr >= v_look + v_after
                         then (v_mfit -> mm.model -> v_m8::text ->> replay_cloud_bin(x.cloud)::text)::real end,
                    case when v_fog and extract(hour from (a.hr - interval '1 hour') at time zone v_ftz) < 10
                         then (v_ffit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real end,
                    case when v_sun and x.dr is not null
                         then (v_sbfit -> mm.model -> replay_sun_band(x.dr, a.a)::text ->> (replay_cloud_bin(x.cloud) - 1))::real end,
                    (v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,
                    case when x.cloud is null then null else greatest(0, least(1, (x.cloud - 70) / 30.0)) end) ph
      from alt a cross join unnest(v_models) mm(model)
      cross join lateral (
        select w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] cloud,
               w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1] dr,
               replay_fc_sv(w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1], w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1], a.a) sv
          from (select 1) one
          left join replay_wx_day w on w.point_key = a.pk
                 and w.model = case when mm.model = 'ecmwf_ifs@f' and (a.hr at time zone 'UTC')::date > v.replay_date then 'ecmwf_ifs@f1' else mm.model end
                 and w.day = (a.hr at time zone 'UTC')::date) x
     where p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf')
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
      join sun on sun.pk = (case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf') then s.fc_key else s.sat_key end) and sun.hr = s.hr
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
end $function$

;

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
  for r in select q.id, q.run_id, q.night, q.replay_date, q.requested_at, x.trip_id, x.config
             from planner_t_now q join replay_runs x on x.id = q.run_id where q.status = 'queued' order by q.id loop
    continue when now() < r.requested_at + interval '4 minutes'
      and coalesce((select (t_truth(r.trip_id, date_trunc('hour', now()), s.lat, s.lng) ->> 'cams')::int from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = r.trip_id), 0) < 2
      and coalesce((select (t_truth(r.trip_id, date_trunc('hour', now()) - interval '1 hour', s.lat, s.lng) ->> 'cams')::int from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = r.trip_id), 0) >= 1;
    begin
      select id into v_day from replay_days where trip_id = r.trip_id and replay_date = r.replay_date;
      update planner_t_now set status = 'planning', planned_at = now(), build_id = replay_build(v_day,
               case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'nowf' else 'now' end,
               1 + case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end
                 + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end,
               now())
       where id = r.id;
      perform net.http_post(
        url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-replay',
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
        -- Early look (run config early, 5 Nov 2026): the first camera pictures after sunrise (live: once they are in).
        if i = r.night and not coalesce((r.config ->> 'draft')::boolean, false) and v_kinds && array['mr1', 'mrmc'] and coalesce((r.config ->> 'early')::boolean, false)
           and (not v_live or replay_live_early_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'earlyf' else 'early' end and lead = 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end) then
          perform replay_build(v_day, case when coalesce((r.config ->> 'morning_fresh')::boolean, false) then 'earlyf' else 'early' end, 1 + case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end + case when coalesce((r.config ->> 'fog')::boolean, false) then 80 else 0 end + case when coalesce((r.config ->> 'fade')::boolean, false) then 160 else 0 end + case when coalesce((r.config ->> 'sun')::boolean, false) then 320 else 0 end); v_built := v_built + 1;
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
end $function$

;

CREATE OR REPLACE FUNCTION public.t_day_check(p_trip uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_tz text; v_lat double precision; v_lng double precision; v_hours jsonb; v_visits jsonb; v_miss jsonb;
        v_sum text; v_rules jsonb; v_clear int; v_day int; v_first text; v_last text; v_n int; v_m int;
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
           'cams_clear', c.clear, 'cams', c.n, 'rules', t_truth(p_trip, h.hr, v_lat, v_lng)) order by h.hr)
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
       and p.note in ('T: evening plan', 'T: morning re-plan', 'T: morning re-plan (cameras)', 'T: re-plan now', 'T: your day')
     order by p.note, r.created_at desc
  ), vis as (
    select r.note, v->>'name' name, (v->>'stop_id')::uuid sid, (v->>'start')::timestamptz st, coalesce((v->>'chance')::float8, (v->>'p_good')::float8) pg, (v->>'value')::float8 val,
           coalesce((v->>'peak_at')::timestamptz, (v->>'start')::timestamptz) pk,
           coalesce((select i.fog_wanted from solver_stop_inputs i where i.stop_id = (v->>'stop_id')::uuid), false) fog
      from runs r cross join jsonb_array_elements(r.visits) v
     where (v ? 'p_good' or v ? 'chance') and (v->>'value') is not null
       -- only stops T expected in daylight (visible = good shot applies there; blue hour depends on light too)
       and (select sp.altitude from sun_position(coalesce((v->>'peak_at')::timestamptz, (v->>'start')::timestamptz), v_lat, v_lng) sp) > 0
  ), j as (
    -- Judged at the time T expected the stop at its best (peak_at), on the nearest hourly report.
    -- Fog shots (fog_wanted) want the hills in cloud: their "hidden" is a good outcome (4 Nov 2026).
    select vis.*, date_trunc('hour', vis.pk + interval '30 minutes') hr,
           (select case when vis.fog then 1 - o.hidden else o.hidden end from replay_hidden_truth o
             where o.trip_id = p_trip and o.hr = date_trunc('hour', vis.pk + interval '30 minutes') limit 1) hidden
      from vis
  ), k as (
    -- The same stop under the four rules of t_truth (5 Nov 2026), fog shots reversed the same way.
    select j.*, (select jsonb_build_object(
                   'old', case when j.fog then 1 - (t->>'old')::int else (t->>'old')::int end,
                   'a', case when j.fog then 1 - (t->>'a')::int else (t->>'a')::int end,
                   'b', case when j.fog then 1 - (t->>'b')::int else (t->>'b')::int end,
                   'c', case when j.fog then 1 - (t->>'c')::int else (t->>'c')::int end,
                   'b_cam', t->>'b_cam')
                  from (select t_truth(p_trip, j.hr, coalesce(s.lat, v_lat), coalesce(s.lng, v_lng)) t from stops s where s.id = j.sid
                        union all select t_truth(p_trip, j.hr, v_lat, v_lng) where j.sid is null) x) tr
      from j
  )
  select jsonb_agg(jsonb_build_object('plan', replace(note, 'T: ', ''), 'stop', name, 'at', to_char(st at time zone v_tz, 'HH24:MI'), 'fog_shot', fog,
                                      'said', round(pg::numeric, 2), 'value', round(val::numeric, 2), 'hidden', hidden,
                                      'miss', case when hidden = 0 and pg <= 0.2 then 'too gloomy' when hidden = 1 and pg >= 0.6 then 'too hopeful' end,
                                      'rules', tr)
                   order by note, st),
         count(*) filter (where hidden is not null),
         count(*) filter (where (hidden = 0 and pg <= 0.2) or (hidden = 1 and pg >= 0.6))
    into v_visits, v_n, v_m
    from k;
  -- Misses per truth rule over the stops each rule could judge.
  select jsonb_object_agg(r, jsonb_build_object('checked', n, 'misses', m, 'too_gloomy', g, 'too_hopeful', hh)) into v_rules
    from (select r, count(*) filter (where (x->'rules'->>r) is not null) n,
                 count(*) filter (where ((x->'rules'->>r)::int = 0 and (x->>'said')::float8 <= 0.2) or ((x->'rules'->>r)::int = 1 and (x->>'said')::float8 >= 0.6)) m,
                 count(*) filter (where (x->'rules'->>r)::int = 0 and (x->>'said')::float8 <= 0.2) g,
                 count(*) filter (where (x->'rules'->>r)::int = 1 and (x->>'said')::float8 >= 0.6) hh
            from jsonb_array_elements(coalesce(v_visits, '[]')) x cross join unnest(array['old', 'a', 'b', 'c']) r group by r) z;
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
                                               from jsonb_array_elements(v_miss) x), '') || '.' end
           || coalesce(format(' Misses by rule: now %s, majority %s, nearest camera %s, any camera %s.',
                              v_rules->'old'->>'misses', v_rules->'a'->>'misses', v_rules->'b'->>'misses', v_rules->'c'->>'misses'), '');

  insert into t_day_checks (trip_id, plan_date, made_at, summary, misses, checked, detail)
  values (p_trip, p_date, now(), v_sum, coalesce(v_m, 0), coalesce(v_n, 0),
          jsonb_build_object('hours', v_hours, 'visits', v_visits, 'rules', v_rules))
  on conflict (trip_id, plan_date) do update set made_at = excluded.made_at, summary = excluded.summary,
         misses = excluded.misses, checked = excluded.checked, detail = excluded.detail;
  return jsonb_build_object('summary', v_sum, 'misses', v_miss, 'rules', v_rules);
end $function$

;

-- The app's button (anon, security definer): queue a re-plan of today for the trip's live T run.
create or replace function planner_t_now(p_trip uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v record; v_tz text; v_today date; v_night int; v_req record;
begin
  select coalesce(timezone, 'UTC') into v_tz from trips where id = p_trip;
  if v_tz is null then return jsonb_build_object('ok', false, 'error', 'trip not found'); end if;
  v_today := (now() at time zone v_tz)::date;
  select x.* into v from replay_runs x
   where x.trip_id = p_trip and x.status = 'running' and coalesce((x.config ->> 'live')::boolean, false)
     and coalesce((x.config ->> 'publish')::boolean, false) and not coalesce((x.config ->> 'draft')::boolean, false)
     and v_today between x.start_date and x.start_date + x.nights - 1
   order by x.id desc limit 1;
  if v is null then return jsonb_build_object('ok', false, 'error', 'T is not planning today for this trip'); end if;
  v_night := v_today - v.start_date;
  if not exists (select 1 from replay_live_today where run_id = v.id and replay_date = v_today) then
    return jsonb_build_object('ok', false, 'error', 'T has not made today''s morning re-plan yet: it comes about 30 min before sunrise');
  end if;
  -- One at a time: a request still running (or made in the last minute) is reused.
  select * into v_req from planner_t_now
   where run_id = v.id and replay_date = v_today and (status in ('queued', 'planning') or requested_at > now() - interval '1 minute')
   order by id desc limit 1;
  if v_req.id is not null then
    return jsonb_build_object('ok', true, 'id', v_req.id, 'since', v_req.requested_at, 'reused', true);
  end if;
  insert into planner_t_now (trip_id, run_id, night, replay_date) values (p_trip, v.id, v_night, v_today) returning * into v_req;
  -- This hour's camera pictures (webcam-archive skips cameras already taken this hour, and the dark).
  perform net.http_post(url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/webcam-archive',
    body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
  return jsonb_build_object('ok', true, 'id', v_req.id, 'since', v_req.requested_at, 'reused', false);
end $$;

-- How the newest request for the trip is doing (the app polls it).
create or replace function planner_t_now_status(p_trip uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', q.id, 'status', q.status, 'requested_at', q.requested_at, 'done_at', q.done_at,
                            'note', q.note, 'changed', q.result -> 'changed', 'hidden', q.result -> 'hidden')
    from planner_t_now q where q.trip_id = p_trip order by q.id desc limit 1
$$;

revoke all on function planner_t_now(uuid) from public;
revoke all on function planner_t_now_status(uuid) from public;
grant execute on function planner_t_now(uuid) to anon, authenticated, service_role;
grant execute on function planner_t_now_status(uuid) to anon, authenticated, service_role;
