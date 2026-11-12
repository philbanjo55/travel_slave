# Audit of `docs/NEW_TRIP_SOP.md` (checked 12 Nov 2026)

Checklist version audited: the file on the work branch `ccr-dba965ff-afy6cz`, 146 lines, last changed 23 Oct 2026 (commit 95bd39b).
Method: every claim compared with the live database (function definitions, tables, columns, cron jobs, row counts; read-only SQL through the Management API), the repo (edge function source, migrations, app code on `origin/update`) and `CLAUDE.md`. Nothing was written to the database or the repo.

Not done: the `trip_import(json, true)` dry run was not executed (the session's safety check refused the call). Its dry-run behaviour is taken from the live definition, which returns before the first insert.

## Headline

| Verdict | Count |
|---|---|
| Still right | 57 |
| Wrong or out of date | 6 |
| Incomplete (true as far as it goes, but leaves out something a new trip needs today) | 13 |
| Not re-checked (needs a phone, or is a history note) | 7 |
| **Claims looked at** | **83** |

Of the 76 claims that could be checked: 57 right, 6 wrong, 13 incomplete. Two of the "right" verdicts (51, 57) rest on CLAUDE.md, not on re-reading the code.

The wrong ones are three cron times (31, 48, 67), the database plan size (77), one stale repo note (79) and the promise that the checker ends all green (61). The real problem is not what the checklist says but what it leaves out: it was written for the old nightly planner (`solver-plan`). Everything about T is missing (section B below).

## A. Every claim, in checklist order

Verdicts: RIGHT / WRONG / INCOMPLETE / NOT CHECKED.

### Intro

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `trip_readiness('<id>')` returns rows with ok / todo / wait / warn / info | RIGHT | Ran it on four trips; 23 rows each (21 on a trip with no station) |
| 2 | It is read-only, migration `20261021300000_trip_readiness.sql` | RIGHT | Live definition is `STABLE`, only selects; the file exists and is the only migration that defines it (never updated since 21 Oct) |
| 3 | "one row per item below" | INCOMPLETE | No rows for T, the practice copy, 3D terrain, trip rules, camera reading (section C) |
| 4 | The app cannot create trips, days or stops (nothing calls `insertStop`) | RIGHT | `origin/update`: `insertStop` is defined in `src/services/supabase.ts` and called nowhere; no insert into trips / days / stops in `src` |
| 5 | Nothing writes `accommodations` | RIGHT | No write to `accommodations` in `src` on `origin/update` |
| 6 | Phases 1 and 3-6 are done by Claude in SQL; phase 1 is `trip_import(json)` | RIGHT | Function exists: `trip_import(p jsonb, p_dry_run boolean default false)` |
| 7 | Hard rules: never DELETE stops, no camera without permission | RIGHT | CLAUDE.md "Data safety" |

### 0. What Phil provides

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 8 | The list of what only Phil can give | INCOMPLETE | Missing today: once-only outings, keep-together groups, gear rental window (which stops, pickup and return time), fixed days, stops that look fine under cloud, his OK on the trip rules (`planner_t_trips.rules_checked`), whether notes ("Tell T") and the plan check are on, the camera reading budget, how long the practice copy should run |
| 9 | Booked times missing: the solver may move them | RIGHT | T treats a rated stop with `stops.time_locked` as a booking (CLAUDE.md, solver-replay v26) |
| 10 | Hotel missing: "no hotel" | RIGHT | `solver-replay/index.ts` line 727 returns `no hotel: pass hotel_stop_id` |
| 11 | Webcams are for live cameras and scoreboard truth | INCOMPLETE | Cameras are now also T's live truth (camera vote `t_truth`, camera look after sunrise, Re-plan now), and reading them costs money (`label_paused`, spend caps) |

### 1. Trip skeleton

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 12 | `trip_import('<json>', true)` lists every problem and writes nothing | RIGHT | Live definition: `if p_dry_run then return ...` before any insert. Not executed here |
| 13 | JSON format is in the header of `20261021320000_trip_import.sql` | RIGHT | Header read |
| 14 | Checks first, writes nothing if anything is wrong; insert only | RIGHT | Definition: returns on `errs`; only `insert` statements |
| 15 | Converts 24-hour times to "h:mm AM/PM" | RIGHT | Definition (`regexp_match` then rebuild) |
| 16 | Adds the hotel stop at both ends of each new day unless a stop is within 500 m | RIGHT | Definition (`gc_km(...) > 0.5`); `"hotel_stops": false` turns it off |
| 17 | `{"trip_id", "days"}` appends | RIGHT | Definition |
| 18 | `trips`: title, dates, travelers, `archived = false` | RIGHT | Insert list in the definition |
| 19 | `timezone` is required | RIGHT | Import refuses without it; T uses `coalesce(timezone, 'UTC')` everywhere |
| 20 | `metar_station`; with none a 10-minute job guesses one per day | RIGHT | `refresh_model_skill_step()` sets `days.metar_station` when the trip has none |
| 21 | `days`: one per date | RIGHT | Readiness flags gaps |
| 22 | `stops.time_label` "h:mm AM/PM", `~` allowed, 24-hour also read | RIGHT | Import regex accepts both |
| 23 | `shot_type`; logistics stops get no weather score, ensemble pull or solver settings | RIGHT | `stop_cell_map` and the ensemble pull leave out `logistics`. The list of shot types is not enforced by any constraint |
| 24 | `time_locked = true` for bookings | INCOMPLETE | True, but T also needs: fixed days and anchors in its config for arrival / departure / gear days; stop names must be the place only (Phil, 26 Oct) |
| 25 | Hotel stop name starts with the hotel's first word (matched within 500 m, else nearest) | RIGHT | Same rule in `solver-replay/index.ts` (`accStop`, lines ~660-675) |

### 2. Automatic

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 26 | Nothing to run; cron fills these for live trips (not archived, end date not past) | RIGHT | Filters read in each job |
| 27 | `stop-elevation-refresh` every 5 min | RIGHT | `cron.job` `*/5 * * * *` |
| 28 | `model-grid-refresh` every 5 min, live trips | RIGHT | `*/5`; definition filters `archived is not true and end_date >= current_date` |
| 29 | `model-skill-refresh` every 10 min | RIGHT | `*/10` |
| 30 | `hourly-weather-pull` :07 hourly, preview 05:10 | INCOMPLETE | Hourly only for today and tomorrow; other days within 15 days at 05, 11, 17, 23 UTC (job text) |
| 31 | `weather-ensemble-pull` at 22:17 | WRONG | `17 10,19 * * *` (twice a day since 21 Oct). Also pulls ECMWF 16 days when a live trip is 4-15 days out |
| 32 | Drive minutes are filled when the trip opens in the app | RIGHT | `origin/update` `src/store/tripStore.ts` calls `calculateDriveTimesForTrip` once when legs are missing |

### 3. Terrain

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 33 | Faroes have `dem_blocks`; elsewhere load a region grid or shots are `outside_dem` | RIGHT | Tables exist; `dem_regions` holds only `grand_teton` |
| 34 | Box = stops and subjects plus about 25 km (horizons reach 29 km) | NOT CHECKED | Design number, not traced |
| 35 | `dem-region-load` body, loop on `next_row`, 60 rows a call, step 0.0015; Teton 634 x 954 | RIGHT | Function source; `dem_regions` row |
| 36 | `dem_region_recompute('<region>')` | RIGHT | Exists |
| 37 | This is all the terrain a trip needs | INCOMPLETE | The 3D view needs its own files: `terrain_regions`, `terrain_near_regions`, bucket `terrain`, and a data check of the source (CLAUDE.md "Terrain rule for every trip", 12 Nov) |

### 4. Sun shots

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 38 | `scout_subjects` (`lat`, `lng`, `height_m`, `subject_kind`); shared subjects are fine | RIGHT | Columns exist. Note for T: stops that share a starred shot count as ONE place (Swan Lake / Colter Bay) |
| 39 | `scout_vantages`, `coord_confidence = 'approximate'` | RIGHT | Column exists, no constraint |
| 40 | `stop_sun_pairs` position 0 = starred | RIGHT | `solver_stop_inputs` falls back to the lowest position when `solver_stop_settings.star_vantage_id` is null (21 of 25 Teton stops use that fallback) |
| 41 | Triggers build the terrain profile and skyline cache | RIGHT | Triggers `scout_attach_terrain`, `scout_warm_skyline`, `stop_sun_pairs_warm`. The "~180 KB each" figure was not re-measured |
| 42 | Phil can move pins and link shots in the app's sun editor | NOT CHECKED | Needs a phone |

### 5. Solver

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 43 | `solver_stop_settings`: tier GOD / S / A / B / C, light, fog, `time_locked`, source | INCOMPLETE | Tier also allows D and F. Columns added since: `once`, `together`, `needs_peaks`, `star_vantage_id`, `shot_status` / `shot_value` / `shot_at` |
| 44 | Drive matrix through `net.http_post` to `solver-drive-matrix` | RIGHT | Deployed (v8) |
| 45 | Repeat while it reports an element cap | RIGHT | Source: `element cap reached; call again` |
| 46 | No-route pairs are never planned; ferries need `solver_ferry_links` | RIGHT | View `solver_drive_matrix`; 1 ferry link stored |
| 47 | Spots past a 300 km gap are left out (`left_out`) | RIGHT | Source `LINK_KM = 300` |
| 48 | Nightly: `solver-build-scores` 22:41, `solver-plan` 22:55 UTC | WRONG | `41 10,19` and `55 10,19`. More important: these are the old planner. The app shows T's plans once a trip has any; T's come from `planner-t-week` (04:23 UTC) and the live runs |
| 49 | Same-day plans: plan a trip day from the TEST app's Planner | INCOMPLETE | For a trip not yet on T the app still calls the old planner (`solverAction plan`); on T, "Plan again" calls `planner_t_replan`. Neither tried on a phone |

### 6. Ground truth

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 50 | Observations arrive within about 10 minutes | RIGHT | `model-skill-refresh`, KJAC / EKVG current |
| 51 | Scoreboard: stations within 30 km; backtest: truth within 12 km | RIGHT | CLAUDE.md "Truth is per place" (code not re-read) |
| 52 | `calib_queue_month(site, month, years, forecast_years)` | RIGHT | Signature matches |
| 53 | `calib_load_history()` until the queue is empty | RIGHT | Exists |
| 54 | `solver_fit_calibration_months(site, 'history_<season>', months)`; KJAC `history_winter` | RIGHT | Signature matches; `solver_calibration` has KJAC `history_winter` and `history_octnov`. Left out: a new source name needs a `solver_calib_sources` row; and this history feeds the old "learning" planner and T's truth (`metar_history`), not T's odds |
| 55 | Base rates in `metar_climatology` | RIGHT | Table exists |
| 56 | `webcam_cameras` fields to fill | INCOMPLETE | Missing: `votes`, `label_paused`, `view_lat` / `view_lng` / `view_km`, `history_url`, `hint`. `tz` defaults to `'UTC'`: camera GT-EGVB still has `UTC` |
| 57 | `image_url` may be a time template, 15-minute steps | RIGHT | CLAUDE.md, webcam-archive header |
| 58 | A page that loads its camera with JavaScript has no usable link | INCOMPLETE | Often there is one: YouTube live thumbnails, Roundshot `/quarter`, SeeJH pages (CLAUDE.md) |
| 59 | Cameras show on any trip with stops within 50 km | RIGHT | `solver-actions` `MAX_CAMERA_KM = 50` |
| 60 | The next hourly run (:37) fetches and labels them | INCOMPLETE | Fetches, yes. Labels only when `label_paused` is false and the spend caps allow; night frames are skipped. All 36 Faroes cameras are saved but none is read right now |

### 7. Check

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 61 | Everything should be ok, wait or info | WRONG | The fully set-up Teton trip shows `warn` (drive matrix, 244 pairs without a route, nearly all from two set-aside "Idea:" stops) and a `wait` that does not clear (display weather 12 of 25); the Faroes trip shows `warn` on hotels (13 May, the arrival night) |
| 62 | Next morning: `nightly score build` and `plans` should be ok | INCOMPLETE | Both watch the old planner. `plans` turns ok on any `solver_runs` row, T or not |
| 63 | In the app: list, pins, weather cards, sun panels | NOT CHECKED | Needs a phone |
| 64 | In the TEST app: Planner opens with cameras and plans | NOT CHECKED | Needs a phone |

### 7b. Training trip

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 65 | Created once stops are rated and the trip is over 3 days out; `training-autocreate` 09:13 UTC | RIGHT | Definition and cron |
| 66 | `make_training_trip` copies the first 14 days to start tomorrow; `training_until` = start + 13 | RIGHT | Definition |
| 67 | A shorter itinerary repeats via `training-roll`, 12:00 UTC | WRONG | `training-roll` runs hourly at :05 and rolls just after local midnight |
| 68 | At most 3 run at once | RIGHT | Definition |
| 69 | The raw and learning planners run on it; the daily review reports | INCOMPLETE | T runs on it too. Also `make_training_trip` does not copy `once`, `together`, `needs_peaks` (the twice-daily `training_sync` does, later), and the copy gets no trip rules, no bench place and no live run by itself (section B) |
| 70 | The learning planner needs a history fit for the station and month, else it is skipped and logged | NOT CHECKED | Functions exist (`solver_fit_live_all`, `solver_build_calib_all`, `solver_calib_sources`); the skip path was not traced |
| 71 | TEST app: training trips sit on their own screen | RIGHT | `src/screens/TrainingScreen.tsx` exists (not opened on a phone) |
| 72 | By hand: `make_training_trip('<trip>', '<start>', <days>)` | RIGHT | Signature `(p_src uuid, p_start date, p_days integer)` |

### 8. Web viewer, 9. During and after

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 73 | Copy `faroes-web/`, change five places, commit to `master`, add a Netlify site | RIGHT | The five places are in `faroes-web/index.html` (lines 7, 646, 926, ~951, 971). Not deployed as a test |
| 74 | Mark shots with the TEST app tick or `solver_mark_shot` | RIGHT | Function exists; T plans by the ticks |
| 75 | Label webcam frames in the TEST app | RIGHT | `label_frame` in `src/services/planner.ts` and `solver-actions` |
| 76 | Archive the trip when over; until then nightly jobs keep running | RIGHT | The score-build cron filters only on `archived`. (The weather and ensemble jobs do stop by themselves once `end_date` passes) |
| 77 | "free plan, 500 MB cap" | WRONG | Pro plan since 25 Oct, 8 GB included, spend cap on (CLAUDE.md) |

### Known gaps table (history notes)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 78 | `solver-light-prune` weekly, Sun 04:23 UTC | RIGHT | `23 4 * * 0` |
| 79 | `iceland`, `dem-load` and `webcam-probe` are only on the server | WRONG | `supabase/functions/webcam-probe` is in the repo now; `iceland` and `dem-load` are still server-only (both still deployed) |
| 80 | `trip_import(json)` exists | RIGHT | |
| 81 | Faroe trip timezone set to `Atlantic/Faroe` | RIGHT | `trips` row |
| 82 | The other eleven fixes (webcam-archive v14, upload fence, HARMONIE box, TEST app fixes, web viewer key ...) | NOT CHECKED | History; versions have moved on (webcam-archive is v25, weather-ensemble-pull v12) |
| 83 | Still open: outside Europe the fog gate has only GFS / UKMO visibility | NOT CHECKED | |

Also out of date, but inside the checker's own text rather than the checklist (not counted above): `trip_readiness` still prints "22:17 UTC", "22:41 UTC", "22:55 UTC" and "grid points only while start_date >= today".

## B. What a new trip needs today that the checklist never mentions

Worked backwards from what the two set-up trips have and the two bare trips (Ireland + Scotland, Iceland 2026) do not.

Row counts (live, 12 Nov):

| Thing | Teton | Faroes | Ireland | Iceland |
|---|---|---|---|---|
| `trips.timezone`, `trips.metar_station` | set | set | null | null |
| `accommodations` | 1 | 3 | 0 | 8 |
| `stops.elevation_m` filled | 55 | 86 | 0 | 0 |
| `scout_subjects` / `stop_sun_pairs` | 27 / 39 | 110 / 74 | 0 / 0 | 0 / 0 |
| `solver_stop_settings` rated (still "suggested") | 25 (0) | 41 (40) | 0 | 0 |
| ... of those `once` / `together` | 6 / 2 | 0 / 0 (rules sit in the T config instead) | | |
| `solver_drive_matrix` pairs | 3,906 | 6,972 | 226 (same-spot only) | 32 (same-spot only) |
| `planner_t_trips` row | 1 | 1 | 0 | 0 |
| `replay_places` row | 1 | 1 | 0 | 0 |
| `replay_hidden_counts` / `replay_morning_counts` | 5,658 / 44,157 | 5,593 / 42,040 | 0 | 0 |
| live T run in `replay_runs` | `trip_T` 3916 | `trip_T` 3920 | none | none |
| T plans in `solver_runs` | 100 | 236 | 0 | 0 |
| practice copy (`trips.training_of`) | Teton Live | Faroes Live | none | none |
| `terrain_regions` box holding the shots | 33 of 33 | 74 of 74 (73 in a near box) | none | none |
| cameras within reach / read by Claude | 15 / 13 | 36 / 0 | 0 | 0 |
| `metar_stations.hidden_ceiling_ft` | 7000 | null (= 2000) | | |
| `solver_calibration` for the station | KJAC | EKVG | | |

Place-level (not keyed by trip) and also needed: `metar_stations`, `station_obs_hourly`, `metar_history`, `webcam_cameras` / `webcam_frames`, `dem_regions` (or `dem_blocks`), `terrain_regions` / `terrain_near_regions`, `replay_points`, `replay_wx_day` (forecast history per 0.25 degree cell), `solver_calibration` + `solver_calib_sources`, `solver_t_calib`, `solver_ferry_links`, `solver_drive_legs`.

### Missing steps, most important first

1. **Putting the trip on T at all.** The checklist stops at the old planner. T needs a `planner_t_trips` row. `planner_t_autoadd()` (run at the start of every `planner_t_week()`, cron 04:23 UTC) adds one by itself for any trip that is not archived, has at least one rated stop and has a day today or later.
   What it does NOT do:
   - It writes a bare default config: `kinds, fc_days, polish_k, split_mc, budget_ms, mr_commit, morning_fresh, split_morning, sbfix, mustfix, tickfix, req_budget_ms`. The two real trips also carry `wx`, `vfit`, `early`, `dawn_before_min` (and `tell` on Teton): the default has none of them.
   - No trip rules: no `gear` window, `anchors_on`, `fixed_days`, `once_add`, `together_add`, `locked_add`. (`once` / `together` set on the stops themselves and time-locked rated stops do still count.)
   - `rules_checked` stays false, `review` false, no notes switch.
   - It does not create a live run, a bench place or a practice copy.
2. **The live T run.** Evening plan on the forecast, dawn re-plan, camera look, Re-plan now and same-day notes all need a `replay_runs` row with `live`, `publish`, name `trip_T` (practice copies: `app_T`). Nothing creates it for a main trip: both existing ones were inserted by hand in migration `20261031040000`. `planner_t_now` answers "T is not planning today for this trip" without one. Without it the trip only ever gets the nightly light-only week drafts (no weather in them).
3. **The place on the bench.** A live run needs a `replay_places` row (station, `ceiling_ft`, `fc_point`, optional `truth_cam`, `vote_ceiling_ft`), forecast history for the place's 0.25 degree cells in `replay_wx_day` (the live download takes its model list from history dated before 30 Jun 2026: no history, no live forecast, and `replay_build` raises "no lead 1 forecast"), airport history in `metar_history`, and the odds fits (`replay_fit_hidden`, `replay_fit_morning`, vote fits when `vfit` is on). For a second trip at a place already set up, `replay_copy_place(from, to)` copies the place and its counts. **For a new place there is no helper:** `replay_setup()` and `replay_runs_setup()` have the two trip ids, the model lists and the date windows written in.
4. **Trip rules and Phil's sign-off.** Once-only outings (`solver_stop_settings.once`), keep-together keys (`together`), stops fine under cloud (`needs_peaks`, never guessed), gear window and fixed days (T config), then `planner_t_trips.rules_checked = true` after Phil has gone through them. The Faroes rules were Claude's guesses from 31 Oct until Phil checked them on 3 Nov, and his check changed several (CLAUDE.md "Faroes rules checked": for one, a boat landing T had been planning in only 20 of 33 bench trips).
5. **Truth for T, in two places.** `metar_stations.hidden_ceiling_ft` (scoreboard, backtest, Feeds page; null = 2000 ft) and `replay_places.ceiling_ft` (T's own truth). A mountain place needs both set (KJAC: 7000). `replay_places.vote_ceiling_ft` (Faroes: 1000) is a third. The checklist mentions none.
6. **Cameras as T's eyes.** At least 2 cameras within 80 km of the station must be READ (not just saved) for the camera vote, the camera look and Re-plan now to use pictures instead of the airport. Reading costs money (about $1.90 a day for 13 Teton cameras); `label_paused`, `votes` (false for a view that does not show the peaks), `view_lat` / `view_lng` / `view_km` for far-off views. Phil decides the budget.
7. **3D terrain files** (`terrain_regions`, `terrain_near_regions`, bucket `terrain`, source check). Being written by another helper; placeholder in the proposed checklist.
8. **The practice copy needs hand work to be useful.** `training_autocreate` makes the copy; `planner_t_autoadd` then gives it the bare default config (the main trip's rules are not carried over: on both existing copies the stop ids in the rules were mapped by hand through `training_copy_map`). It gets no `replay_places` row (needs `replay_copy_place`) and no `app_T` live run until its first roll (`training_trip_roll` inserts one at each repeat). A copy of an itinerary of 14 days or more never rolls (`end_date` is not before `training_until`), so it never gets one. `training_until` defaults to 14 days; both existing copies were extended by hand (to the day before the real trip).
9. **Notes and plan check switches.** `planner_t_trips.config.tell` plus `tell` in the live run's config (Tell T); `planner_t_trips.review` (Claude's plan check, about $0.60 a check, cron `t-review` every 10 min).
10. **Things written for two places only** (anything else falls into one of the two by latitude):
    - `solver-replay/t2.ts` `regionOf`: latitude above 55 = "faroes", else "teton". Decides which chance calibration (`solver_t_calib`) a trip gets. A trip in Ireland would be given Teton winter's.
    - `t-review/index.ts` line 78: the area is "the Faroe Islands" above 55 N, else "Grand Teton National Park and Jackson Hole", with Teton park pages, the NWS point and the Bridger-Teton avalanche centre written in.
    - `replay_run_tick`: waits for downloads and decides refits by `replay_trip_north(trip)` (mean latitude above 55), so a third place shares a bucket with one of the two.
    - `replay_fit_hidden` learns only from hours before 30 Jun 2026 (fixed date).
    - `replay_month_group`: autumn = Sep to Nov, everything else one group.
    - The scheduled Claude tasks (plan check session, watchdog) are written per trip, with trip ids and web addresses in their text.
11. **Stop naming and set-aside rules.** Names are the place only; "remove a stop" = `day_id = null` + tier null on the trip and its practice copy; ideas are stored as "Idea: ...".
12. **Checks that now exist and should be read after day one:** `t_day_checks` (cron 08:20 UTC), `t_reviews`, `planner_versions` (which version is live), `app_logs`.
13. **After the trip:** the practice copy stops by itself at `training_until`; the main trip still needs archiving.

## C. What `trip_readiness` misses

Ran on Teton, Faroes, Ireland + Scotland, Iceland 2026 (outputs saved beside this file as `readiness_<trip id>.json`).

It has no T section at all. On a trip that was set up to the letter of today's checklist it would report everything fine while T had no live run. Specifically it does not check:

1. Whether the trip has a `planner_t_trips` row, whether its config is the bare default, and whether `rules_checked` is true.
2. Whether a live T run exists (`replay_runs`, `live` + `publish`, not a draft, status queued or running, dates covering the trip days).
3. Whether the place is on the bench: `replay_places` row, fits for the trip's season (`replay_hidden_fit`, `replay_morning_fit`), forecast history for its cells.
4. Whether T's nightly week draft arrived. Its `plans` row turns ok on ANY `solver_runs` row in 30 hours, including the old planner's, and `nightly score build` watches the old raw build that T does not use.
5. The truth ceiling: `metar_stations.hidden_ceiling_ft` null (silently 2000 ft) and whether it agrees with `replay_places.ceiling_ft`.
6. Cameras being read. It counts active cameras with a fresh picture: the Faroes trip shows "36 cameras, 36 fresh: ok" while not one of them is being read, so T's camera vote there falls back to the airport. It also ignores `votes`, and a camera left on the default time zone `UTC` (GT-EGVB).
7. 3D terrain: no check that the shots' stand pins fall inside a `terrain_regions` box or a near box.
8. Trip rules: `once`, `together`, `needs_peaks`, gear window, fixed days, bookings.
9. The practice copy: whether one exists, whether it is on T with the main trip's rules, has a bench place and a live run.
10. A hotel logistics stop at the start and end of each day (it only checks that `accommodations` cover the nights).

Wrong answers it gives today:

- **Drive matrix: false "ok".** Ireland + Scotland shows "ok, 226 stop pairs over 69 spots" and Iceland "ok, 32 stop pairs over 58 spots". Every one of those pairs is a "same spot" pair; no drive leg was ever fetched. The check only looks for zero rows or null minutes, and the view leaves unfetched pairs out.
- **Drive matrix: noisy "warn".** Teton's 244 pairs without a route come almost entirely from two set-aside "Idea:" stops (122 of them as the starting stop alone).
- **"wait" that never ends.** On archived or past trips it says `wait` for elevation, model grid, weather, ensemble, score build and plans, though the jobs skip archived trips. On the two real trips "display weather" sits at `wait` (12 of 25, 29 of 41) weeks before the trip; cause not looked into.
- **Stale text:** "22:17 UTC", "22:41 UTC", "22:55 UTC" (the jobs run at 10:17 / 19:17, 10:41 / 19:41, 10:55 / 19:55) and "grid points only while start_date >= today" (fixed on 21 Oct: live trips).
- **Stop count:** "43 to shoot" on Teton includes the 18 set-aside photo stops; every other row uses 25.

## D. Suggested additions to `trip_readiness` (words only, nothing applied)

New step "7 planner T":
1. `on T`: todo when there is no `planner_t_trips` row (say: added by itself at 04:23 UTC once a stop is rated, or run `planner_t_week(trip)`); warn when the config has none of the trip-rule keys and none of `wx` / `vfit` / `early` (the bare default).
2. `trip rules checked`: warn while `rules_checked` is false; list counts of once-only stops, keep-together groups, bookings, gear window and fixed days so Phil can see them.
3. `bench place`: todo when there is no `replay_places` row; warn when its `ceiling_ft` differs from the station's `hidden_ceiling_ft`, or when `fc_point` is not one of the trip's own forecast cells.
4. `odds`: warn when `replay_hidden_fit` / `replay_morning_fit` have no rows for the trip and `replay_season(start_date)`, or (with `vfit`) no vote rows; info which month group will be used.
5. `forecast history`: todo when a trip forecast cell has no rows in `replay_wx_day` (the live download needs them to know which models to fetch).
6. `live run`: todo when no live publish run covers the trip's days; warn when its `nights` or dates do not match the `days` rows, or its config differs from `planner_t_trips.config` in the rule keys; wait with the local time of the first evening plan when it is simply early.
7. `week draft`: ok when a "T: week draft" plan is under 30 hours old; else wait / warn.
8. `notes and plan check`: info line with `tell` and `review` on or off.
9. `version`: info with the `planner_versions` winner.

Changes to existing rows:
10. `plans`: count T plans separately from the old planner's.
11. `drive matrix`: compare the number of pairs with what the trip's placed stops need; todo when most are missing; leave set-aside stops out of the no-route count and name the stops that have none.
12. `webcams`: add "N read by Claude, N voting, N within 80 km of the station"; warn when fewer than 2 are read and voting; warn on a camera with `tz = 'UTC'` outside UTC.
13. `METAR station`: warn when `hidden_ceiling_ft` is null and the stops are high above the station (or simply always show the value in use).
14. New step `3D terrain`: shots inside a wide box / inside a near box; todo when none.
15. New step `practice copy`: exists, running until when, on T, has place, has live run; last `training_sync` result from `app_logs`.
16. `hotels`: also check the first and last stop of each day sit at the night's hotel.
17. Archived or ended trips: say "skipped (archived)" instead of `wait`.
18. Fix the stale times and the "to shoot" count.
19. `stop names`: warn on names that hold a time or light word ("Sunrise", "Sunset", "Blue hour").

## E. Side findings (nothing changed)

- Camera `GT-EGVB` has `tz = 'UTC'` (the column default) while every other Teton camera has `America/Denver`.
- The old planner's nightly builds and plans (`solver-build-scores`, `solver-plan`, and the calibrated pair on practice copies) still run twice a day for all four live trips (27 to 58 plans a trip in the last 36 hours) although the app shows only T's plans.
- 40 of the 41 rated Faroes stops are still marked "suggested" (Phil has not confirmed tiers and light), although `rules_checked` is true for that trip. The two flags mean different things; the checklist should say so.
- `make_training_trip` copies `solver_stop_settings` without `once`, `together`, `needs_peaks`; the copy is only right after the next `training_sync` (10:30 or 19:30 UTC).
