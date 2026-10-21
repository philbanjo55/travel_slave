# New trip: setup checklist

How to take a trip from "Phil has an itinerary" to everything working: app, maps, weather, sun shots, the solver, webcams and the scoreboard. Written 21 Oct 2026 after setting up Grand Teton Winter 2026, the first trip outside the Faroes.

**The check:** `select * from trip_readiness('<trip id>');` returns one row per item below with `ok` / `todo` (a step not done yet) / `wait` (a job will do it) / `warn` (works, but degraded) / `info`. Run it after each phase and again the morning after. It is read-only (migration `20261021300000_trip_readiness.sql`).

The app cannot create trips, days or stops (nothing calls `insertStop`), and nothing writes `accommodations`, so phases 1 and 3–6 are done by Claude in SQL. Phase 1 is one call: `trip_import(json)`. Hard rules from CLAUDE.md still apply: never DELETE stops (move them with UPDATE day_id/position), and never add a camera without the owner's permission.

---

## 0. What Phil provides (only Phil can)

| What | Used for | If missing |
|---|---|---|
| Trip name, dates, who is going | trip row, web viewer | — |
| Day-by-day stops in order, each with a Google Maps link or pin | everything | a stop without coordinates gets no weather, map, drive time or sun |
| Booked times: flights, tours, ferries, tables | fixed visits in plans | the solver may move them |
| Hotels: name, pin, check-in and check-out dates | solver days start and end there | the solver can't plan that day ("no hotel") |
| For each photo stop: subject (peak, waterfall, building), where to stand if known, sunrise/sunset/any, how much it matters | sun shots, solver tiers and light | Claude suggests; Phil confirms later |
| Webcams near the stops: owner's permission | live cameras, scoreboard truth | no cameras |
| Web viewer wanted? | phase 8 | skip |

---

## 1. Trip skeleton (Claude, SQL): `trip_import`

Turn Phil's itinerary (any form: a doc, a list of Google Maps links, a chat message) into JSON and run `select trip_import('<json>', true);` (dry run: every problem listed, nothing written), then `select trip_import('<json>');`. The JSON format is in the header of `supabase/migrations/20261021320000_trip_import.sql`: `trip`, `days[].stops[]`, `accommodations[]`.
- It checks everything first and writes nothing if anything is wrong. It only inserts; it never updates or deletes.
- It converts 24-hour times to "h:mm AM/PM".
- It adds the hotel as a logistics stop at the start and end of each new day, unless a stop is already within 500 m.
- `{"trip_id": ..., "days": [...]}` appends to an existing trip: new dates become new days, and stops on an existing date go after its last stop.

What the rows need (`trip_import` enforces the required parts):

- **`trips`**: `title`, `start_date`, `end_date`, `travelers`, `archived = false`, and:
  - **`timezone`** (IANA, e.g. `America/Denver`). Required. Without it the solver and the sun planner fall back to the forecasts' zone and, before the first forecast, to UTC: day windows and light dates go wrong silently.
  - **`metar_station`**: the airport within 30 km of the stops (ICAO, e.g. `KJAC`). With none set, a 10-minute job guesses a station per day, which can pick a station whose observations are never fetched (the Teton trip got KDIJ).
- **`days`**: one per date, `day_number`, `date`. Every trip date should have a day.
- **`stops`**: `trip_id`, `day_id`, `position`, `name`, `lat`, `lng`, `duration_minutes`, and:
  - `time_label` as **"h:mm AM/PM"** (`~` allowed): the app reads only that. The solver also reads 24-hour times since 21 Oct 2026.
  - `shot_type`: mountain / seascape / waterfall / canyon / urban / reflection for photo stops; **`logistics`** for airports, hotels, food, fuel. Logistics stops get no weather score, no ensemble pull and no solver settings.
  - `time_locked = true` for bookings.
- **`accommodations`**: `trip_id`, `name`, `lat`, `lng`, `check_in`, `check_out`, `nights`. Start the hotel's logistics stop name with the hotel's first word (the solver matches by first word within 500 m, else the nearest stop). Put a logistics stop at the hotel at the start and end of each day.

