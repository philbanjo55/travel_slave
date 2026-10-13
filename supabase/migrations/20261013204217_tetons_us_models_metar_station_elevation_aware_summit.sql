-- 1. US high-resolution models (grouped under NOAA so they count as one centre)
insert into weather_models(model,centre,label,resolution_km,scope,is_blend,blend_note,serves_cloud_base,active,sort_order,notes) values
('ncep_hrrr_conus','NOAA GFS','NOAA HRRR CONUS',3,'regional',false,null,false,true,61,'3 km, hourly updates, 18 h (48 h on 00/06/12/18Z). Has low/mid/high cloud layers. Added Oct 2026 for Tetons.'),
('ncep_nbm_conus','NOAA GFS','NOAA NBM CONUS',2.5,'regional',true,'NWS National Blend of Models — statistical blend','false'::boolean,true,62,'2.5 km, 11 days. Total cloud only (no layers); snowfall + precip-type probabilities. Added Oct 2026 for Tetons.'),
('ncep_nam_conus','NOAA GFS','NOAA NAM CONUS',3,'regional',false,null,false,true,63,'3 km, 60 h. Has cloud layers. Added Oct 2026 for Tetons.')
on conflict (model) do nothing;

-- 2. Per-trip METAR station (was hard-coded EKVG in weather-pull)
alter table trips add column if not exists metar_station text;
comment on column trips.metar_station is 'ICAO station for ground-truth METAR/TAF in weather-pull. Null = skip METAR.';
update trips set metar_station = 'KJAC' where id = '5e247891-d800-4d07-b5e0-8ad748ae2754';
update trips set metar_station = 'EKVG' where id in ('e04fbc9d-86b1-42b2-bf08-fc65a18e665d','7e57bed0-0000-4000-8000-000000000001');

-- 3. Teton-backdrop stops scored as mountain (so summit-in-cloud applies)
update stops set shot_type = 'mountain'
where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754'
  and name in ('South Jenny Lake — East Shore','Taggart Lake','Colter Bay — Jackson Lake','Willow Flats Overlook','Elk Ranch Flats','Jackson Lake Dam');

-- 4. Elevation-aware summit obscuration
CREATE OR REPLACE FUNCTION public.weather_score(w weather_forecasts, p_shot_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  gust double precision; pop double precision; rain_amt double precision;
  snow double precision; code integer; vis double precision; fog text;
  long_distance boolean; close_subject boolean;
  heavy_code boolean; light_code boolean;
  rain_pen double precision := 0;
  day_total double precision; hour_wet boolean; persist_floor double precision;
  vis_base double precision := 0; obscure double precision := 0; vis_pen double precision;
  wind_pen double precision := 0; low_cloud double precision;
  stop_elev double precision;
  stars integer; labels text[] := array['Poor','Poor','Fair','Good','Excellent'];
  top_pen double precision; top_txt text; reason text;
begin
  if p_shot_type is null or p_shot_type = 'logistics' then
    return null;
  end if;

  if coalesce(w.is_dark, false) then
    return jsonb_build_object(
      'stars', 0, 'label', 'Poor', 'reason', 'After dark', 'penalty', 99,
      'components', jsonb_build_object('rain',0,'visibility',0,'wind',0,'dark',true));
  end if;

  gust     := coalesce(w.wind_gusts_kmh, w.wind_speed_kmh, 0);
  pop      := coalesce(
                w.precip_probability_pct,
                (w.raw -> 'ensemble' -> 'by_variable' -> 'precipitation' ->> 'prob_wet_pct')::float,
                0);
  rain_amt := coalesce(w.rain_mm, 0) + coalesce(w.showers_mm, 0);
  snow     := coalesce(w.snowfall_cm, 0);
  code     := w.weather_code;
  vis      := w.visibility_m;
  fog      := w.fog_risk;

  long_distance := p_shot_type in ('mountain','seascape');
  close_subject := p_shot_type in ('waterfall','canyon','urban');

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
    -- Models define "low" cloud as below ~3 km ABOVE SEA LEVEL. At sea-level
    -- stops (Faroes) that band holds the whole mountain. From a high valley
    -- (Tetons: floor ~2 km, summits 3.8-4.2 km) the peaks sit in the MID band,
    -- so a deck burying the Grand reads as low=7% / mid=100%. Above 1,000 m
    -- the stand-in for "summit in cloud" is the worse of low and mid.
    -- Elevation comes from weather-pull (v33+) in raw.provenance.
    stop_elev := nullif(w.raw -> 'provenance' ->> 'stop_elevation_m', '')::double precision;
    if stop_elev is not null and stop_elev >= 1000 then
      if w.cloud_cover_low_pct is null and w.cloud_cover_mid_pct is null then
        low_cloud := coalesce(w.cloud_cover_pct, 0);
      else
        low_cloud := greatest(coalesce(w.cloud_cover_low_pct, 0), coalesce(w.cloud_cover_mid_pct, 0));
      end if;
    else
      low_cloud := coalesce(w.cloud_cover_low_pct, w.cloud_cover_pct, 0);
    end if;
    if    low_cloud >= 90 then obscure := 2;
    elsif low_cloud >= 70 then obscure := 1;
    end if;
  end if;

  vis_pen := (case when long_distance then vis_base * 1.5
                   when close_subject then least(vis_base, 1)
                   else vis_base end) + obscure;

  -- Wind. One ladder, because the tripod is the same tripod at a waterfall as
  -- at a headland: 48 km/h = 30 mph is where he stops setting up, and nothing
  -- below that costs him anything. Reflection is the exception — the wind is
  -- acting on the subject there, not the camera.
  if p_shot_type = 'reflection' then
    wind_pen := case when gust < 10 then 0 when gust < 16 then 1 when gust < 26 then 2.5 else 4 end;
  else
    wind_pen := case when gust > 80 then 4   -- 50 mph
                     when gust > 64 then 3   -- 40 mph
                     when gust > 56 then 2   -- 35 mph
                     when gust > 48 then 1   -- 30 mph, the line he gave
                     else 0 end;
  end if;

  stars := greatest(0, least(4, round((4 - rain_pen - vis_pen - wind_pen)::numeric)::int));

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
    -- No more "hard to hold steady" — he isn't holding it. Say what the wind
    -- is actually doing to a camera that is already locked down.
    top_txt := case when p_shot_type = 'reflection' then 'Wind breaking the reflection'
                    when wind_pen >= 3 then 'Too windy to set up'
                    else 'Gusts enough to move the camera' end;
  end if;

  reason := case
    when top_pen >= 1 or (top_pen >= 0.5 and stars < 4) then top_txt
    when stars >= 4 then 'Dry, calm, clear — go'
    else 'Workable — dry and open' end;

  return jsonb_build_object(
    'stars', stars, 'label', labels[stars + 1], 'reason', reason,
    'penalty', rain_pen + vis_pen + wind_pen,
    'components', jsonb_build_object(
      'rain', rain_pen, 'visibility', vis_pen, 'wind', wind_pen, 'dark', false));
end $function$;
