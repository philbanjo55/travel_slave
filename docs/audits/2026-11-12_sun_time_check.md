# Sun check: the 3D sun view's "first / last direct sun" times against webcam pictures, Grand Teton

Measured 12 Nov 2026. Read-only: nothing written to the repo or the database. Times are Mountain Standard Time.

## Short answer

- **Sun blocked by a ridge or peak while it is still well up (3 to 16 degrees high): the model is right to within the pictures' resolution.** 15 measurements on 4 days: average error +0.5 min, average size 1.3 min, largest +4 min. The uncertainty of each is 3 to 7.5 min, so the honest statement is "within about 5 min, no bias seen".
- **Sunrise / sunset on a far horizon, seen from a high place: the model is 5 to 13 min off, always in the same direction** (first sun too late, last sun too early). 10 measurements on 4 days: average size 8.5 min, largest 13 min (window 8 to 18).
- **Sun setting behind a peak that sits on the horizon** (2 measurements): model 7 to 8 min early (window 2 to 13).
- For a photographer in the valley asking "when does this face lose the light because a ridge gets in the way", the first number is the guide: trust the model to about 5 min. For "when does the last alpenglow leave the Grand's summit", the second applies: the model stops about 10 min too soon (window 4 to 19).

## How it was measured

- `model.js` is a line-for-line port of the app's test (`decode`, `hB`, `vis`, `snap`, `lit`, `sunVec` from `tools/sun3d/app_view.js`, `sunPosition` from `src/utils/sunEngine.ts`), stepped every minute.
- 102 archived frames from three cameras on five clear days (19 Dec 2024, 27 and 28 Jan 2025, 14 Dec 2025, 18 Jan 2026), picked from `webcam_history_labels`.
- Camera positions in `webcam_cameras` are approximate, so each camera was first placed by matching the grid's skyline to the picture (`fit3.js`, `fitT.js`; see `pictures/7_tetonia_camera_fit.jpg`):
  - GT-JHMR-SUMMIT is on top of the tram, 43.5972, -110.8707, 3,185 m (table says 43.5958, -110.8475: 1.9 km off).
  - GT-JHMR-RENDEZVOUS is at the top of the gondola, about 43.6012, -110.8545, 2,770 m, good to about 60 m (table: 43.5935, -110.843: 1.3 km off). Its framing changed between the two winters.
  - GT-TETONIA sits near 43.762, -111.083 (table: 43.8135, -111.158: about 8 km off). Position along the line of sight is loose; the fit reproduces the skyline, Table Mountain and the foreground ridge to a few pixels.
- Three kinds of reading:
  1. **By eye, between two frames**: sun's disc visible or not, shadows on the snow or not. Error = model time minus the middle of the window; uncertainty = half the frame spacing (5 min resort cameras, 7.5 min Tetonia).
  2. **Shadow edge on the valley floor** (`match.py`): the model's sunlit map is drawn in the camera's own view (`render.js`) for every 2 minutes; the model minute whose sunlit / shaded pattern best matches the picture's warm / blue ground is compared with the frame's time. This is finer than the frame spacing; I put ±3 min on it (2-min steps, frame clock, classification). A different pixel filter moved results by at most 4 min.
  3. Model sunlit patches on Mount Owen and the Grand compared with Tetonia pictures side by side (`pair.py`).
