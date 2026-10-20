# travel_slave — notes for Claude sessions

Philm+Frame trip planner: Expo/React Native app (`src/`), static web viewers (`faroes-web/`, `iceland-web/`), and a Supabase backend (project `ohshrzlvvxyovcjmdajc`). Most backend logic lives in the database and edge functions, not in this repo — read the live definitions before changing anything.

## Data safety (hard rules)

- **Never DELETE rows from `stops`.** Deleting a stop cascades (`ON DELETE CASCADE`) to:
  `stop_photos` (Phil's photos), `weather_forecasts` (forecast archive), `stop_sun_pairs` (vantage links), `model_grid_points`, `drive_times`. `exposures.stop_id` is set NULL.
- **Move stops with `UPDATE stops SET day_id, position`**, never insert-plus-delete. Inserting a new stop is allowed.
- The repo is public and ships the anon/publishable key, and the app (branch `update`) writes `stops`, `days`, `trips`, `stop_photos`, `exposures` and the `photos` storage bucket with that key. Do NOT tighten RLS on those without moving the app's writes behind an edge function first (an Oct 2026 lock broke the app for 25 min; the `anon_no_*` policies are now neutralised to `true`).
- Before judging what the app does, read the code on branch `update`, not `master`.
- `reset_test_bed()` deletes and rebuilds trip `7e57bed0-0000-4000-8000-000000000001` only. Use that trip for experiments.

## Branches and releases

- **`update`**: the app plus everything else. Pushing app files runs `.eas/workflows/update.yml`: fingerprint the native side; if an APK with that fingerprint exists, publish an instant (OTA) update to channel `preview`; otherwise build a new APK. `runtimeVersion` uses the fingerprint policy, so an update only reaches an APK it matches. Backend/docs/web commits trigger nothing. All EAS jobs use the `preview` environment (the `preview` build profile's default) so fingerprints line up.
- **Test builds:** eas.json profile `test` (`APP_VARIANT=test`) builds "Philm+Frame TEST", package `com.philmframe.app.test`, channel `test`, which installs side by side with the real app. `.eas/workflows/test-build.yml` builds it on pushes to the work branch only.
- **App stack (SDK 58 since 20 Oct 2026, tested by Phil on the TEST build first):** Expo SDK 58, RN 0.88, React 19.3, New Architecture on (mandatory since RN 0.82), Reanimated 4 + react-native-worklets (babel-preset-expo adds the worklets plugin itself; don't list it in `babel.config.js`), file-system calls via `expo-file-system/legacy`, `babel-preset-expo` as a direct devDependency, React Navigation 7 (v6 stack calls `InteractionManager`, which RN 0.88 removed: crash on launch; v7 `navigate` no longer pops back to a screen already in the stack, use `popTo`). Native upgrades go through the TEST build first, then merge into `update`, which builds a new real APK (new fingerprint).
- **`main`**: old "build an APK" branch (`.eas/workflows/build.yml`). No longer needed for releases; kept as a manual fallback.
- **`master`**: GitHub default branch. Netlify deploys the web viewers (`faroes-web/`, `iceland-web/`) from it, and GitHub only runs scheduled workflows (`webcam-clip`) from the default branch.

## Edge functions

- The repo copy of each function must match what is deployed. Before editing one, fetch the deployed source (`get_edge_function`) and diff — the repo has drifted before (weather-pull v33 vs deployed v35).
- `weather-pull` (v35, `index.ts` + `logic.ts`): per-day display forecasts into `weather_forecasts`. Triggered by pg_cron jobs `hourly-weather-pull` and `daily-preview-refresh`.
- `weather-ensemble-pull`: nightly ensemble archive into `weather_ensemble` (per 0.25° cell, member arrays; `*_c10`/`*_kmh10`/`*_mm10` are value × 10). pg_cron `17 22 * * *` UTC. Separate from weather-pull on purpose. Never schedule Open-Meteo pulls at :07 — hourly-weather-pull runs then and the shared per-minute quota returns 429s.
- `webcam-archive`: every 3 h (`37 */3 * * *`) saves each active `webcam_cameras` row (any trip; per-camera `image_url`, `region`, `source`, `permission_note` — always get permission before adding a camera) to Storage bucket `webcams`, haze metrics into `webcam_frames`. Full images kept 7 days, the 12 UTC frame kept forever. Gemini labelling is off unless secret `GEMINI_ENABLED=true` (free tier returned 402 for this account).
- `webcam-labels`: token-gated door (`WEBCAM_LABELLER_TOKEN`) for the CLIP labeller in GitHub Actions (`tools/webcam_clip`, `.github/workflows/webcam-clip.yml`, nightly 03:23 UTC). The repo is public: the workflow must never hold the service-role key.
- `webcam-probe`: retired stub (returns 410); delete it from the dashboard.
- `calculate-drive-times`: writes `stops.drive_override_minutes` (previous-stop leg) via Google Directions.
- `solver-drive-matrix` (POST `{trip_id}`): fills `solver_drive_legs` (per spot pair, coords rounded to 3 dp by `solver_trip_spots()`, shared across trips) via the Google Routes matrix API. Incremental: only pairs not yet stored are fetched, so re-running is free unless a stop moved. `solver_drive_matrix` (view) gives stop-to-stop minutes per trip; legs Google can't route (car ferries) go through `solver_ferry_links`. Call it from SQL with `net.http_post` (this container can't reach supabase.co directly).

## Database conventions

- pg_cron runs in GMT/UTC. Faroe time is UTC+1 in summer, UTC+0 from late Oct to late Mar.
- `cron.job` calls edge functions with `net.http_post`; pg_net times out at 5 s but the function keeps running. Don't rely on the HTTP response.
- New tables get RLS enabled automatically (`ensure_rls` event trigger). With no policy the app/web viewers read zero rows — add a SELECT policy if the client needs it.
- `prune_weather_forecasts()` (weekly) strips `raw` blobs older than 21 days. `weather_forecasts` is a display table, not an archive.
- Free plan: database must stay under 500 MB or it goes read-only. Check `pg_database_size` before adding anything that grows nightly. `db_size_check()` logs the size daily to `app_logs`.

## Solver

Spec: `SOLVER_SPEC.md` (in Phil's uploads). Review and corrected build order: `docs/solver/SPEC_REVIEW.md`. Per-stop inputs (backend only, the app never reads them): `solver_stop_settings` (tier, starred shot, light wanted front/side/back/soft, fog_wanted, time_locked; `source` = suggested/phil), resolved by the `solver_stop_inputs` view. Fog/rain/wind are global penalties; waterfalls get a rained-yesterday bonus. `solver_build_scores(trip)` (pg_cron `41 22 * * *`, ~100 s) scores every rated stop's starred shot per 15-min slot per ECMWF member into `solver_scores` (smallint[] x250, tier not baked in); `solver_score_summary` gives mean / CVaR of the worst 11 / P(good). Light geometry is cached in `solver_light_cache`. The nightly job is `solver_nightly(trip)`: build, then `solver_prune_builds` keeps the newest 3 (approved by Phil). `solver-plan` edge function (POST `{trip_id, date?, hotel_stop_id?}`, pg_cron `55 22 * * *` once per build day): beam search over one day from the hotel and back, mean + 0.5 x CVaR, same-subject repeats count only the improvement, top 5 distinct plans + safest into `solver_runs` / `solver_plans`. `trip_date` plans a forecast day as a given trip day (its hotel and its time-locked stops as fixed visits); `multi: true` plans all build days together (a subject counts once, at its best day per member). Nightly: one call per build day plus one multi-day call (dates in the trip's timezone, `solver_trip_tz`). Watch the 2 s edge CPU limit (it was hit once by per-row Intl formatters).
- **solver-plan v0.3 extras:** `trip_date` alone plans that trip day; past the forecast it uses **light-only** scores (`solver_light_terms` from `solver_light_cache`, expanded in the function to 51 made-up sun scenarios s=(k/50)^2, no rain/wind/fog; `solver_light_scores` is the same in SQL). `solver_nightly` tops up the light cache for every trip day (~0.05 s per shot-day). Days start at the previous night's accommodation and end at that night's (move days). Free stops stay in a 05:00–23:30 local window (`earliest`/`latest`, made-up default). Rank 0 = **"my day"**: the trip day's own stops at their time_labels, each with value, p_good, light and best time that day. Visits carry `value`, `p_good`, `peak_at`, `light`, `trip_date`.
- **Shot status** (`solver_stop_settings.shot_status` got/nailed, `shot_value`; set with `solver_mark_shot(stop, status, at?, value?)`): nailed subjects drop out, got ones count only the improvement over shot_value. Phil marks them in chat until the TEST app has the tick.
- **Apply:** `solver_apply_plan(run, rank)` previews, `(run, rank, true)` applies (UPDATE stops day_id/position/time_label/drive_override_minutes only, logged in `solver_applies`), `solver_undo_apply(id)` reverts. Plan stops go to their plan day at the plan time; others stay; the day's first and last stops stay at the ends. Only apply to Phil's real trip when Phil asks.

Plans are reviewed in chat for now. Planner UI (an icon top right of the trip page opening a Planner screen; mockups in Phil's artifacts) goes in the TEST app only; the real app gets none of it until Phil signs off the solver as finished and tested. No web page. The solver writes proposals to its own tables and never writes to `stops` except through an explicit apply step.
