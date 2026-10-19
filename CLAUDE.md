# travel_slave — notes for Claude sessions

Philm+Frame trip planner: Expo/React Native app (`src/`), static web viewers (`faroes-web/`, `iceland-web/`), and a Supabase backend (project `ohshrzlvvxyovcjmdajc`). Most backend logic lives in the database and edge functions, not in this repo — read the live definitions before changing anything.

## Data safety (hard rules)

- **Never DELETE rows from `stops`.** Deleting a stop cascades (`ON DELETE CASCADE`) to:
  `stop_photos` (Phil's photos), `weather_forecasts` (forecast archive), `stop_sun_pairs` (vantage links), `model_grid_points`, `drive_times`. `exposures.stop_id` is set NULL.
- **Move stops with `UPDATE stops SET day_id, position`**, never insert-plus-delete. Inserting a new stop is allowed.
- The anon key in the app and web viewers has full write access to `stops`/`days`/`trips` (`full_access` policy). Nothing technical stops a bad write — be careful.
- `reset_test_bed()` deletes and rebuilds trip `7e57bed0-0000-4000-8000-000000000001` only. Use that trip for experiments.

## Edge functions

- The repo copy of each function must match what is deployed. Before editing one, fetch the deployed source (`get_edge_function`) and diff — the repo has drifted before (weather-pull v33 vs deployed v35).
- `weather-pull` (v35, `index.ts` + `logic.ts`): per-day display forecasts into `weather_forecasts`. Triggered by pg_cron jobs `hourly-weather-pull` and `daily-preview-refresh`.
- `weather-ensemble-pull`: nightly ensemble archive into `weather_ensemble` (per 0.25° cell, member arrays; `*_c10`/`*_kmh10`/`*_mm10` are value × 10). pg_cron `17 22 * * *` UTC. Separate from weather-pull on purpose. Never schedule Open-Meteo pulls at :07 — hourly-weather-pull runs then and the shared per-minute quota returns 429s.
- `calculate-drive-times`: writes `stops.drive_override_minutes` (previous-stop leg) via Google Directions.

## Database conventions

- pg_cron runs in GMT/UTC. Faroe time is UTC+1 in summer, UTC+0 from late Oct to late Mar.
- `cron.job` calls edge functions with `net.http_post`; pg_net times out at 5 s but the function keeps running. Don't rely on the HTTP response.
- New tables get RLS enabled automatically (`ensure_rls` event trigger). With no policy the app/web viewers read zero rows — add a SELECT policy if the client needs it.
- `prune_weather_forecasts()` (weekly) strips `raw` blobs older than 21 days. `weather_forecasts` is a display table, not an archive.
- Free plan: database must stay under 500 MB or it goes read-only. Check `pg_database_size` before adding anything that grows nightly. `db_size_check()` logs the size daily to `app_logs`.

## Solver

Spec: `SOLVER_SPEC.md` (in Phil's uploads). Review and corrected build order: `docs/solver/SPEC_REVIEW.md`. The solver writes proposals to its own tables and never writes to `stops` except through an explicit apply step.
