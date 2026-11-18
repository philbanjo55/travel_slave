-- SOLVER SCORE BUILDER (v0)
-- For every rated stop, every 15-min slot with the sun above -6 deg and every
-- ECMWF member: how good is the starred shot? V in 0..1, stored x250 as
-- smallint[] (index = member, 1 = control). Tier is NOT baked in: the planner
-- applies tier weight at search time, so a tier change needs no rebuild.
--
--   light  = sun_vis * directional + (1 - sun_vis) * soft
--            directional: vantage_light() class (front/side/backlit/top/
--            in shadow) scaled by sun altitude, x0.35 when it is not the
--            light Phil asked for; soft: overcast light, good only where
--            light_wanted has 'soft'. sun_vis from low/mid cloud.
--   x rain   1 - 0.8 * min(mm/h / 1.5, 1)
--   x wind   gusts over 35 km/h fall to 0.2 at 80 km/h
--   x fog    1 - 0.9 * fog   (fog_wanted stops: 0.6 + 0.4 * fog)
--            fog per member from near-saturation + low cloud, the vantage
--            sitting above the cloud base (125 m per deg C of dew-point
--            spread), and a member-invariant gate from GFS/UKMO visibility
--            members < 1 km and HARMONIE visibility / 2 m cloud / cloud base.
--   x bonus  waterfalls: 1 + 0.3 * min(rain in the last 24 h / 10 mm, 1)
--
-- Light geometry is weather-independent, so it is cached per (vantage, day).
-- The archive in weather_ensemble can rebuild any past night for backtests.
-- Pruning old builds needs a DELETE on the solver's own tables; it is waiting
-- on Phil's approval, so builds accumulate (~1.5 MB a night) until then.

create table public.solver_light_cache (
  vantage_id uuid not null references public.scout_vantages(id) on delete cascade,
  slot_at timestamptz not null,
  local_date date not null,
  sun_alt real,
  light text,
  sun_visible boolean,
  primary key (vantage_id, slot_at)
);
create index on public.solver_light_cache (vantage_id, local_date);

create table public.solver_score_builds (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  pull_id uuid not null references public.weather_ensemble_pulls(id) on delete cascade,
  built_at timestamptz not null default now(),
  stops integer, slots integer, ms integer
);

create table public.solver_scores (
  build_id uuid not null references public.solver_score_builds(id) on delete cascade,
  stop_id uuid not null references public.stops(id) on delete cascade,
  slot_at timestamptz not null,
  v smallint[] not null,
  primary key (build_id, stop_id, slot_at)
);

