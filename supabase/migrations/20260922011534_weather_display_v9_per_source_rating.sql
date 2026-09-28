-- v9: every source row carries its own rating.
--
-- The vote already scored per source internally; it just discarded everything
-- but the centre representatives. Now each model's stars and reason ride along
-- in sources[], so the comparison table can lead with a rating per row and you
-- can see WHICH sources say go, not only how many.
--
-- centre_vote keeps its de-duplicated count — that is the honest headline, and
-- it is computed from the same single pass rather than a second one.
create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'version', 9,
    'primary_model', w.primary_model,
    'source_count', coalesce(jsonb_array_length(src.arr), 0),
    'centre_count', (w.raw -> 'provenance' ->> 'centres_returned')::int,
    'horizon_hours', w.horizon_hours,
    'fetched_at', w.fetched_at,
    'forecast_valid_for', w.forecast_valid_for,
    'sources', coalesce(src.arr, '[]'::jsonb),
    'agreement', case when w.raw ? 'comparison' then jsonb_build_object(
        'level',           w.raw -> 'comparison' ->> 'agreement',
        'note',            w.raw -> 'comparison' ->> 'note',
        'divergent_field', w.raw -> 'comparison' ->> 'divergent_field',
        'spread',          w.raw -> 'comparison' -> 'spread',
        'centre_count',    (w.raw -> 'comparison' ->> 'centre_count')::int
      ) end,
    'consensus', w.raw -> 'consensus' -> 'by_variable',
    'uncertainty', jsonb_strip_nulls(coalesce(w.raw -> 'ensemble', '{}'::jsonb)),
    'convergence', w.raw -> 'convergence',
    'ground_truth', case
      when obs.full is null and w.raw -> 'metar' is null then null
      else coalesce(w.raw -> 'metar', '{}'::jsonb) || coalesce(obs.full, '{}'::jsonb)
    end,
    'sea', w.raw -> 'sea',
    'score', w.raw -> 'score',
    'centre_vote', ms.v - 'by_model',
    'provenance', w.raw -> 'provenance')
  from (select shot_type from public.stops where id = w.stop_id limit 1) st
  cross join lateral (select public.weather_model_scores(w, st.shot_type) as v) ms
  cross join lateral (
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
        'score', ms.v -> 'by_model' -> e.key,
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
