-- T2 (Phil, 3 Nov 2026): replay_build learns rain, wind and the waterfall bonus, the three
-- weather inputs the old live builder (solver_build_scores) has and the bench / T never had.
-- Same formulas as solver_build_scores, per member and hour:
--   rain  x (1 - 0.8 * min(precip mm in the hour / 1.5, 1))
--   wind  x 1 up to 35 km/h gusts, then down to 0.2 at 71 km/h
--   waterfall (solver_stop_settings.rain_bonus) x (1 + 0.3 * min(rain over the last 24 h / 10 mm, 1))
-- Forecast members read their own model's precip / gusts (replay_wx_x, same lead; ECMWF's
-- overnight run uses its night-before rain); a member with none takes the others' average.
-- The truth reads ERA5 (replay_wx_x model 'era5') at the place's forecast cell.
-- Opt-in, so every existing build and run stays as it was: lead + 20 (forecast / morning
-- builds as lead 21-23, the truth as lead 20), asked for by run config wx (solver-replay v54).
create or replace function public.replay_build(p_day bigint, p_kind text, p_lead integer default 1)
 returns uuid language plpgsql set search_path to 'public', 'extensions' as $function$
declare v record; v_build uuid; v_rows int; v_models text[]; v_fc text[]; v_season int; v_fit jsonb; v_sfit jsonb; v_mfit jsonb; v_m8 int; v_tz text; v_look timestamptz;
  v_lead int := p_lead % 10; v_cal boolean := (p_lead % 20) >= 10; v_wx boolean := p_lead >= 20; v_xm text[];
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
  -- morningf: ECMWF's overnight run of the day replaces its night-before forecast.
  if p_kind = 'morningf'
     and (select count(distinct w.point_key) from replay_wx_day w
           where w.point_key = any(v_fc) and w.model = 'ecmwf_ifs@f' and w.day = v.replay_date) = cardinality(v_fc) then
    v_models := array_replace(v_models, 'ecmwf_ifs025', 'ecmwf_ifs@f');
  end if;
  if p_kind in ('forecast', 'morning', 'morningf') and coalesce(cardinality(v_models), 0) = 0 then
    raise exception 'no lead % forecast for replay day %', p_lead, p_day;
  end if;
  -- The rain / wind member for each sun member (in the same order); the truth: ERA5.
  v_xm := case when p_kind = 'truth' then array['era5'] else array_replace(v_models, 'ecmwf_ifs@f', 'ecmwf_ifs025') end;
  if v_wx and not exists (select 1 from replay_wx_x x where x.point_key = any(v_fc) and x.model = any(v_xm) and x.day = v.replay_date) then
    raise exception 'no rain / wind data for replay day %', p_day;
  end if;
  select jsonb_object_agg(model, ps) into v_fit from (
    select model, jsonb_agg(p order by bin) ps from replay_hidden_fit
     where trip_id = v.trip_id and season = v_season group by model having count(*) = 5) f;
  if p_kind in ('morning', 'morningf') then
    select coalesce(timezone, 'UTC') into v_tz from trips where id = v.trip_id;
    v_look := replay_look_at(v.trip_id, v.replay_date);
    select o.hidden into v_m8 from replay_hidden_truth o
     where o.trip_id = v.trip_id
       and o.hr between v_look - interval '1 hour' and v_look
     order by o.hr desc limit 1;
    select jsonb_object_agg(model, ps) into v_mfit from (
      select model, jsonb_object_agg(m8::text, bs) ps from (
        select model, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
         where trip_id = v.trip_id and season = v_season group by model, m8) a group by model) f;
  end if;
  if v_cal then
    select jsonb_object_agg(model, ps) into v_sfit from (
      select model, jsonb_object_agg(bin::text, p) ps from replay_sun_fit
       where trip_id = v.trip_id and season = v_season group by model) f;
  end if;

  insert into replay_builds (replay_day_id, kind, lead, members)
  values (p_day, p_kind,
          case when p_kind in ('forecast', 'morning', 'morningf') then p_lead when v_wx then 20 else 0 end,
          case when p_kind in ('forecast', 'morning', 'morningf') then cardinality(v_models) else 1 end)
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
    select distinct case when p_kind in ('forecast', 'morning', 'morningf') then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), fc_m as (
    select a.pk, a.hr, mm.model,
           case when v_cal and x.sv is not null
                then coalesce((v_sfit -> mm.model ->> replay_sv_bin(x.sv)::text)::real, x.sv) else x.sv end sv,
           coalesce(case when p_kind in ('morning', 'morningf') and v_m8 is not null and a.hr >= v_look + interval '1 hour'
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
     where p_kind in ('forecast', 'morning', 'morningf')
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
    -- Rain / wind per member and hour at the forecast cell (only for wx builds).
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
      join sun on sun.pk = (case when p_kind in ('forecast', 'morning', 'morningf') then s.fc_key else s.sat_key end) and sun.hr = s.hr
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
