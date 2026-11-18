-- Fix (9 Nov 2026): since the BD change (20261108170000, applied ~23:00 UTC 8 Nov) every replay_build that was NOT a
-- whole-day-weather build failed with 'cannot accumulate null arrays': array_agg(hs) inside a CASE is still evaluated.
-- No live plan was hit (Faroes Live evening plan 20:47 UTC was before; Teton Live's 03:30 UTC after the fix); the
-- 56 BEm56 bench weeks were requeued. The aggregate now skips null arrays.
CREATE OR REPLACE FUNCTION public.replay_build(p_day bigint, p_kind text, p_lead integer DEFAULT 1, p_look timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Lead + 10240 (6 Nov 2026, Phil: count blue hour, run config blue / blue_judge): a clear blue hour (sun 0-6 deg
-- below the horizon, light 'no sun') scores 0.6 (0.75 when soft light is wanted), a good shot, instead of 0.3 / 0.4.
-- Lead + 5120 (6 Nov 2026, odds bug fix, run config sbfix): the fit loads read sb = 0 only. Since the 4 Nov
-- thin-cloud rows (sb 1/2) a model with sun data had 15 rows, failed 'having count(*) = 5' and fell back to
-- the crude rule (cloud above 70%). Bench switch first; live after Phil's OK.
-- Lead + 2560 (6 Nov 2026, worksheet E1, run config cons): hidden-peak odds from the models' agreement
-- (replay_cons_bin, model 'cons@lead' in replay_hidden_counts) instead of each model's own.
-- Lead + 1280 (6 Nov 2026, worksheet A3, run config nopk): hidden peaks do not lower a stop whose
-- solver_stop_settings.needs_peaks is false (it looks fine under cloud). Truth builds carry it too.
declare v_slay boolean := (p_lead % 327680) >= 163840; v_slfit jsonb; v_runs boolean := (p_lead % 163840) >= 81920; v_layers boolean := (p_lead % 81920) >= 40960; v_lfit jsonb; v record; v_build uuid; v_rows int; v_models text[]; v_fc text[]; v_season int; v_fit jsonb; v_sfit jsonb; v_mfit jsonb; v_m8 int; v_tz text; v_look timestamptz;
  v_lead int := p_lead % 10; v_cal boolean := (p_lead % 20) >= 10; v_wx boolean := (p_lead % 40) >= 20; v_xm text[];
  v_learn boolean := (p_lead % 80) >= 40; v_fog boolean := (p_lead % 160) >= 80; v_ffit jsonb;
  v_fade boolean := (p_lead % 320) >= 160; v_sun boolean := (p_lead % 640) >= 320; v_vfit boolean := (p_lead % 1280) >= 640; v_hb smallint := case when (p_lead % 1280) >= 640 then 10 else 0 end; v_np boolean := (p_lead % 2560) >= 1280; v_cons boolean := (p_lead % 5120) >= 2560; v_fix boolean := (p_lead % 10240) >= 5120; v_blue boolean := (p_lead % 20480) >= 10240; v_flk smallint; v_mfit2 jsonb; v_sbfit jsonb; v_ftz text; v_mg smallint := 0; v_mmg smallint := 0; v_ltz text; v_fcp text; v_lk smallint := case when p_kind in ('midday', 'middayf') then 1 when p_kind in ('early', 'earlyf') then 2
                       when p_kind in ('predawn', 'predawnf', 'depart', 'departf') then 3  -- the look before you leave (sunrise - 2 h, 5 Nov 2026)
                       -- Re-plan now (5 Nov 2026): the early look's odds in the morning, the noon look's later.
                       when p_kind in ('now', 'nowf') then case when extract(hour from coalesce(p_look, now()) at time zone
                            (select coalesce(t.timezone, 'UTC') from replay_days d join trips t on t.id = d.trip_id where d.id = p_day)) < 11 then 2 else 1 end
                       else 0 end; v_tt jsonb; v_vote boolean := p_kind = 'truth' and (p_lead % 10) = 5;
  v_after interval := case when p_kind in ('now', 'nowf', 'depart', 'departf') then interval '0' else interval '1 hour' end; v_slat double precision; v_slng double precision;
begin
  select * into v from replay_days where id = p_day;
  if v is null then raise exception 'replay day % not found', p_day; end if;
  v_season := replay_season(v.replay_date);
  -- Look before you leave (5 Nov 2026): its look time follows the plan's departure, so it uses the fitted
  -- look nearest in time (lk 3 = 2 h before sunrise, 0 = 30 min before, 2 = first camera pictures, 1 = noon).
  if p_kind in ('depart', 'departf') then
    select x.lk into v_lk from (values
        (3::smallint, replay_look_at(v.trip_id, v.replay_date) - interval '90 minutes'),
        (0::smallint, replay_look_at(v.trip_id, v.replay_date)),
        (2::smallint, replay_early_at(v.trip_id, v.replay_date)),
        (1::smallint, (v.replay_date + time '12:00') at time zone (select coalesce(timezone, 'UTC') from trips where id = v.trip_id))) x(lk, at)
     where exists (select 1 from replay_morning_counts c where c.trip_id = v.trip_id and c.lk = x.lk)
     order by abs(extract(epoch from (x.at - coalesce(p_look, now())))) limit 1;
    v_lk := coalesce(v_lk, 0);
  end if;
  -- Camera-vote odds (6 Nov 2026, lead + 640, run config vfit): the hidden-peak and look odds learned
  -- from the camera vote (replay_hidden_vote) are stored as hb + 10 / lk + 10 in the same counts tables.
  v_flk := v_lk + v_hb;
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
  if p_kind in ('morningf', 'middayf', 'earlyf', 'nowf', 'predawnf', 'departf')
     and (select count(distinct w.point_key) from replay_wx_day w
           where w.point_key = any(v_fc) and w.model = 'ecmwf_ifs@f' and w.day = v.replay_date) = cardinality(v_fc) then
    v_models := array_replace(v_models, 'ecmwf_ifs025', 'ecmwf_ifs@f');
  end if;
  if p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') and coalesce(cardinality(v_models), 0) = 0 then
    raise exception 'no lead % forecast for replay day %', p_lead, p_day;
  end if;
  v_xm := case when p_kind = 'truth' then array['era5'] else array_replace(v_models, 'ecmwf_ifs@f', 'ecmwf_ifs025') end;
  if v_wx and v.replay_date < current_date - 7 and p_kind <> 'truth'
     and not exists (select 1 from replay_wx_x x where x.point_key = any(v_fc) and x.model = any(v_xm) and x.day = v.replay_date) then
    raise exception 'no rain / wind data for replay day %', p_day;
  end if;
  -- Month group (3 Nov 2026): the day's own group when it has a fit, else group 0.
  v_mg := replay_month_group(v.replay_date);
  if v_mg <> 0 and not exists (select 1 from replay_hidden_fit where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = v_hb) then v_mg := 0; end if;
  v_mmg := replay_month_group(v.replay_date);
  if v_mmg <> 0 and not exists (select 1 from replay_morning_fit where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_flk) then v_mmg := 0; end if;
  select jsonb_object_agg(model, ps) into v_fit from (
    select model, jsonb_agg(p order by bin) ps from replay_hidden_fit
     where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = v_hb and (not v_fix or sb = 0) group by model having count(*) = 5) f;
  -- Cloud layers (F5, BC, lead + 40960, 8 Nov 2026): ECMWF's hidden-peak odds from its LOW cloud
  -- (replay_layer_fit, single ECMWF runs in replay_wx_layers: r1 = day-ahead, r0 = same-day run).
  if v_layers then
    select jsonb_object_agg(src, ps) into v_lfit from (
      select src, jsonb_agg(p order by bin) ps from replay_layer_fit
       where trip_id = v.trip_id and season = v_season and hb = v_hb
         and mg = case when exists (select 1 from replay_layer_fit z where z.trip_id = v.trip_id and z.season = v_season and z.hb = v_hb and z.mg = replay_month_group(v.replay_date))
                       then replay_month_group(v.replay_date) else 0 end
       group by src having count(*) = 5) f;
  end if;
  -- Shared low cloud (BE, lead + 163840, 9 Nov 2026, Phil: "yes"): every model's hidden-peak odds from its own
  -- total cloud AND ECMWF's low cloud at that hour (replay_slayer_fit). BC fed the low cloud to ECMWF alone.
  if v_slay then
    select jsonb_object_agg(src, ms) into v_slfit from (
      select src, jsonb_object_agg(model, bs) ms from (
        select src, model, jsonb_object_agg(own_bin::text, ps) bs from (
          select src, model, own_bin, jsonb_agg(p order by low_bin) ps from replay_slayer_fit
           where trip_id = v.trip_id and season = v_season and hb = v_hb
             and mg = case when exists (select 1 from replay_slayer_fit z where z.trip_id = v.trip_id and z.season = v_season and z.hb = v_hb and z.mg = replay_month_group(v.replay_date))
                           then replay_month_group(v.replay_date) else 0 end
           group by src, model, own_bin having count(*) = 3) a group by src, model) b group by src) f;
  end if;
  -- Fog test (4 Nov 2026, lead + 80): slots before 10:00 local use the odds learned from those
  -- hours alone (valley inversion fog under a clear forecast); the rest as before.
  if v_fog then
    select coalesce(timezone, 'UTC') into v_ftz from trips where id = v.trip_id;
    select jsonb_object_agg(model, ps) into v_ffit from (
      select model, jsonb_agg(p order by bin) ps from replay_hidden_fit
       where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = v_hb + 1 and (not v_fix or sb = 0) group by model having count(*) = 5) f;
  end if;
  -- Thin-cloud test (4 Nov 2026, lead + 320): odds split by whether the same model also forecast
  -- sun (sb 1 = direct beam at least 35% of clear sky, 2 = not), so a sunny 'overcast' of thin high
  -- cloud is not read as a grey one.
  if v_sun then
    select jsonb_object_agg(model, ps) into v_sbfit from (
      select model, jsonb_object_agg(sb::text, bs) ps from (
        select model, sb, jsonb_agg(p order by bin) bs from replay_hidden_fit
         where trip_id = v.trip_id and season = v_season and mg = v_mg and hb = v_hb and sb in (1, 2)
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
       where f.trip_id = v.trip_id and f.season = v_season and f.mg = v_mg and f.hb = 0 and (not v_fix or f.sb = 0)
       group by f.model having count(*) = 5) x;
  end if;
  if p_kind in ('morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') then
    select coalesce(timezone, 'UTC') into v_tz from trips where id = v.trip_id;
    -- Midday re-plan (4 Nov 2026): the look is at local noon, with its own fit (lk 1).
    -- Early look (5 Nov 2026, lk 2): the first camera pictures after sunrise (replay_early_at), read by
    -- majority: the cameras and the airport each one vote, a tie counts as hidden (t_truth 'a', at
    -- least 2 cameras), else the latest report as before. The fit learns from the latest report.
    v_look := case when v_lk = 1 then (v.replay_date + time '12:00') at time zone v_tz
                   when p_kind in ('now', 'nowf', 'depart', 'departf') then coalesce(p_look, now())
                   when v_lk = 2 then replay_early_at(v.trip_id, v.replay_date)
                   when v_lk = 3 then replay_look_at(v.trip_id, v.replay_date) - interval '90 minutes'
                   else replay_look_at(v.trip_id, v.replay_date) end;
    if v_vfit then
      select o.hidden into v_m8 from replay_hidden_vote o
       where o.trip_id = v.trip_id
         and o.hr between v_look - interval '1 hour' and v_look
       order by o.hr desc limit 1;
    else
      select o.hidden into v_m8 from replay_hidden_truth o
       where o.trip_id = v.trip_id
         and o.hr between v_look - interval '1 hour' and v_look
       order by o.hr desc limit 1;
    end if;
    if v_lk = 2 or p_kind in ('now', 'nowf', 'depart', 'departf') then
      select t_truth(v.trip_id, date_trunc('hour', v_look), s.lat, s.lng) into v_tt
        from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = v.trip_id;
      -- Re-plan now: this hour's pictures, else the hour before's.
      if p_kind in ('now', 'nowf', 'depart', 'departf') and (v_tt ->> 'a') is null then
        select t_truth(v.trip_id, date_trunc('hour', v_look) - interval '1 hour', s.lat, s.lng) into v_tt
          from replay_places p join metar_stations s on s.icao = p.station where p.trip_id = v.trip_id;
      end if;
      v_m8 := coalesce((v_tt ->> 'a')::int,
                       (select o.hidden from replay_hidden_vote o where o.trip_id = v.trip_id and o.cams >= 2
                          and o.hr = date_trunc('hour', v_look) limit 1),
                       v_m8);
    end if;
    select jsonb_object_agg(model, ps) into v_mfit from (
      select model, jsonb_object_agg(m8::text, bs) ps from (
        select model, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
         where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_flk and ab = 0 group by model, m8) a group by model) f;
    -- Fading look (4 Nov 2026, lead + 160): the look's odds by hours after it (ab 1 < 3 h, 2 3-6 h, 3 6 h+).
    if v_fade then
      select jsonb_object_agg(model, ps) into v_mfit2 from (
        select model, jsonb_object_agg(ab::text, ms) ps from (
          select model, ab, jsonb_object_agg(m8::text, bs) ms from (
            select model, ab, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
             where trip_id = v.trip_id and season = v_season and mg = v_mmg and lk = v_flk and ab in (1, 2, 3) group by model, ab, m8) a
           group by model, ab) b group by model) f;
    end if;
  end if;
  if v_cal then
    select jsonb_object_agg(model, ps) into v_sfit from (
      select model, jsonb_object_agg(bin::text, p) ps from replay_sun_fit
       where trip_id = v.trip_id and season = v_season group by model) f;
  end if;
  insert into replay_builds (replay_day_id, kind, lead, members, look_at)
  values (p_day, p_kind,
          case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') then p_lead else (case when v_wx then 20 else 0 end + case when v_vote then 5 else 0 end + case when v_np then 1280 else 0 end + case when v_blue then 10240 else 0 end) end,
          case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') then cardinality(v_models) else 1 end,
          p_look)
  returning id into v_build;
  insert into replay_scores_c (build_id, stop_id, t0, offs, v, h)
  with st as (
    select i.stop_id, i.star_vantage_id, coalesce(i.light_wanted, '{front,side}') lw, coalesce(i.fog_wanted, false) fog_wanted,
           coalesce(i.rain_bonus, false) rain_bonus, s.lat slat, s.lng slng,
           coalesce((select ss.needs_peaks from solver_stop_settings ss where ss.stop_id = i.stop_id), true) needs_peaks,
           'fc:' || (round((s.lat * 4)::numeric) / 4) || ',' || (round((s.lng * 4)::numeric) / 4) fc_key,
           'sat:' || (round((s.lat * 10)::numeric) / 10) || ',' || (round((s.lng * 10)::numeric) / 10) sat_key
      from solver_stop_inputs i join scout_vantages vv on vv.id = i.star_vantage_id join scout_subjects s on s.id = vv.subject_id
     where i.trip_id = v.trip_id and i.tier is not null and i.star_vantage_id is not null and s.lat is not null
  ), slots as (
    select st.*, c.slot_at, c.light, date_trunc('hour', c.slot_at) + interval '1 hour' hr, date_trunc('hour', c.slot_at) obs_hr,
           case when v_blue and c.light = 'no sun' then (case when 'soft' = any(coalesce(st.lw, '{}')) then 0.75 else 0.6 end)::real
                else solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) end dir, solver_light_soft(c.sun_alt, st.lw) soft
      from st join solver_light_cache c on c.vantage_id = st.star_vantage_id and c.local_date = v.replay_date and c.sun_alt > -6
  ), pts as (
    select distinct case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), cons as (
    -- Consensus odds (lead + 2560, worksheet E1): the models' agreement at that hour, one bin.
    select a.pk, a.hr, replay_cons_bin(bool_and(w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] < 20),
                                        avg(w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1])::real) cb
      from alt a cross join unnest(v_models) mm(model)
      join replay_wx_day w on w.point_key = a.pk and w.model = mm.model and w.day = (a.hr at time zone 'UTC')::date
     where v_cons and mm.model not like 'ecmwf_ifs@f%' and w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] is not null
     group by a.pk, a.hr having count(*) >= 3
  ), fc_m as (
    select a.pk, a.hr, mm.model,
           case when v_cal and x.sv is not null
                then coalesce((v_sfit -> mm.model ->> replay_sv_bin(x.sv)::text)::real, x.sv) else x.sv end sv,
           coalesce(case when v_fade and p_kind in ('morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') and v_m8 is not null and a.hr >= v_look + v_after
                         then (v_mfit2 -> mm.model -> replay_after_band(a.hr, v_look)::text -> v_m8::text ->> replay_cloud_bin(x.cloud)::text)::real end,
                    case when p_kind in ('morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') and v_m8 is not null and a.hr >= v_look + v_after
                         then (v_mfit -> mm.model -> v_m8::text ->> replay_cloud_bin(x.cloud)::text)::real end,
                    case when v_slay and ly.low is not null and x.cloud is not null
                         then (v_slfit -> ly.src -> (case when mm.model = 'ecmwf_ifs@f' then 'ecmwf_ifs025' else mm.model end)
                                -> replay_cloud_bin(x.cloud)::text ->> (replay_low_bin(ly.low) - 1))::real end,
                    case when v_layers and ly.low is not null and mm.model in ('ecmwf_ifs025', 'ecmwf_ifs@f')
                         then (v_lfit -> ly.src ->> (replay_cloud_bin(ly.low) - 1))::real end,
                    case when v_fog and extract(hour from (a.hr - interval '1 hour') at time zone v_ftz) < 10
                         then (v_ffit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real end,
                    case when v_sun and x.dr is not null
                         then (v_sbfit -> mm.model -> replay_sun_band(x.dr, a.a)::text ->> (replay_cloud_bin(x.cloud) - 1))::real end,
                    case when v_cons and c.cb is not null then (v_fit -> ('cons' || coalesce(substring(mm.model from '@[0-9]+$'), '')) ->> (c.cb - 1))::real end,
                    (v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,
                    case when x.cloud is null then null else greatest(0, least(1, (x.cloud - 70) / 30.0)) end) ph
      from alt a cross join unnest(v_models) mm(model)
      left join cons c on c.pk = a.pk and c.hr = a.hr
      left join lateral (
        -- ECMWF day-ahead member (lead 1): run of the day before, only hours on the plan's own UTC day;
        -- the fresh morning run (@f): its own day r0, the next r1.
        select l.low[extract(hour from a.hr at time zone 'UTC')::int + 1] low, k.src
          from (select case when mm.model = 'ecmwf_ifs@f' then case when (a.hr at time zone 'UTC')::date = v.replay_date then 'r0' else 'r1' end
                            when v_slay and (a.hr at time zone 'UTC')::date = v.replay_date
                             and p_kind in ('morningf', 'middayf', 'earlyf', 'nowf', 'predawnf', 'departf') then 'r0'
                            when (mm.model = 'ecmwf_ifs025' or v_slay) and (a.hr at time zone 'UTC')::date = v.replay_date then 'r1' end src) k
          join replay_wx_layers l on l.point_key = a.pk and l.model = 'ecmwf_ifs@' || k.src and l.day = (a.hr at time zone 'UTC')::date
         where ((v_layers and v_lfit is not null) or (v_slay and v_slfit is not null)) and v_lead = 1) ly on true
      cross join lateral (
        select w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] cloud,
               w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1] dr,
               replay_fc_sv(w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1], w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1], a.a) sv
          from (select 1) one
          left join replay_wx_day w on w.point_key = a.pk
                 and w.model = case when mm.model = 'ecmwf_ifs@f' and (a.hr at time zone 'UTC')::date > v.replay_date then 'ecmwf_ifs@f1' else mm.model end
                 and w.day = (a.hr at time zone 'UTC')::date) x
     where p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf')
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
    -- Truth lead + 5 (6 Nov 2026): judged by the camera vote (replay_hidden_vote) instead of airport OR TetonCam.
    select s.obs_hr, case when v_vote
             then (select o.hidden from replay_hidden_vote o
                    where o.trip_id = v.trip_id and o.hr between s.obs_hr - interval '2 hours' and s.obs_hr + interval '2 hours'
                    order by abs(extract(epoch from o.hr - s.obs_hr)) limit 1)
             else (select o.hidden from replay_hidden_truth o
                    where o.trip_id = v.trip_id and o.hr between s.obs_hr - interval '2 hours' and s.obs_hr + interval '2 hours'
                    order by abs(extract(epoch from o.hr - s.obs_hr)) limit 1) end hidden
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
             * (case when s.fog_wanted then 0.6 + 0.4 * u.h when v_np and not s.needs_peaks then 1 else 1 - 0.9 * u.h end)
             * coalesce(w.rain_f * w.wind_f * (case when s.rain_bonus then 1 + 0.3 * least(w.r24 / 10.0, 1) else 1 end), 1))))::smallint order by u.k) vals,
           -- E4 whole-day weather (lead + 81920, 8 Nov 2026): each member's hidden-peak chance per slot (x 250), kept
           -- so the planner can follow hidden / clear runs through a visit; only where hidden = x (1 - 0.9) applies.
           case when v_runs and p_kind <> 'truth' and not bool_or(s.fog_wanted) and not (v_np and not bool_and(s.needs_peaks))
                then array_agg(round(250 * u.h)::smallint order by u.k) end hs
      from slots s
      join sun on sun.pk = (case when p_kind in ('forecast', 'morning', 'morningf', 'midday', 'middayf', 'early', 'earlyf', 'now', 'nowf', 'predawn', 'predawnf', 'depart', 'departf') then s.fc_key else s.sat_key end) and sun.hr = s.hr
      left join obs on obs.obs_hr = s.obs_hr
      cross join lateral (
        select x, coalesce(case when p_kind = 'truth' then obs.hidden::real else hh end, 0) h, k
          from unnest(sun.sv, coalesce(sun.ph, array[null::real])) with ordinality q(x, hh, k)) u
      left join wx w on v_wx and w.fk = s.fc_key and w.hr = s.hr and w.k = u.k
     group by s.stop_id, s.slot_at
  ), first_slot as (select *, min(slot_at) over (partition by stop_id) t0 from per_slot)
  select v_build, stop_id, t0, array_agg((extract(epoch from slot_at - t0) / 900)::smallint order by slot_at),
         array_agg(vals order by slot_at),
         case when bool_and(hs is not null) then array_agg(hs order by slot_at) filter (where hs is not null) end
    from first_slot group by stop_id, t0;
  get diagnostics v_rows = row_count;
  update replay_builds set slots = v_rows where id = v_build;
  return v_build;
end $function$

;
