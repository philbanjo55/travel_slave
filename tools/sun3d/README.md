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
- Trees: not in the surface. Points between each canopy top and a few metres under it (round 3: at the survey's own
  returns, at most 90,000 a box; small and many close to the stand spot, fewer and larger farther off; none within
  12 m of the eye, none in the blend strip),
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

### Round 3 (12 Nov 2026): the trees' own returns, water out to 3 km, and the plain view first (NOT uploaded or applied)

**Data.** `build_detail.py ... --suffix _v3 --out files_v3` writes two more files a box and the columns for them.
`20261112160000_terrain_detail_v3.sql` adds the columns and fills the 19 rows. Heights and mask keep round 2's format, so
an app from before this round keeps working on the same rows; 34 of the 38 round 2 files are byte-identical and keep
their names (Blacktail 2 and Oxbow Bend gained water cells and got `_v3` names). To upload: 41 files, 7.2 MB.
- `<id>_trees_v3.png`: 8-bit, n lines of n x 8 bytes: per cell 64 bits, bit k = a laser return in the slice k x 0.6 m
  above the ground (tree cells only, returns from 1 m up). 8 KB to 1.5 MB a box (Taggart & Bradley 2, all forest:
  2.5 million filled slices), 6.2 MB for the 19.
- `<id>_water_v3.png`: 8-bit, 1500 x 1500 cells of 4 m over the 6 km around the box: 0 none, 1 moving, 2 still. 4-15 KB,
  141 KB for the 18 that have water. Read from a thinned sample of the survey (octree depth 8: a point every ~2.8 m
  wherever anything came back). Water = cells whose only returns are the survey's water class, plus the cells with no
  return at all that join them where the wide terrain file is flat and within 12 m of that water's level, or within
  40 m of water found that way. Still or moving = the water level's slope over ~100 m (under 1.2 m a km = still).
- Found (water inside the 500 m box / within the 6 km, of which still): Oxbow Bend 3.3 ha / 423 ha (353); Willow Flats
  0 / 401 (342); Swan Lake 6.0 ha / 1,607 (1,586: Jackson Lake); Taggart & Bradley 8.4 ha / 74 (40); Jenny Lake bridge
  0 / 78 (26), Jenny Lake off road 0 / 306 (284); Menor's Ferry 3.8 ha / 39; Chapel 0.6 ha / 41; Snake River Overlook
  0 / 65; Blacktail 0 and 130 m2 / 38; Cunningham 0 / 43; Elk Ranch 0 / 57; Glacier View 0 / 32; Teton Point 0 / 44;
  the Moulton barns 0 / 6-10. **Shane Cabins: none**: the survey has no water returns for the Gros Ventre there, and
  30% of that 6 km is outside the survey (Cunningham 22%, the airport corner at Moose 4%).

**The page.** The foreground never holds the plain view up.
- `done()` draws far + near and posts `ready`, exactly as without a box. The foreground is built after the first
  frames, a step at a time (`detail` {stage: decode | mask | textures | trees | light | done, ms} while it goes), and
  `foreground` {ok, light, detail, trees, real, water, ms} says it is in. Anything that goes wrong (a bad file, 60 s
  gone, memory short, graphics context lost) drops it whole: `foreground` {ok: false, msg, at}, the plain view stays.
  First / last light is posted again once it is in. The app sends it after `ready`: `S3D.fore({detail, water, ice})`,
  chunks `'detail'`, `'mask'`, `'trees'`, `'water'`, `S3D.foreDone()`.
- Trees: points in the filled slices of the tree file (a spruce is a cone, a cottonwood a spread crown), at most
  90,000 a box (`detail.maxTrees`; many small ones near the stand spot, fewer and larger far off). Without the tree
  file: made-up points under each canopy top, as in round 2.
- Water is drawn where you look from: the sky mirrored (more the flatter the view), a dark body, a glint toward a low
  sun. Inside the box from its mask; beyond it the wide layer is painted on the far / near meshes that are there (no
  mesh of its own). `ice` (`cfg.ice`, `S3D.ice(bool)`, default where the ground is snow): still water is snow with a
  faint blue cast, only moving water is open.
- Light foreground (`detail.light`, or by itself where `navigator.deviceMemory` is 2 GB or less): every other cell of
  the box each way (1 m) and 40,000 tree points.
- Every file is unpacked a line at a time (`pack` / `lines`): no whole unpacked file in memory (it was 8 MB for the wide
  grid or a tree file, and twice that while the browser joined the pieces). Big arrays are given back the moment the
  graphics card has them (`free`, ArrayBuffer.transfer); the foreground's textures go up one at a time.
- The panel: plain view first, the foreground's files load behind it and are sent after `ready` ("Foreground
  loading…"); if the web view's process dies with the foreground on (`onRenderProcessGone`,
  `onContentProcessDidTerminate`, or the page's `lost`) it is started once more without it, Foreground goes off for the
  session and one line says so. Type-checked only: not run on a phone or the emulator.