- Frame clocks: the Roundshot file times were taken as true. One check (sun's direction in an 08:00 frame against landmarks) agrees to about ±3 min.

## Results

| Date | Kind | Event | Seen in pictures (MST) | Sun height then (deg) | Model | Model minus pictures (min) |
|---|---|---|---|---|---|---|
| 2024-12-19 | terrain-blocked | Gondola-top camera site loses the sun behind the Rendezvous Mtn ridge (1.3 km SW) | 15:30 - 15:40 | 9.6 | 15:35 | 0 ± 5 |
| 2025-01-27 | terrain-blocked | Gondola-top camera site loses the sun behind the ridge | 16:00 - 16:10 | 12.0 | 16:05 | 0 ± 5 |
| 2025-12-14 | terrain-blocked | Gondola-top camera site loses the sun behind the ridge | 15:30 - 15:40 | 9.5 | 15:33 | -2 ± 5 |
| 2026-01-18 | terrain-blocked | Gondola-top camera site loses the sun behind the ridge | 15:50 - 16:00 | 11.3 | 15:55 | 0 ± 5 |
| 2024-12-19 | terrain-blocked | Range's shadow edge on the valley floor, frame 16:00 | frame 16:00 | 6.4 | 16:02 (same shadow pattern) | +2 ± 3 |
| 2024-12-19 | terrain-blocked | Range's shadow edge on the valley floor, frame 16:10 | frame 16:10 | 5.0 | 16:10 (same shadow pattern) | 0 ± 3 |
| 2024-12-19 | terrain-blocked | Range's shadow edge on the valley floor, frame 16:20 | frame 16:20 | 3.6 | 16:20 (same shadow pattern) | 0 ± 3 |
| 2025-01-27 | terrain-blocked | Range's shadow edge on the valley floor, frame 16:40 | frame 16:40 | 6.9 | 16:42 (same shadow pattern) | +2 ± 3 |
| 2025-01-27 | terrain-blocked | Range's shadow edge on the valley floor, frame 16:50 | frame 16:50 | 5.4 | 16:52 (same shadow pattern) | +2 ± 3 |
| 2025-01-27 | terrain-blocked | Range's shadow edge on the valley floor, frame 17:00 | frame 17:00 | 3.9 | 17:04 (same shadow pattern) | +4 ± 3 |
| 2025-12-14 | terrain-blocked | Range's shadow edge on the valley floor (no snow), frame 16:00 | frame 16:00 | 6.1 | 15:58 (same shadow pattern) | -2 ± 3 |
| 2025-12-14 | terrain-blocked | Range's shadow edge on the valley floor (no snow), frame 16:10 | frame 16:10 | 4.8 | 16:08 (same shadow pattern) | -2 ± 3 |
| 2025-12-14 | terrain-blocked | Range's shadow edge on the valley floor (no snow), frame 16:20 | frame 16:20 | 3.4 | 16:20 (same shadow pattern) | 0 ± 3 |
| 2024-12-19 | terrain-blocked | Mount Owen's west side comes out of the Grand's shadow (seen from Idaho) | 14:30 - 14:45 | 15.9 | 14:41 | +3.5 ± 7.5 |
| 2025-12-14 | terrain-blocked | Mount Owen's west side comes out of the Grand's shadow (seen from Idaho) | 14:30 - 14:45 | 15.8 | 14:37 | -0.5 ± 7.5 |
| 2024-12-19 | peak on the horizon | Tram-top (3,185 m) last sun, setting behind Rendezvous Peak 4 km SW | 16:40 - 16:50 | 0.3 | 16:38 | -7 ± 5 |
| 2025-12-14 | peak on the horizon | Tram-top last sun, setting behind Rendezvous Peak | 16:40 - 16:50 | 0.1 | 16:37 | -8 ± 5 |
| 2024-12-19 | open horizon | Tram-top (3,185 m) first sun | 07:40 - 07:50 | -1.9 | 07:58 | +13 ± 5 |
| 2025-01-27 | open horizon | Tram-top first sun | 07:40 - 07:50 | -0.3 | 07:52 | +7 ± 5 |
| 2025-01-28 | open horizon | Tram-top first sun | 07:40 - 07:50 | -0.1 | 07:50 | +5 ± 5 |
| 2025-12-14 | open horizon | Tram-top first sun (cloud bank above a clear gap at the horizon) | 07:50 - 08:00 | 0.5 | 07:55 | 0 ± 5 |
| 2024-12-19 | open horizon | Gondola-top (2,770 m) first sun on the ground | 07:50 - 08:00 | 0.1 | 08:06 | +11 ± 5 |
| 2025-01-27 | open horizon | Gondola-top first sun on the ground | 07:40 - 07:50 | -0.3 | 07:56 | +11 ± 5 |
| 2025-01-27 | open horizon | Tram-top last sun (far horizon) | 17:30 - 17:40 | -1.7 | 17:26 | -9 ± 5 |
| 2025-01-28 | open horizon | Tram-top last sun (far horizon) | 17:30 - 17:40 | -1.5 | 17:28 | -7 ± 5 |
| 2025-01-27 | open horizon | Last direct light on the Grand Teton summit (seen from Idaho) | 17:30 - 17:45 | -2.3 | 17:26 | -11.5 ± 7.5 |
| 2025-01-28 | open horizon | Last direct light on the Grand Teton summit (seen from Idaho) | 17:30 - 17:45 | -2.0 | 17:27 | -10.5 ± 7.5 |


"Sun height then" is the app's own sun altitude at the middle of the observed window. A negative number in the open-horizon rows means the pictures show direct sun while the app says the sun is below the horizon.

| Group | Count | Average error | Average size | Largest (middle of window) | Worst case allowed by the windows |
|---|---|---|---|---|---|
| Terrain-blocked, sun 3 to 16 deg up | 15 | +0.5 min | 1.3 min | +4 min | about 11 min (Mount Owen, 15-min frames); 7 min for the others |
| Peak on the horizon, sun about 1 deg up | 2 | -7.5 min | 7.5 min | -8 min | -13 min |
| Far-horizon sunrise / sunset | 10 | first sun +7.8, last sun -9.5 | 8.5 min | +13 min | 18 to 19 min |

The nine valley-floor rows come from three evenings (three frames each), so they are not nine independent days.

## The expected weak spots

1. **No sun before the flat-horizon sunrise / after flat sunset: confirmed.** Tram top (3,185 m): sun still on the horizon at 17:30 on 27 and 28 Jan, model ends 17:26 / 17:28. Grand's summit: strong direct red light at 17:30 on both days, flat afterglow at 17:45, model ends 17:26 / 17:27. Morning the same way round: limb breaking the ridge in the 07:50 frame on 19 Dec, model 07:58.
2. **A second cause, not on the list, is as large: the model needs the whole disc well clear of the terrain.** `lit` asks for `vis > 0.5`, which is the sun's centre 0.57 deg above the skyline, and it uses the centre, not the top edge. First and last light really happen with the top edge at the skyline, 0.84 deg lower: about 4 to 7 min at winter sunrise and sunset. That is why the gondola top (first sun over a range 25 km away, inside the grid) is 11 min late and the tram-top sunset behind Rendezvous Peak 7 to 8 min early.
3. **Terrain outside the grid casts no shadow: not tested.** No clean event depended on it. The afternoon valley shadows come from the range crest inside the grid and match; the sunrise skyline from the resort is inside the grid (about 25 km out).
4. **Trees and buildings: not tested.** All three cameras look over open ground.
5. **27 m grid: no error seen at this precision.** The grid's skyline matches the gondola-top picture to about 0.4 deg for a ridge 1.3 km away, the ridge sunsets agree within the 10-min windows on all four days, and the lit patch on Mount Owen appears in the same 15-min step as in the pictures. The Grand's top is 4,183 m in the grid (real 4,199 m).

## Suggestions, smallest first

`variants.js` reruns the point events with each change.

| Place, date | Pictures | App rule now | B: top edge of the sun, hard edge | C: B + let a high point see over the horizon |
|---|---|---|---|---|
| Tram top first sun, 19 Dec 2024 | 07:40-07:50 | 07:58 | 07:54 | 07:54 |
| Tram top first sun, 27 Jan 2025 | 07:40-07:50 | 07:52 | 07:46 | 07:46 |
| Tram top first sun, 28 Jan 2025 | 07:40-07:50 | 07:50 | 07:45 | 07:45 |
| Tram top first sun, 14 Dec 2025 | 07:50-08:00 | 07:55 | 07:51 | 07:51 |
| Gondola top first sun, 19 Dec 2024 | 07:50-08:00 | 08:06 | 07:59 | 07:59 |
| Gondola top first sun, 27 Jan 2025 | 07:40-07:50 | 07:56 | 07:51 | 07:51 |
| Tram top last sun, 19 Dec 2024 | 16:40-16:50 | 16:38 | 16:48 | 16:48 |
| Tram top last sun, 14 Dec 2025 | 16:40-16:50 | 16:37 | 16:46 | 16:47 |
| Tram top last sun, 27 Jan 2025 | 17:30-17:40 | 17:26 | 17:27 | 17:32 |
| Tram top last sun, 28 Jan 2025 | 17:30-17:40 | 17:28 | 17:29 | 17:34 |
| Grand summit last light, 27 Jan 2025 | 17:30-17:45 | 17:26 | 17:27 | 17:34 |
| Grand summit last light, 28 Jan 2025 | 17:30-17:45 | 17:27 | 17:28 | 17:35 |
| Gondola top loses sun behind ridge, 19 Dec 2024 | 15:30-15:40 | 15:35 | 15:38 | 15:38 |
| same, 27 Jan 2025 | 16:00-16:10 | 16:05 | 16:10 | 16:10 |
| same, 14 Dec 2025 | 15:30-15:40 | 15:33 | 15:36 | 15:36 |
| same, 18 Jan 2026 | 15:50-16:00 | 15:55 | 15:59 | 15:59 |

1. **For the first / last minute only, test the sun's top edge against a hard skyline** (B: altitude + 0.27 deg, `vis > 0` instead of `> 0.5`). Inside the window: 6 of 12 sunrise / sunset rows instead of 1 now (plus one on the edge); one more misses by 1 min. Cost: the four ridge sunsets move 3 to 5 min later and land on the late edge of their windows (16:10 on 27 Jan is the frame that already shows no shadows). So do not go further than this, and a half-way setting (centre of the sun at the skyline) is equally consistent with the pictures; 10-min frames cannot separate them. Keep the soft edge for drawing.
2. **Let a high point see below the flat horizon** (C: sun allowed down to minus 0.95 deg x square root of the point's height above about 2,000 m, in km: 1.0 deg for the tram top, 1.4 deg for the Grand). With B this brings all four January sunsets inside their windows (10 of 12 rows in total): the tram top gains about 5 min, the Grand's summit about 7 to 8 min. The 2,000 m base level is my assumption, fitted to nothing; four evening rows support the size, no morning row tests it at the summit.
3. **Do not simply drop the `alt > 0` rule.** With the rule off and the grid as it is, the Grand stays "lit" until 17:21 on 19 Dec and 18:04 on 27 Jan (the grid ends 10 km west of it and the model has no earth curvature). On 27 Jan the pictures show the direct light gone by 17:45, so that is at least 19 min too long.
4. **The one row B and C do not fix** is the tram-top sunrise of 19 Dec (07:54 against a limb seen at 07:50). `sunPosition`'s refraction tapers off below the horizon, which by my estimate (not measured) is worth about 2 min there; I did not test a change.
5. Side finding, outside the model: the three camera positions in `webcam_cameras` are 1.3 to 8 km off (above).

## Not checked, or dropped

- First sun on the valley floor in the morning, anything in summer, anything under trees or beside buildings, and any shadow thrown by terrain outside the grid.
- Table Mountain's dome coming out of the Grand's morning shadow (Tetonia, 09:00-11:30): backlit and hazy, I could not place the edge. Dropped.
- Last light on the Grand on 19 Dec 2024 and 14 Dec 2025: cloud in the west / vivid afterglow, direct light could not be told from glow. Dropped.
- 18 Jan 2026 after 16:30: a cloud band low in the west. The 16:30 valley frame agreed (-2 min); 16:40 and 16:50 ran 12 and 18 min ahead of the model as the sun went into the cloud. Not counted.
- An automatic match on the Grand's rock faces did not track time reliably. Not used.
- 14 Dec 2025 sunrise at the gondola top: cloud bank, unclear. Dropped.

## Files

- `model.js` (the port; `node model.js <lat> <lng> <date> [--snap N] [--at HH:MM] [--dip]`), `render.js`, `match.py`, `pair.py`, `regions.js`, `valley.js`, `variants.js`, `fit3.js`, `fitT.js`, `events.json`, `table.js`.
- `cal/R.json` (gondola-top camera, winter 2024-25), `cal/R2.json` (winter 2025-26), `cal/T.json` (Tetonia).
- `frames/` 102 downloaded frames with `log.txt`; `pictures/` the comparisons:
  - `pictures/1_valley_shadow_2024-12-19_picture_vs_model.jpg`
  - `pictures/2_owen_grand_2024-12-19_picture_vs_model.jpg`
  - `pictures/3_grand_last_light_2025-01-27.jpg`
  - `pictures/4_gondola_top_sun_behind_ridge_2024-12-19.jpg`
  - `pictures/5_tram_top_sunset_2025-01-27.jpg`
  - `pictures/6_sunrise_zoom_2024-12-19.jpg`
