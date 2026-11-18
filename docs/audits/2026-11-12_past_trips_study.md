# Testing T on the two trips already taken

Research only, 12 Nov 2026. Nothing was changed: no database writes, no deploys, no commits.
Numbers come from the live database unless marked **(estimate)** or **(not verified)**.

## The short answer

- A fair "T against what Phil really did" test is **not possible**: the database holds the plan made before each trip, not what happened. No stop is ticked, no photo of his own is attached, no times or positions are logged.
- A smaller, honest test **is** possible: "his stored plan against T's plan for the same days, both judged on the weather that really came". It works best on the two places where he slept several nights in one area (Sligo, 4 days; Skye, 3 nights). Those are also the places where he drew up day-swap options himself just before leaving.
- Iceland was nearly all one-night stops. T's main skill (which day for which place) has almost nothing to decide there. Only timing within each day can be tested.
- The day-ahead forecast history exists for both trips (checked with real requests). The "what happened" side is weaker than at the Tetons: no cameras, few airports.
- One trip of 15 days and one of 10 give a story, not a proof. The Teton proof needed 56 weeks to see differences of half a point a week.

## 1. What is known about each trip

### Ireland + Scotland (21 Jun - 5 Jul 2026)

| Day | Date | Stops | With a pin | With a length | Logistics | Reference photos |
|---|---|---|---|---|---|---|
| 0 | 21 Jun | 3 | 2 | 0 | 3 | 0 |
| 1 | 22 Jun | 9 | 9 | 7 | 4 | 37 |
| 2 | 23 Jun | 7 | 7 | 5 | 2 | 35 |
| 3 | 24 Jun | 4 | 4 | 2 | 2 | 22 |
| 4 | 25 Jun | 6 | 6 | 4 | 2 | 25 |
| 5 | 26 Jun | 5 | 5 | 2 | 4 | 0 |
| 6 | 27 Jun | 8 | 7 | 6 | 5 | 0 |
| 7 | 28 Jun | 16 | 15 | 12 | 8 | 35 |
| 8 | 29 Jun | 8 | 8 | 7 | 3 | 18 |
| 9 | 30 Jun | 9 | 9 | 5 | 5 | 24 |
| 10 | 1 Jul | 6 | 6 | 4 | 3 | 17 |
| 11 | 2 Jul | 8 | 8 | 6 | 5 | 18 |
| 12 | 3 Jul | 7 | 7 | 5 | 3 | 25 |
| 13 | 4 Jul | 9 | 9 | 7 | 3 | 6 |
| 14 | 5 Jul | 5 | 3 | 0 | 5 | 0 |

- 110 stops on days, plus 1 set aside (An Corran Beach). Every stop has a time label. 105 of the 110 have a pin (the 5 without are flights and a film drop).
- 57 are logistics (wake up, hotels, flights, groceries, meals). 53 are marked as something to shoot: waterfall 11, seascape 11, mountain 10, urban 9, reflection 5, castle 4, landscape 3.
- Of those 53, **44 have reference photos**. The 9 without are city sights (Guinness, Jameson, Edinburgh Castle and so on), Dalkey Island and one hotel return typed as "landscape". So the real photo stops number about 44.
- 13 stop names carry a star, 4 say "OPTIONAL/if time", 1 says "Backup".
- No stop is time-locked (not even the flights). No hotels are stored as accommodations: they only appear as stops, and the Sligo nights use three different names (Glass House Hotel, Riverside Hotel, Innisfreedom cabin).

### Iceland 2026 (12 - 21 Aug 2026)

| Day | Date | Stops | With a pin | With a length | Logistics | Reference photos |
|---|---|---|---|---|---|---|
| 0 | 12 Aug | 0 | 0 | 0 | 0 | 0 |
| 1 | 13 Aug | 10 | 9 | 8 | 7 | 20 |
| 2 | 14 Aug | 9 | 9 | 7 | 4 | 48 |
| 3 | 15 Aug | 8 | 8 | 7 | 2 | 32 |
| 4 | 16 Aug | 9 | 9 | 8 | 5 | 25 |
| 5 | 17 Aug | 7 | 7 | 5 | 3 | 18 |
| 6 | 18 Aug | 6 | 6 | 5 | 2 | 29 |
| 7 | 19 Aug | 7 | 7 | 6 | 3 | 11 |
| 8 | 20 Aug | 7 | 7 | 6 | 4 | 27 |
| 9 | 21 Aug | 9 | 9 | 8 | 5 | 3 |

