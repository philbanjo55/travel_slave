-- Backtest truth for hidden peaks (Phil, 25 Oct 2026: use TetonCam "as a
-- weather check as well then for clouds etc").
-- 1. A camera can look at a range from far away: webcam_cameras.view_lat /
--    view_lng / view_km is the area whose peaks it shows. For a visit whose
--    starred subject lies in that area, the camera's "hills hidden" reading
--    (frame within 45 min) also counts: hidden when the nearest truth or the
--    camera says so. GT-TETONIA (Tetonia, ID, ~29 km west of the Grand) shows
--    the Grand Teton to Mount Moran: every Teton shot has them behind it.
--    The day's baseline gets the same rule hour by hour.
-- 2. "Hidden" from an airport was ceiling < 2000 ft everywhere (right for
--    Vagar). metar_stations.hidden_ceiling_ft sets it per station: KJAC 7000
--    (the Grand is ~7,300 ft above the airport; the test bench used 7000 too).
-- Teton backtest rows from the last 3 days are scored again with the new rule.

alter table webcam_cameras add column if not exists view_lat double precision;
alter table webcam_cameras add column if not exists view_lng double precision;
alter table webcam_cameras add column if not exists view_km real;
update webcam_cameras set view_lat = 43.79, view_lng = -110.79, view_km = 12 where code = 'GT-TETONIA';

alter table metar_stations add column if not exists hidden_ceiling_ft integer;
update metar_stations set hidden_ceiling_ft = 7000 where icao = 'KJAC';

create or replace function public.solver_backtest_run(p_dry_run_today boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    select vi.*, s.lat, s.lng, i.tier, i.fog_wanted, su.lat su_lat, su.lng su_lng,
           coalesce(i.light_wanted, '{front,side}') && '{front,side,back}'::text[]
             and not ('soft' = any(coalesce(i.light_wanted, '{front,side}'))) as need_sun
      from visits vi
      join stops s on s.id = (vi.v->>'stop_id')::uuid
      left join solver_stop_inputs i on i.stop_id = s.id
      left join scout_vantages vv on vv.id = i.star_vantage_id
      left join scout_subjects su on su.id = vv.subject_id
     where (vi.d < (now() at time zone vi.tz)::date or (p_dry_run_today and vi.d = (now() at time zone vi.tz)::date))
       and s.lat is not null
       -- not scored yet, or scored without truth and still within 3 days (late labels, Phil's taps)
       and not exists (select 1 from solver_backtest b where b.run_id = vi.run_id and b.plan_rank = vi.rank
                          and b.stop_id = s.id and b.visit_at = vi.t
                          and (b.realized is not null or vi.d < (now() at time zone vi.tz)::date - 3))
  ), src as (
    select code as src, 'webcam' as kind, lat, lng from webcam_cameras where lat is not null
    union all
    select icao, 'airport', lat, lng from metar_stations where lat is not null
  ), frame_truth as (
    select f.camera_code as src, f.captured_at as at,
           case when f.phil_label = 'clear' then false
                when f.phil_label in ('cloud_on_hills', 'fog') then true
                when f.phil_label = 'cant_tell' then null
                when f.label_model like 'claude%' and f.label not in ('dark', 'camera_problem') then not f.hills_visible end as hidden,
           case when f.label_model like 'claude%' and f.label not in ('dark', 'camera_problem') then f.sun_on_land end as sun
      from webcam_frames f where f.sun_altitude > 3 and not f.stale
  ), air_truth as (
    select o.station as src, o.hr as at,
           case when o.ceiling_ft is not null or o.cloud_pct is not null or o.fog
                then coalesce(o.ceiling_ft < coalesce(m.hidden_ceiling_ft, 2000), false) or coalesce(o.fog, false) end as hidden,
           case when o.cloud_pct is not null then o.cloud_pct <= 50 end as sun
      from station_obs_hourly o
      join metar_stations m on m.icao = o.station
     -- daylight hours at the airport itself
     where (select sp.altitude from sun_position(o.hr, m.lat, m.lng) sp) > 3
  ), truth as (
    select * from frame_truth where hidden is not null
    union all
    select * from air_truth where hidden is not null
  ), scored as (
    select du.*, pick.src, pick.km, pick.sun, vh.src vsrc,
           case when pick.hidden is null then vh.hidden when vh.hidden is null then pick.hidden
                else pick.hidden or vh.hidden end hidden
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
      -- A camera looking at the visit's subject from afar (peaks in cloud).
      left join lateral (
        select c.code src, fr.hidden
          from webcam_cameras c
          join frame_truth fr on fr.src = c.code and fr.hidden is not null and abs(extract(epoch from fr.at - du.t)) <= 2700
         where c.view_km is not null and du.su_lat is not null
           and 12742 * asin(sqrt(power(sin(radians(c.view_lat - du.su_lat) / 2), 2)
                 + cos(radians(du.su_lat)) * cos(radians(c.view_lat)) * power(sin(radians(c.view_lng - du.su_lng) / 2), 2))) <= c.view_km
         order by fr.hidden desc, abs(extract(epoch from fr.at - du.t))
         limit 1
      ) vh on true
  )
  insert into solver_backtest (run_id, plan_rank, plan_kind, trip_id, plan_date, lead_days, multi, stop_id, tier, visit_at,
                               truth_source, truth_km, hidden, sun, realized, baseline, p_good, value)
  select distinct on (sc.run_id, sc.rank, (sc.v->>'stop_id')::uuid, sc.t) sc.run_id, sc.rank,
         case when sc.note like 'my day%' then 'my_day' when sc.note like 'safest%' then 'safest'
              when sc.rank = 1 then 'best' else 'alt' end,
         sc.trip_id, sc.d, sc.d - (sc.created_at at time zone sc.tz)::date, sc.multi,
         (sc.v->>'stop_id')::uuid, sc.tier, sc.t,
         case when sc.vsrc is not null and sc.src is not null and sc.vsrc <> sc.src then sc.src || '+' || sc.vsrc else coalesce(sc.src, sc.vsrc) end,
         round(sc.km::numeric, 1),
         sc.hidden, sc.sun, solver_realized(sc.hidden, sc.sun, sc.fog_wanted, sc.need_sun),
         (select avg(solver_realized(
                   case when sc.vsrc is null then tr.hidden
                        else coalesce(tr.hidden, false) or coalesce((select bool_or(f2.hidden) from frame_truth f2
                                                                      where f2.src = sc.vsrc and abs(extract(epoch from f2.at - tr.at)) <= 2700), false) end,
                   tr.sun, sc.fog_wanted, sc.need_sun))
            from truth tr where tr.src = coalesce(sc.src, sc.vsrc) and (tr.at at time zone sc.tz)::date = sc.d),
         (sc.v->>'p_good')::real, (sc.v->>'value')::real
    from scored sc
  on conflict (run_id, plan_rank, stop_id, visit_at) do update set
    truth_source = excluded.truth_source, truth_km = excluded.truth_km, hidden = excluded.hidden, sun = excluded.sun,
    realized = excluded.realized, baseline = excluded.baseline, scored_at = excluded.scored_at
    where solver_backtest.realized is null;
  get diagnostics v_rows = row_count;
  if p_dry_run_today then
    raise exception 'dry run (rolled back): % visits; %', v_rows,
      (select jsonb_agg(to_jsonb(s)) from solver_backtest_summary(30, null, 0) s);
  end if;
  return v_rows;
end $function$;

-- Score the last 3 days of Teton plans again under the new rules.
update solver_backtest set realized = null
 where trip_id in (select id from trips where timezone = 'America/Denver') and plan_date >= current_date - 3;
