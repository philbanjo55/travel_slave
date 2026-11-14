// The 3D sun view that runs inside the app's web view (TEST app, stop page, Sun & Moon -> 3D).
// The app drives it through window.S3D; it answers with window.ReactNativeWebView.postMessage(JSON).
//   S3D.init(cfg)   cfg = { n, north, south, west, east, W, D, base, step, ground, eye:{lat,lng}, target:{lat,lng}, focal,
//                           near?: { n, north, south, west, east, base, step } }   a small fine grid around the shot, inside the wide one
//                           detail?: { n, north, south, west, east, base, step } }   a third, finest grid around the stand spot (laser survey)
//                             + trees?: { bins, bin }   the trees' own laser returns come too (chunks 'trees')
//                           water?: { n, north, south, west, east }   where the water is in the 6 km around (chunks 'water')
//                           ice?: bool   still water drawn frozen under snow (default: yes where the ground is snow)
//   S3D.chunk(b64)  the elevation file, in base64 pieces; S3D.chunk(b64, 'near') for the fine grid's file,
//                   S3D.chunk(b64, 'detail') for the detail heights, S3D.chunk(b64, 'mask') for its class mask,
//                   S3D.chunk(b64, 'trees') and S3D.chunk(b64, 'water') for the two files above; then S3D.done()
//   S3D.ice(bool)   frozen lakes on / off
//   The foreground (detail box, tree returns, water) never holds the plain view up: done() draws far + near and posts
//   `ready`; the foreground is built after the first frames, in steps, and `foreground` {ok, detail, trees, water, ms}
//   says when it is in, or why it was dropped (the plain view then simply stays). While it is being built the page
//   posts `detail` {stage: 'decode' | 'mask' | 'textures' | 'trees' | 'light' | 'done', ms} so a log shows where a slow
//   phone is. The app sends the foreground after `ready`:
//   S3D.fore({ detail, water, ice })   then its chunks ('detail', 'mask', 'trees', 'water')   then S3D.foreDone().
//   Faroes (13 Nov 2026): also 'color' (the detail box's aerial photo, a JPEG), 'bld' (its building file, JSON) and
//   'ncolor' (the fine box's aerial photo); detail.width / detail.depth = the box's size in the files' own metres. A
//   fine-box photo alone (no detail box) is a foreground too. `foreground` then also says {colour, photos, buildings}.
//   The photos colour the ground (rock on faces steeper than ~50 deg, the mask's water as water, a stream over a cliff
//   as a white fall), the wide grid's grass is tinted toward the photo's mean colour, and the houses (heights guessed)
//   are drawn and throw a drawn shadow; NONE of it reaches lit() / first and last light, which read the ground only.
//   Foreground chunks sent before done() (the test harness) are treated the same way. `lost` = the graphics context went.
//   Grand Teton (13 Nov 2026): 'wcolor' = a winter colour file of the whole wide grid (Sentinel-2, JPEG, north up on
//   its lat / lng grid), a foreground on its own too. Where the ground is snow (cfg.ground !== 'green') 'ncolor' and
//   'color' are winter colour files as well (summer aerial photos turned to winter by the builder,
//   tools/sun3d/teton_colour): all three are ALBEDO, baked into the light passes in place of the calculated colours
//   (forest guess, rock on steep faces, snow), so everything that reads a light map (the next mesh's edge, the water,
//   the trees) carries on as before; the wide mesh gets back the file's own 13 m detail where it is near. The
//   survey's water and buildings keep their own drawing. The Faroes way (photo times light, in the mesh) is unchanged.
//   Park-wide trees (Grand Teton, 13 Nov 2026): fore({..., canopy: { tiles: [{ n, north, south, west, east, step }],
//   range?, max?, light? } }) and each tile's file as S3D.chunk(b64, 'canopy:<index>'): 8-bit PNGs, 0 = no tree, else the
//   canopy's height = value x step m (tools/sun3d/lidar/build_canopy.py, 7 m cells); a tile with lod: 1 has 2 x 2 cells
//   in one, value = (tree cells - 1) x 64 + height / step (the panel sends those beyond 3 km). Built last, on their own, after the
//   rest of the foreground; `wideTrees` {ok, trees, tiles, d0, range, light, ms} says they are in, or {ok: false, msg}
//   that they were left out (the rest stays). Drawn as one point a tree, never in lit() / the sun times. A view() more
//   than 300 m from where they were built builds them again around the new spot.
//   S3D.sun(az, alt)  degrees, from the app's own sun engine      S3D.focal(mm)
//   Smoothness (12 Nov 2026, see "Smooth by construction" below): while the view is being moved (a drag, the time slider,
//   walk mode) frames may be drawn lighter and one full-quality frame follows when it stops. When a movement ends the
//   page posts `perf` {kind: 'look' | 'sun', ms: median frame time, worst, frames, level: 0 full .. 3 low, quality: its
//   name, levels: {look, sun}, px: canvas pixels while moving, pts: tree points drawn, timed: 'fence' | 'frame'}, at
//   most once a second. cfg.level = {look, sun} (the `levels` of an earlier page) starts a new page at those levels.
//   S3D.view(eyeLat, eyeLng, targetLat, targetLng)                S3D.path([[minute, az, alt], ...]) -> 'moments'
// Two levels (Faroes close-ups): the wide grid (far) draws everything; where a near grid is given, the far mesh is cut
// out inside it and a second, finer mesh is drawn there (denser around the shot), lit from its own heights, with
// shadows that carry on into the far grid beyond its edge. The point checks use the finer grid where it holds the pin.
// The subject may sit outside the near box (Tetons: a sharp foreground around the stand spot, the peak 10-25 km off on
// the far grid): the view is aimed as on the far grid alone and the subject's sun is read from the far grid.
// Third level (real foreground, Grand Teton): a detail grid (0.5-1 m cells from a laser survey: the bare ground with
// the buildings on it) is drawn as one more mesh inside the near grid, or inside the far grid when the shot has no near
// box; the coarser meshes are cut out under it. Its class mask (0 ground, 2 building, 3 water, 8+ = tree with its canopy
// height) colours it and says where the trees are. Buildings are blocks with upright walls. Trees are NOT part of the
// surface: they are drawn as a cloud of points you can see between, and they throw only a soft shadow. The sun checks
// (in the sun / first and last light) use ground and buildings only, because the survey was flown in summer and cannot
// tell a bare winter cottonwood from a spruce; `trees: true` in the state / moments messages says when the surveyed
// trees would block the sun at the stand spot. With no `detail` the page draws exactly what it did before.
// Round 3: the tree points sit where the survey's own returns were (64 height slices a cell), so a spruce is a cone
// and a cottonwood a spread crown; water is drawn as water (the sky mirrored, a glint toward a low sun), inside the
// box from its mask and beyond it from a wide layer draped on the coarser meshes; with `ice` still water (lakes,
// ponds, backwaters) is left as snow with a faint blue cast and only moving water (rivers) is open.
// Sharp range (Grand Teton, 14 Nov 2026): fore({..., range: { n, north, south, west, east, base, step, light? } }) and its
// file as S3D.chunk(b64, 'range'): a 2048 x 2048 grid at 5 m over the part of the range the shot looks at (USGS 1 m
// lidar DEM, tools/sun3d/build_range.py). Built FIRST after `ready` (before the detail box), on its own: a fourth level
// between the wide grid and the fine box. The wide mesh is cut out under it (RHOLE) as under the fine box; its own mesh
// bunches its points around the subject, fades into the wide grid along its edge and is cut out under the fine box; the
// fine box's edge fades into it (RNG). It is lit by its own light pass and it DOES feed the sun times (a better grid of
// the same ground): pick() / vis() / snap read it where it holds a point. `range` {ok, n, light, ms} says it is in, or
// {ok: false, msg} that it was left out (the view stays as it was). A small phone (deviceMemory <= 2 or range.light)
// reads every other point (10 m).
// Park-wide buildings (Grand Teton, 14 Nov 2026): fore({..., houses: { tiles: [{ north, south, west, east }], range? } })
// and each tile's JSON as S3D.chunk(b64, 'house:<index>') (tools/sun3d/lidar/build_buildings.py: outline p in metres
// east / south of the tile's north-west corner, e / r = eave / ridge above the ground, a = the ridge's direction, hw, c,
// roof gable | flat). Built after the foreground, on its own: every building within `range` m (8 km) of the stand pin as
// walls and a roof (snow on it where the ground is snow), standing on the ground as drawn, lit by the sun its ground
// gets from the hills (the finest light map there); inside the detail box they also throw a drawn shadow (BSHADOW).
// NEVER in lit() / the sun times. `houses` {ok, count, ms} or {ok: false, msg}.
// Built into src/components/sun/sun3dHtml.ts by tools/sun3d/build_app_html.js. Do not edit the generated file.
(function () {
  const post = m => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) { /* not in the app */ } };
  const say = t => { const m = document.getElementById('msg'); m.textContent = t || ''; m.style.display = t ? 'flex' : 'none'; };
  const fail = t => { say(t); post({ type: 'error', msg: t }); };
  // Give a big array's memory back now, not whenever the collector gets to it: on a small phone the next step needs it.
  // (ArrayBuffer.transfer, web views from 2023 on; elsewhere this does nothing and the collector does it later.)
  const free = a => { try { const b = a && (a.buffer || a); if (b && typeof b.transfer === 'function' && b.byteLength) b.transfer(0); } catch (e) { /* left to the collector */ } };
  window.onerror = msg => { post({ type: 'error', msg: String(msg) }); };

  let cfg = null, parts = [], nparts = [], dparts = [], mparts = [], tparts = [], wparts = [], cparts = [], ncparts = [], bparts = [], wcparts = [], FAR = null, NR = null, DT = null, ice = true, maxH = 4250, minH = 0, baseH = 0;
  let foreState = 0, frames = 0, lastPath = null, touched = false;
  let rparts = [], RG = null, rangeState = 0, hsparts = {}, houseState = 0;   // the sharp range (its file's pieces, the grid, 0 none 1 building 2 in -1 dropped); the park-wide buildings (tile pieces by index, state)
  let cnparts = {}, cnbytes = {}, cnlast = -1, wideTiles = null, wideState = 0, wideRun = 0;   // park-wide trees: tile pieces by index, each tile's packed bytes once its pieces are in, the tile coming in, the packed files, 0 none 1 building 2 in -1 dropped
  const cnAny = () => Object.keys(cnparts).length > 0 || Object.keys(cnbytes).length > 0;   // foreground: 0 none, 1 on its way, 2 in, -1 dropped
  let R = null;   // everything three.js, once built
  let eye = null, eye0 = null, target = null, yaw = 0, pitch = 0, focal = 50, lens = { f: 135, fw: 120, fh: 96, box: true }, inline = false, sun = { az: 180, alt: 20 }, dirty = true, relight = true;
  const G = 768;  // mesh points per side

  // ---- Smooth by construction (12 Nov 2026; measured in tools/sun3d/README.md, "Smoothness") ----
  // 1. Nothing is drawn that cannot be seen. Each mesh's triangles are kept in NB x NB blocks and a frame draws only
  //    the blocks whose box touches the view: the same picture from a fraction of the triangles.
  // 2. Never more than one frame on the graphics card. A new frame is not sent until the last one is done (a fence),
  //    so a slow phone shows the newest heading / sun / spot, not a queue of old ones. The time from a frame's start
  //    to its fence is the frame time the page reports ('perf') and steers by.
  // 3. Sharp when still, lighter while moving. While a drag, a run of sun positions (the time slider) or a run of
  //    walk steps is going on, frames are drawn at the level the phone has shown it keeps up with (QL: canvas
  //    resolution, share of the tree points, size of the light pass, and at the two lowest levels every other point
  //    of the meshes: first the near and detail ones, whose triangles are smaller than a pixel anyway, last the far
  //    one, which is the skyline). When it stops, one frame is drawn at full quality, with the full light pass if
  //    the sun moved.
  // 4. The governor. Average frame time while moving over SLOW_MS: one level down; under FAST_MS: one level up (a
  //    level that proved too slow right after a step up is not tried again). Two levels are kept, one for looking
  //    around / walking and one for the sun (which also pays for a light pass); the app hands them back at the next
  //    start (cfg.level), so the next stop begins where this one ended.
  const NB = 16, BS = Math.ceil((G - 1) / NB), bedge = k => Math.min(G - 1, k * BS), BSTART = new Uint32Array(NB * NB + 1), BSTART2 = new Uint32Array(NB * NB + 1);
  const QL = [{ res: 1, trees: 1, wide: 1, lt: 0, geo: 0 }, { res: 0.75, trees: 1, wide: 0.75, lt: 1, geo: 0 }, { res: 0.6, trees: 0.5, wide: 0.4, lt: 1, geo: 1 }, { res: 0.5, trees: 0.3, wide: 0, lt: 2, geo: 2 }];
  const QN = ['full', 'high', 'medium', 'low'];
  const SLOW_MS = 24, FAST_MS = 12, REST = { look: 150, sun: 260, walk: 280 };   // ms after the last change before the sharp frame (walk steps come 130 ms apart; the full light pass is heavy, so the sun waits as long as it always did)
  const PX_MAX = 1400000;   // canvas pixels at most: 2 device pixels a point on a phone screen (412 x 800 at 2 = 1.32 M), less on a bigger one
  const lv = { look: 0, sun: 0 }, noUp = { look: [], sun: [] }, tried = { look: false, sun: false };
  let act = null, owe = false, quick = false, sharp = false, restTimer = null, resting = false, lastPerf = -1e9, lensKey = '';
  const gate = { sync: null, t0: 0, act: null, gov: false, off: false, wait: false, poll: null };

  // A grid: n x n heights (HF, row 0 = north) over a lat/lng box; x0, z0, w, d place it in the far grid's metres.
  const gh = (g, c, r) => {
    const n = g.n, H = g.HF;
    c = Math.max(0, Math.min(n - 1.001, c)); r = Math.max(0, Math.min(n - 1.001, r));
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * n + c0;
    return (H[i] * (1 - fc) + H[i + 1] * fc) * (1 - fr) + (H[i + n] * (1 - fc) + H[i + n + 1] * fc) * fr;
  };
  const crg = (g, p) => ({ c: (p.lng - g.west) / (g.east - g.west) * g.n - 0.5, r: (g.north - p.lat) / (g.north - g.south) * g.n - 0.5 });
  const cr = p => crg(FAR, p);
  // the grid a pin is read from: the near one when the pin is inside it, past the strip where the two meshes meet
  const pick = p => {
    if (DT) { const q = crg(DT, p); if (Math.min((q.c + 0.5) * DT.dx, (DT.n - 0.5 - q.c) * DT.dx, (q.r + 0.5) * DT.dz, (DT.n - 0.5 - q.r) * DT.dz) >= DT.band) return { g: DT, c: q.c, r: q.r }; }
    if (NR) { const q = crg(NR, p); if (Math.min((q.c + 0.5) * NR.dx, (NR.n - 0.5 - q.c) * NR.dx, (q.r + 0.5) * NR.dz, (NR.n - 0.5 - q.r) * NR.dz) >= NR.band) return { g: NR, c: q.c, r: q.r }; }
    if (RG) { const q = crg(RG, p); if (Math.min((q.c + 0.5) * RG.dx, (RG.n - 0.5 - q.c) * RG.dx, (q.r + 0.5) * RG.dz, (RG.n - 0.5 - q.r) * RG.dz) >= RG.band) return { g: RG, c: q.c, r: q.r }; }
    const q = cr(p); return { g: FAR, c: q.c, r: q.r };
  };
  // From a point toward the sun. On the detail grid the steps are short (trees, roofs) and the point sits `lift` m above
  // the survey's surface; past a grid's edge the walk carries on in the next coarser grid (g.up).
  const treeH = (cc, rr) => { const n = DT.n, v = DT.kind ? DT.kind[Math.max(0, Math.min(n - 1, Math.round(rr))) * n + Math.max(0, Math.min(n - 1, Math.round(cc)))] : 0; return v >= 8 ? (v - 8) * 0.2 : 0; };
  function vis(p, ux, uz, tanA, trees) {
    const fine = p.g === DT, lift = fine ? DT.lift : 3, K = RG || fine ? 2000 : 260;   // (a 1.5 km laser box takes ~400 short steps before the ray leaves it: it must still reach the range 10-20 km off)
    let g = p.g, c = p.c, r = p.r, L = fine ? 0.7 : g === NR ? 5 : g === RG ? 6 : 30, d = 0, v = 1;
    for (let k = 0; k < K; k++) {
      d += L; let cc = c + ux * d / g.dx, rr = r + uz * d / g.dz; const hh = p.h + lift + tanA * d;
      while (g !== FAR && (cc < 0 || rr < 0 || cc > g.n - 1 || rr > g.n - 1)) {   // past a fine grid's edge: carry on in the next coarser one
        const up = g.up;
        c = (g.x0 + (c + 0.5) * g.dx - up.x0) / up.dx - 0.5; r = (g.z0 + (r + 0.5) * g.dz - up.z0) / up.dz - 0.5; g = up;
        cc = c + ux * d / g.dx; rr = r + uz * d / g.dz;
      }
      if (g === FAR && RG) {   // on the wide grid and into the range's box: carry on in its 5 m grid (the ridges the sun goes behind)
        const rc = ((cc + 0.5) * FAR.dx - RG.x0) / RG.dx - 0.5, r2 = ((rr + 0.5) * FAR.dz - RG.z0) / RG.dz - 0.5;
        if (rc > 2 && r2 > 2 && rc < RG.n - 3 && r2 < RG.n - 3) { c = ((c + 0.5) * FAR.dx - RG.x0) / RG.dx - 0.5; r = ((r + 0.5) * FAR.dz - RG.z0) / RG.dz - 0.5; g = RG; cc = rc; rr = r2; }
      }
      if (cc < 0 || rr < 0 || cc > g.n - 1 || rr > g.n - 1 || hh > maxH) break;
      let cl = hh - gh(g, cc, rr);
      if (trees && g === DT) cl -= treeH(cc, rr);   // only for the "trees may block the sun" note, never for the times
      if (cl <= 0) return 0;
      const s = cl / (d * 0.02); if (s < v) v = s;
      L = g === DT ? Math.min(L * 1.02, 2.5) : g === RG ? Math.min(L * 1.03, 12) : L * 1.03;
    }
    return v;
  }
  // the highest grid point close to a pin: a summit pin a few metres off would sit in the summit's own shadow
  const snapR = g => g === NR ? 6 : g === RG && FAR ? Math.max(6, Math.round(4 * Math.max(FAR.dx, FAR.dz) / Math.max(g.dx, g.dz))) : 4;   // the same ground on the range grid as the wide grid's 4 cells (~108 m), ~35 m on the fine box
  const snap = (q, rad) => { const g = q.g, n = g.n; let best = null; for (let r = Math.round(q.r) - rad; r <= Math.round(q.r) + rad; r++) for (let c = Math.round(q.c) - rad; c <= Math.round(q.c) + rad; c++) { if (r < 0 || c < 0 || r >= n || c >= n) continue; const h = g.HF[r * n + c]; if (!best || h > best.h) best = { g, c, r, h }; } return best; };
  const sunVec = (az, alt) => { const a = alt * Math.PI / 180, z = az * Math.PI / 180; return { x: Math.sin(z) * Math.cos(a), y: Math.sin(a), z: -Math.cos(z) * Math.cos(a), tan: Math.tan(a), hx: Math.sin(z), hz: -Math.cos(z) }; };
  const far = () => { const a = cr(eye), b = cr(target); return Math.hypot((b.c - a.c) * FAR.dx, (b.r - a.r) * FAR.dz); };
  const subjPoint = () => { const t = pick(target), q = far() > 3000 ? snap(t, snapR(t.g)) : null; if (q) return q; return { g: t.g, c: t.c, r: t.r, h: gh(t.g, t.c, t.r) + 6 }; };
  // The subject counts as lit when either that point or the pin itself is (12 Nov 2026). The nearby high point alone
  // went wrong for a pin at the foot of a wall: Teton Point Turnout's "main" sits in the Teton Glacier bowl under the
  // Grand, its "highest point nearby" is a spot part-way up the wall, which the wall shades all day, so the view said
  // "never in the sun" (Phil's screenshot) although the bowl has the sun from sunrise for an hour or more. Checking
  // both can only add lit time to what the first rule gave.
  const pinPoint = () => { const t = pick(target); return { g: t.g, c: t.c, r: t.r, h: gh(t.g, t.c, t.r) + 6 }; };
  const subjLit = (az, alt, s, q) => lit(s || subjPoint(), az, alt) || lit(q || pinPoint(), az, alt);
  const herePoint = () => { const e = pick(eye); return { g: e.g, c: e.c, r: e.r, h: gh(e.g, e.c, e.r) }; };
  // where the camera stands: eye height EYE m (Phil, 13 Nov 2026: "Do 5,8" = 1.73 m, the height his own photos are taken from; was 2 m on the
  // detail grid, 3 m elsewhere). On the near grid the highest ground within a step and a half, so a pin on a steep slope does not
  // put the eye inside the hill; on the wide grid the ground there; on the detail grid the survey's ground is exact.
  const EYE = 1.73;
  const eyeH = e => { if (e.g === DT) return gh(e.g, e.c, e.r) + EYE; let h = gh(e.g, e.c, e.r); if (e.g === NR || e.g === RG) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) h = Math.max(h, gh(e.g, e.c + a * 1.5, e.r + b * 1.5)); return h + EYE; };
  // First / last direct light. Measured 12 Nov 2026 against 102 webcam pictures (27 events, tools/sun3d/README.md): with
  // the first rule (whole disc clear of a soft skyline, never below the flat horizon) ridge-blocked events were right to
  // a few minutes but sunrise / sunset on high points were 5-13 min off. Now: the sun's CENTRE against a hard skyline
  // ("half the sun showing"), and a high point sees a little below the flat horizon (0.95 deg x sqrt of its km above the
  // area's low ground). Scored on the picture events: high-point sunrise / sunset 9 of 12 inside the picture window
  // (was 2), ridge-blocked 4 of 4 at +2 min. The sun's top edge scored 10 of 12 but put ridge events +3.3 min late.
  const dipOf = h => 0.95 * Math.sqrt(Math.max(0, h - baseH) / 1000);
  const lit = (p, az, alt, trees) => { if (alt <= -dipOf(p.h)) return false; const v = sunVec(az, alt); return vis(p, v.hx, v.hz, v.tan, trees) > 0; };
  // the surveyed trees would hide a sun that ground and buildings let through (stand spot on the detail grid only)
  const treesBlock = (p, az, alt) => !!(DT && p.g === DT && DT.kind && !lit(p, az, alt, true));

  const KEY = [
    [-18, [1, .5, .3], 0, [.030, .036, .060], [.010, .014, .035], [.030, .040, .080]], [-8, [1, .5, .3], 0, [.085, .105, .180], [.050, .075, .190], [.200, .190, .300]],
    [-3, [1, .45, .3], 0, [.200, .220, .330], [.110, .170, .380], [.780, .470, .400]], [0, [1, .47, .28], .55, [.270, .290, .400], [.170, .270, .520], [.950, .620, .430]],
    [3, [1, .62, .40], .85, [.300, .340, .460], [.200, .330, .620], [.960, .760, .580]], [8, [1, .82, .64], 1.0, [.310, .370, .500], [.200, .380, .720], [.820, .840, .880]],
    [16, [1, .93, .82], 1.05, [.320, .390, .530], [.190, .400, .780], [.720, .820, .920]], [30, [1, .97, .92], 1.1, [.330, .400, .540], [.180, .400, .800], [.700, .810, .930]]];
  function atmo(alt) {
    let a = KEY[0], b = KEY[KEY.length - 1];
    for (let i = 0; i < KEY.length - 1; i++) if (alt >= KEY[i][0] && alt <= KEY[i + 1][0]) { a = KEY[i]; b = KEY[i + 1]; break; }
    if (alt <= KEY[0][0]) b = a; if (alt >= b[0]) a = b;
    const t = a === b ? 0 : (alt - a[0]) / (b[0] - a[0]), m = (p, q) => p.map((v, i) => v + (q[i] - v) * t);
    return { sun: m(a[1], b[1]), sunI: a[2] + (b[2] - a[2]) * t, amb: m(a[3], b[3]), zen: m(a[4], b[4]), hor: m(a[5], b[5]) };
  }

  const LIGHT_FS = `
    precision highp float;
    uniform sampler2D hmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec2 size; uniform float texel; uniform float snowMode; uniform float maxH; uniform float baseH;
    #ifdef NEAR
    uniform sampler2D fmap; uniform vec4 rect; uniform vec2 fsize; uniform float step0; uniform float fcells;
    #endif
    #ifdef FTINT
    uniform vec3 tintK;   // the wide grid's grass toward the mean colour of the area's aerial photo (Faroes): no stamp edge round the photo
    #endif
    #ifdef APHOTO
    uniform sampler2D aphoto; uniform vec4 arect;   // a winter colour file (albedo, as seen): this grid's uv -> the file's
    #endif
    #ifdef BSHADOW
    uniform sampler2D bmap;   // house heights above the ground / 51 m (assumed heights): a drawn shadow only, never in the sun times
    #endif
    #ifdef DETAIL
    uniform sampler2D kmap; uniform float lift; uniform float ice;
    #ifdef MID
    uniform sampler2D mmap; uniform vec4 mrect;
    #endif
    #endif
    varying vec2 vUv;
    float H(vec2 uv) { vec2 t = texture2D(hmap, uv).rg; return t.r + t.g; }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
    void main() {
      float h = H(vUv);
      float hx = (H(vUv + vec2(texel, 0.)) - H(vUv - vec2(texel, 0.))) / (2. * texel * size.x);
      float hz = (H(vUv + vec2(0., texel)) - H(vUv - vec2(0., texel))) / (2. * texel * size.y);
      vec3 n = normalize(vec3(-hx, 1., -hz));
      float slope = degrees(acos(n.y));
      vec2 g = vUv / texel;
    #ifdef NEAR
      vec2 gp = (rect.xy + vUv * rect.zw) / fsize * fcells;   // patches follow the far grid's cells, so tints and tree patches run on across the box edge
    #else
      vec2 gp = g;
    #endif
      float fine = hash(floor(g)), pch = vnoise(gp / 9.) * .6 + vnoise(gp / 2.5) * .4;
      vec3 alb;
      if (snowMode > .5) {
    #ifdef APHOTO
        alb = pow(texture2D(aphoto, arect.xy + vUv * arect.zw).rgb, vec3(1.613));   // what was there on a winter day, not a guess
        // a 10 m picture from above sees a cliff only as its ledges (snow): snow does not hold past ~55 deg, so the steepest
        // faces are the rock they are (the Grand's summit block, the canyon walls)
        alb = mix(alb, vec3(.27, .26, .26) + fine * .06, smoothstep(44., 60., slope + fine * 6.) * .85);
    #else
        float rock = smoothstep(37., 53., slope + fine * 7.);
        float forest = smoothstep(2040., 2110., h) * (1. - smoothstep(2600., 2950., h + pch * 260.)) * smoothstep(3., 8., slope + pch * 4.) * (1. - rock) * smoothstep(.25, .6, pch + fine * .25);
        alb = vec3(.93, .95, .98);
        alb = mix(alb, vec3(.24, .31, .29) + fine * .08, forest * .9);
        alb = mix(alb, vec3(.38, .36, .37) + fine * .06, rock);
    #endif
      } else {
        float rock = smoothstep(33., 50., slope + fine * 7.);
        vec3 grass = mix(vec3(.25, .36, .16), vec3(.37, .38, .22), smoothstep(120., 620., h + pch * 160.));
    #ifdef FTINT
        grass *= tintK;
    #endif
        alb = mix(grass + fine * .05, vec3(.34, .32, .31) + fine * .06, rock);
        if (h < .6) alb = vec3(.07, .16, .24);
      }
    #ifdef DETAIL
      float va = 0.;
      {   // the survey says what each cell is (g building and the cells beside it, b water: 1 moving, .5 still, a tree canopy height): no guessed forest, rock only on open ground
        vec4 kind = texture2D(kmap, vUv); float open = 1. - clamp((kind.g + kind.b) * 3., 0., 1.);
        float wW = clamp(kind.b * 2., 0., 1.), flow = ice > .5 ? smoothstep(.6, .9, kind.b) : 1.;
        vec3 frozen = mix(vec3(.74, .80, .88), vec3(.90, .93, .97), smoothstep(.25, .95, wW));   // snow on ice, a faint darker line along the shore
        vec3 wood = vec3(.41, .31, .23) * (.72 + fine * .26 + .34 * vnoise(g * vec2(.8, .22))), water;   // weathered boards, no two alike
        float roof = 1. - smoothstep(48., 62., slope);
        if (snowMode > .5) {
    #ifdef APHOTO
          alb = pow(texture2D(aphoto, arect.xy + vUv * arect.zw).rgb, vec3(1.613));   // the winter colour file; water and boards below as before
    #else
          alb = mix(vec3(.93, .95, .98), vec3(.38, .36, .37) + fine * .06, smoothstep(37., 53., slope + fine * 7.) * open);
    #endif
          water = vec3(.11, .17, .22);
          wood = mix(wood, vec3(.90, .92, .95), roof * (.3 + .35 * (1. - smoothstep(20., 36., slope))));   // a roof is a touch lighter under snow, more so where it is flat
        } else {
          vec3 grass = mix(vec3(.25, .36, .16), vec3(.37, .38, .22), smoothstep(120., 620., h + pch * 160.));
          alb = mix(grass + fine * .05, vec3(.34, .32, .31) + fine * .06, smoothstep(33., 50., slope + fine * 7.) * open);
          water = vec3(.07, .16, .24); wood = mix(wood, wood * 1.18, roof);
        }
        alb = mix(alb, mix(frozen, water, flow), wW); alb = mix(alb, wood, kind.g);
      }
    #endif
      float d = 0.;
      float sa = 0.;   // the ground's sun visibility (hills only), for the park-wide trees: in alpha, which nothing else reads
      if (sunDir.y > -sin(radians(.95) * sqrt(max(0., h - baseH) / 1000.))) {   // a high point still sees a sun just under the flat horizon
        float lam = dot(n, sunDir);
    #ifdef PHOTO
        // ground under an aerial photo (Faroes): this pass gives the light only (the photo is the colour, in the mesh);
        // an upright face in a 1-4 m grid is a row of facets, so its light is evened out
        float lamE = max(lam, 0.); lamE = mix(lamE, .5 * lamE + .22, smoothstep(55., 75., slope));
    #else
        float lamE = lam;
    #endif
    #ifdef DETAIL
        {   // worked out for every cell, facing the sun or not: the tree points above it read the result (alpha)
    #else
        if (lamE > 0.) {
    #endif
          vec2 dir = normalize(sunDir.xz) / size; float tanA = sunDir.y / length(sunDir.xz);
    #ifdef DETAIL
          float L = step0, dist = 0., v = 1., ts = 0., vg = 1.;
          for (int k = 0; k < 300; k++) {   // short steps among the roofs, longer ones once past the box
            dist += L; vec2 p = vUv + dir * dist; float hh = h + lift + tanA * dist;
            if (hh > maxH) break;
            float gr, bh = 0.;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1.) {
              vec2 w = rect.xy + p * rect.zw, q = w / fsize;
              if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) break;
              vec2 t = texture2D(fmap, q).rg; gr = t.r + t.g;
    #ifdef MID
              vec2 u = (w - mrect.xy) / mrect.zw;
              if (u.x > 0. && u.y > 0. && u.x < 1. && u.y < 1.) { vec2 m = texture2D(mmap, u).rg; gr = m.r + m.g; }
    #endif
              L *= 1.06;
            } else {
              gr = H(p); if (hh - gr < texture2D(kmap, p).a * 51.) ts += L * .2; L = min(L * 1.025, 3.);   // under a tree's canopy: a soft shadow that grows with the way through it
    #ifdef BSHADOW
              bh = texture2D(bmap, p).r * 51.;
    #endif
            }
            float cl = hh - gr;
    #ifdef BSHADOW
            // v: ground and houses (the picture's shadows); vg: ground only (alpha: what the houses' own walls and the water read)
            if (cl <= 0.) { v = 0.; vg = 0.; break; }
            vg = min(vg, cl / (dist * .02)); v = min(v, (cl - bh) / (dist * .02));
    #else
            if (cl <= 0.) { v = 0.; break; }
            v = min(v, cl / (dist * .02));
    #endif
          }
    #ifdef BSHADOW
          v = max(v, 0.);
    #endif
    #else
    #ifdef NEAR
          float L = step0, dist = 0., v = 1.;
          for (int k = 0; k < 128; k++) {
            dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
            if (hh > maxH) break;
            float gr;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1.) {
              vec2 q = (rect.xy + p * rect.zw) / fsize;
              if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) break;
              vec2 t = texture2D(fmap, q).rg; gr = t.r + t.g;
            } else gr = H(p);
            float cl = hh - gr;
            if (cl <= 0.) { v = 0.; break; }
            v = min(v, cl / (dist * .02)); L *= 1.045;
          }
    #else
          float L = 34., dist = 0., v = 1.;
          for (int k = 0; k < 110; k++) {
            dist += L; vec2 p = vUv + dir * dist; float hh = h + 3. + tanA * dist;
            if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1. || hh > maxH) break;
            float cl = hh - H(p);
            if (cl <= 0.) { v = 0.; break; }
            v = min(v, cl / (dist * .02)); L *= 1.045;
          }
    #endif
    #endif
    #ifdef DETAIL
          d = max(lamE, 0.) * v * (1. - .5 * min(ts, 1.)); va = v;   // tree shade is lighter than a hill's or a barn's
    #ifdef BSHADOW
          va = vg;
    #endif
    #else
          d = lamE * v;
          sa = v;
    #endif
        }
      }
    #ifdef PHOTO
      vec3 c = amb * (.72 + .28 * n.y) + sunCol * d;
    #else
      vec3 c = alb * (amb * (.72 + .28 * n.y) + sunCol * d);
    #endif
    #ifdef DETAIL
      gl_FragColor = vec4(pow(min(c * .9, vec3(1.)), vec3(.62)), va);
    #else
      gl_FragColor = vec4(pow(min(c * .9, vec3(1.)), vec3(.62)), sa);   // (the colour as before; alpha was 1 and nothing read it)
    #endif
    }`;
  // The far mesh. With a near grid (HOLE) it is cut out inside the near box: untouched for the first `keep` metres inside the
  // edge (the near mesh matches it there), then pushed down under the near mesh, and not drawn at all past `band` metres.
  // Open water, the same in the box and beyond it: flat, so it mirrors the sky (more of it the flatter you look), a dark
  // body under that, and a glint where the mirrored view meets a low sun, with a soft skirt for the ripples.
  // wideWater: the water of the 6 km around, painted on whichever mesh is drawn there (no mesh of its own). The layer
  // says 1 moving, .5 still; with `ice` still water is only a faint blue cast on the snow.
  const WATER_GLSL = `
    uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyZen; uniform vec3 skyHor; uniform float ice;
    vec3 waterCol(vec3 P, float sunVis) {
      vec3 V = normalize(cameraPosition - P), M = vec3(-V.x, V.y, -V.z);
      float fres = .03 + .97 * pow(1. - clamp(V.y, 0., 1.), 5.), day = clamp(dot(skyZen, vec3(.4, .4, .3)) * 2.4, .06, 1.);
      vec3 sky = mix(skyHor, skyZen, pow(max(M.y, 0.), .45));
      vec3 c = mix(vec3(.045, .095, .13) * day, sky * .82, fres * .9 + .08);
      float g = max(dot(M, sunDir), 0.);
      return c + sunCol * sunVis * (pow(g, 140.) * 1.1 + pow(g, 18.) * .22);
    }
    #ifdef WATER
    uniform sampler2D wmap; uniform vec4 wrect;
    vec3 wideWater(vec3 c, vec3 P) {
      vec2 u = (P.xz - wrect.xy) / wrect.zw;
      if (u.x <= 0. || u.y <= 0. || u.x >= 1. || u.y >= 1.) return c;
      float b = texture2D(wmap, u).r; if (b < .25) return c;
      return (ice > .5 ? smoothstep(.6, .9, b) : 1.) > .5 ? waterCol(P, smoothstep(-.02, .06, sunDir.y)) : mix(c, vec3(.64, .77, .94), .28);
    }
    #endif`;
  const TERRAIN_VS = `
    uniform sampler2D hmap; uniform vec2 size; varying vec2 vUv; varying float vDist;
    #ifdef HOLE
    uniform vec4 hole; uniform float keep; uniform float band;
    #endif
    #ifdef DHOLE
    uniform vec4 dhole; uniform float dkeep; uniform float dband;
    #endif
    #ifdef RHOLE
    uniform vec4 rhole; uniform float rkeep; uniform float rband;
    #endif
    #ifdef WATER
    varying vec3 vP;
    #endif
    void main() {
      vUv = position.xz; vec2 t = texture2D(hmap, vUv).rg; float y = t.r + t.g;
    #ifdef RHOLE
      { vec2 w3 = vUv * size; float d3 = min(min(w3.x - rhole.x, rhole.z - w3.x), min(w3.y - rhole.y, rhole.w - w3.y)); y -= clamp(d3 - rkeep, 0., rband) * .5; }
    #endif
    #ifdef HOLE
      vec2 w = vUv * size; float din = min(min(w.x - hole.x, hole.z - w.x), min(w.y - hole.y, hole.w - w.y));
      y -= clamp(din - keep, 0., band) * .5;
    #endif
    #ifdef DHOLE
      { vec2 w2 = vUv * size; float d2 = min(min(w2.x - dhole.x, dhole.z - w2.x), min(w2.y - dhole.y, dhole.w - w2.y)); y -= clamp(d2 - dkeep, 0., dband - dkeep) * 1.5; }
    #endif
    #ifdef WATER
      vP = vec3(vUv.x * size.x, y, vUv.y * size.y);
    #endif
      vec4 mv = viewMatrix * vec4(vUv.x * size.x, y, vUv.y * size.y, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
    }`;
  const TERRAIN_FS = `
    precision highp float; uniform sampler2D lmap; uniform vec3 fogCol; uniform float fogD; varying vec2 vUv; varying float vDist;
    #ifdef HOLE
    uniform vec2 size; uniform vec4 hole; uniform float band;
    #endif
    #ifdef DHOLE
    uniform vec2 dsize; uniform vec4 dhole; uniform float dband;
    #endif
    #ifdef RHOLE
    uniform vec2 rsize; uniform vec4 rhole; uniform float rband;
    #endif
    #ifdef WATER
    varying vec3 vP;
    ` + WATER_GLSL + `
    #endif
    #ifdef WDET
    uniform sampler2D wphoto; uniform float wlod;   // the winter colour file, finer than the light map: its detail back on top
    #endif
    void main() {
    #ifdef HOLE
      vec2 w = vUv * size; if (min(min(w.x - hole.x, hole.z - w.x), min(w.y - hole.y, hole.w - w.y)) > band) discard;
    #endif
    #ifdef DHOLE
      { vec2 w2 = vUv * dsize; if (min(min(w2.x - dhole.x, dhole.z - w2.x), min(w2.y - dhole.y, dhole.w - w2.y)) > dband) discard; }
    #endif
    #ifdef RHOLE
      { vec2 w3 = vUv * rsize; if (min(min(w3.x - rhole.x, rhole.z - w3.x), min(w3.y - rhole.y, rhole.w - w3.y)) > rband) discard; }
    #endif
      vec3 c = texture2D(lmap, vUv).rgb;
    #ifdef WDET
      { vec3 pf = texture2D(wphoto, vUv).rgb, pc = textureLod(wphoto, vUv, wlod).rgb; c *= clamp((pf + .03) / (pc + .03), .55, 1.6); }
    #endif
    #ifdef WATER
      c = wideWater(c, vP);
    #endif
      float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.);
    }`;
  // The near mesh: its points bunch up around `focus` (the shot), its outer ring hangs down as a skirt, and toward the box
  // edge both its heights and its colours fade into the far grid's, so the two meshes meet without a step.
  // The detail mesh is the same thing one level down: with MID its surroundings are the near mesh (itself fading into the
  // far grid along its own edge), and DHOLE cuts the near mesh out under the detail mesh as HOLE does the far mesh.
  const NEAR_VS = `
    uniform sampler2D hmap; uniform sampler2D fmap; uniform vec4 rect; uniform vec2 fsize; uniform vec2 focus; uniform float keep; uniform float band;
    #ifdef MID
    uniform sampler2D mmap; uniform vec4 mrect; uniform float mkeep; uniform float mband; uniform float skirt; varying vec2 vM; varying float vMT;
    #endif
    #ifdef DHOLE
    uniform vec4 dhole; uniform float dkeep; uniform float dband; varying vec2 vW;
    #endif
    varying vec2 vUv; varying vec2 vF; varying float vT; varying float vDist;
    #ifdef RNG
    uniform sampler2D rmap; uniform vec4 rrect; uniform float rkeep; uniform float rband; varying vec2 vR; varying float vRT;
    #endif
    #if defined(BLD) || defined(WATER) || defined(NPHOTO)
    varying vec3 vP;
    #endif
    #ifdef BLD
    // The detail mesh: a wall stays a wall. Heights are blended only between cells of the same kind (building or not),
    // so a roof keeps its ridge and its edge drops straight to the ground instead of melting into it.
    uniform sampler2D kmap; uniform float cells;
    float Hc(ivec2 p) { vec2 t = texelFetch(hmap, p, 0).rg; return t.r + t.g; }
    float Hd(vec2 uv) {
      vec2 st = uv * cells - .5, f = st - floor(st); ivec2 lim = ivec2(int(cells) - 1), b0 = ivec2(floor(st));
      ivec2 nn = clamp(ivec2(floor(uv * cells)), ivec2(0), lim); bool mine = texelFetch(kmap, nn, 0).r > .5;
      float hs = 0., ws = 0.;
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        ivec2 p = clamp(b0 + ivec2(i, j), ivec2(0), lim); float w = (i == 0 ? 1. - f.x : f.x) * (j == 0 ? 1. - f.y : f.y);
        if ((texelFetch(kmap, p, 0).r > .5) == mine) { hs += w * Hc(p); ws += w; }
      }
      return ws > 1e-4 ? hs / ws : Hc(nn);
    }
    #endif
    uniform float wk;   // how much the points bunch at the focus: the spacing there is wk x the mean (.35; the range's mesh .2)
    float wp(float s, float f) { float d = s - f; float m = d < 0. ? f : 1. - f; if (m < .0005) return f; float x = abs(d) / m; return f + sign(d) * m * x * (wk + (1. - wk) * x * x); }
    void main() {
      vec2 uv = vec2(wp(position.x, focus.x), wp(position.z, focus.y));
      vec2 w = rect.xy + uv * rect.zw; vUv = uv; vF = w / fsize;
      float din = min(min(uv.x, 1. - uv.x) * rect.z, min(uv.y, 1. - uv.y) * rect.w);
      vT = smoothstep(keep, band, din);
      vec2 a = texture2D(hmap, uv).rg; vec2 b = texture2D(fmap, vF).rg;
    #ifdef RNG
      vR = (w - rrect.xy) / rrect.zw; vRT = smoothstep(rkeep, rband, min(min(vR.x, 1. - vR.x) * rrect.z, min(vR.y, 1. - vR.y) * rrect.w));
      if (vRT > 0.) { vec2 rh = texture2D(rmap, vR).rg; b = vec2(mix(b.r + b.g, rh.r + rh.g, vRT), 0.); }   // where the range's mesh is drawn, its heights
    #endif
    #ifdef BLD
      a = vec2(Hd(uv), 0.);
    #endif
    #ifdef MID
      vM = (w - mrect.xy) / mrect.zw; vMT = smoothstep(mkeep, mband, min(min(vM.x, 1. - vM.x) * mrect.z, min(vM.y, 1. - vM.y) * mrect.w));
      vec2 m = texture2D(mmap, vM).rg;
      float y = mix(mix(b.r + b.g, m.r + m.g, vMT), a.r + a.g, vT) - position.y * skirt;
    #else
      float y = mix(b.r + b.g, a.r + a.g, vT) - position.y * 90.;
    #endif
    #ifdef DHOLE
      vW = w; { float d2 = min(min(w.x - dhole.x, dhole.z - w.x), min(w.y - dhole.y, dhole.w - w.y)); y -= clamp(d2 - dkeep, 0., dband - dkeep) * 1.5; }
    #endif
    #if defined(BLD) || defined(WATER) || defined(NPHOTO)
      vP = vec3(w.x, y, w.y);
    #endif
      vec4 mv = viewMatrix * vec4(w.x, y, w.y, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
    }`;
  const NEAR_FS = `
    precision highp float; uniform sampler2D lmap; uniform sampler2D flmap; uniform vec3 fogCol; uniform float fogD; varying vec2 vUv; varying vec2 vF; varying float vT; varying float vDist;
    #ifdef MID
    uniform sampler2D mlmap; varying vec2 vM; varying float vMT;
    #endif
    #ifdef RNG
    uniform sampler2D rlmap; varying vec2 vR; varying float vRT;
    #endif
    #ifdef DHOLE
    uniform vec4 dhole; uniform float dband; varying vec2 vW;
    #endif
    #if defined(BLD) || defined(WATER) || defined(NPHOTO)
    varying vec3 vP;
    ` + WATER_GLSL + `
    #endif
    #ifdef BLD
    uniform sampler2D kmap;
    #endif
    #if defined(NPHOTO) || defined(DPHOTO)
    #define PH_ANY 1
    #endif
    #ifdef PH_ANY
    // Ground under an aerial photo (Faroes, 13 Nov 2026): the photo is the colour (north up on the box's own lat / lng
    // grid), the light map gives the light. Faces steeper than about 50 degrees show nothing in a photo from above and
    // are drawn as rock in beds; the sea, lakes and streams of the mask as water; a stream on steep ground as a white fall.
    uniform sampler2D hmap; uniform vec4 rect; uniform float pcells; uniform vec3 rockC; uniform vec3 tintC;
    #if defined(NPHOTO) || defined(NPH)
    uniform sampler2D nphoto;
    #endif
    #ifdef DPHOTO
    uniform sampler2D dphoto;
    #endif
    float phash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float pnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(phash(i), phash(i + vec2(1., 0.)), f.x), mix(phash(i + vec2(0., 1.)), phash(i + vec2(1.)), f.x), f.y); }
    float Hp(vec2 uv) { vec2 t = texture2D(hmap, uv).rg; return t.r + t.g; }
    vec3 cliff(vec3 P, float slope) {   // basalt in beds: flat-lying bands by height, darker joints, a little grass on the ledges
      float bed = pnoise(vec2(P.y * .30, (P.x + P.z) * .012)), fn = pnoise(vec2(P.y * 1.7, (P.x - P.z) * .05)), jt = pnoise(vec2((P.x - P.z) * .16, P.y * .03));
      vec3 c = rockC * (.74 + .34 * bed + .14 * fn - .07 * smoothstep(.6, .8, jt));
      float ledge = smoothstep(.62, .8, pnoise(vec2(P.y * .22 + 3., (P.x + P.z) * .02))) * (1. - smoothstep(60., 80., slope));
      return mix(c, tintC * .8, ledge * .5);
    }
    #endif
    void main() {
    #ifdef DHOLE
      if (min(min(vW.x - dhole.x, dhole.z - vW.x), min(vW.y - dhole.y, dhole.w - vW.y)) > dband) discard;
    #endif
      vec3 under = texture2D(flmap, vF).rgb;
    #ifdef RNG
      under = mix(under, texture2D(rlmap, vR).rgb, vRT);
    #endif
    #ifdef MID
      under = mix(under, texture2D(mlmap, vM).rgb, vMT);
    #endif
      vec3 c = mix(under, texture2D(lmap, vUv).rgb, vT);
    #ifdef PH_ANY
      {
        float tx = 1. / pcells, h = Hp(vUv);
        float hx = (Hp(vUv + vec2(tx, 0.)) - Hp(vUv - vec2(tx, 0.))) / (2. * tx * rect.z), hz = (Hp(vUv + vec2(0., tx)) - Hp(vUv - vec2(0., tx))) / (2. * tx * rect.w);
        vec3 n = normalize(vec3(-hx, 1., -hz)); float slope = degrees(acos(clamp(n.y, -1., 1.)));
        vec4 L = texture2D(lmap, vUv); vec3 lf = L.rgb;
        vec2 upv = length(n.xz) > .01 ? -normalize(n.xz) * tx : vec2(0.);
        if (slope > 50.) lf = max(lf, texture2D(lmap, vUv + upv * 1.6).rgb * .85);   // a wall has no cell of its own: the light its top gets
    #ifdef DPHOTO
        float e = min(min(vUv.x, 1. - vUv.x) * rect.z, min(vUv.y, 1. - vUv.y) * rect.w);
    #ifdef NPH
        vec3 ph = mix(texture2D(nphoto, vM).rgb, texture2D(dphoto, vUv).rgb, smoothstep(4., 44., e));   // the sharper photo eased in at the box edge
    #else
        vec3 ph = texture2D(dphoto, vUv).rgb;
    #endif
        {   // close to the eye a 0.5-1 m photo is a blur: grass tufts of our own on top of it
          float wn = 1. - smoothstep(7., 30., distance(cameraPosition, vP));
          if (wn > 0.) ph *= 1. + wn * .5 * (pnoise(vP.xz * 7.) * .45 + pnoise(vP.xz * 23.) * .35 + pnoise(vP.xz * 2.1) * .2 - .5);
        }
        float sv = L.a;
    #else
        vec3 ph = texture2D(nphoto, vUv).rgb;
        float sv = smoothstep(-.02, .06, sunDir.y);
    #endif
        vec3 own = ph;
        if (slope > 44.) own = mix(ph, cliff(vP, slope), smoothstep(44., 56., slope));   // (the noise only where it shows)
        own *= lf;
    #ifdef DPHOTO
        ivec2 lim = ivec2(int(pcells) - 1);
        float kb = texelFetch(kmap, clamp(ivec2(vUv * pcells), ivec2(0), lim), 0).b;
        bool stream = kb > .15 && kb < .4, fall = false;
        if (slope > 40.) {   // a stream over a cliff (here, or just above: a wall has no cell of its own): a white fall
          float ku = texelFetch(kmap, clamp(ivec2((vUv + upv * 1.2) * pcells), ivec2(0), lim), 0).b, ku2 = texelFetch(kmap, clamp(ivec2((vUv + upv * 2.4) * pcells), ivec2(0), lim), 0).b;
          fall = stream || (ku > .15 && ku < .4) || (ku2 > .15 && ku2 < .4);
        }
        if (fall)
          own = mix(vec3(.84, .88, .92), vec3(.98), pnoise(vec2(vP.x * 3. + vP.z * 3., vP.y * .35))) * (.35 + .65 * lf);
        else if (kb > .4 && slope < 25.) own = h < .6 ? waterCol(vP, sv) : mix(own, waterCol(vP, sv), .92);
        else if (stream && slope < 40.) own = mix(own, waterCol(vP, sv), .3);
        else if (h < .6 && slope < 25.) own = waterCol(vP, sv);
        c = mix(under, own, vT);
    #ifdef NPH
        c = own;   // the fine box under it has the same photo: no blend needed, and none wanted (its light is coarser)
    #endif
    #else
        if (h < .6 && slope < 25.) own = waterCol(vP, sv);
        c = mix(under, own, vT);
    #endif
      }
    #else
    #ifdef WATER
    #ifdef BLD
      c = mix(wideWater(c, vP), c, vT);   // only in the strip where the box blends into its surroundings: inside, its own mask says where water is
    #else
      c = wideWater(c, vP);
    #endif
    #endif
    #ifdef BLD
      {   // open water in the box: drawn here, not in the light map, because it depends on where you look from
        float b = texture2D(kmap, vUv).b, open = clamp(b * 2., 0., 1.) * (ice > .5 ? smoothstep(.6, .9, b) : 1.) * vT;
        if (open > .01) c = mix(c, waterCol(vP, texture2D(lmap, vUv).a), open);
      }
    #endif
    #endif
      float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.);
    }`;
  // The trees: points between a canopy's top and a few metres under it (more of them near the top), seen between and
  // through. Each takes the sun the ground under it gets from hills and buildings (the detail light map's alpha), less
  // what the crowns toward the sun take; none are drawn within `clearR` m of the eye.
  const TREE_VS = `
    uniform sampler2D kmap; uniform sampler2D lmap; uniform vec4 rect; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec3 fogCol; uniform float fogD;
    uniform float pscale; uniform float snowMode; uniform float clearR;
    attribute vec4 seed;   // x: how far under the canopy top (0 top .. 1), y: random, z: size in metres, w: metres above the ground
    varying vec3 vCol;
    void main() {
      vec2 uv = (position.xz - rect.xy) / rect.zw; float top = 1. - seed.x, sh = 0., hl = length(sunDir.xz);
      if (hl > 1e-4) {
        vec2 dir = sunDir.xz / hl / rect.zw; float tanA = sunDir.y / hl;
        for (int k = 1; k <= 8; k++) { float d = 1.3 * float(k); if (seed.w + tanA * d < texture2D(kmap, uv + dir * d).a * 51.) sh += .2; }
      }
      vec3 base = (snowMode > .5 ? vec3(.085, .135, .105) : vec3(.10, .19, .09)) * (.6 + .8 * seed.y);
      if (snowMode > .5 && fract(seed.y * 7.31) > .88 && seed.x < .5) base = mix(base, vec3(.80, .84, .88), .6);   // snow caught on the boughs
      vec3 c = base * (amb * (.5 + .5 * top) + sunCol * texture2D(lmap, uv).a * (1. - .8 * min(sh, 1.)) * (.2 + .5 * top));
      c = pow(min(c * .9, vec3(1.)), vec3(.62));
      vec4 mv = modelViewMatrix * vec4(position, 1.); float dist = length(mv.xyz);
      vCol = mix(c, fogCol, 1. - exp(-pow(fogD * dist, 2.)));
      gl_Position = projectionMatrix * mv; gl_PointSize = clamp(seed.z * pscale / max(dist, 1.), 1.5, 28.);
      if (distance(position.xz, cameraPosition.xz) < clearR) gl_Position = vec4(2., 2., 2., 1.);
    }`;
  const TREE_FS = `
    precision highp float; varying vec3 vCol;
    void main() {
      vec2 q = gl_PointCoord - .5; if (dot(q, q) > .25) discard;
      if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > .9) discard;   // slightly see-through, in any order
      gl_FragColor = vec4(vCol, 1.);
    }`;
  const TREE_LIGHT = 40000;   // on a small phone
  const TREE_REACH = 260;   // a 1.5 km laser box (14 Nov 2026): its dot trees only within this many metres of the eye (the old box's size); beyond, the park-wide spruce outlines, which read as trees from afar where dots read as blobs
  const TREE_MAX = 90000;   // points a box unless cfg.detail.maxTrees says otherwise: enough to read as trees, light enough for a small phone
  const POP = (() => { const t = new Uint8Array(256); for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1]; return t; })();
  // Tree points for a detail box, at most `cap`: many small ones close to the stand spot, fewer and larger ones farther
  // off, so a tree covers about the same whatever its distance; a box that is mostly forest gets fewer, larger points
  // everywhere. With the trees' own returns (`raw`: the tree file as unpacked, n lines of 1 + n x 8 bytes, 64 height
  // slices a cell, one bit each) the points sit only where a return came from, so each tree keeps its shape; without
  // it (round 2 data) they are made up between each canopy top and a few metres under it.
  async function treePoints(D, blob, bins, bh, cap, fine, breathe) {
    const n = D.n, k = D.kind, e = crg(D, eye), dx = D.dx, dz = D.dz, len = n * fine * 8 + 1;
    if (!k) return null;
    const thin = (r, c) => Math.min(3, 60 / Math.max(1, Math.hypot((c - e.c) * dx, (r - e.r) * dz)));
    const reach = D.reach || Infinity;   // a 1.5 km box: its own (laser-return) trees only this far from the eye; the park-wide trees (spruce outlines) beyond
    const edge = (r, c) => Math.min((c + 0.5) * dx, (n - c - 0.5) * dx, (r + 0.5) * dz, (n - r - 0.5) * dz) >= D.band && Math.max(Math.abs(c - e.c) * dx, Math.abs(r - e.r) * dz) <= reach;   // not in the strip that blends into the coarser grid
    // The tree file is read twice, a line at a time (first to count, then to place the points): never whole in memory.
    // each(fn): fn(r, a, b) for every row of the box; a (and b on the light grid, where a cell is four of the file's) = the file's line(s)
    const keep = fine === 2 ? new Uint8Array(len) : null, B = new Uint8Array(8);
    const each = async fn => {
      if (!blob) { for (let r = 0; r < n; r++) { fn(r, null, null); if (breathe && !(r & 127)) await breathe(); } return; }
      const got = await lines(blob, len, (ln, i) => { if (i >= n * fine) return; if (fine === 1) fn(i, ln, null); else if (i & 1) fn(i >> 1, keep, ln); else keep.set(ln); });
      if (got !== n * fine) throw new Error('tree file has the wrong size');
    };
    const slices = (a, b, c) => { const o = 1 + c * fine * 8; if (!b) { for (let i = 0; i < 8; i++) B[i] = a[o + i]; } else for (let i = 0; i < 8; i++) B[i] = a[o + i] | a[o + 8 + i] | b[o + i] | b[o + 8 + i]; };
    let sum = 0;
    await each((r, a, b) => {
      for (let c = 0; c < n; c++) {
        if (k[r * n + c] < 8 || !edge(r, c)) continue;
        if (a) { slices(a, b, c); sum += (POP[B[0]] + POP[B[1]] + POP[B[2]] + POP[B[3]] + POP[B[4]] + POP[B[5]] + POP[B[6]] + POP[B[7]]) * thin(r, c); }
        else sum += thin(r, c);
      }
    });
    if (!sum) return null;
    const V = !!blob, per = Math.min(V ? 2.4 : 5, cap / sum), big = V ? Math.max(0.8, Math.min(1.9, Math.sqrt(1.5 / per))) : Math.max(0.75, Math.min(1.6, Math.sqrt(3.2 / per)));
    const room = Math.ceil(sum * per) + 2048, pos = new Float32Array(room * 3), seed = new Float32Array(room * 4);
    let s = 20221112, m = 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const put = (r, c, i, hg, df, size) => {
      pos[m * 3] = D.x0 + (c + rnd()) * dx; pos[m * 3 + 1] = D.HF[i] + hg; pos[m * 3 + 2] = D.z0 + (r + rnd()) * dz;
      seed[m * 4] = df; seed[m * 4 + 1] = rnd(); seed[m * 4 + 2] = size * (0.75 + 0.5 * rnd()); seed[m * 4 + 3] = hg; m++;
    };
    await each((r, a, b) => {
      for (let c = 0; c < n && m < room; c++) {
        const i = r * n + c, v = k[i];
        if (v < 8 || !edge(r, c)) continue;
        const w = thin(r, c), want = per * w, top = (v - 8) * 0.2;
        if (a) {
          const size = 0.38 / Math.sqrt(w) * big * (fine === 2 ? 1.5 : 1); slices(a, b, c);
          for (let q = 0; q < bins; q++) {
            if (!(B[q >> 3] & (1 << (q & 7)))) continue;
            let cnt = Math.floor(want); if (rnd() < want - cnt) cnt++;
            for (let j = 0; j < cnt && m < room; j++) { const hg = Math.min(top + 0.2, (q + rnd()) * bh); put(r, c, i, hg, Math.max(0, Math.min(1, (top - hg) / 7)), size); }
          }
        } else {
          const depth = Math.max(0.5, Math.min(top - 0.4, 1.5 + 0.3 * top)), size = 0.42 / Math.sqrt(w) * big;
          let cnt = Math.floor(want); if (rnd() < want - cnt) cnt++;
          for (let j = 0; j < cnt && m < room; j++) { const df = Math.pow(rnd(), 1.5); put(r, c, i, top - depth * df, df, size); }
        }
      }
    });
    // in no order, so a share of the points (drawn while the view moves on a slow phone) is a thinner copy of every tree, not a part of the box
    for (let i = m - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1)); if (j === i) continue;
      for (let q = 0; q < 3; q++) { const t = pos[i * 3 + q]; pos[i * 3 + q] = pos[j * 3 + q]; pos[j * 3 + q] = t; }
      for (let q = 0; q < 4; q++) { const t = seed[i * 4 + q]; seed[i * 4 + q] = seed[j * 4 + q]; seed[j * 4 + q] = t; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, m * 3), 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed.slice(0, m * 4), 4));
    free(pos); free(seed);
    return { geo, count: m, real: V };
  }
  // base64 pieces -> the PNG's packed pixel data, as a blob. Each piece is let go as it is used.
  function pack(list) {
    let len = 0; for (const t of list) len += Math.floor(t.length * 3 / 4) - (t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0);
    let buf = new Uint8Array(len), o = 0;
    for (let k = 0; k < list.length; k++) { const b = atob(list[k]); list[k] = null; for (let i = 0; i < b.length; i++) buf[o + i] = b.charCodeAt(i); o += b.length; }
    const dv = new DataView(buf.buffer), idat = []; let q = 8;
    while (q < o) { const l = dv.getUint32(q), type = String.fromCharCode(buf[q + 4], buf[q + 5], buf[q + 6], buf[q + 7]); if (type === 'IDAT') idat.push(buf.subarray(q + 8, q + 8 + l)); q += 12 + l; }
    const blob = new Blob(idat); free(buf); buf = null;   // the blob has its own copy
    return blob;
  }
  // The same, as one array of the packed bytes (the park-wide tree tiles: kept for a rebuild, read from memory)
  function packBytes(list) {
    let len = 0; for (const t of list) len += Math.floor(t.length * 3 / 4) - (t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0);
    const buf = new Uint8Array(len); let o = 0;
    for (let k = 0; k < list.length; k++) { const b = atob(list[k]); list[k] = null; for (let i = 0; i < b.length; i++) buf[o + i] = b.charCodeAt(i); o += b.length; }
    const dv = new DataView(buf.buffer); let q = 8, n = 0; const parts = [];
    while (q < o) { const l = dv.getUint32(q), type = String.fromCharCode(buf[q + 4], buf[q + 5], buf[q + 6], buf[q + 7]); if (type === 'IDAT') { parts.push([q + 8, l]); n += l; } q += 12 + l; }
    const out = new Uint8Array(n); let w = 0; for (const [a, l] of parts) { out.set(buf.subarray(a, a + l), w); w += l; }
    free(buf);
    return out;
  }
  // Unpacks a file a line at a time (`len` bytes each, the PNG filter byte first) and hands each line to fn(line, row):
  // the whole unpacked file (8 MB for a wide grid or a tree file) is never in memory. Returns the number of lines.
  // (blob may also be the packed bytes themselves, a Uint8Array: unpacked from memory, no Blob or stream pipe behind it)
  async function lines(blob, len, fn) {
    const src = blob instanceof Uint8Array ? new ReadableStream({ start(c) { c.enqueue(blob); c.close(); } }) : blob.stream();
    const rd = src.pipeThrough(new DecompressionStream('deflate')).getReader(), line = new Uint8Array(len); let have = 0, row = 0;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      for (let o = 0; o < value.length;) {
        const k = Math.min(len - have, value.length - o);
        if (!have && k === len) fn(value.subarray(o, o + len), row++);
        else { line.set(value.subarray(o, o + k), have); have += k; if (have === len) { fn(line, row++); have = 0; } }
        o += k;
      }
    }
    if (have) throw new Error('file has the wrong size');
    return row;
  }
  // skip = 2 keeps every other cell each way (the light foreground of a small phone): a quarter of the memory
  async function decode(list, n, base, step, skip) {
    const two = skip === 2, m = two ? n >> 1 : n, HF = new Float32Array(m * m); let up = new Uint16Array(n), cur = new Uint16Array(n), hi = -1e9, lo = 1e9;   // only two lines of the 16-bit values are kept
    const rows = await lines(pack(list), 2 * n + 1, (raw, r) => {
      if (r >= n) return;
      for (let c = 0, p = 1; c < n; c++, p += 2) {
        const res = (raw[p] << 8) | raw[p + 1], v = (res + (c ? cur[c - 1] : 0) + (r ? up[c] : 0) - (r && c ? up[c - 1] : 0)) & 65535;
        cur[c] = v;
        if (!two) { const h = base + v * step; HF[r * n + c] = h; if (h > hi) hi = h; if (h < lo) lo = h; }
        else if (!(r & 1) && !(c & 1) && (r >> 1) < m && (c >> 1) < m) { const h = base + v * step; HF[(r >> 1) * m + (c >> 1)] = h; if (h > hi) hi = h; if (h < lo) lo = h; }
      }
      const t = up; up = cur; cur = t;
    });
    if (rows !== n) throw new Error('terrain file has the wrong size');
    return { HF, hi, lo };
  }
  // any 8-bit file of ours: h lines of w bytes
  async function decodeBytes(list, w, h) {
    const m = new Uint8Array(w * h);
    if (await lines(pack(list), w + 1, (raw, r) => { if (r < h) m.set(raw.subarray(1, w + 1), r * w); }) !== h) throw new Error('file has the wrong size');
    return m;
  }
  // the detail grid's class mask: an 8-bit PNG, one byte a cell (0 ground, 2 building, 3 water, 8+ = tree, canopy (value - 8) x 0.2 m up)
  const decodeMask = (list, n) => decodeBytes(list, n, n);
  async function load() {
    const f = await decode(parts, cfg.n, cfg.base, cfg.step); parts = [];
    FAR = { n: cfg.n, HF: f.HF, north: cfg.north, south: cfg.south, west: cfg.west, east: cfg.east, x0: 0, z0: 0, w: cfg.W, d: cfg.D, dx: cfg.W / cfg.n, dz: cfg.D / cfg.n };
    maxH = f.hi + 60; minH = f.lo; NR = null; DT = null; RG = null;
    { const s = []; for (let i = 0; i < f.HF.length; i += 37) s.push(f.HF[i]); s.sort((a, b) => a - b); baseH = s[Math.floor(s.length * 0.1)] || 0; }   // the area's low ground: valley floor, or the sea
    const nc = cfg.near, list = nparts; nparts = [];
    if (nc && list.length) try {   // the fine grid is an extra: if its file is bad the wide one still draws
      const m = await decode(list, nc.n, nc.base || 0, nc.step || 0.5), kx = cfg.W / (cfg.east - cfg.west), kz = cfg.D / (cfg.north - cfg.south);
      const w = (nc.east - nc.west) * kx, d = (nc.north - nc.south) * kz, cell = Math.max(cfg.W, cfg.D) / (G - 1);
      if (!(nc.west >= cfg.west && nc.east <= cfg.east && nc.south >= cfg.south && nc.north <= cfg.north) || Math.min(w, d) < 12 * cell) throw new Error('near grid does not fit');
      NR = { n: nc.n, HF: m.HF, north: nc.north, south: nc.south, west: nc.west, east: nc.east, x0: (nc.west - cfg.west) * kx, z0: (cfg.north - nc.north) * kz, w, d, dx: w / nc.n, dz: d / nc.n, keep: 1.6 * cell, band: 4.2 * cell, up: FAR };
      maxH = Math.max(maxH, m.hi + 60); minH = Math.min(minH, m.lo);
    } catch (e) { NR = null; post({ type: 'near', ok: false, msg: String(e && e.message || e) }); }
  }

  // two half-float channels that add up to the height; `q` is the coarse channel's step (64 m keeps the fine channel
  // good to 3 cm, fine for 5-30 m cells; the detail grid uses 4 m, good to 2 mm, or flat snow shows contour lines)
  function heightTex(g, q) {
    q = q || 64;
    const n = g.n, half = new Uint16Array(n * n * 2);
    for (let i = 0; i < n * n; i++) { const base = Math.floor(g.HF[i] / q) * q; half[i * 2] = THREE.DataUtils.toHalfFloat(base); half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(g.HF[i] - base); }
    const hmap = new THREE.DataTexture(half, n, n, THREE.RGFormat, THREE.HalfFloatType);
    hmap.internalFormat = 'RG16F'; hmap.magFilter = hmap.minFilter = THREE.LinearFilter; hmap.wrapS = hmap.wrapT = THREE.ClampToEdgeWrapping; hmap.needsUpdate = true;
    return hmap;
  }
  // the class mask for the graphics card: r = building (exact, for the walls), g = building or beside one (a wall's
  // side is drawn on the cell beside it, so that takes the wood colour too), b = water (255 moving, 127 still: the wide
  // water layer knows which; without it all water counts as moving), a = tree canopy height / 0.2 m
  async function kindTex(g, WT, breathe) {
    const n = g.n, k = g.kind, px = new Uint8Array(n * n * 4);
    const still = (r, c) => {
      if (!WT) return false;
      const wc = Math.floor((g.x0 + (c + 0.5) * g.dx - WT.x0) / WT.w * WT.n), wr = Math.floor((g.z0 + (r + 0.5) * g.dz - WT.z0) / WT.d * WT.n);
      return wc >= 0 && wr >= 0 && wc < WT.n && wr < WT.n && WT.cls[wr * WT.n + wc] === 2;
    };
    if (k) for (let r = 0; r < n; r++) {
     if (breathe && r && !(r & 127)) await breathe();   // a slice of lines, then the page gets a turn
     for (let c = 0; c < n; c++) {
      const i = r * n + c, v = k[i], bl = v === 2; let by = bl;
      if (!by) for (let b = Math.max(0, r - 1); b <= Math.min(n - 1, r + 1) && !by; b++) for (let a = Math.max(0, c - 1); a <= Math.min(n - 1, c + 1); a++) if (k[b * n + a] === 2) { by = true; break; }
      px[i * 4] = bl ? 255 : 0; px[i * 4 + 1] = by ? 255 : 0; px[i * 4 + 2] = v === 3 && !by ? (still(r, c) ? 127 : 255) : v === 4 ? 64 : 0; px[i * 4 + 3] = v >= 8 ? v - 8 : 0;
     }
    }
    const t = new THREE.DataTexture(px, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  }
  function build() {
    const canvas = document.getElementById('view');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('no WebGL2');
    renderer.setPixelRatio(1);   // the canvas is sized in device pixels by draw(): sharp when still, the level's share while moving
    const N = FAR.n, hmap = heightTex(FAR);
    const size = new THREE.Vector2(FAR.w, FAR.d);
    const rt = n => { const t = new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false }); t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t; };
    const lo = rt(Math.min(1024, N)), hi = rt(N);
    const sunU = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3() }, amb: { value: new THREE.Vector3() }, snowMode: { value: cfg.ground === 'green' ? 0 : 1 }, maxH: { value: maxH }, baseH: { value: baseH } };
    const lightVS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const lightMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: hmap }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: size }, texel: { value: 1 / N }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH }, vertexShader: lightVS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
    const lightScene = new THREE.Scene(), lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightMat); quad.frustumCulled = false; lightScene.add(quad);

    const pos = new Float32Array(G * G * 3);
    for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { pos[k++] = i / (G - 1); pos[k++] = 0; pos[k++] = j / (G - 1); }
    // A second, coarser set of triangles after the first, in the same blocks: every other point each way (the two rings
    // at a mesh's edge, its rim and its skirt, are all kept). Drawn in place of the full set while the view moves on a slow phone.
    const LS = []; let nc = 0;
    for (let k = 0; k < NB; k++) { const a = bedge(k), b = bedge(k + 1), v = [a]; for (let i = a + 1; i < b; i++) if (!(i & 1) || i === 1) v.push(i); v.push(b); LS.push(v); nc += v.length - 1; }
    const idx = new Uint32Array((G - 1) * (G - 1) * 6 + nc * nc * 6); let m = 0;
    // the triangles block by block (NB x NB blocks, BSTART = where each begins), so a frame can draw only the blocks in view
    for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
      BSTART[bj * NB + bi] = m;
      for (let j = bedge(bj); j < bedge(bj + 1); j++) for (let i = bedge(bi); i < bedge(bi + 1); i++) { const a = j * G + i, b = a + 1, d = a + G, e = d + 1; idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e; }
    }
    BSTART[NB * NB] = m;
    for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
      BSTART2[bj * NB + bi] = m; const rj = LS[bj], ri = LS[bi];
      for (let j = 0; j < rj.length - 1; j++) for (let i = 0; i < ri.length - 1; i++) { const a = rj[j] * G + ri[i], b = rj[j] * G + ri[i + 1], d = rj[j + 1] * G + ri[i], e = rj[j + 1] * G + ri[i + 1]; idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e; }
    }
    BSTART2[NB * NB] = m;
    const index = new THREE.BufferAttribute(idx, 1);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(index);
    const fog = { fogCol: { value: new THREE.Vector3() }, fogD: { value: 0.000011 } };
    const terrU = { hmap: { value: hmap }, lmap: { value: lo.texture }, size: { value: size }, fogCol: fog.fogCol, fogD: fog.fogD };
    let near = null, det = null, ngeo = null, nmap = null, nrect = null, wide = null;
    const skyU = { zen: { value: new THREE.Vector3(.2, .4, .8) }, hor: { value: new THREE.Vector3(.7, .8, .9) } }, iceU = { value: ice ? 1 : 0 };
    const dholeU = DT ? { dhole: { value: new THREE.Vector4(DT.x0, DT.z0, DT.x0 + DT.w, DT.z0 + DT.d) }, dkeep: { value: DT.keep }, dband: { value: DT.band } } : {};
    if (NR || DT) {
      // the same triangles as the far mesh; the outer ring of points is the skirt (y = 1), the next ring is the box edge
      const np = new Float32Array(G * G * 3), sk = i => (i === 0 || i === G - 1 ? 1 : 0), at = i => Math.max(0, Math.min(1, (i - 1) / (G - 3)));
      for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { np[k++] = at(i); np[k++] = sk(i) || sk(j); np[k++] = at(j); }
      ngeo = new THREE.BufferGeometry(); ngeo.setAttribute('position', new THREE.BufferAttribute(np, 3)); ngeo.setIndex(index);
    }
    if (NR) {
      nmap = heightTex(NR); const rect = nrect = new THREE.Vector4(NR.x0, NR.z0, NR.w, NR.d);
      const nLight = new THREE.ShaderMaterial({ defines: { NEAR: 1 }, uniforms: { hmap: { value: nmap }, fmap: { value: hmap }, rect: { value: rect }, fsize: { value: size }, step0: { value: 1.2 * Math.max(NR.dx, NR.dz) }, fcells: { value: FAR.n }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: new THREE.Vector2(NR.w, NR.d) }, texel: { value: 1 / NR.n }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH }, vertexShader: lightVS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
      const nlo = rt(Math.min(1024, NR.n)), nhi = rt(NR.n);
      const mat = new THREE.ShaderMaterial({ defines: DT ? { DHOLE: 1 } : {}, uniforms: Object.assign({ hmap: { value: nmap }, fmap: { value: hmap }, lmap: { value: nlo.texture }, flmap: { value: lo.texture }, rect: { value: rect }, fsize: { value: size }, focus: { value: new THREE.Vector2(0.5, 0.5) }, wk: { value: 0.35 }, keep: { value: NR.keep }, band: { value: NR.band }, fogCol: fog.fogCol, fogD: fog.fogD }, dholeU), vertexShader: NEAR_VS, fragmentShader: NEAR_FS });
      const mesh = new THREE.Mesh(ngeo, [mat]); mesh.frustumCulled = false;   // a list of one material: the mesh is drawn by its geometry's groups (the blocks in view)
      near = { lightMat: nLight, lo: nlo, hi: nhi, lite: [], mat, mesh };
      terrU.hole = { value: new THREE.Vector4(NR.x0, NR.z0, NR.x0 + NR.w, NR.z0 + NR.d) }; terrU.keep = { value: NR.keep }; terrU.band = { value: NR.band };
    }
    const tdef = {}; if (near) tdef.HOLE = 1; if (det) tdef.DHOLE = 1;
    const terrMat = new THREE.ShaderMaterial({ defines: tdef, uniforms: terrU, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
    {   // the grids are a lot for a phone: give back the copies the graphics card now holds, as soon as it has them
      const drop = function () { free(this.array); this.array = null; }; index.onUpload(drop); geo.attributes.position.onUpload(drop); if (ngeo) ngeo.attributes.position.onUpload(drop);
      for (const t of [hmap, nmap]) if (t) t.onUpdate = () => { free(t.image.data); t.image = { data: null, width: t.image.width, height: t.image.height }; t.onUpdate = null; };
    }
    const scene = new THREE.Scene(), terrain = new THREE.Mesh(geo, [terrMat]); terrain.frustumCulled = false; scene.add(terrain);
    if (near) scene.add(near.mesh);
    const cam = new THREE.PerspectiveCamera(27, 1.5, det ? 1 : near ? 1 : 2, 260000); cam.rotation.order = 'YXZ';
    const skyGeo = new THREE.SphereGeometry(200000, 48, 24), skyPos = skyGeo.attributes.position, skyCol = new THREE.BufferAttribute(new Float32Array(skyPos.count * 3), 3); skyGeo.setAttribute('color', skyCol);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); sky.frustumCulled = false; scene.add(sky);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2100, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(9000, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
    scene.add(halo); scene.add(disc);
    const fx = new Float64Array(NB + 1), fz = new Float64Array(NB + 1); for (let k = 0; k <= NB; k++) { fx[k] = bedge(k) / (G - 1) * FAR.w; fz[k] = bedge(k) / (G - 1) * FAR.d; }
    R = { renderer, canvas, gl: renderer.getContext(), cw: 0, ch: 0, thin: 1, fx, fz, lite: [], lo, hi, lightMat, quad, lightScene, lightCam, terrMat, near, det, skyU, iceU, lost: false,
      ctx: { hmap, nmap, nrect, size, rt, sunU, lightVS, fog, terrU, index, ngeo, terrain }, scene, cam, sky, skyPos, skyCol, disc, halo, sv: sunVec(180, 20) };
  }

  // ---- The foreground: built after the plain view is up, a step at a time, and dropped whole if anything goes wrong ----
  const FORE_MS = 60000;   // a slow phone gets a minute; past that the box is dropped and the plain view stays
  const pause = () => new Promise(r => setTimeout(r, 0));
  function queueFore() {
    if (foreState !== 0 || !cfg) return;
    const main = !!((cfg.detail && dparts.length) || ncparts.length || wcparts.length), wide = !!(cfg.canopy && cnAny());
    const rng = !!(cfg.range && rparts.length && rangeState === 0), hs = !!(cfg.houses && hsAny() && houseState === 0);
    if (!main && !wide && !rng && !hs) return;
    foreState = main ? 1 : 0;
    const my = cfg;
    const go = async () => {
      if (!R || cfg !== my) return;
      if (frames < 2) { setTimeout(go, 60); return; }
      if (rng) { await addRange(); await pause(); if (cfg !== my || !R) return; }   // the mountains first: the biggest gain, on its own
      if (main) addFore(); else afterFore();
    };
    setTimeout(go, 320);   // the plain view has had its first frames and its full light pass
  }
  async function addFore() {
    const t0 = performance.now(), made = [], my = cfg; let where = 'start';
    const breathe = async () => { await pause(); if (cfg !== my || !R) throw new Error('the view changed'); if (performance.now() - t0 > FORE_MS) throw new Error('took too long'); };
    const step = async w => {   // between steps the page breathes (the view stays live), says where it is, and the build may be called off
      where = w; post({ type: 'detail', stage: w, ms: Math.round(performance.now() - t0) }); await pause();
      if (cfg !== my || !R) throw new Error('the view changed');
      if (R.lost) throw new Error('graphics context lost');
      if (performance.now() - t0 > FORE_MS) throw new Error('took too long');
      const pm = performance.memory; if (pm && pm.jsHeapSizeLimit && pm.usedJSHeapSize > 0.8 * pm.jsHeapSizeLimit) throw new Error('not enough memory');
    };
    try {
      const dc = my.detail, hasDet = !!(dc && dparts.length), C = R.ctx, kx = my.W / (my.east - my.west), kz = my.D / (my.north - my.south);
      // A small phone (2 GB or less, or detail.light) gets the light foreground: every other cell of the box each way
      // (1 m, a quarter of the memory) and fewer tree points. Enough for barns, trees and water to be there.
      const light = dc && dc.light != null ? !!dc.light : (navigator.deviceMemory || 8) <= 2, fine = hasDet && light && !(dc.n & 1) ? 2 : 1, dn = hasDet ? dc.n / fine : 0;
      let D = null, m = null, W = null, wmap = null, kmap = null, dmap = null, tp = null, list = null;
      if (hasDet) {
      // 1. the heights: inside the near box when there is one, else inside the wide grid
      list = dparts; dparts = [];
      m = await decode(list, dc.n, dc.base || 0, dc.step || 0.02, fine); list = null;
      const w = (dc.east - dc.west) * kx, d = (dc.north - dc.south) * kz, P = NR || my, pcell = NR ? Math.max(NR.w, NR.d) / (G - 1) : Math.max(my.W, my.D) / (G - 1);
      const keep = Math.max(4, Math.min(25, 0.5 * pcell)), band = keep + Math.max(16, Math.min(45, 2 * pcell));
      if (!(dc.west >= P.west && dc.east <= P.east && dc.south >= P.south && dc.north <= P.north) || Math.min(w, d) < 4 * band) throw new Error('detail grid does not fit');
      D = { reach: Math.max(w, d) > 600 ? TREE_REACH : Infinity, n: dn, HF: m.HF, north: dc.north, south: dc.south, west: dc.west, east: dc.east, x0: (dc.west - my.west) * kx, z0: (my.north - dc.north) * kz, w, d, dx: w / dn, dz: d / dn, keep, band, up: NR || FAR, lift: 2, kind: null };
      await step('decode');
      // 2. the class mask (without it: bare shapes), and the water of the 6 km around (0 none, 1 moving, 2 still)
      if (mparts.length) {
        list = mparts; mparts = [];
        try {
          let k = await decodeMask(list, dc.n);
          if (fine === 2) {   // four cells into one: a building wins, then the tallest tree, then water
            const q = new Uint8Array(dn * dn), n2 = dc.n;
            for (let r = 0; r < dn; r++) for (let c = 0; c < dn; c++) {
              let best = 0, o = r * 2 * n2 + c * 2;
              for (const v of [k[o], k[o + 1], k[o + n2], k[o + n2 + 1]]) { const rank = v === 2 ? 1000 : v >= 8 ? v : v === 3 ? 4 : v === 4 ? 3 : 0, br = best === 2 ? 1000 : best >= 8 ? best : best === 3 ? 4 : best === 4 ? 3 : 0; if (rank > br) best = v; }
              q[r * dn + c] = best;
            }
            free(k); k = q;
          }
          D.kind = k;
        } catch (e) { D.kind = null; }
        list = null;
      }
      const wc = my.water;
      if (wc && wparts.length) {
        list = wparts; wparts = [];
        try { W = { n: wc.n, cls: await decodeBytes(list, wc.n, wc.n), x0: (wc.west - my.west) * kx, z0: (my.north - wc.north) * kz, w: (wc.east - wc.west) * kx, d: (wc.north - wc.south) * kz }; } catch (e) { W = null; }
        list = null;
      }
      await step('mask');
      // 3. textures, one at a time: each goes to the graphics card and its copy here is given back before the next is
      //    made, so the three never sit in memory twice together
      const send = t => { made.push(t); R.renderer.initTexture(t); free(t.image.data); t.image = { data: null, width: t.image.width, height: t.image.height }; };
      dmap = heightTex(D, 4); send(dmap); await breathe();
      kmap = await kindTex(D, W, breathe); send(kmap); await breathe();
      if (W) {
        const px = W.cls; for (let i = 0; i < px.length; i++) px[i] = px[i] === 1 ? 255 : px[i] === 2 ? 127 : 0;
        wmap = new THREE.DataTexture(px, W.n, W.n, THREE.LuminanceFormat, THREE.UnsignedByteType); W.cls = null;
        wmap.magFilter = wmap.minFilter = THREE.LinearFilter; wmap.wrapS = wmap.wrapT = THREE.ClampToEdgeWrapping; wmap.needsUpdate = true; send(wmap);
      }
      await step('textures');
      // 4. the trees: their own returns when the file came, read a line at a time
      if (D.kind) {
        const tc = dc.trees || {}, cap = Math.max(1000, Math.min(520000, dc.maxTrees || (light ? TREE_LIGHT : TREE_MAX))); let blob = null;
        if (dc.trees && tparts.length) { list = tparts; tparts = []; blob = pack(list); list = null; }
        try { tp = await treePoints(D, blob, Math.min(64, tc.bins || 64), tc.bin || 0.6, cap, fine, breathe); }
        catch (e) { if (!blob) throw e; tp = await treePoints(D, null, 64, 0.6, cap, fine, breathe); }   // a bad tree file: made-up points under the canopy tops instead
      }
      tparts = [];
      await step('trees');
      }
      // 4b. aerial photos (Faroes: the fine box's and the detail box's) and the houses. Colour and shapes only: the sun
      //     times never read them (the houses' heights are guessed). Each is an extra: a bad file is simply left out.
      let nph = null, dph = null, hs = null, wph = null;
      const ALB = my.ground !== 'green';   // snow regions (Grand Teton): the colour files are albedo for the light passes
      if (wcparts.length) { list = wcparts; wcparts = []; try { wph = await photoOf(list, light ? 2048 : 0, () => false); made.push(wph.tex); } catch (e) { wph = null; } list = null; await step('wide colour'); }
      if (NR && ncparts.length) { list = ncparts; ncparts = []; try { nph = await photoOf(list, light ? 1024 : 0, (fx, fy) => gh(NR, fx * NR.n - 0.5, fy * NR.n - 0.5) < 1); made.push(nph.tex); } catch (e) { nph = null; } list = null; }
      if (D && cparts.length) { list = cparts; cparts = []; try { dph = await photoOf(list, light || dc.n > 1024 ? 1024 : 0, (fx, fy) => { const c = Math.min(D.n - 1, Math.floor(fx * D.n)), r = Math.min(D.n - 1, Math.floor(fy * D.n)); return D.kind ? D.kind[r * D.n + c] === 3 : D.HF[r * D.n + c] < 0.6; }); made.push(dph.tex); } catch (e) { dph = null; } list = null; }
      ncparts = []; cparts = [];
      if (nph || dph) await step('photos');
      if (D && bparts.length) {
        list = bparts; bparts = [];
        try { hs = houses(list, D, dc.width || D.w, dc.depth || D.d); if (hs) made.push(hs.geo, hs.mat, hs.bmap); } catch (e) { hs = null; }
        list = null;
        await step('houses');
      }
      bparts = [];
      if (!hasDet && !nph && !wph) throw new Error('nothing to add');
      const mean = ALB ? null : (nph && nph.mean) || (dph && dph.mean);
      const pu = mean ? {   // what the photo meshes share: the mean land colour, rock from it
        rockC: { value: new THREE.Vector3().fromArray(mean.map(v => v * 0.35 + (mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11) * 0.65).map(v => v * 0.82)) },
        tintC: { value: new THREE.Vector3().fromArray(mean) },
      } : { rockC: { value: new THREE.Vector3(0.4, 0.4, 0.38) }, tintC: { value: new THREE.Vector3(0.45, 0.5, 0.35) } };
      const sunU = C.sunU, fog = C.fog, size = C.size, hmap = C.hmap, near = R.near, lo = R.lo;
      const wcolU = { sunDir: sunU.sunDir, sunCol: sunU.sunCol, skyZen: R.skyU.zen, skyHor: R.skyU.hor, ice: R.iceU };
      if (nph && near && !ALB) Object.assign(near.mat.uniforms, pu, wcolU, { nphoto: { value: nph.tex }, pcells: { value: NR.n } });
      // where each grid finds its winter colour: its own file, else the next coarser one (uv rect inside that file)
      const inRect = (g, P) => new THREE.Vector4((g.x0 - P.x0) / P.w, (g.z0 - P.z0) / P.d, g.w / P.w, g.d / P.d);
      const albOf = g => !ALB ? null : g === D && dph ? { tex: dph.tex, rect: new THREE.Vector4(0, 0, 1, 1) } : g !== FAR && NR && nph && (g === NR || g === D) ? { tex: nph.tex, rect: g === NR ? new THREE.Vector4(0, 0, 1, 1) : inRect(g, NR) } : wph ? { tex: wph.tex, rect: g === FAR ? new THREE.Vector4(0, 0, 1, 1) : inRect(g, FAR) } : null;
      let det = null, terrMat = null, nearMat = null;
      if (hasDet) {
      // 5. its light pass, its mesh, and the coarser meshes' new materials (the hole under it, the water on them)
      const drect = new THREE.Vector4(D.x0, D.z0, D.w, D.d);
      const dholeU = { dhole: { value: new THREE.Vector4(D.x0, D.z0, D.x0 + D.w, D.z0 + D.d) }, dkeep: { value: D.keep }, dband: { value: D.band } };
      const waterU = wmap ? { wmap: { value: wmap }, wrect: { value: new THREE.Vector4(W.x0, W.z0, W.w, W.d) }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, skyZen: R.skyU.zen, skyHor: R.skyU.hor, ice: R.iceU } : {};
      let ngeo = C.ngeo;
      if (!ngeo) {   // no near mesh to share the points of: the same grid with a skirt ring
        const np = new Float32Array(G * G * 3), sk = i => (i === 0 || i === G - 1 ? 1 : 0), at = i => Math.max(0, Math.min(1, (i - 1) / (G - 3)));
        for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { np[k++] = at(i); np[k++] = sk(i) || sk(j); np[k++] = at(j); }
        ngeo = new THREE.BufferGeometry(); ngeo.setAttribute('position', new THREE.BufferAttribute(np, 3)); ngeo.setIndex(C.index);   // not in `made`: letting it go would take the shared triangle list with it
        ngeo.attributes.position.onUpload(function () { free(this.array); this.array = null; });
      }
      const lu = { hmap: { value: dmap }, fmap: { value: hmap }, kmap: { value: kmap }, lift: { value: 0.3 }, ice: R.iceU, rect: { value: drect }, fsize: { value: size }, step0: { value: 1.2 * Math.max(D.dx, D.dz) }, fcells: { value: FAR.n }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: new THREE.Vector2(D.w, D.d) }, texel: { value: 1 / D.n }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH };
      const mu = Object.assign({ hmap: { value: dmap }, kmap: { value: kmap }, cells: { value: D.n }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, skyZen: R.skyU.zen, skyHor: R.skyU.hor, ice: R.iceU, fmap: { value: hmap }, lmap: { value: null }, flmap: { value: lo.texture }, rect: { value: drect }, fsize: { value: size }, focus: { value: new THREE.Vector2(0.5, 0.5) }, wk: { value: 0.35 }, keep: { value: D.keep }, band: { value: D.band }, fogCol: fog.fogCol, fogD: fog.fogD }, waterU);
      if (NR) { lu.mmap = { value: C.nmap }; lu.mrect = { value: C.nrect }; Object.assign(mu, { mmap: { value: C.nmap }, mrect: { value: C.nrect }, mkeep: { value: NR.keep }, mband: { value: NR.band }, skirt: { value: 14 }, mlmap: { value: near.lo.texture } }); }
      const ldef = NR ? { NEAR: 1, DETAIL: 1, MID: 1 } : { NEAR: 1, DETAIL: 1 };
      if (dph && !ALB) ldef.PHOTO = 1;
      { const a = albOf(D); if (a) { ldef.APHOTO = 1; lu.aphoto = { value: a.tex }; lu.arect = { value: a.rect }; } }
      if (hs) { ldef.BSHADOW = 1; lu.bmap = { value: hs.bmap }; }
      const dLight = new THREE.ShaderMaterial({ defines: ldef, uniforms: lu, vertexShader: C.lightVS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
      const dlo = C.rt(Math.min(512, D.n)), dhi = C.rt(Math.min(1024, D.n));   // a 1.5 km box (1504 cells): its sharp light at 1.5 m, not every metre (a quarter less light-pass work and memory) mu.lmap.value = dlo.texture;
      const ddef = { BLD: 1 }; if (NR) ddef.MID = 1; if (wmap) ddef.WATER = 1;
      if (dph && !ALB) { ddef.DPHOTO = 1; Object.assign(mu, pu, { dphoto: { value: dph.tex }, pcells: { value: D.n } }); if (nph && NR) { ddef.NPH = 1; mu.nphoto = { value: nph.tex }; } }
      const mat = new THREE.ShaderMaterial({ defines: ddef, uniforms: mu, vertexShader: NEAR_VS, fragmentShader: NEAR_FS });
      // its own geometry over the same points and triangles: each mesh keeps its own list of blocks in view
      const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', ngeo.attributes.position); dgeo.setIndex(ngeo.index);
      const mesh = new THREE.Mesh(dgeo, [mat]); mesh.frustumCulled = false; made.push(dLight, dlo, dhi, mat);
      det = { lightMat: dLight, lo: dlo, hi: dhi, lite: [], mat, mesh, dmap, kmap, points: null, count: 0, houses: null };
      if (tp) {
        const pmat = new THREE.ShaderMaterial({ uniforms: { kmap: { value: kmap }, lmap: { value: dlo.texture }, rect: { value: drect }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: fog.fogCol, fogD: fog.fogD, pscale: { value: 600 }, snowMode: sunU.snowMode, clearR: { value: 12 } }, vertexShader: TREE_VS, fragmentShader: TREE_FS });
        det.points = new THREE.Points(tp.geo, pmat); det.points.frustumCulled = false; det.count = tp.count; made.push(tp.geo, pmat);
        const drop = function () { free(this.array); this.array = null; }; tp.geo.attributes.position.onUpload(drop); tp.geo.attributes.seed.onUpload(drop);
      }
      if (hs) {   // the houses read the sun their ground gets from the hills (the detail light map's alpha), not their own shadow
        Object.assign(hs.mat.uniforms, { lmap: { value: dlo.texture }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: fog.fogCol, fogD: fog.fogD });
        det.houses = new THREE.Mesh(hs.geo, hs.mat); det.houseCount = hs.count;
      }
      Object.assign(C.terrU, dholeU, { dsize: { value: size } }, waterU);
      const tdef = { DHOLE: 1 }; if (near) tdef.HOLE = 1; if (wmap) tdef.WATER = 1; if (R.range) tdef.RHOLE = 1;
      if (R.range && wmap) { Object.assign(R.range.mat.uniforms, waterU); R.range.mat.defines.WATER = 1; R.range.mat.needsUpdate = true; }   // the lakes of the 6 km around, on the range's mesh too
      terrMat = new THREE.ShaderMaterial({ defines: tdef, uniforms: C.terrU, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS }); made.push(terrMat);
      if (near) {
        Object.assign(near.mat.uniforms, dholeU, waterU);
        const nd = { DHOLE: 1 }; if (wmap) nd.WATER = 1; if (nph && !ALB) nd.NPHOTO = 1; if (near.mat.defines.RNG) nd.RNG = 1;
        nearMat = new THREE.ShaderMaterial({ defines: nd, uniforms: near.mat.uniforms, vertexShader: NEAR_VS, fragmentShader: NEAR_FS }); made.push(nearMat);
      }
      } else if (nph && near && !ALB) {   // a fine box with a photo and no detail box: only the fine mesh changes
        nearMat = new THREE.ShaderMaterial({ defines: Object.assign({}, near.mat.defines, { NPHOTO: 1 }), uniforms: near.mat.uniforms, vertexShader: NEAR_VS, fragmentShader: NEAR_FS }); made.push(nearMat);
      }
      await step('light');
      // 6. in, all at once
      const oldT = terrMat && R.terrMat, oldN = nearMat && near && near.mat;
      if (hasDet) { DT = D; maxH = Math.max(maxH, m.hi + 60); minH = Math.min(minH, m.lo); sunU.maxH.value = maxH; }
      if (terrMat) { C.terrain.material = [terrMat]; R.terrMat = terrMat; }
      if (nearMat) { near.mesh.material = [nearMat]; near.mat = nearMat; }
      if (nph && near && !ALB) { near.lightMat.defines.PHOTO = 1; near.lightMat.needsUpdate = true; }
      if (ALB) {   // the winter colour files into the wide and fine light passes; the wide mesh gets the file's own detail back
        const af = albOf(FAR), an = near && albOf(NR);
        if (af) { Object.assign(R.lightMat.uniforms, { aphoto: { value: af.tex }, arect: { value: af.rect } }); R.lightMat.defines.APHOTO = 1; R.lightMat.needsUpdate = true; }
        if (an) { Object.assign(near.lightMat.uniforms, { aphoto: { value: an.tex }, arect: { value: an.rect } }); near.lightMat.defines.APHOTO = 1; near.lightMat.needsUpdate = true; }
        const ar = R.range && albOf(RG);
        if (ar) { Object.assign(R.range.lightMat.uniforms, { aphoto: { value: ar.tex }, arect: { value: ar.rect } }); R.range.lightMat.defines.APHOTO = 1; R.range.lightMat.needsUpdate = true; }
        const lod = wph ? Math.log2((wph.tex.image.width || 0) / R.hi.width) : 0;
        if (lod >= 0.5) {
          const tm = R.terrMat; Object.assign(C.terrU, { wphoto: { value: wph.tex }, wlod: { value: lod } });
          tm.uniforms = C.terrU; tm.defines.WDET = 1; tm.needsUpdate = true;
        }
      }
      if (mean) {   // the wide grid's grass toward the photo's mean colour (as albedo), so the photo has no stamp edge
        const k = mean.map((v, i) => Math.max(0.6, Math.min(1.6, Math.pow(v, 1 / 0.62) / [0.31, 0.37, 0.19][i])));
        R.lightMat.uniforms.tintK = { value: new THREE.Vector3().fromArray(k) }; R.lightMat.defines.FTINT = 1; R.lightMat.needsUpdate = true;
      }
      if (det) {
        R.det = det; R.scene.add(det.mesh); if (det.points) R.scene.add(det.points); if (det.houses) R.scene.add(det.houses);
        R.cam.near = 1;
      }
      if (oldT) oldT.dispose(); if (oldN) oldN.dispose();
      if (touched) focus(); else { aim(); heading(); }
      foreState = 2; relight = dirty = true;
      post({ type: 'detail', stage: 'done', ms: Math.round(performance.now() - t0) });
      post({ type: 'foreground', ok: true, light, detail: D ? D.n : 0, trees: det ? det.count : 0, real: !!(tp && tp.real), water: wmap ? W.n : 0, ice, colour: !!(nph || dph || wph), photos: (nph ? 1 : 0) + (dph ? 1 : 0) + (wph ? 1 : 0), buildings: hs ? hs.count : 0, ms: Math.round(performance.now() - t0) });
      if (lastPath && hasDet) window.S3D.path(lastPath);   // the day's first / last light again, now from the survey's ground and buildings
    } catch (e) {
      for (const t of made) { try { t.dispose(); } catch (x) { /* nothing to let go */ } }
      dparts = []; mparts = []; tparts = []; wparts = []; cparts = []; ncparts = []; bparts = []; wcparts = []; foreState = -1;
      post({ type: 'foreground', ok: false, msg: String(e && e.message || e), at: where });
    }
    if (cfg === my) setTimeout(afterFore, WIDE_WAIT);   // the park-wide trees last, on their own: whatever happened above, they may still come. A short wait first: the foreground's leftovers are let go before more is unpacked (a lower top of the page's memory)
  }
  // base64 pieces -> bytes (each piece let go as it is used)
  function bytesOf(list) {
    let len = 0; for (const t of list) len += Math.floor(t.length * 3 / 4) - (t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0);
    const buf = new Uint8Array(len); let o = 0;
    for (let k = 0; k < list.length; k++) { const b = atob(list[k]); list[k] = null; for (let i = 0; i < b.length; i++) buf[o + i] = b.charCodeAt(i); o += b.length; }
    return buf;
  }
  // An aerial photo (JPEG, north up on its box's own lat / lng grid) as a texture, decoded by the web view itself (no
  // address, so no network), `px` pixels a side at most (0 = as it is). Also its mean colour over land: sea(fx, fy)
  // says where not to look. The photo's own copy is given back once the graphics card has it.
  async function photoOf(list, px, sea) {
    let buf = bytesOf(list);
    const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }), px ? { resizeWidth: px, resizeHeight: px, resizeQuality: 'medium' } : {});
    free(buf); buf = null;
    let mean = null;
    try {
      const S = 48, cv = document.createElement('canvas'); cv.width = cv.height = S; const g2 = cv.getContext('2d'); g2.drawImage(bmp, 0, 0, S, S);
      const d = g2.getImageData(0, 0, S, S).data, s = [0, 0, 0]; let k = 0;
      for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) { if (sea((c + 0.5) / S, (r + 0.5) / S)) continue; const i = (r * S + c) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; k++; }
      if (k >= 40) mean = s.map(v => v / k / 255);
    } catch (e) { mean = null; }
    const t = new THREE.Texture(bmp);
    t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = Math.min(4, R.renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true;   // 4, not 8: the photo is soft anyway and 8 cost ~10% of a frame on software graphics
    R.renderer.initTexture(t);
    try { if (bmp.close) bmp.close(); } catch (e) { /* the collector has it */ }
    t.image = { width: bmp.width || px, height: bmp.height || px };
    return { tex: t, mean };
  }
  // The houses of a detail box (Faroes, from the building outlines): each outline stood up from a little under its foot
  // to its eave, with a pitched roof along its long side (or flat), in one mesh; and their heights over the ground per
  // cell (bmap), for the drawn shadows only. Heights are guessed, so nothing here ever reaches lit() / the sun times.
  // w, d: the box's size in the file's own metres (the outlines are in those, from its north-west corner).
  const HOUSE_VS = `attribute vec3 bcol; attribute vec2 luv; varying vec3 vC; varying vec2 vL; varying vec3 vN; varying float vDist;
    void main() { vC = bcol; vL = luv; vN = normal; vec4 mv = modelViewMatrix * vec4(position, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const HOUSE_FS = `precision highp float; uniform sampler2D lmap; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec3 fogCol; uniform float fogD;
    varying vec3 vC; varying vec2 vL; varying vec3 vN; varying float vDist;
    void main() {
      vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
      if (abs(n.y) > .2) n.y = abs(n.y);   // a roof faces up whichever way its triangles were wound
      float vis = max(texture2D(lmap, vL).a, .1), lam = max(dot(n, sunDir), 0.);
      vec3 alb = pow(vC, vec3(1.613));   // the file's colours are as seen: the same albedo scale as the photo under them
      vec3 c = alb * (amb * (.72 + .28 * max(n.y, 0.)) + sunCol * lam * vis);
      c = pow(min(c * .9, vec3(1.)), vec3(.62));
      float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.);
    }`;
  function houses(list, D, w, d) {
    const raw = bytesOf(list), J = JSON.parse(new TextDecoder().decode(raw)), all = (J && J.b) || [];
    const sx = D.w / w, sz = D.d / d, n = D.n, cw = w / n, ch = d / n, bm = new Uint8Array(n * n);
    const P = [], Cc = [], LU = []; let count = 0;
    const tri = (a, b, c, col, lu) => { for (const v of [a, b, c]) { P.push(D.x0 + v[0] * sx, v[2], D.z0 + v[1] * sz); Cc.push(col[0] / 255, col[1] / 255, col[2] / 255); LU.push(lu[0], lu[1]); } };
    const clip = (pts, nx, nz, cx, cz, sign) => { const out = [], dd = p => sign * ((p[0] - cx) * nx + (p[1] - cz) * nz);   // the half of an outline on one side of the ridge line
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], da = dd(a), db = dd(b);
        if (da >= 0) out.push(a); if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
      return out; };
    const inside = (pts, x, z) => { let k = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
    for (const b of all) {
      if (b.skip || !b.p || b.p.length < 6) continue;
      const pts = []; for (let i = 0; i + 1 < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
      const cx = b.c ? b.c[0] : pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = b.c ? b.c[1] : pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const gable = b.roof === 'gable' && b.r > b.e, ar = (b.a || 0) * Math.PI / 180, nx = -Math.sin(ar), nz = Math.cos(ar), hw = Math.max(b.hw || 0, 0.5);
      const dist = p => (p[0] - cx) * nx + (p[1] - cz) * nz, top = p => gable ? b.e + (b.r - b.e) * Math.max(0, 1 - Math.abs(dist(p)) / hw) : Math.max(b.e, b.r || b.e);
      const lu = [cx / w, cz / d], rc = b.rc || [120, 110, 100], wc = b.wc || [200, 200, 195], foot = b.f - 1;
      count++;
      for (const part of gable ? [clip(pts, nx, nz, cx, cz, 1), clip(pts, nx, nz, cx, cz, -1)] : [pts]) {
        if (part.length < 3) continue;
        for (const f of THREE.ShapeUtils.triangulateShape(part.map(p => new THREE.Vector2(p[0], p[1])), [])) tri(...f.map(i => [part[i][0], part[i][1], top(part[i])]), rc, lu);
        for (let i = 0; i < part.length; i++) {
          const a = part[i], c = part[(i + 1) % part.length];
          if (gable && Math.abs(dist(a)) < 1e-6 && Math.abs(dist(c)) < 1e-6) continue;   // the cut along the ridge is not a wall
          const a0 = [a[0], a[1], foot], c0 = [c[0], c[1], foot], a1 = [a[0], a[1], top(a)], c1 = [c[0], c[1], top(c)];
          tri(a0, c0, c1, wc, lu); tri(a0, c1, a1, wc, lu);
        }
      }
      // its height over the ground, cell by cell (0.2 m steps, at most 51 m), for the shadow it throws in the picture
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (let r = Math.max(0, Math.floor(z0 / ch)); r <= Math.min(n - 1, Math.floor(z1 / ch)); r++) for (let c = Math.max(0, Math.floor(x0 / cw)); c <= Math.min(n - 1, Math.floor(x1 / cw)); c++) {
        const x = (c + 0.5) * cw, z = (r + 0.5) * ch; if (!inside(pts, x, z)) continue;
        const v = Math.max(0, Math.min(255, Math.round((top([x, z]) - D.HF[r * n + c]) / 0.2))); if (v > bm[r * n + c]) bm[r * n + c] = v;
      }
    }
    if (!count) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('bcol', new THREE.Float32BufferAttribute(Cc, 3)); geo.setAttribute('luv', new THREE.Float32BufferAttribute(LU, 2));
    geo.computeVertexNormals();
    const drop = function () { free(this.array); this.array = null; }; for (const k of ['position', 'bcol', 'luv', 'normal']) geo.attributes[k].onUpload(drop);
    const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { lmap: { value: null }, sunDir: { value: null }, sunCol: { value: null }, amb: { value: null }, fogCol: { value: null }, fogD: { value: 0 } }, vertexShader: HOUSE_VS, fragmentShader: HOUSE_FS });
    const bmap = new THREE.DataTexture(bm, n, n, THREE.LuminanceFormat, THREE.UnsignedByteType);
    bmap.magFilter = bmap.minFilter = THREE.LinearFilter; bmap.wrapS = bmap.wrapT = THREE.ClampToEdgeWrapping; bmap.needsUpdate = true;
    R.renderer.initTexture(bmap); bmap.image = { data: null, width: n, height: n };
    return { geo, mat, bmap, count };
  }

  // ---- Park-wide trees (Grand Teton, 13 Nov 2026) ----
  // A coarse canopy layer from the same 2022 laser survey (tools/sun3d/lidar/build_canopy.py: 7 m cells, the canopy's
  // top over the ground, tiles of ~5.5 km) is drawn as trees beyond the laser box and where there is none: one drawn
  // tree a cell close by, fewer and wider ones (a clump) farther off, so a forest keeps its cover at any distance
  // without millions of points. Each is a single point drawn as a spruce outline (a clump: a few tips side by side),
  // standing on the ground the meshes draw, lit by the sun the ground under it gets from the hills (the far and fine
  // light passes' alpha). None inside the laser box (its own trees are there). Never in lit() / the sun times.
  // Built after the rest of the foreground, in steps; a failure or a slow phone only leaves these trees out.
  const WIDE_WAIT = 1500, WIDE_MS = 30000, WIDE_D0 = 600, WIDE_RANGE = 12000, WIDE_MAX = 60000, WIDE_LIGHT = 20000, WB = 16;
  let DT_ = null;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // The ground as drawn at x, z (the far grid's metres): the fine mesh inside its box (blending into the wide grid's
  // heights toward its edge), else the wide mesh, whose G x G points take the wide grid's heights and join them in two
  // triangles a cell (a-d-b, b-d-e), so a tree stands on the surface you see and not on the grid between its points.
  const inG = (g, x, z) => g && x > g.x0 && x < g.x0 + g.w && z > g.z0 && z < g.z0 + g.d;
  const dinG = (g, x, z) => Math.min(x - g.x0, g.x0 + g.w - x, z - g.z0, g.z0 + g.d - z);
  const ghx = (g, x, z) => gh(g, (x - g.x0) / g.dx - 0.5, (z - g.z0) / g.dz - 0.5);
  function groundAt(x, z) {
    if (inG(DT, x, z)) {   // the survey's own ground (the detail mesh fades into the fine one along its edge)
      const t = sstep(DT.keep, DT.band, dinG(DT, x, z)); if (t >= 1) return ghx(DT, x, z);
      DT_ = DT; DT = null; const o = groundAt(x, z); DT = DT_; DT_ = null; return o + (ghx(DT, x, z) - o) * t;
    }
    if (inG(NR, x, z)) {
      const t = sstep(NR.keep, NR.band, dinG(NR, x, z));
      let hf = gh(FAR, x / FAR.dx - 0.5, z / FAR.dz - 0.5);
      if (inG(RG, x, z)) { const tr = sstep(RG.keep, RG.band, dinG(RG, x, z)); hf += (ghx(RG, x, z) - hf) * tr; }
      return t > 0 ? hf + (ghx(NR, x, z) - hf) * t : hf;
    }
    if (inG(RG, x, z)) { const t = sstep(RG.keep, RG.band, dinG(RG, x, z)), hf = gh(FAR, x / FAR.dx - 0.5, z / FAR.dz - 0.5); return hf + (ghx(RG, x, z) - hf) * t; }
    const u = Math.max(0, Math.min(G - 1.0001, x / FAR.w * (G - 1))), v = Math.max(0, Math.min(G - 1.0001, z / FAR.d * (G - 1)));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, H = (a, b) => gh(FAR, a / (G - 1) * FAR.n - 0.5, b / (G - 1) * FAR.n - 0.5);
    const b = H(i + 1, j), d = H(i, j + 1);
    if (fu + fv <= 1) { const a = H(i, j); return a + fu * (b - a) + fv * (d - a); }
    const e = H(i + 1, j + 1); return e + (1 - fu) * (d - e) + (1 - fv) * (b - e);
  }
  // The trees for a viewpoint: every tree cell within `range` m of it, kept with chance p = (d0 / distance)^2 (all of
  // them within d0), each kept one standing for 1 / p cells (wider, as a clump, up to 5 times its height), about `cap`
  // in all (d0 is set to fill it: 250 m in thick forest to 1.2 km over open flats). Sorted into WB x WB blocks around the viewpoint, so a frame draws only the blocks in view.
  async function widePoints(tiles, at, cap, range, breathe) {
    const my = cfg, kx = my.W / (my.east - my.west), kz = my.D / (my.north - my.south), q = cr(at), ex = (q.c + 0.5) * FAR.dx, ez = (q.r + 0.5) * FAR.dz;
    const rch = DT && DT.reach || Infinity;
    const inner = DT ? [Math.max(DT.x0 + DT.band, ex - rch), Math.min(DT.x0 + DT.w - DT.band, ex + rch), Math.max(DT.z0 + DT.band, ez - rch), Math.min(DT.z0 + DT.d - DT.band, ez + rch)] : null;   // the laser box's own trees (within TREE_REACH of the eye in a 1.5 km box)
    const T = [];
    for (const { t, blob } of tiles) {
      const x0 = (t.west - my.west) * kx, z0 = (my.north - t.north) * kz, w = (t.east - t.west) * kx, d = (t.north - t.south) * kz;
      if (Math.hypot(Math.max(x0 - ex, 0, ex - x0 - w), Math.max(z0 - ez, 0, ez - z0 - d)) > range) continue;
      T.push({ t, blob, x0, z0, dx: w / t.n, dz: d / t.n, n: t.n, step: t.step || 2, lod: t.lod ? 1 : 0 });
    }
    if (!T.length) return null;
    const R2 = range * range;
    // One pass over the files, each unpacked once, a line at a time: the cells kept with the most generous d0 (DMAX) are
    // noted, d0 is then set from them to fill the budget, and each noted cell is kept again with chance p(d0) / p(DMAX):
    // the same as drawing with p(d0) in the first place. The line loop allocates nothing (no call, no object a cell):
    // a few million tree cells must not grow the page's memory.
    const DMAX = 1200, DM2 = DMAX * DMAX;
    let s = 20261113; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    // A lod 1 file (farther off) holds 2 x 2 cells in one: the tallest one's height and how many of the four are trees
    // (w), which weighs the cell's chance; a kept one stands for w / p cells like any other.
    let cn = 0, CX = new Float32Array(131072), CZ = new Float32Array(131072), CH = new Float32Array(131072), CD = new Float32Array(131072), CW = new Uint8Array(131072);
    const grow = a => { const b = new a.constructor(a.length * 2); b.set(a); free(a); return b; };
    let k = 0, fineDx = 0, fineDz = 0;
    for (const t of T) {
      const n = t.n, x0 = t.x0, z0 = t.z0, dx = t.dx, dz = t.dz, step = t.step, lod = t.lod, i0 = inner ? inner[0] : 0, i1 = inner ? inner[1] : 0;
      if (!fineDx) { fineDx = lod ? dx / 2 : dx; fineDz = lod ? dz / 2 : dz; }
      const got = await lines(t.blob, n + 1, (ln, r) => {
        if (r >= n) return;
        const z = z0 + (r + 0.5) * dz, dz2 = (z - ez) * (z - ez); if (dz2 > R2) return;
        const inZ = !!inner && z > inner[2] && z < inner[3];
        for (let c = 0; c < n; c++) {
          const v = ln[c + 1]; if (!v) continue;
          const x = x0 + (c + 0.5) * dx, d2 = (x - ex) * (x - ex) + dz2; if (d2 > R2) continue;
          if (inZ && x > i0 && x < i1) continue;   // the laser box's own trees are there
          const w = lod ? (v >> 6) + 1 : 1;
          if (d2 >= w * DM2) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; if (s / 4294967296 >= w * DM2 / d2) continue; }
          if (cn === CX.length) { CX = grow(CX); CZ = grow(CZ); CH = grow(CH); CD = grow(CD); CW = grow(CW); }
          CX[cn] = x; CZ[cn] = z; CH[cn] = (lod ? v & 63 : v) * step; CD[cn] = d2; CW[cn] = lod ? w + 8 : 1; cn++;   // (8+: from a lod 1 file)
        }
      });
      if (got !== n) throw new Error('tree tile has the wrong size');
      if (breathe && !(++k & 1)) await breathe();
    }
    if (!cn) return null;
    const sumAt = d => { const q = d * d; let t = 0; for (let i = 0; i < cn; i++) { const c = CD[i], w = CW[i] & 7; t += Math.min(1, w * q / c) / Math.min(1, w * DM2 / c); } return t; };
    let d0 = Math.max(250, Math.min(DMAX, WIDE_D0 * Math.sqrt(cap / Math.max(1, sumAt(WIDE_D0))) * 0.97));   // fill the budget, no more: the part beyond d0 grows as d0 squared, the part inside it less
    for (let k = 0; k < 3; k++) { const t = sumAt(d0); if (t <= cap) break; d0 = Math.max(250, d0 * Math.sqrt(cap / t) * 0.97); }
    const D02 = d0 * d0, room = Math.min(cap, Math.ceil(sumAt(d0)) + 64), pos = new Float32Array(room * 3), tw = new Float32Array(room * 4), blk = new Uint16Array(room);
    const bx = (2 * range) / WB, cell0 = Math.max(fineDx, fineDz);
    let m = 0;
    for (let i = 0; i < cn && m < room; i++) {
      if (breathe && i && !(i & 32767)) await breathe();
      const x = CX[i], z = CZ[i], h = CH[i], d2 = CD[i], w = CW[i] & 7, big = CW[i] > 8 ? 2 : 1;
      const p = Math.min(1, w * D02 / d2), pc = Math.min(1, w * DM2 / d2); if (p < pc && rnd() >= p / pc) continue;
      const cells = w / p;   // the tree cells this one drawn tree stands for
      const hh = h * (0.9 + 0.2 * rnd()), wide = cells > 1.01 ? Math.min(5 * hh, Math.max(0.45 * hh, 1.1 * cell0 * Math.sqrt(cells))) : Math.max(1.2, Math.min(0.5 * hh, 1.2 * cell0));
      const px = x + (rnd() - 0.5) * fineDx * big * 0.8, pz = z + (rnd() - 0.5) * fineDz * big * 0.8;
      pos[m * 3] = px; pos[m * 3 + 1] = groundAt(px, pz); pos[m * 3 + 2] = pz;
      tw[m * 4] = hh; tw[m * 4 + 1] = wide; tw[m * 4 + 2] = rnd(); tw[m * 4 + 3] = rnd();
      blk[m] = Math.max(0, Math.min(WB - 1, Math.floor((pz - ez + range) / bx))) * WB + Math.max(0, Math.min(WB - 1, Math.floor((px - ex + range) / bx)));
      m++;
    }
    free(CX); free(CZ); free(CH); free(CD); free(CW);
    // block by block (a counting sort), each block's span on the ground kept for the frustum test
    const start = new Uint32Array(WB * WB + 1); for (let i = 0; i < m; i++) start[blk[i] + 1]++;
    for (let b = 0; b < WB * WB; b++) start[b + 1] += start[b];
    const at2 = start.slice(0, WB * WB), P = new Float32Array(m * 3), A = new Float32Array(m * 4);
    for (let i = 0; i < m; i++) { const o = at2[blk[i]]++; P.set(pos.subarray(i * 3, i * 3 + 3), o * 3); A.set(tw.subarray(i * 4, i * 4 + 4), o * 4); }
    free(pos); free(tw); free(blk);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('tw', new THREE.BufferAttribute(A, 4));
    const ex0 = new Float64Array(WB + 1), ez0 = new Float64Array(WB + 1); for (let k = 0; k <= WB; k++) { ex0[k] = ex - range + k * bx; ez0[k] = ez - range + k * bx; }
    return { geo, count: m, start, ex: ex0, ez: ez0, at: { lat: at.lat, lng: at.lng }, tiles: T.length, d0: Math.round(d0) };
  }
  // A point a tree: the square's bottom edge on the ground, its side the larger of the tree's height and width; the
  // fragment shader cuts the outline out of it. tw = (height m, width m, rank: drawn while under `share`, random).
  const WTREE_VS = `
    uniform sampler2D lmapF; uniform sampler2D lmapN; uniform vec4 nrect; uniform vec2 size; uniform float hasN;
    uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec3 fogCol; uniform float fogD;
    uniform float pscale; uniform float snowMode; uniform float share; uniform float clearR; uniform float psMax;
    attribute vec4 tw;
    varying vec4 vS; varying vec3 vBase; varying vec3 vSun; varying vec3 vFogC; varying float vFog; varying float vSide;
    void main() {
      float S = max(tw.x, tw.y);
      vec4 mv = modelViewMatrix * vec4(position.x, position.y + S * .5, position.z, 1.); float dist = length(mv.xyz);
      float px = S * pscale / max(dist, 1.);
      // not drawn: past the level's share, under a pixel, too close, or bigger than the phone draws a point (a smaller one
      // would float over the ground: its middle is pinned, not its foot)
      if (tw.z >= share || px < .8 || px > psMax || distance(position.xz, cameraPosition.xz) < clearR) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 1.; return; }
      gl_Position = projectionMatrix * mv; gl_PointSize = px;
      float k = max(1., floor(tw.y / max(.55 * tw.x, 1.) + .5));   // a clump: a few tips side by side
      vS = vec4(tw.x / S, tw.y / S, k, tw.w);
      vec2 nu = (position.xz - nrect.xy) / nrect.zw;
      float vis = hasN > .5 && nu.x > 0. && nu.y > 0. && nu.x < 1. && nu.y < 1. ? texture2D(lmapN, nu).a : texture2D(lmapF, position.xz / size).a;
      vBase = (snowMode > .5 ? vec3(.085, .135, .105) : vec3(.10, .19, .09)) * (.6 + .8 * tw.w);
      vSun = sunCol * vis;
      vec2 rgt = vec2(viewMatrix[0][0], viewMatrix[2][0]), sh = sunDir.xz;
      vSide = length(rgt) > 1e-4 && length(sh) > 1e-4 ? dot(normalize(sh), normalize(rgt)) : 0.;
      vFog = 1. - exp(-pow(fogD * dist, 2.)); vFogC = fogCol;
    }`;
  const WTREE_FS = `
    precision highp float; uniform vec3 amb; uniform float snowMode;
    varying vec4 vS; varying vec3 vBase; varying vec3 vSun; varying vec3 vFogC; varying float vFog; varying float vSide;
    float h1(float x) { return fract(sin(x * 78.233) * 43758.5453); }
    void main() {
      vec2 q = gl_PointCoord; float yb = (1. - q.y) / vS.x, u = (q.x - .5) / vS.y;   // yb 0 at the ground .. 1 at the crown's top; u -.5 .. .5 across it
      if (yb > 1. || abs(u) > .5) discard;
      float k = vS.z, j = floor((u + .5) * k), uj = fract((u + .5) * k) - .5;
      float top = k > 1.5 ? .7 + .3 * h1(j + vS.w * 17.) : 1., y = yb / top;
      if (y > 1.) discard;
      float tier = fract(y * 7. + vS.w * 5.);
      if (abs(uj) > .5 * (1. - y) * (.78 + .22 * tier)) discard;   // a spruce: boughs in tiers, a saw edge
      vec3 base = vBase;
      if (snowMode > .5 && tier > .82 && h1(j + floor(y * 7.) + vS.w * 31.) > .45) base = mix(base, vec3(.80, .84, .88), .55);   // snow on the boughs
      vec3 c = base * (amb * (.5 + .5 * y) + vSun * (.22 + .48 * y) * (1. + .45 * clamp(uj * 2. * vSide, -1., 1.)));
      c = pow(min(c * .9, vec3(1.)), vec3(.62));
      gl_FragColor = vec4(mix(c, vFogC, vFog), 1.);
    }`;
  // ---- The sharp range: a fourth level, built after the plain view (before the detail box), dropped alone if it fails ----
  const RANGE_MS = 45000;
  // Its mesh: every other point of the shared grid (384 a side: on a software-graphics test the full 768 doubled a frame's
  // time), bunched harder at the subject (spacing .2 x the mean there: ~5 m at the peak, as the file; ~70 m at the box's
  // edge, where it fades into the wide grid anyway). Its light map keeps every 5 m point, so the faces keep their detail.
  const RANGE_WK = 0.2;
  async function addRange() {
    const my = cfg, rc = my.range, t0 = performance.now(), made = []; let where = 'decode';
    if (!rc || !rparts.length || !R) { rparts = []; return; }
    rangeState = 1;
    const check = async w => { where = w; await pause(); if (cfg !== my || !R) throw new Error('the view changed'); if (R.lost) throw new Error('graphics context lost'); if (performance.now() - t0 > RANGE_MS) throw new Error('took too long');
      const pm = performance.memory; if (pm && pm.jsHeapSizeLimit && pm.usedJSHeapSize > 0.8 * pm.jsHeapSizeLimit) throw new Error('not enough memory'); };
    try {
      const light = rc.light != null ? !!rc.light : (navigator.deviceMemory || 8) <= 2, skip = light && !(rc.n & 1) ? 2 : 1;
      let list = rparts; rparts = [];
      const m = await decode(list, rc.n, rc.base || 0, rc.step || 0.05, skip); list = null;
      await check('decode');
      const n = rc.n / skip, kx = my.W / (my.east - my.west), kz = my.D / (my.north - my.south), cell = Math.max(my.W, my.D) / (G - 1);
      const w = (rc.east - rc.west) * kx, d = (rc.north - rc.south) * kz;
      if (!(rc.west >= my.west && rc.east <= my.east && rc.south >= my.south && rc.north <= my.north) || Math.min(w, d) < 12 * cell) throw new Error('range grid does not fit');
      const Rg = { n, HF: m.HF, north: rc.north, south: rc.south, west: rc.west, east: rc.east, x0: (rc.west - my.west) * kx, z0: (my.north - rc.north) * kz, w, d, dx: w / n, dz: d / n, keep: 1.6 * cell, band: 4.2 * cell, up: FAR };
      const C = R.ctx, sunU = C.sunU, rmap = heightTex(Rg); made.push(rmap);
      R.renderer.initTexture(rmap); free(rmap.image.data); rmap.image = { data: null, width: n, height: n };
      await check('texture');
      const rect = new THREE.Vector4(Rg.x0, Rg.z0, Rg.w, Rg.d);
      const lightMat = new THREE.ShaderMaterial({ defines: { NEAR: 1 }, uniforms: { hmap: { value: rmap }, fmap: { value: C.hmap }, rect: { value: rect }, fsize: { value: C.size }, step0: { value: 1.2 * Math.max(Rg.dx, Rg.dz) }, fcells: { value: FAR.n }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: new THREE.Vector2(w, d) }, texel: { value: 1 / n }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH }, vertexShader: C.lightVS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
      const lo = C.rt(Math.min(1024, n)), hi = C.rt(n); made.push(lightMat, lo, hi);
      let ngeo = C.ngeo;
      if (!ngeo) {   // no fine mesh to share the points of: the same grid with a skirt ring, kept for the detail box too
        const np = new Float32Array(G * G * 3), sk = i => (i === 0 || i === G - 1 ? 1 : 0), at = i => Math.max(0, Math.min(1, (i - 1) / (G - 3)));
        for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { np[k++] = at(i); np[k++] = sk(i) || sk(j); np[k++] = at(j); }
        ngeo = new THREE.BufferGeometry(); ngeo.setAttribute('position', new THREE.BufferAttribute(np, 3)); ngeo.setIndex(C.index);
        ngeo.attributes.position.onUpload(function () { free(this.array); this.array = null; }); C.ngeo = ngeo;
      }
      const u = { hmap: { value: rmap }, fmap: { value: C.hmap }, lmap: { value: lo.texture }, flmap: { value: R.lo.texture }, rect: { value: rect }, fsize: { value: C.size }, focus: { value: new THREE.Vector2(0.5, 0.5) }, wk: { value: RANGE_WK }, keep: { value: Rg.keep }, band: { value: Rg.band }, fogCol: C.fog.fogCol, fogD: C.fog.fogD };
      const defs = {}, hole = NR || DT;   // cut out under the fine box (or the detail box when there is no fine one)
      if (hole) { defs.DHOLE = 1; Object.assign(u, { dhole: { value: new THREE.Vector4(hole.x0, hole.z0, hole.x0 + hole.w, hole.z0 + hole.d) }, dkeep: { value: hole.keep }, dband: { value: hole.band } }); }
      const mat = new THREE.ShaderMaterial({ defines: defs, uniforms: u, vertexShader: NEAR_VS, fragmentShader: NEAR_FS }); made.push(mat);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', ngeo.attributes.position); geo.setIndex(ngeo.index);
      const mesh = new THREE.Mesh(geo, [mat]); mesh.frustumCulled = false;
      await check('mesh');
      // in, all at once: the wide mesh cut out under it, the fine mesh's edge onto it
      Object.assign(C.terrU, { rhole: { value: new THREE.Vector4(Rg.x0, Rg.z0, Rg.x0 + w, Rg.z0 + d) }, rkeep: { value: Rg.keep }, rband: { value: Rg.band }, rsize: { value: C.size } });
      R.terrMat.defines.RHOLE = 1; R.terrMat.needsUpdate = true;
      if (R.near) { Object.assign(R.near.mat.uniforms, { rmap: { value: rmap }, rrect: { value: rect }, rkeep: { value: Rg.keep }, rband: { value: Rg.band }, rlmap: { value: lo.texture } }); R.near.mat.defines.RNG = 1; R.near.mat.needsUpdate = true; }
      RG = Rg; maxH = Math.max(maxH, m.hi + 60); minH = Math.min(minH, m.lo); sunU.maxH.value = maxH;
      R.range = { lightMat, lo, hi, lite: [], mat, mesh }; R.scene.add(mesh);
      if (touched) focus(); else { aim(); heading(); }
      rangeState = 2; relight = dirty = true;
      post({ type: 'range', ok: true, n, light, ms: Math.round(performance.now() - t0) });
      if (lastPath) window.S3D.path(lastPath);   // the day's first / last light again, now with the sharp ridges
    } catch (e) {
      for (const t of made) { try { t.dispose(); } catch (x) { /* nothing to let go */ } }
      rparts = []; if (rangeState === 1) rangeState = -1;
      post({ type: 'range', ok: false, msg: String(e && e.message || e), at: where });
    }
  }

  // ---- Park-wide buildings: walls and roofs from the laser survey, after the foreground, never in the sun times ----
  const HOUSE_RANGE = 8000, HOUSE_MS = 30000;
  const hsAny = () => Object.keys(hsparts).length > 0;
  const PHOUSE_VS = `attribute vec3 bcol; varying vec3 vC; varying vec3 vN; varying vec3 vP; varying float vDist;
    void main() { vC = bcol; vN = normal; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const PHOUSE_FS = `precision highp float; uniform sampler2D lmapF; uniform sampler2D lmapR; uniform sampler2D lmapN; uniform sampler2D lmapD;
    uniform vec4 rrect; uniform vec4 nrect; uniform vec4 drect; uniform vec2 fsize; uniform vec3 has;
    uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform vec3 fogCol; uniform float fogD;
    varying vec3 vC; varying vec3 vN; varying vec3 vP; varying float vDist;
    bool inR(vec2 u) { return u.x > 0. && u.y > 0. && u.x < 1. && u.y < 1.; }
    float hills() {   // the sun the ground here gets from the hills: the finest light map that holds the spot (its alpha)
      vec2 u = (vP.xz - drect.xy) / drect.zw; if (has.z > .5 && inR(u)) return texture2D(lmapD, u).a;
      u = (vP.xz - nrect.xy) / nrect.zw; if (has.y > .5 && inR(u)) return texture2D(lmapN, u).a;
      u = (vP.xz - rrect.xy) / rrect.zw; if (has.x > .5 && inR(u)) return texture2D(lmapR, u).a;
      return texture2D(lmapF, vP.xz / fsize).a;
    }
    void main() {
      vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
      if (abs(n.y) > .2) n.y = abs(n.y);   // a roof faces up whichever way its triangles were wound
      float lam = max(dot(n, sunDir), 0.), vis = lam > 0. ? max(hills(), 0.) : 0.;
      vec3 c = vC * (amb * (.72 + .28 * max(n.y, 0.)) + sunCol * lam * vis);
      c = pow(min(c * .9, vec3(1.)), vec3(.62));
      float f = 1. - exp(-pow(fogD * vDist, 2.)); gl_FragColor = vec4(mix(c, fogCol, f), 1.);
    }`;
  function afterFore() {
    const my = cfg; if (!my) return;
    (async () => { try { await addHouses(); } catch (e) { /* reported by addHouses */ } if (cfg === my) queueWide(); })();
  }
  async function addHouses() {
    const my = cfg, hc = my && my.houses, t0 = performance.now(), made = [];
    if (!hc || !R || houseState !== 0 || !hsAny()) return;
    houseState = 1; let where = 'files';
    const breathe = async () => { await pause(); if (cfg !== my || !R) throw new Error('the view changed'); if (R.lost) throw new Error('graphics context lost'); if (performance.now() - t0 > HOUSE_MS) throw new Error('took too long'); };
    try {
      const kxF = my.W / (my.east - my.west), kzF = my.D / (my.north - my.south), q = cr(eye), ex = (q.c + 0.5) * FAR.dx, ez = (q.r + 0.5) * FAR.dz;
      const range = Math.max(500, Math.min(20000, hc.range || HOUSE_RANGE)), snowy = my.ground !== 'green';
      const P = [], Cc = []; let count = 0, seen = 0;
      const bareDT = !!(my.detail && my.detail.bare), D = DT && bareDT ? DT : null, bm = D ? new Uint8Array(D.n * D.n) : null; let inBox = 0;
      const tri = (a, b, c, col) => { for (const v of [a, b, c]) { P.push(v[0], v[1], v[2]); Cc.push(col[0], col[1], col[2]); } };
      const clip = (pts, nx, nz, cx, cz, sign) => { const out = [], dd = p => sign * ((p[0] - cx) * nx + (p[1] - cz) * nz);
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], da = dd(a), db = dd(b);
          if (da >= 0) out.push(a); if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
        return out; };
      const inside = (pts, x, z) => { let k = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
      const keys = Object.keys(hsparts).map(Number).sort((a, b) => a - b);
      for (const i of keys) {
        let J = null; try { J = JSON.parse(new TextDecoder().decode(bytesOf(hsparts[i]))); } catch (e) { J = null; }
        delete hsparts[i];
        if (!J || !J.box || !J.b) continue;
        const [tn, ts, tw] = J.box, kxt = 111320 * Math.cos((tn + ts) / 2 * Math.PI / 180), kzt = 111132;
        const X = (px) => (tw + px / kxt - my.west) * kxF, Z = (pz) => (my.north - (tn - pz / kzt)) * kzF;
        for (const b of J.b) {
          seen++;
          if (!b.p || b.p.length < 6) continue;
          const pts = []; for (let k = 0; k + 1 < b.p.length; k += 2) pts.push([X(b.p[k]), Z(b.p[k + 1])]);
          const cx0 = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          if (Math.hypot(cx0 - ex, cz0 - ez) > range) continue;
          if (Math.hypot(cx0 - ex, cz0 - ez) < 6) continue;   // never a building round the camera
          if (DT && !bareDT && cx0 > DT.x0 && cx0 < DT.x0 + DT.w && cz0 > DT.z0 && cz0 < DT.z0 + DT.d) continue;   // an older detail box has its buildings in its heights: not twice
          const cx = b.c ? X(b.c[0]) : cx0, cz = b.c ? Z(b.c[1]) : cz0;
          let gmin = Infinity; for (const p of pts) gmin = Math.min(gmin, groundAt(p[0], p[1]));
          const g0 = groundAt(cx0, cz0), foot = Math.min(gmin, g0) - 0.6, e = g0 + Math.max(1.8, b.e), r = g0 + Math.max(b.e, b.r || b.e);
          const gable = b.roof === 'gable' && b.r > b.e + 0.3, ar = (b.a || 0) * Math.PI / 180, nx = -Math.sin(ar), nz = Math.cos(ar), hw = Math.max(b.hw || 0, 0.5) * kxF / kxt;
          const dist = p => (p[0] - cx) * nx + (p[1] - cz) * nz, top = p => gable ? e + (r - e) * Math.max(0, 1 - Math.abs(dist(p)) / hw) : r;
          // (a building's parts share a colour: ids are building x 4 + part)
          let s = (((b.id || 0) >> 2) * 2654435761) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
          const tone = 0.75 + 0.5 * rnd(), wall = snowy ? [0.24 * tone, 0.17 * tone, 0.12 * tone] : [0.42 * tone, 0.36 * tone, 0.3 * tone];
          const pitch = gable ? Math.atan((r - e) / hw) * 180 / Math.PI : 0;
          const roofC = snowy ? (pitch > 48 ? [0.32, 0.31, 0.32] : [0.86, 0.89, 0.93].map(v => v * (0.94 + 0.06 * rnd()))) : [0.33 * tone, 0.25 * tone, 0.22 * tone];
          count++;
          for (const part of gable ? [clip(pts, nx, nz, cx, cz, 1), clip(pts, nx, nz, cx, cz, -1)] : [pts]) {
            if (part.length < 3) continue;
            for (const f of THREE.ShapeUtils.triangulateShape(part.map(p => new THREE.Vector2(p[0], p[1])), [])) tri(...f.map(k => [part[k][0], top(part[k]), part[k][1]]), roofC);
            for (let k = 0; k < part.length; k++) {
              const a = part[k], c = part[(k + 1) % part.length];
              if (gable && Math.abs(dist(a)) < 1e-6 && Math.abs(dist(c)) < 1e-6) continue;   // the cut along the ridge is not a wall
              const a0 = [a[0], foot, a[1]], c0 = [c[0], foot, c[1]], a1 = [a[0], top(a), a[1]], c1 = [c[0], top(c), c[1]];
              tri(a0, c0, c1, wall); tri(a0, c1, a1, wall);
            }
          }
          if (bm) {   // its height over the survey's ground, cell by cell, for the shadow it throws in the detail box's picture
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
            if (x1 > D.x0 && x0 < D.x0 + D.w && z1 > D.z0 && z0 < D.z0 + D.d) {
              inBox++;
              for (let rr = Math.max(0, Math.floor((z0 - D.z0) / D.dz)); rr <= Math.min(D.n - 1, Math.floor((z1 - D.z0) / D.dz)); rr++) for (let cc = Math.max(0, Math.floor((x0 - D.x0) / D.dx)); cc <= Math.min(D.n - 1, Math.floor((x1 - D.x0) / D.dx)); cc++) {
                const x = D.x0 + (cc + 0.5) * D.dx, z = D.z0 + (rr + 0.5) * D.dz; if (!inside(pts, x, z)) continue;
                const v = Math.max(0, Math.min(255, Math.round((top([x, z]) - D.HF[rr * D.n + cc]) / 0.2))); if (v > bm[rr * D.n + cc]) bm[rr * D.n + cc] = v;
              }
            }
          }
        }
        await breathe();
      }
      hsparts = {};
      if (!count) throw new Error('no buildings in range');
      where = 'mesh';
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('bcol', new THREE.Float32BufferAttribute(Cc, 3));
      geo.computeVertexNormals(); geo.computeBoundingSphere(); made.push(geo);
      const drop = function () { free(this.array); this.array = null; }; for (const k of ['position', 'bcol', 'normal']) geo.attributes[k].onUpload(drop);
      const C = R.ctx, sunU = C.sunU, z4 = new THREE.Vector4(0, 0, 1, 1);
      const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { lmapF: { value: R.lo.texture }, lmapR: { value: R.range ? R.range.lo.texture : R.lo.texture }, lmapN: { value: R.near ? R.near.lo.texture : R.lo.texture }, lmapD: { value: R.det ? R.det.lo.texture : R.lo.texture },
        rrect: { value: RG ? new THREE.Vector4(RG.x0, RG.z0, RG.w, RG.d) : z4 }, nrect: { value: NR ? new THREE.Vector4(NR.x0, NR.z0, NR.w, NR.d) : z4 }, drect: { value: DT ? new THREE.Vector4(DT.x0, DT.z0, DT.w, DT.d) : z4 }, fsize: { value: C.size },
        has: { value: new THREE.Vector3(R.range ? 1 : 0, R.near ? 1 : 0, R.det ? 1 : 0) }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: C.fog.fogCol, fogD: C.fog.fogD }, vertexShader: PHOUSE_VS, fragmentShader: PHOUSE_FS });
      made.push(mat);
      await breathe();
      let shadow = false;
      if (bm && inBox && R.det) {   // the houses' drawn shadow in the detail box (its light pass, as the Faroes houses)
        const bmap = new THREE.DataTexture(bm, D.n, D.n, THREE.LuminanceFormat, THREE.UnsignedByteType);
        bmap.magFilter = bmap.minFilter = THREE.LinearFilter; bmap.wrapS = bmap.wrapT = THREE.ClampToEdgeWrapping; bmap.needsUpdate = true;
        R.renderer.initTexture(bmap); bmap.image = { data: null, width: D.n, height: D.n }; made.push(bmap);
        const lm = R.det.lightMat; lm.uniforms.bmap = { value: bmap }; lm.defines.BSHADOW = 1; lm.needsUpdate = true; shadow = true;
      }
      const mesh = new THREE.Mesh(geo, mat);
      R.houses = { mesh, mat, geo, count }; R.scene.add(mesh);
      houseState = 2; relight = dirty = true;
      post({ type: 'houses', ok: true, count, seen, inBox, shadow, range, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      for (const t of made) { try { t.dispose(); } catch (x) { /* nothing to let go */ } }
      hsparts = {}; if (houseState === 1) houseState = -1;
      post({ type: 'houses', ok: false, msg: String(e && e.message || e), at: where });
    }
  }
  function queueWide() {
    if (wideState !== 0 || !cfg || !cfg.canopy || !R || !(wideTiles || cnAny())) return;
    wideState = 1; setTimeout(() => addWide(), 0);
  }
  async function addWide() {
    const my = cfg, cc = my.canopy || {}, t0 = performance.now(), run = ++wideRun, made = []; let where = 'start';
    const breathe = async () => { await pause(); if (cfg !== my || !R || run !== wideRun) throw new Error('the view changed'); if (R.lost) throw new Error('graphics context lost'); if (performance.now() - t0 > WIDE_MS) throw new Error('took too long'); };
    try {
      if (!wideTiles) {   // the files are kept packed (a few MB): a new viewpoint is built again from them
        where = 'files';
        for (const i in cnparts) { try { cnbytes[i] = packBytes(cnparts[i]); } catch (e) { /* a bad tile: left out */ } }
        wideTiles = (cc.tiles || []).map((t, i) => ({ t, blob: cnbytes[i] || null })).filter(x => x.blob && x.t && x.t.n > 0);
        cnparts = {}; cnbytes = {}; cnlast = -1;
        await breathe();
      }
      if (!wideTiles.length) throw new Error('no tree files');
      const light = cc.light != null ? !!cc.light : (navigator.deviceMemory || 8) <= 2;
      const cap = Math.max(1000, Math.min(200000, cc.max || (light ? WIDE_LIGHT : WIDE_MAX))), range = Math.max(1000, Math.min(20000, cc.range || (light ? 5000 : WIDE_RANGE)));
      where = 'trees';
      const wp = await widePoints(wideTiles, eye, cap, range, breathe);
      if (!wp) throw new Error('no trees in range');
      made.push(wp.geo);
      where = 'material';
      await breathe();
      const C = R.ctx, sunU = C.sunU, fog = C.fog, gl = R.gl;
      let psMax = 256; try { psMax = Math.max(16, Math.min(512, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64)); } catch (e) { psMax = 64; }
      const mat = new THREE.ShaderMaterial({ uniforms: { lmapF: { value: R.lo.texture }, lmapN: { value: R.near ? R.near.lo.texture : R.lo.texture }, nrect: { value: NR ? new THREE.Vector4(NR.x0, NR.z0, NR.w, NR.d) : new THREE.Vector4(0, 0, 1, 1) }, hasN: { value: NR && R.near ? 1 : 0 }, size: { value: C.size },
        sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: fog.fogCol, fogD: fog.fogD, pscale: { value: 600 }, snowMode: sunU.snowMode, share: { value: 1 }, clearR: { value: 30 }, psMax: { value: psMax } },
        vertexShader: WTREE_VS, fragmentShader: WTREE_FS });
      made.push(mat);
      const pts = new THREE.Points(wp.geo, [mat]); pts.frustumCulled = false;
      const drop = function () { free(this.array); this.array = null; }; wp.geo.attributes.position.onUpload(drop); wp.geo.attributes.tw.onUpload(drop);
      // in, all at once (the far and fine light passes already hold the ground's sun visibility in alpha)
      if (R.wide) { R.scene.remove(R.wide.points); R.wide.geo.dispose(); R.wide.mat.dispose(); }   // a new viewpoint: the old set goes
      R.wide = { points: pts, mat, geo: wp.geo, count: wp.count, start: wp.start, ex: wp.ex, ez: wp.ez, at: wp.at };
      R.scene.add(pts);
      wideState = 2; relight = dirty = true;
      post({ type: 'wideTrees', ok: true, trees: wp.count, tiles: wp.tiles, d0: wp.d0, range, light, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      for (const t of made) { try { t.dispose(); } catch (x) { /* nothing to let go */ } }
      if (run === wideRun) { wideState = R && R.wide ? 2 : -1; post({ type: 'wideTrees', ok: false, msg: String(e && e.message || e), at: where }); }
    }
  }
  // the blocks of park-wide trees that can be in view, as the geometry's groups (runs side by side are one draw call)
  function cullWide(W) {
    const g = W.geo.groups, y0 = minH - 100, y1 = maxH + 140, S = W.start; let n = 0, open = false;
    for (let bj = 0; bj < WB; bj++) for (let bi = 0; bi < WB; bi++) {
      const b = bj * WB + bi;
      if (S[b + 1] === S[b]) { continue; }
      _box.min.set(W.ex[bi], y0, W.ez[bj]); _box.max.set(W.ex[bi + 1], y1, W.ez[bj + 1]);
      if (!_fr.intersectsBox(_box)) { open = false; continue; }
      if (open && g[n - 1].start + g[n - 1].count === S[b]) g[n - 1].count = S[b + 1] - g[n - 1].start;   // (empty blocks between add nothing)
      else { const o = g[n] || (g[n] = { start: 0, count: 0, materialIndex: 0 }); o.start = S[b]; o.count = S[b + 1] - S[b]; n++; open = true; }
    }
    g.length = n;
    return n;
  }

  // the light pass's size: k = -1 full (when the sun rests), 0 quick (as the time moves), 1 and 2 smaller still (a half
  // and a quarter of the quick one each way, made when a slow phone first needs them)
  const tgt = (o, k) => k < 0 ? o.hi : k === 0 ? o.lo : (o.lite[k] || (o.lite[k] = R.ctx.rt(Math.max(64, o.lo.width >> k))));
  function lightPass(k) {
    const r = R.renderer, t = tgt(R, k);
    R.quad.material = R.lightMat; r.setRenderTarget(t); r.render(R.lightScene, R.lightCam);
    R.terrMat.uniforms.lmap.value = t.texture;
    if (R.range) {
      const rt2 = tgt(R.range, k), u = R.range.mat.uniforms;
      R.quad.material = R.range.lightMat; r.setRenderTarget(rt2); r.render(R.lightScene, R.lightCam);
      u.lmap.value = rt2.texture; u.flmap.value = t.texture;
      if (R.near && R.near.mat.uniforms.rlmap) R.near.mat.uniforms.rlmap.value = rt2.texture;
    }
    if (R.near) {
      const nt = tgt(R.near, k);
      R.quad.material = R.near.lightMat; r.setRenderTarget(nt); r.render(R.lightScene, R.lightCam);
      R.near.mat.uniforms.lmap.value = nt.texture; R.near.mat.uniforms.flmap.value = t.texture;
    }
    if (R.det) {
      const dt = tgt(R.det, k), u = R.det.mat.uniforms;
      R.quad.material = R.det.lightMat; r.setRenderTarget(dt); r.render(R.lightScene, R.lightCam);
      u.lmap.value = dt.texture; u.flmap.value = t.texture; if (R.near) u.mlmap.value = tgt(R.near, k).texture;
      if (R.det.points) R.det.points.material.uniforms.lmap.value = dt.texture;
    }
    if (R.wide) { const u = R.wide.mat.uniforms; u.lmapF.value = t.texture; if (R.near) u.lmapN.value = tgt(R.near, k).texture; }
    if (R.houses) { const u = R.houses.mat.uniforms; u.lmapF.value = t.texture; if (R.range) u.lmapR.value = tgt(R.range, k).texture; if (R.near) u.lmapN.value = tgt(R.near, k).texture; if (R.det) u.lmapD.value = tgt(R.det, k).texture; }
    r.setRenderTarget(null);
  }
  function light(k) {
    const v = sunVec(sun.az, sun.alt), A = atmo(sun.alt); R.sv = v;
    R.lightMat.uniforms.sunDir.value.set(v.x, v.y, v.z);
    R.lightMat.uniforms.sunCol.value.set(A.sun[0] * A.sunI, A.sun[1] * A.sunI, A.sun[2] * A.sunI);
    R.lightMat.uniforms.amb.value.set(A.amb[0], A.amb[1], A.amb[2]);
    R.skyU.zen.value.set(A.zen[0], A.zen[1], A.zen[2]); R.skyU.hor.value.set(A.hor[0], A.hor[1], A.hor[2]);
    lightPass(k);   // a quick pass while the time is moving; draw() runs the full one once it rests
    const glow = sun.alt > -10 ? Math.max(0, 1 - Math.abs(sun.alt - 2) / 16) : 0, sp = R.skyPos;
    for (let j = 0; j < sp.count; j++) {
      const x = sp.getX(j) / 200000, y = sp.getY(j) / 200000, z = sp.getZ(j) / 200000;
      const t = Math.pow(Math.max(0, y), 0.45), g = Math.pow(Math.max(0, x * v.x + y * v.y + z * v.z), 10) * glow;
      R.skyCol.setXYZ(j, Math.min(1, A.hor[0] + (A.zen[0] - A.hor[0]) * t + g * 0.9), Math.min(1, A.hor[1] + (A.zen[1] - A.hor[1]) * t + g * 0.55), Math.min(1, A.hor[2] + (A.zen[2] - A.hor[2]) * t + g * 0.25));
    }
    R.skyCol.needsUpdate = true;
    R.terrMat.uniforms.fogCol.value.set(A.hor[0], A.hor[1], A.hor[2]);
    R.disc.visible = R.halo.visible = sun.alt > -1;
    R.disc.material.color.setRGB(1, Math.min(1, .75 + A.sun[1] * .25), Math.min(1, .5 + A.sun[2] * .5));
    R.halo.material.color.setRGB(A.sun[0], A.sun[1], A.sun[2]);
    const hp = herePoint(), hl = lit(hp, sun.az, sun.alt);
    post({ type: 'state', subjectLit: subjLit(sun.az, sun.alt), hereLit: hl, up: sun.alt > 0, trees: hl && treesBlock(hp, sun.az, sun.alt) });
  }
  function aim() {
    const a = cr(eye), b = cr(target), dx = (b.c - a.c) * FAR.dx, dz = (b.r - a.r) * FAR.dz, dist = Math.hypot(dx, dz);
    yaw = dist > 5 ? Math.atan2(dx, -dz) : 0;
    const e = pick(eye), t = pick(target), up = eyeH(e);
    if (dist > 3000 || t.g === FAR) {
      const top = dist > 3000 ? Math.atan2(snap(t, snapR(t.g)).h - up, dist) : 0.04;
      pitch = Math.max(0.01, top * 0.45);
    } else pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(gh(t.g, t.c, t.r) + 6 - up, Math.max(dist, 20))));   // a close subject on the fine grid: look straight at it, up or down
    focus();
  }
  function focus() {
    const a = cr(eye), b = cr(target), dist = Math.hypot((b.c - a.c) * FAR.dx, (b.r - a.r) * FAR.dz), t = pick(target);
    if (R && R.near) {   // the near mesh is densest a little past the middle of the shot; with the subject outside the box (a far peak), around the feet and a little ahead
      const p = crg(NR, eye), q = crg(NR, target), k = t.g === NR ? 0.6 : Math.min(0.6, 250 / Math.max(dist, 1));
      R.near.mat.uniforms.focus.value.set(Math.max(0, Math.min(1, (p.c + (q.c - p.c) * k + 0.5) / NR.n)), Math.max(0, Math.min(1, (p.r + (q.r - p.r) * k + 0.5) / NR.n)));
    }
    if (R && R.range) {   // the range's mesh is densest at the subject (the peak), or at the point of its box nearest to it
      const q = crg(RG, target); R.range.mat.uniforms.focus.value.set(Math.max(0.03, Math.min(0.97, (q.c + 0.5) / RG.n)), Math.max(0.03, Math.min(0.97, (q.r + 0.5) / RG.n)));
    }
    if (R && R.det) {   // the detail mesh is densest just ahead of the feet, or toward a subject that is inside it
      const p = crg(DT, eye), q = crg(DT, target), k = t.g === DT ? 0.6 : Math.min(0.6, 60 / Math.max(dist, 1));
      R.det.mat.uniforms.focus.value.set(Math.max(0, Math.min(1, (p.c + (q.c - p.c) * k + 0.5) / DT.n)), Math.max(0, Math.min(1, (p.r + (q.r - p.r) * k + 0.5) / DT.n)));
    }
  }
  // The lens: focal length and the film's width and height in mm as the camera is turned (4x5 landscape = 120 x 96).
  // The view is drawn a little wider than the lens, so the whole frame shows with a margin and the box marks it.
  // Exact for a lens focused far away with no rise, fall or shift.
  function lensFov() {
    const a = (R && R.cam.aspect) || ((window.innerWidth || 1) / (window.innerHeight || 1));
    const th = lens.fw / (2 * lens.f), tv = lens.fh / (2 * lens.f), k = Math.max(th / (a * 0.9), tv / 0.9);
    const el = document.getElementById('frame');
    if (el) {   // written only when it changes: this runs every frame, and a style write makes the web view lay the page out again
      const disp = lens.box ? 'block' : 'none', wd = (th / (k * a) * 100) + '%', ht = (tv / k * 100) + '%', key = disp + wd + ht;
      if (key !== lensKey) { lensKey = key; el.style.display = disp; el.style.width = wd; el.style.height = ht; }
    }
    return 2 * Math.atan(k);
  }
  function place() {
    const q = cr(eye), e = pick(eye), cam = R.cam;
    cam.position.set((q.c + 0.5) * FAR.dx, eyeH(e), (q.r + 0.5) * FAR.dz); cam.rotation.set(pitch, -yaw, 0);
    cam.fov = lensFov() * 180 / Math.PI; cam.updateProjectionMatrix(); R.sky.position.copy(cam.position);
    if (R.det && R.det.points) R.det.points.material.uniforms.pscale.value = R.canvas.height / (2 * Math.tan(cam.fov * Math.PI / 360)) / Math.sqrt(R.thin);   // a point's metres -> pixels at 1 m
    if (R.wide) R.wide.mat.uniforms.pscale.value = R.canvas.height / (2 * Math.tan(cam.fov * Math.PI / 360));
  }
  function resize() { const w = window.innerWidth, h = window.innerHeight; if (!R || !w || !h) return; R.cam.aspect = w / h; dirty = true; }   // draw() sizes the canvas

  // A change from outside (the view dragged, a sun position, a walk step): a movement begins or goes on, drawn at the
  // phone's level. The first change cannot be told from a single tap, so a tap is drawn the same way; on a phone that
  // keeps up (level 0) that is full quality anyway. The sharp frame (full light pass, full resolution, every tree
  // point, every triangle) comes REST ms after the last change.
  function touch(kind) {
    if (!act) act = { kind: kind === 'sun' ? 'sun' : 'look', ms: [], sum: 0, n: 0, slow: 0, px: 0, pts: 0 };
    clearTimeout(restTimer); restTimer = setTimeout(rested, REST[kind]); resting = false; dirty = true;
  }
  // The timer only says "nothing for REST ms": the movement is taken as over at the next frame callback, if still nothing
  // has come. A page that was held up (and its timers with it) so first hears the changes that were waiting.
  function rested() { restTimer = null; resting = true; }
  function rest() {
    clearTimeout(restTimer); restTimer = null; resting = false;
    const a = act, t = performance.now(); act = null;
    if (a && a.ms.length >= 1 && t - lastPerf >= 1000) {   // a number for the phone test: how the movement that just ended went (one frame is enough: a slow phone may draw only one or two while a finger moves)
      const m = a.ms.slice().sort((x, y) => x - y); lastPerf = t;
      post({ type: 'perf', kind: a.kind, ms: Math.round(m[m.length >> 1] * 10) / 10, worst: Math.round(m[m.length - 1]), frames: m.length, level: lv[a.kind], quality: QN[lv[a.kind]], levels: { look: lv.look, sun: lv.sun }, px: a.px, pts: a.pts, wide: a.wpts || 0, timed: gate.off ? 'frame' : 'fence' });
    }
    if (owe) sharp = dirty = true;
  }
  // The last frame's time, once the graphics card is done with it. Only frames of the movement still going on count,
  // and not one that paid for a new canvas size or was drawn while the foreground was being built.
  function frameDone(ms) {
    const a = gate.act, gov = gate.gov; gate.act = null;
    if (!a || a !== act) return;
    a.ms.push(ms); if (!gov) return;
    a.sum += ms; a.n++; a.slow = ms > 2.5 * SLOW_MS ? a.slow + 1 : 0;
    if (a.n < 6 && a.slow < 2) return;   // six frames' average, or at once after two very slow ones in a row
    const k = a.kind, L = lv[k], avg = a.slow >= 2 ? ms : a.sum / a.n;
    if (avg > SLOW_MS && L < QL.length - 1) { if (tried[k]) noUp[k][L] = true; lv[k] = L + 1; tried[k] = false; }
    else if (avg < FAST_MS && L > 0 && !noUp[k][L - 1]) { lv[k] = L - 1; tried[k] = true; }
    else tried[k] = false;
    a.sum = a.n = a.slow = 0;
  }
  // Is the graphics card done with the last frame? Until it is, no new frame is sent.
  function gpuFree(now) {
    if (gate.sync) {
      const gl = R.gl; let done = true;
      try { done = R.lost || gl.isContextLost() || gl.getSyncParameter(gate.sync, gl.SYNC_STATUS) === gl.SIGNALED; } catch (e) { gate.off = true; }
      if (!done && now - gate.t0 > 12000) { done = true; gate.off = true; }   // a driver that never says: stop asking, time frames by the next frame callback
      if (!done) return false;
      try { gl.deleteSync(gate.sync); } catch (e) { /* gone with the context */ }
      gate.sync = null; clearTimeout(gate.poll); gate.poll = null; frameDone(now - gate.t0);
    } else if (gate.wait) { gate.wait = false; frameDone(now - gate.t0); }
    return true;
  }
  function poll() { gate.poll = null; if (R && gate.sync && !gpuFree(performance.now())) gate.poll = setTimeout(poll, 3); }
  // The blocks of a mesh that can be in view, as the geometry's groups (runs of blocks side by side are one draw call).
  // A block's box: its span on the ground (ex, ez: NB + 1 edges) plus a metre, from under the lowest ground (the cut
  // under a finer mesh and the skirts hang below it) to above the highest. Never too small, so the picture is the same.
  const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _iv = new THREE.Matrix4(), _box = new THREE.Box3(), EX = new Float64Array(NB + 1), EZ = new Float64Array(NB + 1);
  // holes: [x0, x1, z0, z1] areas a finer mesh covers where this mesh discards every fragment: a block wholly inside one is not drawn
  const inHole = (holes, a, b, c, d) => { if (holes) for (const h of holes) if (a >= h[0] && b <= h[1] && c >= h[2] && d <= h[3]) return true; return false; };
  const holeOf = g => g ? [g.x0 + g.band + 2, g.x0 + g.w - g.band - 2, g.z0 + g.band + 2, g.z0 + g.d - g.band - 2] : null;
  function cull(mesh, ex, ez, S, holes) {
    const g = mesh.geometry.groups, y0 = minH - 1000, y1 = maxH + 10; let n = 0, open = false;
    for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
      _box.min.set(ex[bi] - 1, y0, ez[bj] - 1); _box.max.set(ex[bi + 1] + 1, y1, ez[bj + 1] + 1);
      if (!_fr.intersectsBox(_box) || inHole(holes, ex[bi] - 1, ex[bi + 1] + 1, ez[bj] - 1, ez[bj + 1] + 1)) { open = false; continue; }
      const b = bj * NB + bi;
      if (open) g[n - 1].count = S[b + 1] - g[n - 1].start;
      else { const o = g[n] || (g[n] = { start: 0, count: 0, materialIndex: 0 }); o.start = S[b]; o.count = S[b + 1] - S[b]; n++; open = true; }
    }
    g.length = n;
  }
  // the near and detail meshes bunch their points around `focus` (wp in NEAR_VS): the same sum here gives their blocks' edges
  const wpj = (s, f, wk) => { const d = s - f, m = d < 0 ? f : 1 - f; if (m < 0.0005) return f; const x = Math.abs(d) / m; return f + Math.sign(d) * m * x * (wk + (1 - wk) * x * x); };
  function cullWarped(o, g, S) {
    const f = o.mat.uniforms.focus.value, wk = o.mat.uniforms.wk ? o.mat.uniforms.wk.value : 0.35;
    for (let k = 0; k <= NB; k++) { const t = Math.max(0, Math.min(1, (bedge(k) - 1) / (G - 3))); EX[k] = g.x0 + wpj(t, f.x, wk) * g.w; EZ[k] = g.z0 + wpj(t, f.y, wk) * g.d; }
    cull(o.mesh, EX, EZ, S);
  }
  function draw(t0) {
    const a = act, q = QL[a ? lv[a.kind] : 0], w = window.innerWidth || 1, h = window.innerHeight || 1;
    // the canvas: when still 2 device pixels a point at most (as before) and PX_MAX pixels in all; while moving the level's share
    const ratio = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(PX_MAX / (w * h))) * q.res, cw = Math.max(1, Math.floor(w * ratio)), ch = Math.max(1, Math.floor(h * ratio));
    let fresh = false;
    if (cw !== R.cw || ch !== R.ch) { R.renderer.setSize(cw, ch, false); R.cw = cw; R.ch = ch; fresh = true; }
    if (relight) { light(q.lt); relight = false; quick = true; }
    else if (!a && sharp && quick) { lightPass(-1); quick = false; }   // the sun has rested: the full light pass, in the same frame as the sharp picture
    const P = R.det && R.det.points; let pts = 0;
    if (P) { pts = Math.max(1, Math.floor(R.det.count * q.trees)); if (P.geometry.drawRange.count !== pts) P.geometry.setDrawRange(0, pts); R.thin = q.trees; }   // fewer points are drawn larger (place)
    place();
    const cam = R.cam, v = R.sv;
    cam.updateMatrixWorld(); _fr.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, _iv.copy(cam.matrixWorld).invert()));
    // (the wide mesh: none of its blocks wholly under the range's box, where it would only be discarded)
    cull(R.ctx.terrain, R.fx, R.fz, q.geo > 1 ? BSTART2 : BSTART, R.range ? [holeOf(RG)] : null); if (R.near) cullWarped(R.near, NR, q.geo ? BSTART2 : BSTART); if (R.det) cullWarped(R.det, DT, q.geo ? BSTART2 : BSTART); if (R.range) cullWarped(R.range, RG, BSTART2);
    let wpts = 0;
    if (R.wide) {   // the park-wide trees: the level's share of them (none at the lowest), only the blocks in view
      const W = R.wide; W.mat.uniforms.share.value = q.wide; W.points.visible = q.wide > 0 && cullWide(W) > 0;
      if (W.points.visible) for (const g of W.geo.groups) wpts += g.count;
      wpts = Math.round(wpts * q.wide);
    }
    R.disc.position.set(cam.position.x + v.x * 190000, cam.position.y + v.y * 190000, cam.position.z + v.z * 190000); R.disc.lookAt(cam.position);
    R.halo.position.copy(R.disc.position); R.halo.lookAt(cam.position);
    R.renderer.render(R.scene, cam); dirty = false; frames++;
    owe = quick || q !== QL[0]; sharp = false;
    if (owe && restTimer == null && !resting) restTimer = setTimeout(rested, REST.sun);   // a light change nobody touched for (the foreground coming in, ice on / off)
    if (a) { a.px = cw * ch; a.pts = pts; a.wpts = wpts; }
    gate.t0 = t0; gate.act = a; gate.gov = !fresh && foreState !== 1 && wideState !== 1 && rangeState !== 1 && houseState !== 1;
    if (!gate.off && !R.lost) {
      const gl = R.gl; let sy = null;
      try { sy = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); } catch (e) { sy = null; }
      if (sy) { gate.sync = sy; if (a) gate.poll = setTimeout(poll, 3); } else gate.off = true;   // while moving the fence is asked every few ms, so the time is finer than a screen refresh
    }
    if (gate.off) gate.wait = true;
  }
  function tick() {
    if (resting) rest();
    if (R) { const t = performance.now(), free = gpuFree(t); if (dirty && free) draw(t); }
    requestAnimationFrame(tick);
  }
  function inside(p) { return p && p.lat <= cfg.north && p.lat >= cfg.south && p.lng >= cfg.west && p.lng <= cfg.east; }
  function heading() { post({ type: 'look', deg: Math.round(((yaw * 180 / Math.PI) % 360 + 360) % 360) }); }

  const WALK_MAX = 400;
  function told() {
    const kz = 111132, kx = 111320 * Math.cos(eye.lat * Math.PI / 180);
    post({ type: 'eye', lat: eye.lat, lng: eye.lng, moved: Math.round(Math.hypot((eye.lat - eye0.lat) * kz, (eye.lng - eye0.lng) * kx)) });
    post({ type: 'state', subjectLit: subjLit(sun.az, sun.alt), hereLit: lit(herePoint(), sun.az, sun.alt), up: sun.alt > 0 });
  }
  let drag = null;
  function wire() {
    const c = R.canvas;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); if (R) R.lost = true; post({ type: 'lost', fore: foreState > 0 }); });
    c.addEventListener('pointermove', e => { if (!drag) return; touched = true; const per = (R.cam.fov * Math.PI / 180) / window.innerHeight; yaw -= (e.clientX - drag.x) * per; if (!inline) pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * per)); drag = { x: e.clientX, y: e.clientY }; touch('look'); });
    const drop = () => { if (drag) { drag = null; heading(); if (act && act.kind === 'look') rest(); } };   // finger up: the sharp frame now
    c.addEventListener('pointerup', drop); c.addEventListener('pointercancel', drop);
    window.addEventListener('resize', resize);
  }

  window.S3D = {
    init(c) { rparts = []; rangeState = 0; hsparts = {}; houseState = 0; cnparts = {}; cnbytes = {}; cnlast = -1; wideTiles = null; wideState = 0; wideRun++; cfg = c; parts = []; nparts = []; dparts = []; mparts = []; tparts = []; wparts = []; cparts = []; ncparts = []; bparts = []; wcparts = []; foreState = 0; lastPath = null; touched = false; ice = c.ice != null ? !!c.ice : c.ground !== 'green'; eye = c.eye; eye0 = c.eye; target = c.target; act = null; if (c.level) for (const k of ['look', 'sun']) if (c.level[k] >= 0) lv[k] = Math.min(QL.length - 1, Math.floor(c.level[k])); focal = c.focal || 50; if (c.lens) lens = Object.assign({}, lens, c.lens); inline = !!c.inline; { const cv = document.getElementById('view'); if (cv) cv.style.touchAction = inline ? 'pan-y' : 'none'; } },
    chunk(s, which) {
      if (typeof which === 'string' && which.startsWith('canopy:')) {   // a tree tile: packed as soon as the next one starts, so its text is let go at once
        const i = +which.slice(7);
        if (i !== cnlast) { if (cnlast >= 0 && cnparts[cnlast]) { try { cnbytes[cnlast] = packBytes(cnparts[cnlast]); } catch (e) { /* a bad tile: left out */ } delete cnparts[cnlast]; } cnlast = i; }
        (cnparts[i] || (cnparts[i] = [])).push(s); return;
      }
      if (typeof which === 'string' && which.startsWith('house:')) { const i = +which.slice(6); (hsparts[i] || (hsparts[i] = [])).push(s); return; }
      (which === 'range' ? rparts : which === 'near' ? nparts : which === 'detail' ? dparts : which === 'mask' ? mparts : which === 'trees' ? tparts : which === 'water' ? wparts : which === 'color' ? cparts : which === 'ncolor' ? ncparts : which === 'bld' ? bparts : which === 'wcolor' ? wcparts : parts).push(s); },
    async done() {
      try {
        if (typeof DecompressionStream === 'undefined') return fail("This phone's web view is too old for the 3D view.");
        if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.');
        await load(); build(); aim(); wire(); resize(); say(''); relight = dirty = true; requestAnimationFrame(tick);
        const fore = !!((cfg.detail && dparts.length) || ncparts.length || wcparts.length || (cfg.canopy && cnAny()) || (cfg.range && rparts.length) || (cfg.houses && hsAny()));
        post({ type: 'ready', n: FAR.n, gl: 'webgl2', near: NR ? NR.n : 0, detail: 0, fore }); heading();
        if (fore) queueFore();
      } catch (e) { fail("The 3D view couldn't start on this phone."); post({ type: 'error', msg: String(e && e.message || e) }); }
    },
    // fore({ detail, water, ice }): the foreground for the view that is up; its chunks follow, then foreDone()
    fore(c) { if (!cfg || foreState === 1) return; cfg.detail = c && c.detail; cfg.water = c && c.water;
      if (rangeState !== 1 && rangeState !== 2) { cfg.range = c && c.range; rparts = []; rangeState = 0; }
      if (houseState !== 1 && houseState !== 2) { cfg.houses = c && c.houses; hsparts = {}; houseState = 0; } if (wideState !== 1 && wideState !== 2) { cfg.canopy = c && c.canopy; cnparts = {}; cnbytes = {}; cnlast = -1; wideTiles = null; wideState = 0; } if (c && c.ice != null) ice = !!c.ice; if (R) R.iceU.value = ice ? 1 : 0; dparts = []; mparts = []; tparts = []; wparts = []; cparts = []; ncparts = []; bparts = []; wcparts = []; if (foreState < 0) foreState = 0; },
    foreDone() { if (R) queueFore(); },
    sun(az, alt) { sun = { az, alt }; relight = true; touch('sun'); },
    // ice(true): still water (lakes, ponds, backwaters) is drawn frozen under snow, only moving water stays open
    ice(v) { ice = !!v; if (R) { R.iceU.value = ice ? 1 : 0; relight = dirty = true; } },
    focal(f) { lens = Object.assign({}, lens, { f }); dirty = true; },
    // lens({ f, fw, fh, box }): focal length, film width / height in mm as the camera is turned, frame box on / off
    lens(o) { lens = Object.assign({}, lens, o || {}); dirty = true; },
    // inline(true): the small view inside a scrolling page. A sideways drag looks around; up-down drags are left to the
    // page (touch-action pan-y), so the two no longer fight. Full screen: free look both ways.
    inline(v) { inline = !!v; const c = document.getElementById('view'); if (c) c.style.touchAction = inline ? 'pan-y' : 'none'; },
    view(eLat, eLng, tLat, tLng) {
      eye = { lat: eLat, lng: eLng }; eye0 = eye; target = { lat: tLat, lng: tLng }; if (!R) return; if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.'); say(''); aim(); relight = dirty = true; heading();
      if (R.wide && wideState === 2 && Math.hypot((eye.lat - R.wide.at.lat) * 111132, (eye.lng - R.wide.at.lng) * 111320 * Math.cos(eye.lat * Math.PI / 180)) > 300) { wideState = 0; queueWide(); }   // the park-wide trees again, around the new spot
    },
    recenter() { if (R) { aim(); dirty = true; heading(); } },
    // Walk mode (12 Nov 2026): step the viewpoint f metres forward and r metres to the right of where the view is
    // looking, on the ground, at most WALK_MAX metres from the shot's own stand spot. The app is told where the
    // viewpoint now is ('eye') and whether that spot is in the sun; it asks for the day's first / last light again
    // (path) when the walking stops. home() goes back to the stand spot.
    walk(f, r) {
      if (!R || !eye || !eye0) return;
      const kz = 111132, kx = 111320 * Math.cos(eye.lat * Math.PI / 180);
      const de = Math.sin(yaw) * f + Math.cos(yaw) * r, dn = Math.cos(yaw) * f - Math.sin(yaw) * r;
      const next = { lat: eye.lat + dn / kz, lng: eye.lng + de / kx };
      const off = Math.hypot((next.lat - eye0.lat) * kz, (next.lng - eye0.lng) * kx);
      if (!inside(next) || off > WALK_MAX) { post({ type: 'walk', stopped: inside(next) ? 'far' : 'edge', max: WALK_MAX }); return; }
      eye = next; touch('walk'); told();
    },
    home() { if (!R || !eye0) return; eye = eye0; aim(); dirty = true; heading(); told(); },
    path(arr) {
      lastPath = arr;
      if (!R) return;
      const s = subjPoint(), q = pinPoint(), h = herePoint(); let fs = null, ls = null, fh = null, lh = null;
      let trees = false;   // some time in the day the surveyed trees would hide the sun from the stand spot
      for (const [m, az, alt] of arr) { if (subjLit(az, alt, s, q)) { if (fs == null) fs = m; ls = m; } if (lit(h, az, alt)) { if (fh == null) fh = m; lh = m; if (!trees && treesBlock(h, az, alt)) trees = true; } }
      post({ type: 'moments', firstSubject: fs, lastSubject: ls, firstHere: fh, lastHere: lh, trees });
    },
  };
  post({ type: 'boot' });
})();