- 72 stops on days, 71 with a pin. 35 logistics, 37 to shoot (waterfall 12, seascape or coast 8, mountain 5, canyon 3, reflection 2, plus a lunch, a church, a geothermal field, three elf sites and one castle-type).
- **31 of the 37 already carry a rank written in the notes** as `[S-TIER]`, `[A-TIER]` or `[C-TIER]`: 15 S, 15 A, 1 C. Who set them (Phil or Claude's research) is not recorded.
- 6 stops are time-locked (Kirkjufell dawn, Stokksnes, Hvítserkur, Forest Lagoon, Blue Lagoon, the flight home).
- 8 hotels are stored, 6 with a pin. The 14 Aug and 15 Aug entries have no pin, and the 15 Aug hotel name (NordicStay Downtown) does not match the stop for that night (Castle Inn Apartments, Keflavik).
- One stop (Hafragilsfoss) sits on its day but has no trip id. It would have to be fixed before the planner can see it.

### What the photos are

- Ireland + Scotland: 262 photos on 44 stops, all typed "reference". 259 were uploaded between 1 Apr and 16 Jun, before the trip. 3 were added during it (21 and 24 Jun), still as reference pictures for stops not yet visited.
- Iceland: 213 photos on 37 stops. 211 are "reference", uploaded 4 May - 15 Aug. 2 are typed "field" but sit on the "Wake Up" stop and date from 3 May (a test).
- No photo has a caption. **None is his own picture from the trip.**

### Is there any record of where he was, and when?

No.
- `exposures` (the film log): 0 rows for either trip. The table holds only 3 test rows from Arlington on 3 Jun.
- No stop is ticked ("checked" is false on all 182).
- Ireland stop notes ("log", "hist") are research written before the trip, not a diary.
- The app logged "Photo cache complete" 99 times between 21 Jun and 21 Aug. That shows the app was opened, not where.
- One indirect record: the `photographs` catalogue lists **22 finished film pictures from Ireland and Scotland** (4x5, Ilford Pan F+), from about 17 of the stops: Glencar Waterfall, Parkes Castle, Mullaghmore, Assaranca, Crohy Head, Fanad Head (2), Great Pollet, Downpatrick Head (4), Eagle's Rock, Glencoe (3), Eilean Donan, Neist Point (2), Storr, Brothers Point, Quiraing. It gives the month, not the day or hour. It has no Iceland pictures.
- The database kept one weather row per stop per day (105 for Ireland + Scotland, 71 for Iceland), fetched at about 23:07 UTC on the day: cloud, low cloud, rain, gusts and visibility at the stop's planned hour. It is a model value read after the fact, not a measurement.

### Plan or what happened?

The plan.
- Ireland + Scotland: the last edit to any stop was 16 Jun, five days before departure.
- Iceland: the last edits were 14, 15 and 16 Aug, during the trip, to stops still ahead (a lunch booking, Dyrhólaey, Hverir "7:30 PM on a 0%-cloud night"). So he was re-planning from the forecast as he went, and the stored plan is the plan as of 16 Aug.
- Four experiment trips show he was weighing day orders right before leaving: "Ireland Staging A / B / C" (three orders of the four Sligo days, last edited 18 - 20 Jun) and "Skye Swap (Jul 1/2)" (Quiraing and Storr days exchanged, 18 Jun). Staging C was edited after the main trip's last edit, so **the main trip may not be the order he finally drove**. Which one he did is not recorded.

## 2. What T needs that these trips lack

`trip_readiness` (read-only) was run on both. Item by item:

| Need | Ireland + Scotland | Iceland | How hard |
|---|---|---|---|
| Time zone | missing | missing | trivial |
| Hotels with pins and dates | none stored | 6 of 8 have pins, one mismatch | small, needs Phil for the Sligo nights and 14 - 15 Aug |
| Ranks (tiers) | 0 of 53 | 0 of 37 in the planner; 31 written in notes | see section 5 |
| Shots (stand spot + subject pin) | 0 | 0 | Claude places about 75 subject pins from maps, "approximate"; stand spot = the stop's pin |
| Terrain for sun and shade | none (only `grand_teton` is loaded) | none | free public tiles via `dem-region-load`. Box sizes at the standard grid: west Ireland 3.2 MB, west Scotland 3.7 MB, all of Iceland's stops about 30 MB **(estimate from the stops' bounding boxes)** |
| Drive times between stops | 0 real legs stored (the readiness "ok" only counts stops that share a spot) | 0 | Google, costs money: see below |
| Airport within 30 km | none set, none in `metar_stations` | same | weak: see below |
| Bench place + odds | no `replay_places` row | none | none exist for these climates; without them T uses its crude rule (cloud above 70% = hidden) |
| Bookings and fixed times | none locked | 6 locked | flights and ferries need locking |
| Once-only / keep-together | none | none | Claude suggests, Phil checks (as for the Faroes) |
| Cameras | none | none | no archive exists for mid-2026 (the camera archive began Oct 2026) |

