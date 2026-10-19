# SOLVER_SPEC.md — Review

Reviewed 19 Oct 2026 against the repo (branch `ccr-dba965ff-afy6cz`), the live Supabase project `ohshrzlvvxyovcjmdajc` (49 tables, deployed edge functions, `cron.job`, function bodies), and primary documentation (Open-Meteo website/API source on GitHub, Supabase docs source, ECMWF, IEM, DMI, Landsverk, Google, Cloud Run).

**How this was produced and what it is worth.** Six audit agents (weather pipeline, schema, app write path, external data sources, algorithm, operations) produced 118 findings with cited evidence (file:line, SQL + result, URL + quote). The planned adversarial re-verification pass and the validation-plan audit did not run (org spend limit). So: every fact below is backed by the auditor's own evidence, and most load-bearing facts were found independently by two or three audits (marked ◆ where so), but none was re-derived by a second, sceptical agent. Where an auditor could not verify something it is marked **UNVERIFIED**. Several documentation hosts (open-meteo.com, supabase.com, ecmwf.int, developers.google.com) were blocked by the session proxy; those facts come from the sites' public source repos or search snippets and are flagged.

Audit tags used in citations: **W** weather pipeline · **S** schema/live DB · **A** app & write path · **X** external sources · **G** algorithm · **O** operations/cost.

---

## 1. Verdict

The architecture holds: no MCTS, 51 scenarios with mean + λ·CVaR, a fast per-day search feeding an enumerate-and-select 3-day planner, CP-SAT only as an oracle, and the solver never deleting stops. Decisions 1–5 in §1 survive. But the spec cannot be built as written. Four things block it and must be fixed before step 1 of §9:

