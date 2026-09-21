-- Open-Meteo signals "this model does not cover that point" TWO ways:
--   * HTTP 200 with {"latitude":nan,...}        (e.g. DMI outside its domain)
--   * HTTP 400 {"reason":"No data is available for this location"}
-- Only the first was being cached. A 400 was treated as a transient failure,
-- so it re-queued every run — an endless retry against a question whose
-- answer will never change. Cache both as has_data = false.
-- Genuinely transient failures (429, 5xx, timeouts) still retry.
create or replace function public.refresh_model_grid_points_step(
  p_trip_id uuid default null,
  p_batch   integer default 150
)
returns table (harvested integer, queued integer, remaining bigint)
language plpgsql as $$
declare
  n_harvested integer := 0;
  n_queued    integer := 0;
begin
  with settled as (
    select p.model, p.stop_id, s.lat, s.lng, r.status_code,
           try_jsonb(r.content) as j, r.content as body
    from model_grid_probe p
    join net._http_response r on r.id = p.req_id
    join stops s on s.id = p.stop_id
    where r.status_code = 200
       or (r.status_code = 400 and r.content ilike '%No data is available for this location%')
  ), ins as (
    insert into model_grid_points
      (model, stop_id, requested_lat, requested_lng, grid_lat, grid_lng, distance_km, has_data)
    select model, stop_id, lat, lng,
      case when status_code = 200 then (j->>'latitude')::float end,
      case when status_code = 200 then (j->>'longitude')::float end,
      case when status_code = 200 and j is not null then
        round(km_between(lat, lng, (j->>'latitude')::float, (j->>'longitude')::float)::numeric, 2) end,
      case when status_code <> 200 then false
           else coalesce((select bool_or(e <> 'null'::jsonb)
                          from jsonb_array_elements(j->'hourly'->'temperature_2m') e), false) end
    from settled
    on conflict (model, stop_id) do update set
      requested_lat = excluded.requested_lat, requested_lng = excluded.requested_lng,
      grid_lat = excluded.grid_lat, grid_lng = excluded.grid_lng,
      distance_km = excluded.distance_km, has_data = excluded.has_data,
      probed_at = now()
    returning 1
  )
  select count(*) into n_harvested from ins;

  -- Clear settled probes. Transient failures (429, 5xx) are also cleared but
  -- were never cached, so they simply reappear as missing and retry later.
  delete from model_grid_probe p using net._http_response r where r.id = p.req_id;

  with todo as (
    select m.model as mdl, s.id as sid, s.lat, s.lng
    from weather_models m
    cross join stops s
    join days d on d.id = s.day_id
    join trips t on t.id = d.trip_id
    where m.active
      and s.lat is not null
      and (case when p_trip_id is not null then d.trip_id = p_trip_id
                else t.start_date >= current_date end)
      and not exists (
        select 1 from model_grid_points g
        where g.model = m.model and g.stop_id = s.id
          and g.requested_lat = s.lat and g.requested_lng = s.lng)
      and not exists (
        select 1 from model_grid_probe pr
        where pr.model = m.model and pr.stop_id = s.id)
    order by m.sort_order, s.id
    limit p_batch
  ), q as (
    insert into model_grid_probe (req_id, model, stop_id)
    select net.http_get(url :=
      'https://api.open-meteo.com/v1/forecast?latitude=' || t.lat ||
      '&longitude=' || t.lng || '&hourly=temperature_2m&forecast_days=1&models=' || t.mdl),
      t.mdl, t.sid
    from todo t
    returning 1
  )
  select count(*) into n_queued from q;

  return query
  select n_harvested, n_queued,
    (select count(*)
     from weather_models m
     cross join stops s
     join days d on d.id = s.day_id
     join trips t on t.id = d.trip_id
     where m.active and s.lat is not null
       and (case when p_trip_id is not null then d.trip_id = p_trip_id
                 else t.start_date >= current_date end)
       and not exists (select 1 from model_grid_points g
                       where g.model = m.model and g.stop_id = s.id
                         and g.requested_lat = s.lat and g.requested_lng = s.lng));
end $$;;
