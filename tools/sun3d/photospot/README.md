# Find my spot from a photo (prototype, Nov 2026)

Given a landscape photo taken near a trip stop, work out where the photographer stood (lat, lng, eye height) and how
the shot was framed (heading, tilt, roll, lens width), using our own 3D terrain (the same files the app's 3D tab
draws: wide file, sharp range boxes, near boxes, buildings). Nothing here is shipped or writes to the database.

Two steps, as the finished feature would run:

1. **One vision look** names what is in the picture (peaks, barns, churches, sea stacks) with rough pixel spots and,
   for a building, its left / right edge; plus flags (drone, close-up, screenshot). In this prototype that file
   (`landmarks/<photo>.json`) was written by hand from one look at each picture, before solving.
2. **Code, no hand tuning per photo** (`solve.py`):
   - `skyline.py` finds the photo's sky / land boundary in every column, plus every other clear colour step
     (clouds, snow lines, roofs: the terrain decides which one is the sky line);
   - coarse search: every spot on a 150 m grid within 3 km of the stop (plus rings round a named building), eye
     1.7 m above the ground, the terrain's sky line all round, every heading and 22 lens widths (12-100 deg); a vote
     counts the columns where a photo edge lies on the terrain's sky line (tilt from the vote, in 4 px bins); named
     landmarks must land near their pixels; a mild pull toward the stop (sigma 1.5 km) breaks ties;
   - refine the best two (plus the best spot within 250 m of the stop, and the stop itself): heading / tilt / roll / lens fitted to the photo edges nearest the
     model sky line (window 40 -> 5 px), then the spot and eye height moved by a pattern search; buildings within
     ~1.8 km of the stop are part of the model sky line;
   - **region match** (`contours.py`): from a spot, a small picture (180 px wide) of what our model shows in each part of
     the frame: sky, trees (laser canopy, up to 800 m out), buildings, ground under 150 m / to 1 km / to 5 km / beyond.
     Scored by how much of the photo's light and texture those areas explain (correlation ratio), plus "trees are
     darker than the open ground" once trees fill a tenth of the frame. It is what pins the spot when the sky line is
     far mountains only (Oxbow Bend 450 m -> 32 m, Snake River Overlook 155-360 m -> 2 m). Weight 0.5 inside the spot
     search, 1.0 in the final choice;
   - the stop pin itself is always refined too (a 150 m grid misses spots where near trees decide);
   - confidence: the spot is slid along the line of sight and sideways (15-400 m), the orientation refitted and the
     spot scored as in the final choice; every offset within 0.05 of the answer's score counts as possible.

Results (16 Nov 2026, six film scans, hand solves as truth): 8, 0, 32, 2, 5, 2 m; 70-115 s a photo, two at a time.

