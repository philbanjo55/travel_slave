-- v9 rebuilt weather_display from a pre-v7 baseline and took two things out
-- with it. Both are restored here, on top of everything v9 added.
--
-- 1. 'agreement' went back to reading raw -> 'comparison', the variable-spread
--    verdict that v7 replaced and v8 finished removing. It reads SPLIT on 68
--    of 72 stops and LOOSE on the rest, because min-max over eleven reporters
--    is judged against thresholds calibrated for two or three. The banner had
--    one value again, and the phone's warning triangle with it.
--
-- 2. weather_model_scores kept the COMMENT from the robust-spread change -
--    "measure the cluster, not the two extremes" - directly above a
--    `hi - lo` that measures exactly the two extremes.
--
--    Traelanipa shows what that costs. Its eleven centres read
--    4,3,3,3,3,3,2,2,2,2,0: median 3, ten of them within one star of it, one
--    contrarian on 0. Ten of eleven call it shootable. It labelled CONTESTED,
--    on the strength of the single dissenter.
--
-- Nothing v9 added is touched: all eighteen models still get scored in one
-- pass, every source still carries its own score, and centre_vote still comes
-- from weather_model_scores. The per-source rating is the better design and it
-- stays - this only puts the two verdicts back the way they were measured.
create or replace function public.weather_model_scores(
  w public.weather_forecasts, p_shot_type text
) returns jsonb language plpgsql immutable as $$
declare
  m record;
  r public.weather_forecasts;
  sc jsonb;
  by_model jsonb := '{}'::jsonb;
  by_centre jsonb := '{}'::jsonb;
  stars_list numeric[] := '{}';
  seen_centres text[] := '{}';
  med numeric; lo int; hi int; n int; go_n int; spread_label text;
  near_n int; near_frac numeric;
begin
  if p_shot_type is null or p_shot_type = 'logistics' then return null; end if;
  if w.raw -> 'models' is null then return null; end if;

  for m in
    select e.key as model, e.value as vals,
           e.value ->> 'centre' as centre,
           (e.value ->> 'resolution_km')::numeric as km,
           (e.value ->> 'distance_km')::numeric as away
    from jsonb_each(w.raw -> 'models') e
    order by (e.value ->> 'resolution_km')::numeric nulls last,
             (e.value ->> 'distance_km')::numeric nulls last,
             e.key
  loop
    r := w;
    r.wind_gusts_kmh         := (m.vals ->> 'wind_gusts_kmh')::numeric;
    r.wind_speed_kmh         := (m.vals ->> 'wind_speed_kmh')::numeric;
    r.precip_probability_pct := (m.vals ->> 'precip_probability_pct')::int;
    r.rain_mm                := (m.vals ->> 'rain_mm')::numeric;
    r.showers_mm             := (m.vals ->> 'showers_mm')::numeric;
    r.snowfall_cm            := (m.vals ->> 'snowfall_cm')::numeric;
    r.weather_code           := (m.vals ->> 'weather_code')::int;
    r.visibility_m           := (m.vals ->> 'visibility_m')::numeric;
    r.fog_risk               := m.vals ->> 'fog_risk';
    r.cloud_cover_pct        := (m.vals ->> 'cloud_cover_pct')::int;
    r.cloud_cover_low_pct    := (m.vals ->> 'cloud_cover_low_pct')::int;

    sc := public.weather_score(r, p_shot_type);
    if sc is not null then
      by_model := by_model || jsonb_build_object(m.model, jsonb_build_object(
        'stars', (sc ->> 'stars')::int,
        'label', sc ->> 'label',
        'reason', sc ->> 'reason',
        'components', sc -> 'components'));

      -- first model of a centre, in the ranked order above, is its representative
      if m.centre is not null and not (m.centre = any(seen_centres)) then
        seen_centres := seen_centres || m.centre;
        by_centre := by_centre || jsonb_build_object(m.centre, jsonb_build_object(
          'model', m.model, 'stars', (sc ->> 'stars')::int, 'reason', sc ->> 'reason'));
        stars_list := stars_list || (sc ->> 'stars')::numeric;
      end if;
    end if;
  end loop;

  n := coalesce(array_length(stars_list, 1), 0);
  if n = 0 then return null; end if;

  select percentile_cont(0.5) within group (order by s),
         min(s)::int, max(s)::int, count(*) filter (where s >= 2)::int
    into med, lo, hi, go_n
  from unnest(stars_list) s;

  -- Measure the cluster, not the two extremes: one contrarian centre should not
  -- brand an otherwise settled forecast as contested. Centres within one star
  -- of the median agree; the rest are dissenters, and they are COUNTED rather
  -- than allowed to define a range.
  --
  --     0 dissenters   AGREED
  --     1-2            MIXED
  --     3 or more      CONTESTED
  --
  -- Held as fractions so it still behaves when fewer than eleven centres report.
  select count(*) filter (where abs(s - med) <= 1)::int into near_n
  from unnest(stars_list) s;
  near_frac := near_n::numeric / n;

  spread_label := case when near_frac >= 0.95 then 'AGREED'
                       when near_frac >= 0.80 then 'MIXED'
                       else 'CONTESTED' end;

  return jsonb_build_object(
    'centres_scored', n,
    'median_stars', round(med)::int,
    -- range/min/max kept for inspection, no longer the verdict
    'min_stars', lo, 'max_stars', hi, 'range', hi - lo,
    'agreement', spread_label,
    'agreeing_centres', near_n,
    'dissenting_centres', n - near_n,
    'centres_fair_or_better', go_n,
    'summary', go_n || ' of ' || n || ' centres say shootable',
    'by_centre', by_centre,
    'by_model', by_model);
