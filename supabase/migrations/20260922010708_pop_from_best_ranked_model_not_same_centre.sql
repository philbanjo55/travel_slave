-- Correcting resolve_pop_from_same_centre_sibling, applied earlier today.
--
-- That version preferred a model from the SAME CENTRE as the primary, on the
-- reasoning that HARMONIE's own blended sibling describes the same forecast.
-- That reasoning is wrong in practice, and Trøllkonufingur on 21 May shows why:
-- HARMONIE reports no POP, so the same-centre rule reached past ICON-EU (7 km,
-- 2.6 km away, 0%), ICON seamless (7 km, 0%) and NOAA GFS (13 km, 0%) to take
-- dmi_seamless — 25 km resolution — saying 73%, purely because it shared a
-- centre with the primary.
--
-- Worse, that number did not just display. It flipped hour_wet in weather_score
-- (pop >= 30), which armed the day-persistence floor, which put a 1.5 rain
-- penalty on an hour where every fine-resolution model said no rain at all and
-- rain_mm was 0. One star instead of two, from a coarse model's probability.
--
-- So: take the POP from the BEST-RANKED model that reports one — finest
-- resolution first, then nearest sampled grid point. Exactly the order the
-- comparison table is sorted in, and the same principle the primary itself is
-- chosen by: resolution is the real signal, distance only breaks ties. Centre
-- is irrelevant here; what matters is which model can actually resolve the
-- place.
create or replace view public.latest_weather_per_stop as
 SELECT l.id, l.stop_id, l.day_id, l.trip_id, l.fetched_at, l.forecast_valid_for,
    l.source, l.temperature_c, l.cloud_cover_pct, l.cloud_cover_low_pct,
    l.cloud_cover_mid_pct, l.cloud_cover_high_pct, l.precip_probability_pct,
    l.precip_mm, l.wind_speed_kmh, l.wind_gusts_kmh, l.wind_direction_deg,
    l.weather_code, l.sunrise, l.sunset, l.is_golden_hour, l.raw, l.created_at,
    l.apparent_temperature_c, l.relative_humidity_pct, l.dew_point_c, l.rain_mm,
    l.showers_mm, l.snowfall_cm, l.visibility_m, l.surface_pressure_hpa,
    l.is_day, l.uv_index, l.daylight_minutes, l.precip_hours, l.is_dark,
    l.fog_risk, l.score_stars, l.score_label, l.score_reason, l.score_components,
    l.cloud_base_m, l.cloud_top_m, l.cloud_cover_2m_pct, l.wave_height_m,
    l.wave_period_s, l.wave_direction_deg, l.swell_wave_height_m,
    l.swell_wave_period_s, l.wind_wave_height_m, l.sea_surface_temp_c,
    l.model_count, l.primary_model, l.horizon_hours,
    weather_display(ROW(l.id, l.stop_id, l.day_id, l.trip_id, l.fetched_at,
      l.forecast_valid_for, l.source, l.temperature_c, l.cloud_cover_pct,
      l.cloud_cover_low_pct, l.cloud_cover_mid_pct, l.cloud_cover_high_pct,
      l.precip_probability_pct, l.precip_mm, l.wind_speed_kmh, l.wind_gusts_kmh,
      l.wind_direction_deg, l.weather_code, l.sunrise, l.sunset, l.is_golden_hour,
      l.raw, l.created_at, l.apparent_temperature_c, l.relative_humidity_pct,
      l.dew_point_c, l.rain_mm, l.showers_mm, l.snowfall_cm, l.visibility_m,
      l.surface_pressure_hpa, l.is_day, l.uv_index, l.daylight_minutes,
      l.precip_hours, l.is_dark, l.fog_risk, l.score_stars, l.score_label,
      l.score_reason, l.score_components, l.cloud_base_m, l.cloud_top_m,
      l.cloud_cover_2m_pct, l.wave_height_m, l.wave_period_s, l.wave_direction_deg,
      l.swell_wave_height_m, l.swell_wave_period_s, l.wind_wave_height_m,
      l.sea_surface_temp_c, l.model_count, l.primary_model, l.horizon_hours)) AS display,
        CASE
            WHEN tr.archived IS TRUE OR tr.end_date IS NOT NULL AND tr.end_date < CURRENT_DATE THEN NULL::jsonb
            ELSE weather_score(ROW(l.id, l.stop_id, l.day_id, l.trip_id, l.fetched_at,
              l.forecast_valid_for, l.source, l.temperature_c, l.cloud_cover_pct,
              l.cloud_cover_low_pct, l.cloud_cover_mid_pct, l.cloud_cover_high_pct,
              l.precip_probability_pct, l.precip_mm, l.wind_speed_kmh, l.wind_gusts_kmh,
              l.wind_direction_deg, l.weather_code, l.sunrise, l.sunset, l.is_golden_hour,
              l.raw, l.created_at, l.apparent_temperature_c, l.relative_humidity_pct,
              l.dew_point_c, l.rain_mm, l.showers_mm, l.snowfall_cm, l.visibility_m,
              l.surface_pressure_hpa, l.is_day, l.uv_index, l.daylight_minutes,
              l.precip_hours, l.is_dark, l.fog_risk, l.score_stars, l.score_label,
              l.score_reason, l.score_components, l.cloud_base_m, l.cloud_top_m,
              l.cloud_cover_2m_pct, l.wave_height_m, l.wave_period_s, l.wave_direction_deg,
              l.swell_wave_height_m, l.swell_wave_period_s, l.wind_wave_height_m,
              l.sea_surface_temp_c, l.model_count, l.primary_model, l.horizon_hours), st.shot_type)
        END AS score
   FROM ( SELECT DISTINCT ON (w.stop_id) w.id, w.stop_id, w.day_id, w.trip_id,
            w.fetched_at, w.forecast_valid_for, w.source, w.temperature_c,
            w.cloud_cover_pct, w.cloud_cover_low_pct, w.cloud_cover_mid_pct,
            w.cloud_cover_high_pct,
            coalesce(
              w.precip_probability_pct,
              -- best-ranked model that reports one: finest grid, then nearest
              (select round((e.value ->> 'precip_probability_pct')::numeric)::int
                 from jsonb_each(coalesce(w.raw -> 'models', '{}'::jsonb)) e
                where e.value ->> 'precip_probability_pct' is not null
                order by (e.value ->> 'resolution_km')::numeric nulls last,
                         (e.value ->> 'distance_km')::numeric nulls last,
                         e.key
                limit 1),
              round((w.raw -> 'ensemble' -> 'by_variable' -> 'precipitation'
                       ->> 'prob_wet_pct')::numeric)::int
            ) AS precip_probability_pct,
            w.precip_mm, w.wind_speed_kmh, w.wind_gusts_kmh, w.wind_direction_deg,
            w.weather_code, w.sunrise, w.sunset, w.is_golden_hour, w.raw, w.created_at,
            w.apparent_temperature_c, w.relative_humidity_pct, w.dew_point_c, w.rain_mm,
            w.showers_mm, w.snowfall_cm, w.visibility_m, w.surface_pressure_hpa,
            w.is_day, w.uv_index, w.daylight_minutes, w.precip_hours, w.is_dark,
            w.fog_risk, w.score_stars, w.score_label, w.score_reason, w.score_components,
            w.cloud_base_m, w.cloud_top_m, w.cloud_cover_2m_pct, w.wave_height_m,
            w.wave_period_s, w.wave_direction_deg, w.swell_wave_height_m,
            w.swell_wave_period_s, w.wind_wave_height_m, w.sea_surface_temp_c,
            w.model_count, w.primary_model, w.horizon_hours
           FROM weather_forecasts w
          ORDER BY w.stop_id,
                   (((w.raw -> 'provenance'::text) ->> 'date_mode'::text) = 'trip-date'::text) DESC NULLS LAST,
                   w.fetched_at DESC) l
     LEFT JOIN stops st ON st.id = l.stop_id
     LEFT JOIN trips tr ON tr.id = l.trip_id;
