-- Resolve where every active model actually samples, for every stop that
-- does not already have a current answer.
--
-- Repeatable by design. Call it any time:
--   CALL refresh_model_grid_points();                  -- every trip
--   CALL refresh_model_grid_points('<trip_id>');       -- one trip
--
-- Self-healing in three ways:
--   * a NEW STOP has no cached row, so it gets probed
--   * a MOVED STOP no longer matches requested_lat/lng, so it is re-probed
--   * a NEW MODEL added to weather_models is probed for every stop
--
-- Needs transaction control (pg_net only dispatches on commit), hence a
-- PROCEDURE rather than a function.
create or replace procedure public.refresh_model_grid_points(
  p_trip_id   uuid default null,
  p_batch     integer default 250,
  p_wait_secs numeric default 25,
  p_max_rounds integer default 12
)
language plpgsql as $$
declare
  queued integer;
  round_no integer := 0;
begin
  loop
    round_no := round_no + 1;

    -- 1. Harvest anything that has come back.
    with parsed as (
      select p.model, p.stop_id, s.lat, s.lng, try_jsonb(r.content) as j
      from model_grid_probe p
      join net._http_response r on r.id = p.req_id
      join stops s on s.id = p.stop_id
      where r.status_code = 200
    )
    insert into model_grid_points
      (model, stop_id, requested_lat, requested_lng, grid_lat, grid_lng, distance_km, has_data)
    select model, stop_id, lat, lng,
      (j->>'latitude')::float, (j->>'longitude')::float,
      case when j is null then null else
        round(km_between(lat, lng, (j->>'latitude')::float, (j->>'longitude')::float)::numeric, 2) end,
      coalesce((select bool_or(e <> 'null'::jsonb)
                from jsonb_array_elements(j->'hourly'->'temperature_2m') e), false)
    from parsed
    on conflict (model, stop_id) do update set
      requested_lat = excluded.requested_lat, requested_lng = excluded.requested_lng,
      grid_lat = excluded.grid_lat, grid_lng = excluded.grid_lng,
      distance_km = excluded.distance_km, has_data = excluded.has_data,
      probed_at = now();

    delete from model_grid_probe p using net._http_response r
    where r.id = p.req_id and r.status_code = 200;

    -- 2. Queue the next batch of genuinely missing pairs.
    with todo as (
      select m.model as mdl, s.id as sid, s.lat, s.lng
      from weather_models m
      cross join stops s
      join days d on d.id = s.day_id
      where m.active
        and s.lat is not null
        and (p_trip_id is null or d.trip_id = p_trip_id)
        and not exists (
          select 1 from model_grid_points g
          where g.model = m.model and g.stop_id = s.id
            and g.requested_lat = s.lat and g.requested_lng = s.lng)
        and not exists (
          select 1 from model_grid_probe pr
          where pr.model = m.model and pr.stop_id = s.id)
      order by m.sort_order, s.id
      limit p_batch
    )
    insert into model_grid_probe (req_id, model, stop_id)
    select net.http_get(url :=
      'https://api.open-meteo.com/v1/forecast?latitude=' || t.lat ||
      '&longitude=' || t.lng || '&hourly=temperature_2m&forecast_days=1&models=' || t.mdl),
      t.mdl, t.sid
    from todo t;

    get diagnostics queued = row_count;

    -- pg_net dispatches on commit, so the batch must be committed before
    -- there is anything to wait for.
    commit;

    exit when (queued = 0 and not exists (select 1 from model_grid_probe));
    exit when round_no >= p_max_rounds;

    -- Paced under Open-Meteo's 600/min: 250 per 25s is ~600/min worst case.
    perform pg_sleep(p_wait_secs);
  end loop;

  -- Anything that errored stays queued; clear it so a later call retries.
  delete from model_grid_probe p using net._http_response r
  where r.id = p.req_id and r.status_code <> 200;
end $$;