**Clear view (17 Nov 2026, Glacier View job 5fe631eb):** the answer sat 550 m west of the turnout in the Snake River
forest, where 20 m conifers 50-90 m away hide 55% of the range in the frame (Phil saw the trees in the app's 3D view).
Why: the far sky line fits about as well from both places, and the region match preferred the forest: (1) its "trees
are darker than the open ground" term compared the model's trees with everything else, the snowy range included, so
trees covering the photo's darker lower half scored +0.33; (2) its depth bins (< 150 m / 1 km / 5 km / beyond) let a
forest clearing's tree wall stand in for the range's forested foot, the flats and the tree band at once; (3) the stop
pin's own refine started from the best (forest) answer's orientation, stuck with the roll 1.7 deg off (sky line agreement
0.14-0.21), so the turnout was never fairly tried. Fixes: `contours.tree_corr` compares trees only with buildings and
ground nearer than 5 km; finer depth classes (ground < 50 / 150 / 400 m / 1 / 2 / 5 / 10 km / beyond, trees nearer /
farther than 150 m); each pin's orientation also starts from the named peaks seen from the pin (`lm_orient`) and from
the best three screen answers; evergreens (laser mask class 0 / 2, leaf tiles under 128) are always part of the model
sky line, bare winter crowns stay optional. Each refined answer gets a clear-view check (`Refiner.view`): the share of
the far land beyond 3 km in the frame hidden by trees closer than 400 m (1 m laser trees where there are any), and the
share of the whole frame that is; the final choice between answers costs 5 per unit of frame share above 0.10 (true
spots 0.01-0.05, the forest spot 0.16, a Moulton answer behind cottonwoods 0.14-0.19). The result has `clear_view`
{blocked_frac, blocked_frame_frac, far_frame_frac, ok, cost}. Not used inside the spot search: there it slid to
forest clearings just under the free share and moved scan 6 (taken among the Snake River firs) from 2 m to 55 m.
After (17 Nov 2026): Glacier View at the turnout (45 m from the stop, 76 m from stand pin G1, was 551 m); scans 5, 0,
30, 2, 5, 2 m (were 8, 0, 32, 2, 5, 2); same run time.

**Tie-break and confidence (17 Nov 2026, second Glacier View look):** the live rerun (Claude's look put the peaks 5 px
apart from the first look) came back placed / High +-15 m 615 m north of the turnout on the same sage flat: there it fit
0.10 better, with the first look 0.02 worse; open views fit about as well from anywhere along a terrace. The +-15 m came
from the slide (13 offsets, +-400 m, along and across the line of sight only) and a rival check on final scores only.
Now: the stop's own stand pins (`stand_pins`: claim's job, `--pins` locally; Find spot's own pins left out) are refined
too; a spot far from the stop / hint / stand pins costs up to `TIE_W` 0.15 (`TIE_SIG` 200 m); results carry `fit` (the
photo alone) and `job.verdict` calls an answer 'direction only, spot could be N m off' when a refined spot 150 m+ away
is within 0.05 by score or by fit. Second look: turnout, direction only, 638 m; first look and the 6 scans unchanged and
placed; runs +15-35 s (one more refine per stand pin; a 'direction only' first try also runs the other peak sets).

Without the named landmarks all six go wrong (heading 25-160 deg off): the vision step's names are needed.
`--no-region` turns the region match off; `--no-names` ignores the landmark file.
3. `review.py` builds the review page (photo + our sky line, our numpy render from the solved spot, a map sketch with
   the stop's stand pins, numbers, and for the hand-solved film scans the error).

```
fetch_rows.sh <q.sh> rows.json                       # terrain table rows (read only)
solve.py photo.jpg --rows rows.json --cache terrain/ --region grand_teton --stop LAT,LNG --landmarks lm.json --out r.json
batch.py jobs.json out/ --rows rows.json --cache terrain/ --procs 3
review.py <work dir>                                 # needs meta/, landmarks/, out/
```
Needs numpy, scipy, opencv-python, Pillow. Terrain files download on first use from the public `terrain` bucket.

`gazetteer.json` is a stand-in: names written from general knowledge (100-400 m) or copied from the trips'
`scout_subjects`, snapped to the terrain's high point / the largest building. A real version would use OSM / GNIS /
Faroese place names. Results and numbers: see the review page and the commit message of this folder.

## In the app (16 Nov 2026, "Find spot")

The viewer's Find spot pill -> edge function `photo-spot` (`supabase/functions/photo-spot`): Claude looks at the photo
(the stored picture through Supabase's resizer, 1280 wide, `resize=contain`) and names landmarks from the gazetteer and
the trip's subjects with pixel spots (`look.ts`; ~2 cents) -> table `photo_spot_jobs` -> GitHub Actions
`.github/workflows/photo-spot.yml` (workflow_dispatch with the job id, started by the function with secret
`GITHUB_DISPATCH_TOKEN`) runs `job.py --job <id>`: it claims the job with the run's OIDC token (audience `photo-spot`; the
function checks repo, workflow file and event), solves, and finishes with the result and `overlay.jpg` (photo + our sky
line, bucket `photo-spot`). `job.py` checks the look's named peaks against each other from the stop (one heading /
lens / tilt within 3 % of the width), then tries: the agreeing peaks, only the sure ones, every name; the first placed
answer wins. Lens plans per the rule in the module docstring. Local test: `job.py --photo p.jpg --look look.json --stop
LAT,LNG --region grand_teton --rows rows.json --cache terrain/ --out r.json --overlay o.jpg`. Each solve can take ~5 GB of
memory: run at most two at a time on a 16 GB machine.
