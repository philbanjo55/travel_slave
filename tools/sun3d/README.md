# Teton Sun Preview (concept demo)

A one-page 3D look at the Tetons from a few stops, lit by the calculated sun for 30 Dec 2026.
Artifact: https://claude.ai/artifact/Pb98xc4aXLU43cuyTcVxTU. No Google data in it.

- `page.src.html`: the page. `/*__SUN__*/` is replaced by `sun.js`, `/*__APP__*/` by `app.js`.
  It loads three.js r128 from cdnjs and fetches `teton-dem.png`, published beside the page.
- `build_dem.py <dir>`: builds `teton-dem.png` (2048 x 2048, one point every ~27 m, lat 43.45-43.95,
  lng -110.92 to -110.24) from the public terrarium elevation tiles at zoom 12
  (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/<x>/<y>.png`, x 785-793,
  y 1490-1498, saved as `<dir>/tiles/12_<x>_<y>.png`). The PNG holds prediction residuals
  (left + up - upleft, half-metre steps above 1500 m, filter 0), so the page decodes it exactly
  with `DecompressionStream`. It is not kept in the repo (2.3 MB): rebuild it.
- `app.js`: heights go to the graphics card as two half-float channels; one pass lights every
  point (snow / rock / forest colour, sun angle, shadows marched toward the sun) into a 2048 px
  light map whenever the time changes; the terrain mesh just shows that map. First / last light
  and "where you stand" are point checks on the CPU.
- Sun times are a few minutes off: the sun never counts before the flat-horizon sunrise, and
  terrain outside the area casts no shadow.

## Google 3D tiles with our sun (test harness, `google/`)

Tried 12 Nov 2026: Google's Photorealistic 3D Tiles of the Tetons, relit by our own light pass
(sun angle + shadows from the 27 m grid) and optionally "snowed" (bright ground turns white, dark
trees and water stay). It works; see CLAUDE.md for what was found.

- `relay.js`: local server on :8770. `/v1/...` goes to `tile.googleapis.com` with curl through the
  session proxy, which adds the key (network secret, header `X-Goog-Api-Key`); tiles are kept on
  disk for the run only: delete `cache/` afterwards.
- `main.js`: three 0.160 + 3d-tiles-renderer 0.3.31 (`npm i three@0.160.0 3d-tiles-renderer@0.3.31
  esbuild`, copy `../sun.js` to `src/sun.js` with `export { sunPos }`, bundle to `dist/main.js`,
  `dist/index.html` holds a 1200 x 800 canvas `#view`). The tiles are moved into a local frame at
  the middle of our grid (x east, y up, z south) so a tile's world position maps straight onto
  our light map. `window.__g.set({stop, mins, focal, mode})`: mode 0 Google as is, 1 + our sun,
  2 + snow.
- `shot.js '<jobs json>' <errorTarget>`: headless renders to `out_<name>.png`.

## The app's view and two-level terrain (Faroes close-ups, 12 Nov 2026)

- `app_view.js` is the page inside the app's web view (built into `src/components/sun/sun3dHtml.ts` by
  `build_app_html.js <three.min.js r128>`; rebuild after every edit). It takes one wide grid and, optionally,
  one fine grid inside it (`cfg.near`, file sent with `S3D.chunk(b64, 'near')`):
  - the far mesh is cut out inside the fine box (kept for the first ~160 m inside the edge, then pushed down,
    not drawn past ~420 m); the near mesh has its own heights and light map, bunches its points around the
    shot, hangs a skirt at its edge, and fades heights and colours into the far grid's toward the edge;
  - near shadows are marched in the fine grid and carry on into the far grid beyond the box;
  - "is it in the sun" and first / last light read the fine grid when the pin is inside it;
  - a close subject on the fine grid is looked at directly (up or down), not at a fixed slight upward tilt.
  With no `near` the page draws exactly what it did before (Teton check: 0 of 540,000 pixels differ).
- Tables: `terrain_regions` (wide, one per area) and `terrain_near_regions` (fine boxes, `parent` = region).
  `src/services/terrain.ts` `nearFor` picks the smallest box that holds the stand spot, first those that also
  hold the subject; with the subject outside the box the view is aimed and the subject's sun read as on the wide grid.