**Measured** (headless Chromium, software graphics; scratchpad `lidar_build/test`: `mem.js`, `cg.sh` = one run in its own
memory group, `limits.sh`; "before" = the page of the work branch before this level, "round 2" = 6b991b1):

| Oxbow Bend / Cunningham Cabin | plain view, before | plain view, now | round 2 with its box | now, full | now, light |
|---|---|---|---|---|---|
| peak memory of the whole test browser, MB (empty page: 111) | 382 / 396 | 372 / 390 | 423 / 436 | 420-434 / 441-447 | 419 / 426 |
| the page's own arrays at rest, MB | 77 / 82 | 30 / 33 | 99 / 96 | 48-57 / 58 | 54 / 54 |
| ready, ms | ~420 | ~420 | ~600 | ~450 | ~450 |
| foreground in, ms | | | (at ready) | ~1,100 | ~1,050 |
| CPU slowed 20x: ready, s | 8.4 / 7.9 | 8.6 / 8.1 | 10.8 / 10.4 | 8.0 / 8.4 | 7.9 / 7.7 |
| CPU slowed 20x: foreground in, s | | | (at ready) | 13.0 / 12.1 | 11.0 / 10.0 |

With the CPU slowed 20x the longest stretch the page is busy after `ready` is about 1 s with or without the box (the
plain view's own first frame is that long). Lowest memory limit on the whole test browser at which the view still drew
(Oxbow Bend; steps 310 / 325 / 340 / 355 / 370 / 385 / 400 MB): plain 340, light foreground 370, full foreground 385-400
(drew at 385 in one run of two), round 2 400. Under the limit the kernel kills a process outright, so this shows what
each needs, not the page's own fall-back. What these numbers do NOT cover: the graphics work itself on a slow
software-GL phone (the box's light pass is 1 million cells, up to 300 steps each; 250,000 on the light grid): CPU
slowing does not slow it here.
- With no `detail`: 0 of 450,000 pixels differ from the page before this level (four shots with a near box, one
  without), first / last light the same. With the box: first / last light at the stand spot equal round 2's on the
  four test spots (Moulton 08:29 / 16:14, Snake River 08:24 / 16:34, Oxbow 08:13 / 16:21, Cunningham 08:50 / 16:37).

**Still wrong.**
- Lake or river is a guess from the water's slope: a slow, flat reach of the Snake counts as still (drawn frozen with
  `ice`), and the oxbow itself, which does freeze, counts as moving in places (few water returns make its level look
  sloped); the change shows in 32 m steps.
- Narrow creeks (Cottonwood Creek at the Jenny Lake bridge) have no water class in the survey and are not drawn. The
  water is the 2022 summer shore: Jackson Lake stood at 2,056 m in the survey, 7 m under the wide terrain file's
  2,063 m, so its shore is farther out than in a full year. Nothing mirrors in the water but the sky.
- From the stored pins of Snake River Overlook and Blacktail Ponds the rim and the trees hide the river (30 m forward
  at the rim it shows); from Willow Flats the part of Jackson Lake inside the 3 km lies left of the view.
- With 90,000 points the trees are coarser than in round 2's pictures of 250,000; far ones thin to scattered dots.
  No trunks (airborne laser hardly sees them; not added). Buildings are plain blocks.

## Smoothness of the app's view (12-13 Nov 2026, branch `claude/sun3d-butter`)

What the page (`app_view.js`) now does, in the order it mattered in the measurements:

1. **Only what can be seen is drawn.** Each mesh's triangles are kept in 16 x 16 blocks; a frame draws the blocks
   whose box touches the view (three.js geometry groups, runs of neighbouring blocks = one draw call). Same picture.
   Oxbow Bend with the foreground: 3.53 M triangles a frame before, 1.22 M now (135 mm lens); plain view 2.36 M -> 0.68 M (Cunningham Cabin 0.37 M).
2. **One frame at a time on the graphics card.** After each frame a WebGL fence is set; no new frame is sent until
   it has signalled. A slow phone so shows the newest heading / sun / spot instead of working through a queue. The
   time from a frame's start to its fence is the frame time the page reports and steers by (if a driver never
   signals, after 12 s the page stops asking and times frames by the next frame callback: `timed: 'frame'`).
3. **Lighter while moving, sharp when still.** A drag, sun positions (the slider) and walk steps are a movement,
   drawn at a level; 150 ms after the last drag move (at once on finger-up), 260 ms after the last sun position,
   280 ms after the last walk step (steps come 130 ms apart), ONE full-quality frame is drawn, with the full
   light pass in that same frame (it used to run on its own timer, also in the middle of a slow drag of the slider).

   | level | canvas | tree points | quick light pass (far map) | meshes |
   |---|---|---|---|---|
   | 0 full | as when still | all | 1024 | all points |
   | 1 high | 0.75 each way | all | 512 | all points |
   | 2 medium | 0.6 | half, drawn larger | 512 | near + detail: every other point |
   | 3 low | 0.5 | 30% | 256 | far mesh too (the skyline moves a few pixels until the sharp frame) |