end $$;

create or replace function public.weather_display(w public.weather_forecasts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'version', 10,
    'primary_model', w.primary_model,
    'source_count', coalesce(jsonb_array_length(src.arr), 0),
    'centre_count', (w.raw -> 'provenance' ->> 'centres_returned')::int,
    'horizon_hours', w.horizon_hours,
    'fetched_at', w.fetched_at,
    'forecast_valid_for', w.forecast_valid_for,
    'sources', coalesce(src.arr, '[]'::jsonb),
    -- The vote, or nothing. No fallback verdict: the only one a row without a
    -- vote carries is the retired variable-spread label, and a verdict that is
    -- always the same value is worse than none. The app falls back to a plain
    -- source count when this is absent.
    'agreement', case
      when ms.v is not null then jsonb_build_object(
        'level',           ms.v ->> 'agreement',
        'note',            ms.v ->> 'summary',
        'centre_count',    (ms.v ->> 'centres_scored')::int,
        'star_range',      (ms.v ->> 'range')::int,
        'median_stars',    (ms.v ->> 'median_stars')::int,
        'centres_fair_or_better', (ms.v ->> 'centres_fair_or_better')::int,
        'agreeing_centres',   (ms.v ->> 'agreeing_centres')::int,
        'dissenting_centres', (ms.v ->> 'dissenting_centres')::int,
        'divergent_field', w.raw -> 'comparison' ->> 'divergent_field',
        'source',          'centre_vote')
      end,
    -- The old spread numbers stay whole and inspectable; the sources table
    -- under the banner still reads from them. They just are not a judgement.
    'variable_spread', w.raw -> 'comparison',
    'centre_vote', ms.v - 'by_model',
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
  -- Anchored on a one-row subselect so a weather row whose stop has been
  -- deleted still renders. v9 had stops first in the FROM list, which made the
  -- whole contract null for an orphaned row rather than just its shot_type.
  from (select 1) anchor
  left join lateral (
    select shot_type from public.stops where id = w.stop_id limit 1
  ) st on true
  left join lateral (
    select public.weather_model_scores(w, st.shot_type) as v
  ) ms on true
  left join lateral (
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
  ) src on true
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
