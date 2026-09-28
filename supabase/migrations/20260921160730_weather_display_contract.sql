-- RENDER CONTRACT
-- The app draws whatever is in `display` and nothing else, so adding a
-- nineteenth model, renaming one, or swapping the primary in another region
-- never requires touching the phone.
--
-- Built as a VIEW rather than written into the row by the edge function,
-- deliberately: a render contract is a projection, not data. As a view it
-- applies retroactively to every row already stored, joins labels live from
-- the registry, and can be changed without a redeploy.
--
-- Values stay in canonical units (C, km/h, mm, m, %) and are NOT preformatted,
-- because unit preference belongs on the device.
--
-- Ordering: grid size first, distance breaking ties. A coarse model whose
-- nearest grid point happens to land close is still averaging over its whole
-- cell, so resolution is the real signal; distance only separates equals.
-- Both numbers ride on every row. Same ordering that picks the primary.
--
-- Models with no data never appear: they are absent from raw.models because
-- the edge function drops them, and models not covering a stop are never
-- requested in the first place.
create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'version', 1,
    'primary_model', w.primary_model,
    'source_count', coalesce(jsonb_array_length(src.arr), 0),
    'centre_count', (w.raw -> 'consensus' ->> 'centre_count')::int,
    'sources', coalesce(src.arr, '[]'::jsonb),
    'agreement', case when w.raw ? 'comparison' then jsonb_build_object(
        'level',           w.raw -> 'comparison' ->> 'agreement',
        'note',            w.raw -> 'comparison' ->> 'note',
        'divergent_field', w.raw -> 'comparison' ->> 'divergent_field',
        'centre_count',    (w.raw -> 'comparison' ->> 'centre_count')::int
      ) end,
    -- Rain and wind uncertainty are measurable; fog uncertainty is not,
    -- because no ensemble system serves visibility.
    'uncertainty', case when w.raw -> 'ensemble' ? 'by_variable' then jsonb_build_object(
        'members',               (w.raw -> 'ensemble' ->> 'member_count')::int,
        'prob_any_rain_pct',      w.raw -> 'ensemble' -> 'by_variable' -> 'precipitation'   ->> 'prob_any_rain_pct',
        'prob_wet_pct',           w.raw -> 'ensemble' -> 'by_variable' -> 'precipitation'   ->> 'prob_wet_pct',
        'prob_gust_over_40_pct',  w.raw -> 'ensemble' -> 'by_variable' -> 'wind_gusts_10m'  ->> 'prob_gust_over_40_pct',
        'prob_gust_over_60_pct',  w.raw -> 'ensemble' -> 'by_variable' -> 'wind_gusts_10m'  ->> 'prob_gust_over_60_pct',
        'prob_broken_sky_pct',    w.raw -> 'ensemble' -> 'by_variable' -> 'cloud_cover'     ->> 'prob_broken_sky_pct',
        'fog_probability_available', false
      ) end,
    'ground_truth', case when (w.raw -> 'metar') is not null
                          and not (w.raw -> 'metar' ? 'error')
                     then w.raw -> 'metar' end,
    'sea', w.raw -> 'sea'
  )
  from (
    select jsonb_agg(
             jsonb_build_object(
               'model',          e.key,
               'label',          coalesce(wm.label, e.key),
               'centre',         e.value ->> 'centre',
               'is_primary',     e.key = w.primary_model,
               'resolution_km',  wm.resolution_km,
               'distance_km',    g.distance_km,
               'is_blend',       coalesce(wm.is_blend, false),
               'values', jsonb_build_object(
                 'temperature_c',          e.value -> 'temperature_c',
                 'cloud_cover_pct',        e.value -> 'cloud_cover_pct',
                 'cloud_cover_low_pct',    e.value -> 'cloud_cover_low_pct',
                 'cloud_base_m',           e.value -> 'cloud_base_m',
                 'cloud_top_m',            e.value -> 'cloud_top_m',
                 'precip_probability_pct', e.value -> 'precip_probability_pct',
                 'precip_mm',              e.value -> 'precip_mm',
                 'wind_speed_kmh',         e.value -> 'wind_speed_kmh',
                 'wind_gusts_kmh',         e.value -> 'wind_gusts_kmh',
                 'visibility_m',           e.value -> 'visibility_m',
                 'weather_code',           e.value -> 'weather_code',
                 'conditions',             e.value -> 'conditions',
                 'fog_risk',               e.value -> 'fog_risk'
               )
             )
             order by wm.resolution_km nulls last, g.distance_km nulls last, e.key
           ) as arr
    from jsonb_each(coalesce(w.raw -> 'models', '{}'::jsonb)) e
    left join public.weather_models wm on wm.model = e.key
    left join public.model_grid_points g
           on g.model = e.key and g.stop_id = w.stop_id
  ) src;
$$;

-- Exposed through the view the app already reads with select('*'), so the
-- contract arrives with no client change.
create or replace view public.latest_weather_per_stop as
select l.*, public.weather_display(l.*) as display
from (
  select distinct on (stop_id) *
  from public.weather_forecasts
  order by
    stop_id,
    ((raw -> 'provenance' ->> 'date_mode') = 'trip-date') desc nulls last,
    fetched_at desc
) l;
