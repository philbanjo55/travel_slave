# Weather hindsight sheet: Sligo (22-25 Jun 2026) and Skye (30 Jun - 3 Jul 2026)

Version 2, 12 Nov 2026: the "what came" side now uses measured weather. Version 1 (models only) is kept as `sheet_model_only.md` and `data_model_only.json`. Read-only: nothing in the database or the repo was changed. Raw numbers: `data.json`.

## The short answer

- **Sligo:** what he did scores 10.97 of 15 on measured weather (models said 11.26). No better order of his three day loops (best of 6: 11.22). His Staging A option scores 11.64, a small lead that needs a 7.6-hour driving day; B 11.12, C 10.97.
- **Skye:** what he did scores 3.97 of 12 (models said 4.39) and still beats the Skye Swap he considered (2.70). One drivable assignment is now modestly better, 4.55: his mornings, with the two evenings traded (Fairy Glen + Elgol on 30 Jun, Neist on 2 Jul). Quiraing on the morning of 2 Jul is still the one clear cost: sunny, gusts 63 km/h.
- **The forecast:** it ranked his order first on every evening a choice was open. On measured weather that was right for the big Skye call (do not swap) and for Sligo within a quarter point; it missed that 30 Jun would be the best Skye evening.
- **How far to trust it:** the sun is now measured by satellite; rain, gusts and cloud are re-analysis, not gauges; the scoring rule is still a first guess of mine. The direction is likely right; the decimals are soft.

## Read this first

**Three kinds of number are on this page, and each table says which is which.**

| Kind | What it is | Where it appears |
|---|---|---|
| **Measured** | Satellite: direct sunlight reaching the ground each hour at each weather point (EUMETSAT, through Open-Meteo's satellite archive) | the Sun % on every "came (measured)" row, between about 2 hours after sunrise and 2 hours before sunset |
| **Re-analysis** | Rain, gusts, cloud and low cloud rebuilt afterwards from the observations of the day, by two systems (ERA5 and the ECMWF analysis). Closer to what happened than a forecast; still not a rain gauge or a wind meter at the stop | rain, gusts, cloud and low cloud on every "came (measured)" row, written `middle (lower-higher)` of the two; and the light share near dawn, dusk and after sunset (100% minus cloud) |
| **Model** | Forecasts made 1, 2 or 3 days before the hour by 7 weather models, and the same models' newest run for the hour (version 1's stand-in for what came) | every "forecast" row and column, and every "old, model" row and column |

- A "came (measured)" **score** mixes the first two: measured sun, re-analysis rain and gusts. It is computed twice (satellite + ERA5, satellite + ECMWF analysis); the middle is shown, and the two where they differ.
- **Satellite coverage was checked first** with one request for a Sligo point (54.35 N) and a Skye point (57.56 N), 22 Jun - 3 Jul 2026: every hour is present for both, no gaps. All 12 weather points then came back complete.
- **"Forecast"** = the models' run from 24 hours before the hour (2 and 3 days before where a choice between days needed it). For a morning stop that is about half a day older than what he could have seen the evening before.
- **What he did (by his word):** the day order stored in the main "Ireland + Scotland" trip. The owner says he followed it. **Not known and not claimed here:** the exact times he was at each stop, and how any stop turned out. All "at the planned time" numbers use the stored time labels.
- **Options he considered and did not take:** Ireland Staging A, B, C and Skye Swap (Jul 1/2), his own experiment trips from 18-20 Jun.
- Times are local (Ireland and UK summer time, both UTC+1). A star (*) marks the stops he starred. Same stops, same times and same scoring rule as version 1, so the numbers compare directly.
- Forecast models: ECMWF, GFS, ICON, UKMO, Meteo-France, GEM, MET Norway (the Japanese and Danish ones were asked and left out, as in version 1). A day ahead only 4 of the 7 give gusts; the other three borrow the middle gust of those four.

### The scoring rule (unchanged; a first rule written for this sheet, not the owner's and not T's)

Each hour gets rain x wind x light, and a stop's score is the average over its planned minutes (0 to 1).

| Part | Rule |
|---|---|
| Rain in the hour | under 0.1 mm: x1. 0.1-0.5 mm: x0.5. 0.5 mm or more: x0 |
| Strongest gust in the hour | under 40 km/h: x1. 40-55 km/h: x0.5. 55 km/h or more: x0 (4x5 camera, bellows) |
| Light, open subjects | 0.4 + 0.6 x sun share. Dry overcast = 0.4, full sun = 1.0 |
| Light, soft subjects | 1.0 when the sun share is 50% or less, 0.8 when sunnier |
| Sun share | direct sunlight as a share of a cloudless sky at that hour. Near dawn, dusk and after sunset (sun under 10 degrees): 100% minus cloud cover |
| "Good" | a stop score of 0.6 or more |

- **Treated as soft (overcast is fine), from `shot_type` = waterfall:** Glencar Waterfall, Devil's Chimney, Assaranca Waterfall, Lealt Falls, Kilt Rock, Fairy Pools *.
- **Treated as open (wants sun), every other type** (mountain, seascape, castle, landscape, reflection): all the rest. Two the rule may have wrong: Fairy Glen is typed landscape but its own note says it works in cloud; Benbulben Forest Walk is typed mountain.
- Left out of the rule: light direction, shade, tide, and whether cloud hid a summit (low cloud is shown beside the score, not in it). A stormy broken sky, which he may prefer on black-and-white film, scores lower here than a clear one.
- A difference between two day orders is called **clear** only when it is at least 0.5 points and both measured combinations agree on its direction (version 1: at least 6 of 7 models).

## Sligo base, 22-25 Jun 2026

### Map squares (stops that share one weather point)

| Square | Weather point asked | Stops |
|---|---|---|
| S1 Glencar / Benbulben / Lough Gill | 54.35, -8.4 | Glencar Waterfall, Devil's Chimney, Glencar Castle (Lough Gill), Benbulben, Eagle's Rock, Gleniff Horseshoe |
| S2 Mullaghmore | 54.465, -8.47 | Mullaghmore * |
| S3 Downpatrick Head | 54.32, -9.34 | Downpatrick Head * |
| S4 SW Donegal (Slieve League, An Port, Glengesh, Assaranca) | 54.7, -8.65 | Slieve League *, An Port, Glengesh Pass, Assaranca Waterfall |
| S5 Crohy Head | 54.915, -8.456 | Crohy Head |
| S6 Fanad Head / Great Pollet | 55.27, -7.63 | Fanad Head, Great Pollet |

### Each stop on the day he was there (by his word), at its stored planned time

Three rows per stop. **forecast** = model, one day ahead. **came (measured)** = Sun % from the satellite (measured); cloud, rain, gust and low cloud from re-analysis. **old, model** = version 1's stand-in (newest model runs), kept to compare. Whether he was there at that hour is not known.

**Mon 22 Jun**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Glencar Waterfall, 9:38 AM-11:38 AM (soft) | forecast (model) | 99 (87-100) | 0.0 | 16 (13-21) | 20 (3-46) | not archived | 1.00 (0.81-1.00) |
| | **came (measured)** | 96 (94-99) | 0.0 | 16 (15-18) | **8** | 0 | **1.00** |
| | old, model | 90 (77-100) | 0.0 (0.0-0.1) | 16 (10-23) | 18 (8-69) | 0 (0-43) | 1.00 (0.74-1.00) |
| Devil's Chimney, 11:42 AM-1:12 PM (soft) | forecast (model) | 94 (68-100) | 0.0 | 18 (13-23) | 19 (8-64) | not archived | 1.00 (0.84-1.00) |
| | **came (measured)** | 75 (52-98) | 0.0 | 20 (18-23) | **23** | 0 | **0.97** |
| | old, model | 66 (23-100) | 0.0 | 19 (10-26) | 37 (23-96) | 0 (0-11) | 0.97 (0.80-1.00) |
| Glencar Castle (Lough Gill), 1:31 PM-2:31 PM (open) | forecast (model) | 82 (36-100) | 0.0 | 17 (12-23) | 42 (21-76) | not archived | 0.65 (0.53-0.86) |
| | **came (measured)** | 45 (3-88) | 0.0 | 18 (14-23) | **98** | 0 | **0.99** |
| | old, model | 28 (2-86) | 0.0 | 19 (13-26) | 61 (52-98) | 0 (0-54) | 0.77 (0.71-0.99) |
| Mullaghmore *, 7:51 PM-10:36 PM (open) | forecast (model) | 35 (20-89) | 0.0 | 11 (6-13) | 55 (26-84) | not archived | 0.73 (0.56-0.90) |
| | **came (measured)** | 42 (29-55) | 0.0 | 15 (14-15) | **65 (58-72)** | 0 | **0.79 (0.75-0.83)** |
| | old, model | 35 (20-65) | 0.0 | 12 (9-22) | 61 (40-72) | 0 (0-11) | 0.77 (0.64-0.83) |

