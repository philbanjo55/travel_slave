-- Side-by-side test (Phil, 21 Oct 2026) on 🧪 Faroes Live: a second nightly
-- score build ("calib") where each ECMWF member's sun visibility is the
-- observed chance of a mostly clear sky at the trip's airport for that
-- member's max(low, mid) cloud and lead day (solver_calibration, fitted on
-- that place and season), instead of the made-up ramp (clear below 25%,
-- overcast above 90%), and hills count as hidden at least as often as the
-- airport saw a ceiling below 2000 ft for that low cloud. Plans from it are stored with stats.variant 'calib'
-- and kind 'calib_day' / 'calib_multi', so the app and the normal backtest
-- summary ignore them; solver_backtest_compare() scores both side by side.

alter table public.solver_score_builds add column if not exists variant text not null default 'raw';

-- Every "latest build" reader takes the normal one.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.solver_subject_grid(uuid)'::regprocedure);
  d := replace(d, 'from solver_score_builds b where b.trip_id = p_trip order by b.built_at desc limit 1',
                  'from solver_score_builds b where b.trip_id = p_trip and b.variant = ''raw'' order by b.built_at desc limit 1');
  if d not like '%b.variant = ''raw''%' then raise exception 'solver_subject_grid: pattern not found'; end if;
  execute d;

  d := pg_get_functiondef('public.solver_mark_shot(uuid,text,timestamp with time zone,real)'::regprocedure);
  d := replace(d, 'join solver_score_builds b on b.id = s2.build_id', 'join solver_score_builds b on b.id = s2.build_id and b.variant = ''raw''');
  if d not like '%b.variant = ''raw''%' then raise exception 'solver_mark_shot: pattern not found'; end if;
  execute d;

  d := pg_get_functiondef('public.trip_readiness(uuid)'::regprocedure);
  d := replace(d, 'from solver_score_builds b where b.trip_id = p_trip;', 'from solver_score_builds b where b.trip_id = p_trip and b.variant = ''raw'';');
  if d not like '%b.variant = ''raw''%' then raise exception 'trip_readiness: pattern not found'; end if;
  execute d;

  d := pg_get_functiondef('public.solver_backtest_summary(integer,text[],integer)'::regprocedure);
  d := replace(d, E'from solver_backtest b join solver_runs r on r.id = b.run_id\n     order by',
                  E'from solver_backtest b join solver_runs r on r.id = b.run_id\n     where coalesce(r.stats->>''variant'', ''raw'') = ''raw''\n     order by');
  if d not like '%stats->>''variant''%' then raise exception 'solver_backtest_summary: pattern not found'; end if;
  execute d;
end $$;

-- Keep the newest 3 builds per trip and variant.
create or replace function public.solver_prune_builds(p_trip_id uuid, p_keep integer default 3)
 returns integer language plpgsql set search_path to 'public'
as $function$
declare n integer;
begin
  delete from solver_score_builds b
   where b.trip_id = p_trip_id
     and b.id not in (select x.id from solver_score_builds x where x.trip_id = p_trip_id and x.variant = b.variant
                       order by x.built_at desc limit greatest(p_keep, 1));
  get diagnostics n = row_count;
  return n;
end $function$;

-- The builder. Variant from the session setting solver.variant ('raw' when
-- unset), so the nightly call is unchanged; solver_build_calib() sets it.
create or replace function public.solver_build_scores(p_trip_id uuid, p_pull_id uuid default null::uuid)
 returns jsonb language plpgsql set search_path to 'public'
as $function$
declare
  t0 timestamptz := clock_timestamp();
  v_tz text;
  v_pull uuid := p_pull_id;
  v_pulled timestamptz;
  v_build uuid;
  v_dates date[];
  v_stops integer;
  v_rows integer;
  v_variant text := coalesce(nullif(current_setting('solver.variant', true), ''), 'raw');
  v_site text;
  v_cal_source text := coalesce(nullif(current_setting('solver.calib_source', true), ''), 'history_octnov');
  v_cal real[];   -- [lead 0..5 + 1][max(low, mid) cloud bin]: observed P(mostly clear)
  v_low real[];   -- [low cloud bin]: observed P(ceiling below 2000 ft), lead 0
