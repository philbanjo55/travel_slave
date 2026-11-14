# New trip: setup checklist

> Rewritten 12 Nov 2026 from an audit of the live system (`docs/audits/2026-11-12_new_trip_checklist_audit.md`). Lines marked **UNVERIFIED** describe something read in code or in CLAUDE.md but not seen working for a third place.

How to take a trip from "Phil has an itinerary" to everything working: app, maps, weather, sun shots, 3D view, the planner T (week drafts, evening plan, dawn re-plan, camera look, Re-plan now, notes, plan check), cameras, the practice copy and the daily checks. First written 21 Oct 2026 after Grand Teton Winter 2026; rewritten after T replaced the old nightly planner.

**The check:** `select * from trip_readiness('<trip id>');` gives one row per item with `ok` / `todo` / `wait` / `warn` / `info`. It is read-only. **It does not know about T, the practice copy, 3D terrain or camera reading** (see "Known gaps"): use the extra queries in section 10 for those.

**Who does what.** The app cannot create trips, days or stops, and nothing in it writes hotels, so Claude does the setup in SQL. Three kinds of step below:
- **Phil**: only he can give or decide it.
- **Claude**: SQL or a function call. Writes to a real trip only when Phil asked for the trip to be set up.
- **Automatic**: a scheduled job does it; the wait is given.

Cron times are UTC (give Phil Eastern times).

**Hard rules (CLAUDE.md):**
- Never DELETE a stop. Move with `UPDATE stops SET day_id, position`. "Remove" = set aside: `day_id = null` and `solver_stop_settings.tier = null`, on the trip and on its practice copy.
- Stop names are the place only ("Oxbow Bend", not "Oxbow Bend, Sunrise"). T picks the time.
- No camera without the owner's permission, recorded in `permission_note`.
- Before adding anything that grows every night, check the database size (Pro plan, 8 GB included, spend cap on).

---

## 0. What Phil provides (only Phil can)

| What | Used for | If missing |
|---|---|---|
| Trip name, dates, who is going | trip row, web viewer | |
| Day-by-day stops in order, each with a Google Maps link or pin, and how long each takes | everything | a stop without coordinates gets no weather, map, drive time or sun |
| Booked times: flights, tours, ferries, tables | fixed visits | T may move them |
| Hotels: name, pin, check-in and check-out dates | T's days start and end there | T cannot plan that day ("no hotel") |
| For each photo stop: the subject, where to stand if known, light wanted, how much it matters (tier) | sun shots, tiers | Claude suggests, Phil confirms |
| **Trip rules:** which outings can be done only once (ski, hike, boat), which stops must be on the same day, rented gear (which stops need it, pickup and return time), days that must stay as they are (arrival, departure) | T's rules | T repeats long outings, splits pairs, plans a ski outing before the skis are picked up |
| Which stops look fine under cloud (waterfalls, barns) | `needs_peaks` | every stop is marked down when the peaks are hidden. Never guessed |
| Webcams near the stops: the owner's permission, and how much may be spent on reading them | live truth for T, Feeds page | T goes by the airport only |
| How high the cloud must be for the main subject to show (rough is fine) | truth ceiling | 2,000 ft is assumed |
| Notes ("Tell T") on or off, plan check on or off | section 7 | off |
| How long the practice copy should run | section 8 | 14 days |
| Web viewer wanted? | section 11 | skip |

---

## 1. Trip skeleton (Claude): `trip_import`

Turn the itinerary into JSON and run `select trip_import('<json>'::jsonb, true);` (dry run: every problem listed, nothing written), then without `true`. The JSON format is in the header of `supabase/migrations/20261021320000_trip_import.sql`.
- It checks everything first and writes nothing if anything is wrong. Insert only.
- 24-hour times become "h:mm AM/PM".
- It adds the hotel as a logistics stop at the start and end of each new day unless a stop is already within 500 m (`"hotel_stops": false` turns that off).
- `{"trip_id": ..., "days": [...]}` appends to an existing trip.