4. **Governor.** Six moving frames averaging over 24 ms (or two in a row over 60 ms): one level down; under 12 ms:
   one up; a level that was too slow right after a step up is not tried again. Two levels are kept, `look` (drag,
   walk) and `sun` (the slider also pays for a light pass). The page posts them in `perf`; `Sun3DPanel` keeps them
   and hands them to the next page (`cfg.level`), so the next stop starts where this one ended.
5. **Canvas size.** When still: 2 device pixels a point at most (as before) and at most 1.4 M pixels in all, so a
   phone's full screen (412 x 800 at 2 = 1.32 M) is unchanged and a tablet is capped. Resolution turned out to be
   the small lever on software graphics (a quarter of the pixels: ~15% off a frame), so the still picture was not cut.
6. Small things: the frame box's style is written only when it changes (it was written every frame); a failed
   foreground no longer lets go of the shared triangle list (the no-near-box case would have broken the plain view).

`perf` (at most once a second, when a movement ends): `{kind, ms (median frame), worst, frames, level, quality,
levels: {look, sun}, px, pts, timed}`. The TEST panel shows it as one grey line, "Smoothness: 9 ms a frame
(worst 21) · quality full" (`accessibilityLabel` starts with `Smoothness:`).

**Measured** (scratchpad `butter/`: `bench.js`, `free.js`, `still.js` + `cmp.py`, `offline.js`, `table.py`; headless
Chromium, software graphics, CPU slowed 4x and 20x; 412 x 520 and 412 x 800 CSS px at device pixel ratio 2.6).
Software graphics is hundreds of times slower than a phone's chip and weighs the work differently (triangles and
anti-aliasing cost most here, pixels little): the numbers are before / after ratios, NOT phone predictions. Median
ms a frame, small view, CPU 4x (full screen and CPU 20x are within ~10% of these: the page's own JS is not the
bottleneck anywhere):

| | drag: before -> level 0 -> governed | slider | walk |
|---|---|---|---|
| Oxbow Bend, foreground | 2695 -> 1717 -> 451 | 8511 (*) -> 3233 -> 601 | 2705 -> 1700 -> 432 |
| Cunningham Cabin, foreground | 2119 -> 1389 -> 326 | 7349 (*) -> 2965 -> 446 | 2172 -> 1351 -> 317 |
| Oxbow Bend, plain | 1245 -> ~600 (**) -> 226 | 3585 (*) -> 310 | 1297 -> 198 |
| Cunningham Cabin, plain | 1146 -> ~350 (**) -> 124 | 3772 (*) -> 227 | 1059 -> 117 |

"Level 0" = quality held at full while moving (what a phone that keeps up gets: blocks in view + one frame at a
time); "governed" = the level the governor settled on here (3, low). (*) Before, every slider frame here also ran
the FULL light pass (its 260 ms timer fired between frames that took seconds); without that the old figure would be
about 4.0 s (foreground) / 2.0 s (plain). (**) From the first frames of the warm-up, CPU not slowed; the level-0
run was made for the two foreground cases only. Worst frames while moving: 1.0-1.6x the median after the change.
- One light pass (Oxbow, foreground): full 4.1 s, quick (1024) 1.35-1.45 s, level 3 (256) 0.11 s. Light passes run
  never exceed frames drawn: the newest sun replaces a waiting one.
- Nothing waiting for the graphics (as on a phone), Oxbow with the foreground: slider dragged 5 s (a sun every
  50 ms): before, 19 frames + 20 light passes were queued and the picture was 86 s behind when the thumb stopped;
  now 7 frames, each with its light pass, 0.01 s behind. View dragged 3 s: before 21 frames queued, 55 s behind;
  now 6 frames, 0.2 s behind (at level 0: 2 frames, 1 s = one frame behind).
- Idle: 0 frames drawn in 2 s, before and after. Draw calls a frame: 5 -> 33-36 (one per run of blocks).
- Still picture, before vs after (three views each: aimed, low sun at 75 mm, turned + walked 30 m; 856,960 pixels):
  plain view 0 pixels differ; with the foreground 35 / 12 / 1 (Oxbow) and 0 / 0 / 1 (Cunningham), all on tree
  points, largest step 12 of 255 (the points are now stored in mixed order so a share of them thins every tree
  evenly); full screen at Oxbow (1,318,400 pixels) 36 / 11 / 10, eight of those ten by more than 8 of 255. First / last light, `state`, `eye`, `look` messages identical; one `state` fewer at start-up where two
  light changes waiting for the graphics became one frame.
- Offline: set offline with every request refused BEFORE `done()`, then foreground build, drag, slider, walk, lens,
  ice, home: 0 requests, 0 fetch / XHR / WebSocket / beacon / image loads from the page, 0 errors, 44 frames drawn.
  The page source has no network call and no outside script, style or font.

**Only a phone can tell:** the real frame times and which level it settles on (the Smoothness line); whether the
fence is timed finer than a screen refresh in Android's web view (if not, a healthy phone reads ~17 ms and the
governor never steps back up after a hitch); whether the change of canvas size when a movement starts and ends
shows as a flicker; what 4x anti-aliasing costs there (60% of a frame on software graphics, cannot be switched while
moving without drawing to an own target: not done); heat after minutes of use. Not touched: the HD (Google) page.

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