Day total, 4 stops: forecast (model) 3.38, came (measured) 3.75, old model 3.51.

**Tue 23 Jun**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Slieve League *, 7:41 AM-8:41 AM (open) | forecast (model) | 61 (5-100) | 0.0 | 18 (12-20) | 74 (60-90) | not archived | 0.85 (0.76-0.94) |
| | **came (measured)** | 34 (18-50) | 0.0 | 24 (22-26) | **99** | 3 (0-6) | **0.99** |
| | old, model | 50 (0-90) | 0.0 | 23 (16-29) | 75 (61-99) | 0 (0-12) | 0.85 (0.77-0.99) |
| An Port, 9:25 AM-2:55 PM (open) | forecast (model) | 78 (57-98) | 0.0 | 29 (19-33) | 40 (30-70) | not archived | 0.64 (0.58-0.82) |
| | **came (measured)** | 79 (73-84) | 0.1 (0.0-0.1) | 36 (35-38) | **47** | 63 (55-70) | **0.65 (0.62-0.68)** |
| | old, model | 83 (67-99) | 0.0 (0.0-0.1) | 34 (24-38) | 43 (16-71) | 69 (14-85) | 0.62 (0.50-0.82) |
| Glengesh Pass, 3:25 PM-3:35 PM (open) | forecast (model) | 78 (19-99) | 0.0 | 30 (19-34) | 72 (9-83) | not archived | 0.83 (0.45-0.90) |
| | **came (measured)** | 75 (56-94) | 0.0 | 37 (34-41) | **91** | 50 (16-84) | **0.71 (0.47-0.94)** |
| | old, model | 89 (34-100) | 0.0 | 35 (22-41) | 69 (47-91) | 37 (16-61) | 0.77 (0.47-0.88) |
| Assaranca Waterfall, 3:53 PM-5:23 PM (soft) | forecast (model) | 83 (13-98) | 0.0 | 30 (20-34) | 66 (41-79) | not archived | 0.80 (0.80-1.00) |
| | **came (measured)** | 87 (75-99) | 0.0 | 39 (34-44) | **79** | 51 (23-79) | **0.60 (0.40-0.80)** |
| | old, model | 90 (38-100) | 0.0 | 36 (24-44) | 63 (43-79) | 37 (23-60) | 0.80 (0.40-0.85) |
| Crohy Head, 6:15 PM-8:15 PM (open) | forecast (model) | 100 (85-100) | 0.0 | 20 (16-30) | 17 (0-40) | not archived | 0.50 (0.40-0.64) |
| | **came (measured)** | 100 | 0.0 | 32 (28-35) | **7** | 97 (96-97) | **0.44** |
| | old, model | 100 (86-100) | 0.0 | 26 (17-35) | 10 (0-36) | 96 (62-100) | 0.46 (0.40-0.62) |

Day total, 5 stops: forecast (model) 3.62, came (measured) 3.39, old model 3.50.

**Wed 24 Jun**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Fanad Head, 10:58 AM-1:28 PM (open) | forecast (model) | 79 (21-99) | 0.0 | 17 (8-29) | 45 (26-77) | not archived | 0.67 (0.55-0.86) |
| | **came (measured)** | 91 (83-99) | 0.0 | 30 (23-37) | **35** | 88 (76-100) | **0.61** |
| | old, model | 83 (60-94) | 0.0 | 24 (9-37) | 42 (32-63) | 50 (8-76) | 0.65 (0.59-0.78) |
| Great Pollet, 1:35 PM-3:05 PM (open) | forecast (model) | 86 (27-100) | 0.0 | 17 (8-29) | 58 (15-83) | not archived | 0.75 (0.49-0.89) |
| | **came (measured)** | 75 (55-96) | 0.0 | 28 (18-37) | **77** | 52 (7-97) | **0.86** |
| | old, model | 71 (43-100) | 0.0 | 22 (7-37) | 50 (33-77) | 11 (0-77) | 0.70 (0.60-0.86) |

Day total, 2 stops: forecast (model) 1.42, came (measured) 1.47, old model 1.35.

**Thu 25 Jun**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Downpatrick Head *, 7:48 AM-9:48 AM (open) | forecast (model) | 94 (17-100) | 0.1 (0.0-0.6) | 23 (19-30) | 49 (18-70) | not archived | 0.52 (0.29-0.82) |
| | **came (measured)** | 92 (92-93) | 0.3 (0.0-0.6) | 34 (33-35) | **54** | 2 (0-3) | **0.52 (0.34-0.70)** |
| | old, model | 93 (62-100) | 0.0 (0.0-0.1) | 30 (17-35) | 50 (1-73) | 3 (0-36) | 0.68 (0.38-0.70) |
| Benbulben, 11:22 AM-2:35 PM (open) | forecast (model) | 78 (15-93) | 0.0 (0.0-0.5) | 33 (17-60) | 76 (27-86) | not archived | 0.78 (0.00-0.92) |
| | **came (measured)** | 65 (64-65) | 0.0 | 39 (35-42) | **67** | 0 | **0.67 (0.53-0.80)** |
| | old, model | 57 (18-72) | 0.0 (0.0-0.2) | 33 (22-44) | 67 (53-93) | 10 (0-43) | 0.73 (0.64-0.96) |
| Eagle's Rock, 3:03 PM-3:23 PM (open) | forecast (model) | 76 (4-100) | 0.0 | 30 (10-40) | 69 (31-92) | not archived | 0.81 (0.59-0.95) |
| | **came (measured)** | 28 (14-42) | 0.0 | 35 (31-40) | **61** | 0 | **0.57 (0.38-0.76)** |
| | old, model | 42 (1-97) | 0.0 | 33 (21-44) | 61 (29-91) | 0 (0-26) | 0.76 (0.44-0.95) |
| Gleniff Horseshoe, 3:37 PM-5:20 PM (open) | forecast (model) | 76 (4-98) | 0.0 (0.0-0.1) | 30 (13-41) | 56 (21-86) | not archived | 0.73 (0.30-0.91) |
| | **came (measured)** | 45 (42-48) | 0.1 | 35 (31-40) | **66** | 8 (7-10) | **0.60 (0.47-0.73)** |
| | old, model | 50 (1-98) | 0.1 (0.0-2.1) | 33 (21-50) | 66 (43-83) | 10 (1-59) | 0.73 (0.15-0.85) |

Day total, 4 stops: forecast (model) 2.84, came (measured) 2.36, old model 2.90.

### The same stop at the same clock time on each day of the base

Score: **came (measured)** / old model / forecast one day ahead (model). Bold cell = the day he was there.

