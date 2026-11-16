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
   - refine the best four: 25 m local grid, then heading / tilt / roll / lens fitted to the photo edges nearest the
     model sky line (window 40 -> 5 px), then the spot and eye height moved by a pattern search; buildings within
     ~1.8 km of the stop are part of the model sky line;
   - confidence: the spot is slid along the line of sight and sideways, the fit redone; the range where the fit stays
     within 0.5 px (or 15 %) of the best is reported in metres ("or more" when it reaches the 1.5 km test edge).
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
