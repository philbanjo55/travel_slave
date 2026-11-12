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
