-- Backtest v2: per-trip timezone looked up once (materialized), multi-day
-- runs flagged, visits scored without truth are retried for 3 days (late
-- Claude labels, Phil's taps the next morning), and solver_backtest_summary
-- counts one run per plan date and lead (the latest), by default night-before
-- plans only.

alter table public.solver_backtest add column if not exists multi boolean not null default false;

-- p_dry_run_today: score today's plans too and return the count without
-- keeping them (testing before a day has passed).
create or replace function public.solver_backtest_run(p_dry_run_today boolean default false)
returns integer language plpgsql set search_path = public as $$
declare v_rows integer;
begin
  with tzs as materialized (
    select t.id, solver_trip_tz(t.id) as tz from trips t where t.id in (select distinct trip_id from solver_runs)
  ), visits as (
    select r.id as run_id, r.trip_id, p.rank, p.note, v,
           (v->>'date')::date as d,
           coalesce(v->>'peak_at', v->>'start')::timestamptz as t,
           tzs.tz, r.created_at, coalesce(jsonb_array_length(r.params->'days'), 1) > 1 as multi
      from solver_runs r
      join tzs on tzs.id = r.trip_id
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
       -- not scored yet, or scored without truth and still within 3 days (late labels, Phil's taps)
       and not exists (select 1 from solver_backtest b where b.run_id = vi.run_id and b.plan_rank = vi.rank
                          and b.stop_id = s.id and b.visit_at = vi.t
                          and (b.realized is not null or vi.d < (now() at time zone vi.tz)::date - 3))
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
  insert into solver_backtest (run_id, plan_rank, plan_kind, trip_id, plan_date, lead_days, multi, stop_id, tier, visit_at,
                               truth_source, truth_km, hidden, sun, realized, baseline, p_good, value)
  select distinct on (sc.run_id, sc.rank, (sc.v->>'stop_id')::uuid, sc.t) sc.run_id, sc.rank,
         case when sc.note like 'my day%' then 'my_day' when sc.note like 'safest%' then 'safest'
              when sc.rank = 1 then 'best' else 'alt' end,
         sc.trip_id, sc.d, sc.d - (sc.created_at at time zone sc.tz)::date, sc.multi,
         (sc.v->>'stop_id')::uuid, sc.tier, sc.t, sc.src, round(sc.km::numeric, 1),
         sc.hidden, sc.sun, solver_realized(sc.hidden, sc.sun, sc.fog_wanted, sc.need_sun),
         (select avg(solver_realized(tr.hidden, tr.sun, sc.fog_wanted, sc.need_sun))
            from truth tr where tr.src = sc.src and (tr.at at time zone sc.tz)::date = sc.d),
         (sc.v->>'p_good')::real, (sc.v->>'value')::real
    from scored sc
  on conflict (run_id, plan_rank, stop_id, visit_at) do update set
    truth_source = excluded.truth_source, truth_km = excluded.truth_km, hidden = excluded.hidden, sun = excluded.sun,
    realized = excluded.realized, baseline = excluded.baseline, scored_at = excluded.scored_at
    where solver_backtest.realized is null;
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

-- The report to read. solver_backtest_report (v1) counts every run, dev runs
-- included; this one counts the latest run per plan date and lead.
create or replace function public.solver_backtest_summary(p_days integer default 30, p_tiers text[] default '{GOD,S}',
                                                          p_min_lead integer default 1)
returns table (plan_kind text, plan_days bigint, visits bigint, with_truth bigint, mean_p_good numeric,
               hit_rate numeric, mean_realized numeric, mean_baseline numeric, lift numeric, brier numeric)
language sql stable set search_path = public as $$
  with latest as (
    select distinct on (b.trip_id, b.plan_date, b.lead_days, b.multi) b.trip_id, b.plan_date, b.lead_days, b.multi, b.run_id
      from solver_backtest b join solver_runs r on r.id = b.run_id
     order by b.trip_id, b.plan_date, b.lead_days, b.multi, r.created_at desc
  ), sel as (
    select b.* from solver_backtest b join latest l on l.run_id = b.run_id and l.plan_date = b.plan_date
     where b.plan_date >= current_date - p_days and b.lead_days >= p_min_lead
       and (p_tiers is null or b.tier = any(p_tiers))
  )
  select plan_kind, count(distinct plan_date), count(*), count(realized),
         round(avg(p_good) filter (where realized is not null)::numeric, 2),
         round(avg((realized >= 0.75)::int)::numeric, 2),
         round(avg(realized)::numeric, 2),
         round(avg(baseline) filter (where realized is not null)::numeric, 2),
         round(avg(realized - baseline)::numeric, 2),
         round(avg(power(p_good - (realized >= 0.75)::int, 2))::numeric, 3)
    from sel
   group by plan_kind
   order by array_position(array['best', 'safest', 'alt', 'my_day'], plan_kind);
$$;