## Faroes foreground in the app page (13 Nov 2026, branch `claude/sun3d-faroes-page`)

The round 2 Faroes data (`build_detail_faroes.py`) drawn by `app_view.js` itself. Data per detail box: heights (ground
and flat water only), mask (0 ground, 3 sea / lake, 4 stream), an aerial photo (`color_path`, JPEG, north up on the
box's lat / lng grid) and building outlines (`buildings_path`, JSON, heights assumed); per 4 m fine box a photo
(`terrain_near_regions.color_path`). Rows and columns: migration `20261113010000_terrain_faroes_colour.sql` (144 files
in bucket `terrain`, 31 MB).

- Panel / `services/terrain.ts`: the photos and the building file are foreground files like the others (saved ahead by
  `saveTripTerrain`, counted in "N of M areas", sent after `ready` as chunks `color`, `bld`, `ncolor`; `detail.width` /
  `depth` = the box's metres). A fine box with a photo and no detail box still gets its photo. Credit line under the
  view whenever the page says `foreground {colour: true}`.
- Page: the light passes of the photo meshes (`PHOTO`) give light only; the mesh multiplies it with the photo (photo
  colours count as seen, albedo = photo^1.613, the same scale as the plain grass). Faces over ~44-56 deg are rock in
  beds (colour from the photo's mean over land), sea / lakes are water, a stream (mask 4) over steep ground or just
  under a stream cell uphill is a white fall, grass tufts within 30 m of the eye. The detail photo eases into the fine
  box's photo over 4-44 m from its edge. The wide grid's grass is tinted toward the photo's mean colour (`FTINT`).
  Houses: one mesh, outlines stood up from 1 m under the foot, gable roofs along `a`; their heights over the ground
  (`bmap`, 0.2 m steps) cast the drawn shadows (`BSHADOW`) while the light map's alpha stays ground-only (what the
  houses and the water read). `lit()` / first and last light never see photos or houses.
- Without the new files (every Teton view; a Faroes view whose rows have no photo) the page draws exactly as before.

Measured (scratchpad `faroes_page/`: `fr.js`, `fbench.js`, `cgm.sh`, `sheet.py`; headless Chromium, software graphics):
Teton Oxbow Bend plain and round 3 foreground, 135 and 75 mm: 0 pixels differ from the page before, same sun times.
Faroes, 8 proof views: first / last light identical with and without photos / houses, 0 network requests after load.
Drag, CPU 4x, level 3 (where the governor settles, as it does for the Teton foreground): plain 130-145 ms a frame,
detail box without colour 375-425, with photos and houses 500-600 (Teton foreground on the same bench: 326-451).
Whole test browser peak, Saksun: plain 453 MB, detail only 484, photos + houses 523.
Not fixed: the Faroes heights read ~3.3 m low against the agency's contours (uniform: no sun time changes).

## Grand Teton in real winter colour (13 Nov 2026, branch `claude/sun3d-teton-colour`)

The Teton view was all calculated colour (white snow, grey rock on steep faces, a guessed forest band, dark tree
dots). Now its ground colour comes from a real winter day. Builder: `teton_colour/build_teton_colour.py`
(`wide | boxes | sql | all <work dir> [out.sql]`; `TRIP_Q` = a script that runs one SQL string and prints JSON rows,
`LIDAR_DIRS` = where the laser masks are, else the public bucket; everything downloaded is cached, a rerun is free).

- Wide grid (`terrain_regions.color_path`, 2048 x 2048, ~27 m, 1.6 MB): Copernicus Sentinel-2 L2A, tile 12TWP, 30 Dec
  2025 18:32 UTC (11:32 AM MST, sun 22 deg up; the trip's own date a year early), filled from 11 Jan 2026 where the
  30 Dec pass had no data (the swath edge cuts the south-east corner) or its scene classes say cloud (Jackson Lake's
  north end): 73 % / 27 %. Read straight from the COGs on AWS with HTTP range requests (no GDAL). The day's light is
  taken out: each pixel is divided by the light it had then (sky by how much sky a slope sees, sun by its angle and a
  march toward the sun for ridge shadows, from our own heights); snow is decided by the snow index (green vs
  short-wave infrared, so snow in shade still counts) times how bright the green band is once the light is out, and
  drawn as the page's own snow colour; forest, rock and water keep their own colour, a little greyed. 4096 was built
  and measured first: +142 MB of test-browser memory over 2048 for detail a phone screen cannot show.
- Fine boxes (8 `gt_*`, `terrain_near_regions.color_path`, at the box's own cell size, 50-530 KB) and laser boxes
  (19 `gtd_*`, `terrain_detail_regions.color_path`, 0.5 m, 33-160 KB): USDA NAIP (USGS ImageServer, 0.6 m, 19 Jul 2022,
  red / green / blue / near infrared) turned to winter. How snow is decided: the ground is snow wherever the 30 Dec
  picture's snow index says snow at that spot (10-20 m), whatever the summer photo shows; that was the whole valley
  floor and the forest floor on that day (every laser box comes out 100 % snow on open ground, Swan Lake 78 %: the lake
  edge). Where it says bare, the photo shows through (dormant grass tan-grey, rock and gravel greyed, paved darker).
  Snow keeps +-6 % of the photo's own brightness pattern (sage, ruts), never its colour. In a fine box the photo's dark
  green crowns stay dark green (conifers; readier where the winter picture is dark too), other leafy green becomes a
  grey-brown haze of bare twigs, and summer water is frozen (white) or open (dark) as the winter picture says. In a
  laser box the survey's own trees are drawn by the page as points, so the ground under them is only a shade darker,
  and the page keeps drawing its own water / ice and boards.
- Page (`app_view.js`): where the ground is snow (`cfg.ground !== 'green'`) the three files are ALBEDO (`APHOTO`):
  sampled in the light passes in place of the calculated colours, so each light map still holds colour x light and
  everything downstream (the blend into the next mesh, water, trees, the light-only Faroes path) is untouched. A grid
  without its own file uses the next coarser one through a uv rectangle (laser box -> fine box -> wide). Faces steeper
  than ~50 deg turn to rock (a 10 m picture from above sees only a cliff's snowy ledges). A wide file finer than the
  light map (4096) also gets its own detail back on the wide mesh (`WDET`); not used at 2048. All three are foreground
  files: chunk `wcolor` (new; a foreground on its own) and the existing `ncolor` / `color`, sent after `ready`.
- Panel / `services/terrain.ts`: `regionColor(r)`, the wide file saved ahead with the region (`saveTripTerrain`), sent
  as `wcolor`; credit line from `terrain_regions.color_credit`. Migration `20261113020000_terrain_teton_colour.sql`
  (28 files, 5.2 MB; NOT uploaded or applied: ship it with this app code, an older app would draw the box files the
  Faroes way).

Measured (scratchpad `teton_colour/test`: `tc.js` pictures and times, `bench_c.js` = the smoothness bench with colour,
headless Chromium, software graphics): Teton with the foreground and no colour, Teton plain, and three Faroes views
with photos and houses: 0 pixels differ from the page before. First / last light identical with and without colour
(six stops, 30 Dec). No network request after load. Smoothness at CPU 4x, phone size (governor at level 3), Oxbow
with the foreground, the shipped 2048 file: drag 480 -> 481 ms a frame, time slider 609 -> 605, walk 439 -> 453, the
sharp frame after each the same (the colour is in the light map, the meshes draw as before); with the 4096 file and
`WDET`: Oxbow drag 472 -> 478, Snake River Overlook 404 -> 425, full light pass Snake 3.29 -> 3.64 s (software
graphics). Whole test browser peak, Oxbow with the foreground: 418 MB without colour, 477 MB with the shipped files
(2048 wide), 636 MB with the 4096 wide file. Foreground in ~3 s instead of ~0.3 s on software graphics (decoding three
JPEGs). Picture sheet: scratchpad `teton_colour/_teton_colour.png` (`test/sheet.py`; the view from above is the wide
light map read back from the page). Still wrong: the stand pins at Oxbow Bend and Snake River Overlook look through
trees (known pin issue), Jackson Lake's north end is from 11 Jan (cloud on 30 Dec) and shows patchy open water, the
laser boxes gain little (all snow that day: only a faint texture), roads read white (the 30 Dec picture shows them
snow-packed; Teton Park Road is closed), no snow on the conifers' crowns beyond 10 %.

## Park-wide trees, Grand Teton (13 Nov 2026, branch `claude/sun3d-trees-wide`; NOT uploaded or applied)

Phil: forests should show at any distance and around any spot, not only in the 500 m laser boxes, without slowing the
view down or breaking it.

- Data (`lidar/build_canopy.py grid | check | tiles`): the same 2022 survey (USGS 3DEP lidar `WY_GrandTetonNP_1_D22`,
  public domain), read only down to octree depth 7 (one point per ~4 m voxel: 165 M points, 6,467 nodes, ~1.9 GB of
  LAZ, cached in the laser build's cache dir). Grid = the wide Teton grid's box cut into 10 x 10 tiles of 0.05 x 0.068
  deg (~5.6 x 5.5 km), 800 x 800 cells each (6.95 x 6.84 m). Per cell: the ground (mean of class 2, holes filled), and
  the highest non-ground / building / water return's height over the ground AT ITS OWN SPOT (bilinear ground: the cell
  mean put every steep slope 'up'). A tree = at least 4 m, at least two high returns, at least half of them from
  pulses that went on to more returns (crowns let the laser through, rock faces and roofs mostly do not), ground at
  most 3,300 m (tree line) and at most 55 deg steep (cliffs: the survey's ground class is thin there). Two files a tile
  (8-bit PNG, 0 = no tree): lod 0 every cell, canopy height in 2 m steps (51 files, 4.98 MB); lod 1 two by two cells in
  one, (tree cells - 1) x 64 + tallest height / 2 m (51 files, 1.86 MB). A stand spot gets lod 0 for tiles within 3 km
  and lod 1 out to 12 km. Outside the survey (Wilson: Emily's Pond Levee, Teton Pines; the east of the grid) there is
  nothing: no other source was used.
- Data check against the 19 laser boxes (0.5 m class masks, 97,779 coarse cells inside them; a coarse cell is 'tree'
  on the fine side when 15 % of it is tree cells at >= 4 m): agree 96.1 %; of the fine trees the coarse layer has
  95.5 %, of its trees 88.4 % are the fine side's (the rest: 2,399 cells at a crown's edge, 237 by a building, 159
  nothing); canopy height (2 m steps, coarse - fine 95th percentile) median +0.2 m, mean |error| 1.2 m, 90 % within 2.6 m.
- Page (`app_view.js`, 'park-wide trees'): `fore({ canopy: { tiles } })` + chunks `canopy:<i>` (60,000 characters a
  piece, packed as soon as the next tile starts); built LAST, 1.5 s after the rest of the foreground has posted
  `foreground`, on its own (`wideTrees` {ok, trees, ...}; a failure, or 30 s, leaves them out and nothing else). One
  pass over the files: every tree cell within 12 km, kept with chance (d0 / distance)^2 (all within d0), each kept one
  drawn wider for the cells it stands for (up to 5 x its height: a clump of spruce tips), ~60,000 in all (d0 is set to
  fill that: 250 m in thick forest to 1.2 km over open flats; 20,000 and 5 km on a phone with 2 GB or less). None
  inside the laser box (its own trees are there; the box's blend strip gets these). Each tree is ONE point: the
  square's foot on the ground the meshes draw (the wide mesh's own triangles, the fine mesh's blend), a spruce outline
  cut out in the fragment shader, the sun its ground gets from the hills (the far and fine light passes now write that
  visibility into alpha, which nothing read before: colours unchanged), the same winter colours as the laser trees.
  Sorted into 16 x 16 blocks of 1.5 km: a frame draws the blocks in view; quality levels draw 100 / 75 / 40 / 0 % of
  them while moving; none bigger than the phone's largest point (they would float). Never in `lit()` / first and
  last light.
- Panel / `services/terrain.ts`: table `terrain_tree_tiles` (migration `20261113050000_terrain_trees_wide.sql`, NOT
  applied; files NOT uploaded: scratchpad `trees_wide/files/upload.txt`), `treeTilesFor(region, stand)`, sent with the
  foreground (last), each tile one area in the trip's "3D terrain saved" count, saved ahead with the trip. Foreground
  off = no trees (the page restarts without the foreground); light phones as above; About gets one line.

Measured (scratchpad `trees_wide/test`: `tw.js` pictures / times / network, `fbench.js` per-level frame cost, `bench_w.js`
= the smoothness bench, `rbench.js` time to the first picture, `cgm2.sh` whole-browser memory; headless Chromium,
software graphics, CPU 4x where timed; before = the page on `ccr-dba965ff-afy6cz` with today's foreground):
first picture 495 -> 508 ms median (20 interleaved loads each, means 500 / 498); frame time at each quality level the
trees are drawn at (0-2, one-step drags, 7 frames each, five stops) -2 % to +8.6 %, sharp frames -0.5 % to +6 %; the
governed bench (level 3 here, trees hidden while moving) mean +0.8 %, single runs -7 % to +15 % (run-to-run noise is
about +-10 %); whole-browser peak (median of 3) +1 / -2 / +5 / +16 / -40 MB at Oxbow / Snake River / Cunningham / Jenny
Lake highlands bridge / Emily's Pond; first / last light and the in-the-sun line identical on all 33 Teton shots;
without the layer every picture is pixel-identical (7 views); with every request refused, 0 requests and the trees
drawn; a broken tile drops only the trees ("wideTrees" ok false), a phone with 2 GB gets 18,700 trees out to 5 km, a
new shot 1.4 km away gets its trees built again (~0.15 s here). Memory was the hard part: the first build (one 12 km
set of every-cell files, two unpacking passes) was +56 to +84 MB at the forest stops; it came down with the coarse
far files, 2 m steps, one pass, small text pieces and the 1.5 s wait. Sheet: scratchpad `trees_wide/trees_wide_sheet.png`.

## Sharp Grand Teton (14 Nov 2026, branch `claude/sun3d-sharp-range`): range level, 1.5 km laser boxes, park-wide buildings

Built, measured, NOT uploaded or applied. Three parts, each a stage of its own on the page after `ready` (range first,
then the foreground, then the buildings, then the park-wide trees); a failure in one leaves only that one out.

### 1. The range: a fourth terrain level (`build_range.py`)

The peaks 10-25 km from the stand pins came from the wide grid (terrarium zoom 12, ~27 m a point) drawn by a mesh of
768 points over 55 km (~71 m a point): soft at 135-300 mm, and 5-70 m low on the summits.

- Source: USGS 3DEP 1 m lidar DEM, `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/WY_GrandTetonNP_D22`
  (2022; then `WY_GrandTetonElkRefuge_2014`; then the 1/3 arc-second DEM, ~10 m, west of the crest), cloud-optimised
  GeoTIFFs in UTM 12N with overviews: only the 2 m overview's 512 x 512 blocks under a box are read (HTTP ranges, kept in
  `<work>/tnm`, ~300 MB for the five boxes). Bare earth (above tree line = rock and snow; trees never in the heights).
- DATA CHECK (`check`), published NAVD88 heights within 450 m: Grand 4197.6 (4199), Middle Teton 3901.8 (3903), Mount
  Owen 3939.4 (3940), Mount Moran 3843.4 (3842), Teewinot 3753.9 (3757), South Teton 3813.6 (3814): all within 3.1 m;
  the wide grid is 5-70 m low on the same summits. The 26 stops' stored heights inside the 1 m data: middle +1.8 m, 100 %
  within 25 m. Against the wide grid over each box: middle -0.3 to 0.0 m, 9 in 10 within 4-8 m. PASS.
- Boxes: 2048 x 2048 at 5 m (10.24 km), on a lattice of centres every 5.12 km (half a box) so shots share them; a shot's
  box = the lattice centre nearest its subject moved 1.5 km toward the stand pin (the face, canyons and lake-front
  moraines are east of the summits), only where the wide grid has mountain (over 2,600 m) within 3 km. Grand Teton
  trip: 4 boxes (`gtr_01_01` Rendezvous / Teton Pines, `gtr_02_02` south peaks, `gtr_03_02` Grand / Jenny Lake 18 shots,
  `gtr_05_02` Moran 3 shots), 3.5-3.8 MB each, 14.7 MB. 3 shots have no range box (subject close, range not where they look).
  `gtr_00_01` (JHMR) was built only to score the webcam events below.
- The page (`app_view.js`, `cfg.range` + chunk `'range'`, sent first in the foreground): heights and its own light map
  (2048, a light pass marching in it and on into the wide grid); its mesh is every other point of the shared 768 grid
  (384 a side) bunched at the subject (`wk` 0.2: ~5 m spacing at the peak, ~70 m at the box edge, where it fades into the
  wide grid); the wide mesh is cut out under it (RHOLE; its blocks wholly inside are not drawn at all) and the fine box's
  edge fades into it (RNG). It FEEDS the sun times: `pick()` reads it where it holds a pin, `vis()` steps down into it from
  the wide grid (steps capped at 12 m there), the subject's summit snap is ~100 m on it. Light phones (deviceMemory <= 2):
  every other point (10 m). A full 768 mesh doubled a frame's time on software graphics; 384 looks the same.

### 2. 1.5 km laser boxes (`lidar/build_detail.py --side 1504 --cell 1 --max-depth 10 --no-buildings`)

Each stop's laser box is now 1504 m at 1 m (was ~500 m at 0.5 m), moved (not shrunk) to sit inside the fine box its
shots use; stand pins within 650 m share one: 16 boxes (Emily's Pond and Teton Pines are outside the survey), same five
files a box (heights, mask, tree returns, wide water, winter colour from `teton_colour/build_teton_colour.py boxes`),
42.8 MB. Buildings are LEFT OUT of these heights (`--no-buildings`: ground under them, no building class in the mask):
the park-wide buildings draw them, once. Read to octree depth 10 (~15 points a 1 m cell). The page: the box's own dot
trees only within 260 m of the eye (`TREE_REACH`; beyond, the park-wide spruce outlines, which read as trees from afar
where dots read as blobs); its full light map capped at 1024 (1.5 m). Table `terrain_detail_regions_v4` (a table of its
own: the app already on phones reads `terrain_detail_regions` and would lose its buildings), ids `gtd15_*`, `bare` true.

### 3. Park-wide buildings (`lidar/build_buildings.py`)

No footprint source answers from here (OpenStreetMap Overpass and Microsoft's US footprints are refused by the proxy),
so they come from the laser survey alone, inside the survey (none in Wilson / Teton Pines / Jackson).
- `scan`: the survey to octree depth 8 (~2 m) over the wide box, every raised return (2 m+ over the park-wide ground grid);
  195 M points read, 70 M kept, 23 min.
- `build`: roof-like points (class 6, or a pulse that came back alone) on a 2 m grid -> patches; a patch the survey did
  not sort is a roof only when at most 35 % of the pulses in its cells gave several returns (crowns let the laser through)
  and a roof fits it to 0.4 m; within 4 km of a stand pin (`--pins`, `--refine-km`) every candidate is looked at again on
  the depth-9 points (~1 m: 9,025 nodes, 15 min), small ones (2-4 points at depth 8) included; footprint = the cells in the
  frame of its long walls, closed, a rectangle when that covers 85 %, else right-angled corners (<= 12); roof = the better
  of a gable along either axis or flat (pitch under 8 deg = flat), eave / ridge measured. 8,964 buildings in 48 tiles,
  1.47 MB (a trip's 40 tiles within 8 km: 1.1 MB). Checked against the round-3 boxes' surveyed building cells (0.5 m, full
  density): 47 of 89 buildings over 20 m2 found (53 %; T.A. Moulton 7 of 7, John Moulton 4 of 5, Chapel 21 of 34,
  Menor's Ferry 7 of 17, Cunningham 1 of 1), 17 found where the survey has none (mostly trailers / sheds it left as
  vegetation). Missed: small sheds, buildings under trees, outside 4 km the depth-8 shapes only.
- Tile file (`gtb_<row>_<col>.json`): `{v, box, b: [{p, g, e, r, a, hw, roof, c, n6, id}]}` (README of the script).
- The page (`cfg.houses` + chunks `'house:<i>'`, after the foreground): every building within 8 km as walls + roof (snow on
  roofs under ~48 deg where the ground is snow), standing on the ground as drawn (detail / fine / range / wide), lit by the
  sun its ground gets from the hills (the finest light map's alpha); inside a bare detail box they throw a drawn shadow
  (BSHADOW). NEVER in the sun times. An older (non-bare) detail box keeps its own buildings: none drawn twice.
- Height-field blocks vs walls and roofs (the before / after renders): the walls and roofs read as buildings (straight
  walls, a ridge); the old height-field blocks melt into the snow. Walls and roofs it is.

### Measured (scratchpad `sharp/`; headless Chromium, software graphics; harness `sharp/test/rv.js` = the panel's order)

- Phone space for the Grand Teton trip (what `saveTripTerrain` now saves, offline): range 4 boxes 14.7 MB, laser boxes 16 x
  1.5 km 42.8 MB, building tiles 40 of 48 (8 km of a pin) 1.35 MB = 58.9 MB new; the 19 old 500 m boxes (15.3 MB) are no
  longer picked: net +43.6 MB. All files to upload: 131, 59.0 MB (`sharp/upload/upload.txt`, sha256 each).
- With none of the new data the new page draws exactly the old picture (0 of 240,000 pixels differ, Oxbow Bend plain view).
- Frame time while dragging (full quality fixed, governor off, phone-size 412 x 800 view, software graphics, two
  interleaved rounds, while another render job ran): Snake River Overlook 1102 / 1138 -> 1226 / 1356 ms, Oxbow Bend
  1192 / 1124 -> 1261 / (2301, one noisy run), Moulton barns 1263 / 1345 -> 1472 / 1606 ms: about +10-20 % a frame at
  full quality, before the governor steps down. The range's mesh at all 768 points had doubled it (1885 vs 965 ms): it now
  draws every other point (384, bunched at the subject), and the wide mesh's blocks under its box are not drawn.
- First picture (`ready`, 26 shots, 1200 x 800): median 642 -> 706 ms (the plain view is unchanged; the range comes after
  it). The range is in ~340 ms after it is handed over (238-638 ms, page's own count). The foreground's own time: 4.6 s
  -> 9.4 s on Snake River Overlook measured alone (the gap is the software-graphics frames drawn while the page waits
  for its photo decoders; the 1.5 km box's photo is read at 1024 px), 5.4 s -> 20 s median in the 26-shot run, which
  shared the machine with another render job. Buildings: 125 ms median (15-404), 554 drawn median (5 at Emily's Pond,
  3,887 at Taggart: Jenny Lake's and Colter Bay's cabins within 8 km).
- Memory, 26 shots each: JS heap peak median 72 -> 129 MB (+53 per shot, +5 to +88), whole test browser RSS peak median
  844 -> 970 MB (+122 per shot, +9 to +164). The range's own heights stay in memory for the sun times (16 MB of
  Float32 for 2048^2) and the 1.5 km box is 2.3 x the 500 m one; on a phone with 2 GB or less both read every other
  point (range 1024^2 at 10 m, box 752^2 at 2 m).
- No network: all 26 shots with every request refused: 0 requests, range (23 shots that have one), foreground, buildings
  and trees all drawn, no page error.
- Sun times, 26 shots, 4-minute steps (`sharp/out/changes.md`): stand spots move at most one step (+-4 min) on 6 shots;
  subjects' last light moves on 8: Chapel 08:40 -> 08:08, Jenny Lake 09:00 -> 08:40, John Moulton (subject on the face
  under Nez Perce) 16:56 -> 13:52, John Moulton 2 12:56 -> 12:40, Snake River Overlook x2 13:52 -> 13:40, Teton Point
  09:20 -> 09:08, Teton Pines first light 10:16 -> 10:24. All are subject pins on faces and in bowls: the 5 m grid has the
  real ridges (the wide grid is 5-70 m low on the summits and smooth), so a face goes into shade earlier. No picture
  checks these pins; the webcam events below did not move. (A bug found on the way: from a 1.5 km box the sun check's
  440 steps ran out before the ray reached the range, so stand spots came out lit until sunset; it now takes up to 2000.)
- Webcam sun events (`suncheck/score_rules.js` rule D, re-scored with the range where it holds the ray,
  `sharp/score/score_range.js`, a range box over JHMR built for this only): high-point sunrise / sunset 9 of 12 inside the
  picture window before and after (average +0.3 -> +0.0 min, typical 4.0 -> 4.5), ridge-blocked 4 of 4 before and after
  (+2.0 -> +2.5 min). No change beyond a minute on any of the 16 events.