1. **The score tensor's data path reaches 8 of 155 shots and 2 of 36 tiered subjects.** `stop_sun_pairs` links the 41 shooting stops to 56 app-created "sun pair" placeholder subjects (`main`, `zoom`, `barn`…, all untiered); only Drangarnir and Tindhólmur research subjects are reachable. The spec's §4 loop would value two subjects. ◆ [S, G]
2. **No ECMWF ensemble serves visibility or cloud base.** `vis_m` and `cloud_base_m` in `weather_ensemble` have no 51-member source; the §4 fog/vis/inversion gates cannot vary across members as written. The ensemble *does* serve low cloud, RH and dew point (the current pull just doesn't ask for them), so a per-member fog proxy is possible. ◆ [W, X, O]
3. **The "exact bounded DFS" is not exact beyond ~10 reachable subjects.** Simulated with the spec's own bound on real Faroe coordinates: 127k nodes at 7 subjects, 2.6M at 11 (past the 2e6 guard), extrapolating to ~1e12 at 29. The ranker would burn its whole CPU budget before the beam does the real work. [G]
4. **`weather_ensemble` as specified is ~33M rows / ~5 GB by May.** On the current compute tier (matches Free/Nano, 500 MB cap → read-only) the archive would freeze every DB write within ~17 nights. Per-cell storage with member arrays is ~90 MB for the whole archive. ◆ [O, X]

Beyond those: the "existing swap path" for applying plans does not exist (the app has no write UI at all); `CLAUDE.md` does not exist; the repo's `weather-pull` is v33 while production runs v35 with an untracked `logic.ts`; the §3.2 seed contains two "Rannvá" anchors that appear nowhere in the database and omits the Tindhólmur landing that does; hotel anchors modelled as overlap intervals make every day infeasible; the diversity filter is inverted (Jaccard similarity used as distance); hike-out time is never counted; and the deterministic fallback as written covers one hour per stop, not 72.

None of this is fatal. It is one data-model fix (subject ↔ stop mapping), one weather-pull rewrite that §9 step 5 already calls for, a change of primary algorithm (beam/ILS with a time guard; DFS kept for ≤12-subject validation), and a storage shape. The corrected build order is in §10.

---

## 2. Corrections to §2 — what actually exists

| Spec §2 says | Actually | Evidence |
|---|---|---|
| `scout_subjects` (`phil_tier`, `movable`, `lat/lng`) — "41 shooting stops all have coords" | Columns exist. The Faroe trip has **110** subjects: GOD 6, S 4, A 8, B 7, C 5, **D 1, F 5** (tiers with no spec weight; all F are `status='rejected'`), NULL 74. **4 tiered subjects have no coordinates, including 2 of 6 GOD (Dunnesdrangar, Mýlingur)**. "41" is the count of non-logistics *stops*; all 41 do have coords. No CHECK constraint on `phil_tier`. | S `GROUP BY phil_tier`; `stops GROUP BY shot_type` (seascape 24, urban 7, waterfall 5, mountain 3, canyon 2; logistics 45) |
| `scout_vantage_geometry` (`bearing_deg`, `facing`, `look_angle_deg`) | Exists as a **VIEW**, not a table. `bearing_deg` = vantage→subject great-circle bearing computed on read, NULL when distance < 20 m; requires both coordinates. **Only 26 of 98 shot-bearing vantages have lat/lng**, so bearing/skyline exist for ~27% of shots. `scout_vantages.elevation_m` is NULL on all 212 Faroe vantages (elevation comes from `terrain_profiles.ground_m`). | S `pg_class relkind='v'`; per-tier vantage coords GOD 8/26, S 6/18, A 5/20, B 3/15, C 3/15 |
| `terrain_horizon(p_profile, p_observer_m)` | Exists: returns `double precision[]` of **180 bins (2° each)**, only for `status='complete'` profiles (178 Faroe, 16 Tetons `outside_dem`). `p_observer_m` is an absolute elevation. Index with the existing `horizon_at(h, az)` (interpolates), never `h[az]`. `skyline_cached()` is SECURITY DEFINER and **writes** to the cache on miss. | S `pg_get_functiondef`; sanity: Kallur K5 at 2027-05-27 21:30Z → az 320.0, alt 0.99, horizon −0.04 |
| `sun_position(ts, lat, lng)` | Exists (IMMUTABLE, refraction-corrected). **Also exists and unmentioned: `vantage_light(vantage, date, step_min, tz)`** which already returns per-step sun az/alt, `backlit ≤45° / side ≤135° / front`, `in shadow` (subject skyline), `sun_visible_from_vantage` (vantage skyline), `top ≥35°`, `sun_up −0.436°`. The §4 light classifier re-derives this. `trips.timezone` is NULL for the Faroe trip. | S/G `pg_get_functiondef(vantage_light)` |
| `stop_sun_pairs` — every shooting stop has ≥1 vantage | True (73 pairs, 41 stops, 56 vantages) **but the vantages belong to 54 ad-hoc subjects created by `sun_pair_save()`, 52 of them untiered placeholders**. 34 of 36 tiered subjects have zero linked stops. 8 of 155 shots sit on a paired vantage. **Blocker 1.** | S/G CTE over stops→pairs→vantages→subjects |
| `scout_shots` (`focal_length`, `filters`, `long_exposure`, `time_of_day`, `composition`) — no structured requirements | Confirmed. 155 shots, all Faroe; 137 have notes; `time_of_day` is free text ("Evening / sunset", "Clear day only", "Any — better after rain"). Subject-level `best_light` also encodes fog/overcast wants (Sornfelli "FOG DAYS, NOT CLEAR DAYS"; Ravnagjógv "FOG AND FLAT WHITE LIGHT"; Fossá "AFTER HEAVY RAIN"). Drafting §3.1 from text is feasible; numeric thresholds will be defaults. | S sample of 40 GOD/S rows |
| `weather_forecasts` — "Deterministic only; no ensemble yet" | **Wrong.** Deployed `weather-pull` v35 already calls the Open-Meteo **ensemble** API for 7 systems (`ecmwf_ifs025, icon_eu, icon_global, gfs025, gfs05, gem_global, ukmo_global_ensemble_20km`) and stores **summary statistics only** (median/p10/p90/min/max/stdev/prob_*) **pooled across all 7 (232 members)** in `raw.ensemble`; no per-member values anywhere. Variables requested: precipitation, cloud_cover, wind_gusts_10m, temperature_2m. Fetched once per 0.25° cell (9 cells for the 41 shooting stops), **one date, one hour per stop** (the stop's `time_label` hour). `weather_score()` already consumes `prob_wet_pct` as a fallback. Deterministic columns do include cloud layers, `cloud_base_m`, `cloud_top_m`, `cloud_cover_2m_pct`, `fog_risk`, `visibility_m`, wave/swell, `score_stars` — from the per-stop primary model (DMI HARMONIE 2 km for Faroe stops). ◆ | W index.ts:109–115, :333–366, :490–499, :526; S `raw->'ensemble'` sample `member_count 232`; X/O Open-Meteo model table 51+40+40+31+31+21+18 |
| (not mentioned) | **All 2,549 Faroe rows are "preview" rows for today's date** (`daily-preview-refresh` cron, `test:true` for days > 15 d out). Zero rows for trip dates. And **`weather-retention` (Sun 04:35 UTC) strips `raw.models/ensemble/sea/metar/convergence` from rows older than 21 days** — 471 Faroe rows already stripped. The existing table is a display table, not an archive. ◆ | W/S/O `cron.job` jobs 1, 3, 4; `pg_get_functiondef(prune_weather_forecasts)` |
| `weather_score(w, p_shot_type)` — wind ladder 0 / 1 / 2 / 3 / 4 at >48 / >56 / >64 / >80 | Confirmed, text-identical to the migration, stamped by a BEFORE INSERT trigger. But it is a **gust** ladder (`coalesce(wind_gusts_kmh, wind_speed_kmh, 0)`); `reflection` shot_type uses 10/16/26; returns 0–4 **stars**, not a 0–1 gate; `cloud_base_m` is stored but **never read** by it; `shot_type` gates mountain obscuration and multipliers — `scout_shot_requirements` does not carry shot_type. | W migration :48, :132–140; S `pg_get_functiondef` |
| Model skill: `weather_model_scores`, `refresh_model_skill_step()` | **`weather_model_scores` is a per-row scoring FUNCTION** (per-model stars for one forecast row), not a skill table. Skill lives in **`model_skill`** (+ view `model_skill_ranked`): per **METAR station** (EKVG, KJAC, KDIJ) × model × lead 1–7, scoring temperature MAE, cloud MAE, overcast hit %, precip hit % over a rolling 14-day window, refreshed every 10 min. **Nothing about visibility, ceiling or fog is scored.** The Faroe trip uses `primary_selection='resolution'`, so skill does not pick its model today. ◆ | S/W `pg_proc`; `model_skill` EKVG 96 rows, window 2026-10-05→10-18 |
| Drive times: `cached_routes` (per day), `stops.drive_override_minutes`, `driveTimes.ts` (`recalculateTimeLabels`) | **`cached_routes`: 0 rows, referenced nowhere. `drive_times`: 0 rows. `recalculateTimeLabels` does not exist. `src/services/driveTimes.ts` is dead code** (no importer; reads an env var nothing injects). The live tool is the deployed edge function **`calculate-drive-times` v4**: legacy Directions API, one call per consecutive stop pair, 100 ms sleep, `UPDATE stops SET drive_override_minutes` (68/86 Faroe stops set), service role or `x-api-key`. ◆ | S/A/O `get_edge_function`; grep |
| Bookings / notice windows: `scout_actions` text only | Confirmed. 175 Faroe rows; booking state lives in five long open rows keyed by `due_by` ∈ {`🚤 BOOK — Drangarnir · SUNSET`, `🚤 BOOK — Drangarnir · MORNING`, `🥾 BOOK — Dunnesdrangar`, `⚓ BOOK — Tindhólmur`, `⛴️ BOOK — Kalsoy ferry`}. See §8 for what they say. | S |
| (not mentioned) | **Ground-truth archive already exists**: `station_obs_hourly` (EKVG 321 hourly rows since 2026-10-05: temperature, cloud %, wet — **visibility and ceiling are discarded during harvest although the METAR JSON contains them**), `weather_observations` (56 METAR/TAF rows, one per weather-pull invocation; 45 with ceiling, 15 with visibility), `metar_stations` (EKVG 62.065, −7.282, 89 m). | S/W |
| (not mentioned) | `tide_stations` / `tide_events` exist (WorldTides-shaped) with **0 rows**; `stops.tide_station_id` NULL everywhere; no tide code in the repo. Waves **are** populated (Open-Meteo marine on every DMI/KNMI row). | S |
| (not mentioned) | `stops.elevation_m` exists, populated on all 86 Faroe stops, refreshed by cron; `scout_subjects.height_m`, `hike_time_minutes` (18/36 tiered), `scout_vantages.walk_minutes` (131/212), `scout_access_options.duration_minutes` exist. | S |
| (not mentioned) | **Repo `weather-pull` is v33 (single file). Production is v35: `index.ts` + `logic.ts` (skill-based primary selection, region rule, auto METAR station). `logic.ts` is not in the repo.** Editing the repo copy and deploying would regress production. | W `get_edge_function` v35 imports `./logic.ts`; repo :703 `'v33-us-models'` |
| (not mentioned) | Triggering is entirely **pg_cron 1.6.4 + pg_net 0.20.0, `cron.timezone = 'GMT'`**: `hourly-weather-pull` (`7 * * * *`, days within 15 d), `daily-preview-refresh` (`10 5 * * *`), `weather-retention`, `model-grid-refresh` + `stop-elevation-refresh` (`*/5`), `model-skill-refresh` (`*/10`). Every `net.http_post` to weather-pull **times out at pg_net's 5 s** yet the function completes; pg_net keeps responses 6 h only. No `.github/`, no app trigger. ◆ | W/S/O `cron.job`, `net._http_response` |
| Rule 1.7: "data-safety note in CLAUDE.md" | **No `CLAUDE.md` exists** in the repo, any subdirectory, or git history. The cascade is real and **wider than stated**: `ON DELETE CASCADE` from `stops` → `stop_photos` (1,109 rows), `weather_forecasts`, `stop_sun_pairs`, `model_grid_points`, `drive_times`; `exposures.stop_id` SET NULL. ◆ | A/S/W `pg_constraint confdeltype`; `git log --all -- '**/CLAUDE.md'` empty |
| Rule 1.8: semicolons break the MCP write path | **UNVERIFIED.** No `chr(59)` anywhere in the repo; a read `SELECT 'a;b'` through the MCP returned correctly. Write path not tested. May be stale. | A |

---

## 3. Blockers in detail

### B1 — Tensor data path (§1.5, §2, §4, §5, §6) ◆ S, G
The §4 loop *vantage via `stop_sun_pairs` → shots of v → requirements(s) → tier_weight(subject)* yields non-zero value for Drangarnir (GOD) and Tindhólmur (S) only. Kallur, Múlafossur, Mýlingur, Trælanípa, Dunnesdrangar and every other tiered subject are invisible. `§3.3`'s `subject:<uuid>` keys and `§6`'s `R = subjects` have no path to a stop (weather row) either. There is no FK between `stops` and `scout_subjects` other than this chain; 9 subjects map to >1 stop and 56 subjects map to none.

**Fix.** Key the tensor on `scout_subjects` (tiered, not rejected) → `scout_vantages` → `scout_shots` directly, and add an explicit **subject → stop (weather source) mapping** — `stops.subject_id uuid` or a `solver_subject_stops(subject_id, stop_id, role)` table. Decide whether the ad-hoc pair subjects merge into their research subject (the `main` at Kallur is Kallur Lighthouse) or become vantages of it. Fill coordinates for Dunnesdrangar, Mýlingur, Geituskorardrangur, Eysturtindur. Geocode the research vantages that carry shots (at minimum GOD/S) — inserting lat/lng triggers `scout_attach_terrain` / `scout_warm_skyline`, which creates the profile and skyline the light gates need. Define the subject population: `phil_tier IN ('GOD','S','A','B','C') AND status <> 'rejected'` → 30 subjects today; give D a weight or exclude it.

### B2 — No visibility / cloud base in the ECMWF ensemble (§3.4, §4) ◆ W, X, O
From Open-Meteo's per-model variable lists (`ensemble-options.ts`, backend `EcmwfVariable.swift`): `ecmwf_ifs025` (51 members, 3-hourly, 15 d, 6-hourly updates) serves `cloud_cover, cloud_cover_low/mid/high, relative_humidity_2m, dew_point_2m, wind_speed_10m, wind_gusts_10m, precipitation, temperature_2m, weather_code` — **not `visibility`, not `cloud_base`**. The 9 km `ecmwf_ifs_europe_ensemble` (exists; Faroes inside its 33–71°N box; hourly to 90 h; **0z/6z runs only**) has **no low cloud either**. `visibility` exists only in GFS 0.25°/0.5° (31 members) and UKMO MOGREPS-G 20 km (18) — whether non-null at 62°N is UNVERIFIED (the repo comment "none serve visibility" is wrong for those two). `cloud_base` is in no ensemble. The deterministic HARMONIE 2 km row is the only source of `visibility`, `cloud_base`, `cloud_cover_2m` and a WMO fog code — and it exists for **one hour per stop per day** today.

**Fix.** (a) Request the ten ECMWF variables above (not four) and compute a **per-member fog proxy** from T−Td spread and RH (the `fogRisk()` fallback in weather-pull already uses spread ≤ 1 °C ∧ RH ≥ 95 %) plus `cloud_cover_low`; a per-member cloud-base proxy via LCL ≈ 125 m × (T−Td). (b) Add a **72 h deterministic hourly pull** of HARMONIE per cell for `visibility`, `cloud_base`, `cloud_cover_2m`, `weather_code` — shared across members ("member-invariant gate"), flagged in `solver_runs.fog_source`. (c) Optionally a per-hour `P(vis < vis_min)` from GFS/UKMO members as a multiplicative gate on all 51 scenarios — model-level, not per-scenario (they cannot be aligned 1:1 with ECMWF members). Drop `vis_m`, `cloud_base_m` from the ECMWF rows. Use `ecmwf_ifs025` as the scenario source; if the 9 km model is pulled, use it only for wind/precip/RH and take low cloud from 0.25°. Delete "interpolate 3-hourly → hourly" (Open-Meteo already interpolates server-side; it adds no information).

### B3 — The DFS is not exact at Faroe scale (§1.6, §6 v0) G
Simulation (`dfs_sim.py`, spec's own bound with (max value, min weight) items over time *and* drive budgets, `(1+λ)·UB ≤ K-th` pruning, K = 5, no diversity filter — i.e. *stronger* pruning than the spec; real tiered-subject coordinates from Cottages by the Sea; 15-min slots over 03:19–23:30; 3 starts × 3 dwells; 51 correlated synthetic members):

| reachable R | nodes | leaves |
|---|---|---|
| 7 | 127,421 | 31,336 |
| 11 | 2,597,724 (past the 2e6 guard) | 336,287 |
| 15 | > 3,000,000 (cap) | — |
| 29 (all tiered with coords minus ferry islands) | > 3,000,000 (cap) | 632,205 |

Growth ≈ ×2.1 per added subject → ~1e12 at R = 29. The 1e5–1e6 estimate is R ≈ 7–10. Even at 1–3M nodes/s in V8 (estimate; sim ran in CPython at 34–109k/s), the 2e6-node guard alone costs 0.7–2 s before the beam starts. Sun geometry: sunrise 04:19 / sunset 22:31 local on 21 May → 20.2 h window, 81 slots, routes of 6–10 visits feasible. Dominance/state merging cannot rescue it (51-vectors almost never dominate component-wise). The beam at width 2000 on R = 29: 10 levels, ~13k expansions, ~290k children → 30–100 ms with mean ranking, **+0.15–0.3 s if every child is scored with CVaR** (partial sort of 51).

**Fix.** Make the **beam (or a short ILS) the primary v0 algorithm with a time guard (~300 ms)**, ranking children by mean (or an O(51) selection for CVaR) and scoring full mean+λCVaR only for survivors. Keep the exact DFS for the S family (≤ 12 subjects) and brute-force validation. If exactness at 20–40 subjects is ever wanted it needs a real bound (LP/Lagrangian or subset-DP on (visited, loc, slot)), not fractional knapsack. Re-state §6 "Expected" with these numbers. Log `cpu_ms` and which algorithm ran in `solver_runs`.

### B4 — `weather_ensemble` volume (§3.4, §8, §9.5) ◆ O, X
41 stops × 72 h × 51 members = 150,552 rows/night × 222 nights (19 Oct → 28 May) = **33.4M rows ≈ 5 GB** (heap ~94 B/row + composite PK index ~50 B/entry). Live DB today: **130 MB** (`dem_blocks` 31 MB, `terrain_profiles` 30 MB, `weather_forecasts` 25 MB growing ~1 MB/day). Live `pg_settings` (effective_cache_size 384 MB, shared_buffers 224 MB, max_connections 60) match the **Nano** tier, which Supabase docs label "free plan" — **plan UNVERIFIED** (a paid org can run Nano). Free plan: DB read-only above 500 MB → ~17 nights. Pro: 8 GB included, so viable but ~64 % of disk for ~66 MB of information. The 41 shooting stops occupy **9 cells** (`Math.round`, weather-pull's convention; 8 with `floor`): members are literally identical for every stop in a cell.

**Fix.** Store per cell with member arrays at the native 3-hourly step:
`weather_ensemble_cell(cell_key text, model text, run_at timestamptz, valid_at timestamptz, cloud_low smallint[51], cloud_total smallint[51], rh smallint[51], wind real[51], gust real[51], precip real[51], temp real[51], dew real[51], weather_code smallint[51], primary key (cell_key, model, run_at, valid_at))` + `stop_cell_map(stop_id, cell_key)`. ≈ 225 rows/night, **~90 MB for the whole archive** (hourly: ~260 MB; Uint8-quantised bytea: ~79 MB; one blob per run: 66 MB). Interpolate to hours and 15-min slots in the tensor builder, not in the table. Keep every run; no partitioning needed. Give it its own retention outside `prune_weather_forecasts`.

---

## 4. Schema (§3) — corrected deltas

Keep the spec's table names where possible. Changes:

**Global.** An event trigger `ensure_rls` enables RLS on every `CREATE TABLE`; with no policy PostgREST returns zero rows to the anon key (this is why `scout_*` are invisible to the app today). **The migration must add `create policy … for select using (true)` on `solver_runs`, `solver_plans`, `solver_anchors`, `scout_shot_requirements`** (and decide for `weather_ensemble_cell`, `solver_drive_matrix`). [A]

**`scout_shot_requirements`** — keep. Add `shot_type text` (or `reflection boolean`) because `weather_score`'s reflection wind ladder depends on it. `tide` is unenforceable until a tide feed exists (tables are empty) — keep the column, no gate in v0. `wave_max_m` is enforceable from the deterministic marine row only. Note `light` cannot be evaluated for vantages without `bearing_deg` (NULL coords or < 20 m) — define the behaviour (treat as `any`, or skip). [S, G]

**`solver_anchors`** — add `status text check (status in ('confirmed','requested','pending'))`; replace single `lat/lng` with `from_lat/from_lng/to_lat/to_lng` so a sailing can be expressed; **take `kind='hotel'` out of the overlap check** — hotels are per-night facts, not timeline intervals (as written, Cottages by the Sea 14–23 May overlaps every visit of nine days and the kernel rejects everything). Model hotels as `solver_hotel_nights(date, hotel_out_key, hotel_in_key)` or derive from `accommodations` (3 rows with coords, check-in/out dates exist). Keep `stop_id references stops(id)` with the default NO ACTION deliberately (blocks a stop delete). [G, S, A]

**`solver_drive_matrix`** — state the key population: subjects with coords (104) + 3 hotels + FAE + ferry terminals/meeting points ≈ 50–110 keys depending on whether ad-hoc subjects are merged. `via` from the route's toll info if the API returns it. See §7 for the API. [A, O]

**`weather_ensemble`** → **`weather_ensemble_cell`** + **`stop_cell_map`** as in B4. Drop `vis_m`, `cloud_base_m`; add `model`, `weather_code`, `dew`. Add **`weather_det_cell`** (or reuse the same table with `model='dmi_harmonie_arome_europe'`, member arrays of length 1) for the 72 h deterministic fog fields. Record `run_at` from the API response, not the cron time. [W, X, O]

**`solver_runs`** — add `degraded boolean`, `fog_source text` ('ecmwf_proxy' | 'harmonie_shared' | 'gfs_ukmo_p'), `algorithm text` ('dfs' | 'beam' | 'ils'), `weather_run_at` = the model run actually used. [W, G]

**`solver_plans`** — each visit needs **`stop_id` (nullable)** resolved at solve time, because the apply target is `stops` and 56 subjects have no stop. Define the policy for `stop_id IS NULL` (apply INSERTs a new movable stop from the subject's coords — then reword 1.7 to "never DELETE" — or the UI shows "no stop yet"). Define `p10_score` (6th-smallest of 51, or interpolated), `p_god_frame` = (1/51)·#{k : max over GOD visits of V_k ≥ 0.6}, and replace "P(score ≥ 0.6)" with a normalised fraction-of-potential (plan scores are tier-weighted sums, 0 … ~30+). [A, G]

**`scout_subjects.captured_quality numeric default 0`** — clean addition (absent today; `scout_subjects` has 32 columns). [S]

**New: `solver_apply_plan(plan_id uuid)`** SECURITY DEFINER — one transaction; `UPDATE stops SET day_id, position, updated_at` for the plan's stop ids where `movable = true AND shot_type <> 'logistics'`, refusing `time_locked` stops and any stop outside the plan's `trip_id`; renumber positions 0..n per touched day (there is no `unique (day_id, position)` — add one, deferrable, or renumber inside); then recompute `drive_override_minutes` from `solver_drive_matrix` (it is the previous-stop leg and goes stale on every reorder) or re-run `calculate-drive-times`. Exposed via an edge function with the existing `x-api-key` pattern. **This replaces "by the existing swap path", which does not exist**: the RN app has four read-only screens, `updateStop/insertStop/deleteStop` and `usePhotoUpload` have zero callers, the DB has no reorder function or trigger on `stops`, and SETUP.md says edits are "Claude pushes changes directly to Supabase". The only delete-and-reinsert anywhere is `reset_test_bed()` (scoped to trip `7e57bed0-…`). [A]

**`station_obs_hourly`** — add `visibility_m`, `ceiling_ft`, `fog_code boolean` harvested from the same METAR JSON `refresh_model_skill_step()` already fetches (stage C currently inserts only temperature, cloud %, wet). **This is a one-function SQL change and starts the fog truth archive now.** [W, S]

**Housekeeping.** Set `trips.timezone = 'Atlantic/Faroe'` for the Faroe row (NULL today); set `stops.time_locked = true` for every seeded anchor (false on all 86 stops today); add `CLAUDE.md` with the data-safety note citing the live FKs. [S, A]

**Rule 1.7 has no technical backstop.** `stops`, `days`, `trips`, `stop_photos`, `weather_forecasts` carry `full_access FOR ALL TO public USING (true)` — the anon key shipped in the app and both web viewers can UPDATE/DELETE stops. `scout_*`, `stop_sun_pairs`, terrain tables have **no policies** (anon cannot read solver inputs). The solver must run with the service role. Recommend: tighten the anon policy on `stops` to SELECT, route writes through `solver_apply_plan`, and consider a BEFORE DELETE trigger on `stops` that raises unless a session flag is set. [A]

---

## 5. Weather and fog input path (§3.4, §4)

**What the current pull does per invocation (one `day_id`).** METAR once; ensemble once per 0.25° cell (4 vars, 7 models, `start_date=end_date=usedDate`); per stop: `/v1/forecast` with 24 hourly + 6 daily vars for up to 21 registry models, `/v1/marine` (7 vars), previous-runs convergence (`ecmwf_ifs025`, 3 vars × `_previous_day1..3`). All for one date and the stop's `time_label` hour. ≈ 1 + cells + 3×stops HTTP calls. [W]

**Why "store every member" is not a small change (claim V refuted).** `memberSeries()` pools every key matching `<var>` or `<var>_*` across all models (the comment admits `cloud_cover_low` cannot be added without colliding with `cloud_cover`); the unit of work is per-`day_id` with `test:true` → today's date; the archive needs run-time/valid-time keying, 72 h, batched inserts and its own retention. §9 step 5's separate `weather-ensemble-pull` is right. Start from the **deployed v35 + `logic.ts`** (commit them first); reuse `getJson`, `cellKey`, the model list. [W]

**The fallback as written cannot produce a 72 h tensor.** "Replicate member 0 × 51" is mathematically fine (CVaR = mean, bound holds) but "member 0" is a misnomer (deterministic row = HARMONIE primary, not an ensemble control) and the deterministic data covers one hour per stop. Rewrite: *fallback = the 72 h deterministic hourly pull replicated across members, `degraded = true`*. And invert the framing: the deterministic HARMONIE series is the **richer** fog source and belongs in the normal path as the member-invariant gate. [W]

**Run timing.** ECMWF ENS lands on Open-Meteo 7–8 h after the run; at 19:00 UTC the 12z run may or may not be there; the 9 km Europe ensemble is 0z/6z only (≥ 13 h old by evening). Either pull at ~21:30 UTC or poll for the 12z run; always store `run_at` from the response. [X]

**Gates.** Define each gate as a 0..1 ladder, not a boolean product (otherwise `score ∈ {0,1}` and "P(score ≥ 0.6)" degenerates to P(on)). Wind: the existing gust ladder mapped to `1 − pen/4`; `scout_shot_requirements` has separate `wind_max`/`gust_max` which the existing ladder cannot honour — define `wind_gate` explicitly. `overcast` and `any` must still require sun altitude ≥ `sun_alt_min` (the sun only reaches −7.8° at 62°N in late May; nothing else stops a 02:00 "on"). `inversion_gate` reads `stops.elevation_m` (exists) via the subject→stop map; vantage elevation = `terrain_profiles.ground_m`. [G, S]

**Light geometry.** Correct **iff** `rel := |((sun_az − bearing_deg + 540) mod 360) − 180|` with `backlit ≤ 45 / side ≤ 135 / front` — exactly `vantage_light()`'s formula. A signed difference would miss half of all side/front light. **Terrain blocking must use the subject's skyline for front/side light (is the subject lit?) and the vantage's skyline for backlit/sunstar (is the disc visible?)** — `vantage_light` already does this split with observer heights `coalesce(elevation_m, ground_m, 0) + 1.6` (vantage) and `height_m/ground_m + 2` (subject); use exactly those heights or `skyline_cached` misses and re-aggregates 33,300 samples. Evaluate light on the 15-min grid (altitude changes 6–7°/h near sunrise/sunset; a 15° golden-hour cap spans ~2.3 h and hourly sampling misplaces its edges by ±30 min; azimuth moves 13°/h); weather stays hourly. Require ≥ `min_minutes/15` consecutive "on" slots in the dwell window (the spec's max-over-slots satisfies a 30-min requirement with one slot). [G]

**Sizes are fine.** 155 shots × 72 × 51 = 569 KB; SubjectValue per vantage 56 × 81 × 3 × 51 = 694 KB/day. Store V **per vantage** (Uint8) and apply `tier × (1 − captured_quality)` in float at search time, since the DFS loops over vantages and walk times differ per vantage. [G]

**Where the builder runs.** 212 vantages × 72 h of `sun_position`/`terrain_horizon` as SQL round-trips from an edge function is wall-time-bound (150 s cap on Free), and serialising the ensemble through PostgREST plausibly exceeds the 2 s CPU hard limit. Build the tensor **set-based inside Postgres** (one plpgsql function called by pg_cron; both functions are already SQL) writing a `bytea` (< 2 MB) to a table or Storage; or run it in GitHub Actions / locally if it must be TypeScript. Keep edge functions for the ranker only, with the blob cached at module scope and `x-region: us-west-2`. [O, X]

---

## 6. Algorithm (§1, §4–§7)

**CVaR definition (claim N).** α × 51 = 10.2. Three candidates: (a) Rockafellar–Uryasev at α = 0.2: weights 0.098 on each of the worst 10 and 0.0196 on the 11th-worst; (b) "worst 11" = α = 11/51 = 0.2157; (c) worst 10 = 0.196. They differ by up to ~9 % of (x₍₁₁₎ − mean of worst 10) — same order as the §7 0.5 % decision threshold. **Pick α = 11/51 and define CVaR as the plain mean of the 11 lowest member scores** (R–U with that α is identical at the optimum; integer scaling ×561 for mean + CVaR). Must be the **lower tail in maximisation form** `CVaR_α(X) = max_η { η − (1/α)·E[(η − X)⁺] }`; the minimisation form would reward gambles. Effective per-member weights at λ = 0.5: 3.5/51 for the worst 10, 1.5/51 for the 11th, 1/51 for the other 40 — tell Phil "the worst ten members count 3.5×". [G]

**Bound.** `(1+λ)·UB ≤ K-th` is valid (scores non-negative, CVaR ≤ mean, the −10 % anchor penalty only lowers scores), and loose by design (factor 1.5). The fractional knapsack is a valid upper bound **only** with one item per subject of `v_i = max over start ≥ t and dwell of mean value` (suffix-max per subject per slot) and `w_i = min_minutes + walk_in + walk_out + min inbound drive`; choosing the best *ratio* option per subject silently loses exactness. Use two knapsacks (time, drive) and take the min. Unit-test `UB(node) ≥ best leaf under node` on the S family. [G]

**Diversity filter is inverted and can hide the optimum.** "Jaccard ≥ 0.5 from every kept plan" is a *similarity*; it must be distance = 1 − Jaccard ≥ 0.5. As written the first plan found in a region blocks the region's optimum, so top-1 can be sub-optimal and results depend on subject order. Also, **no top-K pruning on mean+λCVaR can guarantee the best-CVaR plan** (example: safe plan mean = CVaR = 5 → score 7.5, pruned by a 7.6 incumbent, yet it is the best-CVaR plan). Rule: if a new plan is within distance < 0.5 of kept plans and beats all of them, replace them; keep two unfiltered incumbents (best-mean, best-CVaR) and prune only if the node can improve none of {K-th kept, best-mean, best-CVaR}. [G]

**Kernel.** Walk-out is never counted: visit = `[arrive_car, +walk_in, start, start+dwell, +walk_out]`, departure = `start + dwell + walk_out`; data: Mýlingur `hike_time_minutes` 360, Árnafjall 240, Drangarnir 211, Kallur 165, `walk_minutes` up to 180 one way — a Kallur plan is 75 min short, Mýlingur up to 3 h. Use `coalesce(vantage.walk_minutes, subject.hike_time_minutes/2, 0)` each way. Hotels: exclude from overlap (above); parametrise v0 by `(hotel_out, hotel_in)` — change days 23 May (Sørvágur → Tórshavn) and 26 May (→ Klaksvík) need `drive[hotel_out][s] + drive[s][hotel_in]`. Running drive total must include the return leg. Check order is a speed matter only: time/drive → anchors/ferry → daylight (near-vacuous: window 03:19–23:31 vs `day_end` 23:30). Movable-anchor handling is scoring, not feasibility; make the penalty additive in value units (e.g. one B-tier subject) — the proportional −10 % costs more for better plans; note that with 48 h notice only day-3 anchors are movable from tonight's run. [G, S]

**Start candidates miss the optimum.** "Earliest-feasible + 2 local maxima of the mean curve" cannot reach *A early-but-sub-peak then B at peak* — the common Faroe case where Drangarnir/Tindhólmur/Gásadalur/Múlafossur all peak at the same sunset. Add breakpoints (first/last slot ≥ 80 % of peak) and backward candidates `peak − dwell − drive to each remaining peak subject`, or evaluate every 15-min start for the top-2 subjects in the beam. [G]

**v1.** Bitmask pairing is correct and cheap (4M checks ≈ 5–20 ms; 10M ≈ 20–50 ms). Selecting pairs by mean is a beam, not exact — say so. **"CVaR only for the top ~500 by mean" is unsafe**: a plan can beat score S whenever `1.5·mean > S`, i.e. most survivors; the "within 15 %" elite pool needs scores for all plans with `1.5·mean ≥ 0.85·S`. Scoring all disjoint triples (~0.5–1 µs each) is 1–3 s — fine nightly. Build day-route pools per day with that day's hotel pair. [G]

**Retry (claim K).** Per-member max across days is the right v1 implementation of "best of its shots": `E[max(V1_k, V3_k)] ≥ max(E V1, E V3)` values a retry as insurance. Needs per-visit member vectors (~0.6 MB/day). What it misses is **recourse** (in members where day 1 succeeds, day 3 would be re-planned); that is exactly what the v1.5 per-member rollout computes — set `captured_quality_k(s) := V1_k(s)` before the greedy re-plan. So v1 = per-member max, v1.5 = recourse. `captured_quality` is unknown at plan time; the member is the stand-in. [G]

**Diversity metric.** With (subject, day, part-of-day) triples a pure day-permutation of a plan is at distance ≈ 1, so the returned set can be five shuffles of one itinerary. Use `0.6·(1 − J_subjects) + 0.4·(1 − J_triples) + 0.2·[different base island]`, define base island (majority of visit time), require subject-set distance ≥ 0.3 for all but one pick, and force-add best-CVaR even if it is outside the 15 % pool. [G]

**Rollouts.** Greedy 2-day re-plan over ~30 subjects is ~1–3 ms per (route, member) → 0.5–1.5 s total, 10× the quoted 100 ms (fine nightly). γ = 0.7 is a haircut for the rollout's within-member clairvoyance; its right size is the §7 "information regret" — tune it (0.5–1.0) in the backtest, and say whether it applies once or per day. [G]

**Gate 0 (claim J).** KU Leuven OPTW instances are 100 customers + depot, single route (verified from the instance file header `4 10 100 1`, Tmax 1236); c101 m = 3 → 810 corroborated, c101 → 590 corroborated without a vehicle count; **320 / 198 / 219 / 1020 UNVERIFIED** (hosts blocked). They are static, additive, single-scenario — none of this solver's distinguishing features — and since the 2e6 guard trips at 100 nodes, the *beam* is what gets measured even at m = 1, so "per-day exact so it should hit these" does not follow. Replace with: **0a** brute-force the S family (≤ 12 subjects, real tensor) and require the DFS to match exactly; **0b** beam/ILS on KU Leuven with the official best-known file, ≤ 2–3 % at 1 s, reporting which algorithm ran; **0c** CP-SAT vs brute force on S; **0d** TOPTW m = 3 as the analogue of three disjoint days from one hotel. Pin the best-known values in fixtures once fetched from a machine that can reach the KU Leuven page. [G]

**CP-SAT oracle.** Sound. ~12.2k vars with 51 scenarios (spec says 13.7k; same order). Element over a shared `slot×3 + dwell` index per (subject, day) feeding 51 targets ≈ 1.5M table cells — tractable. Integer objective at α = 11/51, λ = 0.5: `×1122 = 22·ΣX_k + 561·η − 51·Σu_k`. **Slot range "0–75" is too small**: 81 slots on 21 May, 83 on 28 May — size per day from sunrise − 60 to `day_end`. Workers = vCPUs (8 workers on a 2-vCPU container is 4× oversubscribed and not comparable to a laptop). [G, O]

**Claim P (by-eye gap).** Not measurable without the real tensor. The synthetic instance's top-5 plans were within 0.4–0.6 % of each other at every R — a very flat optimum, consistent with "the value is in timing and risk-weighting, not in finding a unique optimum". Add a "Phil-vs-solver" cell to §7 (Phil plans 10 evenings from the heatmap; compare realised score; if the gap is < 3 %, stop at v0/v1). [G]

---

## 7. Operations and cost

**Scheduling.** pg_cron 1.6.4, `cron.timezone = 'GMT'`, server `TimeZone = 'UTC'`; whether Supabase allows changing it is UNVERIFIED. Atlantic/Faroe is UTC+1 until 24 Oct 2026, **UTC+0 from 25 Oct 2026 to 27 Mar 2027**, UTC+1 from 28 Mar 2027. So "20:00 Faroe" = `0 19 * * *` on 68 of the 222 archive nights (incl. the whole trip) and `0 20 * * *` on 154. Simplest: **one job `0 20 * * *` UTC year-round** (21:00 Faroe in May, after the 12z ENS normally lands) — or pin to run availability. Reuse the `jobid 1/3` pattern (DO block → `net.http_post`), pass `timeout_milliseconds` explicitly, treat as fire-and-forget (every existing call already trips pg_net's 5 s), write a pull-log row from inside the function (pg_net keeps responses 6 h), schedule off the hour (e.g. minute 17) to avoid `:07` and the `*/5`, `*/10` jobs. Supabase guidance: ≤ 8 concurrent jobs, ≤ 10 min each. [O, X, S]

**Edge functions (Supabase docs source).** 256 MB; wall clock 150 s Free / 400 s paid; **"Maximum CPU Time: 2s" per request** (excludes async I/O); idle timeout 150 s; bundle 5 MB when deployed server-side (the MCP path used for weather-pull) vs 20 MB via CLI; soft/hard isolate retirement is documented **without a published soft number** — the spec's "1 s soft" is not in the docs. Cold-start and Storage fetch latency UNVERIFIED. The ranker fits if the blob is module-cached; the nightly builder/planner do not (see §5). [X, O]

**Database budget.** Today 130 MB. `weather_forecasts` grows ~1 MB/day now and **~16 MB/day during the trip** (hourly job × 86 stops) before weekly pruning — that alone approaches 500 MB on Free. Ensemble archive in array form < 100 MB; backtest table ~100 MB. Confirm the plan; anything beyond this needs Pro (8 GB, $0.125/GB after). [O, X]

**Open-Meteo budget.** Free tier 600/min, 5,000/h, 10,000/day (non-commercial, CC-BY); weight = `max(vars/10, vars/10·days/14)·locations`, models multiply variables; member weighting UNVERIFIED (worst case assumed). Nightly ensemble pull per cell ≈ 413 weighted calls (0.25°) + 413 (9 km) + deterministic ~984 + marine 41 ≈ **1,850/night from ~100 HTTP requests — 18 % of the daily cap**. The real consumer is the existing hourly job once Faroe days enter the 15-day window on 29 Apr 2027 (384 weather-pull calls/day × ~3 requests × up to 21 models). One observed failure mode: an upstream 500 wiped a whole night of ensemble stats (86 rows) — add 3 retries at 2-min spacing before falling back. [O, X]

**Drive matrix.** `driveTimes.ts` and `calculate-drive-times` both use legacy Directions, one request per pair (claim D confirmed). ~50 keys → 2,450 ordered elements = **4 Routes API `computeRouteMatrix` requests** (625-element cap, 3,000 elements/min) at **$0** under the 10,000 free elements/month (pricing/limits from search summaries of Google's pages — hosts blocked; legacy Directions price not retrieved). Claim D's "paid" is wrong at this volume and Distance Matrix is the *legacy* product. If the matrix is subject-keyed (104 subjects + hotels) it is ~12–14k elements, ~$20 once, ~5 min at the rate limit, and 2,450 sequential Directions calls with the existing 100 ms sleep exceed a 150 s edge-function wall clock. Use `TRAFFIC_UNAWARE`, lat/lng waypoints, keep the asymmetric matrix, **never avoid tolls** (the sub-sea tunnels are the only links between Vágar, Streymoy, Eysturoy, Borðoy, Sandoy). Ferries (Kalsoy car ferry route 56, 12 vehicles; Mykines passenger-only) stay anchors. Whether Google routes over the Kalsoy ferry is UNVERIFIED. Run server-side with the edge-function secret `GOOGLE_MAPS_API_KEY` (Routes API enabled on it); the Android key in `app.json` may be package-restricted. Delete or deprecate `driveTimes.ts`. [A, O]

**Cloud Run.** Free tier 180,000 vCPU-s/month request-based, 240,000 for Jobs (Tier 1). Nightly 60 s CP-SAT on 2 vCPU ≈ 3.6k vCPU-s/month — free (the spec's "~11k" is not derivable but is in range). **The §7 benchmark grid is not free**: 360 instances × 600 s × 2 vCPU ≈ 432k vCPU-s before seeds — run it locally with 8 real cores. [O, X]

**Where "Tomorrow" lives.** The RN app (Expo SDK 51) is read-only, needs an EAS APK rebuild + sideload per change, and has no login. `faroes-web/index.html` is a 1,022-line static page on Netlify that already fetches stops + newest `weather_forecasts` per stop in one PostgREST call, renders stars and the lock icon, and deploys on push. Put "Tomorrow"/"Next 3 days" in **faroes-web** (SELECT policy on `solver_plans`); implement "apply" as `solver_apply_plan` behind an edge function with the `x-api-key` pattern; evening inputs (`captured_quality`, realised conditions) as a tiny web form hitting a SECURITY DEFINER RPC rather than an APK cycle. **Three build-order items (3.6, §8 realised field, §9.8 apply) are the product's first write UI — budget them.** [A]

---

## 8. Seed data (§3.2) vs what the database says

| Seed row | Database | Verdict |
|---|---|---|
| Drangarnir sunset (Beinir) Sat 15 May, movable 48 h | `scout_actions`: "8 OCT 2026 — Cave tour moved Mon 17 → TUE 18 MAY. Sunset tour requested SAT 15 MAY evening. Plan: sunset Sat 15, cave Tue 18, Dunnesdrangar Thu 20 am, Tindholmur Sat 22, Wed 19 + Fri 21 float." Operator Beinir Guttesen (hiking.fo), 5,000 DKK cash, "Easy to move for weather". Status requested/pencilled, not confirmed in writing. **No 48 h figure found for Beinir.** | Dates match; `status='requested'`; `notice_hours` unknown |
| Drangarnir cave (Beinir) Tue 18 May | same row | Matches |
| Dunnesdrangar (Jákup) Thu 20 May 06:00, alt Fri 21, 48 h | "13 OCT 2026 — JAKUP CONFIRMED (WhatsApp) … '6am is no problem' … Thu 20 May 6am, Fri 21 backup"; notice "name the day 2 days ahead; time adjustable 1 day before". | Matches; `status='confirmed'` |
| **Rannvá day 1 / day 2, Sun 16 + Mon 17 (Mýlingur, Tindhólmur), pending, alt Wed 19** | **Zero occurrences of "rannv" in `scout_actions`, `stops`, `days`, `scout_subjects`, `scout_access_options`, `costs`, `research_prompts`.** | **No support in the DB — do not seed** |
| (missing) | **`⚓ BOOK — Tindhólmur`**: 8,000 DKK, Ellef/Bluegate or via Jákup, "AWAITING JÁKUP'S FOUR-TOUR QUOTE"; 8 Oct plan says Sat 22 May; `stops` has it Wed 26 May 13:00 (360 min) with a logged conflict ("boat sails from SØRVÁGUR … 26 May is the Tórshavn → Klaksvík transit"). | **Add as a movable anchor, date TBD** |
| Kalsoy ferry out 06:40 / back 22:35 Thu 27 May, not movable once booked | SSL route 56, reservations open 90 days before (~26 Feb 2027), nothing held; "22:15→22:35 DAILY BY REQUEST" with a 24 Sep note that the request function is likely disabled in summer; candidates 26 or 27 May. `stops` on 27 May: board Klaksvík 06:04, arrive Syðradalur 07:00; board 22:00, arrive 22:55; day title "First ferry at 6:40". "Not movable once booked" stated nowhere. | Matches with caveats; `status='pending'` |
| Hotels: Cottages by the Sea 14–23, Hotel Brandan 23–26, KG Hotel 26–28 | `accommodations`: exactly these, with coords and confirmation numbers (Brandan 6252189916, KG 6318636626). | Matches exactly |
| Flights: arrive FAE 14 May 11:25, depart 28 May 14:05 | Stop "FAE — Arrive + Europcar" 11:25 on 14 May; day 28 subtitle "FAE 2:05 PM → KEF → IAD 10:15 PM". Icelandair $1,140.77, 1 traveller. The `trips` row starts **13 May** (day 0 "Wheels Up", IAD 20:30) — the spec's "14–28 May" omits it. | Matches |

Also: `stops`/`days` still show the **pre-8-Oct plan** ("Drangarnir — Guided" on Mon 17 May 09:21; 18 May holds only Fjallavatn; day titles "ANCHOR: Dunnesdrangar" 16 May, "ANCHOR: Drangarnir" 17 May); two `🔴 CONFLICT — fix the time` rows exist (Klakkur 20:25 vs sunset 22:47; Tinganes afternoon); `scout_actions` says "GROUP SIZE IS NOW 1, NOT 2" while `trips.travelers = ['Phil','Holly']`. **Sync `stops`/`days` to the 8 Oct plan before the feasibility kernel reads either.** [S]

---

## 9. Validation plan

*The dedicated validation-plan audit did not run; this section is my synthesis of the verified data-source findings [X, O, S, W, G] plus the earlier three-layer proposal.*

### Layer 1 — the solver finds the best plan for its inputs (no weather needed)
Gate 0a–0d as in §6. Instance generator: real subjects + real matrix; S family = 8–12 subjects brute-forced. CP-SAT oracle locally. Deliverable: DFS = brute force on S; beam gap on M/L vs CP-SAT bound; `UB(node) ≥ best leaf` test. **Doable Jan–Feb with no external data.**

### Layer 2 — the scores predict reality
**Forecast side (archived):**
- **Nightly member archive from now** — the only member-level history that will ever exist: Open-Meteo stores individual members **≤ 3 days** ("Individual ensemble members … only stored for up to three days"; Ensemble API `past_days ≤ 3`), Previous Runs and Historical Forecast are deterministic, ECMWF open data is a rolling ~12-run window (AWS bucket retention UNVERIFIED). Every night not archived is gone. [X]
- **Previous Runs API** (leads 1–7 d, most models from Jan 2024): documented variables are temperature, RH, dew point, precip/rain/showers/snow, weather_code, pressure, **total** cloud, wind speed/direction — **no low cloud, no visibility, no cloud base, no gusts** (the live pull's `wind_gusts_10m_previous_dayN` request returns nothing on all 258 recent rows). May–Jun 2024 + 2025 at 41 stops ≈ 2,870 weighted calls once (~82 requests), ~100 MB in Postgres as rows, ~10 MB as arrays. Fog proxies (RH, T−Td) only. [X, O]
- **Historical Forecast API**: stitched short-lead series, IFS 0.25° from 2024-02-03, HARMONIE DINI only from **2024-07-01** (so no 2 km model for May–Jun 2024), has visibility/low cloud/RH/gusts. Use as lead-0 baseline. [X]
- **TIGGE**: real 51 ECMWF members from 2006, **6-hourly only**, 48 h delay, registration, CC BY 4.0; 2 m dewpoint, 10 m wind, total cloud, precip; visibility absence UNVERIFIED. Use for the "archived real ensemble" §7 family at 6 h and to calibrate synthetic-member σ(lead); do not present interpolated TIGGE as hourly. [X]
- **Ensemble Mean API** (mean + spread retained long-term from March 2026): calibrate the AR(1) perturbation σ by lead time. [X]

**Truth side:**
- **EKVG METAR via IEM** (`DK__ASOS`; `asos.py`; vsby, skyc1–4, skyl1–4, tmpf, dwpf, relh, raw METAR; synced every 10 min; little QC; archive depth for EKVG UNVERIFIED — check the station's data calendar). The best single fog-truth series, west Vágar only. [X]
- **In-house `station_obs_hourly`** — already accumulating hourly EKVG temp/cloud/wet; **add visibility/ceiling now** (§4). [S, W]
- **DMI metObs**: DMI docs say stations in the Faroes with visibility, cloud cover, cloud height, humidity, dew point; raw, from 1953, API key. **Current Faroese roster UNVERIFIED** (Tórshavn 06011 closed 31 May 2021; a Faroese service may run Mykineshólmur, Borðan, Akraberg, Kirkja, Eiði). Register and list `/collections/station/items?bbox=-8,61.3,-6,62.5` before building on it. Lighthouse stations would be the only place-specific fog truth away from the airport. [X]
- **Landsverk**: 27 road stations (wind, temp, pressure, humidity, precip, road state — **no visibility**), 35 webcams every 30 min (14 co-located), history **paid**, no bulk download. Wind/precip truth only; scrape live pages into `station_obs_hourly`. [X]
- **Webcams**: Landsverk's half-hourly JPEGs are the realistic feed (public authority; grouped by island; Vágar: Sandavágshálsur, Vatnsoyrar, Mykines); third-party cams (Windy) are intermittent; terms of use UNVERIFIED — ask Landsverk. ~10k frames/camera by May → per-site fog prior and camera-site truth; a side project with licensing/uptime risk. [X]
- **Satellite**: Sentinel-2 (~11:00 local pass days) and Worldview MODIS/VIIRS (3–5 h latency, 250–375 m) for qualitative fog-extent checks on a handful of backtest days only. [X]
- **Phil's realised conditions** per stop during the trip (§8) — needs the write UI (§7).

**Statistics:** per gate variable, Brier score and reliability diagram of the member fraction "on" vs truth; ROC for fog proxy vs EKVG `vsby < 2 km`; per-station calibration offsets (per-stop is not possible without webcam/lighthouse truth — `model_skill` is per station and has no fog metric). Sample size: ~200 nightly runs × 72 h gives ~14k forecast-hours at the EKVG cell but only one truth point; fog events are the limiting count — expect enough for reliability at the cell, not per vantage. Honest statement: **by May there will be a calibrated fog proxy at the airport cell and a prior elsewhere.**

### Layer 3 — better than Phil
- **Blind replay**: ~20 evenings from the archive window (not past Mays — see below): Phil plans from the reconstructed heatmap, solver plans the same day, both scored against EKVG/webcam truth. Hindsight leakage control: show only the run available at 20:00. n = 20 is suggestive, not proof; what it reliably shows is *systematic* misses (windows Phil never saw; fog the solver fell for).
- **Past-trip replay (claim AC) is not possible from in-DB material**: Ireland/Scotland, Iceland, Colorado, Fort Irwin have **one `weather_forecasts` row per stop** (old upsert path, no `raw.models`), **0 `exposures`, 0 `checked_stops`, 2 field photos**. The **Grand Teton Winter trip (27 Dec 2026–1 Jan 2027, KJAC, already pulling 17-model raw + ensemble stats)** is the first live dress rehearsal — use it. [S]
- **Rolling-horizon regret** split into solver vs information regret needs: the plan chosen each evening, the plan recommended, and realised per-stop truth — log all three from the first night of use.

### Schedule
| When | Do | Data it needs |
|---|---|---|
| **This week** | Commit v35 + `logic.ts`; `weather-ensemble-pull` (per-cell arrays, 10 ECMWF vars + 72 h HARMONIE fog fields) on `0 20 * * *` UTC; extend `station_obs_hourly` with vis/ceiling; register DMI key and list Faroese stations; pull EKVG from IEM for May–Jun 2024/2025 and the archive window; decide on Landsverk cam scraping (ask permission). | none — starts the only member archive that will exist |
| Nov | `backtest_forecasts` from Previous Runs for May–Jun 2024/2025 (~1M rows); synthetic-member calibration from Ensemble Mean API; subject→stop map, coords, vantage geocoding; shot requirements draft. | above |
| Dec | Tetons trip as dress rehearsal of the pull + ranker UI (KJAC truth). | live |
| Jan–Feb | Layer 1: brute-force S, Gate 0a–d, CP-SAT oracle locally; Phil-vs-solver cell on synthetic days. | tensor + matrix |
| 26 Feb | Kalsoy ferry booking opens (90 d). | — |
| Mar | Layer 2 on Oct–Mar archive (~150 runs): reliability/Brier at EKVG cell; fog-proxy ROC; decide `fog_source`. | archive + IEM/`station_obs_hourly` |
| Apr | Blind replay evenings on archived runs; v1.5 rollout keep/drop; γ tuning. | archive |
| 29 Apr | Hourly weather-pull starts for Faroe days — check API budget and DB size that week. | — |
| 13 May | Trip. Log chosen vs recommended plan + realised conditions nightly. | write UI |

---

## 10. Corrected build order

First four are doable this week.

1. **Repo hygiene + safety.** Pull deployed `weather-pull` v35 (`index.ts` + `logic.ts`) into the repo and commit. Create `CLAUDE.md` with the data-safety note citing `stop_photos_stop_id_fkey` and the other four cascading FKs; cite `supabase/schema.sql:73`. Mark `src/services/driveTimes.ts` deprecated.
2. **Start the archive.** New edge function `weather-ensemble-pull` + `weather_ensemble_cell` / `stop_cell_map` (per-cell arrays, native 3-hourly, `model` column, `run_at` from the response, retries ×3, own retention) + 72 h HARMONIE fog fields; pg_cron `17 20 * * *` UTC. Extend `station_obs_hourly` with `visibility_m`, `ceiling_ft`, fog flag inside `refresh_model_skill_step()`.
3. **Fix the data path.** Subject→stop mapping; coordinates for the 4 tiered subjects without them; geocode GOD/S shot vantages (triggers terrain + skyline); set `trips.timezone`; define the subject population and D/F weights; sync `stops`/`days` to the 8 Oct plan.
4. **Migration `solver_v0_schema`** with the §4 deltas: `scout_shot_requirements` (+ `shot_type`), `solver_anchors` (+ `status`, from/to coords, hotels excluded), `solver_hotel_nights` or derivation, `solver_drive_matrix`, `solver_runs` (+ `degraded`, `fog_source`, `algorithm`), `solver_plans` (+ `stop_id` per visit, documented P definitions), `scout_subjects.captured_quality`, **SELECT policies on every app-read table**, `solver_apply_plan()` skeleton.
5. Draft `scout_shot_requirements` from `time_of_day` + subject `best_light` (light, fog, recent_rain_wanted, inversion_wanted, sun_alt_max); numeric thresholds at defaults for Phil.
6. Seed `solver_anchors` from the five `BOOK` rows: Beinir ×2 (`requested`), Jákup (`confirmed`), Tindhólmur (`pending`, date TBD), Kalsoy (`pending`, book 26 Feb), hotels from `accommodations`, flights. **No Rannvá.** Set `stops.time_locked`.
7. Fill `solver_drive_matrix` with 4 `computeRouteMatrix` calls (edge function, existing secret).
8. **Score-tensor builder in SQL/plpgsql** (reuse `vantage_light` thresholds, subject-skyline for front/side, 15-min light grid, 0..1 ladders) → `bytea`; nightly after the pull.
9. **v0 ranker edge function = beam with 300 ms guard** (+ exact DFS behind a flag for ≤ 12 subjects); corrected kernel (walk-out, hotel pairs, candidates, diversity distance, two incumbents); write `solver_runs`/`solver_plans`.
10. **faroes-web "Tomorrow" section** + `solver_apply_plan` via edge function + evening-input form (captured_quality, realised conditions).
11. v1 planner (per-member max across days, score all triples, per-day hotel pairs, corrected diversity) as a pg_cron-triggered job outside edge-function CPU limits (SQL, GitHub Actions, or Cloud Run Job).
12. Gate 0a–d + CP-SAT oracle (local); Phil-vs-solver cell.
13. v1.5 rollouts (γ tuned by backtest); v2 calibration from Layer 2.

---

## 11. Open decisions for Phil (each with a default)

- **Scenario set**: ECMWF-only 51 members (default), or a weighted multi-model set using the 232 already pulled? Default ECMWF-only; keep the others as summary stats.
- **Fog source** (`fog_source`): per-member RH/T−Td/low-cloud proxy × shared HARMONIE visibility/cloud-base gate (default), with GFS/UKMO `P(vis<min)` as an optional multiplier once non-null at 62°N is confirmed.
- **α**: 11/51 with CVaR = mean of the worst 11 (default), or keep 0.2 with the R–U fractional weight in both codebases.
- **Tier weights** incl. D (default: D = 0.5, F excluded) and the 74 untiered subjects (default: excluded).
- **Ad-hoc pair subjects**: merge into research subjects (default) or keep as vantages.
- **Visits with no stop**: `solver_apply_plan` may INSERT a movable stop (default; rule 1.7 becomes "never DELETE"), or UI shows "add manually".
- **Storage/plan**: confirm the Supabase plan. Default assumes Free/Nano and keeps the DB under 500 MB (array archive, backtest table ~100 MB).
- **Cron time**: `0 20 * * *` UTC year-round (default) vs DST-split jobs.
- **Primary v0 algorithm**: beam with time guard (default) vs ILS.
- **Anchor penalty**: additive one-B-subject per moved anchor (default) vs −10 %.
- **Rannvá**: confirm there is no such booking; the DB has none.
- **Tindhólmur landing date**: 22 May (8 Oct plan) vs 26 May (`stops`) — conflicts with the Tórshavn → Klaksvík transit.
- **Beinir notice window**: unknown; ask.
- **Webcam archive**: pursue with Landsverk permission (default: ask this week), or skip.
- **`max_drive_minutes` 240 and `day_end` 23:30** — unchanged from the spec; the daylight check is near-vacuous in May.

---

## Appendix A — earlier critique claims A..AC

| Claim | Verdict | Note |
|---|---|---|
| A ensemble exists in weather-pull, 7 models, 4 vars, none serve visibility | **Partially** | Model/var lists exact; summary stats *are* stored and feed scoring; ECMWF ensemble *does* serve low cloud/RH/dew point (not requested); GFS/UKMO ensembles *do* list visibility; `vis_m`/`cloud_base_m` truly have no ECMWF source |
| B 0.25° cells, one day | **Confirmed, stronger** | Also one *hour* per stop; 9 cells for 41 stops |
| C no CLAUDE.md | **Confirmed** | Not in repo, subdirs, or git history |
| D Directions per pair; Distance Matrix better | **Partially** | Per-pair confirmed (two code paths); "paid" wrong (10k free elements/month); Distance Matrix is legacy — use Routes `computeRouteMatrix` |
| E hike_in in no table | **Refuted** | `scout_subjects.hike_time_minutes`, `scout_vantages.walk_minutes`, `scout_access_options.duration_minutes` |
| F no marine, no tide | **Partially** | Tide: tables exist, 0 rows, no feed (confirmed). Waves: populated on every DMI/KNMI row (refuted) |
| G `stop.elevation_m` unclear | **Refuted** | Exists, populated on all 86 stops, cron-refreshed |
| H P(score ≥ 0.6) undefined | **Confirmed** | Definitions proposed in §4 |
| I node count optimistic; pruning valid; no dominance | **Confirmed** | Measured: 2.6M nodes at 11 subjects |
| J Gate 0 tests a different problem | **Confirmed** | Beam is what gets measured; 3 of 6 target values unverified |
| K per-member max across days | **Confirmed** | = E[max]; v1.5 adds recourse |
| L pg_cron UTC → `0 19 * * *` | **Confirmed for May; partial** | UTC+0 from 25 Oct to 27 Mar (154 of 222 nights) |
| M `pending` has no column | **Confirmed** | and Rannvá does not exist in the DB |
| N α·51 = 10.2 | **Confirmed** | Three definitions; pick 11/51 |
| O fog decisive; ensemble can't see it | **Partially** | Sees it only via 25 km RH/dew-point/low-cloud proxies; visibility in GFS/UKMO members |
| P small problem, few-% gap | **Partially / not measurable** | Flat optimum observed on synthetic instance |
| Q value in tensor/heatmap/alerts/archive | **Supported indirectly** | by G's flat-optimum note and X's "archive now is load-bearing" |
| R layer 1 needs no weather | **Supported** | Gate 0a–d |
| S Previous Runs 1–7 d from 2024 incl. vis + low cloud | **Partially** | Leads/dates confirmed; **no visibility, low cloud, cloud base or gusts** |
| T TIGGE 51 members, years, limited vars | **Partially** | 6-hourly only, 48 h delay, CC BY 4.0; vis absence unverified |
| U ECMWF open data on AWS from ~2023 | **Largely refuted** | Rolling ~12-run archive; AWS retention unverified; not a history |
| V storing members is a small change | **Refuted** | New function, new keying, new retention |
| W IEM EKVG: decades, vis, ceiling | **Partially** | All but depth (unverified) |
| X DMI metObs Faroe stations | **Partially** | Docs say yes; current roster unverified; Tórshavn closed 2021 |
| Y Landsverk stations/cams | **Confirmed** | 27 stations (no visibility), 35 cams/30 min, history paid |
| Z webcam frame archive | **Partially** | Feasible via Landsverk; terms unverified; third-party feeds intermittent |
| AA satellite spot checks only | **Confirmed** | |
| AB blind replay ~20 evenings | **Not assessed** | Validation audit did not run; see §9 for a protocol |
| AC past-trip replay | **Largely refuted** | 1 forecast row/stop, 0 exposures, 0 ratings; use the Dec 2026 Tetons trip instead |

## Appendix B — finding index (118)

Severity as assigned by the auditor. ◆ = found independently by ≥ 2 audits.

**Blockers**
- W `no-visibility-or-cloud-base-in-ecmwf-ensemble` ◆ (also X `ens-no-visibility-no-cloudbase-ecmwf`, O `ens-vars-no-vis-cloudbase`)
- S `pairs-link-adhoc-subjects` ◆ (also G `tensor-data-path-stop-sun-pairs`)
- G `dfs-node-count`
- O `ens-per-stop-volume` ◆ (also X `supabase-db-size-vs-ensemble-rows`)

**Major**
- W `repo-v33-vs-deployed-v35-logic-ts` ◆ (S `weather-pull-repo-stale`)
- W `ensemble-is-pooled-summary-not-51-members` ◆ (S `weather-forecasts-columns-and-ensemble`)
- W `one-day-one-hour-per-stop-cell-dedupe` ◆ (S `ensemble-grid-and-one-day-fetch`, O `ens-cell-dedupe-count`)
- W `faroe-rows-are-todays-preview-not-trip-dates`
- W `prune-strips-ensemble-after-21-days` ◆ (S `archive-already-exists-but-pruned`, O `weather-forecasts-retention-context`)
- W `ecmwf-ensemble-serves-low-cloud-rh-dewpoint` ◆ (X `om-ifs025-ensemble-matches-spec`)
- W `ifs-europe-9km-ensemble-lacks-low-cloud` ◆ (X `om-ifs-europe-9km-ensemble-exists`)
- W `claim-v-not-a-small-change`
- W `replicate-member-0-fallback-incoherent`
- W `metar-visibility-history-not-retained` ◆ (S `ground-truth-archive-unmentioned`)
- S `subject-count-tiers-coords`
- S `shot-vantages-lack-coords`
- S `model-skill-not-weather-model-scores` ◆ (W `model-skill-table-name-and-scope`)
- S `drive-time-sources-wrong` ◆ (A `spec-drive-time-row-inaccurate`, A `deployed-drive-time-edge-function`, O `drive-matrix-cost-and-api`)
- S `seed-vs-actions-and-itinerary`
- A `claude-md-does-not-exist` ◆ (S `stop-photos-cascade-no-claude-md`, W `trigger-is-pg-cron-only`)
- A `no-existing-swap-path`
- A `cascade-blast-radius`
- A `nothing-enforces-never-write-stops`
- A `new-solver-tables-auto-rls-no-policies`
- A `matrix-cost-and-key-count`
- A `apply-needs-subject-to-stop-resolver`
- A `app-has-no-write-ui`
- X `ens-visibility-exists-gfs-ukmo`
- X `om-members-not-archived`
- X `ecmwf-open-data-scope-retention`
- X `tigge-archive-terms`
- X `landsverk-road-stations`
- X `supabase-edge-function-limits` ◆ (O `edge-function-limits`, A `edge-function-cpu-limits`)
- G `cvar-alpha-51-members`
- G `ub-knapsack-item-construction`
- G `diversity-filter-vs-topk`
- G `terrain-blocking-wrong-observer`
- G `kernel-hike-out-missing`
- G `kernel-hotel-anchor-overlap`
- G `start-candidates-miss-optimum`
- G `v1-pairing-and-cvar-shortcut`
- G `retry-per-member-max`
- G `gate0-literature-and-what-it-tests`
- O `ens-storage-shape`
- O `backtest-archive-calls-and-storage` ◆ (X `om-previous-runs-api`, X `om-historical-forecast-api`)

**Minor**
- W `weather-score-ladder-and-shot-type-usage` ◆ (S `weather-score-confirmed`)
- S `terrain-horizon-signature-and-indexing`, `no-time-locked-stops`, `tide-and-wave-sources`, `hike-in-columns-exist`, `trips-and-past-trip-replay`
- A `tomorrow-screen-placement`, `rule-1-8-semicolon-unverified`, `api-key-handling`
- X `om-free-tier-and-weighting` ◆ (O `open-meteo-nightly-budget`), `ens-pull-timing-vs-run-availability`, `iem-ekvg-metar-archive`, `dmi-metobs-faroe`, `faroe-webcams-scraper-feasibility`, `pg-cron-available-utc` ◆ (S `extensions-and-cron-timezone`, A `pg-cron-and-pg-net-present`, O `cron-timezone-and-dst`), `cloud-run-free-tier` ◆ (O `cloud-run-free-tier-and-cpsat-workers`)
- G `beam-fallback-cost`, `light-classification-geometry`, `hourly-sun-vs-15min-slots`, `overcast-any-gates`, `movable-anchor-penalty`, `diversity-metric-definition`, `rollout-cost-and-gamma`, `p-score-and-p-god-frame`
- O `weather-pull-trigger-today`

**Notes (confirmations the spec relies on)**
- W `trigger-is-pg-cron-only`, `apis-and-variables-called-today`, `stop-elevation-available` ◆ (S `stop-elevation-exists`)
- S `vantage-geometry-is-view`, `sun-position-and-vantage-light`, `scout-actions-structure`, `captured-quality-absent`, `shots-text-draftable`
- A `only-delete-reinsert-path-is-reset-test-bed`
- X `ecmwf-ens-9km-51-members`, `supabase-storage-from-edge`, `satellite-spot-checks`
- G `cvar-sign-and-tail`, `prune-rule-validity`, `dominance-51-vectors`, `tensor-sizes`, `kernel-check-order-and-daylight`, `cpsat-oracle-sanity`, `small-problem-flat-optimum`

Full finding text (claim / reality / evidence / impact / recommendation for all 118) is in the workflow journal at `/root/.claude/projects/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/subagents/workflows/wf_e0630181-a71/journal.jsonl` and extracted at `/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/review/findings.md`; the DFS/beam/sun simulations are in that scratchpad's `work/` directory.