What the rows need:
- **`trips`**: `title`, `start_date`, `end_date`, `travelers`, `archived = false`, **`timezone`** (IANA, required), **`metar_station`** (the airport within 30 km of the stops, ICAO). With no station a 10-minute job guesses one per day and can pick one whose reports are never fetched.
- **`days`**: one per date.
- **`stops`**: `name` (the place only), `lat`, `lng`, `duration_minutes`, `time_label` as "h:mm AM/PM", `shot_type` (`logistics` for airports, hotels, food, fuel: no weather score, no ensemble pull, no planner settings), `time_locked = true` for bookings.
  - A day whose first stop is time-locked (landing) starts there; a day whose last stop is time-locked (flight home) ends there.
- **`accommodations`**: `name`, `lat`, `lng`, `check_in`, `check_out`. The hotel's logistics stop name should start with the hotel's first word (T matches by first word within 500 m, else the nearest stop).

Check: `trip_readiness` steps 1 and 2.

## 2. Automatic: minutes to hours

Nothing to run. For trips that are not archived and not over:

| Job | When (UTC) | Fills |
|---|---|---|
| `stop-elevation-refresh` | every 5 min | `stops.elevation_m` |
| `model-grid-refresh` | every 5 min | `model_grid_points` |
| `model-skill-refresh` | every 10 min | `metar_stations`, `station_obs_hourly`, `model_skill` for the trip's station |
| `hourly-weather-pull` | :07 hourly for today and tomorrow; days 2-15 out at 05, 11, 17, 23 | display weather |
| `daily-preview-refresh` | 05:10 | days more than 15 days out: a "preview" |
| `weather-ensemble-pull` | 10:17 and 19:17 | ECMWF ensemble per 0.25 degree cell of the photo stops (16 days ahead when a trip is 4-15 days out) |
| Drive minutes between stops | when the trip is first opened in the app | `stops.drive_override_minutes` |

Check: `trip_readiness` step 3. Known quirk: "display weather" can sit at `wait` for a trip that is weeks away.

## 3. Shade terrain: before adding shots, only outside the Faroes

The Faroes have a built-in elevation grid (`dem_blocks`). Anywhere else load a region grid first, or every shot is marked `outside_dem` (light works, shade is unknown).

1. Box: every stop and subject plus about 25 km on each side.
2. Load: POST `dem-region-load` `{region, south, north, west, east}` from SQL with `net.http_post`, looping on `next_row` (60 rows a call). About 2 bytes a cell at the default 0.0015 degree step: Grand Teton is 634 x 954, 1.3 MB. A big area: several boxes or a coarser step. These loads write a lot of temporary data: spread big ones over days (disk IO budget).
3. If shots already exist: `select dem_region_recompute('<region>');`.

Check: `trip_readiness` "terrain (shade)".

## 4. Sun shots (Claude, then Phil refines in the app)

For each photo stop:
- `scout_subjects`: what is photographed (`lat`, `lng`, `height_m`, `subject_kind`).
- `scout_vantages`: where Phil stands. Use the stop's coordinates with `coord_confidence = 'approximate'` when unknown.
- `stop_sun_pairs` (`stop_id`, `vantage_id`, `position`). The starred shot is `solver_stop_settings.star_vantage_id`; when that is empty, the pair with the lowest `position`.

Triggers build the terrain profile and skyline cache.

**For T, a "place" is its starred shot.** Two stops that star the same shot (or aim within 300 m of each other from stand spots within 1.5 km) count as one place: visiting either counts for both. Give stops that Phil wants separately their own shot.

Check: `trip_readiness` "shots".

## 4b. 3D terrain for the trip (TEST app's 3D sun view): after the shots exist

**The standard (Phil, 14 Nov 2026: "I'm gonna always want it this good").** Every trip gets the best 3D the public data allows, the way Grand Teton got it on 14 Nov 2026 (branch `claude/sun3d-sharp-range` until it ships). Not a plain grid. For each layer, use the best source that exists for the place, and say in the trip's notes which layers had no source.