## 2. Automatic: wait minutes to hours

Nothing to run. pg_cron fills these for live trips (not archived, `end_date` not past):

| Job | When (UTC) | Fills |
|---|---|---|
| `stop-elevation-refresh` | every 5 min | `stops.elevation_m` |
| `model-grid-refresh` | every 5 min | `model_grid_points`: which weather models cover each stop (live trips, including stops moved mid-trip) |
| `model-skill-refresh` | every 10 min | `metar_stations`, `station_obs_hourly`, `model_skill` for the trip's station |
| `hourly-weather-pull` / `daily-preview-refresh` | :07 hourly / 05:10 | display weather. Days more than 15 days out get a "preview" (today's weather as that day) |
| `weather-ensemble-pull` | 22:17 | 51-member ECMWF archive per 0.25° cell of the photo stops |
| Drive minutes | when the trip opens in the app | `stops.drive_override_minutes` (Google, on the phone) |

## 3. Terrain: before adding shots, only outside the Faroes

The Faroes have a built-in elevation grid (`dem_blocks`). Anywhere else, load a region grid first, or every shot is marked `outside_dem`: light still works but **shade is unknown**, and those profiles are not retried on their own.

1. Box: every stop and subject plus about 25 km on each side (horizons reach 29 km).
2. Load it: POST `dem-region-load` `{region, south, north, west, east}` from SQL with `net.http_post`, looping on `next_row` (60 rows per call). Size is about 2 bytes per cell at the default 0.0015° step (~150 m): Grand Teton is 634 × 954 cells, 1.3 MB. For a big area (all of Iceland, ~30 MB) load several smaller boxes, or use a coarser step.
3. If shots already exist: `select dem_region_recompute('<region>');`.

## 4. Sun shots (Claude, then Phil refines in the app)

For each photo stop:
- `scout_subjects`: what is photographed (`lat`, `lng`, `height_m`, `subject_kind`). Shared subjects are fine (Grand Teton summit for most Teton stops).
- `scout_vantages`: where Phil stands. Use the stop's coordinates with `coord_confidence = 'approximate'` when the exact spot is unknown.
- `stop_sun_pairs` (`stop_id`, `vantage_id`, `position` 0 = starred).

Triggers build each terrain profile (~180 KB each) and the skyline cache. Phil can move pins and add or link shots in the app's sun editor.

## 5. Solver (Claude suggests, Phil confirms)

- **`solver_stop_settings`** for every photo stop: `tier` (GOD / S / A / B / C), `light_wanted` (front / side / back / soft), `fog_wanted`, `time_locked`, `source = 'suggested'`. When Phil confirms or changes a stop, set `source = 'phil'`.
- **Drive matrix**: `select net.http_post('https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-drive-matrix', '{"trip_id":"<id>"}'::jsonb, ...)`, then read `net._http_response`.
  - Repeat while it reports an element cap (about 50 spots per call).
  - Pairs with no route are never planned: car ferries need a `solver_ferry_links` row.
  - Spots cut off from the rest by a gap of more than 300 km (home airports) are left out (`left_out` in the reply). A long chain of stops, like the Iceland Ring Road, is kept.
- Nightly, the trip is picked up once it has rated stops: `solver-build-scores` 22:41, `solver-plan` 22:55 UTC. To see plans the same day, plan a trip day from the TEST app's Planner (light-only past the forecast).

## 6. Ground truth: scoreboard and backtest

- **METAR**: the station set in phase 1. Observations arrive within about 10 minutes. The scoreboard uses stations within 30 km of the stops; the backtest uses truth within 12 km.
- **Calibration history** (optional, about 10 minutes, worth doing for a new climate):
  - Run `select calib_queue_month('<ICAO>', <month>, array(select generate_series(2016, 2026)), array[2024, 2025, 2026]);` for each trip month (METAR years, then ECMWF archive years).
  - Then run `select calib_load_history();` until the queue is empty. Iowa Mesonet throttles parallel requests, so re-queue failed years one at a time.
  - Finally run `select solver_fit_calibration_months('<ICAO>', 'history_<season>', array[<months>]);` (KJAC used `history_winter`, months 12 and 1).
  - Base rates are in `metar_climatology`.
- **Webcams**: only with the owner's permission. Add a `webcam_cameras` row with these fields:
  - `code`, `name`, `lat`, `lng`, `active`, `source`
  - `permission_note`: who agreed, and when
  - `region`
  - `tz`: the camera's timezone, needed for stale detection and templated URLs
  - `image_url`: a direct image link, or a template like `https://…/{YYYY}/{MM}/{DD}/{HHmm}.jpg` (15-minute steps, camera tz)

  A page that loads its camera with JavaScript has no usable link: ask the owner for one. Cameras show on any trip with stops within 50 km. The next hourly run (:37) fetches and labels them.

## 7. Check

- Run `select * from trip_readiness('<id>');`. Everything should be `ok`, `wait` or `info`.
- **Next morning:** `nightly score build` and `plans` should be `ok`.
- **In the app:** the trip shows in the list, the day maps have pins, the stop weather cards fill in, and the sun panels show light and shade.
- **In the TEST app:** the Planner opens with the trip's cameras and plans.

## 8. Web viewer (optional)

Copy `faroes-web/` to `<trip>-web/` and change five places: the `<title>`, `TRIP_ID`, the fallback title, the travellers line and the footer. Commit to `master`, then add a Netlify site whose base directory is the new folder. The page reads Supabase live, so there is nothing to refresh.

## 9. During and after the trip

- Mark shots got or nailed: the TEST app tick, or `solver_mark_shot` in chat.
- Label webcam frames in the TEST app. Phil's labels are the scoreboard's best truth.
- **Archive the trip when it is over.** Until then the nightly weather, ensemble and solver jobs keep running for it, using API quota and database space (free plan, 500 MB cap).

---

## Known gaps

Found by the 21 Oct 2026 audit. Fixed the same day, without changing the real app (app changes went to the TEST app only):

| Gap | Fix |
|---|---|
| `webcam-archive` kept the 12:00 UTC frame forever: night or dawn outside Europe | v14 keeps the capture nearest each camera's solar noon (12 UTC in the Faroes, 19 UTC at the Tetons) |
| `webcam-archive` prompt said "road cameras" and used `island` | Neutral foreground wording; the place name is shown only when set |
| `upload-exposure-photo` took uploads with no login and could overwrite any file in `photos` | v5: new files under `exposures/` only, no overwrite, ~10 MB cap. Nothing in the app calls it |
| `model-grid-refresh` only while `start_date >= today` | Live trips (`20261021310000_new_trip_gap_fixes.sql`) |
| Scoreboard used stations without observations (KDIJ) | Only stations with an observation in the last 3 days |
| `solver_light_cache` never pruned | `solver_prune_light_cache()`, weekly `solver-light-prune` (Sun 04:23 UTC): dates over 3 days past |
| Faroe trip had no `trips.timezone` | Set to `Atlantic/Faroe` |
| `solver-plan` read only "h:mm AM/PM" | v14 also reads "HH:MM" |
| `solver-drive-matrix` dropped spots over 300 km from the middle | v4 chains spots (gap over 300 km = left out) |
| HARMONIE requested anywhere east of 40°W | `weather-ensemble-pull` v8: a box around Europe only |
| TEST app: exposure times stored as `-04:00` | The phone's offset at the moment of the shot (TEST app only) |
| TEST app: maps opened on the Faroes; "DMI only" fog; `island` on the camera card | Trip's first stop, else the world; fog says blank outside northern Europe; place shown only when set |
| Web viewers used the legacy JWT key | Publishable key; live on `master` since 21 Oct 2026 (both pages checked by Phil) |
| Deployed but not in the repo | `calculate-drive-times`, `upload-exposure-photo`, `migrate-photos-to-storage` added. `iceland` (an old archived trip page) and the retired `dem-load` / `webcam-probe` stubs are still only on the server |
| No import | `trip_import(json)` |

Still open: outside Europe the solver's fog and cloud-base gate has only GFS/UKMO visibility (no HARMONIE). This is a data limit, not a bug.