**Drive times.** The planner wants every pair of spots. As the function stands it would ask Google for about 4,290 pairs for Ireland + Scotland (66 spots, chained together through Donegal, so it would also ask for pointless Ireland-to-Scotland pairs) and 3,422 for Iceland (59 spots): about 7,700 in all. Split by area it is less: west Ireland 342, west Scotland 870, Dublin 56, Edinburgh 72. Google's list price is $5 per 1,000 after 10,000 free a month (web search, not checked on Phil's account). So the cost is somewhere between nothing and about $40 **(estimate)**.

**Airports.** `metar_stations` holds only Vágar and the Wyoming airports. Candidates from memory, not checked for whether they report cloud height all day **(not verified: the airport-history site is blocked from this session)**:
- West Ireland: EISG Sligo, EIDL Donegal, EIKN Knock, EGAE Derry.
- Highlands and Skye: EGEO Oban, EGPO Stornoway, EGPL Benbecula, EGPE Inverness. There is no reporting airport on Skye or in Glencoe.
- Iceland: BIKF Keflavik, BIRK Reykjavik, BIVM Vestmannaeyjar, BIHN Hornafjörður, BIEG Egilsstaðir, BIAR Akureyri, BIHU Húsavík.

Measured from the stops to those candidates: of 42 Ireland + Scotland landscape stops, 11 are within 30 km, 20 are 30 - 60 km away, 11 are farther (up to 90 km). Of 30 Iceland landscape stops, 5 are within 30 km, 10 are 30 - 60 km, 15 are farther; Snæfellsnes is about 100 km from the nearest.

**Three things in the bench itself assume a one-base trip:**
1. One airport and one cloud-height rule per trip (`replay_places`). A road trip needs one per area.
2. T's "every place once" rule treats a place as still possible on any later day. It does not know he has driven on, so it would not force a Sligo stop before leaving Sligo.
3. The bench tick sorts places into two groups by latitude (above 55 = Faroes, below = Wyoming). Ireland would land in the Wyoming group and Scotland and Iceland in the Faroes group. New history downloads would also set off the known "refit on every tick" stall (hit on 3 and 8 Nov) unless their dates are handled.

Running each multi-night base as its own small test copy avoids the first two without touching T. `make_trip_test_copy` exists and leaves the original trip alone.

## 3. Is the weather history there?

**Forecasts made the day before: yes.** The bench reads Open-Meteo "Previous Runs" (`replay_fetch` kind `fc`: 9 models for European places, day-ahead plus 2 - 3 and 4 - 7 days ahead; kind `run` for the ECMWF midnight run used by the morning re-plan). Two real requests made today:
- West of Ireland (54.25, -8.5), 22 - 23 Jun 2026: day-ahead cloud from all 9 models, day-ahead direct sun from 8 (the Japanese model has none).
- Iceland south coast (63.5, -19.5), 16 - 17 Aug 2026: the same, plus rain from all 9, gusts from 6, and 3-days-ahead cloud from all 9.
- Day-ahead low cloud is empty for every model, as at the Tetons.

**What happened:**
- Satellite sunshine (hourly sun at any point): the bench has it for the Faroes at 62.4°N with no missing hours. Ireland and Scotland are further south, so they should be covered. **Iceland at 63.4 - 66.0°N is not verified**: the satellite host is blocked from this session and I found no stated northern limit. One request from the database would settle it.
- Rain and gusts: the weather re-analysis archive the bench already uses (`era5`). Available anywhere. It is a model's best reconstruction, not a gauge.
- Airports: thin, as above.
- Cameras: none.
- Phil's own results: the 22 catalogued pictures, plus whatever he remembers.

