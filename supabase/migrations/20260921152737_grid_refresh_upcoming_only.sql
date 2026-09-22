-- Scope: upcoming trips only. Grid points for a trip you already took are
-- wasted calls — that weather is history. A new trip becomes upcoming the
-- moment it is created, so it is picked up with no intervention; pass a
-- trip_id explicitly to force any specific one.
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
  with parsed as (
    select p.model, p.stop_id, s.lat, s.lng, try_jsonb(r.content) as j
    from model_grid_probe p
    join net._http_response r on r.id = p.req_id
    join stops s on s.id = p.stop_id
    where r.status_code = 200
  ), ins as (
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
      probed_at = now()
    returning 1
  )
  select count(*) into n_harvested from ins;

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
end $$;
