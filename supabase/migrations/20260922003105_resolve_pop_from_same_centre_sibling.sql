-- DMI HARMONIE AROME never reports a precipitation probability, and it is the
-- primary at 66 of 72 stops — so the RAIN tile on the day page has always read
-- an em dash. That is not a gap in DMI: a deterministic model runs once, and a
-- single run cannot produce a probability. Open-Meteo derives POP for the
-- seamless blends from an ensemble layer the raw run does not have.
--
-- Measured across all 72 stops today: dmi_harmonie_arome_europe and
-- dmi_seamless return IDENTICAL temperature, cloud cover and grid point at
-- 71/71 — same model, same cell — and seamless carries a POP at 72/72 while
-- HARMONIE carries one at 0/72. So the probability sitting beside the primary
-- describes the same forecast, from the same run, at the same place.
--
-- The fallback therefore prefers a model from the SAME CENTRE, which is what
-- makes it legitimate rather than a guess: it is the primary's own blended
-- sibling, not a different forecaster's opinion. Finest resolution first, so
-- it takes the closest sibling to the primary. Then the ensemble's wet
-- probability, which weather_score already falls back to.
--
-- Done in the inner query so the resolved value reaches all three consumers at
-- once — the column the app reads, weather_score, and the display contract —
-- instead of the three disagreeing about what the POP is.
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
            -- the one changed expression
            coalesce(
              w.precip_probability_pct,
              (select round((e.value ->> 'precip_probability_pct')::numeric)::int
                 from jsonb_each(coalesce(w.raw -> 'models', '{}'::jsonb)) e
                where e.value ->> 'precip_probability_pct' is not null
                  and e.value ->> 'centre' is not distinct from
                      (w.raw -> 'models' -> w.primary_model ->> 'centre')
                order by (e.value ->> 'resolution_km')::numeric nulls last,
                         (e.value ->> 'distance_km')::numeric nulls last
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
