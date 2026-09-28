-- The agreement banner said SPLIT on 68 of 72 stops, LOOSE on 4, TIGHT on
-- none. A verdict with one value is not a verdict, and the phone was painting
-- a warning triangle on nearly every stop because of it.
--
-- The old metric was the widest min-max range among three variables, each
-- divided by a fixed scale, thresholded at 0.15 and 0.40. Three things went
-- wrong at once:
--
--   1. min-max is an extreme-value statistic, so it grows with the number of
--      reporters. Those thresholds were calibrated when two or three centres
--      answered. Eleven answer now. Same underlying uncertainty, bigger range.
--   2. It took the WORST of three variables, so one wide field pinned the
--      verdict on its own.
--   3. Cloud cover won that contest 33 times out of 68 - it averages a 59
--      point range across eleven centres - and weather_score() barely reads
--      cloud cover. The banner was loudest about the field that matters least.
--
-- So ask the question you actually act on instead: not "do the centres agree
-- about cloud percentage" but "do they agree this is shootable". That is
-- weather_centre_scores(), which runs the same weather_score() once per centre
-- and compares the VERDICTS. Over the same live stops it reads AGREED 15,
-- MIXED 8, CONTESTED 9 - a signal with information in it.
--
-- The contract keys do not change: level and note are what the app reads, and
-- they now carry the vote. The old variable-spread metric is kept alongside
-- under 'variable_spread' rather than deleted, because it is the only record
-- of how far apart the raw numbers were, and the sources table below the
-- banner is still drawn from it.
create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'version', 7,
    'primary_model', w.primary_model,
    'source_count', coalesce(jsonb_array_length(src.arr), 0),
    'centre_count', (w.raw -> 'provenance' ->> 'centres_returned')::int,
    'horizon_hours', w.horizon_hours,
    'fetched_at', w.fetched_at,
    'forecast_valid_for', w.forecast_valid_for,
    'sources', coalesce(src.arr, '[]'::jsonb),
    -- Vote first. Falls back to the old spread verdict for rows the vote
    -- cannot score: an unrated stop, a logistics stop, or a row stored before
    -- raw -> 'models' existed.
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
      when w.raw ? 'comparison' then jsonb_build_object(
        'level',           w.raw -> 'comparison' ->> 'agreement',
        'note',            w.raw -> 'comparison' ->> 'note',
        'divergent_field', w.raw -> 'comparison' ->> 'divergent_field',
        'spread',          w.raw -> 'comparison' -> 'spread',
        'centre_count',    (w.raw -> 'comparison' ->> 'centre_count')::int,
        'source',          'variable_spread')
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
