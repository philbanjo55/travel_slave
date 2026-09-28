-- Scoring, ported from the TypeScript that currently lives in two places:
-- the edge function and src/services/weather.ts. Identical maths, so the port
-- can be checked against score_stars on every row already stored.
--
-- Nothing reads this yet. It is created first so it can be verified against
-- real history before anything depends on it.
--
-- Deliberately unchanged from the original, including what it does NOT score:
-- cloud and light are left out on purpose — flat overcast is a working
-- condition for large-format B&W, not a penalty. What is scored is whether
-- the camera can be held (wind), the film kept dry (rain), and the subject
-- seen at all (fog).
--
-- shot_type is a parameter rather than a stored value so the score follows
-- the stop's CURRENT type: change a stop from landscape to reflection and the
-- stars move on the next read, with no re-pull.
create or replace function public.weather_score(
  w public.weather_forecasts,
  p_shot_type text
) returns jsonb
language plpgsql immutable as $$
declare
  gust double precision; pop double precision; rain_amt double precision;
  snow double precision; code integer; vis double precision; fog text;
  long_distance boolean; close_subject boolean;
  heavy_code boolean; light_code boolean;
  rain_pen double precision := 0;
  day_total double precision; hour_wet boolean; persist_floor double precision;
  vis_base double precision := 0; obscure double precision := 0; vis_pen double precision;
  wind_pen double precision := 0; low_cloud double precision;
  stars integer; labels text[] := array['Poor','Poor','Fair','Good','Excellent'];
  top_pen double precision; top_txt text; reason text;
begin
  if p_shot_type is null or p_shot_type = 'logistics' then
    return null;
  end if;

  if coalesce(w.is_dark, false) then
    return jsonb_build_object(
      'stars', 0, 'label', 'Poor', 'reason', 'After dark',
      'components', jsonb_build_object('rain',0,'visibility',0,'wind',0,'dark',true));
  end if;

  gust     := coalesce(w.wind_gusts_kmh, w.wind_speed_kmh, 0);
  pop      := coalesce(w.precip_probability_pct, 0);
  rain_amt := coalesce(w.rain_mm, 0) + coalesce(w.showers_mm, 0);
  snow     := coalesce(w.snowfall_cm, 0);
  code     := w.weather_code;
  vis      := w.visibility_m;
  fog      := w.fog_risk;

  long_distance := p_shot_type in ('mountain','seascape');
  close_subject := p_shot_type in ('waterfall','canyon','urban');

  -- A weather CODE only counts toward a tier when measured precip (or, for the
  -- milder tiers, probability) backs it up: Open-Meteo occasionally returns a
  -- spurious convective code on a dry hour.
  heavy_code := (rain_amt > 1.0 or pop >= 55);
  light_code := (rain_amt > 0.1 or pop >= 35);

  if rain_amt > 4 or coalesce((code in (65,82,75) or code >= 95) and heavy_code, false) then
    rain_pen := 4;
  elsif rain_amt > 2 or coalesce(code in (63,81,73) and heavy_code, false) then
    rain_pen := 3;
  elsif rain_amt > 0.7 or coalesce(code = 61 and light_code, false) then
    rain_pen := 2;
  elsif rain_amt > 0.1
     or coalesce(((code between 51 and 57) or code in (80,71)) and light_code, false)
     or snow > 0 then
    rain_pen := 1;
  end if;

  if rain_pen <= 1 and pop >= 60 then rain_pen := rain_pen + 1;
  elsif rain_pen = 0 and pop >= 40 then rain_pen := rain_pen + 0.5;
  end if;

  if p_shot_type = 'seascape' and rain_pen > 0 and rain_amt <= 0.7 then
    rain_pen := greatest(0, rain_pen - 0.5);
  end if;

  -- Judge the whole day, not just the matched hour — but only when the hour
  -- itself is wet-ish, so a dry dawn does not inherit a wet afternoon.
  day_total := (w.raw ->> 'precip_total_mm')::double precision;
  hour_wet  := (pop >= 30) or (rain_amt > 0.1);
  if day_total is not null and hour_wet then
    persist_floor := 0;
    if    day_total >= 10  then persist_floor := 3;
    elsif day_total >= 5   then persist_floor := 2;
    elsif day_total >= 2.5 then persist_floor := 1;
    end if;
    if p_shot_type = 'seascape' then persist_floor := greatest(0, persist_floor - 0.5); end if;
    rain_pen := greatest(rain_pen, persist_floor);
  end if;

  if    fog = 'likely'   or (vis is not null and vis < 1000) then vis_base := 2;
  elsif fog = 'possible' or (vis is not null and vis < 4000) then vis_base := 1;
  elsif vis is not null and vis < 8000 then vis_base := 0.5;
  end if;

  if p_shot_type = 'mountain' then
    low_cloud := coalesce(w.cloud_cover_low_pct, w.cloud_cover_pct, 0);
    if    low_cloud >= 90 then obscure := 2;
    elsif low_cloud >= 70 then obscure := 1;
    end if;
  end if;

  vis_pen := (case when long_distance then vis_base * 1.5
                   when close_subject then least(vis_base, 1)
                   else vis_base end) + obscure;

  if p_shot_type = 'reflection' then
    wind_pen := case when gust < 10 then 0 when gust < 16 then 1 when gust < 26 then 2.5 else 4 end;
  elsif p_shot_type = 'seascape' then
    wind_pen := case when gust > 70 then 3 when gust > 50 then 2 when gust > 36 then 1 when gust > 26 then 0.5 else 0 end;
  elsif p_shot_type in ('waterfall','canyon') then
    wind_pen := case when gust > 60 then 3 when gust > 45 then 2 when gust > 30 then 1 when gust > 20 then 0.5 else 0 end;
  else
    wind_pen := case when gust > 80 then 2 when gust > 60 then 1 when gust > 45 then 0.5 else 0 end;
  end if;

  -- ::numeric matters. round() on double precision rounds half to even in
  -- Postgres, so round(2.5) would give 2, where JavaScript's Math.round gives 3.
  stars := greatest(0, least(4, round((4 - rain_pen - vis_pen - wind_pen)::numeric)::int));

  -- Largest penalty names the reason; ties keep the earlier one, matching the
  -- reduce() in the TypeScript, which starts at 0 and replaces only on >.
  top_pen := 0; top_txt := '';
  if rain_pen > top_pen then
    top_pen := rain_pen;
    top_txt := case when rain_pen >= 3 then 'Heavy rain'
                    when rain_pen >= 2 then 'Rain likely'
                    else 'Some rain risk' end;
  end if;
  if vis_pen > top_pen then
    top_pen := vis_pen;
    top_txt := case when fog = 'likely' then 'Fog — poor visibility'
                    when p_shot_type = 'mountain' and obscure > 0 then 'Summit likely in cloud'
                    else 'Haze / low visibility' end;
  end if;
  if wind_pen > top_pen then
    top_pen := wind_pen;
    top_txt := case when p_shot_type = 'reflection' then 'Wind breaking the reflection'
                    when p_shot_type = 'seascape'   then 'Big swell — hard to hold steady'
                    else 'Windy — motion in long exposures' end;
  end if;

  reason := case
    when top_pen >= 1 or (top_pen >= 0.5 and stars < 4) then top_txt
    when stars >= 4 then 'Dry, calm, clear — go'
    else 'Workable — dry and open' end;

  return jsonb_build_object(
    'stars', stars, 'label', labels[stars + 1], 'reason', reason,
    'components', jsonb_build_object(
      'rain', rain_pen, 'visibility', vis_pen, 'wind', wind_pen, 'dark', false));
end $$;
