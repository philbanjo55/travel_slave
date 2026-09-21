-- Ground truth was the one place still hand-picking fields. The edge function
-- writes a seven-key subset of the METAR into raw.metar, while the full parse
-- (observed temperature, dew point, wind, gusts, sky cover, present weather)
-- already sits in weather_observations. Joining that table instead of reading
-- the subset gets all of it, retroactively, with no redeploy: the edge
-- function upserted the row under exactly the station and observed_at it
-- recorded in raw.metar, so the join is exact.
--
-- Observed dew point next to observed temperature is the one thing eighteen
-- forecasts cannot give you: when they converge, EKVG is already in fog.
--
-- Units note: everything from Open-Meteo is normalised per request (kmh set
-- explicitly, and °C/mm/m/hPa/% by default), so all models are directly
-- comparable. The METAR is the exception — visibility is converted from
-- statute miles to metres at ingest, ceiling stays feet, and wind stays
-- knots. The _kt and _ft suffixes carry that through to the app, which
-- converts on display rather than guessing.
create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'version', 3,
    'primary_model', w.primary_model,
    'source_count', coalesce(jsonb_array_length(src.arr), 0),
    'centre_count', (w.raw -> 'provenance' ->> 'centres_returned')::int,
    'horizon_hours', w.horizon_hours,
    'fetched_at', w.fetched_at,
    'forecast_valid_for', w.forecast_valid_for,
    'sources', coalesce(src.arr, '[]'::jsonb),
    'agreement', w.raw -> 'agreement',
    'consensus', w.raw -> 'consensus' -> 'by_variable',
    'uncertainty', jsonb_strip_nulls(coalesce(w.raw -> 'ensemble', '{}'::jsonb)),
    'convergence', w.raw -> 'convergence',
    -- Full observation where we have it, the stored subset underneath, so a
    -- row whose observation was pruned by retention still renders.
    'ground_truth', case
      when obs.full is null and w.raw -> 'metar' is null then null
      else coalesce(w.raw -> 'metar', '{}'::jsonb) || coalesce(obs.full, '{}'::jsonb)
    end,
    'sea', w.raw -> 'sea',
    'score', w.raw -> 'score',
    'provenance', w.raw -> 'provenance')
  from (
    select jsonb_agg(
      jsonb_build_object(
        'model', e.key,
        'label', coalesce(wm.label, e.key),
        'centre', coalesce(wm.centre, e.value ->> 'centre'),
        'is_primary', e.key = w.primary_model,
        'is_blend', coalesce(wm.is_blend, false),
        'blend_note', wm.blend_note,
        'resolution_km', wm.resolution_km,
        'distance_km', g.distance_km,
        'values', e.value - 'centre' - 'distance_km' - 'resolution_km'
      )
      order by wm.resolution_km nulls last, g.distance_km nulls last,
               wm.sort_order nulls last, e.key
    ) as arr
    from jsonb_each(coalesce(w.raw -> 'models', '{}'::jsonb)) e
    left join public.weather_models wm on wm.model = e.key
    left join public.model_grid_points g on g.model = e.key and g.stop_id = w.stop_id
  ) src
  left join lateral (
    select jsonb_strip_nulls(
             to_jsonb(o) - 'id' - 'lat' - 'lng' - 'raw' - 'created_at' - 'fetched_at'
           ) as full
    from public.weather_observations o
    where o.station    = (w.raw -> 'metar' ->> 'station')
      and o.observed_at = (w.raw -> 'metar' ->> 'observed_at')::timestamptz
    limit 1
  ) obs on true;
$$;