| Layer | What it is | Grand Teton (the model) | Where no laser survey exists (e.g. Faroes) |
|---|---|---|---|
| 1. Wide area | the whole region, coarse, real winter / season colour | terrarium tiles 27 m + Sentinel-2 picture of a day in the trip's season (`teton_colour/build_teton_colour.py`) | ArcticDEM 32 m north of 60 N |
| 2. Sharp range | everything the shots look at (the peaks, cliffs, stacks), <= 5 m, feeds the sun times | USGS 3DEP 1 m lidar DEM at 5 m, 10 km boxes (`build_range.py`); six summits within 3 m of published heights | ArcticDEM 2 m; national DEM / DSM (Faroes 2015 DSM 2 m) |
| 3. Close-up boxes | 1.5 km around each stand pin, 1 m: ground, water (ice option), colour from aerial photos turned to the season | USGS laser point clouds (EPT on AWS) + NAIP photos with the snow put in (`lidar/build_detail.py`) | ArcticDEM 1-2 m + agency aerial photos (`faroes/build_detail_faroes.py`) |
| 4. Buildings, whole area | walls and real roof heights out to 8 km, drawn only, never in sun times | found in the same laser survey (`lidar/build_buildings.py`, ~9,900 in the park) | national building outlines (Faroes `bygningar`); heights guessed, say so |
| 5. Trees, whole area | the survey's canopy out to 12 km, drawn only, never in sun times | `lidar/build_canopy.py` | none known |