| Stop | 22 Jun | 23 Jun | 24 Jun | 25 Jun |
|---|---|---|---|---|
| Glencar Waterfall | **1.00 / 1.00 / 1.00** | 0.80 / 0.80 / 0.80 | 1.00 / 1.00 / 0.91 | 0.86 / 0.86 / 0.80 |
| Devil's Chimney | **0.97 / 0.97 / 1.00** | 0.80 / 0.80 / 0.80 | 1.00 / 0.87 / 0.96 | 0.68 / 0.80 / 0.80 |
| Glencar Castle (Lough Gill) | **0.99 / 0.77 / 0.65** | 0.88 / 0.85 / 0.74 | 0.50 / 0.50 / 0.52 | 0.69 / 0.79 / 0.85 |
| Mullaghmore * | **0.79 / 0.77 / 0.73** | 0.54 / 0.52 / 0.50 | 0.42 / 0.48 / 0.49 | 0.21 / 0.35 / 0.08 |
| Slieve League * | 0.42 / 0.41 / 0.42 | **0.99 / 0.85 / 0.85** | 0.45 / 0.51 / 0.47 | 0.43 / 0.64 / 0.73 |
| An Port | 0.54 / 0.53 / 0.49 | **0.65 / 0.62 / 0.64** | 0.57 / 0.61 / 0.61 | 0.53 / 0.69 / 0.68 |
| Glengesh Pass | 0.97 / 0.82 / 0.62 | **0.71 / 0.77 / 0.83** | 0.80 / 0.72 / 0.63 | 0.94 / 0.75 / 0.80 |
| Assaranca Waterfall | 0.80 / 0.80 / 0.82 | **0.60 / 0.80 / 0.80** | 0.98 / 0.95 / 0.87 | 0.59 / 0.72 / 0.80 |
| Crohy Head | 0.72 / 0.64 / 0.68 | **0.44 / 0.46 / 0.50** | 0.77 / 0.65 / 0.69 | 0.18 / 0.11 / 0.27 |
| Fanad Head | 0.48 / 0.43 / 0.45 | 0.75 / 0.75 / 0.77 | **0.61 / 0.65 / 0.67** | 0.37 / 0.59 / 0.38 |
| Great Pollet | 0.58 / 0.54 / 0.46 | 0.52 / 0.62 / 0.73 | **0.86 / 0.70 / 0.75** | 0.33 / 0.69 / 0.50 |
| Downpatrick Head * | 0.47 / 0.44 / 0.41 | 0.71 / 0.70 / 0.82 | 0.49 / 0.63 / 0.57 | **0.52 / 0.68 / 0.52** |
| Benbulben | 0.72 / 0.69 / 0.58 | 0.84 / 0.79 / 0.78 | 0.55 / 0.56 / 0.58 | **0.67 / 0.73 / 0.78** |
| Eagle's Rock | 0.98 / 0.87 / 0.72 | 0.86 / 0.86 / 0.65 | 0.71 / 0.61 / 0.62 | **0.57 / 0.76 / 0.81** |
| Gleniff Horseshoe | 0.97 / 0.86 / 0.80 | 0.79 / 0.81 / 0.73 | 0.68 / 0.63 / 0.75 | **0.60 / 0.73 / 0.73** |

### Best 2-hour window of each day for each stop

Came (measured: satellite sun, re-analysis rain and gusts). Windows start on the hour between 5 AM and 8 PM. When several windows tie, the one nearest the planned time is shown. Light direction and tide are not in the score, so read this as "dry, calm and bright enough", not "best picture". Stops in one map square share a weather point, so their windows match.

| Stop (planned start) | 22 Jun | 23 Jun | 24 Jun | 25 Jun |
|---|---|---|---|---|
| Glencar Waterfall (9:38 AM) | **10:00 AM: 1.00** | 5:00 AM: 0.90 | 10:00 AM: 1.00 | 5:00 AM: 1.00 |
| Devil's Chimney (11:42 AM) | **11:00 AM: 1.00** | 5:00 AM: 0.90 | 12:00 PM: 1.00 | 5:00 AM: 1.00 |
| Glencar Castle (Lough Gill) (1:31 PM) | **2:00 PM: 0.99** | 2:00 PM: 0.88 | 3:00 PM: 0.71 | 8:00 AM: 0.92 |
| Mullaghmore * (7:51 PM) | **2:00 PM: 0.99** | 2:00 PM: 0.91 | 3:00 PM: 0.70 | 8:00 AM: 0.88 |
| Slieve League * (7:41 AM) | 3:00 PM: 0.95 | **7:00 AM: 0.99** | 6:00 PM: 0.77 | 2:00 PM: 0.89 |
| An Port (9:25 AM) | 3:00 PM: 0.95 | **7:00 AM: 0.99** | 6:00 PM: 0.77 | 2:00 PM: 0.89 |
| Glengesh Pass (3:25 PM) | 3:00 PM: 0.95 | **7:00 AM: 0.99** | 6:00 PM: 0.77 | 2:00 PM: 0.89 |
| Assaranca Waterfall (3:53 PM) | 12:00 PM: 1.00 | **7:00 PM: 1.00** | 4:00 PM: 1.00 | 2:00 PM: 0.80 |
| Crohy Head (6:15 PM) | 4:00 PM: 0.96 | **8:00 AM: 0.99** | 7:00 PM: 0.82 | 3:00 PM: 0.68 |
| Fanad Head (10:58 AM) | 4:00 PM: 0.92 | 9:00 AM: 1.00 | **1:00 PM: 0.87** | 9:00 AM: 0.68 |
| Great Pollet (1:35 PM) | 4:00 PM: 0.92 | 9:00 AM: 1.00 | **1:00 PM: 0.87** | 4:00 PM: 0.68 |
| Downpatrick Head * (7:48 AM) | 1:00 PM: 0.98 | 7:00 AM: 0.96 | 6:00 PM: 0.72 | **1:00 PM: 0.88** |
| Benbulben (11:22 AM) | 1:00 PM: 0.99 | 1:00 PM: 0.88 | 3:00 PM: 0.71 | **8:00 AM: 0.92** |
| Eagle's Rock (3:03 PM) | 3:00 PM: 0.98 | 2:00 PM: 0.88 | 3:00 PM: 0.71 | **8:00 AM: 0.92** |
| Gleniff Horseshoe (3:37 PM) | 4:00 PM: 0.97 | 2:00 PM: 0.88 | 3:00 PM: 0.71 | **8:00 AM: 0.92** |

**Was a clearly better hour on offer the same day?** (best 2-hour window at least 0.2 above the planned time, came, measured)

| Stop | Day | Planned time: score | Best 2 hours: score | Window the day-ahead forecast (model) liked: its measured score | Forecast saw it? |
|---|---|---|---|---|---|
| Mullaghmore * | 22 Jun | 7:51 PM: 0.79 | 2:00 PM: 0.99 | 4:00 PM: 0.96 | yes |
| An Port | 23 Jun | 9:25 AM: 0.65 | 7:00 AM: 0.99 | 7:00 AM: 0.99 | yes |
| Glengesh Pass | 23 Jun | 3:25 PM: 0.71 | 7:00 AM: 0.99 | 3:00 PM: 0.69 | no |
| Assaranca Waterfall | 23 Jun | 3:53 PM: 0.60 | 7:00 PM: 1.00 | 6:00 PM: 0.88 | yes |
| Crohy Head | 23 Jun | 6:15 PM: 0.44 | 8:00 AM: 0.99 | 8:00 AM: 0.99 | yes |
| Fanad Head | 24 Jun | 10:58 AM: 0.61 | 1:00 PM: 0.87 | 1:00 PM: 0.87 | yes |
| Downpatrick Head * | 25 Jun | 7:48 AM: 0.52 | 1:00 PM: 0.88 | 1:00 PM: 0.88 | yes |
| Benbulben | 25 Jun | 11:22 AM: 0.67 | 8:00 AM: 0.92 | 1:00 PM: 0.68 | no |
| Eagle's Rock | 25 Jun | 3:03 PM: 0.57 | 8:00 AM: 0.92 | 2:00 PM: 0.64 | no |
| Gleniff Horseshoe | 25 Jun | 3:37 PM: 0.60 | 8:00 AM: 0.92 | 2:00 PM: 0.64 | no |

