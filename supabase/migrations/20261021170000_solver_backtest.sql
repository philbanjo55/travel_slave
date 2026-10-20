-- Solver backtest (Phil, 20 Oct 2026: "how good is the solver"). Every saved
-- plan for a real forecast date is scored once that date has passed, against
-- what actually happened near each stop: the nearest webcam within 12 km
-- (Phil's tap first, then Claude's label) or the airport (EKVG METAR).
--
-- realized (0-1) per visit, at its peak time (start if none):
--   hills hidden by cloud/fog            -> 0   (fog-wanted stops: 1)
--   clear, stop wants direct light:
--     sun on the land                    -> 1
--     no sun                             -> 0.4
--   clear, soft light is fine            -> 1   (fog-wanted stops: 0.5)
-- baseline: the same stop and truth source at every daylight hour that day,
-- i.e. what turning up at a random time would have given. lift = realized -
-- baseline is "did the timing help". Brier compares the plan's p_good with
-- realized >= 0.75. Light-only plans (no weather) are skipped.
--
-- Scored rows are kept; runs are not touched. pg_cron solver-backtest
-- (23:33 UTC, after solver-verify) scores whatever became scorable.

create table if not exists public.solver_backtest (
  run_id uuid not null,
  plan_rank integer not null,
  plan_kind text not null,          -- best | alt | safest | my_day
  trip_id uuid not null,
  plan_date date not null,          -- the forecast date the visit was planned on
  lead_days integer not null,       -- plan_date minus the run's local creation date
  stop_id uuid not null,
  tier text,
  visit_at timestamptz not null,
  truth_source text,                -- webcam code or EKVG; null = no truth nearby
  truth_km real,
  hidden boolean,
  sun boolean,
  realized real,
  baseline real,
  p_good real,
  value real,
  scored_at timestamptz not null default now(),
  primary key (run_id, plan_rank, stop_id, visit_at)
);

create or replace function public.solver_realized(p_hidden boolean, p_sun boolean, p_fog_wanted boolean, p_need_sun boolean)
returns real language sql immutable as $$
  select case when p_hidden is null then null
              when coalesce(p_fog_wanted, false) then case when p_hidden then 1 else 0.5 end
              when p_hidden then 0
              when p_need_sun and p_sun is not null then case when p_sun then 1 else 0.4 end
              else 1 end::real
$$;

