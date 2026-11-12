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

## The app's view and two-level terrain (Faroes close-ups, 12 Nov 2026)

- `app_view.js` is the page inside the app's web view (built into `src/components/sun/sun3dHtml.ts` by
  `build_app_html.js <three.min.js r128>`; rebuild after every edit). It takes one wide grid and, optionally,
  one fine grid inside it (`cfg.near`, file sent with `S3D.chunk(b64, 'near')`):
  - the far mesh is cut out inside the fine box (kept for the first ~160 m inside the edge, then pushed down,
    not drawn past ~420 m); the near mesh has its own heights and light map, bunches its points around the
    shot, hangs a skirt at its edge, and fades heights and colours into the far grid's toward the edge;
  - near shadows are marched in the fine grid and carry on into the far grid beyond the box;
  - "is it in the sun" and first / last light read the fine grid when the pin is inside it;
  - a close subject on the fine grid is looked at directly (up or down), not at a fixed slight upward tilt.
  With no `near` the page draws exactly what it did before (Teton check: 0 of 540,000 pixels differ).
- Tables: `terrain_regions` (wide, one per area) and `terrain_near_regions` (fine boxes, `parent` = region).
  `src/services/terrain.ts` `nearFor` picks the smallest box that holds both the stand spot and the subject.
- `build_dem_arctic.py <work dir> <out.png> <north> <south> <west> <east> [n] [res]`: elevation from the
  ArcticDEM v4.1 mosaics (Polar Geospatial Center, CC-BY-4.0, north of 60 N), read in blocks straight from the
  public bucket. Use it instead of `build_dem.py` in the Faroes: the terrarium tiles there carry heights above
  the ellipsoid (~58 m too high), fill the fjords with blocks at 0-130 m (sea drawn as land at any zoom) and
  have no sea stacks. ArcticDEM fills open water at the local sea level, which the script fits and takes off.
  `pip install tifffile imagecodecs`.
- `build_faroes.sh <work dir>`: the wide Faroes file plus the 11 fine boxes (6 MB together).
- What the data cannot do: a height grid has no arches or overhangs (Drangarnir's arch, sea caves), waterfalls
  and buildings are not in it, lakes draw as grass, and the source is a smooth surface model: Stóri Drangur is
  a 50 m cone (really 70 m with an arch), Lítli Drangur a shoulder of the headland. A pin 100 m off now
  matters: the Kallur stand pin sits on the west cliff face in this data.
