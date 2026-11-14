# Faroes 3D terrain (TEST app's 3D sun view)

Current builder: `build_faroes_2015.py` (14 Nov 2026), every level from the Faroese Environment Agency's 2015 surface model.
Earlier rounds (`build_detail_faroes.py`, ArcticDEM v4.1 + guessed house heights; `../build_dem_arctic.py`, `../build_faroes.sh`)
are kept for the record; their photo, coastline, lake and stream code is imported by the new builder.

## Source

`FO_DSM_2015_FOTM_2M.tif`: Umhvørvisstovan (Faroese Environment Agency), DSM 2015, 2 m, float32, 57,644 rows x 39,233 columns,
128 x 128 deflate tiles, ETRS89 / Faroe TM (EPSG:5316), pixel is area, nodata 3.4e38 = sea. From
`cdn.foroyakort.fo/geodata/raster/` (a manual download: that site turns scripted requests away; do not disguise requests).
Credit: "Data from the Faroese Environment Agency, Umhvørvisstovan (DSM 2015)". Never loaded whole (9 GB as float32):
`dsm2015.DSM` decodes the tiles a window needs.

What the file is like (measured 14 Nov 2026):
- Heights: -0.4 to +0.6 m from the agency's 2009 contours on gentle ground in 5 areas (ArcticDEM read ~3.3 m low).
  Slættaratindur 879.9 m (published 880 m). Sea stacks are there (ArcticDEM had no Risin og Kellingin).
- It is NOT a sharp 2 m surface: about 15-16 % of all rows and columns are exact copies of the one before (a nearest-cell
  resampling from a grid of ~2.35 m), with bands of a 2-3 cell zig-zag (+-0.1-0.3 m) that a low sun turns into stripes.
  Buildings are smoothed nearly away: a church reads ~1.5 m above its yard, town houses under a metre. So house heights
  can rarely be measured in it (see houses below).
- Faults, all islands (step `clean`): land holes (nodata inside the coastline), water holes inside the coastline
  (lagoons such as Saksun's Pollurin, harbour basins, river mouths), and floating blunder patches (e.g. 830 m blobs on a
  170 m slope at 62.2717,-6.9228; a 933 m one on the coast at 62.0136,-6.9172). Counts in `clean/report.json`.

## Steps (`python3 build_faroes_2015.py <step> <work> --dsm <tif> [--pins shots.json] [--jobs 4]`, or `all`)

1. `clean`: whole islands in 2,048-cell windows. Blunders = parts of the surface joined to the rest only across steps of
   more than 30 m between neighbouring cells (graph components), of at most 2 ha, 30 m or more off the ground round them
   (or above 885 m), and NOT backed by the 2009 10 m contours (a stack is: its contours ring it); and every cell more
   than 80 m above every 2009 10 m contour point within 60 m (or below every one), where there are any, in pieces of at
   most 2,500 cells (bigger ones are great sea cliffs the two surveys place a little differently): the file has
   smooth blunder 'cones' that climb from the ground in steps of under 30 m (933 m on a 50 m shore at 62.0136,-6.9172,
   280 m in Funningsfjørður at 62.2839,-6.9186). A stack with no contour near it is left alone. Land holes and blunders
   are filled from the agency's 2009 contour lines (`haeddarkurvar/us_haeddarkurvar_2009_2m`, layer 0 = 10 m for this
   pass, layer 4 = 2 m for the boxes) plus the hole's rim, linear between them; never ArcticDEM. A hole that fills to
   sea level (median at most 2 m) with a low rim is water and lies flat at its rim's level. Lakes (topo 120 / 119) flat.
   Every building outline (bygningar 0 and 1) plus a cell is filled from the ground round it: the levels are BARE ground,
   the houses come from the house tiles (drawn once). Writes `clean/agg16.npz` (16 m blocks) and `clean/report.json`.
2. `wide`: `faroes_dsm15_wide.png`, the region's 2048 x 2048 grid (same box as before), block means with sea at 0; a cell
   whose highest block is the highest of its 3 x 3 keeps that height (summits and stacks are not averaged away).
3. `plan` (`plan_2015.py`, the app's own picks copied from `src/services/terrain.ts`): range boxes (2 m, 4,096 m) with
   every shot's subject at least 1 km inside (pickRange) and the stand pin too where the two fit; the existing 11 fine
   boxes (their aerial photos stay valid) + a new one where none holds a stand pin (Klakkur); close-up boxes of 1,504 m
   at 1 m inside the shot's fine box, stand pin at least 150 m in, the subject in where it is within reach.
4. `range`, `near`, `detail`: each box's window cleaned as above with the 2 m contours, smoothed lightly (Gaussian, one
   cell, land only: the coast stays sharp), resampled onto the box's lat / lng grid (bilinear; cubic clamped to the four
   cells round each point for the 1 m boxes, so no overshoot at a cliff), then every native top that the smoothing would
   shave by more than 0.5 m pushed back into its cell. Detail boxes also get the class mask (0 ground, 3 sea / lake /
   lagoon, 4 stream) and the aerial photo exactly as round 2. Rows in `levels.json`, files in `files/`.
