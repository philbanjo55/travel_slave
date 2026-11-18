-- Score the forecast once per CENTRE, not just once from the primary model.
--
-- The headline score stays exactly as it is: DMI HARMONIE supplies the values,
-- because it is the Faroes' own national model at 2 km with its grid point
-- averaging 1.5 km from these stops, and it is the only source for cloud base.
-- That does not change. What this adds is the second question the headline
-- cannot answer: how many of the other centres agree.
--
-- Two reasons that matters. First, thresholds are cliffs — averaging eleven
-- centres' inputs can produce a forecast no centre actually made, so the vote
-- is taken on the VERDICTS, by running the same weather_score per centre.
-- Second, HARMONIE only runs to about 70 hours. Past that the primary falls
-- through to the globals, which is exactly when deciding whether to commit a
-- day to a location matters most, and exactly when a single model deserves
-- least trust.
--
-- One representative per centre, deliberately: eighteen model strings are not
-- eighteen opinions. DMI and KNMI run the same UWC-West HARMONIE, and every
-- _seamless string is a blend containing its own raw model. The representative
-- is the best-resolved then closest model that centre offers — the same rule
-- the consensus block already uses, so six ECMWF derivatives cannot vote six
-- times and report false confidence.
--
-- Immutable, because raw -> 'models' already carries centre, resolution_km and
-- distance_km inline; nothing here reads another table.
create or replace function public.weather_centre_scores(
  w public.weather_forecasts, p_shot_type text
) returns jsonb language plpgsql immutable as $$
declare
  rep record;
  r public.weather_forecasts;
  sc jsonb;
  by_centre jsonb := '{}'::jsonb;
  stars_list numeric[] := '{}';
  med numeric; lo int; hi int; n int; go_n int;
  spread_label text;
begin
  if p_shot_type is null or p_shot_type = 'logistics' then return null; end if;
  if w.raw -> 'models' is null then return null; end if;

  for rep in
    select distinct on (e.value ->> 'centre')
           e.value ->> 'centre' as centre,
           e.key                as model,
           e.value              as vals
    from jsonb_each(w.raw -> 'models') e
    where e.value ->> 'centre' is not null
    order by e.value ->> 'centre',
             (e.value ->> 'resolution_km')::numeric nulls last,
             (e.value ->> 'distance_km')::numeric nulls last,
             e.key
  loop
    -- Copy the stored row, then swap in this centre's numbers. Everything the
    -- scorer reads that is NOT per-model — is_dark, the day's precipitation
    -- total, the ensemble probabilities, sea state — stays shared, because
    -- those are properties of the place and the day, not of a model.
    r := w;
    r.wind_gusts_kmh         := (rep.vals ->> 'wind_gusts_kmh')::numeric;
    r.wind_speed_kmh         := (rep.vals ->> 'wind_speed_kmh')::numeric;
    r.precip_probability_pct := (rep.vals ->> 'precip_probability_pct')::int;
    r.rain_mm                := (rep.vals ->> 'rain_mm')::numeric;
    r.showers_mm             := (rep.vals ->> 'showers_mm')::numeric;
    r.snowfall_cm            := (rep.vals ->> 'snowfall_cm')::numeric;
    r.weather_code           := (rep.vals ->> 'weather_code')::int;
    r.visibility_m           := (rep.vals ->> 'visibility_m')::numeric;
    r.fog_risk               := rep.vals ->> 'fog_risk';
    r.cloud_cover_pct        := (rep.vals ->> 'cloud_cover_pct')::int;
    r.cloud_cover_low_pct    := (rep.vals ->> 'cloud_cover_low_pct')::int;

    sc := public.weather_score(r, p_shot_type);
    if sc is not null then
      by_centre := by_centre || jsonb_build_object(
        rep.centre, jsonb_build_object(
          'model',  rep.model,
          'stars',  (sc ->> 'stars')::int,
          'reason', sc ->> 'reason'));
      stars_list := stars_list || (sc ->> 'stars')::numeric;
    end if;
  end loop;

  n := coalesce(array_length(stars_list, 1), 0);
  if n = 0 then return null; end if;

  select percentile_cont(0.5) within group (order by s),
         min(s)::int, max(s)::int,
         count(*) filter (where s >= 2)::int
    into med, lo, hi, go_n
  from unnest(stars_list) s;

  -- Agreement measured on the verdicts, which is what you act on. A two-star
  -- range is ordinary model noise; four stars apart is the centres telling you
  -- they do not know.
  spread_label := case
    when hi - lo <= 1 then 'AGREED'
    when hi - lo <= 2 then 'MIXED'
    else 'CONTESTED' end;

  return jsonb_build_object(
    'centres_scored',  n,
    'median_stars',    round(med)::int,
    'min_stars',       lo,
    'max_stars',       hi,
    'range',           hi - lo,
    'agreement',       spread_label,
    -- "Fair or better" is the bar for shootable. Reported as a count rather
    -- than baked into a verdict so the bar can move without another migration.
    'centres_fair_or_better', go_n,
    'summary', go_n || ' of ' || n || ' centres say shootable',
    'by_centre', by_centre);
end $$;
