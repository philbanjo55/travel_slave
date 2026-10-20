-- solver_build_scores now takes its light terms from solver_light_dir /
-- solver_light_soft and its timezone from solver_trip_tz, so forecast scores
-- and light-only scores can't drift apart. The helpers return real, so a
-- rebuild of the 20 Oct pull differs from the old inline version by at most
-- 1/250 on 1.5% of member values (float rounding); nothing else changed.
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
  v_tz := solver_trip_tz(p_trip_id);
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
  perform solver_fill_light_cache(p_trip_id, v_dates, 3600);

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
           solver_light_dir(c.light, c.sun_alt, c.sun_visible, st.lw) as dir,
           solver_light_soft(c.sun_alt, st.lw) as soft
      from st join solver_light_cache c
        on c.vantage_id = st.star_vantage_id and c.local_date = any(v_dates) and c.sun_alt > -6
  ), shared as (
    -- Member-invariant fog gate: GFS/UKMO members under 1 km visibility,
    -- HARMONIE fog, or the stop above HARMONIE's cloud base.
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
