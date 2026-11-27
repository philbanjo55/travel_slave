# Trip brochure (philmframetripbrochure.netlify.app)

One public site for friends and family, covering every trip (Phil, 15 Nov 2026). No personal names anywhere.

- `build_data.py`: pulls trips, days and stops into `data/*.json`.
- `content.py` / `content_v2.py`: day titles, blurbs, the big excursions and extra spots per trip (hand-written).
- `fetch.py` / `meta.py`: Wikimedia Commons photos with their licence credits (credits must stay).
- `build_site.py <work dir> <out dir>`: builds the site. Dinners come from `Dinner: <name>, <time>` lines in each night's stop info (party size, booking site and fees are dropped); `MEAL_STOPS` adds named lunch stops.
- Deploy: zip the out dir and drop it on the Netlify project's Deploys page (project `philmframetripbrochure`).
- New trip: add it to `TRIPS` / day tables in the content files, rebuild, redeploy.

Photos (Phil's scans, downloaded Commons files) are not kept in the repo.