5. `houses`, `housefiles`: every building outline of the islands (bygningar layers 0 and 1, status in use) in tiles of
   4.8 x 4.4 km (`fob15_<row>_<col>.json`, the `terrain_house_tiles` format: outline `p` in metres from the tile's
   north-west corner, `e` / `r` eave and ridge above the ground, ridge direction `a`, `hw`, `roof`, `c`; plus `h` =
   `assumed` | `dsm` and `rc` / `wc` = roof and wall colour as seen from the air where a box photo covers it). The 2015 file
   cannot give house heights (its fitted ridges are 2.5 m at the median; churches read 2-5 m over their yards), so the
   round 2 guesses stay (house 2.6 / 4.4 m, shed 1.9 / 2.6, hall 4 / 6, church 4.8 / 8, roofs at most 40 degrees) and the
   DSM's fit is used only where it is clearly higher than the guess (big sheds, blocks of flats). The topo map's
   church `roof_elevation` was checked and is not a roof top (Vesturkirkjan's 46 m reads like its base + 4 m). Drawn within
   8 km of the stand pin, never in the sun times.
6. `sql`: `terrain_faroes_2015.sql` (or `--migration <path>`) and `upload.txt` (published name, local file, bytes).

Shots file: the read-only query in `../README.md`'s Faroes section (stops -> stop_sun_pairs -> scout_vantages /
scout_subjects for both Faroes trips), saved as JSON (`shots_all.json`).

Needs: numpy, scipy, pillow, tifffile, imagecodecs, pyproj; curl; the agency's server (`gis.us.fo`, plain requests,
answers kept in `<work>/cache`). A first run takes about 1.5 hours on 4 cores (clean ~5 min; each box ~1 min).

## First build (14 Nov 2026, branch `claude/sun3d-faroes-2015`; nothing uploaded or applied)

- Cleaning, whole islands: 2,672 land holes (399,837 cells = 1.6 km2; e.g. 10,028 cells on a Kunoy cliff at
  62.3555,-6.7058, filled 0-139 m from 1,485 contour points) filled from the 2009 contours; 2,993 water holes (722,790
  cells: Saksun's Pollurin, Tórshavn harbour, Skálafjørður shores) laid flat at their rim (0.1-1.5 m); 687 blunder pieces
  (14,190 cells): 606 by the jump test (the worst 307 cells at 832 m on a 187 m slope, 62.2717,-6.9230) and 81 by the
  contour envelope (11,143 cells; the 933 m cone at Velbastaður's shore, the 280 m one in Funningsfjørður, and pieces of
  NW Streymoy's sea cliffs near Mýlingur that look like triangulated fills, up to 2,006 cells). After cleaning the
  islands' top is Slættaratindur 879.9 m. Report: `<work>/clean/report.json`; per box: `levels.json` `cleaned`.
- Wide: `faroes_dsm15_wide.png` 0.86 MB (was 0.78). Range: 33 boxes, 43.1 MB. Near: the 11 boxes at 2048 cells (1.9-4.4 m)
  + `fo_klakkur`, 22.2 MB + one new photo (0.5 MB). Detail: 36 boxes of 1,504 m at 1 m, 33.4 MB with masks and photos.
  Houses: 93 tiles, 31,761 buildings, 6.6 MB. All 248 files 106.6 MB; one Faroes trip downloads 111 MB (was 37 MB).
- Every one of the 57 rated shots (both trips use the same vantage rows) has a near box, a detail box (stand pin at
  least 167 m inside) and a range box with its subject at least 1 km inside; the stand pin is inside its range box for
  50 (the 7 others have their subject 3.5-6.8 km off); the subject is inside the detail box for 41.
- Stacks (DSM top / drawn top on the wide, near, detail and range grids; before = ArcticDEM): Risin 67.4 m (all
  levels 67.4-67.5; before 0, it was missing), Kellingin 56.6 (before 0), Stóri Drangur 66.4 (before 49.5-49.7, wide 25),
  Lítli Drangur 28.1 (near / detail / range 28.1; the wide grid 10 m: it shares a cell with Stóri Drangur), Tindhólmur
  255.2 (before 44-89), Slættaratindur 879.9 (wide 876.5). Published heights: Risin 71, Kellingin 68, Tindhólmur 262 m.
- First / last sun, 74 shot-days, today's files vs these (the page's own 4-minute path, headless): within 4 minutes for
  55 / 42 / 67 / 67 of first-subject / last-subject / first-here / last-here; 44 shot-days change by 8 minutes or more,
  nearly all where the old data lacked or flattened the thing that throws or catches the light (Tindhólmur 89 -> 255 m
  lights from ~05:40 instead of ~07:15; the Drangarnir landing shots' cliff; Mýlingur; Risin og Kellingin). List:
  scratchpad `fo2015/work/sun_changes.txt` (made by `suncmp.py`).
- Speed and memory (headless Chromium, software graphics, CPU slowed 4x, 4 views): ready (plain view) 0.6-0.9 s both;
  foreground in 6-9 s both; a full-quality redraw 1.4-2.6 s median both (no measurable change); JS heap 99-118 MB with
  the range box and houses (was 54-87), 222 MB at Tórshavn / Kirkjubøur / Velbastaður where ~10,000 buildings are within
  8 km (was 64-87): the houses are the heaviest new part (the page builds them in plain JS arrays). Not measured on a phone.
