-- Planner test bench, part 3 (Phil, 25 Oct 2026: "Sure let's try and see").
-- 1. Weather stored one row per day (arrays by UTC hour 0-23) instead of one
--    row per hour: 36 MB -> 2.5 MB. replay_wx / replay_sat stay as views.
--    Models 'x@2' / 'x@3' are forecasts made 2 / 3 days ahead (plain 'x' = 1).
-- 2. Hidden peaks: a grey day was worth 2/3 of a sunny one because sun was
--    the only weather term. Truth now also counts the peaks as hidden when the
--    trip's airport reported a ceiling below the place's limit (Teton: 7000 ft
--    above KJAC, about the Grand's summit; Faroes: 2000 ft at EKVG, the
--    system's hills-hidden rule), visibility under 1 km or fog. The archive
--    has no day-ahead low cloud, so each forecast member's chance of hidden
--    peaks is the observed rate for that model, lead and total-cloud bin in the
--    OTHER seasons (leave one season out: no year grades its own homework).
--    Value x (1 - 0.9 hidden), fog-wanted stops x (0.6 + 0.4 hidden), as
--    solver_build_scores does with its fog term.

create table if not exists replay_wx_day (
  point_key text not null, model text not null, day date not null,
  dr real[] not null, cloud real[] not null,          -- [1..24] = UTC hours 0..23
  primary key (point_key, model, day));
create table if not exists replay_sat_day (
  point_key text not null, day date not null, dni real[] not null,
  primary key (point_key, day));
-- (one-off: copied from the hourly tables, which were then removed)
create or replace view replay_wx with (security_invoker = true) as
  select w.point_key, w.model, (w.day + (h.h - 1) * interval '1 hour') at time zone 'UTC' as valid_at, w.dr[h.h] as dr, w.cloud[h.h] as cloud
    from replay_wx_day w cross join generate_series(1, 24) h(h);
create or replace view replay_sat with (security_invoker = true) as
  select s.point_key, (s.day + (h.h - 1) * interval '1 hour') at time zone 'UTC' as valid_at, s.dni[h.h] as dni
    from replay_sat_day s cross join generate_series(1, 24) h(h);

alter table replay_builds add column if not exists lead integer not null default 1;

create table if not exists replay_places (
  trip_id uuid primary key references trips(id),
  station text not null,       -- METAR (metar_history.station)
  ceiling_ft integer not null, -- a ceiling below this hides the subjects
  fc_point text not null       -- forecast cell nearest the station, for the fit
);
insert into replay_places values
  ('5e247891-d800-4d07-b5e0-8ad748ae2754', 'KJAC', 7000, 'fc:43.7500000000000000,-110.7500000000000000'),
  ('e04fbc9d-86b1-42b2-bf08-fc65a18e665d', 'EKVG', 2000, 'fc:62.0000000000000000,-7.2500000000000000')
on conflict (trip_id) do update set station = excluded.station, ceiling_ft = excluded.ceiling_ft, fc_point = excluded.fc_point;

create or replace view replay_hidden_obs with (security_invoker = true) as
  select p.trip_id, m.hr,
         (coalesce(m.ceiling_ft < p.ceiling_ft, false) or coalesce(m.visibility_m < 1000, false) or coalesce(m.fog, false))::int as hidden
    from replay_places p join metar_history m on m.station = p.station;

create or replace function replay_cloud_bin(p_cloud real) returns integer language sql immutable as $$
  select case when p_cloud < 20 then 1 when p_cloud < 50 then 2 when p_cloud < 80 then 3 when p_cloud < 95 then 4 else 5 end
$$;
create or replace function replay_season(p_date date) returns integer language sql immutable as $$
  select extract(year from p_date - 180)::int   -- Dec-Jan = one winter; May = its year
$$;

create table if not exists replay_hidden_counts (
  trip_id uuid not null, season integer not null, model text not null, bin integer not null,
  n integer not null, hits integer not null,
  primary key (trip_id, season, model, bin));

-- Some "models" are another model under a new name in the archive (HRRR =
-- GFS at Jackson; MET Norway and DMI = ECMWF in some Faroes Mays): a copy
-- counts once, as the first model in this order.
create or replace function replay_model_rank(p_model text) returns integer language sql immutable as $$
  select coalesce(array_position(array['ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless','meteofrance_seamless',
                                        'gem_seamless','metno_seamless','dmi_seamless','ncep_hrrr_conus','jma_seamless'],
                                  split_part(p_model, '@', 1)), 99)
$$;
create or replace view replay_model_dups with (security_invoker = true) as
  select a.point_key, a.model, a.day
    from replay_wx_day a
    join replay_wx_day b on b.point_key = a.point_key and b.day = a.day and b.model <> a.model
                        and split_part(b.model, '@', 2) = split_part(a.model, '@', 2)
                        and replay_model_rank(b.model) < replay_model_rank(a.model)
                        and b.cloud = a.cloud and b.dr is not distinct from a.dr;

-- Daylight hours (sun above the horizon at the station): model total cloud at
-- the station's cell vs what the airport reported that hour.
create or replace function replay_fit_hidden() returns integer
language plpgsql as $$
declare n int;
begin
  truncate replay_hidden_counts;
  insert into replay_hidden_counts (trip_id, season, model, bin, n, hits)
  with hrs as (
    select distinct p.trip_id, o.hr, o.hidden
      from replay_places p
      join replay_hidden_obs o on o.trip_id = p.trip_id
      join metar_stations s on s.icao = p.station
     where exists (select 1 from replay_wx_day w where w.point_key = p.fc_point and w.day = (o.hr at time zone 'UTC')::date)
       and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0
  )
  select h.trip_id, replay_season((h.hr at time zone 'UTC')::date), w.model,
         replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]), count(*), sum(h.hidden)
    from hrs h
    join replay_places p on p.trip_id = h.trip_id
    join replay_wx_day w on w.point_key = p.fc_point and w.day = (h.hr at time zone 'UTC')::date
   where w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
     and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = w.day)
   group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end $$;