-- p_dry_run_today: score today's plans too and return the count without
-- keeping them (testing before a day has passed).
create or replace function public.solver_backtest_run(p_dry_run_today boolean default false)
returns integer language plpgsql set search_path = public as $$
declare v_rows integer;
begin
  with visits as (
    select r.id as run_id, r.trip_id, p.rank, p.note, v,
           (v->>'date')::date as d,
           coalesce(v->>'peak_at', v->>'start')::timestamptz as t,
           solver_trip_tz(r.trip_id) as tz, r.created_at
      from solver_runs r
      join solver_plans p on p.run_id = r.id
      cross join lateral jsonb_array_elements(p.visits) v
     where coalesce(p.note, '') <> 'apply test'
       and v->>'start' is not null and v->>'date' is not null
       and not exists (select 1 from jsonb_array_elements(r.stats->'days') dd
                        where dd->>'date' = v->>'date' and coalesce((dd->>'light_only')::boolean, false))
  ), due as (
    select vi.*, s.lat, s.lng, i.tier, i.fog_wanted,
           coalesce(i.light_wanted, '{front,side}') && '{front,side,back}'::text[]
             and not ('soft' = any(coalesce(i.light_wanted, '{front,side}'))) as need_sun
      from visits vi
      join stops s on s.id = (vi.v->>'stop_id')::uuid
      left join solver_stop_inputs i on i.stop_id = s.id
     where (vi.d < (now() at time zone vi.tz)::date or (p_dry_run_today and vi.d = (now() at time zone vi.tz)::date))
       and s.lat is not null
       and not exists (select 1 from solver_backtest b where b.run_id = vi.run_id and b.plan_rank = vi.rank
                          and b.stop_id = s.id and b.visit_at = vi.t)
  ), src as (
    select code as src, 'webcam' as kind, lat, lng from webcam_cameras where lat is not null
    union all
    select icao, 'airport', lat, lng from metar_stations where icao = 'EKVG'
  ), frame_truth as (
    select f.camera_code as src, f.captured_at as at,
           case when f.phil_label = 'clear' then false
                when f.phil_label in ('cloud_on_hills', 'fog') then true
                when f.phil_label = 'cant_tell' then null
                when f.label_model like 'claude%' and f.label not in ('dark', 'camera_problem') then not f.hills_visible end as hidden,
           case when f.label_model like 'claude%' and f.label not in ('dark', 'camera_problem') then f.sun_on_land end as sun
      from webcam_frames f where f.sun_altitude > 3
  ), air_truth as (
    select o.station as src, o.hr as at,
           case when o.ceiling_ft is not null or o.cloud_pct is not null or o.fog
                then coalesce(o.ceiling_ft < 2000, false) or coalesce(o.fog, false) end as hidden,
           case when o.cloud_pct is not null then o.cloud_pct <= 50 end as sun
      from station_obs_hourly o
     where o.station = 'EKVG'
       -- daylight hours: an hour with any daylight webcam frame
       and exists (select 1 from webcam_frames f where f.sun_altitude > 3 and date_trunc('hour', f.captured_at) = o.hr)
  ), truth as (
    select * from frame_truth where hidden is not null
    union all
    select * from air_truth where hidden is not null
  ), scored as (
    select du.*, pick.src, pick.km, pick.hidden, pick.sun
      from due du
      left join lateral (
        select sr.src, tr.hidden, tr.sun,
               12742 * asin(sqrt(power(sin(radians(sr.lat - du.lat) / 2), 2)
                 + cos(radians(du.lat)) * cos(radians(sr.lat)) * power(sin(radians(sr.lng - du.lng) / 2), 2))) as km
          from src sr
          join truth tr on tr.src = sr.src and abs(extract(epoch from tr.at - du.t)) <= 2700
         where 12742 * asin(sqrt(power(sin(radians(sr.lat - du.lat) / 2), 2)
                 + cos(radians(du.lat)) * cos(radians(sr.lat)) * power(sin(radians(sr.lng - du.lng) / 2), 2))) <= 12
         order by 4, abs(extract(epoch from tr.at - du.t))
         limit 1
      ) pick on true
  )
  insert into solver_backtest (run_id, plan_rank, plan_kind, trip_id, plan_date, lead_days, stop_id, tier, visit_at,
                               truth_source, truth_km, hidden, sun, realized, baseline, p_good, value)
  select sc.run_id, sc.rank,
         case when sc.note like 'my day%' then 'my_day' when sc.note like 'safest%' then 'safest'
              when sc.rank = 1 then 'best' else 'alt' end,
         sc.trip_id, sc.d, sc.d - (sc.created_at at time zone sc.tz)::date,
         (sc.v->>'stop_id')::uuid, sc.tier, sc.t, sc.src, round(sc.km::numeric, 1),
         sc.hidden, sc.sun, solver_realized(sc.hidden, sc.sun, sc.fog_wanted, sc.need_sun),
         (select avg(solver_realized(tr.hidden, tr.sun, sc.fog_wanted, sc.need_sun))
            from truth tr where tr.src = sc.src and (tr.at at time zone sc.tz)::date = sc.d),
         (sc.v->>'p_good')::real, (sc.v->>'value')::real
    from scored sc
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if p_dry_run_today then
    raise exception 'dry run (rolled back): % visits; %', v_rows,
      (select jsonb_agg(jsonb_build_object('kind', plan_kind, 'tier', tier, 'src', truth_source, 'km', truth_km,
                                           'at', to_char(visit_at, 'HH24:MI'), 'hidden', hidden, 'sun', sun,
                                           'realized', realized, 'baseline', round(baseline::numeric, 2), 'p_good', p_good)
                        order by plan_kind, visit_at)
         from solver_backtest where scored_at = now());
  end if;
  return v_rows;
end $$;

-- One line per plan kind over the last p_days days of plan dates.
-- p_tiers limits to those tiers (default GOD and S, the stops that matter).
create or replace function public.solver_backtest_report(p_days integer default 30, p_tiers text[] default '{GOD,S}')
returns table (plan_kind text, plan_days bigint, visits bigint, with_truth bigint, mean_p_good numeric,
               hit_rate numeric, mean_realized numeric, mean_baseline numeric, lift numeric, brier numeric)
language sql stable set search_path = public as $$
  select plan_kind, count(distinct plan_date), count(*), count(realized),
         round(avg(p_good) filter (where realized is not null)::numeric, 2),
         round(avg((realized >= 0.75)::int)::numeric, 2),
         round(avg(realized)::numeric, 2),
         round(avg(baseline) filter (where realized is not null)::numeric, 2),
         round(avg(realized - baseline)::numeric, 2),
         round(avg(power(p_good - (realized >= 0.75)::int, 2))::numeric, 3)
    from solver_backtest
   where plan_date >= current_date - p_days and (p_tiers is null or tier = any(p_tiers))
   group by plan_kind
   order by array_position(array['best', 'safest', 'alt', 'my_day'], plan_kind);
$$;

select cron.schedule('solver-backtest', '33 23 * * *', $$select public.solver_backtest_run()$$);

-- Scoreboard fix: a frame Claude calls dark or camera_problem is no truth at
-- all; before this it fell through to the edge heuristic.
do $do$
declare d text := pg_get_functiondef('public.solver_verify_run'::regproc);
declare n text;
begin
  n := replace(d,
$a$                when b.n >= 5 then f.edge_top < 0.5 * b.clear_edge end as hidden$a$,
$b$                when f.label_model like 'claude%' and f.label in ('dark', 'camera_problem') then null
                when b.n >= 5 then f.edge_top < 0.5 * b.clear_edge end as hidden$b$);
  if n = d then raise exception 'solver_verify_run text not matched'; end if;
  execute n;
end $do$;