On measured sun the Sligo days had more shape than the models gave them. Tue 23 Jun was sunny early everywhere in Donegal and clouded over through the day (Slieve League at 7:41 AM: sun 99%; Crohy Head at 6:15 PM: 7%, low cloud 97%). Thu 25 Jun was brightest around 8 AM inland and gusty later (35-42 km/h). Crohy Head stays the plainest case and it is the last stop of the Donegal loop, so a morning visit means driving the loop backwards. The Mullaghmore row only says mid-afternoon had more sun than the evening he chose for low light; the rule does not value low light.

### His order against the options he did not take, on the weather that came

Score = sum of the 15 stop scores (most possible: 15). "Measured" = satellite sun + re-analysis rain and gusts; "old, model" = version 1. Starred = Mullaghmore, Slieve League, Downpatrick Head (most possible: 3). Each option is scored with its own stored times.

| Order | 23 Jun | 24 Jun | 25 Jun | **Score, measured** | Two combinations | Score, old model | Starred, measured | Good stops, measured | Against what he did, measured | Same, old model |
|---|---|---|---|---|---|---|---|---|---|---|
| **What he did (by his word)** | Edge: Slieve League, An Port, Glengesh, Assaranca, Crohy Head | Fanad Head, Great Pollet | Downpatrick Head, Benbulben, Eagle's Rock, Gleniff | **10.97** | 10.76-11.20 | 11.26 | 2.30 | 12 of 15 | - | - |
| Staging A (not taken) | Downpatrick Head, then Fanad Head and Great Pollet | Edge loop | Benbulben at 5:31 AM | **11.64** | 11.57-11.71 | 11.15 | 2.02 | 12 of 15 | +0.67 (both combinations higher) | -0.11 |
| Staging B (not taken) | Downpatrick Head, Benbulben, Eagle's Rock, Gleniff | Fanad Head, Great Pollet | Edge loop | **11.12** | 10.90-11.34 | 10.96 | 1.95 | 11 of 15 | +0.15 (both combinations higher) | -0.30 |
| Staging C (not taken) | Fanad Head, Great Pollet | Edge loop | Downpatrick Head, Benbulben, Eagle's Rock, Gleniff | **10.97** | 10.24-11.69 | 11.27 | 1.77 | 10 of 15 | +0.00 (the two disagree or tie) | +0.01 |
| Best of the 6 whole-day orders (hindsight) | Queen Maeve loop | Edge loop | Fanad loop | **11.22** | 11.20-11.24 | 11.39 | 1.95 | 11 of 15 | +0.25 (the two disagree or tie) | +0.13 |