-- P(hidden) for a model and cloud bin, fitted on every season but p_season
-- (shrunk toward that model's overall rate with 2 pseudo-hours).
create or replace view replay_hidden_fit with (security_invoker = true) as
  with s as (select distinct trip_id, season from replay_hidden_counts),
  agg as (
    select s.trip_id, s.season, c.model, c.bin, sum(c.n) n, sum(c.hits) hits
      from s join replay_hidden_counts c on c.trip_id = s.trip_id and c.season <> s.season
     group by 1, 2, 3, 4),
  base as (select trip_id, season, model, sum(hits)::real / nullif(sum(n), 0) p0 from agg group by 1, 2, 3)
  select a.trip_id, a.season, a.model, a.bin, a.n, ((a.hits + 2 * b.p0) / (a.n + 2))::real as p
    from agg a join base b using (trip_id, season, model);

-- One score build for a replay day and forecast lead (see part 2). Members
-- are the models with direct radiation at every subject cell for that lead.
drop function if exists replay_build(bigint, text);
create or replace function replay_build(p_day bigint, p_kind text, p_lead integer default 1) returns uuid
language plpgsql as $$
declare v record; v_build uuid; v_rows int; v_models text[]; v_fc text[]; v_season int; v_fit jsonb;
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
       and (case when p_lead = 1 then w.model not like '%@%' else w.model like '%@' || p_lead end)
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

  insert into replay_builds (replay_day_id, kind, lead, members)
  values (p_day, p_kind, case when p_kind = 'forecast' then p_lead else 0 end, case when p_kind = 'forecast' then cardinality(v_models) else 1 end)
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
    select st.*, c.slot_at, c.light, date_trunc('hour', c.slot_at) + interval '1 hour' hr, date_trunc('hour', c.slot_at) obs_hr,
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) dir, solver_light_soft(c.sun_alt, st.lw) soft
      from st join solver_light_cache c on c.vantage_id = st.star_vantage_id and c.local_date = v.replay_date and c.sun_alt > -6
  ), pts as (
    select distinct case when p_kind = 'forecast' then fc_key else sat_key end pk, slat, slng, hr from slots
  ), alt as (
    select p.pk, p.hr, avg((select sp.altitude from sun_position(p.hr - interval '30 minutes', p.slat, p.slng) sp)) a
      from pts p group by p.pk, p.hr
  ), fc_m as (
    select a.pk, a.hr, mm.model, x.sv,
           coalesce((v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,
                    case when x.cloud is null then null else greatest(0, least(1, (x.cloud - 70) / 30.0)) end) ph
      from alt a cross join unnest(v_models) mm(model)
      cross join lateral (
        select w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] cloud,
               case when replay_clear_dni(a.a) * sin(radians(a.a)) >= 30 and w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1] is not null
                    then least(1, greatest(0, w.dr[extract(hour from a.hr at time zone 'UTC')::int + 1] / (replay_clear_dni(a.a) * sin(radians(a.a)))))
                    when w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] is not null
                    then greatest(0, least(1, 1 - (w.cloud[extract(hour from a.hr at time zone 'UTC')::int + 1] - 25) / 65.0)) end sv
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
    -- Truth: hidden as the airport reported that hour (nearest report within 2 h).
    select s.obs_hr, (select o.hidden from replay_hidden_obs o
                       where o.trip_id = v.trip_id and o.hr between s.obs_hr - interval '2 hours' and s.obs_hr + interval '2 hours'
                       order by abs(extract(epoch from o.hr - s.obs_hr)) limit 1) hidden
      from (select distinct obs_hr from slots) s
     where p_kind = 'truth'
  )
  select v_build, s.stop_id, s.slot_at,
         array_agg(round(250 * greatest(0, least(1,
           (case when s.light = 'no sun' then s.dir else u.x * s.dir + (1 - u.x) * s.soft end)
           * (case when s.fog_wanted then 0.6 + 0.4 * u.h else 1 - 0.9 * u.h end))))::smallint order by u.k)
    from slots s
    join sun on sun.pk = (case when p_kind = 'forecast' then s.fc_key else s.sat_key end) and sun.hr = s.hr
    left join obs on obs.obs_hr = s.obs_hr
    cross join lateral (
      select x, coalesce(case when p_kind = 'truth' then obs.hidden::real else hh end, 0) h, k
        from unnest(sun.sv, coalesce(sun.ph, array[null::real])) with ordinality q(x, hh, k)) u
   group by s.stop_id, s.slot_at;
  get diagnostics v_rows = row_count;
  update replay_builds set slots = v_rows where id = v_build;
  return v_build;
end $$;