- `build_dem_arctic.py <work dir> <out.png> <north> <south> <west> <east> [n] [res]`: elevation from the
  ArcticDEM v4.1 mosaics (Polar Geospatial Center, CC-BY-4.0, north of 60 N), read in blocks straight from the
  public bucket. Use it instead of `build_dem.py` in the Faroes: the terrarium tiles there carry heights above
  the ellipsoid (~58 m too high), fill the fjords with blocks at 0-130 m (sea drawn as land at any zoom) and
  have no sea stacks. ArcticDEM fills open water at the local sea level, which the script fits and takes off.
  `pip install tifffile imagecodecs`.
- `build_faroes.sh <work dir>`: the wide Faroes file plus the 11 fine boxes (6 MB together).
- What the data cannot do: a height grid has no arches or overhangs (Drangarnir's arch, sea caves), waterfalls
  and buildings are not in it, lakes draw as grass, and the source is a smooth surface model: Stóri Drangur is
  a 50 m cone (really 70 m with an arch), Lítli Drangur a shoulder of the headland. A pin 100 m off now
  matters: the Kallur stand pin sits on the west cliff face in this data.

## Terrain for any trip: `build_trip_terrain.py` (12 Nov 2026)

`TRIP_Q=<read-only SQL helper> python3 tools/sun3d/build_trip_terrain.py build <work dir> --region <id> --prefix <xx> --trip <uuid>`
(or `--pins pins.json`; `--trip` saves that file in the work dir, so a rerun needs no database). In order: pins,
source (ArcticDEM when the whole area is north of 60 N, else terrarium), the wide file (the listed region's own file,
or a new 2048 grid over all pins), the DATA CHECK (a FAIL stops the run), fine boxes around the stand spots, a check
of every box (also against the wide file: the page blends the two), then `terrain_<region>.sql` and `upload.txt`.
`plan` lists the boxes without building; `check <file> <north> <south> <west> <east> [--base m] --pins ...` checks any file.

Fine boxes: every stand spot gets `--pad` metres of ground (2000) where it fits, a subject within `--close-km` (6)
stays in the same box, boxes merge while under `--near-max-km` (8) a side. The app picks, per shot, the smallest box
that holds the stand spot (first those that also hold the subject), `terrain.ts` `nearFor`. The Faroes boxes were
picked by hand before this script existed (`build_faroes.sh`); `plan` on the Faroes trip gives 15 similar ones.

The data check, on the three files we have (12 Nov 2026):

| File | Stops' stored heights | Land vs Copernicus | Sea along the coast | Airport | Verdict |
|---|---|---|---|---|---|
| Teton wide (terrarium z12) | +1.0 m, 100% within 25 m | -0.9 m | no coast | KJAC -4 m | PASS |
| Faroes wide, old terrarium z12 | +51.3 m, 24% within 25 m | +57.1 m | 38% within 2 m of 0 | EKVG +51 m | FAIL |
| Faroes wide, ArcticDEM | +0.0 m, 98% within 25 m | +0.3 m | 100% within 2 m of 0 | EKVG -6 m | PASS |

Grand Teton fine boxes (8, terrarium zoom 14, about 6 m a point, 1.45 MB, migration `20261112090000`): the foreground
gain is small. Looked at 24 and 50 mm, before / after: Snake River Overlook and Oxbow Bend show the bench edge and
the drop to the river as crisper shapes; the Moulton barn flats look the same. The river itself does not show: in
winter colours water, snow and flats are all white, and the file has no water mask (flat-ground detection on
half-metre heights marks the sloping flats in stripes: tried, not usable). A water mask in the file is the next
step if the foreground matters.

Saved ahead (TEST app): when a trip's sun plan loads (every trip open or sync), `terrain.ts` `saveTripTerrain`
fetches every wide file and fine box the trip's stand spots need, one at a time in the background, and the 3D panel
shows "3D terrain saved for this trip: 9 of 9 areas". With no signal the saved lists still choose the files; a
missing fine box means the wide grid draws alone. Grand Teton: 3.7 MB (9 areas), Faroes: 6.3 MB (12 areas).

## Third level: real foreground from a laser survey (`lidar/build_detail.py`, 12 Nov 2026; built, NOT uploaded or applied)

`TRIP_Q=<read-only SQL helper> python3 tools/sun3d/lidar/build_detail.py build <work dir> --trip <uuid> --wide-file <the region's wide file>`
(`plan` lists the boxes; a rerun reads `<work>/pins.json` and the survey tiles kept in `<work>/cache`, ~700 MB for the
Teton trip). Source: USGS 3DEP lidar as an Entwine EPT on AWS, project `WY_GrandTetonNP_1_D22` (2022, 2-9 points per
0.5 m cell). One box per stand spot (500 m, 1000 x 1000 cells of 0.5 m; stand spots within 150 m share one), two files
a box:
- `<id>_lidar.png`: the BARE surface = ground, water and buildings, no trees (the page's 16-bit format, **`step_m` 0.02**,
  `base_m` = the box's lowest height less 5 m);
- `<id>_mask.png`: 8-bit, one byte a cell: 0 ground, 2 building, 3 water, 8 and up = tree, its canopy top
  (value - 8) x 0.2 m above the ground.
The script's header lists the cleaning steps (noise, wires, low things, water, buildings the survey left unsorted found
as solid raised patches of 25 m2 and 2.2 m or more, tidy footprints). Output: `files/`, `look/<id>.png` (a map to look
at), `upload.txt`, `detail.json`, `pins_report.json` (every stand spot's distance to the nearest tree and building),
`terrain_detail.sql` (= `supabase/migrations/20261112150000_terrain_detail_regions.sql`).

Grand Teton: 19 boxes, 38 files, 7.4 MB. Emily's Pond Levee and Teton Pines Nordic Center are south of the survey
(it ends at 43.538 N): no detail there. The survey's ground sits on the wide grid (middle difference 0.0 to +0.3 m).

- The page: `cfg.detail` + `S3D.chunk(b64, 'detail')` / `S3D.chunk(b64, 'mask')`. A third mesh inside the near mesh (or
  the far mesh with no near box); the coarser meshes are cut out under it; 4-25 m at its edge match the surroundings,
  the next 16-45 m blend. The detail box must lie inside the shot's near box (`terrain.ts` `detailFor` checks; the page
  leaves the detail out otherwise and says so with a `detail` message). The HD (Google) page ignores it.
- Buildings: blocks with upright walls. The mesh blends heights only between cells of the same kind (building or
  not), so a roof keeps its ridge and its edge drops straight down. Wood colour, a little lighter on the roof under snow.
- Trees: not in the surface. Up to 520,000 points a box between each canopy top and a few metres under it (small and
  many close to the stand spot, fewer and larger farther off; none within 12 m of the eye, none in the blend strip),
  round, 10% of their pixels left out so they are a little see-through in any drawing order. Lit by the sun the
  ground under them gets (the detail light map's alpha) less what the crowns toward the sun take.
- Sun: the detail light pass marches shadows through ground and buildings, then on into the near and far grids; under a
  canopy the ground only gets a soft, lighter shade. `vis()` / `lit()` and first / last light use ground and buildings
  only, 2 m above the survey's ground on the detail grid (3 m on the other grids). The survey is leaf-on and cannot
  tell a bare winter cottonwood from a spruce, so trees never move a time; the `state` and `moments` messages carry
  `trees: true` when the surveyed trees would hide a sun the rest lets through (now / some time that day) and the panel
  says so in one line.
- Foreground switch (panel, leaf button, on by default): off starts the page again without `detail`.
- With no `detail` the page is unchanged: 0 of 450,000 pixels differ on four Teton shots with a near box and on one
  without (old page vs new page, 12 Nov 2026).
- What it cannot do: trees have no trunks and no lower crown, and read as dotted bushes, not as spruce or cottonwood;
  a building is a plain block (no doors, logs, eaves); nothing is drawn beyond the box; a stand pin 10-20 m off now
  matters (see `pins_report.json`).
- Tests: scratchpad `lidar_build/test/` (`run.js` feeds the page like the app, `spots.py` picks the files like
  `terrain.ts`). First / last light at the stand spot, 30 Dec 2026, every minute, near box only -> with detail:
  T.A. Moulton 08:29 / 16:14 -> the same (trees flag on); Oxbow Bend 08:13 / 16:20 -> 08:13 / 16:21 (trees flag on);
  Snake River Overlook 08:24 / 16:33 -> 08:24 / 16:34; Cunningham Cabin 08:50 / 16:37 -> the same; subject times
  unchanged. Start (decode + build, this machine, software graphics): about 0.75 s with detail against 0.52 s
  without. Not run on a phone.

## How accurate the sun times are (measured 12 Nov 2026)

Checked against 102 real webcam pictures on 5 clear December / January days in Grand Teton (27 events; resort
panoramas every 10 min, Tetonia every 15 min, so each real event is known to about +-3 to 7.5 min):
- a ridge or peak blocking a sun that is still 3-16 degrees up (15 events): average error +0.5 min, typical 1.3,
  worst +4: within about 5 minutes, no lean either way;
- sunrise / sunset on high points with the old rule (10 events): typical 8.5 min, worst 13 (first sun too late,
  last sun too early); sun setting behind a peak on the horizon (2 events): 7-8 min early.
The rule now used for first / last light follows from that: the sun's centre against a hard skyline, and a high
point sees below the flat horizon by 0.95 deg x sqrt(its km above the area's low ground, the 10th percentile of the
grid: 2,012 m for the Teton file). Scored on the 16 point events (window = between which two pictures it happened):

| Rule | High-point sunrise / sunset (12) | Ridge blocks the sun (4) |
|---|---|---|
| first rule: whole sun, soft edge, no dip | 2 inside the window, typical 8.3 min, worst 13 | 4 inside, typical 0.5 min |
| sun's top edge + dip | 10 inside, typical 3.3, worst 9 | 4 inside, +3.3 min late on average |
| **sun's centre + dip (used)** | 9 inside, typical 3.9, worst 10 | 4 inside, +2.0 min late on average |
| half-way (+0.135 deg) + dip | 10 inside, typical 3.6, worst 10 | 4 inside, +2.5 min |

The differences between the three new rules are inside the pictures' own 5-minute uncertainty; the centre keeps the
ridge-blocked times closest. Script: scratchpad `suncheck/score_rules.js`.
Not checked: trees and buildings, terrain beyond the grid, morning valley-floor events, summer, the Faroes.

## HD picture in the app (`app_view_google.js`, 12 Nov 2026): built and tested, switched OFF

The same idea as a page for the app's web view, with the offline page's `S3D` calls and replies
(`app_view.js` is untouched), so `Sun3DPanel.tsx` can swap one for the other ("HD" button).

- `app_view_google.js` -> `node tools/sun3d/build_app_google_html.js <dir with node_modules>` ->
  `src/components/sun/sun3dGoogleHtml.ts` (one page, ~630 KB: three 0.160 + 3d-tiles-renderer 0.3.31
  bundled by esbuild; nothing from a CDN). A second argument also writes the page as a file for tests.
- `init` gets `tiles: { base, draco, root?, headers?, errorTarget?, lodPx?, lift?, wait? }`: `base` is our
  door to Google (`supabase/functions/tiles-proxy`), `draco` the folder with three.js's DRACO decoder files,
  `root` the root tile set when the app already holds it. Every tile address is rewritten to
  `<base>/v1/3dtiles/...`, whatever host or path Google's tile set names.
- The scene is centred where you stand (x east, y up, z south); each tile vertex is mapped back to
  lat / lng to read our light map (checked against the ellipsoid: within ~1 m over the Teton grid). A
  small second camera looks straight down so Google's own ground under you is loaded, and the eye is put
  4 m above it. Ground beyond our grid gets flat-ground light.
- Replies: the offline page's, plus `credits {text, band}` and `hd {shown, loading}`. `error` = give up
  (root refused, nothing drawn in 20 s, over 40 failed tiles, lost graphics context): the app goes back
  to the offline page.

- Sun rule = the normal page's (centre of the sun against the skyline + the horizon dip, in the point checks and in
  the light pass). Checked 12 Nov on the 30 Dec 2026 sun path, every minute, both pages on the wide grid: Snake River
  Overlook -> Grand Teton 07:53 / 08:24 / 16:31 / 16:57 and Oxbow Bend -> Mount Moran 07:55 / 08:14 / 16:21 / 16:56
  (first on subject / reaches you / you lose it / last on subject), identical in both.
- Near boxes: the HD page lights Google's surface from the wide grid alone and ignores `near` and "near" chunks (the
  panel does not send them in HD). Against the normal page WITH its near box only the "you" times move: Snake River
  Overlook loses the sun 16:33 there vs 16:31 in HD; Oxbow Bend 08:13 / 16:20 vs 08:14 / 16:21. Subject times are the
  same. Left as is (1-2 minutes; feeding the fine grid to the HD point checks would close it).

