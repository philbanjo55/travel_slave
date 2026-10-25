# Planner test bench: feasibility check (25 Oct 2026)

Goal: replay the planner on past days (forecast made the day before, judged against what happened).

## Forecasts made the day before (Open-Meteo Previous Runs API)

- Reachable only from the database (`net.http_get`); this container gets 403 from open-meteo.com.
- Day-ahead (`*_previous_day1`) values exist from Jan 2024 for ECMWF IFS, GFS, ICON, UKMO, Meteo-France, JMA (GEM and HRRR hit 429 in the test; retry one at a time).
- Day-ahead **total cloud, direct radiation, sunshine duration and shortwave radiation** are archived. **Low and middle cloud are not** (0 values for every model). The live planner uses low/middle cloud, so a replay must use direct radiation (or total cloud) as the sun signal.
- The live ECMWF ensemble API returns `direct_radiation` for all 51 members, so the live planner could switch to the same signal if replays show it is better.
- Single Runs API: ECMWF run 2024-12-28T12 not available; ensemble single runs 404. No archived 51-member ensembles.
- Usable replay windows: Faroes 13–28 May 2024, 2025, 2026 (~48 days); Teton Dec–Jan 2024/25 and 2025/26 (~120 days). About 6 models per day stand in for the 51 versions.

## What happened (truth)

- Airport history: EKVG and KJAC METAR already loaded (`metar_history_events`).
- Open-Meteo Satellite API (`satellite-api.open-meteo.com/v1/archive`): hourly direct normal irradiance at any point, both places (no 15-minute values). Sun out = DNI > 120 W/m² (the WMO sunshine threshold).
- Check against airports, daylight hours with the sun above 10°: agrees with METAR "mostly clear" 76% at EKVG (May 2024, 427 h) and 77% at KJAC (Dec 2024–Jan 2025, 415 h). The satellite says "sun" more often (39% vs 23% EKVG, 59% vs 46% KJAC): sun through broken cloud, which METAR counts as not mostly clear. For photos, "sun on the land" is the better question.
- GOES clear-sky mask (CONUS, 5 min, 2 km) is public on AWS (`noaa-goes16/ABI-L2-ACMC`) and reachable from here; Teton only, needs NetCDF processing (GitHub Actions). Not needed if the satellite API is good enough.
- Webcams: archive starts Oct 2026, so none for past years.