22 Jun is the arrival day in every row (Glencar Waterfall, Devil's Chimney, Glencar Castle, Mullaghmore in the evening); Staging A also puts Eagle's Rock and Gleniff on its late afternoon. The hindsight-best whole-day order is the same one as in version 1.

- **Best possible assignment, driving kept plausible:** the three day loops stay whole and keep their clock times, the arrival day stays fixed; that leaves 6 orders. The best scores 11.22 on measured weather against 10.97 for what he did (+0.25; old model +0.13). Not clear.
- **Staging A now scores highest (11.64, +0.67; old model -0.11).** That is over the 0.5 line and both combinations agree, so by this sheet's own test it counts as clear, though it is small (4% of the total). Where it comes from: Eagle's Rock +0.38, Assaranca Waterfall +0.38, Crohy Head +0.33, Downpatrick Head * +0.27; against Great Pollet -0.26, Slieve League * -0.54. It regroups stops and its 23 Jun pairs Downpatrick Head with Fanad Head: his own stored drive minutes for that day add up to 459 (92 + 215 + 7 + 145), about 7.6 hours at the wheel. With wind taken out of the rule the lead is +0.40.
- **Not drivable, shown only as a ceiling:** every stop on its own best day at its planned time = 13.25 (old model 12.22); every stop in its best 2-hour window of any day = 14.86 (old model 13.57).
- **If wind is taken out of the rule (measured):** he did 11.76, A 12.16, B 11.27, C 11.62, best of 6 11.76 (his own order).

All six whole-day orders:

| 23 Jun | 24 Jun | 25 Jun | **Score, measured** | Two combinations | Score, old model |
|---|---|---|---|---|---|
| Queen Maeve | Edge | Fanad | **11.22** | 11.20-11.24 | 11.39 |
| Queen Maeve | Fanad | Edge | **11.09** | 10.88-11.32 | 10.93 |
| Edge | Fanad | Queen Maeve | **10.97** (what he did) | 10.76-11.20 | 11.26 |
| Fanad | Edge | Queen Maeve | **10.95** | 10.24-11.66 | 11.22 |
| Edge | Queen Maeve | Fanad | **10.27** | 9.84-10.69 | 10.72 |
| Fanad | Queen Maeve | Edge | **10.12** | 9.85-10.38 | 10.22 |

**Answer for Sligo (measured):** no better order among the ways of arranging his own three day loops: his order is 3rd of 6 and 0.25 behind the best, with the top four inside 0.3 of each other. The one change from version 1 is Staging A, which now comes out 0.67 ahead at the price of a 7.6-hour driving day. The poor slot is still the evening of 25 Jun (Crohy Head would have scored 0.18, rain 5.9 (0.6-11.2) mm, gusts 43 (26-60) km/h, re-analysis; Mullaghmore 0.21); his order had nothing planned then.

### Day by day: would the forecast have pointed to the better choice?

"Forecast's pick" = the order the forecast (model) scored highest that evening, using the runs from 1, 2 and 3 days before each day. The forecast side has not changed since version 1; what has changed is the weather it is judged against. "Yes" = its pick came within 0.3 of the hindsight best.

| Day | Day-ahead forecast (model) for what he did that day | Came (measured) | Old model | Choice still open the evening before | Forecast's pick: its measured score | Best in hindsight, measured | Forecast pointed right? |
|---|---|---|---|---|---|---|---|
| 22 Jun | 3.38 of 4 | 3.75 | 3.51 | none (arrival day) | - | - | no choice to make; the day was better than forecast |
| 23 Jun | 3.62 of 5 | 3.39 | 3.50 | order of the 3 loops over 23/24/25 Jun | Edge / Fanad / Queen Maeve (what he did): 7.22 of 11 | Queen Maeve / Edge / Fanad: 7.47 | **yes, narrowly**: its pick was 3rd of 6 on measured weather, 0.25 behind the best (version 1: 0.13 behind) |
| 24 Jun | 1.42 of 2 | 1.47 | 1.35 | Fanad or Queen Maeve first | Fanad / Queen Maeve (what he did): 3.83 of 6 | Fanad / Queen Maeve: 3.83 | **yes**: same order |
| 25 Jun | 2.84 of 4 | 2.36 | 2.90 | none left | - | - | no choice to make; the day came in a little under forecast (gusts 35-42 km/h) |

The forecast ranking on the evening of 22 Jun (score for 23-25 Jun, 11 stops) and what each order then scored:

| Order for 23 / 24 / 25 Jun | Forecast score (model, across models) | **Came (measured)** | Came, old model |
|---|---|---|---|
| Edge / Fanad / Queen Maeve (what he did) | 7.53 (5.58-8.23) | **7.22** | 7.75 |
| Queen Maeve / Fanad / Edge | 7.32 (5.36-8.27) | **7.34** | 7.42 |
| Queen Maeve / Edge / Fanad | 7.12 (5.42-8.73) | **7.47** | 7.88 |
| Edge / Queen Maeve / Fanad | 7.06 (5.62-8.22) | **6.52** | 7.21 |
| Fanad / Edge / Queen Maeve | 6.98 (4.20-8.79) | **7.20** | 7.71 |
| Fanad / Queen Maeve / Edge | 6.71 (4.18-8.32) | **6.37** | 6.71 |

## Skye base, 30 Jun - 3 Jul 2026

### Map squares (stops that share one weather point)

| Square | Weather point asked | Stops |
|---|---|---|
| K1 Trotternish east (Storr, Lealt, Brothers Point, Kilt Rock) | 57.56, -6.16 | Lealt Falls, Old Man of Storr *, Brothers Point, Kilt Rock |
| K2 Quiraing / Fairy Glen | 57.61, -6.31 | Quiraing *, Fairy Glen |
| K3 Neist Point | 57.42, -6.79 | Neist Point * |
| K4 Elgol | 57.146, -6.107 | Elgol * |
| K5 Sligachan / Fairy Pools | 57.27, -6.22 | Sligachan Bridge (30 Jun), Fairy Pools *, Sligachan Bridge (3 Jul) |
| K6 Eilean Donan (mainland, on the drive in) | 57.274, -5.516 | Eilean Donan * |

### Each stop on the day he was there (by his word), at its stored planned time

Three rows per stop. **forecast** = model, one day ahead. **came (measured)** = Sun % from the satellite (measured); cloud, rain, gust and low cloud from re-analysis. **old, model** = version 1's stand-in (newest model runs), kept to compare. Whether he was there at that hour is not known.

**Tue 30 Jun**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Eilean Donan *, 8:17 AM-9:30 AM (open) | forecast (model) | 100 (97-100) | 0.2 (0.0-0.6) | 14 (4-16) | 1 (0-3) | not archived | 0.20 (0.08-0.41) |
| | **came (measured)** | 100 | 0.1 (0.1-0.2) | 27 (22-31) | **3** | 39 (16-62) | **0.31 (0.30-0.33)** |
| | old, model | 100 (96-100) | 0.2 (0.1-0.4) | 22 (4-25) | 4 (0-7) | 82 (16-100) | 0.21 (0.20-0.30) |
| Sligachan Bridge (30 Jun), 10:18 AM-10:48 AM (open) | forecast (model) | 100 (90-100) | 0.2 (0.1-0.6) | 16 (5-35) | 1 (0-8) | not archived | 0.20 (0.00-0.22) |
| | **came (measured)** | 97 (94-100) | 0.1 | 32 (31-32) | **1** | 34 (11-58) | **0.20** |
| | old, model | 100 (96-100) | 0.1 (0.0-0.3) | 28 (6-40) | 2 (0-5) | 74 (58-100) | 0.21 (0.00-0.41) |
| Lealt Falls, 12:24 PM-2:24 PM (soft) | forecast (model) | 100 (93-100) | 0.4 (0.1-2.4) | 10 (6-16) | 1 (0-8) | not archived | 0.60 (0.00-0.85) |
| | **came (measured)** | 100 (99-100) | 1.0 (0.2-1.8) | 22 (19-24) | **15** | 81 (80-82) | **0.45 (0.40-0.50)** |
| | old, model | 100 (97-100) | 0.6 (0.2-2.4) | 18 (5-24) | 1 (0-15) | 92 (65-100) | 0.50 (0.15-0.60) |
| Neist Point *, 5:06 PM-9:36 PM (open) | forecast (model) | 42 (27-100) | 0.0 (0.0-0.2) | 14 (5-20) | 33 (4-53) | not archived | 0.50 (0.43-0.69) |
| | **came (measured)** | 47 (43-51) | 0.3 (0.1-0.6) | 25 (22-28) | **52** | 38 (33-43) | **0.56 (0.48-0.64)** |
| | old, model | 97 (34-100) | 0.1 (0.0-1.5) | 16 (12-28) | 6 (0-52) | 90 (33-100) | 0.40 (0.20-0.64) |

Day total, 4 stops: forecast (model) 1.50, came (measured) 1.52, old model 1.32.

**Wed 1 Jul**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Old Man of Storr *, 6:25 AM-10:55 AM (open) | forecast (model) | 100 (93-100) | 0.1 (0.0-0.6) | 14 (11-20) | 9 (1-34) | not archived | 0.46 (0.28-0.59) |
| | **came (measured)** | 99 (97-100) | 0.0 | 17 (14-21) | **19** | 86 (79-92) | **0.51** |
| | old, model | 99 (88-100) | 0.0 (0.0-0.5) | 13 (8-22) | 8 (4-24) | 91 (54-100) | 0.44 (0.25-0.54) |
| Brothers Point, 11:07 AM-12:37 PM (open) | forecast (model) | 100 (98-100) | 0.0 (0.0-0.8) | 20 (19-26) | 4 (0-15) | not archived | 0.40 (0.00-0.43) |
| | **came (measured)** | 100 | 0.1 (0.0-0.2) | 28 (23-34) | **3** | 92 (85-99) | **0.31 (0.21-0.42)** |
| | old, model | 100 (98-100) | 0.2 (0.0-0.3) | 27 (14-34) | 3 (0-15) | 84 (44-99) | 0.39 (0.20-0.45) |
| Kilt Rock, 12:42 PM-1:12 PM (soft) | forecast (model) | 100 (98-100) | 0.0 (0.0-0.3) | 25 (20-28) | 1 (0-18) | not archived | 1.00 (0.00-1.00) |
| | **came (measured)** | 100 | 0.1 | 31 (29-34) | **1** | 94 (93-94) | **0.55 (0.50-0.60)** |
| | old, model | 100 (98-100) | 0.0 (0.0-0.2) | 30 (17-34) | 2 (0-17) | 80 (38-94) | 0.70 (0.30-1.00) |

Day total, 3 stops: forecast (model) 1.86, came (measured) 1.37, old model 1.53.

**Thu 2 Jul**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Quiraing *, 7:01 AM-11:31 AM (open) | forecast (model) | 69 (52-96) | 0.3 (0.0-1.7) | 58 (45-73) | 40 (6-58) | not archived | 0.12 (0.00-0.21) |
| | **came (measured)** | 50 | 0.5 (0.4-0.6) | 63 (63-64) | **73** | 37 (28-47) | **0.00** |
| | old, model | 75 (50-100) | 0.3 (0.0-2.1) | 60 (47-72) | 39 (2-73) | 73 (33-99) | 0.00 (0.00-0.25) |
| Fairy Glen, 5:58 PM-7:28 PM (open) | forecast (model) | 82 (40-99) | 0.0 | 51 (33-63) | 53 (16-71) | not archived | 0.30 (0.11-0.75) |
| | **came (measured)** | 89 (87-91) | 0.1 (0.0-0.1) | 51 (50-52) | **36** | 88 (83-93) | **0.25 (0.20-0.31)** |
| | old, model | 71 (17-93) | 0.0 | 52 (35-62) | 49 (9-95) | 31 (1-83) | 0.31 (0.00-0.97) |
| Elgol *, 9:20 PM-12:20 AM (open) | forecast (model) | 44 (14-75) | 0.0 (0.0-0.1) | 34 (27-40) | 56 (25-86) | not archived | 0.64 (0.55-0.87) |
| | **came (measured)** | 67 (64-70) | 0.1 (0.0-0.3) | 39 (35-44) | **33 (30-36)** | 63 (61-65) | **0.42 (0.24-0.59)** |
| | old, model | 58 (23-78) | 0.1 (0.0-0.3) | 40 (34-44) | 42 (22-77) | 42 (6-73) | 0.50 (0.24-0.68) |

Day total, 3 stops: forecast (model) 1.06, came (measured) 0.67, old model 0.81.

**Fri 3 Jul**

| Stop, planned time | | Cloud % | Rain mm | Gust km/h | Sun % | Low cloud % | Score |
|---|---|---|---|---|---|---|---|
| Fairy Pools *, 6:50 AM-8:20 AM (soft) | forecast (model) | 90 (71-100) | 0.0 (0.0-0.4) | 45 (34-56) | 15 (3-58) | not archived | 0.47 (0.17-0.73) |
| | **came (measured)** | 82 (71-93) | 0.2 (0.1-0.3) | 48 (46-50) | **35** | 71 (66-76) | **0.24** |
| | old, model | 93 (79-99) | 0.0 (0.0-0.3) | 48 (36-57) | 24 (12-58) | 62 (41-84) | 0.47 (0.08-0.89) |
| Sligachan Bridge (3 Jul), 8:44 AM-9:44 AM (open) | forecast (model) | 95 (62-100) | 0.2 (0.0-0.3) | 43 (36-51) | 21 (8-45) | not archived | 0.24 (0.15-0.34) |
| | **came (measured)** | 92 (92-93) | 0.2 (0.1-0.3) | 49 (47-51) | **44** | 78 (74-82) | **0.17** |
| | old, model | 95 (66-100) | 0.1 (0.0-0.2) | 50 (36-54) | 37 (0-44) | 66 (9-94) | 0.26 (0.10-0.59) |

Day total, 2 stops: forecast (model) 0.71, came (measured) 0.41, old model 0.73.

### The same stop at the same clock time on each day of the base

Score: **came (measured)** / old model / forecast one day ahead (model). Bold cell = the day he was there.

| Stop | 30 Jun | 1 Jul | 2 Jul | 3 Jul |
|---|---|---|---|---|
| Eilean Donan * | **0.31 / 0.21 / 0.20** | 0.36 / 0.42 / 0.43 | 0.07 / 0.04 / 0.15 | 0.31 / 0.47 / 0.26 |
| Sligachan Bridge (30 Jun) | **0.20 / 0.21 / 0.20** | 0.41 / 0.41 / 0.41 | 0.00 / 0.19 / 0.17 | 0.14 / 0.29 / 0.21 |
| Lealt Falls | **0.45 / 0.50 / 0.60** | 0.38 / 0.80 / 0.80 | 0.21 / 0.08 / 0.40 | 0.12 / 0.38 / 0.30 |
| Neist Point * | **0.56 / 0.40 / 0.50** | 0.01 / 0.00 / 0.00 | 0.39 / 0.56 / 0.54 | 0.23 / 0.36 / 0.33 |
| Old Man of Storr * | 0.21 / 0.18 / 0.18 | **0.51 / 0.44 / 0.46** | 0.13 / 0.10 / 0.17 | 0.23 / 0.36 / 0.30 |
| Brothers Point | 0.21 / 0.20 / 0.20 | **0.31 / 0.39 / 0.40** | 0.14 / 0.10 / 0.20 | 0.07 / 0.16 / 0.16 |
| Kilt Rock | 0.50 / 0.50 / 0.50 | **0.55 / 0.70 / 1.00** | 0.20 / 0.00 / 0.28 | 0.12 / 0.35 / 0.25 |
| Quiraing * | 0.23 / 0.20 / 0.20 | 0.34 / 0.42 / 0.40 | **0.00 / 0.00 / 0.12** | 0.15 / 0.16 / 0.21 |
| Fairy Glen | 0.83 / 0.27 / 0.33 | 0.00 / 0.00 / 0.00 | **0.25 / 0.31 / 0.30** | 0.17 / 0.17 / 0.34 |
| Elgol * | 0.59 / 0.49 / 0.50 | 0.02 / 0.00 / 0.00 | **0.42 / 0.50 / 0.64** | 0.40 / 0.40 / 0.20 |
| Fairy Pools * | 0.72 / 0.28 / 0.39 | 1.00 / 1.00 / 1.00 | 0.20 / 0.24 / 0.25 | **0.24 / 0.47 / 0.47** |
| Sligachan Bridge (3 Jul) | 0.23 / 0.20 / 0.06 | 0.42 / 0.42 / 0.42 | 0.03 / 0.11 / 0.18 | **0.17 / 0.26 / 0.24** |

### Best 2-hour window of each day for each stop

Came (measured: satellite sun, re-analysis rain and gusts). Windows start on the hour between 5 AM and 8 PM. When several windows tie, the one nearest the planned time is shown. Light direction and tide are not in the score, so read this as "dry, calm and bright enough", not "best picture". Stops in one map square share a weather point, so their windows match.

| Stop (planned start) | 30 Jun | 1 Jul | 2 Jul | 3 Jul |
|---|---|---|---|---|
| Eilean Donan * (8:17 AM) | **8:00 PM: 0.46** | 5:00 AM: 0.43 | 8:00 PM: 0.45 | 7:00 PM: 0.48 |
| Sligachan Bridge (30 Jun) (10:18 AM) | **8:00 PM: 0.51** | 6:00 AM: 0.53 | 8:00 PM: 0.45 | 8:00 PM: 0.35 |
| Lealt Falls (12:24 PM) | **8:00 AM: 0.62** | 9:00 AM: 1.00 | 5:00 PM: 0.75 | 8:00 PM: 0.88 |
| Neist Point * (5:06 PM) | **5:00 PM: 0.71** | 6:00 AM: 0.43 | 8:00 PM: 0.56 | 8:00 PM: 0.35 |
| Old Man of Storr * (6:25 AM) | 7:00 PM: 0.38 | **6:00 AM: 0.64** | 8:00 PM: 0.55 | 5:00 AM: 0.53 |
| Brothers Point (11:07 AM) | 7:00 PM: 0.38 | **6:00 AM: 0.64** | 8:00 PM: 0.55 | 5:00 AM: 0.53 |
| Kilt Rock (12:42 PM) | 8:00 AM: 0.62 | **9:00 AM: 1.00** | 5:00 PM: 0.75 | 8:00 PM: 0.88 |
| Quiraing * (7:01 AM) | 6:00 PM: 0.79 | 6:00 AM: 0.52 | **8:00 PM: 0.50** | 5:00 AM: 0.45 |
| Fairy Glen (5:58 PM) | 6:00 PM: 0.79 | 6:00 AM: 0.52 | **8:00 PM: 0.50** | 5:00 AM: 0.45 |
| Elgol * (9:20 PM) | 8:00 PM: 0.55 | 6:00 AM: 0.52 | **8:00 PM: 0.50** | 8:00 PM: 0.35 |
| Fairy Pools * (6:50 AM) | 7:00 AM: 0.75 | 7:00 AM: 1.00 | 7:00 PM: 0.62 | **8:00 PM: 0.88** |
| Sligachan Bridge (3 Jul) (8:44 AM) | 8:00 PM: 0.51 | 6:00 AM: 0.53 | 8:00 PM: 0.45 | **8:00 PM: 0.35** |

**Was a clearly better hour on offer the same day?** (best 2-hour window at least 0.2 above the planned time, came, measured)

| Stop | Day | Planned time: score | Best 2 hours: score | Window the day-ahead forecast (model) liked: its measured score | Forecast saw it? |
|---|---|---|---|---|---|
| Sligachan Bridge (30 Jun) | 30 Jun | 10:18 AM: 0.20 | 8:00 PM: 0.51 | 4:00 PM: 0.17 | no |
| Brothers Point | 1 Jul | 11:07 AM: 0.31 | 6:00 AM: 0.64 | 8:00 AM: 0.46 | yes |
| Kilt Rock | 1 Jul | 12:42 PM: 0.55 | 9:00 AM: 1.00 | 12:00 PM: 0.50 | no |
| Quiraing * | 2 Jul | 7:01 AM: 0.00 | 8:00 PM: 0.50 | 5:00 PM: 0.23 | yes |
| Fairy Glen | 2 Jul | 5:58 PM: 0.25 | 8:00 PM: 0.50 | 5:00 PM: 0.23 | no |
| Fairy Pools * | 3 Jul | 6:50 AM: 0.24 | 8:00 PM: 0.88 | 7:00 AM: 0.25 | no |

Quiraing is still the one that matters: gusts 63 km/h through the planned morning in both re-analyses, easing below 45 only after 8 PM. The satellite shows that the sun was out (73%), so it was bright and very windy, not grey. Fairy Pools: the evening of 3 Jul was not on offer (he was due to leave Skye by mid-morning); its best slot in hindsight was the calm grey morning of 1 Jul (1.00), which the Storr block had. Brothers Point and Kilt Rock were better earlier on 1 Jul, before the showers. The day-ahead forecast pointed to a better slot for Quiraing (later in the day) and Brothers Point (earlier), and to none of the others.

### His order against the option he did not take, on the weather that came

Score = sum of the 12 stop scores (most possible: 12). "Measured" = satellite sun + re-analysis rain and gusts; "old, model" = version 1. Starred = Eilean Donan, Neist Point, Old Man of Storr, Quiraing, Elgol, Fairy Pools (most possible: 6). Left out: Corpach Wreck and St Andrews on 3 Jul (not on Skye).

| Order | 30 Jun evening | 1 Jul morning | 1 Jul evening | 2 Jul morning | 2 Jul evening | **Score, measured** | Two combinations | Score, old model | Starred, measured | Good stops, measured | Against what he did, measured | Same, old model |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **What he did (by his word)** | Neist Point | Storr, Brothers Point, Kilt Rock | nothing | Quiraing | Fairy Glen, Elgol | **3.97** | 3.71-4.25 | 4.39 | 2.04 | 0 of 12 | - | - |
| Skye Swap (not taken) | nothing | Quiraing | Fairy Glen, Elgol | Storr, Brothers Point, Kilt Rock | Neist Point | **2.70** | 1.98-3.45 | 2.74 | 1.54 | 0 of 12 | -1.27 (both lower) | -1.65 |
| Swap with Neist left on 30 Jun (my variant, not his) | Neist Point | Quiraing | Fairy Glen, Elgol | Storr, Brothers Point, Kilt Rock | nothing | **2.76** | 2.23-3.32 | 2.67 | 1.60 | 0 of 12 | -1.21 (both lower) | -1.72 |
| Best of 12 assignments (hindsight) | Fairy Glen, Elgol | Storr, Brothers Point, Kilt Rock | nothing | Quiraing | Neist Point | **4.55** | 4.48-4.65 | 4.50 | 2.04 | 1 of 12 | +0.58 (both combinations higher) | +0.11 |

In every row 30 Jun also has Eilean Donan, Sligachan Bridge and Lealt Falls on the drive in, and 3 Jul has Fairy Pools and Sligachan Bridge before leaving. The hindsight-best assignment is the same one as in version 1.

- **The Skye Swap trip** holds only 1 and 2 Jul and puts Neist Point on the evening of 2 Jul, so it is scored with Neist moved off 30 Jun. It uses its own stored times.
- **Best possible assignment, driving kept plausible:** the Storr block and Quiraing take the two free mornings in either order; Neist and Fairy Glen + Elgol take two of the three free evenings; arrival and departure stops stay put. 12 assignments, all about an hour from the house. The best keeps his mornings and trades his two evenings: Neist Point * on 2 Jul 0.39 against 0.56 on 30 Jun; Fairy Glen on 30 Jun 0.83 against 0.25 on 2 Jul; Elgol * on 30 Jun 0.59 against 0.42 on 2 Jul. Total 4.55 against 3.97 (+0.58; old model +0.11). Over the 0.5 line, both combinations agree: a modest but clear gain, nearly all of it at Fairy Glen.
- **Not drivable, shown only as a ceiling:** every stop on its best day at its planned time = 6.33 (old model 6.42); every stop in its best 2-hour window of any day = 8.66 (old model 7.61). Even with hindsight the four days offered little under this rule.
- **If wind is taken out of the rule (measured):** he did 5.27, Skye Swap 4.41 (-0.86), best of 12 5.76 (+0.49). His order still beats the swap.

All 12 assignments:

| Storr block | Quiraing | Neist evening | Fairy Glen + Elgol evening | **Score, measured** | Two combinations | Score, old model |
|---|---|---|---|---|---|---|
| 1 Jul | 2 Jul | 2 Jul | 30 Jun | **4.55** | 4.48-4.65 | 4.50 |
| 1 Jul | 2 Jul | 1 Jul | 30 Jun | **4.17** | 4.17-4.20 | 3.94 |
| 2 Jul | 1 Jul | 2 Jul | 30 Jun | **3.99** | 3.54-4.46 | 3.59 |
| 1 Jul | 2 Jul | 30 Jun | 2 Jul | **3.97** (what he did) | 3.71-4.25 | 4.39 |
| 2 Jul | 1 Jul | 1 Jul | 30 Jun | **3.61** | 3.23-4.01 | 3.03 |
| 1 Jul | 2 Jul | 1 Jul | 2 Jul | **3.42** | 3.08-3.78 | 3.99 |
| 2 Jul | 1 Jul | 30 Jun | 2 Jul | **3.41** | 2.77-4.06 | 3.48 |
| 1 Jul | 2 Jul | 30 Jun | 1 Jul | **3.32** | 3.17-3.50 | 3.58 |
| 1 Jul | 2 Jul | 2 Jul | 1 Jul | **3.15** | 2.84-3.48 | 3.74 |
| 2 Jul | 1 Jul | 1 Jul | 2 Jul | **2.86** | 2.14-3.59 | 3.08 |
| 2 Jul | 1 Jul | 30 Jun | 1 Jul | **2.76** (Swap, Neist kept) | 2.23-3.32 | 2.67 |
| 2 Jul | 1 Jul | 2 Jul | 1 Jul | **2.59** (Swap as stored, main-trip times) | 1.90-3.30 | 2.83 |

**Answer for Skye (measured):** his order still beats the swap he considered, 3.97 against 2.70, in both combinations. What changed: one drivable assignment is now clearly, if modestly, better than his (+0.58): the same mornings with the two evenings traded. His order is 4th of the 12. Why, on measured weather:

- **Wed 1 Jul evening was the bad slot (holds):** at Elgol, rain 2.1 (1.3-3.0) mm and gusts 61 (57-65) km/h (score 0.02); at Neist Point gusts 79 (75-84), rain 5.0 (4.8-5.2) mm (re-analysis). His order had nothing planned that evening. The swap put Fairy Glen and Elgol there.
- **Thu 2 Jul had the sun and the wind (holds, sharper):** Storr that morning, sun 70% by satellite, gusts 58 (50-66) km/h (score 0.13), against a grey, calm, dry 1 Jul morning (sun 19%, gusts 17 (14-21), score 0.51).
- **The cost of his order (holds):** Quiraing on the morning of 2 Jul scores 0.00 (gusts 63 (63-64) km/h, sun 73%); on the morning of 1 Jul it would have scored 0.34 (version 1 said 0.42).
- **New: the evening of Tue 30 Jun was the best evening of the stay.** The satellite shows sun where the models had none: Neist Point 52% (models 6 (0-52)%), Fairy Glen 84%, with light wind. He was at Neist (0.56). Fairy Glen would have scored 0.83 that evening against 0.25 in the wind of 2 Jul.
- **Summits:** low cloud at Storr on the morning of 1 Jul was 86 (79-92)% and at Quiraing on 1 Jul 98 (97-100)% (re-analysis). The tops may have been in cloud on the calm morning; the score does not know that.
- **A note already in the database:** the Quiraing and Elgol stop notes carry a weather window (the text says "updated Jun 26", although the rows' last-edit stamp is 14 Jun and 9 Jun; I could not tell which is right) that expected a calm dawn on 2 Jul with the wind building through the day. Both re-analyses have gusts of 64-73 km/h around 5 AM and about 60 through the morning. The day-ahead forecast had already changed to a windy morning.

### Day by day: would the forecast have pointed to the better choice?

| Day | Day-ahead forecast (model) for what he did that day | Came (measured) | Old model | Choice still open the evening before | Forecast's pick: its measured score | Best in hindsight, measured | Forecast pointed right? |
|---|---|---|---|---|---|---|---|
| 30 Jun | 1.50 of 4 | 1.52 | 1.32 | all 12 assignments (which evening for Neist, which for Elgol, which morning for Storr) | Storr 1 Jul, Quiraing 2 Jul, Neist 30 Jun, Elgol 2 Jul (what he did): 2.60 of 7 | Storr 1 Jul, Quiraing 2 Jul, Neist 2 Jul, Elgol 30 Jun: 3.18 | **no** (version 1: yes): its pick was 4th of 12 on measured weather, 0.58 behind the best, which the forecast had ranked 2nd |
| 1 Jul | 1.86 of 3 | 1.37 | 1.53 | swap the mornings or not; Elgol evening on 1 or 2 Jul | Storr 1 Jul, Quiraing 2 Jul, Elgol 2 Jul (what he did): 2.04 of 6 | Storr 1 Jul, Quiraing 2 Jul, Elgol 2 Jul: 2.04 | **yes**: same choice; the full swap scored 0.83 of 6 |
| 2 Jul | 1.06 of 3 | 0.67 | 0.81 | none left (only the hour) | - | - | no day choice; the forecast did show the windy morning (Quiraing 0.12 forecast, 0.00 came) |
| 3 Jul | 0.71 of 2 | 0.41 | 0.73 | none (leaving day) | - | - | no choice to make; it came in under forecast (gusts 46-51 km/h) |

The forecast ranking on the evening of 29 Jun (7 movable stops, forecast 1, 2 and 3 days ahead), top five of 12, and what each then scored:

| Order | Forecast score (model, across models) | **Came (measured)** | Came, old model |
|---|---|---|---|
| Storr 1 Jul, Quiraing 2 Jul, Neist 30 Jun, Elgol 2 Jul (what he did) | 3.77 (2.70-4.04) | **2.60** | 2.74 |
| Storr 1 Jul, Quiraing 2 Jul, Neist 2 Jul, Elgol 30 Jun | 3.39 (2.89-3.94) | **3.18** | 2.85 |
| Storr 1 Jul, Quiraing 2 Jul, Neist 1 Jul, Elgol 2 Jul | 3.27 (2.28-3.60) | **2.05** | 2.34 |
| Storr 1 Jul, Quiraing 2 Jul, Neist 1 Jul, Elgol 30 Jun | 2.88 (2.58-3.42) | **2.80** | 2.29 |
| Storr 2 Jul, Quiraing 1 Jul, Neist 30 Jun, Elgol 2 Jul | 2.84 (1.41-3.45) | **2.04** | 1.83 |

The forecast ranking on the evening of 30 Jun (6 movable stops left, forecast 1 and 2 days ahead):

| Order | Forecast score (model, across models) | **Came (measured)** | Came, old model |
|---|---|---|---|
| Storr 1 Jul, Quiraing 2 Jul, Elgol 2 Jul (what he did) | 2.96 (2.25-3.00) | **2.04** | 2.34 |
| Storr 2 Jul, Quiraing 1 Jul, Elgol 2 Jul | 2.23 (1.10-3.16) | **1.48** | 1.43 |
| Storr 1 Jul, Quiraing 2 Jul, Elgol 1 Jul | 2.08 (0.95-2.17) | **1.39** | 1.53 |
| Storr 2 Jul, Quiraing 1 Jul, Elgol 1 Jul | 1.35 (0.52-1.86) | **0.83** | 0.62 |

## Did any conclusion change?

| Version 1 conclusion (models only) | On measured weather | Changed? |
|---|---|---|
| Sligo: no clearly better order on offer | Among his own three day loops, still none: best of 6 is +0.25. But Staging A, which regroups stops, is +0.67 (was -0.11), with a 7.6-hour driving day | **Partly.** Small, and it costs a lot of driving |
| Skye: his order beat the swap | 3.97 against 2.70 (was 4.39 against 2.74) | No |
| Skye: no drivable assignment clearly better than his | Trading his two evenings (Fairy Glen + Elgol on 30 Jun, Neist on 2 Jul) is +0.58 (was +0.11) | **Yes, modestly.** The satellite found sun on the evening of 30 Jun that the models did not have |
| Quiraing on 2 Jul was the one cost of his order | Score 0.00, gusts 63 (63-64) km/h; 1 Jul would have scored 0.34 | No. It was sunny as well as windy |
| Crohy Head was better in the morning | 6:15 PM: 0.44; 8:00 AM: 0.99 (was 0.46 and 0.82) | No, stronger |
| The evening-before forecast ranked his order first, and that was right | It still ranked his order first every time (the forecasts are the same). Judged on measured weather: Sligo, his order was 3rd of 6, 0.25 behind; Skye on 29 Jun, 4th of 12, 0.58 behind; Skye on 30 Jun, 1st of 4 | **Partly.** Right on the big call (do not swap), wrong on which evening for Neist |

## How solid is the "what came" side now?

Better than version 1, and uneven: the sun is solid, rain and wind are reasonable, dawn and dusk light and summit cloud are still soft.

- **Sun: measured.** One satellite value per hour per weather point, no gaps. Against version 1's model stand-in the sun share differs by 9 points in the middle case and up to 46; the models were not reliable on sun.
- **Scores moved, but not much.** For a stop on the day he was there, measured and old-model scores differ by 0.08 in the middle case; 3 of 27 stops moved by 0.2 or more.
- **Rain and gusts: re-analysis, two versions.** They agree well with each other (stop scores differ by 0.06 in the middle case, up to 0.47) and with the app's own stored rows (gusts within 8 km/h in the middle case over 27 stops). They are a 9 to 28 km grid: a shower can miss the stop, and wind on a ridge or a headland is stronger than the grid value.
- **Still not measured at any stop:** no rain gauge, no wind meter, no airport report, no camera, and no word from the owner on how a stop turned out.
- **The rule is mine.** Change the gust limits or how much sun matters and the scores move. "His order beat the swap" holds with wind taken out. The two new findings (Staging A, the Skye evening trade) are each close to the 0.5 line.

## What is still model-only, or not known at all

- **Every forecast number** (it has to be: it is what the models said beforehand), and with it every "would the forecast have pointed right" answer.
- **Dawn, dusk and after-sunset light:** the rule uses 100% minus cloud there, and that cloud is re-analysis. This covers most of Elgol (9:20 PM onward), the last hour of Mullaghmore and Neist Point, and the 5-6 AM windows.
- **Low cloud on summits and sea stacks:** re-analysis only, shown but not scored. No visibility on the measured side.
- **Cloud cover on the measured rows:** re-analysis (the satellite request here was for sunlight, not a cloud picture).
- **Not in any data here:** light direction, shade, tide, sea state, and what he found when he got there.

## Requests and hosts

| Host | What it gave | Result |
|---|---|---|
| `satellite-api.open-meteo.com` | measured direct, total and scattered sunlight per hour | open since the owner's approval. 1 coverage check + 12 downloads, all complete |
| `archive-api.open-meteo.com` | re-analysis rain, gusts, cloud, low cloud (ERA5 and ECMWF analysis) | open. 12 downloads; one answered "daily request limit exceeded" and one was cut off, each retried once after 30 seconds and complete |
| `previous-runs-api.open-meteo.com` | forecasts 1-3 days ahead and the newest runs | version 1's 33 requests, not repeated |

60 requests in all across both versions (27 in this one), none at minute :07. Nothing is blocked now.

## The one thing that would most improve this sheet now

The owner's own word on a handful of stops (in cloud, rained off, blown out, or fine): it is the only thing that can test the scoring rule itself, which is now the weakest link. Second: a wind and cloud-base report from a nearby airport for the summit days (Stornoway for Skye), to check the two things the grid is worst at.

## Files

- `sheet.md`, `data.json`: this version (measured). `data.json` holds, per stop and day, the measured side (`came_measured`), the old model stand-in (`came_newest_run_model`) and the forecasts, plus all orders, the decision tables, a `summary` block and the version 1 totals (`model_only_comparison`).
- `sheet_model_only.md`, `data_model_only.json`, `code_model_only/`: version 1, unchanged.
- `code/fetch.sh`, `code/fetch_measured.sh`, `code/analyse.py`, `code/build_sheet.py`; `raw/`: the downloaded responses and the read-only database dumps.
