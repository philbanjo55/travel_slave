-- v7 moved the agreement verdict onto the centre vote, but left the old
-- variable-spread verdict as the fallback for rows the vote cannot score:
-- logistics stops, unrated stops, and rows stored before raw -> 'models'
-- existed. That is 40 of the 72 live stops, and on every one of them the
-- fallback still reads SPLIT, because it is the same broken metric v7
-- replaced - min-max over eleven reporters against thresholds calibrated for
-- two or three.
--
-- A verdict that is always the same value is worse than no verdict, so these
-- rows now get none. 'agreement' is null when the vote cannot run, and the
-- app already falls back to a plain source count ("18 sources") when it is
-- missing. That is a true statement; "Centres disagree" was not a useful one.
--
-- Nothing is lost. The spread numbers stay whole under 'variable_spread',
-- which is also what the sources table under the banner reads, so the detail
-- is still one tap away - it just no longer pretends to be a judgement.
create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'version', 8,
    'primary_model', w.primary_model,
    'source_count', coalesce(jsonb_array_length(src.arr), 0),
    'centre_count', (w.raw -> 'provenance' ->> 'centres_returned')::int,
    'horizon_hours', w.horizon_hours,
    'fetched_at', w.fetched_at,
    'forecast_valid_for', w.forecast_valid_for,
    'sources', coalesce(src.arr, '[]'::jsonb),
    -- The vote, or nothing. No fallback verdict.
    'agreement', case
      when vote.v is not null then jsonb_build_object(
        'level',           vote.v ->> 'agreement',
        'note',            vote.v ->> 'summary',
        'centre_count',    (vote.v ->> 'centres_scored')::int,
        'star_range',      (vote.v ->> 'range')::int,
        'median_stars',    (vote.v ->> 'median_stars')::int,
        'centres_fair_or_better', (vote.v ->> 'centres_fair_or_better')::int,
        'divergent_field', w.raw -> 'comparison' ->> 'divergent_field',
        'source',          'centre_vote')
      end,
    'variable_spread', w.raw -> 'comparison',
    'centre_vote', vote.v,
    'consensus', w.raw -> 'consensus' -> 'by_variable',
    'uncertainty', jsonb_strip_nulls(coalesce(w.raw -> 'ensemble', '{}'::jsonb)),
    'convergence', w.raw -> 'convergence',
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
  ) obs on true
  left join lateral (
    select shot_type from public.stops where id = w.stop_id limit 1
  ) st on true
  left join lateral (
    select public.weather_centre_scores(w, st.shot_type) as v
  ) vote on true;
$$;
