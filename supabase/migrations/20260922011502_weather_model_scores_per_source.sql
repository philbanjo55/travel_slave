-- Score EVERY model, not just one representative per centre, so each row of
-- the comparison table can carry its own rating.
--
-- The centre vote still de-duplicates: DMI and KNMI run the same HARMONIE and
-- every _seamless string contains its own raw model, so an ungrouped count
-- would let ECMWF vote three times and read as false confidence. That stays.
-- What changes is that the per-model scores it was already computing
-- internally are now returned as well, instead of being thrown away.
--
-- One pass: 18 weather_score calls per row, down from the 11 + 18 that scoring
-- twice would have cost. The centre representative is picked from the same
-- results — best resolution, then nearest grid point, then model name.
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
  -- brand an otherwise settled forecast as contested.
  spread_label := case when hi - lo <= 1 then 'AGREED'
                       when hi - lo <= 2 then 'MIXED'
                       else 'CONTESTED' end;

  return jsonb_build_object(
    'centres_scored', n,
    'median_stars', round(med)::int,
    'min_stars', lo, 'max_stars', hi, 'range', hi - lo,
    'agreement', spread_label,
    'centres_fair_or_better', go_n,
    'summary', go_n || ' of ' || n || ' centres say shootable',
    'by_centre', by_centre,
    'by_model', by_model);
end $$;