**What "a good shot" should mean here.** T today scores light on the subject, times a penalty when "the peaks are hidden" (airport cloud below a set height), times rain and wind penalties; waterfalls get a bonus after rain. The Faroes trip is already coastal (24 seascapes, 5 waterfalls) and runs on that rule, so the idea is not new to T. For these two trips it needs three adjustments:
- Waterfalls, canyons and woodland: fine under cloud. The switch exists (`needs_peaks` off, "Fine under cloud"). Nobody has used it yet, and only the bench reads it.
- Coast and sea stacks: what hides them is fog or low visibility, not a cloud deck 600 m up. Truth = visibility where an airport is near, otherwise only rain and wind.
- Mountains (Kirkjufell, Vestrahorn, Storr, Quiraing, Buachaille, the Cuillin from Elgol): "hidden" is right, but the cloud height that hides each one differs (about 450 m to 1,000 m), and the nearest airport is often 50 - 100 km away. This is the weakest part of any truth here.
- He shoots black-and-white 4x5 film. His catalogue titles say "dramatic sky", "cloud/storm sky", "long exposure quiet". T's rule ("clear and I can see it = good") comes from the Tetons. For these trips a broken or stormy sky may be the better picture, and T has no score for that.
- Tides matter at several stops (Mullaghmore cave, An Corran, Diamond Beach). T does not read tides.

**A first look** (two more small requests, three models, 05 - 20 UTC: cloud is the average, rain the total; "came" = the newest model run for that hour, not a measurement):

| Skye, Trotternish | Day-ahead forecast | What the models say came |
|---|---|---|
| 30 Jun | cloud 84 - 100%, rain 3 - 8 mm | cloud 90 - 100%, rain 4 - 9 mm |
| 1 Jul | cloud 99 - 100%, rain 6 - 10 mm | cloud 99 - 100%, rain 5 - 7 mm |
| 2 Jul | cloud 67 - 84%, rain 0 - 2 mm, clearly more sun | cloud 80 - 95%, rain 0 - 1 mm |
| 3 Jul | cloud 89 - 99%, rain 0 - 2 mm | cloud 94 - 100%, rain 0 - 2 mm |

His stored plan put Old Man of Storr at dawn on 1 Jul and Quiraing + Elgol on 2 Jul. His "Skye Swap" experiment did the opposite. So the days did differ, the forecast saw it a day ahead, and there was a real choice to make. For the Sligo days (22 - 25 Jun) the models disagreed with each other more and the days differed less.

## 4. What can honestly be compared

### Design 1. Weather hindsight sheet (cheap)

For every photo stop at its planned hour: what the forecasts said the evening before, and what came (satellite sun, rain, gusts, nearest airport where there is one). For the multi-night bases, the same for the other days he could have chosen.
- **Tells Phil:** where his plan hit bad weather; whether the evening-before forecast pointed to a better day or hour; whether there was anything for a planner to win.
- **Cannot tell him:** what T would have done. No light direction or shade.
- **Needs:** forecast and truth downloads for about 45 - 50 map squares (20 - 23 for Ireland + Scotland, 23 - 26 for Iceland; fewer for Sligo and Skye alone). No ranks, shots, terrain or drive times.
- **Effort:** 1 session **(estimate)**. **Money:** none. **Database:** about 10 - 20 MB **(estimate)**; the database is 1,275 MB of 8,000 today.
- **Risk:** low. The downloads must be kept out of the bench tick's refit trigger.

### Design 2. T against his plan on the real days (recommended, in part)

The bench replays the real dates. Three plans per day: `my` (his stored schedule as written), T (the current winner, BA) and `hs3` (the best possible with hindsight, an upper limit). All judged on the weather that came. Run it per base, as test copies: Sligo 22 - 25 Jun, Glencoe 28 - 29 Jun, Skye 30 Jun - 3 Jul, and Snæfellsnes 13 - 15 Aug if Phil wants Iceland in.
- **Tells Phil:** day by day, what T would have changed (which day for Storr, what time for Downpatrick Head, what to skip), and whether that looks better or worse on the real weather. It can be set next to which stops gave him keepers.
- **Cannot tell him:**
  - Whether T "beats" him. Three or four short bases are a handful of days. One lucky morning decides it.
  - Anything against what he really did: "his plan" is the stored plan, and for Sligo we do not know which of four versions he drove.
  - Whether the pictures would have been better. The judge is sun, rain, wind and a rough cloud rule, not a stormy sky on film.
  - How T does with learned odds. It would run on the crude cloud rule, which is not how the live Teton T runs.
- **Needs:** time zone, hotels, ranks, about 45 - 75 subject pins, terrain for 2 - 3 boxes, drive times, bookings locked, "fine under cloud" marked, forecasts and truth loaded, bench rows added by hand (the setup functions are written for the Teton and Faroes trip ids).
- **Effort:** 3 - 4 sessions **(estimate)**. **Money:** Google drive times, $0 - 40 **(estimate)**; no Claude API cost (T uses none). **Database:** 60 - 100 MB **(estimate)**, more with all of Iceland's terrain.
- **Risks:** the bench shares its tick and CPU budget with the live Teton and Faroes practice runs. Use the local runner (`local: true`) and load data when no live step is due. June days are twice as long as Teton winter days, so each planning step is heavier.

