-- The agreement label was max_stars - min_stars, which reads only the two most
-- extreme centres out of eleven. Nine can agree exactly and two dissenters set
-- the label. That is the same extreme-value fault that pinned the old
-- TIGHT/LOOSE/SPLIT banner: a statistic that widens with the number of
-- reporters whether or not the forecasts actually diverged.
--
-- Kallur is the clearest case. Its eleven centres read 3,3,2,2,2,2,2,2,1,1,1 -
-- eight of them sitting on exactly 2, nobody more than one star from the
-- median. It labelled MIXED, because 3 - 1 = 2. Haldarsvik was worse: ten of
-- eleven clustered, one centre four stars adrift, and it read CONTESTED.
--
-- So measure the cluster instead of the extremes: take the median, then count
-- how many centres sit within one star of it. Anything further out is a
-- dissenter, and dissenters are counted rather than allowed to define the
-- range.
--
--     0 dissenters   AGREED
--     1-2            MIXED
--     3 or more      CONTESTED
--
-- Held as fractions so it still behaves when fewer than eleven centres report.
--
-- Note what this label is NOT. It does not say conditions are good, and it is
-- not a second opinion on the star rating. It says how tightly the centres
-- cluster, which is the one thing the count beside it cannot tell you - the
-- count already says how many clear the shootable bar. Measuring the vote
-- split here instead would make the word a restatement of the number, and
-- would also manufacture disagreement whenever the centres cluster tightly but
-- straddle the two-star bar, which is exactly what Eidiskollur and Funningur
-- do at 4 of 11.
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
  near_n int; near_frac numeric;
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
    -- scorer reads that is NOT per-model - is_dark, the day's precipitation
    -- total, the ensemble probabilities, sea state - stays shared, because
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

  select count(*) filter (where abs(s - med) <= 1)::int
    into near_n
  from unnest(stars_list) s;
  near_frac := near_n::numeric / n;

  spread_label := case
    when near_frac >= 0.95 then 'AGREED'
    when near_frac >= 0.80 then 'MIXED'
    else 'CONTESTED' end;

  return jsonb_build_object(
    'centres_scored',  n,
    'median_stars',    round(med)::int,
    'min_stars',       lo,
    'max_stars',       hi,
    -- Kept for inspection, no longer the verdict: one adrift centre stretches
    -- this while ten agree.
    'range',           hi - lo,
    'agreement',       spread_label,
    'agreeing_centres', near_n,
    'dissenting_centres', n - near_n,
    -- "Fair or better" is the bar for shootable. Reported as a count rather
    -- than baked into a verdict so the bar can move without another migration.
    'centres_fair_or_better', go_n,
    'summary', go_n || ' of ' || n || ' centres say shootable',
    'by_centre', by_centre);
end $$;