Rules that go with it:
- **Data check first** (step 2 below), for every layer: summits against published heights, stand pins against `stops.elevation_m`, sea at 0 along coasts. A source that fails is not used (terrarium in the Faroes was 58 m high).
- **Look for a laser survey before anything else**: USGS 3DEP (US), national programmes elsewhere (names to check, not yet tried from here: Scotland's Remote Sensing Portal, Ireland's GSI / OSi lidar, Iceland's IslandsDEM, Norway's hoydedata). None found = layers 3-5 fall back as in the right-hand column.
- **Sun times use ground only** (layers 1-3: wide, range, close-up ground); buildings and trees are drawn, never counted.
- **Eye 1.73 m above the ground** (Phil is 5'8"). A close subject on a building is aimed at the building's height, not the bare ground.
- **Before / after page of every shot** for Phil (as https://claude.ai/artifact/3osCiWcRYQaxgxfAUc8JTA) and an **emulator pass online and offline** before anything reaches his phone. Phone space is not a reason to cut a layer (Phil, 14 Nov: phone space is fine); speed and memory are, and the page must fall back to the plain view rather than freeze.
- Saved for offline with the trip (`saveTripTerrain`): the whole stack must work with no signal.

The steps below build layers 1 and the first close-up boxes; layers 2-5 use the scripts named in the table (one command for all of it is not written yet: until then, follow `tools/sun3d/README.md` on the sharp-range branch).

One script does it: `tools/sun3d/build_trip_terrain.py` (details in `tools/sun3d/README.md`).

1. Run it: `TRIP_Q=<read-only SQL helper> python3 tools/sun3d/build_trip_terrain.py build <work dir> --region <short_name> --prefix <2-3 letters> --trip <trip id> --ground snow|green`.
   It reads the trip's stops and shots, picks the source (ArcticDEM north of 60 N, terrarium tiles elsewhere), builds or fetches the wide file, groups the stand spots into fine boxes and builds those. `plan` instead of `build` only lists the boxes. Subjects are peaks far away (Tetons)? add `--close-km 3`.
2. Read the DATA CHECK it prints before trusting anything: the file against the stops' stored heights, against Copernicus (land level, and sea along a coast must read about 0), and against the airports. PASS is fine. On FAIL it stops: try `--source` the other way, and do not `--force` unless you know why the numbers are off (the old Faroes file: land +57 m, 38% of coastal sea at 0).
3. Upload the files listed in `<work dir>/upload.txt` to Storage bucket `terrain` (same names).
4. Apply `<work dir>/terrain_<region>.sql` as a migration (upload first: the app fetches a file as soon as its row exists).
5. Look at two stops in the TEST app (Sun & Moon -> 3D): one close subject, one wide view. The line under the view says how many of the trip's areas are saved on the phone. Opening the trip once with signal saves them all.

Check (Claude): every starred shot's stand pin falls inside a `terrain_regions` box. `trip_readiness` does not look at this.

## 5. Stop settings and drive matrix (Claude suggests, Phil confirms)

- **`solver_stop_settings`** for every photo stop:
  - `tier` (GOD / S / A / B / C; D and F exist too), `light_wanted` (front / side / back / soft), `fog_wanted`, `source = 'suggested'`. When Phil confirms or changes a stop: `source = 'phil'`.
  - `once = true` for outings that cannot be repeated (ski, hike, boat).
  - `together = '<key>'`: stops with the same key go on the same day, all or none.
  - `needs_peaks = false` only where Phil says the stop looks fine under cloud. (Only the test bench reads it so far.)
  - A stop with no tier is left out of every plan.
- **Drive matrix**: `select net.http_post('https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-drive-matrix', '{"trip_id":"<id>"}'::jsonb, ...)`, then read `net._http_response`.
  - Repeat while it reports an element cap.
  - Pairs with no route are never planned: car ferries need a `solver_ferry_links` row.
  - Spots cut off by a gap of more than 300 km are left out (`left_out`).

Check: `trip_readiness` "stop settings" and "drive matrix". **Do not trust "drive matrix: ok" by itself**: it also says ok when no leg was ever fetched. Check the function's reply (`fetched`, `already_stored`, `errors`) or:
`select status, count(*) from solver_drive_matrix where trip_id = '<id>' group by 1;` (there should be many `drive` rows, not only `same spot`).

## 6. Ground truth: airport, cameras, history

**Airport (Claude).**
- The station from section 1. Reports arrive within about 10 minutes.
- Set the height below which the main subject is hidden, in two places that must agree:
  - `metar_stations.hidden_ceiling_ft` (scoreboard, backtest, Feeds page; empty = 2,000 ft). Jackson: 7,000.
  - `replay_places.ceiling_ft` (T's own truth; section 7c).
- History for the trip's months (about 10 minutes, worth doing for a new climate):
  - `select calib_queue_month('<ICAO>', <month>, array(select generate_series(2016, 2026)), array[2024, 2025, 2026]);` for each month.
  - `select calib_load_history();` until the queue is empty (Iowa Mesonet throttles: re-queue failed years one at a time).
  - `select solver_fit_calibration_months('<ICAO>', 'history_<season>', array[<months>]);` and add the source to `solver_calib_sources` (source, months).
  - Do the practice copy's months as well (section 8).

**Cameras (Phil's permission and budget, then Claude).** A `webcam_cameras` row:
- `code`, `name`, `lat`, `lng`, `active`, `source`, `region`, `hint`
- `permission_note`: who agreed, and when
- `tz`: the camera's time zone. The default is `UTC`: always set it.
- `image_url`: a direct image link, or a time template like `https://.../{YYYY}/{MM}/{DD}/{HHmm}.jpg` (15-minute steps, camera time). YouTube live streams (thumbnail still) and Roundshot panoramas work; see CLAUDE.md for the forms.
- `votes = false` for a camera whose view does not show the main subject (it is still read, but does not vote).
- `view_lat` / `view_lng` / `view_km` for a camera that looks at the range from far away.
- `label_paused = true` to save pictures without paying to read them.
- `history_url` if the source has an archive of past pictures.

What happens: every hour at :37 the picture is saved (night skipped). It is read by Claude only when `label_paused` is false and the spend caps allow (about 15 cents a camera a day). Cameras show on any trip with stops within 50 km. **T's camera vote needs at least 2 cameras within 80 km of the airport that are read and voting**; with fewer it goes by the airport.

Check: `trip_readiness` step 4 (it counts saved pictures, not read ones), and
`select code, active, label_paused, votes, tz from webcam_cameras where region = '<region>';`

## 7. The planner T

Background: CLAUDE.md "T runs the TEST app's Planner". T is the edge function `solver-replay`; the version that is live is the row marked `winner` in `planner_versions`. The old nightly planner (`solver-build-scores` 10:41 / 19:41, `solver-plan` 10:55 / 19:55) still runs, but the TEST app shows only T's plans once a trip has one.

### 7a. What happens by itself (wait: until the next 04:23 UTC)

Once the trip has at least one rated stop, is not archived and has a day today or later, the nightly `planner_t_week()` calls `planner_t_autoadd()`, which adds a `planner_t_trips` row with a default config. From then on T makes a **week draft** every night: every remaining trip day, from light only (no weather), shown in the TEST app as "T: week draft". "Plan again" in the app makes a new draft.

To get the first draft at once (Claude): `select planner_t_week('<trip>');` then wait about a minute.

Check: `select planner_t_trip('<trip>');` is true, and
`select p.note, max(r.created_at) from solver_runs r join solver_plans p on p.run_id = r.id and p.rank = 1 where r.trip_id = '<trip>' group by 1;` shows a fresh "T: week draft".

**That is all that happens by itself.** The default has no trip rules, no rain / wind data, no camera look, no notes, and there is no evening plan on the real forecast, no dawn re-plan and no Re-plan now until 7b-7d are done.

### 7b. Trip rules and switches (Claude, then Phil checks)

Edit `planner_t_trips.config` for the trip. Start from the config of the live trip most like it (`select config from planner_t_trips where trip_id = '<Teton or Faroes>'`) so the switches match the winner; do not type switches from memory. Then set the trip's own rules:
- `fixed_days`: dates T must leave as they are (arrival, departure).
- `gear`: `{stops: [...], from: {date, time}, to: {date, time}}` for rented gear.
- `anchors_on`: `[{stop_id, date}]` for a stop that must be on a given date (gear pickup, return).
- Once-only and keep-together belong on the stops (section 5). `once_add`, `together_add`, `locked_add` in the config do the same for one trip when the stops themselves should stay untouched.
- `morning_fresh: false` where ECMWF's overnight run is not out by sunrise (Faroes in May).
- `tell: true` to switch on notes ("Tell T") for the trip. Phil decides.

Then:
- Set `planner_t_trips.review = true` for Claude's plan check (about $0.60 a check, spend cap `CLAUDE_REVIEW_CAP_USD`). Phil decides. **The plan check's instructions name only the Tetons and the Faroes** (`t-review/index.ts`): a new area needs that function edited and redeployed first.
- Go through the rules with Phil, then `update planner_t_trips set rules_checked = true where trip_id = '<trip>';`. This is separate from `solver_stop_settings.source` (tiers and light confirmed stop by stop).

Check: `select config, rules_checked, review, note from planner_t_trips where trip_id = '<trip>';` and read the next week draft: once-only outings appear once, pairs share a day, nothing with gear falls outside its window.

### 7c. The place on the test bench (Claude; needed for any plan on real weather)

T's forecast plans read the bench's tables. A live run needs:
- a `replay_places` row: `station`, `ceiling_ft`, `fc_point` (the main 0.25 degree forecast cell, written `fc:<lat>,<lng>`), optional `truth_cam`, optional `vote_ceiling_ft`;
- past forecasts for the trip's cells in `replay_wx_day`, dated before 30 Jun 2026 (the live download takes its list of weather models from them; with none, no live forecast is fetched and the plan fails with "no lead 1 forecast");
- airport history in `metar_history` (section 6);
- the odds tables (`replay_hidden_counts`, `replay_morning_counts`; the fits are built from them).

**A trip at a place that is already set up** (another Teton or Faroes trip): `select replay_copy_place('<set-up trip>', '<new trip>');` copies the place and its counts. Run it when no live plan step is due: it rebuilds the stored odds tables, which takes minutes.

**A new place: there is no helper.** `replay_setup()` and `replay_runs_setup()` have the two trip ids, the model lists and the date windows written into them. **UNVERIFIED** outline, from how the two were done:
1. Add the place's points to `replay_points` (the `fc` and `sat` cells of the starred subjects).
2. Queue the past forecasts in `replay_fetch` for the trip's months in earlier years (Previous Runs go back to early 2024) and let cron `replay-fetch` download them. Never at :07.
3. Insert the `replay_places` row.
4. Refit as a one-off cron job with a long statement timeout (`replay_fit_hidden()`, `replay_fit_morning()`, and the vote fits if the config has `vfit`), at a time when no live step is due, then set `replay_places.fitted_at = now()`.
5. Decide with Phil whether to run the bench weeks for the new place before trusting T there.

Also true for a new place, and not solved:
- T's chance figures come from `solver_t_calib`, which has rows for `teton` and `faroes` only; any trip north of 55 degrees gets the Faroes row, any other the Teton row.
- The tick sorts places the same way (north of 55 or not) when it waits for downloads.
- Autumn odds are Sep to Nov; every other month is one group.

Check: `select * from replay_places where trip_id = '<trip>';` and
`select count(*) from replay_hidden_fit where trip_id = '<trip>' and season = replay_season('<trip start>');` is not 0.

### 7d. The live run (Claude; once per trip)

Nothing creates this for a main trip. It is one row in `replay_runs`, built from the trip's config, as in migration `20261031040000_t_every_trip.sql`:

```sql
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select p.trip_id,
       (select min(d.date) from days d where d.trip_id = p.trip_id),
       array(select d.date from days d where d.trip_id = p.trip_id order by d.date),
       (select count(*)::int from days d where d.trip_id = p.trip_id),
       p.config || '{"name": "trip_T", "live": true, "publish": true, "plan_local": "20:45", "stagger_min": 6}'::jsonb
  from planner_t_trips p where p.trip_id = '<trip>';
```

It then waits. Each evening before a trip day, at 8:45 PM trip time, it plans the next day on the forecast ("T: evening plan"); about 30 minutes before sunrise it re-plans ("T: morning re-plan"); with `early` in the config it re-plans again after the first daylight camera pictures ("T: morning re-plan (cameras)"). Re-plan now and same-day notes work only while this run covers today.

If the trip's days or the config change after the run was made, the run does not follow: its `trip_dates`, `nights` and `config` are fixed at insert. Update the run or make a new one.

Check: `select id, status, night, start_date, nights, config->>'name' from replay_runs where trip_id = '<trip>' and config->>'publish' = 'true' and config->>'name' <> 'draft_T';` shows one `trip_T`, status `queued` or `running`. The practice copy (section 8) is the real test that the path works.

## 8. Practice copy (automatic, then Claude)

**Automatic** (wait: until the next 09:13 UTC). Every main trip with rated stops that starts more than 3 days out gets one practice copy: `training_autocreate()` calls `make_training_trip(trip)`, which copies the first 14 days to start tomorrow (`trips.training_of`, `training_until` = start + 13). At most 3 run at once. After that:
- `training-sync` (10:30 and 19:30) copies changes from the main trip: times, moves, notes, shots, tier, light, once, together, set-asides. The first copy lacks once / together until the first sync.
- `training-roll` (hourly at :05) starts the itinerary again just after local midnight on its last day, while `training_until` has not been reached. Each repeat shifts the dated rules, starts a new live run (`app_T`) and clears the ticks.
- `planner_t_autoadd` puts the copy on T with the default config at the next 04:23 UTC (week drafts only, see 7a).

To start one by hand: `select make_training_trip('<trip>', '<start>', <days>);`.

**Claude, to make the copy rehearse the real trip:**
1. How long: `update trips set training_until = '<date>' where id = '<copy>';` (Phil decides; both existing copies run until the day before the real trip). An itinerary of 14 days or more never repeats unless this is later than its last day.
2. Rules: give the copy the main trip's config with its own stop ids and dates. Stop ids map through `training_copy_map` (`kind = 'stop'`, `old_id` -> `new_id`); dates shift by the copy's start minus the main trip's start. Pattern: migration `20261031040000_t_every_trip.sql`.
3. Bench place: `select replay_copy_place('<main trip>', '<copy>');`.
4. Live run for the first round: the same insert as 7d with `"name": "app_T"`. Later rounds are started by the roll.
5. History for the practice months (section 6), or the old "learning" planner skips the station.

Check: the copy shows on the 🧪 screen in the TEST app; next morning it has "T: evening plan" and "T: morning re-plan" rows; `select * from t_day_checks where trip_id = '<copy>' order by plan_date desc limit 3;` fills from the second day.

## 9. What runs every day once this is done

| Job | When (UTC) | Does |
|---|---|---|
| `planner-t-week` | 04:23 | week drafts for every trip on T |
| `replay-live-queue` | every 10 min | downloads the forecasts the live runs need (from 7:30 PM trip time the evening before) |
| `replay-run` | every 20 s | runs the plan steps |
| `webcam-archive` | :37 hourly | saves and reads camera pictures |
| `t-review` | every 10 min | plan check for trips with `review` on |
| `t-day-check` | 08:20 | what T said against what happened, last 3 ended days |
| `training-sync` / `training-roll` | 10:30, 19:30 / :05 hourly | practice copies |
| `solver-verify`, `solver-backtest` | 23:29, 23:33 | scoreboard and backtest |

## 10. Check

- `select * from trip_readiness('<id>');`. Aim for `ok`, `wait` or `info`; these are known not to clear and are fine: "display weather: wait" far ahead of the trip, "hotels: warn" for an arrival night with no hotel, "drive matrix: warn" caused by set-aside stops.
- T, which the function does not check (all read-only):
  - on T, rules checked: `select rules_checked, review, config ? 'gear' as gear, config ? 'fixed_days' as fixed, config->>'tell' as tell from planner_t_trips where trip_id = '<id>';`
  - place: `select * from replay_places where trip_id = '<id>';`
  - live run: the query in 7d.
  - draft: the query in 7a, under 30 hours old.
  - cameras read: the query in section 6.
  - 3D: section 4b.
- **Next morning:** a fresh "T: week draft"; no rows in `app_logs` with level `error` for the trip; `replay_runs` for the trip not in status `error`.
- **In the app:** the trip is in the list, the day maps have pins, the weather cards fill in, the sun panels show light and shade.
- **In the TEST app:** the Planner opens with the trip's cameras and T's plans (labelled "T (<version>)"). Not checkable from a session: ask Phil, or run the emulator checks.

## 11. Web viewer (optional)

Copy `faroes-web/` to `<trip>-web/` and change five places in `index.html`: the `<title>`, `TRIP_ID`, the fallback title, the travellers line and the footer. Commit to `master`, then add a Netlify site whose base directory is the new folder. The page reads Supabase live.

## 12. During and after the trip

- Mark shots in the TEST app (Missed it / Go back for better / Nailed it) or with `solver_mark_shot`. T plans the rest of the trip by these marks.
- Notes ("Tell T") and Re-plan now work on today only while the live run covers today.
- Label camera pictures in the TEST app when they are wrong: Phil's labels are the best truth.
- Read `t_day_checks` each morning for what T got wrong.
- **Archive the trip when it is over.** The weather jobs stop by themselves at the end date; the planner builds run until the trip is archived. The practice copy stops at `training_until`.

---

## Known gaps (12 Nov 2026)

Found by the audit; none fixed.

| Gap | Effect | Until fixed |
|---|---|---|
| `trip_readiness` has no rows for T, the practice copy, 3D terrain, trip rules or camera reading | a trip can show all green and have no live planner | section 10 queries |
| `trip_readiness` "drive matrix" says ok when no leg was ever fetched | false ok on a new trip | section 5 query |
| `trip_readiness` prints old job times (22:17, 22:41, 22:55) and counts set-aside stops as "to shoot" | confusing | ignore |
| No helper to set a new place up on the bench (`replay_setup` is written for Teton and the Faroes) | a trip anywhere else gets week drafts only, no plan on real weather | section 7c outline, unverified |
| Chance calibration, the tick's download wait and the plan check split the world at 55 degrees north into "Faroes" and "Teton" | a third place borrows one of the two; the plan check would be told the wrong area | edit `solver-replay/t2.ts` `regionOf` + `solver_t_calib`, and `t-review/index.ts`, before the first trip elsewhere |
| The odds fits learn only from data before 30 Jun 2026 (fixed date in `replay_fit_hidden`, `replay_live_queue`) | history for a new place must be older than that | |
| The default T config from `planner_t_autoadd` lacks `wx`, `vfit`, `early`, `dawn_before_min` | a trip left on the default is not running what the real trips run | 7b |
| The practice copy does not inherit the main trip's rules, bench place or live run | it rehearses a different planner than the trip will use | section 8, by hand |
| `make_training_trip` leaves out `once`, `together`, `needs_peaks` | wrong until the first `training-sync` | wait for 10:30 or 19:30 UTC |
| A live run's dates and config are fixed when it is inserted | later changes to days or rules do not reach it | update the run |
| `webcam_cameras.tz` defaults to `UTC` | wrong stale-picture checks for that camera (GT-EGVB had it until 12 Nov 2026) | always set `tz` |
| The scheduled Claude tasks (plan check by session, trip watchdog) are written per trip | a new trip has none | write new ones when wanted |
| Outside Europe the fog and cloud-base gate has only GFS / UKMO visibility | data limit, not a bug | |

Not verified in this rewrite: the app screens on a phone; `trip_import` dry run (read in the definition, not run); whether week drafts work for a trip with no `replay_places` row (CLAUDE.md says they need nothing else; every trip on T today has a place); the new-place outline in 7c; what `vfit` does at a place with no camera-vote odds.