begin
  v_tz := solver_trip_tz(p_trip_id);
  if v_tz is null then raise exception 'trip % not found', p_trip_id; end if;
  if v_variant not in ('raw', 'calib') then raise exception 'unknown solver.variant %', v_variant; end if;

  if v_pull is null then
    select p.id into v_pull from weather_ensemble_pulls p
     where exists (select 1 from weather_ensemble e join stop_cell_map m on m.cell_key = e.cell_key
                    where e.pull_id = p.id and e.model = 'ecmwf_ifs025' and m.trip_id = p_trip_id)
     order by p.pulled_at desc limit 1;
  end if;
  if v_pull is null then return jsonb_build_object('ok', false, 'error', 'no ECMWF pull covers this trip'); end if;
  select pulled_at into v_pulled from weather_ensemble_pulls where id = v_pull;

  if v_variant = 'calib' then
    select metar_station into v_site from trips where id = p_trip_id;
    if v_site is null then raise exception 'calib build needs trips.metar_station'; end if;
    -- One row of 6 cloud bins per lead day 0-5; a lead with no fit uses the
    -- nearest shorter one (history has low/mid cloud at lead 0 only).
    with fits as (
      select c.lead_day, array_agg(c.p_obs order by c.bin_lo) r
        from solver_calibration c
       where c.source = v_cal_source and c.site = v_site and c.event = 'mostly_clear' and c.predictor = 'max_low_mid'
       group by c.lead_day having count(*) = 6)
    select array_agg((select f.r from fits f where f.lead_day <= l order by f.lead_day desc limit 1) order by l) into v_cal
      from generate_series(0, 5) l;
    if v_cal is null or array_length(v_cal, 1) < 6 or exists (select 1 from unnest(v_cal) x where x is null) then
      raise exception 'calibration % at % is incomplete (need lead day 0 x 6 cloud bins)', v_cal_source, v_site;
    end if;
    -- Hills hidden: the observed chance of a ceiling below 2000 ft for the
    -- member's low cloud (ECMWF under-forecasts it: 21% even below 10%).
    select array_agg(c.p_obs order by c.bin_lo) into v_low
      from solver_calibration c
     where c.source = v_cal_source and c.site = v_site and c.event = 'low_cloud' and c.predictor = 'cloud_low' and c.lead_day = 0;
    if v_low is null or array_length(v_low, 1) <> 6 then
      raise exception 'calibration % at % has no low_cloud fit', v_cal_source, v_site;
    end if;
  end if;

  select array_agg(distinct (e.valid_at at time zone v_tz)::date) into v_dates
    from weather_ensemble e
   where e.pull_id = v_pull and e.model = 'ecmwf_ifs025'
     and e.cell_key in (select cell_key from stop_cell_map where trip_id = p_trip_id);

  perform solver_fill_light_cache(p_trip_id, v_dates, 3600);

  insert into solver_score_builds (trip_id, pull_id, variant) values (p_trip_id, v_pull, v_variant) returning id into v_build;

  insert into solver_scores (build_id, stop_id, slot_at, v)
  with st as (
    select i.stop_id, i.star_vantage_id, coalesce(i.light_wanted, '{front,side}') lw,
           i.fog_wanted, i.rain_bonus, s.elevation_m elev, m.cell_key
      from solver_stop_inputs i
      join stops s on s.id = i.stop_id
      join stop_cell_map m on m.stop_id = i.stop_id
     where i.trip_id = p_trip_id and i.tier is not null and i.star_vantage_id is not null
  ), cells as (select distinct cell_key from st),
  ecm as (
    select e.cell_key, e.valid_at, u.k, u.cl, u.cm, u.rh, u.t, u.td, u.p, u.g
      from weather_ensemble e
      cross join lateral unnest(e.cloud_low, e.cloud_mid, e.rh, e.temp_c10, e.dew_c10, e.precip_mm10, e.gust_kmh10)
           with ordinality u(cl, cm, rh, t, td, p, g, k)
     where e.pull_id = v_pull and e.model = 'ecmwf_ifs025' and e.cell_key in (select cell_key from cells)
  ), ecm24 as (
    select *, sum(coalesce(p, 0) * hrs) over (partition by cell_key, k order by valid_at
                                              range between interval '21 hours' preceding and current row) / 10.0 as rain24
      from (select *, coalesce(extract(epoch from valid_at - lag(valid_at) over (partition by cell_key, k order by valid_at)) / 3600, 3) as hrs
              from ecm) e
  ), visp as (
    select e.cell_key, e.model, e.valid_at,
           (select avg((x < 1000)::int) from unnest(e.vis) x where x is not null) p_low
      from weather_ensemble e
     where e.pull_id = v_pull and e.model in ('gfs025', 'ukmo_global_ensemble_20km')
       and e.cell_key in (select cell_key from cells)
  ), harm as (
    select e.cell_key, e.valid_at,
           coalesce(e.vis[1] < 1000, false) or coalesce(e.cloud_2m[1] >= 50, false) as fog,
           e.cloud_base[1] as base
      from weather_ensemble e
     where e.pull_id = v_pull and e.model = 'dmi_harmonie_arome_europe'
       and e.cell_key in (select cell_key from cells)
  ), slots as (
    select st.*, c.slot_at, c.sun_alt, c.light, c.sun_visible,
           case when c.slot_at > v_pulled + interval '144 hours'
                then to_timestamp(round(extract(epoch from c.slot_at) / 21600) * 21600)
                else to_timestamp(round(extract(epoch from c.slot_at) / 10800) * 10800) end as at3,
           to_timestamp(round(extract(epoch from c.slot_at) / 3600) * 3600) as at1,
           least(5, greatest(0, floor(extract(epoch from c.slot_at - v_pulled) / 86400)))::int as lead,
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) as dir,
           solver_light_soft(c.sun_alt, st.lw) as soft
      from st join solver_light_cache c
        on c.vantage_id = st.star_vantage_id and c.local_date = any(v_dates) and c.sun_alt > -6
  ), shared as (
    select s.stop_id, s.slot_at,
           greatest(
             coalesce((select avg(x) from unnest(array[g.p_low, u.p_low]) x), 0),
             coalesce(h.fog::int, 0),
             case when h.base is not null and s.elev is not null and s.elev >= h.base then 1 else 0 end
           )::real as gate
      from slots s
      left join visp g on g.cell_key = s.cell_key and g.model = 'gfs025' and g.valid_at = s.at3
      left join visp u on u.cell_key = s.cell_key and u.model = 'ukmo_global_ensemble_20km' and u.valid_at = s.at1
      left join harm h on h.cell_key = s.cell_key and h.valid_at = s.at1
  ), per_member as (
    select s.stop_id, s.slot_at, w.k, s.dir, s.soft,
      case when v_variant = 'calib' then
        coalesce(v_cal[s.lead + 1][case when greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) < 10 then 1
                                        when greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) < 30 then 2
                                        when greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) < 50 then 3
                                        when greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) < 70 then 4
                                        when greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) < 90 then 5 else 6 end],
                 greatest(0, least(1, 1 - (greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) - 25) / 65.0)))
      else greatest(0, least(1, 1 - (greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) - 25) / 65.0)) end as sun_vis,
      1 - 0.8 * least(coalesce(w.p, 0) / 10.0 / 1.5, 1) as rain_f,
      case when coalesce(w.g, 0) / 10.0 <= 35 then 1.0 else greatest(0.2, 1 - (w.g / 10.0 - 35) / 45.0) end as wind_f,
      1 - (1 - least(1, greatest(0, (coalesce(w.rh, 0) - 94) / 5.0)) * least(1, greatest(0, (coalesce(w.cl, 0) - 50) / 50.0)))
        * (1 - case when s.elev is not null and w.cl >= 70 and w.t is not null and w.td is not null
                     and s.elev > 125 * (w.t - w.td) / 10.0 then 1 else 0 end)
        * (1 - 0.7 * coalesce(sh.gate, 0)) as fog,
      case when v_variant = 'calib' then v_low[case when coalesce(w.cl, 100) < 10 then 1 when coalesce(w.cl, 100) < 30 then 2 when coalesce(w.cl, 100) < 50 then 3 when coalesce(w.cl, 100) < 70 then 4 when coalesce(w.cl, 100) < 90 then 5 else 6 end] else 0 end as low_p,
      s.light = 'no sun' as blue,
      s.fog_wanted, s.rain_bonus, w.rain24
      from slots s
      join ecm24 w on w.cell_key = s.cell_key and w.valid_at = s.at3
      left join shared sh on sh.stop_id = s.stop_id and sh.slot_at = s.slot_at
  )
  select v_build, stop_id, slot_at,
         array_agg(round(250 * greatest(0, least(1,
           (case when blue then dir else sun_vis * dir + (1 - sun_vis) * soft end)
           * rain_f * wind_f
           * (case when fog_wanted then 0.6 + 0.4 * greatest(fog, low_p) else 1 - 0.9 * greatest(fog, low_p) end)
           * (case when rain_bonus then 1 + 0.3 * least(coalesce(rain24, 0) / 10.0, 1) else 1 end)
         )))::smallint order by k)
    from per_member
   group by stop_id, slot_at;
  get diagnostics v_rows = row_count;

  select count(distinct stop_id) into v_stops from solver_scores where build_id = v_build;
  update solver_score_builds set stops = v_stops, slots = v_rows,
         ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
   where id = v_build;

  return jsonb_build_object('ok', true, 'build_id', v_build, 'pull_id', v_pull, 'tz', v_tz, 'dates', v_dates,
                            'stops', v_stops, 'slots', v_rows, 'variant', v_variant,
                            'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $function$;

-- The calibrated build for one trip (then prune per variant).
create or replace function public.solver_build_calib(p_trip_id uuid, p_source text default 'history_octnov')
 returns jsonb language plpgsql set search_path to 'public'
as $function$
declare r jsonb;
begin
  perform set_config('solver.variant', 'calib', true);
  perform set_config('solver.calib_source', p_source, true);
  r := solver_build_scores(p_trip_id);
  perform set_config('solver.variant', 'raw', true);
  return r || jsonb_build_object('pruned', solver_prune_builds(p_trip_id));
end $function$;
revoke execute on function public.solver_build_calib(uuid, text) from public, anon, authenticated;

-- Normal vs calibrated, scored the same way (latest run per variant, trip,
-- date, lead and single/multi).
create or replace function public.solver_backtest_compare(p_days integer default 30, p_tiers text[] default null, p_min_lead integer default 0)
 returns table(variant text, plan_kind text, plan_days bigint, visits bigint, with_truth bigint, mean_p_good numeric,
               hit_rate numeric, mean_realized numeric, mean_baseline numeric, lift numeric, brier numeric)
 language sql stable set search_path to 'public'
as $function$
  with runs as (
    select r.id, r.created_at, coalesce(r.stats->>'variant', 'raw') as variant from solver_runs r
  ), latest as (
    select distinct on (ru.variant, b.trip_id, b.plan_date, b.lead_days, b.multi) ru.variant, b.run_id, b.plan_date
      from solver_backtest b join runs ru on ru.id = b.run_id
     order by ru.variant, b.trip_id, b.plan_date, b.lead_days, b.multi, ru.created_at desc
  ), sel as (
    select l.variant, b.* from solver_backtest b join latest l on l.run_id = b.run_id and l.plan_date = b.plan_date
     where b.plan_date >= current_date - p_days and b.lead_days >= p_min_lead
       and (p_tiers is null or b.tier = any(p_tiers))
       and exists (select 1 from solver_runs r where r.id = b.run_id
                     and r.trip_id in (select trip_id from solver_runs where stats->>'variant' = 'calib'))
  )
  select variant, plan_kind, count(distinct plan_date), count(*), count(realized),
         round(avg(p_good) filter (where realized is not null)::numeric, 2),
         round(avg((realized >= 0.75)::int)::numeric, 2),
         round(avg(realized)::numeric, 2),
         round(avg(baseline) filter (where realized is not null)::numeric, 2),
         round(avg(realized - baseline)::numeric, 2),
         round(avg(power(p_good - (realized >= 0.75)::int, 2))::numeric, 3)
    from sel
   group by variant, plan_kind
   order by plan_kind, variant;
$function$;

-- The correction for this test: Oct/Nov at EKVG (METAR Oct 2016-2025, Nov
-- 2017-19 and 2024-25; ECMWF previous runs Oct/Nov 2024-25), loaded with
-- calib_queue_month + calib_load_history (one request at a time: IEM throttles).
select public.solver_fit_calibration_months('EKVG', 'history_octnov', array[10, 11]);

-- Nightly: normal plans from normal builds only; the calibrated build and its
-- plans for the test trip.
select cron.schedule('solver-plan', '55 22 * * *', $cmd$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
    body := q.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000)
  from (
    -- time zone looked up once per trip (it was called per score row: thousands of calls)
    with b as (
      select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
        from public.solver_score_builds sb
        join public.trips t on t.id = sb.trip_id and t.archived is not true
       where sb.variant = 'raw'
       order by sb.trip_id, sb.built_at desc),
    d as (
      select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
        from b join public.solver_scores s on s.build_id = b.id)
    select jsonb_build_object('trip_id', d.trip_id, 'date', d.d) as body from d
    union all
    select jsonb_build_object('trip_id', b.trip_id,
             'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                        from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
      from b
  ) q;
$cmd$);
select cron.schedule('solver-build-calib', '49 22 * * *', $cmd$
  select public.solver_build_calib('7e57bed0-0000-4000-8000-000000000002');
$cmd$);
select cron.schedule('solver-plan-calib', '3 23 * * *', $cmd$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
    body := q.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000)
  from (
    -- 🧪 Faroes Live only: the same calls as solver-plan, from the calibrated build
    with b as (
      select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
        from public.solver_score_builds sb
       where sb.variant = 'calib' and sb.trip_id = '7e57bed0-0000-4000-8000-000000000002'
       order by sb.trip_id, sb.built_at desc),
    d as (
      select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
        from b join public.solver_scores s on s.build_id = b.id)
    select jsonb_build_object('trip_id', d.trip_id, 'date', d.d, 'variant', 'calib') as body from d
    union all
    select jsonb_build_object('trip_id', b.trip_id, 'variant', 'calib',
             'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                        from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
      from b
  ) q;
$cmd$);