### Design 3. Full bench treatment (thorough)

Treat each area like the Tetons: replay the same weeks of June - July 2024, 2025 and 2026 (Ireland, Scotland) and August 2024 - 2026 (Iceland), many start dates, with odds learned from airport history. The Previous Runs archive starts early 2024, so three summers is the most there is.
- **Tells Phil:** whether T beats his schedule on average in those climates, with error bars; and gives T learned odds for an Atlantic summer.
- **Cannot tell him:** more about his actual trip than Design 2. The truth stays weak (few airports, no cameras), so the odds would be learned from a judge that is itself rough. Iceland's one-night stops still leave T little to decide.
- **Needs:** everything in Design 2, plus three summers of forecasts and truth, airport history per area, a fit per area, and code changes to the bench (one airport per area, the road-trip "last chance" gap, the two-place latitude split).
- **Effort:** 6 - 10 sessions plus days of bench time **(estimate)**. **Money:** as Design 2. **Database:** 300 - 600 MB **(estimate)**; the bench pauses itself above 2 GB.
- **Risks:** real. It changes bench code six weeks before the Teton trip, competes with the live runs, and the Faroes bench already needed special handling to fit the CPU limit at this trip size.

### Not possible, in any design

- Comparing T with the days he actually had: the record does not exist unless Phil supplies it.
- A camera-based judge for mid-2026.
- A proof from these two trips alone.

## 5. What is needed from Phil

Shortest list, in order of value:
1. **Did you follow the stored plan?** Sligo: which day order (the main trip, or Staging A / B / C)? Skye: did you swap 1 and 2 Jul? Anything skipped or added? If his phone photos or location history have times, those would turn "his plan" into "his trip".
2. **How each photo stop turned out:** nailed / got / missed / skipped. About 44 stops for Ireland + Scotland, about 31 for Iceland. I can pre-fill the 17 or so with catalogued pictures.
3. **Ranks, by correcting a draft rather than filling in 180:**
   - Logistics need none (57 + 35 stops drop out).
   - Iceland: use the 31 ranks already in the notes (15 S, 15 A, 1 C); he confirms.
   - Ireland + Scotland: draft from the names: the 13 starred stops = S, the 4 "OPTIONAL" and the "Backup" = C, the rest A or B, city sights left out. He corrects.
   - For Design 2 on Sligo and Skye only, that is about 30 stops to glance at.
4. **Where you slept:** the Sligo nights (three names in the plan) and 14 - 15 Aug in Iceland.
5. **One rule instead of per-stop answers:** are waterfalls, canyons and woodland fine (or better) under cloud for your film work?
6. **OK to spend on Google drive times** (likely free, at most about $40).

Not needed from him: pins, shots, terrain, forecasts, bench setup.

## 6. Recommended first step

1. Ask Phil questions 1 and 4. Without them "his plan" is a guess.
2. Run **Design 1 for Sligo (22 - 25 Jun) and Skye (30 Jun - 3 Jul)** only. It is free, needs no ranks, and shows whether a better day was on offer. The first look says yes for Skye.
3. In the same session, send one satellite request for an Iceland point to settle the coverage question.
4. If the sheet shows real choices, go on to **Design 2 for those two bases**, with a drafted rank list for him to correct. Treat the result as a day-by-day story.
5. Leave Design 3 and any bench code change until after the Teton trip (29 Dec - 4 Jan).

## What blocks it

- No record of the trip as lived (the main limit).
- Write access: this research was read-only. Every design needs downloads and new rows.
- Iceland satellite coverage and airport reporting are unverified.
- The bench is busy with the live practice trips, and the real trip starts 28 Dec.

## Sources and working files

- Database: read-only queries through `q.sh`; `trip_readiness` for both trips; live definitions of `replay_fetch_tick`, `replay_build`, `replay_setup`, `replay_runs_setup`, `replay_run_tick`.
- Repo: `/home/user/travel_slave/docs/NEW_TRIP_SOP.md`, `/home/user/travel_slave/docs/solver/TESTBENCH_FEASIBILITY.md`, `/home/user/travel_slave/supabase/functions/solver-replay/index.ts`, `/home/user/travel_slave/supabase/functions/solver-drive-matrix/index.ts`.
- Open-Meteo Previous Runs: 4 successful small requests today (responses saved in `/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/past_trips/_work/`).
- Google price: [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [Routes API usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing).
- Satellite coverage (no limit found): [Open-Meteo Satellite Radiation API](https://open-meteo.com/en/docs/satellite-radiation-api).