**Google's Map Tiles policy** (developers.google.com/maps/documentation/tile/policies, read 12 Nov 2026):
- Attribution is drawn by the page along the bottom of the picture: Google's own outlined logo file,
  unmodified (`google/GoogleMaps_Logo_WithDarkOutline.svg`, from the policy page's "Google Maps attribution
  assets" download, inlined at build), 18 px high, clear space 10 px left / right / top and 6 px below, alt text
  "Google Maps"; in a tiny view (under 230 px wide or 120 px high) the words "Google Maps" instead. Beside
  it the tiles' data credits in one line (aggregated and sorted by the renderer, most frequent first; the
  line wraps when it doesn't fit, so it is always shown in full). Above them: "Picture: Google Maps. Light,
  shadows and snow are calculated." The app moves its own caption to the top of the picture in HD.
- Caching: the door stores nothing and hands Google's `Cache-Control` and `ETag` on untouched (and the
  caller's `If-None-Match` up: a 304 comes back as a 304). The page keeps tiles in memory only; the web
  view's HTTP cache follows those headers. Seen: tiles `private, max-age=14400, must-revalidate`, the root
  `private, max-age=0, must-revalidate`, so the app asks for a fresh root for every HD view it opens.
- The test relay holds tiles in its own memory only (nothing on disk).

**The door (`supabase/functions/tiles-proxy`, not deployed)** reads:
`GOOGLE_TILES_KEY` (needed), `TILES_ENABLED` (default off; only the exact value `true` switches HD on: off =
health says `enabled: false`, the app shows no HD button, tile requests get 403), `TILES_TEST_TOKEN` (unset;
while off, requests with header `x-tiles-test: <value>` are served), `TILES_MONTHLY_CAP` (900),
`TILES_DAILY_CAP` (30), `TILES_DRACO_URL` (default
`https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/draco/`: upload
`draco_wasm_wrapper.js`, `draco_decoder.wasm`, `draco_decoder.js` from three 0.160
`examples/jsm/libs/draco/gltf/` there).
- Why 900: Google bills the root tile set request (SKU C6E1-98B2-DBD0): 1,000 a calendar month free, then
  $6 per 1,000. The door counts root requests in `tiles_proxy_days` (migration `20261112070000_tiles_proxy.sql`,
  not applied) per day and per calendar month in US Pacific time (`now() at time zone 'America/Los_Angeles'`,
  month = first of that month to today), and answers 429 with the reason, without asking Google, at either
  cap. The other 100 are left for requests that don't go through the door. `/health` gives `day_used`,
  `day_left`, `month_used`, `month_left`; the app shows "HD views left this month: N" under the HD picture.

**Tests** (`google/app_relay.js` = the door's shape on :8771 with counts; `google/app_run.js` drives the
page headless like the app does):
- Measured at Snake River Overlook, 400 x 240 at 2x, detail 30: first view 502 files / 22 MB, the 100 mm
  lens 285 files / 16 MB more; full screen (400 x 800) 629 files / 27 MB. Not tried on a phone.
- The function was run here with Deno against a stand-in for its two database functions, and the migration
  on a throwaway local Postgres. Switched off: 403; switched off with the test header: the page drew
  through it; at the monthly cap and at the daily cap: 429; no key: 503; count unreachable: 503.
- After deploying, while still off:
  `PAGE=<page.html> DEM=<teton-dem.png> OUT=<dir> node tools/sun3d/google/app_run.js '{"base":"https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/tiles-proxy","headers":{"x-tiles-test":"<token>"},"handRoot":true,"probe":true,"noStats":true,"tiles":{"draco":"<draco folder>"},"jobs":[{"name":"deployed","az":145.6,"alt":15.35}]}'`
  (the test header makes the browser send one extra preflight call per tile: fine for a test). Each run
  is one billable root request.
