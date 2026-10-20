-- FORECAST SCOREBOARD: does "70%" happen 70% of the time?
-- Every ECMWF step that has passed is checked against what happened, at the
-- Vágar airport (EKVG hourly obs, station_obs_hourly) and at the webcams
-- (webcam_frames, daylight only). One row per site, time, pull and event:
-- p = share of the 51 members forecasting it, obs = did it happen.
--
--   event        forecast (per member)                 observed
--   mostly_clear max(low, mid cloud) <= 50%            EKVG cloud <= 50%
--   low_cloud    low cloud >= 70%                      EKVG ceiling < 2000 ft or fog
--   rain         >= 0.2 mm/h                           EKVG wet
--   fog          RH >= 97% and low cloud >= 90%        EKVG fog or visibility < 1 km
--   hills_hidden low cloud >= 70% (camera's cell)      webcam: Phil's label if any, else
--                                                      top-half edges < half the camera's
--                                                      clear-day level (90th percentile)
-- Thresholds are first guesses; the report shows how each one scores.

create table public.solver_verify (
  site text not null,
  kind text not null check (kind in ('airport', 'webcam')),
  valid_at timestamptz not null,
  pull_id uuid not null references public.weather_ensemble_pulls(id) on delete cascade,
  lead_h integer not null,
  event text not null,
  p real not null,
  obs boolean not null,
  primary key (site, valid_at, pull_id, event)
);

-- Nearest ECMWF cell to a point in a pull.
create or replace function public.solver_nearest_cell(p_lat double precision, p_lng double precision, p_pull uuid)
returns text language sql stable set search_path to 'public' as $$
  select c.cell_key
    from (select distinct cell_key from weather_ensemble where pull_id = p_pull and model = 'ecmwf_ifs025') c
   order by (split_part(c.cell_key, ',', 1)::float8 - p_lat) ^ 2
          + ((split_part(c.cell_key, ',', 2)::float8 - p_lng) * cos(radians(p_lat))) ^ 2
   limit 1
$$;

-- Add every check from the last 5 days that isn't stored yet. Idempotent;
-- nightly, so nothing older is missed.
create or replace function public.solver_verify_run()
returns jsonb language plpgsql set search_path to 'public' as $$
declare n_air integer; n_cam integer;
begin
  with probs as (
    select e.pull_id, e.cell_key, e.valid_at,
           (extract(epoch from e.valid_at - pl.pulled_at) / 3600)::integer as lead_h,
           avg((greatest(coalesce(u.cl, 100), coalesce(u.cm, 100)) <= 50)::int) as p_clear,
           avg((coalesce(u.cl, 0) >= 70)::int) as p_low,
           avg((coalesce(u.pr, 0) >= 2)::int) as p_rain,
           avg((coalesce(u.rh, 0) >= 97 and coalesce(u.cl, 0) >= 90)::int) as p_fog
      from weather_ensemble e
      join weather_ensemble_pulls pl on pl.id = e.pull_id
      cross join lateral unnest(e.cloud_low, e.cloud_mid, e.precip_mm10, e.rh) u(cl, cm, pr, rh)
     where e.model = 'ecmwf_ifs025' and e.valid_at < now() and e.valid_at > now() - interval '5 days'
       and e.valid_at > pl.pulled_at
     group by e.pull_id, e.cell_key, e.valid_at, pl.pulled_at
  ), sites as (
    select m.icao as site, pl.id as pull_id, solver_nearest_cell(m.lat, m.lng, pl.id) as cell_key
      from metar_stations m cross join weather_ensemble_pulls pl
     where m.icao = 'EKVG' and pl.pulled_at > now() - interval '9 days'
  ), air as (
    select st.site, pr.*, o.cloud_pct, o.ceiling_ft, o.fog, o.wet, o.visibility_m
      from sites st
      join probs pr on pr.pull_id = st.pull_id and pr.cell_key = st.cell_key
      join station_obs_hourly o on o.station = st.site and o.hr = pr.valid_at
  )
  insert into solver_verify (site, kind, valid_at, pull_id, lead_h, event, p, obs)
  select site, 'airport', valid_at, pull_id, lead_h, x.event, x.p, x.obs
    from air
    cross join lateral (values
      ('mostly_clear', p_clear, case when cloud_pct is not null then cloud_pct <= 50 end),
      ('low_cloud', p_low, case when ceiling_ft is not null or cloud_pct is not null or fog is not null
                                then coalesce(ceiling_ft < 2000, false) or coalesce(fog, false) end),
      ('rain', p_rain, wet),
      ('fog', p_fog, case when fog is not null or visibility_m is not null
                          then coalesce(fog, false) or coalesce(visibility_m < 1000, false) end)
    ) x(event, p, obs)
   where x.obs is not null
  on conflict do nothing;
  get diagnostics n_air = row_count;

  with probs as (
    select e.pull_id, e.cell_key, e.valid_at,
           (extract(epoch from e.valid_at - pl.pulled_at) / 3600)::integer as lead_h,
           avg((coalesce(u.cl, 0) >= 70)::int) as p_low
      from weather_ensemble e
      join weather_ensemble_pulls pl on pl.id = e.pull_id
      cross join lateral unnest(e.cloud_low) u(cl)
     where e.model = 'ecmwf_ifs025' and e.valid_at < now() and e.valid_at > now() - interval '5 days'
       and e.valid_at > pl.pulled_at
     group by e.pull_id, e.cell_key, e.valid_at, pl.pulled_at
  ), cams as (
    select c.code, pl.id as pull_id, solver_nearest_cell(c.lat, c.lng, pl.id) as cell_key
      from webcam_cameras c cross join weather_ensemble_pulls pl
     where c.lat is not null and pl.pulled_at > now() - interval '9 days'
  ), base as (
    select camera_code, percentile_cont(0.9) within group (order by edge_top) as clear_edge, count(*) as n
      from webcam_frames where sun_altitude > 3 and edge_top is not null
     group by camera_code
  ), frames as (
    select f.camera_code, f.captured_at,
           case when f.label_model = 'phil' and f.hills_visible is not null then not f.hills_visible
                when b.n >= 5 then f.edge_top < 0.5 * b.clear_edge end as hidden
      from webcam_frames f
      left join base b on b.camera_code = f.camera_code
     where f.sun_altitude > 3 and f.edge_top is not null and f.captured_at > now() - interval '5 days'
  )
  insert into solver_verify (site, kind, valid_at, pull_id, lead_h, event, p, obs)
  select fr.camera_code, 'webcam', pr.valid_at, pr.pull_id, pr.lead_h, 'hills_hidden', pr.p_low, fr.hidden
    from frames fr
    join cams cm on cm.code = fr.camera_code
    join probs pr on pr.pull_id = cm.pull_id and pr.cell_key = cm.cell_key
                 and abs(extract(epoch from pr.valid_at - fr.captured_at)) <= 5400
   where fr.hidden is not null
  on conflict do nothing;
  get diagnostics n_cam = row_count;

  return jsonb_build_object('airport', n_air, 'webcam', n_cam);
end $$;
revoke execute on function public.solver_verify_run() from public, anon, authenticated;

-- The scoreboard, per event and lead time, over the last p_days.
-- brier: mean (p - obs)^2, lower is better. skill: 1 - brier / brier of
-- always forecasting the observed base rate (> 0 beats it). bins: in each
-- 20% band of forecast p, how often it happened (reliability).
create or replace function public.solver_verify_report(p_days integer default 30)
returns table (kind text, event text, lead text, n bigint, base_rate numeric, mean_p numeric,
               brier numeric, skill numeric, bins jsonb)
language sql stable set search_path to 'public' as $$
  with v as (
    select s.*, case when s.lead_h < 24 then '0-24h' when s.lead_h < 48 then '24-48h' else '48-72h' end as lead
      from solver_verify s where s.valid_at > now() - make_interval(days => p_days)
  ), agg as (
    select v.kind, v.event, v.lead, count(*) as n, avg(v.obs::int) as base, avg(v.p) as mean_p,
           avg((v.p - v.obs::int) ^ 2) as brier
      from v group by v.kind, v.event, v.lead
  )
  select a.kind, a.event, a.lead, a.n, round(a.base::numeric, 2), round(a.mean_p::numeric, 2),
         round(a.brier::numeric, 3),
         case when a.base > 0 and a.base < 1 then round((1 - a.brier / (a.base * (1 - a.base)))::numeric, 2) end,
         (select jsonb_object_agg(b.band, jsonb_build_object('n', b.n, 'happened', b.rate) order by b.band)
            from (select concat(least(floor(v.p * 5), 4) * 20, '-', least(floor(v.p * 5), 4) * 20 + 20, '%') as band,
                         count(*) as n, round(avg(v.obs::int)::numeric, 2) as rate
                    from v where v.kind = a.kind and v.event = a.event and v.lead = a.lead
                   group by 1) b)
    from agg a
   order by a.kind, a.event, a.lead
$$;
revoke execute on function public.solver_verify_report(integer) from public, anon, authenticated;

-- Nightly after the plans (not at :07, the Open-Meteo minute).
select cron.schedule('solver-verify', '29 23 * * *', $cron$ select public.solver_verify_run(); $cron$);
