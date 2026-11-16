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
