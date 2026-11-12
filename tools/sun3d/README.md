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

## HD picture in the app (`app_view_google.js`, 12 Nov 2026)

The same idea as a page for the app's web view, with the offline page's `S3D` calls and replies
(`app_view.js` is untouched), so `Sun3DPanel.tsx` can swap one for the other ("HD" button).

- `app_view_google.js` -> `node tools/sun3d/build_app_google_html.js <dir with node_modules>` ->
  `src/components/sun/sun3dGoogleHtml.ts` (one page, ~620 KB: three 0.160 + 3d-tiles-renderer 0.3.31
  bundled by esbuild; nothing from a CDN). A second argument also writes the page as a file for tests.
- `init` gets `tiles: { base, draco, root?, headers?, errorTarget?, lodPx?, lift?, wait? }`: `base` is our
  door to Google (`supabase/functions/tiles-proxy`), `draco` the folder with three.js's DRACO decoder files
  (`node_modules/three/examples/jsm/libs/draco/gltf/`: `draco_wasm_wrapper.js`, `draco_decoder.wasm`,
  `draco_decoder.js`), `root` the root tile set when the app already holds it. Every tile address is
  rewritten to `<base>/v1/3dtiles/...`, whatever host or path Google's tile set names.
- The scene is centred where you stand (x east, y up, z south); each tile vertex is mapped back to
  lat / lng to read our light map (checked against the ellipsoid: within ~1 m over the Teton grid). A
  small second camera looks straight down so Google's own ground under you is loaded, and the eye is put
  4 m above it (our grid and Google's surface differ by some metres). Ground beyond our grid gets
  flat-ground light.
- Replies: the offline page's, plus `credits {text}` (Google's attribution: it must be on screen) and
  `hd {shown, loading}`. `error` = give up (root refused, nothing drawn in 20 s, over 40 failed tiles, lost
  graphics context): the app goes back to the offline page.
- Test: `google/app_relay.js` (the door's shape on :8771, with counts) + `google/app_run.js` (drives the
  page headless like the app does). Measured at Snake River Overlook, 400 x 240 at 2x, detail 30: first
  view 502 files / 22 MB, the 100 mm lens 285 files / 16 MB more; full screen (400 x 800) 629 files / 27 MB.
  Detail 20 was 728 files / 31 MB for the first view. Not tried on a phone.
- `tiles-proxy` was run here with Deno against a stand-in for its table (not deployed, table not made):
  the page drew through it, and it refused at the cap (429) and with the count unreachable (503) without
  asking Google.
