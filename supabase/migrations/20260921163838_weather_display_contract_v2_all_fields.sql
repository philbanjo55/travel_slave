-- Contract v2: stop hand-picking fields.
--
-- v1 hoisted seven named values per model, which meant every new field the
-- edge function collected needed a view change and an app change before it
-- could be seen. v2 passes each model's object through whole, minus the three
-- keys already hoisted to the source level, so the set of fields is whatever
-- the backend collected. Same principle the model list already follows.
--
-- Superseded in place by 20260921165917_weather_display_v3_full_ground_truth,
-- which applies the same idea to the observation. Kept so the migration
-- history matches what was applied.
create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'version', 2,
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
    'ground_truth', w.raw -> 'metar',
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
  ) src;
$$;