create or replace function public.solver_build_scores(p_trip_id uuid, p_pull_id uuid default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  t0 timestamptz := clock_timestamp();
  v_tz text;
  v_pull uuid := p_pull_id;
  v_build uuid;
  v_dates date[];
  r record;
  v_stops integer;
  v_rows integer;
begin
  -- Trip timezone, else the one Open-Meteo reported for the trip's stops
  -- (as trip_sun_plan does), else UTC.
  select coalesce(
           (select n.name from pg_timezone_names n where n.name = t.timezone),
           (select n.name from pg_timezone_names n where n.name = (
              select f.raw->'provenance'->>'timezone' from weather_forecasts f join stops s on s.id = f.stop_id
               where s.trip_id = t.id and f.raw->'provenance'->>'timezone' is not null
               order by f.fetched_at desc limit 1)),
           'UTC')
    into v_tz from trips t where t.id = p_trip_id;
  if v_tz is null then raise exception 'trip % not found', p_trip_id; end if;

  if v_pull is null then
    select p.id into v_pull from weather_ensemble_pulls p
     where exists (select 1 from weather_ensemble e join stop_cell_map m on m.cell_key = e.cell_key
                    where e.pull_id = p.id and e.model = 'ecmwf_ifs025' and m.trip_id = p_trip_id)
     order by p.pulled_at desc limit 1;
  end if;
  if v_pull is null then return jsonb_build_object('ok', false, 'error', 'no ECMWF pull covers this trip'); end if;

  select array_agg(distinct (e.valid_at at time zone v_tz)::date) into v_dates
    from weather_ensemble e
   where e.pull_id = v_pull and e.model = 'ecmwf_ifs025'
     and e.cell_key in (select cell_key from stop_cell_map where trip_id = p_trip_id);

  -- Light geometry for each starred shot and day not cached yet.
  for r in
    select distinct i.star_vantage_id v, d
      from solver_stop_inputs i cross join unnest(v_dates) d
     where i.trip_id = p_trip_id and i.tier is not null and i.star_vantage_id is not null
       and not exists (select 1 from solver_light_cache c where c.vantage_id = i.star_vantage_id and c.local_date = d)
  loop
    insert into solver_light_cache (vantage_id, slot_at, local_date, sun_alt, light, sun_visible)
    select r.v, l.local_time at time zone v_tz, r.d, l.sun_altitude, l.light, l.sun_visible_from_vantage
      from vantage_light(r.v, r.d, 15, v_tz) l
    on conflict do nothing;
  end loop;

  insert into solver_score_builds (trip_id, pull_id) values (p_trip_id, v_pull) returning id into v_build;

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
    -- 3-hourly steps carry a per-hour rate, so a step stands for 3 h of rain.
    select *, 3 * sum(coalesce(p, 0)) over (partition by cell_key, k order by valid_at
                                            range between interval '21 hours' preceding and current row) / 10.0 as rain24
      from ecm
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
           to_timestamp(round(extract(epoch from c.slot_at) / 10800) * 10800) as at3,
           to_timestamp(round(extract(epoch from c.slot_at) / 3600) * 3600) as at1,
           'soft' = any(coalesce(st.lw, '{}')) as soft_ok
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
    select s.stop_id, s.slot_at, w.k,
      -- directional light on the starred shot
      case
        when s.light in ('front', 'side', 'backlit') then
          (case when s.sun_alt < 6 then 1.0 when s.sun_alt < 12 then 0.85 when s.sun_alt < 20 then 0.65 else 0.45 end)
          * (case when (case s.light when 'backlit' then 'back' else s.light end) = any(s.lw) then 1.0
                  when s.lw && '{front,side,back}' then 0.35 else 0.6 end)
          * (case when s.light = 'backlit' and s.sun_visible is false then 0.6 else 1.0 end)
        when s.light = 'no direction' then 0.6
        when s.light = 'top' then 0.25
        when s.light = 'in shadow' then 0.3
        else case when s.soft_ok then 0.4 else 0.3 end  -- blue hour
      end as dir,
      case when s.sun_alt >= 0 then (case when s.soft_ok then 0.75 else 0.3 end)
           else (case when s.soft_ok then 0.4 else 0.15 end) end as soft,
      greatest(0, least(1, 1 - (greatest(coalesce(w.cl, 100), coalesce(w.cm, 100)) - 25) / 65.0)) as sun_vis,
      1 - 0.8 * least(coalesce(w.p, 0) / 10.0 / 1.5, 1) as rain_f,
      case when coalesce(w.g, 0) / 10.0 <= 35 then 1.0 else greatest(0.2, 1 - (w.g / 10.0 - 35) / 45.0) end as wind_f,
      1 - (1 - least(1, greatest(0, (coalesce(w.rh, 0) - 94) / 5.0)) * least(1, greatest(0, (coalesce(w.cl, 0) - 50) / 50.0)))
        * (1 - case when s.elev is not null and w.cl >= 70 and w.t is not null and w.td is not null
                     and s.elev > 125 * (w.t - w.td) / 10.0 then 1 else 0 end)
        * (1 - 0.7 * coalesce(sh.gate, 0)) as fog,
      s.light = 'no sun' as blue,
      s.fog_wanted, s.rain_bonus, w.rain24
      from slots s
      join ecm24 w on w.cell_key = s.cell_key and w.valid_at = s.at3
      left join shared sh on sh.stop_id = s.stop_id and sh.slot_at = s.slot_at
  )
  select v_build, stop_id, slot_at,
         array_agg(round(250 * greatest(0, least(1,
           -- Blue hour has no direct sun to lose to cloud.
           (case when blue then dir else sun_vis * dir + (1 - sun_vis) * soft end)
           * rain_f * wind_f
           * (case when fog_wanted then 0.6 + 0.4 * fog else 1 - 0.9 * fog end)
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
                            'stops', v_stops, 'slots', v_rows,
                            'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $$;

revoke execute on function public.solver_build_scores(uuid, uuid) from public, anon, authenticated;

-- Mean, CVaR (mean of the worst 11 of 51 members) and P(V >= 0.6), 0..1.
create or replace view public.solver_score_summary with (security_invoker = true) as
select s.build_id, b.trip_id, s.stop_id, s.slot_at,
       round((select avg(x) from unnest(s.v) x) / 250.0, 3) as mean,
       round((select avg(x) from (select x from unnest(s.v) x order by x limit 11) w) / 250.0, 3) as cvar11,
       round((select avg((x >= 150)::int) from unnest(s.v) x), 3) as p_good
  from public.solver_scores s join public.solver_score_builds b on b.id = s.build_id;
