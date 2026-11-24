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
//   S3D.trees(bool) every tree layer shown / hidden (Phil, 16 Nov 2026: a "no trees" foreground): the close-up box's
//                   trees and their soft canopy shadow on its ground, and the park-wide trees. A visibility switch, no
//                   rebuild; cfg.trees === false starts a page with them hidden. Trees never reach lit() / the sun times.
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
//   S3D.view(eyeLat, eyeLng, targetLat, targetLng, framing?)      S3D.path([[minute, az, alt], ...]) -> 'moments'
// Saved framing (14 Nov 2026, Phil: frame every shot in 3D and keep it): framing = { yaw_deg, pitch_deg } (yaw = compass
// heading of the view's middle, pitch = the page's tilt, degrees up). Given in cfg.view (init), as view()'s fifth
// argument, or alone as S3D.view({ yaw_deg, pitch_deg }), the shot opens on it and every later re-aim (the foreground
// coming in, walk mode's home) keeps it; S3D.view(null) goes back to aiming at the subject. With no framing anywhere the
// page aims exactly as before. Every `look` message also says { yaw, pitch } in degrees to 0.01 for saving.
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
// Split (24 Nov 2026): S3D.split({ on, frac, shots }) draws the eye view over the view from above in this one canvas;
// S3D.goTo(lat, lng), S3D.yaw(deg), S3D.liveLook(bool) for a map outside the page. See "Split" before tick().
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
  let foreState = 0, frames = 0, lastPath = null, touched = false, treesOn = true;
  // 14 Nov 2026: the 1.5 km boxes hold bare ground, so a subject pin on a barn or cabin was aimed at the ground at its
  // foot. Buildings near the eye are kept here (outline + roof top) and a close subject inside one is aimed at its roof.
  let bldNear = [];
  let rparts = [], RG = null, rangeState = 0, hsparts = {}, houseState = 0;   // the sharp range (its file's pieces, the grid, 0 none 1 building 2 in -1 dropped); the park-wide buildings (tile pieces by index, state)
  let cnparts = {}, cnbytes = {}, cnlast = -1, wideTiles = null, wideState = 0, wideRun = 0;   // park-wide trees: tile pieces by index, each tile's packed bytes once its pieces are in, the tile coming in, the packed files, 0 none 1 building 2 in -1 dropped
  const cnAny = () => Object.keys(cnparts).length > 0 || Object.keys(cnbytes).length > 0;   // foreground: 0 none, 1 on its way, 2 in, -1 dropped
  let R = null;   // everything three.js, once built
  const OHU = { value: 0 };
  // The tree shaders' from-above drawing is compiled in only while the view from above is on (17 Nov 2026: as a run-time
  // branch it made every tree pixel of the normal 3D view dearer, and the test emulator's software graphics froze):
  // these materials get the OH define on entering it and lose it on leaving.
  const OHM = new Set();
  function ohMat(m) { OHM.add(m); if (OHU.value) { m.defines = Object.assign({}, m.defines, { OH: 1 }); m.needsUpdate = true; } return m; }
  function ohDefines(on) { for (const m of OHM) { const d = Object.assign({}, m.defines); if (on) d.OH = 1; else delete d.OH; m.defines = d; m.needsUpdate = true; } }   // the view from above is on (S3D.overhead): shaders draw trees as crowns seen from over them
  // Split (S3D.split, see "Split" before tick()): the eye view on top, the view from above under it, in one canvas.
  // on / frac = the top's share of the height; cache = keep the view from above in a picture of its own and draw it again
  // only when something in it changed (an eye-view drag then costs the top half only); live = post `look` while a drag
  // turns the eye view (the app's own map draws the cone then).
  const SPL = { on: false, frac: 0.5, cache: true, live: false, rt: null, blit: null, key: '', ptr: new Map(), turn: null, dot: null, handle: null, fogD: null, disc: null, follow: null, lastLook: 0, lightN: 0, renders: 0 };
  let eye = null, eye0 = null, target = null, framed = null, yaw = 0, pitch = 0, focal = 50, lens = { f: 135, fw: 120, fh: 96, box: true }, inline = false, sun = { az: 180, alt: 20 }, dirty = true, relight = true;
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
  const treeH = (cc, rr) => { const n = DT.n, v = DT.kind ? DT.kind[Math.max(0, Math.min(n - 1, Math.round(rr))) * n + Math.max(0, Math.min(n - 1, Math.round(cc)))] : 0; return khv(v) * 0.2; };
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
  // Camera height above the ground (Phil, 17 Nov 2026: raise it to see over trees, lower it for low shots): 1 ft up, no real top,
  // S3D.eyeHeight(m). Measured from the ground under the camera: exact on the survey's bare ground (detail grid), else
  // the local high point as above. The sun times are not moved by it (they test the ground spot).
  let EYE = 1.73;
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
    uniform sampler2D kmap; uniform float lift; uniform float ice; uniform float tsh;
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
              gr = H(p); if (tsh > .5 && hh - gr < texture2D(kmap, p).a * 51.) ts += L * .2; L = min(L * 1.025, 3.);   // under a tree's canopy: a soft shadow that grows with the way through it
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
    uniform float pscale; uniform float snowMode; uniform float clearR; uniform float oh;
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
      if (distance(position.xz, cameraPosition.xz) < clearR * (1. - oh)) gl_Position = vec4(2., 2., 2., 1.);
    }`;
  const TREE_FS = `
    precision highp float; varying vec3 vCol;
    void main() {
      vec2 q = gl_PointCoord - .5; if (dot(q, q) > .25) discard;
      if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > .9) discard;   // slightly see-through, in any order
      gl_FragColor = vec4(vCol, 1.);
    }`;
  // ---- Trees as trees (trees review, 15 Nov 2026) ----
  // cfg.treeStyle picks how the laser box's trees are drawn: 'dots' (the survey's returns as points within 260 m of the
  // stand spot, as before), 'shapes' (A: one drawn tree per surveyed tree in the whole box, a solid outline: a spire for
  // an evergreen, a trunk, limbs and a lace of twigs for a tree that is bare in winter) or 'cloud' (B: the same trees
  // and outlines filled with soft dots, a point-cloud look with no gaps). In A and B each tree stands where the survey has its top, as tall as
  // its canopy top and as wide as its own crown (the cells around the top that belong to it). Which trees are bare in
  // late December comes with the mask (cfg.detail.leaf: a tree cell's byte is 8 + 2 x (height / 0.4 m) + 1 when bare,
  // from Sentinel-2 30 Dec 2025 and the summer aerial photo, tools/sun3d/lidar/build_leaf.py, which also has the same
  // cutting into trees in Python, the reference the page is measured against); without it, a guess from
  // the crown's shape. The park-wide trees beyond take the same call from their tiles (cfg.canopy.leaf). Never in lit().
  // A2 (Snake River photo check, 15 Nov 2026): mask v6 (cfg.detail.leaf = 2): a tree cell's byte is 8 + 3 x (height / 0.6 m)
  // + 0 evergreen, 1 bare, 2 bare by the summer photo only (the weak call: the winter picture darkens the snow under the
  // crown as much as the evergreen forest does, e >= 0.85, the known evergreens' 10th percentile). Within NEAR_EVER m of
  // the stand spot a weak call is drawn evergreen: there a crown wrongly drawn bare opens a whole side of the picture (the
  // firs on the bluff below the Snake River Overlook, 24-200 m, called bare from a bright patch of the summer photo, are
  // dense and dark in Phil's scan). The Mormon Row cottonwoods (the model's known bare trees) are 78% strong calls; the
  // first 200 m of Phil's Moulton, Cunningham and Oxbow scans hold no tree called bare at all.
  // Only where the canopy is 6 m or more (NEAR_EVER_H5, in 0.2 m): willow and shrub calls stay as they are (the bare willows
  // on the bank in Phil's Oxbow scan are weak calls too).
  let LEAF = 0;
  const NEAR_EVER = 200, NEAR_EVER_H5 = 30;
  const TSTYLES = ['dots', 'shapes', 'cloud'];
  const khv = v => v >= 8 ? (LEAF === 2 ? Math.floor((v - 8) / 3) * 3 : LEAF ? (v - 8) & ~1 : v - 8) : 0;   // a mask byte -> canopy height / 0.2 m
  const kcls = v => v >= 8 && LEAF ? (LEAF === 2 ? (v - 8) % 3 : (v - 8) & 1) : 0;   // 0 evergreen, 1 bare, 2 bare (weak call, v6)
  // The trees of a laser box within its reach of the eye: tops = cells highest within a radius that grows with height
  // (1 m for a 4 m tree, 2.4 m at 20 m, 3.5 m at 32 m and up; a bare broadleaf's wider: 1.7 m at 4 m, 4.6 m at 20 m, 6 m from 28 m), crowns grown down from the tops (a cell joins the tree
  // of the higher cell beside it; then cells farther from their top than 0.8 x its height are let go). A few ms for a 520 m square.
  async function segTrees(D, breathe) {
    const n = D.n, k = D.kind, e = crg(D, eye), dx = D.dx, dz = D.dz, reach = D.reach || Infinity, band = D.band;
    const rcn = Math.min(n, Math.ceil(reach / dz) + 4), ccn = Math.min(n, Math.ceil(reach / dx) + 4);
    const r0 = Math.max(0, Math.floor(e.r) - rcn), r1 = Math.min(n - 1, Math.floor(e.r) + rcn), c0 = Math.max(0, Math.floor(e.c) - ccn), c1 = Math.min(n - 1, Math.floor(e.c) + ccn);
    const h = r1 - r0 + 1, w = c1 - c0 + 1, N = w * h, V = new Uint8Array(N), Hs = new Float32Array(N), B = new Uint8Array(N);
    const NE2 = NEAR_EVER * NEAR_EVER;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const v = k[(r0 + r) * n + c0 + c]; if (v >= 8) { V[r * w + c] = Math.max(1, khv(v)); const cl = kcls(v);
      B[r * w + c] = cl === 2 && V[r * w + c] >= NEAR_EVER_H5 && Math.pow((c0 + c - e.c) * dx, 2) + Math.pow((r0 + r - e.r) * dz, 2) < NE2 ? 0 : cl ? 1 : 0; } }   // a weak bare call near the eye, 6 m up: evergreen
    const g1 = 0.36 / 1.72, g0 = 1 / 1.72;   // a 0.7 m gaussian smoothing (3 x 3), trees only
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const i = r * w + c; if (!V[i]) continue; let s = 0;
      for (let a = -1; a <= 1; a++) { const rr = r + a; if (rr < 0 || rr >= h) continue; for (let b = -1; b <= 1; b++) { const cc = c + b; if (cc < 0 || cc >= w) continue; s += V[rr * w + cc] * (a ? g1 : g0) * (b ? g1 : g0); } }
      Hs[i] = s * 0.2;
    }
    await breathe();
    const tops = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c, hv = Hs[i]; if (!V[i] || hv < 2) continue;
        const rad = Math.round(2 * (B[i] ? Math.max(1.5, Math.min(6, 1 + 0.18 * hv)) : Math.max(1, Math.min(3.5, 0.6 + 0.09 * hv)))) / 2, R = Math.ceil(rad / Math.min(dx, dz) - 1e-3), R2 = rad * rad + 0.01; let top = true;   // in metres (a box's cell is 1.0013 m, not 1)
        for (let a = -R; a <= R && top; a++) { const rr = r + a; if (rr < 0 || rr >= h) continue; for (let b = -R; b <= R; b++) { if (a * a * dz * dz + b * b * dx * dx > R2) continue; const cc = c + b; if (cc < 0 || cc >= w) continue; const j = rr * w + cc, hj = Hs[j]; if (hj > hv || (hj === hv && j < i)) { top = false; break; } } }
        if (top) tops.push(i);
      }
      if (!(r & 127)) await breathe();
    }
    const T = tops.length, lab = new Int32Array(N), next = new Int32Array(N), head = new Int32Array(256).fill(-1), tail = new Int32Array(256).fill(-1), lim2 = new Float32Array(T + 1);
    const push = (i, l) => { next[i] = -1; if (tail[l] >= 0) next[tail[l]] = i; else head[l] = i; tail[l] = i; };   // first in, first out within a height: fronts meeting on a flat crown split it evenly
    for (let t = 0; t < T; t++) { const i = tops[t]; lab[i] = t + 1; const th = V[i] * 0.2; lim2[t + 1] = Math.pow(Math.max(2, 0.8 * th) / dx, 2) + 0.01; push(i, V[i]); }
    for (let l = 255; l >= 1; l--) {
      while (head[l] >= 0) {
        const i = head[l]; head[l] = next[i]; if (head[l] < 0) tail[l] = -1; const t = lab[i], r = (i / w) | 0, c = i - r * w;
        for (let a = -1; a <= 1; a++) { const rr = r + a; if (rr < 0 || rr >= h) continue; for (let b = -1; b <= 1; b++) { const cc = c + b; if (cc < 0 || cc >= w || (!a && !b)) continue; const j = rr * w + cc; if (!V[j] || lab[j]) continue;
          lab[j] = t; push(j, Math.min(V[j], l)); } }
      }
    }
    for (let i = 0; i < N; i++) { const t = lab[i]; if (!t) continue; const ti = tops[t - 1], tr = (ti / w) | 0, tc = ti - tr * w, r = (i / w) | 0, c = i - r * w; if ((r - tr) * (r - tr) + (c - tc) * (c - tc) > lim2[t]) lab[i] = 0; }   // then no farther from its top than 0.8 x its height
    await breathe();
    const cnt = new Uint32Array(T + 1), hm = new Uint8Array(T + 1), bare = new Uint32Array(T + 1), vs = new Float32Array(T + 1);
    for (let i = 0; i < N; i++) { const t = lab[i]; if (!t) continue; cnt[t]++; if (V[i] > hm[t]) hm[t] = V[i]; bare[t] += B[i]; vs[t] += V[i]; }
    const X = new Float32Array(T), Z = new Float32Array(T), Y = new Float32Array(T), Hh = new Float32Array(T), Cw = new Float32Array(T), Bb = new Uint8Array(T), Ex = new Float32Array(T); let m = 0;
    for (let t = 1; t <= T; t++) {
      const i = tops[t - 1], r = (i / w) | 0, c = i - r * w, R_ = r0 + r, C_ = c0 + c;
      const ok = Math.min((C_ + 0.5) * dx, (n - C_ - 0.5) * dx, (R_ + 0.5) * dz, (n - R_ - 0.5) * dz) >= band && Math.max(Math.abs(C_ - e.c) * dx, Math.abs(R_ - e.r) * dz) <= reach;
      if (!ok) continue;
      const hh = hm[t] * 0.2, cw = 2 * Math.sqrt(cnt[t] * dx * dz / Math.PI);
      X[m] = D.x0 + (C_ + 0.5) * dx; Z[m] = D.z0 + (R_ + 0.5) * dz; Y[m] = D.HF[R_ * n + C_]; Hh[m] = hh; Cw[m] = cw;
      Bb[m] = LEAF ? (bare[t] * 2 > cnt[t] ? 1 : 0) : (hh >= 6 && cw > 0.6 * hh ? 1 : 0);   // no leaf data: a crown wider than 0.6 x its height is taken as a broadleaf
      Ex[m] = crownEx(vs[t] / (cnt[t] * hm[t]));
      m++;
    }
    free(V); free(Hs); free(B); free(lab); free(next);
    return { count: m, X, Z, Y, H: Hh, CW: Cw, bare: Bb, EX: Ex };
  }
  // A2: an evergreen's outline from its own crown in the survey. Seen from above, a crown whose half-width at height y
  // (0 foot .. 1 top) is R (1 - y)^a has cells whose mean height is 1 / (2a + 1) of the top's: a cone (a = 1) a third,
  // a full, rounded crown (a = 0.5) a half. A closed stand's crowns meet high up, so they come out full and close the gaps.
  // Kept between 0.65 (fuller, the tip still pointed) and 1 (a cone): rounder reads as a broadleaf.
  const NEAR_DROP = 8;   // m from the eye to a crown: not drawn below this
  const crownEx = mrel => Math.max(0.65, Math.min(1, (1 / Math.max(0.2, Math.min(0.75, mrel)) - 1) / 2));
  // the drawn width (m) of a surveyed tree: its own crown, kept within what the shape can carry. The mask's 1 m cells
  // spread a crown by about half a cell a side (a cell counts when any return in it is high): measured against the
  // laser's own 0.5 m crowns at four stand pins, the cells' width is 1.2-1.6 m too wide; less 1.2 m (at most a third)
  // the drawn width is 0.97-1.08 x the laser's (trees review, 15 Nov 2026)
  const crownW = cw => Math.max(0.65 * cw, cw - 1.2);
  const drawnW = (h, cw, bare) => { const c = crownW(cw); return bare ? Math.max(1.2, Math.min(1.4 * h, Math.max(0.2 * h, c))) : Math.max(0.8, Math.min(1.2 * h, Math.max(0.15 * h, c))); };
  // A: one quad a tree, turned to the camera, the outline cut in the fragment shader. In a random order, so the slow
  // phone's share while moving is a thinner copy of the whole stand.
  function shapeGeo(S) {
    const m = S.count, g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const P = new Float32Array(m * 3), A = new Float32Array(m * 4), ord = new Uint32Array(m); for (let i = 0; i < m; i++) ord[i] = i;
    let s = 20261115; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
    for (let q = 0; q < m; q++) { const i = ord[q]; P[q * 3] = S.X[i]; P[q * 3 + 1] = S.Y[i]; P[q * 3 + 2] = S.Z[i]; A[q * 4] = S.H[i]; A[q * 4 + 1] = drawnW(S.H[i], S.CW[i], S.bare[i]); A[q * 4 + 2] = S.bare[i] ? 2 : S.EX[i] / 2.5; A[q * 4 + 3] = rnd(); }   // z: 2 = bare, else the crown's shape (a / 2.5)
    if (window.__treeDump) window.__treeDump.near = { style: 'shapes', trees: { X: S.X.slice(0, m), Z: S.Z.slice(0, m), Y: S.Y.slice(0, m), H: S.H.slice(0, m), CW: S.CW.slice(0, m), bare: S.bare.slice(0, m), EX: S.EX.slice(0, m) } };
    g.setAttribute('tpos', new THREE.InstancedBufferAttribute(P, 3)); g.setAttribute('tsz', new THREE.InstancedBufferAttribute(A, 4)); g.instanceCount = m;
    return g;
  }
  const SHAPE_VS = `
    uniform sampler2D kmap; uniform sampler2D lmap; uniform vec4 rect; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 amb; uniform float fogD; uniform float pscale;
    uniform float oh;   // 1 = the view from above: each tree is its crown seen from over it (a flat quad at the tree's top)
    attribute vec3 tpos; attribute vec4 tsz;   // ground point; height m, drawn width m, 2 = bare else the crown's shape a / 2.5, random
    varying vec2 vQ; varying vec4 vT; varying vec3 vSun; varying vec3 vAmb; varying float vFog; varying float vSide; varying float vPx;
#ifdef OH
    varying vec3 vOh;
#endif
    void main() {
      vec2 rg = vec2(viewMatrix[0][0], viewMatrix[2][0]); rg = length(rg) > 1e-5 ? normalize(rg) : vec2(1., 0.);
#ifdef OH
      vec2 fw = vec2(viewMatrix[0][1], viewMatrix[2][1]); fw = length(fw) > 1e-5 ? normalize(fw) : vec2(0., -1.);   // the screen's up, on the ground (from above)
#endif
      // A2: a crown close to the eye is a flat quad seen from inside its own width (a striped slab at a frame edge): a tree
      // whose crown (a cylinder: the drawn half-width round the stem, foot to top) is within NEAR_DROP m of the eye in 3D is
      // not drawn. Per frame in the shader, so it follows the eye while walking. (A dithered fade over 8-12 m was tried:
      // still pictures showed half-faded ghost trees, so it is a clean drop.)
      vec2 dxz = tpos.xz - cameraPosition.xz; float dh = max(length(dxz) - .5 * tsz.y, 0.), dv = max(max(tpos.y - cameraPosition.y, cameraPosition.y - tpos.y - tsz.x), 0.);
      if (length(vec2(dh, dv)) < ${NEAR_DROP.toFixed(1)}) { gl_Position = vec4(2., 2., 2., 1.); return; }
      vec3 p = vec3(tpos.x + rg.x * position.x * tsz.y, tpos.y - .4 + position.y * (tsz.x + .4), tpos.z + rg.y * position.x * tsz.y);   // the foot a little into the ground (slopes)
#ifdef OH
      if (oh > .5) p = vec3(tpos.x + (rg.x * position.x + fw.x * (position.y - .5)) * tsz.y, tpos.y + tsz.x, tpos.z + (rg.y * position.x + fw.y * (position.y - .5)) * tsz.y);
#endif
      vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; float dist = length(mv.xyz);
      vQ = position.xy; vT = tsz;
      vec2 uv = (tpos.xz - rect.xy) / rect.zw; float sh = 0., hl = length(sunDir.xz);
      if (hl > 1e-4) { vec2 dir = sunDir.xz / hl / rect.zw; float tanA = sunDir.y / hl, y0 = tsz.x * (.2 + .7 * position.y);
        for (int k = 1; k <= 6; k++) { float d = .5 * tsz.y + 1.6 * float(k); if (y0 + tanA * d < texture2D(kmap, uv + dir * d).a * 51.) sh += .22; } }
      vSun = sunCol * texture2D(lmap, uv).a * (1. - .8 * min(sh, 1.)); vAmb = amb;
      vSide = hl > 1e-4 ? dot(sunDir.xz / hl, rg) : 0.;
#ifdef OH
      vOh = vec3(oh, hl > 1e-4 ? dot(sunDir.xz / hl, rg) : 0., hl > 1e-4 ? dot(sunDir.xz / hl, fw) : 0.);
#endif
      vFog = 1. - exp(-pow(fogD * dist, 2.)); vPx = dist / pscale;
    }`;
  // A draws the outline solid; B (STIPPLE) fills the same outline with soft dots (a point cloud with no gaps however
  // near the tree is: the dots are cut in the fragment shader, a few cm apart close by, a pixel and a half far off).
  const SHAPE_FS = `
    precision highp float; uniform float snowMode; uniform vec3 fogCol;
    varying vec2 vQ; varying vec4 vT; varying vec3 vSun; varying vec3 vAmb; varying float vFog; varying float vSide; varying float vPx;
#ifdef OH
    varying vec3 vOh;
#endif
    float h1(float x) { return fract(sin(x * 78.233) * 43758.5453); }
    float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float sg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * t); }
    // B: is (x, y) on a dot? q = dot spacing (m), keep = share of the dots there; shade (0..1) a dot's own
    bool dot2(vec2 p, float q, float keep, float r, out float shade) {
      vec2 g = p / q, cell = floor(g), f = fract(g) - .5, off = vec2(h2(cell + r), h2(cell + r + 3.1)) - .5;
      shade = h2(cell + r + 5.);
      return h2(cell + r + 11.) < keep && length(f - .75 * off) < .3 + .2 * h2(cell + r + 7.);   // dots off the grid, of uneven size
    }
    void main() {
#ifdef OH
      if (vOh.x > .5) {   // from above: an evergreen is a dark round crown (snow on its boughs), a bare tree a lace of limbs
        vec2 d = vec2(vQ.x, vQ.y - .5) * 2.; float rr = length(d), rw = vT.w, ww = vT.y, pxo = max(vPx, .01), lt = .5 + .5 * clamp(dot(d, vOh.yz), -1., 1.);
        vec3 co;
        if (vT.z >= 2.) {
          if (rr > 1.) discard;
          float ang = atan(d.y, d.x), limb = abs(fract(ang / 6.2832 * 7. + rw * 3.) - .5) * rr * ww;
          if (limb > max(.12, .6 * pxo) && rr > .1 && h2(floor(d * ww / max(.2, pxo)) + rw * 17.) > .1 + .22 * (1. - rr)) discard;
          co = vec3(.30, .27, .25) * (.8 + .4 * h1(rw * 9.));
        } else {
          float ang = atan(d.y, d.x);
          if (rr > .84 + .1 * sin(ang * 7. + rw * 40.) + .06 * sin(ang * 13. + rw * 17.)) discard;
          co = (snowMode > .5 ? vec3(.075, .12, .095) : vec3(.10, .19, .09)) * (.8 + .4 * h1(rw * 7.)) * (.75 + .5 * (1. - rr));
          if (snowMode > .5 && rr < .8 && h2(floor(d * ww / max(.5, pxo)) + rw) > .72) co = mix(co, vec3(.80, .84, .88), .55);
        }
        vec3 cl = co * (vAmb * .8 + vSun * (.3 + .55 * lt));
        cl = pow(min(cl * .9, vec3(1.)), vec3(.62));
        gl_FragColor = vec4(mix(cl, fogCol, vFog), 1.); return;
      }
#endif
      float H = vT.x, W = vT.y, r = vT.w, x = vQ.x * W, y = vQ.y * H, px = max(vPx, .01), lit, sh = .5;
      vec3 c;
      if (vT.z < 1.) {   // evergreen: a spire of tiered boughs from just over the snow to the top, as full as its survey crown
        float cb = .06 + .05 * h1(r * 13.), tw = max(.14, .02 * H), ex = vT.z * 2.5;
        if (vQ.y < cb) { if (abs(x) > max(.5 * tw, .5 * px)) discard; c = vec3(.17, .13, .10); lit = .3; }
        else {
          float nt = 4. + floor(H / 3.), yc = (vQ.y - cb) / (1. - cb), side = x < 0. ? 1.7 : 0., tier = fract(yc * nt + r * 5. + .35 * h1(floor(yc * nt) + side + r));
          float wob = .5 + .25 * sin(y * 2.3 + r * 40. + side) + .25 * sin(y * 5.1 + r * 17.);
    #ifdef STIPPLE
          float hw = .5 * W * pow(1. - yc, ex) * (.85 + .15 * pow(tier, 1.6)) * (.94 + .06 * wob), ax = abs(x) / max(hw, 1e-3);
          if (ax > 1.15) discard;
          if (!dot2(vec2(x, y), max(.13, 1.5 * px), .92 - .55 * smoothstep(.55, 1.15, ax), r, sh)) discard;
          c = (snowMode > .5 ? vec3(.075, .12, .095) : vec3(.10, .19, .09)) * (.65 + .7 * sh);
          if (snowMode > .5 && tier > .8 && sh > .82) c = vec3(.78, .82, .87);   // snow caught on a bough
    #else
          float hw = .5 * W * pow(1. - yc, ex) * (.82 + .18 * pow(tier, 1.6)) * (.94 + .06 * wob);
          if (abs(x) > max(hw, .5 * px)) discard;
          vec2 gq = max(vec2(.5, .3), vec2(px)); if (abs(x) > .8 * hw && h2(floor(vec2(x, y) / gq) + r * 3.) > .96 - .4 * (abs(x) / hw - .8)) discard;   // light through the outermost boughs
          c = (snowMode > .5 ? vec3(.075, .12, .095) : vec3(.10, .19, .09)) * (.8 + .4 * h1(r * 7.)) * (.9 + .2 * tier);
          vec2 sq = max(vec2(.6, .35), vec2(px)), sg2 = vec2(x, y) / sq, sf = fract(sg2) - .5;
          if (snowMode > .5 && tier > .8 && abs(x) > .3 * hw && abs(x) < .92 * hw && h2(floor(sg2) + r) > .62 && (px > .2 || length(sf * vec2(1., 3.)) < .5)) c = mix(c, vec3(.80, .84, .88), .7);   // snow lying along a bough's upper side (a thin clump close by)
    #endif
          lit = .3 + .55 * yc;
        }
      } else {   // bare in winter: trunk, limbs from the fork to the crown's edge (each with a fork of its own) and twigs, more of them outward
        float tw = max(.16, .028 * H), fork = (.24 + .12 * h1(r * 3.1)) * H, cy = .6 * H, ry = .4 * H, rx = .5 * W;
        float lean = (h1(r * 2.3) - .5) * .12 * W, tx = x - lean * clamp(y / H, 0., 1.);   // a trunk leans a little
        bool on = y < .7 * H && abs(tx) < max(.5 * mix(tw, .3 * tw, clamp(y / (.7 * H), 0., 1.)), .5 * px), twig = false;
        float ang = atan(x, y - cy), e2 = x * x / (rx * rx) + (y - cy) * (y - cy) / (ry * ry);
        e2 /= .82 + .18 * sin(ang * 3. + r * 20.) * sin(ang * 5. + r * 9.);   // an uneven crown
        if (!on && e2 < 1.05 && y > fork) {
          for (int i = 0; i < 9; i++) {
            float fi = float(i), a = (-1. + 2. * (fi + .5) / 9.) * (1.15 + .3 * h1(r + fi)), oy = fork + (.03 + .22 * h1(r * 5. + fi)) * H;
            vec2 o = vec2(lean * oy / H, oy), t2 = vec2(sin(a) * rx * .95, cy + cos(a) * ry * .95), m2 = mix(o, t2, .5 + .15 * h1(r * 7. + fi));
            float wl = max(.03, .26 * tw * (1. - clamp((y - oy) / (H - oy), 0., 1.))), lw = max(wl, .4 * px);
            if (sg(vec2(x, y), o, t2) < lw) { on = true; break; }
            float b2 = a + (h1(r * 11. + fi) > .5 ? .55 : -.55);
            vec2 t3 = m2 + vec2(sin(b2), cos(b2)) * .45 * length(t2 - o);
            if (sg(vec2(x, y), m2, t3) < max(.6 * wl, .4 * px)) { on = true; break; }
          }
          if (!on && e2 < 1.) { float q = max(.07, px); if (h2(floor(vec2(x, y) / q) + r * 17.) < .08 + .3 * smoothstep(.2, 1., e2)) { on = true; twig = true; } }   // twigs: a fine haze, thicker outward
        }
        if (!on) discard;
    #ifdef STIPPLE
        if (!dot2(vec2(x, y), max(.06, 1.2 * px), twig ? .7 : .97, r, sh)) discard;
    #endif
        c = vec3(.30, .27, .25) * (.8 + .4 * h1(r * 9.)) * (.85 + .3 * sh); lit = .55;
      }
      vec3 col = c * (vAmb * (.55 + .45 * lit) + vSun * (.25 + .5 * lit) * (1. + .4 * clamp(x / max(.5 * W, .1) * vSide, -1., 1.)));
      col = pow(min(col * .9, vec3(1.)), vec3(.62));
      gl_FragColor = vec4(mix(col, fogCol, vFog), 1.);
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
        const w = thin(r, c), want = per * w, top = khv(v) * 0.2;
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
    if (window.__treeDump) window.__treeDump.near = { style: 'dots', P: pos.slice(0, m * 3), A: seed.slice(0, m * 4) };   // (test harness only)
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
      px[i * 4] = bl ? 255 : 0; px[i * 4 + 1] = by ? 255 : 0; px[i * 4 + 2] = v === 3 && !by ? (still(r, c) ? 127 : 255) : v === 4 ? 64 : 0; px[i * 4 + 3] = khv(v);
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
    const skyU = { zen: { value: new THREE.Vector3(.2, .4, .8) }, hor: { value: new THREE.Vector3(.7, .8, .9) } }, iceU = { value: ice ? 1 : 0 }, tshU = { value: treesOn ? 1 : 0 };
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
    R = { renderer, canvas, gl: renderer.getContext(), cw: 0, ch: 0, thin: 1, fx, fz, lite: [], lo, hi, lightMat, quad, lightScene, lightCam, terrMat, near, det, skyU, iceU, tshU, lost: false,
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
      const STYLE = TSTYLES.includes(my.treeStyle) ? my.treeStyle : 'dots';
      LEAF = hasDet && dc.leaf ? (dc.leaf === 2 ? 2 : 1) : 0;
      if (hasDet) {
      // 1. the heights: inside the near box when there is one, else inside the wide grid
      list = dparts; dparts = [];
      m = await decode(list, dc.n, dc.base || 0, dc.step || 0.02, fine); list = null;
      const w = (dc.east - dc.west) * kx, d = (dc.north - dc.south) * kz, P = NR || my, pcell = NR ? Math.max(NR.w, NR.d) / (G - 1) : Math.max(my.W, my.D) / (G - 1);
      const keep = Math.max(4, Math.min(25, 0.5 * pcell)), band = keep + Math.max(16, Math.min(45, 2 * pcell));
      if (!(dc.west >= P.west && dc.east <= P.east && dc.south >= P.south && dc.north <= P.north) || Math.min(w, d) < 4 * band) throw new Error('detail grid does not fit');
      D = { reach: STYLE === 'dots' && Math.max(w, d) > 600 ? TREE_REACH : Infinity,   // A / B: every tree of the box one by one (few enough to draw)
         n: dn, HF: m.HF, north: dc.north, south: dc.south, west: dc.west, east: dc.east, x0: (dc.west - my.west) * kx, z0: (my.north - dc.north) * kz, w, d, dx: w / dn, dz: d / dn, keep, band, up: NR || FAR, lift: 2, kind: null };
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
        if (STYLE !== 'dots') {   // A / B: one drawn tree a surveyed tree (the returns file is not needed)
          tparts = []; const S = await segTrees(D, breathe);
          tp = S.count ? { inst: shapeGeo(S), count: S.count, real: true } : null;
        } else {
        if (dc.trees && tparts.length) { list = tparts; tparts = []; blob = pack(list); list = null; }
        try { tp = await treePoints(D, blob, Math.min(64, tc.bins || 64), tc.bin || 0.6, cap, fine, breathe); }
        catch (e) { if (!blob) throw e; tp = await treePoints(D, null, 64, 0.6, cap, fine, breathe); }   // a bad tree file: made-up points under the canopy tops instead
        }
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
      const lu = { hmap: { value: dmap }, fmap: { value: hmap }, kmap: { value: kmap }, lift: { value: 0.3 }, ice: R.iceU, tsh: R.tshU, rect: { value: drect }, fsize: { value: size }, step0: { value: 1.2 * Math.max(D.dx, D.dz) }, fcells: { value: FAR.n }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, size: { value: new THREE.Vector2(D.w, D.d) }, texel: { value: 1 / D.n }, snowMode: sunU.snowMode, maxH: sunU.maxH, baseH: sunU.baseH };
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
      if (tp && tp.inst) {   // A / B: one quad a tree
        const smat = new THREE.ShaderMaterial({ defines: STYLE === 'cloud' ? { STIPPLE: 1 } : {}, uniforms: { kmap: { value: kmap }, lmap: { value: dlo.texture }, rect: { value: drect }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: fog.fogCol, fogD: fog.fogD, pscale: { value: 600 }, snowMode: sunU.snowMode, oh: OHU }, vertexShader: SHAPE_VS, fragmentShader: SHAPE_FS }); ohMat(smat);
        det.points = new THREE.Mesh(tp.inst, smat); det.points.frustumCulled = false; det.inst = true; det.count = tp.count; made.push(tp.inst, smat);
        const drop = function () { free(this.array); this.array = null; }; tp.inst.attributes.tpos.onUpload(drop); tp.inst.attributes.tsz.onUpload(drop);
      } else if (tp) {
        const pmat = new THREE.ShaderMaterial({ uniforms: { kmap: { value: kmap }, lmap: { value: dlo.texture }, rect: { value: drect }, sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: fog.fogCol, fogD: fog.fogD, pscale: { value: 600 }, snowMode: sunU.snowMode, clearR: { value: 12 }, oh: OHU }, vertexShader: TREE_VS, fragmentShader: TREE_FS });
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
        R.cam.near = 1; R.nearBase = 1;
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
  // A / B: a lone park-wide tree's width for its height, from the laser boxes' own trees (tools/sun3d/lidar/build_leaf.py sizes:
  // the median crown width over height, evergreen / bare, trees of 8 m and up, 16 boxes, 185,000 trees, less the 1 m cells' spread as crownW)
  const WIDE_EVER = 0.2, WIDE_BARE = 0.27;
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
    const WL = !!(my.canopy && my.canopy.leaf), STY = TSTYLES.includes(my.treeStyle) && my.treeStyle !== 'dots';   // tiles with the bare bit (128; lod 1: w - 1 in bits 5-6, height in 0-4); A / B sizes
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
          const v0 = ln[c + 1]; if (!v0) continue; const v = WL ? v0 & 127 : v0, vb = WL ? v0 >> 7 : 0;
          const x = x0 + (c + 0.5) * dx, d2 = (x - ex) * (x - ex) + dz2; if (d2 > R2) continue;
          if (inZ && x > i0 && x < i1) continue;   // the laser box's own trees are there
          const w = lod ? (WL ? ((v >> 5) & 3) + 1 : (v >> 6) + 1) : 1;
          if (d2 >= w * DM2) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; if (s / 4294967296 >= w * DM2 / d2) continue; }
          if (cn === CX.length) { CX = grow(CX); CZ = grow(CZ); CH = grow(CH); CD = grow(CD); CW = grow(CW); }
          CX[cn] = x; CZ[cn] = z; CH[cn] = (lod ? (WL ? v & 31 : v & 63) : v) * step; CD[cn] = d2; CW[cn] = (lod ? w + 8 : 1) | (vb ? 64 : 0); cn++;   // (8+: from a lod 1 file)
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
      const x = CX[i], z = CZ[i], h = CH[i], d2 = CD[i], w = CW[i] & 7, big = (CW[i] & 63) > 8 ? 2 : 1, bare = CW[i] & 64 ? 1 : 0;
      const p = Math.min(1, w * D02 / d2), pc = Math.min(1, w * DM2 / d2); if (p < pc && rnd() >= p / pc) continue;
      const cells = w / p;   // the tree cells this one drawn tree stands for
      const hh = h * (0.9 + 0.2 * rnd()), wide = cells > 1.01 ? Math.min(5 * hh, Math.max(0.45 * hh, 1.1 * cell0 * Math.sqrt(cells))) : !STY ? Math.max(1.2, Math.min(0.5 * hh, 1.2 * cell0))
        : bare ? Math.max(1.5, Math.min(WIDE_BARE * hh, 1.6 * cell0)) : Math.max(1, Math.min(WIDE_EVER * hh, 1.2 * cell0));   // A / B: the survey's own crown width for the height (see WIDE_EVER)
      const px = x + (rnd() - 0.5) * fineDx * big * 0.8, pz = z + (rnd() - 0.5) * fineDz * big * 0.8;
      pos[m * 3] = px; pos[m * 3 + 1] = groundAt(px, pz); pos[m * 3 + 2] = pz;
      tw[m * 4] = hh; tw[m * 4 + 1] = wide; tw[m * 4 + 2] = rnd(); tw[m * 4 + 3] = rnd() + (STY && bare ? 2 : 0);   // 2+: bare in winter
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
    if (window.__treeDump) window.__treeDump.wide = { P: P.slice(), A: A.slice() };   // (test harness only)
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
    uniform float oh;   // 1 = from above: the point is the crown seen from over the tree's top
    attribute vec4 tw;
    varying vec4 vS; varying vec3 vBase; varying vec3 vSun; varying vec3 vFogC; varying float vFog; varying float vSide;
#ifdef OH
    varying vec3 vOh;
#endif
    void main() {
      float S = max(tw.x, tw.y);
      vec4 mv = modelViewMatrix * vec4(position.x, position.y + (oh > .5 ? tw.x : S * .5), position.z, 1.); float dist = length(mv.xyz);
      float px = (oh > .5 ? tw.y : S) * pscale / max(dist, 1.);
      // not drawn: past the level's share, under a pixel, too close, or bigger than the phone draws a point (a smaller one
      // would float over the ground: its middle is pinned, not its foot)
      if (tw.z >= share || px < .8 || px > psMax || distance(position.xz, cameraPosition.xz) < clearR * (1. - oh)) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 1.; return; }
      gl_Position = projectionMatrix * mv; gl_PointSize = px;
      float k = max(1., floor(tw.y / max(.55 * tw.x, 1.) + .5));   // a clump: a few tips side by side
      vS = vec4(tw.x / S, tw.y / S, k, tw.w);
      vec2 nu = (position.xz - nrect.xy) / nrect.zw;
      float vis = hasN > .5 && nu.x > 0. && nu.y > 0. && nu.x < 1. && nu.y < 1. ? texture2D(lmapN, nu).a : texture2D(lmapF, position.xz / size).a;
      vBase = (snowMode > .5 ? vec3(.085, .135, .105) : vec3(.10, .19, .09)) * (.6 + .8 * fract(tw.w));
      vSun = sunCol * vis;
      vec2 rgt = vec2(viewMatrix[0][0], viewMatrix[2][0]), sh = sunDir.xz;
      vSide = length(rgt) > 1e-4 && length(sh) > 1e-4 ? dot(normalize(sh), normalize(rgt)) : 0.;
#ifdef OH
      vec2 upg = vec2(viewMatrix[0][1], viewMatrix[2][1]);
      vOh = vec3(oh, vSide, length(upg) > 1e-4 && length(sh) > 1e-4 ? dot(normalize(sh), normalize(upg)) : 0.);
#endif
      vFog = 1. - exp(-pow(fogD * dist, 2.)); vFogC = fogCol;
    }`;
  const WTREE_FS = `
    precision highp float; uniform vec3 amb; uniform float snowMode;
    varying vec4 vS; varying vec3 vBase; varying vec3 vSun; varying vec3 vFogC; varying float vFog; varying float vSide;
#ifdef OH
    varying vec3 vOh;
#endif
    float h1(float x) { return fract(sin(x * 78.233) * 43758.5453); }
    void main() {
#ifdef OH
      if (vOh.x > .5) {   // from above: a round crown (an evergreen), or a see-through lace (bare in winter)
        vec2 qo = gl_PointCoord, d = vec2(qo.x - .5, .5 - qo.y) * 2.; float rr = length(d), ro = fract(vS.w), lt = .5 + .5 * clamp(dot(d, vOh.yz), -1., 1.);
        vec3 co;
        if (vS.w >= 2.) { if (rr > 1. || h1(floor(qo.x * 20.) + floor(qo.y * 20.) * 53.1 + ro * 7.) > .2 + .3 * (1. - rr)) discard; co = vec3(.30, .27, .25) * (.8 + .4 * h1(ro * 9.)); }
        else {
          float ang = atan(d.y, d.x); if (rr > .84 + .1 * sin(ang * 7. + ro * 40.)) discard;
          co = vBase * (.75 + .5 * (1. - rr));
          if (snowMode > .5 && rr < .8 && h1(floor(qo.x * 9.) + floor(qo.y * 9.) * 31.7 + ro * 13.) > .72) co = mix(co, vec3(.80, .84, .88), .5);
        }
        vec3 cl = co * (amb * .8 + vSun * (.3 + .55 * lt));
        cl = pow(min(cl * .9, vec3(1.)), vec3(.62));
        gl_FragColor = vec4(mix(cl, vFogC, vFog), 1.); return;
      }
#endif
      vec2 q = gl_PointCoord; float yb = (1. - q.y) / vS.x, u = (q.x - .5) / vS.y;   // yb 0 at the ground .. 1 at the crown's top; u -.5 .. .5 across it
      if (yb > 1. || abs(u) > .5) discard;
      if (vS.w >= 2.) {   // bare in winter (A / B): a trunk and a lace of twigs in an oval crown, see-through, grey-brown
        float r = fract(vS.w), k2 = vS.z, j2 = floor((u + .5) * k2), u2 = fract((u + .5) * k2) - .5, t2 = k2 > 1.5 ? .75 + .25 * h1(j2 + r * 17.) : 1., y2 = yb / t2;
        if (y2 > 1.) discard;
        float e2 = u2 * u2 / .25 + (y2 - .6) * (y2 - .6) / .16;
        bool on = abs(u2) < .03 && y2 < .72;
        if (!on) { if (e2 > 1. || y2 < .26) discard; if (h1(floor(q.x * 48.) + floor(q.y * 48.) * 53.1 + r * 7.) > .22 + .3 * e2) discard; }
        vec3 bc = vec3(.30, .27, .25) * (.8 + .4 * h1(r * 9.));
        vec3 c2 = bc * (amb * .8 + vSun * .52 * (1. + .4 * clamp(u2 * 2. * vSide, -1., 1.)));
        c2 = pow(min(c2 * .9, vec3(1.)), vec3(.62));
        gl_FragColor = vec4(mix(c2, vFogC, vFog), 1.); return;
      }
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
          if (Math.hypot(cx0 - ex, cz0 - ez) < 400) bldNear.push({ pts, cx: cx0, cz: cz0, top: r });
          const gable = b.roof === 'gable' && b.r > b.e + 0.3, ar = (b.a || 0) * Math.PI / 180, nx = -Math.sin(ar), nz = Math.cos(ar), hw = Math.max(b.hw || 0, 0.5) * kxF / kxt;
          const dist = p => (p[0] - cx) * nx + (p[1] - cz) * nz, top = p => gable ? e + (r - e) * Math.max(0, 1 - Math.abs(dist(p)) / hw) : r;
          // (a building's parts share a colour: ids are building x 4 + part)
          let s = (((b.id || 0) >> 2) * 2654435761) >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
          // Faroes tiles (14 Nov 2026) carry each building's roof / wall colour as seen from the air (rc / wc, 0-255): turned
          // to albedo as the old Faroes houses did; tiles without them (Grand Teton) draw as before
          const alb = c => [Math.pow(c[0] / 255, 1.613), Math.pow(c[1] / 255, 1.613), Math.pow(c[2] / 255, 1.613)];
          const tone = 0.75 + 0.5 * rnd(), wall = b.wc ? alb(b.wc) : snowy ? [0.24 * tone, 0.17 * tone, 0.12 * tone] : [0.42 * tone, 0.36 * tone, 0.3 * tone];
          const pitch = gable ? Math.atan((r - e) / hw) * 180 / Math.PI : 0;
          const roofC = b.rc ? alb(b.rc) : snowy ? (pitch > 48 ? [0.32, 0.31, 0.32] : [0.86, 0.89, 0.93].map(v => v * (0.94 + 0.06 * rnd()))) : [0.33 * tone, 0.25 * tone, 0.22 * tone];
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
      if (!touched && bldNear.length) { aim(); heading(); }   // a close subject on a building: aim at its roof, as before the bare boxes
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
        sunDir: sunU.sunDir, sunCol: sunU.sunCol, amb: sunU.amb, fogCol: fog.fogCol, fogD: fog.fogD, pscale: { value: 600 }, snowMode: sunU.snowMode, share: { value: 1 }, clearR: { value: 30 }, psMax: { value: psMax }, oh: OHU },
        vertexShader: WTREE_VS, fragmentShader: WTREE_FS }); ohMat(mat);
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
    const r = R.renderer, t = tgt(R, k); SPL.lightN++;
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
    const ls = OH.on && !OH.sunOn ? OH_EVEN : sun;   // from above with the sun off: an even light, no shadows
    const v = sunVec(ls.az, ls.alt), A = atmo(ls.alt); R.sv = v;
    R.lightMat.uniforms.sunDir.value.set(v.x, v.y, v.z);
    const sI = A.sunI * (ls.k || 1);
    R.lightMat.uniforms.sunCol.value.set(A.sun[0] * sI, A.sun[1] * sI, A.sun[2] * sI);
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
  // How far a building's roof stands above the ground at the subject pin (0 = not on a building): the pin inside an
  // outline, or within 4 m of one's middle
  function roofLift(b) {
    const x = (b.c + 0.5) * FAR.dx, z = (b.r + 0.5) * FAR.dz; let best = 0;
    for (const h of bldNear) {
      let k = false; const P = h.pts;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], c = P[j]; if ((a[1] > z) !== (c[1] > z) && x < (c[0] - a[0]) * (z - a[1]) / (c[1] - a[1]) + a[0]) k = !k; }
      if (k || Math.hypot(h.cx - x, h.cz - z) < 4) best = Math.max(best, h.top - groundAt(x, z));
    }
    return Math.max(0, Math.min(40, best));
  }
  function aim() {
    const a = cr(eye), b = cr(target), dx = (b.c - a.c) * FAR.dx, dz = (b.r - a.r) * FAR.dz, dist = Math.hypot(dx, dz);
    yaw = dist > 5 ? Math.atan2(dx, -dz) : 0;
    const e = pick(eye), t = pick(target), up = eyeH(e);
    if (dist > 3000 || t.g === FAR) {
      const top = dist > 3000 ? Math.atan2(snap(t, snapR(t.g)).h - up, dist) : 0.04;
      pitch = Math.max(0.01, top * 0.45);
    } else pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(gh(t.g, t.c, t.r) + roofLift(b) + 6 - up, Math.max(dist, 20))));   // a close subject on the fine grid: look straight at it, up or down
    if (framed) { yaw = framed.yaw; pitch = framed.pitch; }   // the shot's saved framing wins over the subject aim
    focus();
  }
  // { yaw_deg, pitch_deg } -> the page's own radians; anything else (null, {}, bad numbers) = no framing
  function toFraming(v) {
    if (!v || typeof v !== 'object') return null;
    const y = Number(v.yaw_deg), p = Number(v.pitch_deg);
    if (v.yaw_deg == null || v.pitch_deg == null || !Number.isFinite(y) || !Number.isFinite(p)) return null;
    return { yaw: y * Math.PI / 180, pitch: Math.max(-1.2, Math.min(1.2, p * Math.PI / 180)) };
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
    const vp = eyeVP(), a = (R && R.cam.aspect) || (vp.w / vp.h);
    const th = lens.fw / (2 * lens.f), tv = lens.fh / (2 * lens.f), k = Math.max(th / (a * 0.9), tv / 0.9);
    const el = document.getElementById('frame');
    if (el) {   // written only when it changes: this runs every frame, and a style write makes the web view lay the page out again
      const only = !!(lens.box && lens.only), disp = lens.box ? 'block' : 'none', sp = splitOn();
      // split: the box sits in the middle of the top half, sized in px (the page's % would be of the whole height), and
      // frame only's black is clipped to the top half
      const fw = th / (k * a) * vp.w, fh = tv / k * vp.h, wd = sp ? fw + 'px' : (th / (k * a) * 100) + '%', ht = sp ? fh + 'px' : (tv / k * 100) + '%';
      const top = sp ? (vp.h / 2) + 'px' : '50%', clip = sp && only ? `inset(${-(vp.h - fh) / 2}px ${-(vp.w - fw) / 2}px ${-(vp.h - fh) / 2}px ${-(vp.w - fw) / 2}px)` : '', key = disp + wd + ht + only + top + clip;
      if (key !== lensKey) {
        lensKey = key; el.style.display = disp; el.style.width = wd; el.style.height = ht; el.style.top = top; el.style.clipPath = clip;
        // frame only (17 Nov 2026): a huge black shadow round the box hides everything outside it
        el.style.boxShadow = only ? '0 0 0 1px rgba(0,0,0,.55), 0 0 0 4000px #000' : '';
      }
    }
    return 2 * Math.atan(k);
  }
  function place(pxH) {
    const q = cr(eye), e = pick(eye), cam = R.cam; pxH = pxH || R.canvas.height;   // pxH: the view's height in canvas pixels (split: the top half's)
    cam.position.set((q.c + 0.5) * FAR.dx, eyeH(e), (q.r + 0.5) * FAR.dz); cam.rotation.set(pitch, -yaw, 0);
    // a low camera (0.3-1 m) must not cut the ground in front of it: the near plane comes in with the eye height
    if (R.nearBase == null) R.nearBase = cam.near;
    cam.near = Math.min(R.nearBase, Math.max(0.15, EYE * 0.4));
    cam.fov = lensFov() * 180 / Math.PI; cam.updateProjectionMatrix(); R.sky.position.copy(cam.position);
    if (R.det && R.det.points) R.det.points.material.uniforms.pscale.value = pxH / (2 * Math.tan(cam.fov * Math.PI / 360)) / (R.det.inst ? 1 : Math.sqrt(R.thin));   // a point's metres -> pixels at 1 m
    if (R.wide) R.wide.mat.uniforms.pscale.value = pxH / (2 * Math.tan(cam.fov * Math.PI / 360));
  }
  function resize() { const w = window.innerWidth, h = window.innerHeight; if (!R || !w || !h) return; const vp = eyeVP(); R.cam.aspect = vp.w / vp.h; dirty = true; }   // draw() sizes the canvas

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
    if (P) P.visible = treesOn;
    if (P && treesOn) { pts = Math.max(1, Math.floor(R.det.count * q.trees)); if (R.det.inst) P.geometry.instanceCount = pts; else if (P.geometry.drawRange.count !== pts) P.geometry.setDrawRange(0, pts); R.thin = q.trees; }   // fewer points are drawn larger (place)
    let wpts = 0;
    if (splitOn()) wpts = drawSplit(q, cw, ch, w, h);
    else {
      if (OH.on) placeOH(R.cam, ch); else place(ch);
      wpts = pass(R.cam, q, () => { if (OH.on) R.disc.visible = R.halo.visible = false; });
      if (OH.on) ohOverlay(); else othOverlay();
    }
    dirty = false; frames++;
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
  // One picture with one camera into the renderer's current viewport: only the blocks in its view, the level's share of
  // the park-wide trees, the sun disc placed for it. `pre` runs just before the render. Returns the tree points drawn.
  function pass(cam, q, pre) {
    const v = R.sv;
    cam.updateMatrixWorld(); _fr.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, _iv.copy(cam.matrixWorld).invert()));
    // (the wide mesh: none of its blocks wholly under the range's box, where it would only be discarded)
    cull(R.ctx.terrain, R.fx, R.fz, q.geo > 1 ? BSTART2 : BSTART, R.range ? [holeOf(RG)] : null); if (R.near) cullWarped(R.near, NR, q.geo ? BSTART2 : BSTART); if (R.det) cullWarped(R.det, DT, q.geo ? BSTART2 : BSTART); if (R.range) cullWarped(R.range, RG, BSTART2);
    let wpts = 0;
    if (R.wide) {   // the park-wide trees: the level's share of them (none at the lowest), only the blocks in view
      const W = R.wide; W.mat.uniforms.share.value = q.wide; W.points.visible = treesOn && q.wide > 0 && cullWide(W) > 0;
      if (W.points.visible) for (const g of W.geo.groups) wpts += g.count;
      wpts = Math.round(wpts * q.wide);
    }
    R.disc.position.set(cam.position.x + v.x * 190000, cam.position.y + v.y * 190000, cam.position.z + v.z * 190000); R.disc.lookAt(cam.position);
    R.halo.position.copy(R.disc.position); R.halo.lookAt(cam.position);
    if (pre) pre();
    R.renderer.render(R.scene, cam); SPL.renders++;
    return wpts;
  }
  // ---- From above (Phil, 16 Nov 2026: the stop page's Overhead tab, "3D from above") ----
  // S3D.overhead({ on, shots: [{ id, code, name, subject?, v: {lat, lng}, s?: {lat, lng}, heading_deg: number | null,
  //   fov_deg, star, sel }], heading_up_deg?, sun?, shaded?, fit? }) puts the page into a view straight down over the
  // shots: the same terrain, colour, buildings and trees as the 3D view, lit by the sun at the slider's time (S3D.sun,
  // live) with the real calculated shadows, or (sun: false) by an even light with no shadows. Drawn over it (a 2D layer),
  // as the satellite Overhead (OverheadMapPanel) draws it: a dot per stand spot (the picked one red) with its code, each
  // shot's framing as a short wedge (picked: filled, 110 px; others dashed, 70 px; direction = the saved framing's
  // heading, else toward the subject; width = the lens's horizontal angle, fov_deg), a dashed line to the picked shot's
  // subject (a dot where it is, or a tag at the screen's edge: "Grand Teton · 14 km"), and with the sun on a band toward
  // the sun plus the Map tab's three arrows landing on the picked view (grey when its subject is in shade: `shaded` from
  // the app, else this page's own check). heading_up_deg: the compass heading at the top; null / 'view' (default) = the
  // picked shot's aim, 0 / 'north' = north up. Zoom stays on the picked stand spot (a little below the middle in my view,
  // the middle north up; see ohHold). Full screen: one finger pans, two pinch (15 m to 20 km across) and turn; the small
  // view (inline) takes no gestures but taps. A tap on a stand dot posts { type: 'overheadTap', id }; the first picture
  // posts { type: 'overhead', ok: true }; a gesture's end (or a new heading / zoom) posts { type: 'overheadView', up, span,
  // mode: 'view' | 'north' | 'turned' }. S3D.overheadSel(id), S3D.overheadUp(deg | 'view' | 'north'), S3D.overheadSun(bool),
  // S3D.overheadShade(bool | null), S3D.overheadZoom(k), S3D.overheadFit(); S3D.overhead({ on: false }) gives the
  // perspective view back as it was.
  // The camera is a narrow (15 deg across) perspective camera high over the middle: a peak 1.5 km above the valley 10 km
  // off-centre leans ~4% of its distance. Fog, sky and sun disc are off; nothing here reaches lit() / the sun times.
  const OH_FOVH = 15 * Math.PI / 180, OH_MIN = 15, OH_MAX = 60000, OH_EVEN = { az: 180, alt: 88, k: 0.5 };   // the sun off: high and soft (k = its strength), so nothing casts a shadow and snow is not burnt out
  const OH = { on: false, marks: true, shots: [], sel: null, upMode: 'view', rot: 0, cx: 0, cz: 0, span: 400, sunOn: true, posted: false, saved: null, cv: null, g2: null,
    ptr: new Map(), tap: null, tw: 0, turning: false, shotKey: '', needFit: false, anchored: true, ak: 0.15, shaded: null, shadeKey: '', shadeVal: false };
  const ohRad = d => d * Math.PI / 180, ohDeg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;
  const ohKx = lat => 111320 * Math.cos(lat * Math.PI / 180);
  const ohBear = (a, b) => ((Math.atan2((b.lng - a.lng) * ohKx(a.lat), (b.lat - a.lat) * 111132) * 180 / Math.PI) % 360 + 360) % 360;
  const ohDist = (a, b) => Math.hypot((b.lng - a.lng) * ohKx(a.lat), (b.lat - a.lat) * 111132);
  const ohXZ = p => { const q = cr(p); return { x: (q.c + 0.5) * FAR.dx, z: (q.r + 0.5) * FAR.dz }; };
  const ohH = p => { const e = pick(p); return gh(e.g, e.c, e.r); };
  const ohSelShot = () => OH.shots.find(s => s.id === OH.sel) || OH.shots[0] || null;
  const ohAim = s => !s ? 0 : s.heading_deg != null && Number.isFinite(+s.heading_deg) ? +s.heading_deg : s.s ? ohBear(s.v, s.s) : 0;
  const ohU = () => ({ x: Math.sin(OH.rot), z: -Math.cos(OH.rot) }), ohRt = () => ({ x: Math.cos(OH.rot), z: Math.sin(OH.rot) });   // the screen's up and right, on the ground
  const ohMode = () => OH.upMode === 'view' ? 'view' : OH.upMode === 'north' ? 'north' : 'turned';
  const ohSay = () => post({ type: 'overheadView', up: Math.round(ohDeg(OH.rot) * 10) / 10, span: Math.round(OH.span), mode: ohMode() });
  function ohClamp() {
    OH.span = Math.max(OH_MIN, Math.min(OH_MAX, OH.span));
    if (FAR) { OH.cx = Math.max(0, Math.min(FAR.w, OH.cx)); OH.cz = Math.max(0, Math.min(FAR.d, OH.cz)); }
  }
  function ohSetUp(v) {
    if (v == null || v === 'view') { OH.upMode = 'view'; OH.rot = ohRad(ohAim(ohSelShot())); }
    else if (v === 'north') { OH.upMode = 'north'; OH.rot = 0; }
    else if (Number.isFinite(+v)) { OH.upMode = +v === 0 ? 'north' : 'set'; OH.rot = ohRad(+v); }
    ohHold();
  }
  // Zoom stays on the picked shot's stand spot (Phil, 16 Nov 2026): while `anchored` the middle of the screen is worked
  // out from that spot at every zoom and turn, so it keeps its place: a little below the middle in "my view" (ak = 15%
  // of the screen's height, room for the wedge ahead), in the middle north up. A one-finger drag lets go of it; picking a
  // shot, the compass, + / - and a new fit take it again. After a two-finger turn it keeps the place it had.
  function ohHold() { OH.anchored = true; if (OH.upMode === 'view') OH.ak = 0.15; else if (OH.upMode !== 'turned') OH.ak = 0; }
  function ohAnchor() {
    const sel = ohSelShot(), at = splitOn() && eye ? eye : sel && sel.v; if (!OH.anchored || !FAR || !at) return;   // (split: held on where the eye view stands)
    const { w, h } = ohVP(), p = ohXZ(at), U = ohU(), k = OH.span * h / w * OH.ak;
    OH.cx = p.x + U.x * k; OH.cz = p.z + U.z * k; ohClamp();
  }
  // the start: wide enough for every stand spot of the place around the picked one (as the satellite Overhead)
  function ohFit() {
    OH.needFit = false; ohHold();
    const sel = ohSelShot(), at = splitOn() && eye ? eye : sel && sel.v; if (!FAR || !at) return;
    const { w, h } = ohVP(); let spread = 30;
    for (const s of OH.shots) spread = Math.max(spread, ohDist(at, s.v));
    OH.span = w * (spread * 2.4 + 100) / Math.max(80, Math.min(w, h) - 70); ohClamp(); ohAnchor();
  }
  function ohCanvas() {
    if (OH.cv) return OH.cv;
    const c = document.createElement('canvas'); c.id = 'oh'; c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    document.body.insertBefore(c, document.getElementById('msg')); OH.cv = c; OH.g2 = c.getContext('2d'); return c;
  }
  function ohApplyR() {
    const cam = R.cam, F = R.ctx.fog;
    if (!OH.saved) OH.saved = { near: cam.near, far: cam.far, fogD: F.fogD.value };
    F.fogD.value = 0; R.sky.visible = false; R.renderer.setClearColor(0x111111, 1);
    const fr = document.getElementById('frame'); if (fr) fr.style.display = 'none'; lensKey = '';
    ohCanvas().style.display = 'block'; if (OTH.cv) OTH.cv.style.display = 'none';
    if (OH.needFit || !OH.shotKey) ohFit();
    relight = dirty = true;
  }
  function ohEnter() { OH.on = true; if (!OHU.value) { OHU.value = 1; ohDefines(true); } OH.posted = false; OH.ptr.clear(); OH.tap = null; if (R) ohApplyR(); }
  function ohLeave() {
    if (!OH.on) return;
    OH.on = false; if (OHU.value) { OHU.value = 0; ohDefines(false); } OH.ptr.clear();
    if (R && OH.saved) { const cam = R.cam; cam.near = OH.saved.near; cam.far = OH.saved.far; R.ctx.fog.fogD.value = OH.saved.fogD; R.sky.visible = true; R.renderer.setClearColor(0x000000, 1); }
    OH.saved = null; lensKey = '';
    if (OH.cv) { OH.cv.style.display = 'none'; OH.g2.clearRect(0, 0, OH.cv.width, OH.cv.height); }
    if (R) { aim(); relight = dirty = true; }
  }
  function placeOH(cam, pxH) {
    ohAnchor();
    const a = cam.aspect || 1, tH = Math.tan(OH_FOVH / 2); pxH = pxH || R.canvas.height;
    let g; try { g = groundAt(OH.cx, OH.cz); } catch (e) { g = NaN; }
    if (!Number.isFinite(g)) g = gh(FAR, OH.cx / FAR.dx - 0.5, OH.cz / FAR.dz - 0.5);
    const hgt = (OH.span / 2) / tH, y = g + hgt;
    cam.fov = 2 * Math.atan(tH / a) * 180 / Math.PI;
    cam.position.set(OH.cx, y, OH.cz); cam.rotation.set(-Math.PI / 2, -OH.rot, 0);
    cam.near = Math.max(0.5, Math.min(hgt * 0.2, y - maxH - 50)); cam.far = y - Math.min(minH, g) + 2000;
    cam.updateProjectionMatrix(); R.sky.position.copy(cam.position);
    if (R.det && R.det.points) R.det.points.material.uniforms.pscale.value = pxH / (2 * Math.tan(cam.fov * Math.PI / 360)) / (R.det.inst ? 1 : Math.sqrt(R.thin));
    if (R.wide) R.wide.mat.uniforms.pscale.value = pxH / (2 * Math.tan(cam.fov * Math.PI / 360));
  }
  // screen point (CSS px) <-> ground (far grid metres), at the middle's ground height
  function ohS2W(sx, sy) { const { w, h } = ohVP(), m = OH.span / w, U = ohU(), Rt = ohRt(), ox = (sx - w / 2) * m, oy = (sy - h / 2) * m; return { x: OH.cx + ox * Rt.x - oy * U.x, z: OH.cz + ox * Rt.z - oy * U.z }; }
  function ohPut(W, sx, sy) { const { w, h } = ohVP(), m = OH.span / w, U = ohU(), Rt = ohRt(), ox = (sx - w / 2) * m, oy = (sy - h / 2) * m; OH.cx = W.x - ox * Rt.x + oy * U.x; OH.cz = W.z - ox * Rt.z + oy * U.z; ohClamp(); }
  function ohDown(e) {
    OH.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { R.canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
    OH.tap = OH.ptr.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
    if (OH.ptr.size === 2) { OH.tw = 0; OH.turning = false; }
  }
  function ohMove(e) {
    const p = OH.ptr.get(e.pointerId); if (!p) return;
    if (OH.tap && Math.hypot(e.clientX - OH.tap.x, e.clientY - OH.tap.y) > 8) OH.tap.moved = true;
    const before = [...OH.ptr.values()].slice(0, 2).map(q => ({ x: q.x, y: q.y }));
    p.x = e.clientX; p.y = e.clientY;
    if (inline) return;   // the small view inside the page: no pan / zoom / turn (the page scrolls), taps only
    const after = [...OH.ptr.values()].slice(0, 2);
    if (after.length === 1) { OH.anchored = false; const W = ohS2W(before[0].x, before[0].y); ohPut(W, after[0].x, after[0].y); }
    else {
      const [a0, b0] = before, [a1, b1] = after, m0x = (a0.x + b0.x) / 2, m0y = (a0.y + b0.y) / 2, d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      const W = ohS2W(m0x, m0y);
      if (d0 > 8 && d1 > 8) OH.span = Math.max(OH_MIN, Math.min(OH_MAX, OH.span * d0 / d1));
      let da = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x); da = Math.atan2(Math.sin(da), Math.cos(da));
      OH.tw += da;
      if (!OH.turning && Math.abs(OH.tw) > ohRad(10)) { OH.turning = true; da = OH.tw; }   // a pinch is not a turn until the fingers have turned 10 degrees
      if (OH.turning) { OH.rot -= da; OH.upMode = 'turned'; }
      if (!OH.anchored) ohPut(W, (a1.x + b1.x) / 2, (a1.y + b1.y) / 2);   // (anchored: the picked spot stays put, the pinch zooms and turns around it)
    }
    touched = true; touch('look');
  }
  function ohUp(e) {
    const had = OH.ptr.has(e.pointerId); OH.ptr.delete(e.pointerId);
    const t = OH.tap; if (had && t && !t.moved && OH.ptr.size === 0 && performance.now() - t.t < 600 && e.type === 'pointerup') {
      let best = null, bd = 26;
      for (const d of OH.dots || []) { const k = Math.hypot(d.x - e.clientX, d.y - e.clientY); if (k < bd) { bd = k; best = d.id; } }
      if (best != null) post({ type: 'overheadTap', id: best });
    }
    if (OH.ptr.size === 0) { OH.tap = null; if (!inline && t && t.moved) ohSay(); if (act && act.kind === 'look') rest(); }
  }
  // the picked shot's subject in a ridge's shadow now (the arrows go grey): what the app said (overhead({ shaded })),
  // else this page's own check of the subject it was given (view()), once per sun position
  function ohShaded() {
    if (typeof OH.shaded === 'boolean') return OH.shaded;
    if (sun.alt <= 0) return true;
    const k = `${sun.az}|${sun.alt}|${target && target.lat}|${target && target.lng}|${foreState}|${rangeState}`;
    if (k !== OH.shadeKey) { OH.shadeKey = k; try { OH.shadeVal = !subjLit(sun.az, sun.alt); } catch (e) { OH.shadeVal = false; } }
    return OH.shadeVal;
  }
  const _ohv = new THREE.Vector3(), _ohc = new THREE.Vector3();
  function ohProj(x, y, z, w, h) { _ohv.set(x, y, z).project(ohCam()); return { x: (_ohv.x + 1) / 2 * w, y: (1 - _ohv.y) / 2 * h }; }
  // a screen vector no longer than k (a ray drawn toward a point km away stays a sane number of pixels)
  // The stop's other stand spots in the normal 3D view (Phil, 17 Nov 2026: "how far, treacherous"): a marker on each,
  // labelled with the distance, how much higher / lower, and the steepest ground on the straight line from where you
  // stand (6 m steps, the finest terrain there). S3D.others([{id, code, name, lat, lng}]), S3D.othersOn(bool); a tap on
  // a marker posts {type: 'otherTap', id}. Drawn on its own canvas over the picture; never in the sun times.
  const OTH = { list: [], on: true, cv: null, g2: null, calc: [], dots: [] };
  function othCanvas() {
    if (OTH.cv) return OTH.cv;
    const c = document.createElement('canvas'); c.id = 'oth'; c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    document.body.insertBefore(c, document.getElementById('msg')); OTH.cv = c; OTH.g2 = c.getContext('2d'); return c;
  }
  function othCalc() {
    OTH.calc = [];
    if (!R || !eye || !OTH.list.length) return;
    let h0; try { h0 = ohH(eye); } catch (e) { return; }
    for (const o of OTH.list) {
      const p = { lat: +o.lat, lng: +o.lng }; if (!inside(p)) continue;
      const d = ohDist(eye, p); if (d < 1) continue;
      let h1; try { h1 = ohH(p); } catch (e) { continue; }
      const n = Math.min(240, Math.max(2, Math.ceil(d / 3))), hs = [];
      for (let i = 0; i <= n; i++) { const t = i / n; try { hs.push(ohH({ lat: eye.lat + (p.lat - eye.lat) * t, lng: eye.lng + (p.lng - eye.lng) * t })); } catch (e) { hs.push(NaN); } }
      const step = d / n, k = Math.max(1, Math.round(6 / step)); let steep = 0;
      for (let i = 0; i + k < hs.length; i++) { const dh = hs[i + k] - hs[i]; if (Number.isFinite(dh)) steep = Math.max(steep, Math.atan(Math.abs(dh) / (k * step)) * 180 / Math.PI); }
      OTH.calc.push({ o, p, d, up: h1 - h0, steep, h1 });
    }
  }
  function othOverlay() {
    if (!OTH.cv && !OTH.list.length) return;
    // pins sent while the ground was not ready to be read (or none could be placed yet): try again every 2 s
    // (17 Nov 2026: offline the stop page's pins never showed although the app had sent them)
    if (OTH.list.length && !OTH.calc.length && R && eye && (performance.now() - (OTH.tried || 0)) > 2000) { OTH.tried = performance.now(); othCalc(); }
    const c = othCanvas(), { w, h } = eyeVP(), dpr = Math.min(2, window.devicePixelRatio || 1);
    { const hp = splitOn() ? h + 'px' : '100%'; if (c.style.height !== hp) c.style.height = hp; }   // (split: the top half only)
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = OTH.g2; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); OTH.dots = [];
    c.style.display = OTH.on && OTH.calc.length ? 'block' : 'none';
    if (!OTH.on || !OTH.calc.length || !R) return;
    const fmt = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
    // A pin in view stands on its spot. One out of view (behind you, to the side, under your feet: 17 Nov 2026, Phil
    // saw none from Find my spot's spots, which look the same way as the others) sits at the edge it lies past, with
    // an arrow pointing to it, so every other stand spot is always on screen.
    const M = 46, BOT = 96;   // edge labels stay above the caption line the app draws over the bottom of the view
    const items = OTH.calc.map(x => {
      const q = ohXZ(x.p); _ohc.set(q.x, x.h1 + 1.7, q.z).applyMatrix4(R.cam.matrixWorldInverse);
      _ohv.set(q.x, x.h1 + 1.7, q.z).project(R.cam);
      const sx = (_ohv.x + 1) / 2 * w, sy = (1 - _ohv.y) / 2 * h;
      const inView = _ohc.z < -0.5 && sx >= 8 && sx <= w - 8 && sy - 60 >= 4 && sy <= h - 8;
      let ex = sx, ey = sy, dir = null;
      if (!inView) {
        if (_ohc.z < -0.5 && sx >= M && sx <= w - M) { ex = sx; if (sy > h - 8) { ey = h - 14; dir = 'down'; } else { ey = 72; dir = 'up'; } }
        else { dir = _ohc.x >= 0 ? 'right' : 'left'; ex = dir === 'right' ? w - 14 : 14; ey = Math.max(80, Math.min(h - BOT, _ohc.z < -0.5 ? sy : h * 0.55)); }
      }
      return { x, sx: ex, sy: ey, dir };
    }).sort((a, b) => b.x.d - a.x.d);   // far ones first (near on top)
    const edgeTaken = [];
    for (const t of items) {
      const { x, dir } = t; let { sx, sy } = t;
      if (dir) {   // keep edge markers from piling on one another
        const clash = () => edgeTaken.some(e => e.dir === dir && Math.abs(e.x - sx) < 70 && Math.abs(e.y - sy) < 38);
        for (let k = 0; k < 8 && clash(); k++) {   // down while there is room above the caption, then up
          if (dir === 'left' || dir === 'right') sy = sy + 40 <= h - BOT ? sy + 40 : sy; else sx = Math.min(w - M, sx + 72);
        }
        for (let k = 0; k < 8 && clash() && (dir === 'left' || dir === 'right'); k++) sy = Math.max(80, sy - 40);
        edgeTaken.push({ dir, x: sx, y: sy });
      }
      const up = Math.round(x.up), lines = [`${x.o.code || x.o.name || 'Spot'} · ${fmt(x.d)}`, `${up === 0 ? 'level' : up > 0 ? `${up} m up` : `${-up} m down`}${x.steep >= 20 ? ` · steep ${Math.round(x.steep)}°` : ''}`];
      let dotX = sx, dotY = sy - 22, align = 'center', tx = sx, ty0 = sy - 32;
      if (!dir) {
        g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 18); g.stroke();
        g.beginPath(); g.arc(sx, sy - 22, 6, 0, 2 * Math.PI); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000000'; g.stroke();
      } else {
        const a = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir];
        dotX = sx; dotY = sy;
        g.save(); g.translate(sx, sy); g.rotate(a);
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.closePath();
        g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000000'; g.stroke(); g.restore();
        if (dir === 'right') { align = 'right'; tx = sx - 14; ty0 = sy - 1; }
        else if (dir === 'left') { align = 'left'; tx = sx + 14; ty0 = sy - 1; }
        else if (dir === 'down') { ty0 = sy - 14; }
        else { ty0 = sy + 30; }
      }
      g.textAlign = align; g.textBaseline = 'bottom'; g.lineJoin = 'round';
      for (let i = 0; i < lines.length; i++) {
        const ly = dir === 'left' || dir === 'right' ? ty0 + i * 15 : ty0 - (lines.length - 1 - i) * 15;
        g.font = `${i ? 600 : 700} ${i ? 11 : 12}px Roboto, system-ui, sans-serif`;
        g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(lines[i], tx, ly);
        g.fillStyle = i && x.steep >= 30 ? '#ffb4a8' : '#ffffff'; g.fillText(lines[i], tx, ly);
      }
      OTH.dots.push({ id: x.o.id, x: dotX, y: dotY });
    }
  }
  const ohCap = (a, b, k) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); return l > k ? { x: a.x + dx / l * k, y: a.y + dy / l * k } : b; };
  const ohShort = n => { let t = String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); if (t.length > 14) t = t.replace(/^(Mount|Mt\.?)\s+/i, ''); if (t.length > 14) t = t.split(/\s+/)[0]; return t; };
  const ohKm = m => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`;
  function ohLabel(g, t, x, y, bold, align) {
    g.font = `${bold ? 700 : 600} 12px Roboto, system-ui, sans-serif`; g.textAlign = align || 'left'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(t, x, y); g.fillStyle = '#ffffff'; g.fillText(t, x, y);
  }
  // Find me (Phil, 23 Nov 2026): the phone's GPS spot as a blue dot over everything, with a soft circle for its accuracy
  // and a fan the way the phone faces (S3D.overheadMe; no signal needed: the GPS, the terrain and the trails are on the phone)
  function ohMe() {
    const me = OH.me, g = OH.g2; if (!me || !g || !FAR || OH.meOut) return;
    const { w, h } = ohVP(), q = ohXZ(me), p = ohProj(q.x, ohH(me), q.z, w, h), mpp = OH.span / w;
    const r = Math.max(10, (+me.acc || 5) / mpp);
    g.beginPath(); g.arc(p.x, p.y, r, 0, 2 * Math.PI); g.fillStyle = 'rgba(66,133,244,0.18)'; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(66,133,244,0.5)'; g.stroke();
    if (me.heading != null && Number.isFinite(+me.heading)) {
      const f = ohProj(q.x + Math.sin(ohRad(+me.heading)) * 1000, ohH(me), q.z - Math.cos(ohRad(+me.heading)) * 1000, w, h);
      const a = Math.atan2(f.x - p.x, -(f.y - p.y)), L = 48, half = 0.5;
      g.beginPath(); g.moveTo(p.x, p.y);
      g.lineTo(p.x + Math.sin(a - half) * L, p.y - Math.cos(a - half) * L);
      g.lineTo(p.x + Math.sin(a + half) * L, p.y - Math.cos(a + half) * L); g.closePath();
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, L); gr.addColorStop(0, 'rgba(66,133,244,0.95)'); gr.addColorStop(1, 'rgba(66,133,244,0)'); g.fillStyle = gr; g.fill();
    }
    g.beginPath(); g.arc(p.x, p.y, 8, 0, 2 * Math.PI); g.fillStyle = '#4285F4'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke();
  }
  function ohOverlay() { ohMarks(); ohMe(); if (splitOn()) ohViewer(); }
  function ohMarks() {
    const c = ohCanvas(), vp = ohVP(), w = vp.w, h = vp.h, dpr = Math.min(2, window.devicePixelRatio || 1);
    { const tp = vp.y + 'px', hp = splitOn() ? h + 'px' : '100%'; if (c.style.top !== tp) c.style.top = tp; if (c.style.height !== hp) c.style.height = hp; }   // (split: the bottom half only)
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr); if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = OH.g2; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const sel = ohSelShot(), K = 3 * Math.hypot(w, h); OH.dots = [];
    if (!sel) return;
    // Phil's AllTrails routes (S3D.overheadRoutes, 23 Nov 2026): every route of the area, each in its own colour on the
    // ground with a dark edge, under the marks; where it starts and ends is a ringed dot with a label (one dot "Start / end"
    // for a loop that comes back within 60 m)
    const ends = [];
    for (const rt of OH.routes || []) {
      if (!rt.g) rt.g = rt.coords.map(c => { const v = { lat: c[1], lng: c[0] }, q = ohXZ(v); return { x: q.x, y: ohH(v), z: q.z }; });
      const sp = rt.g.map(q => ohProj(q.x, q.y, q.z, w, h)), col = rt.color || '#FF5FA2';
      g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash([]);
      for (const [lw, c] of [[7, 'rgba(0,0,0,0.55)'], [3.5, col]]) {
        g.beginPath(); sp.forEach((s, i) => i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y)); g.lineWidth = lw; g.strokeStyle = c; g.stroke();
      }
      const a = rt.coords[0], b = rt.coords[rt.coords.length - 1];
      const loop = ohDist({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }) < 60, nm = String(rt.name || 'Trail');
      ends.push({ p: sp[0], col, start: true, text: (loop ? 'Start / end · ' : 'Start · ') + nm });
      if (!loop) ends.push({ p: sp[sp.length - 1], col, start: false, text: 'End · ' + nm });
    }
    // ends at the same place (two routes from one lot) share a spot: their dots side by side, their labels one under another
    const groups = [];
    for (const e of ends) {
      if (e.p.x < -40 || e.p.y < -40 || e.p.x > w + 40 || e.p.y > h + 40) continue;
      const gr = groups.find(q => Math.hypot(q.p.x - e.p.x, q.p.y - e.p.y) < 22);
      if (gr) gr.items.push(e); else groups.push({ p: e.p, items: [e] });
    }
    for (const gr of groups) {
      const n = gr.items.length;
      gr.items.forEach((e, i) => {
        const x = gr.p.x + (i - (n - 1) / 2) * 12, y = gr.p.y;
        g.beginPath(); g.arc(x, y, 7, 0, 2 * Math.PI); g.fillStyle = e.start ? e.col : '#111111'; g.fill();
        g.lineWidth = 3; g.strokeStyle = e.start ? '#ffffff' : e.col; g.stroke();
      });
      const lx = gr.p.x + (n - 1) * 6 + 12;
      gr.items.forEach((e, i) => {
        const ly = gr.p.y + (i - (n - 1) / 2) * 16;
        g.beginPath(); g.arc(lx + 4, ly, 4, 0, 2 * Math.PI); g.fillStyle = e.col; g.fill();
        ohLabel(g, e.text.length > 34 ? e.text.slice(0, 33) + '…' : e.text, lx + 12, ly, false);
      });
    }
    const P = OH.shots.map(s => { const q = ohXZ(s.v), y = ohH(s.v); return { s, q, y, p: ohProj(q.x, y, q.z, w, h) }; });
    // a compass direction from a ground point, as a unit vector on the screen
    const sdir = (d, az) => { const f = ohProj(d.q.x + Math.sin(az) * 1000, d.y, d.q.z - Math.cos(az) * 1000, w, h), x = f.x - d.p.x, y = f.y - d.p.y, l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
    const wedgeTo = (d, L) => {   // the two edges of a shot's framing, L px long
      const s = d.s, a = ohRad(ohAim(s)), half = ohRad(Math.max(1, Math.min(170, +s.fov_deg || 47.9)) / 2);
      const end = b => { const u = sdir(d, b); return { x: d.p.x + u.x * L, y: d.p.y + u.y * L }; };
      return [end(a - half), end(a + half)];
    };
    const wedge = d => {   // the other shots: 70 px, dashed
      const s = d.s, a = ohRad(ohAim(s)), half = ohRad(Math.max(1, Math.min(170, +s.fov_deg || 47.9)) / 2), L = 70;
      const end = b => { const u = sdir(d, b); return { x: d.p.x + u.x * L, y: d.p.y + u.y * L }; };
      return [end(a - half), end(a + half)];
    };
    g.setLineDash([6, 5]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,0.8)';
    if (OH.marks) for (const d of P) { if (d.s === sel) continue; const [e1, e2] = wedge(d); g.beginPath(); g.moveTo(e1.x, e1.y); g.lineTo(d.p.x, d.p.y); g.lineTo(e2.x, e2.y); g.stroke(); }
    g.setLineDash([]);
    const ds = P.find(d => d.s === sel);
    // the picked shot's subject on the screen (17 Nov 2026, Phil: the line, the cone and the sun arrows reach the subject,
    // as the Map tab drew them); a peak higher than the camera is placed at the stand spot's height (its direction counts)
    let SP = null;
    if (sel.s) { const sq = ohXZ(sel.s), cy = ohCam().position.y, hs0 = ohH(sel.s), hs = cy - hs0 > 0.5 * (cy - ds.y) ? hs0 : ds.y; SP = ohProj(sq.x, hs, sq.z, w, h); }
    const toS = SP ? Math.hypot(SP.x - ds.p.x, SP.y - ds.p.y) : 0;
    const [s1, s2] = wedgeTo(ds, SP ? Math.min(Math.max(toS, 40), K) : 110);
    if (OH.marks) {
      g.beginPath(); g.moveTo(ds.p.x, ds.p.y); g.lineTo(s1.x, s1.y); g.lineTo(s2.x, s2.y); g.closePath(); g.fillStyle = 'rgba(240,176,74,0.22)'; g.fill();
      g.beginPath(); g.moveTo(s1.x, s1.y); g.lineTo(ds.p.x, ds.p.y); g.lineTo(s2.x, s2.y); g.lineWidth = 2; g.strokeStyle = '#F0B04A'; g.stroke();
    }
    if (SP) {   // the line from where you stand to the subject: white with a dark edge, as the Map tab drew it
      const se = ohCap(ds.p, SP, K);
      g.lineCap = 'round';
      for (const [lw, col] of [[4.5, 'rgba(0,0,0,0.55)'], [2.5, '#ffffff']]) { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.moveTo(ds.p.x, ds.p.y); g.lineTo(se.x, se.y); g.stroke(); }
      g.lineCap = 'butt';
    }
    if (OH.marks && OH.sunOn && sun.alt > -0.83) {   // the sun: a band from where you stand toward it, and the Map tab's three arrows landing on your view
      const u = sdir(ds, ohRad(sun.az)), sp0 = { x: -u.y, y: u.x }, au = sdir(ds, ohRad(ohAim(sel)));
      let T = { x: ds.p.x + au.x * 70, y: ds.p.y + au.y * 70 };
      if (SP) {   // on the subject; when it is off the screen, on the line where it leaves the screen
        const mg = 40, inS = SP.x >= mg && SP.x <= w - mg && SP.y >= mg && SP.y <= h - mg;
        if (inS) T = { x: SP.x, y: SP.y };
        else { const dx = SP.x - ds.p.x, dy = SP.y - ds.p.y; let t = 1;
          if (dx > 0) t = Math.min(t, (w - mg - ds.p.x) / dx); if (dx < 0) t = Math.min(t, (mg - ds.p.x) / dx);
          if (dy > 0) t = Math.min(t, (h - mg - ds.p.y) / dy); if (dy < 0) t = Math.min(t, (mg - ds.p.y) / dy);
          if (t > 0) T = { x: ds.p.x + dx * t, y: ds.p.y + dy * t }; }
      }
      g.lineCap = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(240,176,74,0.35)'; g.beginPath(); g.moveTo(ds.p.x, ds.p.y); g.lineTo(ds.p.x + u.x * 260, ds.p.y + u.y * 260); g.stroke();
      g.lineJoin = 'round'; const shd = ohShaded();
      for (const [lw, col] of [[5, 'rgba(0,0,0,0.45)'], [3, shd ? '#9a9a9a' : '#F0B04A']]) {   // a dark edge under each, so grey arrows show on snow in shade too
        g.lineWidth = lw; g.strokeStyle = col;
        for (const o of [-1, 0, 1]) {
          const bx = T.x + sp0.x * o * 16, by = T.y + sp0.y * o * 16, tx = bx + u.x * 14, ty = by + u.y * 14, kx = tx + u.x * 9, ky = ty + u.y * 9;
          g.beginPath(); g.moveTo(bx + u.x * 70, by + u.y * 70); g.lineTo(tx, ty); g.stroke();
          g.beginPath(); g.moveTo(kx + sp0.x * 5, ky + sp0.y * 5); g.lineTo(tx, ty); g.lineTo(kx - sp0.x * 5, ky - sp0.y * 5); g.stroke();
        }
      }
      g.lineCap = 'butt';
    }
    if (sel.s) {   // the subject: a mark where it is, or a tag at the screen's edge on the line toward it
      // (a peak higher than the camera is placed at the stand spot's height: its direction is what counts)
      const sq = ohXZ(sel.s), cy = ohCam().position.y, hs0 = ohH(sel.s), hs = cy - hs0 > 0.5 * (cy - ds.y) ? hs0 : ds.y, sp = ohProj(sq.x, hs, sq.z, w, h), nm = ohShort(sel.subject || sel.name), km = ohKm(ohDist(sel.v, sel.s)), m = 8;
      const se = ohCap(ds.p, sp, K);
      if (sp.x >= m && sp.x <= w - m && sp.y >= m && sp.y <= h - m) {
        g.beginPath(); g.arc(sp.x, sp.y, 7, 0, 2 * Math.PI); g.fillStyle = '#000000'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.stroke();
        if (nm) ohLabel(g, nm, sp.x + 9, sp.y, false);
      } else {
        const x0 = 26, x1 = w - 26, y0 = 26, y1 = h - 26, S = ds.p;
        if (S.x > x0 && S.x < x1 && S.y > y0 && S.y < y1) {
          const dx = sp.x - S.x, dy = sp.y - S.y; let t = Infinity;
          if (dx > 0) t = Math.min(t, (x1 - S.x) / dx); if (dx < 0) t = Math.min(t, (x0 - S.x) / dx);
          if (dy > 0) t = Math.min(t, (y1 - S.y) / dy); if (dy < 0) t = Math.min(t, (y0 - S.y) / dy);
          const tx = S.x + dx * t, ty = S.y + dy * t, ang = Math.atan2(dy, dx), txt = nm ? `${nm} · ${km}` : km;
          g.font = '600 12px Roboto, system-ui, sans-serif'; const tw = g.measureText(txt).width + 30, th = 22;
          const bx = Math.max(6, Math.min(w - 6 - tw, tx - tw / 2)), by = Math.max(6, Math.min(h - 6 - th, ty - th / 2));
          g.fillStyle = 'rgba(0,0,0,0.72)'; g.beginPath(); if (g.roundRect) g.roundRect(bx, by, tw, th, 11); else g.rect(bx, by, tw, th); g.fill();
          g.save(); g.translate(bx + 13, by + th / 2); g.rotate(ang); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.restore();
          g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(txt, bx + 24, by + th / 2 + 0.5);
        }
      }
    }
    for (const d of [...P.filter(d => d.s !== sel), ds]) {   // the stand spots, the selected one last (on top)
      const on = d.s === sel, r = on ? 8 : 6;
      g.beginPath(); g.arc(d.p.x, d.p.y, r, 0, 2 * Math.PI); g.fillStyle = on ? '#E5484D' : '#000000'; g.fill(); g.lineWidth = on ? 2.5 : 2; g.strokeStyle = '#ffffff'; g.stroke();
      OH.dots.push({ id: d.s.id, x: d.p.x, y: d.p.y });
    }
    const boxes = [];   // their codes, the selected one first; a code that would sit on another is left out (zoomed far out)
    for (const d of [ds, ...P.filter(d => d.s !== sel)]) {
      const on = d.s === sel, r = on ? 8 : 6, t = `${d.s.star ? '★ ' : ''}${d.s.code || d.s.name || ''}`.trim();
      if (!t) continue;
      g.font = `${on ? 700 : 600} 12px Roboto, system-ui, sans-serif`;
      const tw = g.measureText(t).width, hit = bx => boxes.some(b => bx.x0 < b.x1 && bx.x1 > b.x0 && bx.y0 < b.y1 && bx.y1 > b.y0);
      const right = { x0: d.p.x - r, x1: d.p.x + r + 5 + tw, y0: d.p.y - 8, y1: d.p.y + 8 }, left = { x0: d.p.x - r - 5 - tw, x1: d.p.x + r, y0: d.p.y - 8, y1: d.p.y + 8 };
      if (on || !hit(right)) { boxes.push(right); ohLabel(g, t, d.p.x + r + 5, d.p.y, on); }
      else if (!hit(left)) { boxes.push(left); ohLabel(g, t, d.p.x - r - 5, d.p.y, on, 'right'); }   // (else left out: zoomed far out)
    }
    {   // scale bar, bottom right
      const mpp = OH.span / w, steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]; let L = steps[0];
      for (const s of steps) if (s / mpp <= 90) L = s;
      const px = L / mpp, x1 = w - 12, y = h - 12;
      g.strokeStyle = '#dddddd'; g.lineWidth = 2; g.beginPath(); g.moveTo(x1 - px, y - 6); g.lineTo(x1 - px, y); g.lineTo(x1, y); g.lineTo(x1, y - 6); g.stroke();
      g.font = '600 10px Roboto, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillStyle = '#dddddd'; g.fillText(L >= 1000 ? `${L / 1000} km` : `${L} m`, x1, y - 8);
    }
    if (!OH.posted) { OH.posted = true; post({ type: 'overhead', ok: true, span: Math.round(OH.span), up: Math.round(ohDeg(OH.rot) * 10) / 10, mode: ohMode() }); }
  }
  // ---- Split (Phil, 24 Nov 2026: the eye view over the view from above, as Google's Street View split) ----
  // S3D.split({ on, frac?, shots?, sel?, heading_up_deg?, cache? }): the full-screen view is cut in two at frac of its
  // height (the top's share, 0.2-0.8, default 0.5): on top the eye view exactly as before (its camera, the frame box, the
  // other stand spots), under it the view from above (S3D.overhead's drawing: the same shots, routes, Find me, + / -),
  // both in this one canvas (two web views would load the terrain twice). shots / sel / heading_up_deg as for overhead().
  // The view from above always uses the sun at the slider's time (overheadSun does not apply). Over it the page draws
  // where the eye view stands now (a blue dot) and the way it looks (a cone as wide as the lens's horizontal angle, with
  // a round handle at its end). One finger on the view from above: a tap jumps the eye view there (on a stand dot: onto
  // that shot's stand spot exactly; the look direction is kept, Back undoes it: 'eye' as for tap to go); a drag that
  // starts on the dot or the handle turns the eye view (`look`); any other drag pans, two fingers pinch and turn as
  // full-screen overhead does. Turning the eye view turns the cone at once. S3D.split({ on: false }) gives the whole
  // view back to the eye. While S3D.overhead is on, split does nothing. Nothing here reaches lit() / the sun times.
  // cache (default on): the view from above is kept in a picture of its own and drawn again only when something in it
  // changed (its camera, the light, the level, the foreground), so a drag of the eye view pays for the top half only.
  // S3D.goTo(lat, lng): the same jump from outside (the app's own satellite map under a smaller web view);
  // S3D.yaw(deg): turn the eye view to a compass heading; S3D.liveLook(bool): post `look` while the eye view is dragged
  // (at most every 80 ms), so a map outside the page can turn its cone with it.
  function splitOn() { return SPL.on && !OH.on && !!R; }
  function splitTop() { const h = window.innerHeight || 1; return Math.max(1, Math.min(h - 1, Math.round(h * SPL.frac))); }
  // the eye view's and the view from above's rectangles, CSS px from the page's top-left (each the whole page unless split)
  function eyeVP() { const w = window.innerWidth || 1, h = window.innerHeight || 1; return SPL.on && !OH.on ? { y: 0, w, h: splitTop() } : { y: 0, w, h }; }
  function ohVP() { const w = window.innerWidth || 1, h = window.innerHeight || 1; if (!(SPL.on && !OH.on)) return { y: 0, w, h }; const t = splitTop(); return { y: t, w, h: h - t }; }
  function ohCam() { return splitOn() && R.ohCam ? R.ohCam : R.cam; }
  // ground (far grid metres) -> a point on the view from above, at the middle's ground height (ohS2W the other way)
  function ohW2S(P) { const { w, h } = ohVP(), m = OH.span / w, U = ohU(), Rt = ohRt(), dx = P.x - OH.cx, dz = P.z - OH.cz; return { x: w / 2 + (dx * Rt.x + dz * Rt.z) / m, y: h / 2 - (dx * U.x + dz * U.z) / m }; }
  const xzLL = (x, z) => ({ lat: FAR.north - z / FAR.d * (FAR.north - FAR.south), lng: FAR.west + x / FAR.w * (FAR.east - FAR.west) });
  // the scene's settings for one half: the view from above has no fog, sky or sun disc, the tree shaders' from-above
  // drawing (OH define) and the overhead's dark clear colour; the eye view gets everything back as it was
  function viewLook(oh) {
    const F = R.ctx.fog;
    if (oh) {
      if (!OHU.value) { OHU.value = 1; ohDefines(true); }
      if (SPL.fogD == null) { SPL.fogD = F.fogD.value; F.fogD.value = 0; }
      if (SPL.disc == null) { SPL.disc = R.disc.visible; R.disc.visible = R.halo.visible = false; }
      R.sky.visible = false; R.renderer.setClearColor(0x111111, 1);
    } else {
      if (OHU.value) { OHU.value = 0; ohDefines(false); }
      if (SPL.fogD != null) { F.fogD.value = SPL.fogD; SPL.fogD = null; }
      if (SPL.disc != null) { R.disc.visible = R.halo.visible = SPL.disc; SPL.disc = null; }
      R.sky.visible = true; R.renderer.setClearColor(0x000000, 1);
    }
  }
  // what the view from above shows, apart from its marks: while this is unchanged its last picture is drawn again
  const _mk = [];
  function ohKey(cw, oPx, q, oc) {
    _mk.length = 0;
    _mk.push(cw, oPx, QL.indexOf(q), SPL.lightN, treesOn ? 1 : 0, ice ? 1 : 0, foreState, rangeState, houseState, wideState, R.scene.children.length, R.lost ? 1 : 0);
    for (const o of [R.near, R.det, R.range]) if (o) { const f = o.mat.uniforms.focus.value; _mk.push(f.x, f.y); }
    if (R.wide && R.wide.at) _mk.push(R.wide.at.lat, R.wide.at.lng);
    const me = oc.matrixWorld.elements, pe = oc.projectionMatrix.elements; for (let i = 0; i < 16; i++) _mk.push(me[i], pe[i]);
    return _mk.join(',');
  }
  function splitBlit() {
    if (SPL.blit) return SPL.blit;
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
    return (SPL.blit = { scene, cam, mat });
  }
  function splitFree() { if (SPL.rt) { try { SPL.rt.dispose(); } catch (e) { /* gone with the context */ } } SPL.rt = null; SPL.key = ''; }
  // the two halves into the one canvas (cw x ch device pixels; w x h CSS px): the eye view on top, the view from above
  // under it, then both 2D layers. Returns the tree points the eye view drew.
  function drawSplit(q, cw, ch, w, h) {
    const t = splitTop(), ePx = Math.max(1, Math.min(ch - 1, Math.round(ch * t / h))), oPx = ch - ePx, r = R.renderer, cam = R.cam;
    if (!R.ohCam) { R.ohCam = new THREE.PerspectiveCamera(15, 1, 1, 100000); R.ohCam.rotation.order = cam.rotation.order; }
    const oc = R.ohCam;
    r.setScissorTest(true);
    // the eye view (GL's y counts from the bottom)
    viewLook(false); cam.aspect = w / t;
    r.setViewport(0, oPx, cw, ePx); r.setScissor(0, oPx, cw, ePx);
    place(ePx); const wpts = pass(cam, q);
    // the view from above follows the eye when it has gone near the edge of its picture (a tap there keeps the map still)
    if (SPL.follow !== eye && eye && FAR) {
      SPL.follow = eye;
      if (!OH.anchored) { const vp = ohVP(), s = ohW2S(ohXZ(eye)); if (s.x < vp.w * 0.12 || s.x > vp.w * 0.88 || s.y < vp.h * 0.12 || s.y > vp.h * 0.88) ohHold(); }
    }
    oc.aspect = w / (h - t);
    r.setViewport(0, 0, cw, oPx); r.setScissor(0, 0, cw, oPx);
    placeOH(oc, oPx); oc.updateMatrixWorld();
    if (!SPL.cache) { viewLook(true); pass(oc, q); SPL.key = ''; }
    else {
      const key = ohKey(cw, oPx, q, oc);
      if (key !== SPL.key || !SPL.rt) {
        if (!SPL.rt || SPL.rt.width !== cw || SPL.rt.height !== oPx) {
          splitFree();
          const MS = THREE.WebGLMultisampleRenderTarget;   // the canvas is drawn with antialiasing: so is this picture
          SPL.rt = MS ? new MS(cw, oPx, { depthBuffer: true, stencilBuffer: false }) : new THREE.WebGLRenderTarget(cw, oPx, { depthBuffer: true, stencilBuffer: false });
          if (MS) SPL.rt.samples = 4;
          SPL.rt.texture.minFilter = SPL.rt.texture.magFilter = THREE.NearestFilter; SPL.rt.texture.generateMipmaps = false;
        }
        viewLook(true); r.setRenderTarget(SPL.rt); pass(oc, q); r.setRenderTarget(null);
        r.setViewport(0, 0, cw, oPx); r.setScissor(0, 0, cw, oPx);
        SPL.key = key;
      }
      const B = splitBlit(); B.mat.map = SPL.rt.texture; r.render(B.scene, B.cam);
    }
    viewLook(false);
    r.setScissorTest(false); r.setViewport(0, 0, cw, ch); r.setScissor(0, 0, cw, ch);
    othOverlay(); ohOverlay();
    return wpts;
  }
  // where the eye view stands and looks, on the view from above: the cone (the lens's horizontal angle), the handle that
  // turns it, the dot
  function ohViewer() {
    const g = OH.g2; SPL.dot = SPL.handle = null; if (!g || !eye || !FAR) return;
    const { w, h } = ohVP(), q = ohXZ(eye), y = ohH(eye), p = ohProj(q.x, y, q.z, w, h);
    const f = ohProj(q.x + Math.sin(yaw) * 1000, y, q.z - Math.cos(yaw) * 1000, w, h), a = Math.atan2(f.x - p.x, -(f.y - p.y));
    const half = Math.atan(lens.fw / (2 * lens.f)), L = Math.max(60, Math.min(110, Math.min(w, h) * 0.28));
    const at = b => ({ x: p.x + Math.sin(b) * L, y: p.y - Math.cos(b) * L });
    const e1 = at(a - half), e2 = at(a + half);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(e1.x, e1.y); g.arc(p.x, p.y, L, a - half - Math.PI / 2, a + half - Math.PI / 2); g.closePath();
    const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, L); gr.addColorStop(0, 'rgba(66,133,244,0.55)'); gr.addColorStop(1, 'rgba(66,133,244,0.08)'); g.fillStyle = gr; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(66,133,244,0.9)'; g.beginPath(); g.moveTo(e1.x, e1.y); g.lineTo(p.x, p.y); g.lineTo(e2.x, e2.y); g.stroke();
    const H = { x: p.x + Math.sin(a) * (L + 14), y: p.y - Math.cos(a) * (L + 14) };   // the handle: a white disc with an arrow the way the view looks
    g.beginPath(); g.moveTo(p.x + Math.sin(a) * L * 0.6, p.y - Math.cos(a) * L * 0.6); g.lineTo(H.x, H.y); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
    g.beginPath(); g.arc(H.x, H.y, 13, 0, 2 * Math.PI); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#4285F4'; g.stroke();
    g.save(); g.translate(H.x, H.y); g.rotate(a); g.beginPath(); g.moveTo(0, -7); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fillStyle = '#4285F4'; g.fill(); g.restore();
    g.beginPath(); g.arc(p.x, p.y, 9, 0, 2 * Math.PI); g.fillStyle = '#4285F4'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke();
    SPL.dot = { x: p.x, y: p.y }; SPL.handle = H;
  }
  // a pointer on the view from above, in its own coordinates
  const splitLocal = e => ({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY - splitTop(), type: e.type, timeStamp: e.timeStamp });
  const ohPx = m => m * ohVP().w / OH.span;   // metres on the ground -> px on the view from above
  function splitDown(e) {
    const l = splitLocal(e), near = (a, k) => a && Math.hypot(a.x - l.clientX, a.y - l.clientY) < k;
    if (OH.ptr.size === 0 && !SPL.turn && (near(SPL.handle, 30) || near(SPL.dot, 22))) {   // on the dot or the handle: this finger turns the eye view
      SPL.turn = { id: e.pointerId }; touched = true; try { R.canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } return;
    }
    ohDown(l);
  }
  function splitMove(e) {
    const l = splitLocal(e);
    if (SPL.turn && SPL.turn.id === e.pointerId) {
      const W = ohS2W(l.clientX, l.clientY), E = ohXZ(eye), dx = W.x - E.x, dz = W.z - E.z;
      if (ohPx(Math.hypot(dx, dz)) < 6) return;   // too close to the dot to tell a direction
      yaw = Math.atan2(dx, -dz); touch('look'); liveLook(true); return;
    }
    ohMove(l);
  }
  function splitUp(e) {
    if (SPL.turn && SPL.turn.id === e.pointerId) { SPL.turn = null; heading(); if (act && act.kind === 'look') rest(); return; }
    const l = splitLocal(e), had = OH.ptr.has(e.pointerId); OH.ptr.delete(e.pointerId);
    const t = OH.tap;
    if (had && t && !t.moved && OH.ptr.size === 0 && performance.now() - t.t < 600 && e.type === 'pointerup') {
      let best = null, bd = 26;
      for (const d of OH.dots || []) { const k = Math.hypot(d.x - l.clientX, d.y - l.clientY); if (k < bd) { bd = k; best = d.id; } }
      const s = best != null ? OH.shots.find(x => x.id === best) : null;
      const W = ohS2W(l.clientX, l.clientY), p = s ? { lat: +s.v.lat, lng: +s.v.lng } : xzLL(W.x, W.z);
      OH.anchored = false;   // the map stays still under the finger; the dot goes where it was tapped
      if (goTo(p)) SPL.follow = eye;
    }
    if (OH.ptr.size === 0) { OH.tap = null; if (t && t.moved) ohSay(); if (act && act.kind === 'look') rest(); }
  }
  // jump the eye view to a spot, the look direction kept; Back (S3D.back) undoes it
  function goTo(p) {
    if (!R || !eye || !FAR || !p || !Number.isFinite(+p.lat) || !Number.isFinite(+p.lng)) return false;
    const q = { lat: +p.lat, lng: +p.lng };
    if (!inside(q)) { post({ type: 'walk', stopped: 'edge' }); return false; }
    TAPGO.hist.push(eye); if (TAPGO.hist.length > 50) TAPGO.hist.shift();
    eye = q; touch('walk'); told(); return true;
  }
  function liveLook(force) { const t = performance.now(); if ((SPL.live || force) && t - SPL.lastLook >= 80) { SPL.lastLook = t; heading(); } }
  function splitApply() {
    if (!R) return;
    ohCanvas().style.display = 'block';
    if (OH.needFit || !OH.shotKey) ohFit();
    SPL.follow = eye; lensKey = ''; resize(); relight = dirty = true;
  }
  function splitLeave() {
    if (!SPL.on) return;
    SPL.on = false; SPL.ptr.clear(); SPL.turn = null; SPL.dot = SPL.handle = null; OH.ptr.clear(); OH.tap = null;
    if (OH.cv && !OH.on) { OH.cv.style.display = 'none'; OH.g2.clearRect(0, 0, OH.cv.width, OH.cv.height); OH.cv.style.top = '0px'; OH.cv.style.height = '100%'; }
    if (OTH.cv) OTH.cv.style.height = '100%';
    if (R) { viewLook(false); splitFree(); lensKey = ''; resize(); relight = dirty = true; }
  }
  function tick() {
    if (resting) rest();
    if (R) { const t = performance.now(), free = gpuFree(t); if (dirty && free) draw(t); }
    requestAnimationFrame(tick);
  }
  function inside(p) { return p && p.lat <= cfg.north && p.lat >= cfg.south && p.lng >= cfg.west && p.lng <= cfg.east; }
  function heading() {
    const y = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
    post({ type: 'look', deg: Math.round(y), yaw: Math.round(y * 100) / 100 % 360, pitch: Math.round(pitch * 18000 / Math.PI) / 100 });
  }

  const WALK_MAX = Infinity;   // no limit (Phil, 18 Nov 2026: 'as far as I want'); only the edge of the saved terrain stops a walk
  function told() {
    othCalc();
    const kz = 111132, kx = 111320 * Math.cos(eye.lat * Math.PI / 180);
    let fine = false; try { fine = pick(eye).g === DT; } catch (e) { /* not built */ }
    post({ type: 'eye', lat: eye.lat, lng: eye.lng, moved: Math.round(Math.hypot((eye.lat - eye0.lat) * kz, (eye.lng - eye0.lng) * kx) * 10) / 10, height: EYE, fine, back: TAPGO.hist.length });   // 0.1 m: fine steps are 25 cm
    post({ type: 'state', subjectLit: subjLit(sun.az, sun.alt), hereLit: lit(herePoint(), sun.az, sun.alt), up: sun.alt > 0 });
  }
  let drag = null;
  // Tap to go: the ray from the eye through the tapped point, marched over the ground grids; the first point under the
  // ground is where the viewpoint jumps (at most WALK_MAX m from the shot's stand spot; the look direction is kept).
  const TAPGO = { on: false, ids: new Set(), hist: [] };   // ids: fingers down now (by pointer id: a lost 'up' cannot stick)   // hist: where each jump came from (Back undoes the last)
  function tapGo(px, py) {
    if (!R || !eye || !eye0 || !FAR) return;
    const { w, h } = eyeVP();
    const v = new THREE.Vector3((px / w) * 2 - 1, -(py / h) * 2 + 1, 0.5).unproject(R.cam);
    const o = R.cam.position, d = v.sub(o).normalize();
    if (d.y > 0.02) { post({ type: 'walk', stopped: 'sky' }); return; }
    const ll = (x, z) => ({ lat: FAR.north - z / FAR.d * (FAR.north - FAR.south), lng: FAR.west + x / FAR.w * (FAR.east - FAR.west) });
    let hit = null;
    for (let t = 2; t < 60000; t += Math.max(0.5, t * 0.01)) {   // out to 60 km: a tap on far hills goes there too (no walk limit)
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, p = ll(x, z);
      if (!inside(p)) break;
      let g; try { g = ohH(p); } catch (err) { break; }
      if (y <= g) { hit = p; break; }
    }
    if (!hit) { post({ type: 'walk', stopped: 'sky' }); return; }
    const kz = 111132, kx = 111320 * Math.cos(eye0.lat * Math.PI / 180);
    const off = Math.hypot((hit.lat - eye0.lat) * kz, (hit.lng - eye0.lng) * kx);
    if (off > WALK_MAX) {   // past the limit: as far as allowed along the way there
      const k = WALK_MAX / off; hit = { lat: eye0.lat + (hit.lat - eye0.lat) * k, lng: eye0.lng + (hit.lng - eye0.lng) * k };
      post({ type: 'walk', stopped: 'far', max: WALK_MAX });
    }
    TAPGO.hist.push(eye); if (TAPGO.hist.length > 50) TAPGO.hist.shift();
    eye = hit; touch('walk'); told();
  }
  function wire() {
    const c = R.canvas;
    c.addEventListener('pointerdown', e => { if (OH.on) return ohDown(e); if (splitOn()) { const oh = e.clientY >= splitTop(); SPL.ptr.set(e.pointerId, oh ? 'oh' : 'eye'); if (oh) return splitDown(e); } if (e.isPrimary !== false) TAPGO.ids.clear(); TAPGO.ids.add(e.pointerId); drag = { x: e.clientX, y: e.clientY }; OTH.tap = TAPGO.ids.size > 1 ? null : { x: e.clientX, y: e.clientY, t: e.timeStamp, far: 0 }; try { c.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); if (R) R.lost = true; post({ type: 'lost', fore: foreState > 0 }); });
    c.addEventListener('pointermove', e => { if (OH.on) return ohMove(e); if (SPL.ptr.get(e.pointerId) === 'oh') return splitMove(e); if (OTH.tap) OTH.tap.far = Math.max(OTH.tap.far, Math.hypot(e.clientX - OTH.tap.x, e.clientY - OTH.tap.y)); if (!drag) return; touched = true; const per = (R.cam.fov * Math.PI / 180) / eyeVP().h; yaw -= (e.clientX - drag.x) * per; if (!inline) pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * per)); drag = { x: e.clientX, y: e.clientY }; touch('look'); if (SPL.live) liveLook(); });
    const drop = e => {
      if (OH.on) return ohUp(e);
      { const reg = e && SPL.ptr.get(e.pointerId); if (reg) SPL.ptr.delete(e.pointerId); if (reg === 'oh') return splitUp(e); }
      const tp = OTH.tap; OTH.tap = null; TAPGO.ids.delete(e && e.pointerId);
      if (tp && e && e.type === 'pointerup' && Math.hypot(e.clientX - tp.x, e.clientY - tp.y) < 10 && e.timeStamp - tp.t < 600 && OTH.on) {   // a tap on another stand spot's marker
        let best = null, bd = 26; for (const d of OTH.dots) { const dd = Math.hypot(d.x - e.clientX, d.y - e.clientY); if (dd < bd) { bd = dd; best = d; } }
        if (best) post({ type: 'otherTap', id: best.id });
      }
      // walk mode's tap to go (Phil, 18 Nov 2026): a tap on the ground (not on a stand-spot marker) jumps there
      // a real tap only: no sliding during the touch, quick, one finger (18 Nov 2026: looking around sometimes jumped)
      if (tp && e && e.type === 'pointerup' && TAPGO.on && tp.far < 6 && Math.hypot(e.clientX - tp.x, e.clientY - tp.y) < 6 && e.timeStamp - tp.t < 350
          && !(OTH.on && OTH.dots.some(d => Math.hypot(d.x - e.clientX, d.y - e.clientY) < 26))) tapGo(e.clientX, e.clientY);
      if (drag) { drag = null; heading(); if (act && act.kind === 'look') rest(); } };   // finger up: the sharp frame now
    c.addEventListener('pointerup', drop); c.addEventListener('pointercancel', drop);
    window.addEventListener('resize', resize);
  }

  window.S3D = {
    init(c) { rparts = []; rangeState = 0; hsparts = {}; houseState = 0; cnparts = {}; cnbytes = {}; cnlast = -1; wideTiles = null; wideState = 0; wideRun++; cfg = c; bldNear = []; parts = []; nparts = []; dparts = []; mparts = []; tparts = []; wparts = []; cparts = []; ncparts = []; bparts = []; wcparts = []; foreState = 0; lastPath = null; touched = false; treesOn = c.trees !== false; ice = c.ice != null ? !!c.ice : c.ground !== 'green'; eye0 = c.eye; eye = c.start && Number.isFinite(+c.start.lat) && Number.isFinite(+c.start.lng) ? { lat: +c.start.lat, lng: +c.start.lng } : c.eye; target = c.target;   /* start: a walked-to spot kept through a restart (17 Nov 2026) */ framed = toFraming(c.view); act = null; if (c.level) for (const k of ['look', 'sun']) if (c.level[k] >= 0) lv[k] = Math.min(QL.length - 1, Math.floor(c.level[k])); focal = c.focal || 50; if (c.lens) lens = Object.assign({}, lens, c.lens); inline = !!c.inline; { const cv = document.getElementById('view'); if (cv) cv.style.touchAction = inline ? 'pan-y' : 'none'; } },
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
        if (OH.on) ohApplyR(); else if (SPL.on) splitApply();
        const fore = !!((cfg.detail && dparts.length) || ncparts.length || wcparts.length || (cfg.canopy && cnAny()) || (cfg.range && rparts.length) || (cfg.houses && hsAny()));
        post({ type: 'ready', n: FAR.n, gl: 'webgl2', near: NR ? NR.n : 0, detail: 0, fore }); heading();
        othCalc();
        if (eye !== eye0) told();   // a restart that kept a walked-to spot: the app hears where it stands again
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
    // trees(false): every tree hidden (and the close-up trees' soft shadow on the ground); the sun times never used them
    trees(v) { treesOn = v !== false; if (R) { R.tshU.value = treesOn ? 1 : 0; relight = dirty = true; } },
    focal(f) { lens = Object.assign({}, lens, { f }); dirty = true; },
    // lens({ f, fw, fh, box }): focal length, film width / height in mm as the camera is turned, frame box on / off
    lens(o) { lens = Object.assign({}, lens, o || {}); dirty = true; },
    // inline(true): the small view inside a scrolling page. A sideways drag looks around; up-down drags are left to the
    // page (touch-action pan-y), so the two no longer fight. Full screen: free look both ways.
    inline(v) { inline = !!v; const c = document.getElementById('view'); if (c) c.style.touchAction = inline ? 'pan-y' : 'none'; },
    view(eLat, eLng, tLat, tLng, fr) {
      if (eLat === null || typeof eLat === 'object') {   // view({ yaw_deg, pitch_deg }) / view(null): only the framing changes
        framed = toFraming(eLat); touched = false; if (R) { aim(); dirty = true; heading(); } return;
      }
      if (fr !== undefined) framed = toFraming(fr);
      eye = { lat: eLat, lng: eLng }; eye0 = eye; target = { lat: tLat, lng: tLng }; if (!R) return; if (!inside(eye)) return fail('This spot is outside the 3D terrain for the area.'); say(''); aim(); relight = dirty = true; heading();
      if (R.wide && wideState === 2 && Math.hypot((eye.lat - R.wide.at.lat) * 111132, (eye.lng - R.wide.at.lng) * 111320 * Math.cos(eye.lat * Math.PI / 180)) > 300) { wideState = 0; queueWide(); }   // the park-wide trees again, around the new spot
    },
    recenter() { if (R) { aim(); dirty = true; heading(); } },
    // ---- split: the eye view over the view from above (see "Split" before tick()) ----
    split(o) {
      if (!o || o.on === false) { splitLeave(); return; }
      if (o.frac != null && Number.isFinite(+o.frac)) SPL.frac = Math.max(0.2, Math.min(0.8, +o.frac));
      if (o.cache != null) { SPL.cache = !!o.cache; splitFree(); }
      if (Array.isArray(o.shots)) {
        const shots = o.shots.filter(s => s && s.id != null && s.v && Number.isFinite(+s.v.lat) && Number.isFinite(+s.v.lng));
        const key = shots.map(s => `${s.id}:${(+s.v.lat).toFixed(6)},${(+s.v.lng).toFixed(6)}`).join('|');
        OH.shots = shots; const flagged = shots.find(s => s.sel);
        if (o.sel != null) OH.sel = o.sel; else if (flagged) OH.sel = flagged.id; else if (!shots.some(s => s.id === OH.sel)) OH.sel = shots.length ? shots[0].id : null;
        if (key !== OH.shotKey) { OH.shotKey = key; OH.needFit = true; }
      } else if (o.sel != null) OH.sel = o.sel;
      if (o.marks != null) OH.marks = !!o.marks;
      const up = o.heading_up_deg !== undefined ? o.heading_up_deg : o.up, first = !SPL.on;
      SPL.on = true;
      if (up !== undefined) ohSetUp(up); else if (first) ohSetUp(OH.upMode === 'north' ? 'north' : 'view'); else if (OH.upMode === 'view') OH.rot = ohRad(ohAim(ohSelShot()));
      if (first) { OH.needFit = true; OH.ptr.clear(); OH.tap = null; }
      if (R) { if (first) splitApply(); else { if (OH.needFit) ohFit(); lensKey = ''; resize(); dirty = true; } }
    },
    goTo(lat, lng) { if (lat && typeof lat === 'object') { lng = lat.lng; lat = lat.lat; } goTo({ lat, lng }); },
    yaw(deg) { if (!R || !Number.isFinite(+deg)) return; yaw = +deg * Math.PI / 180; touched = true; touch('look'); heading(); },
    liveLook(on) { SPL.live = !!on; },
    // for tests: where the split's dot and handle are (CSS px in the view from above), the top's height, the heading
    _split() { return { on: splitOn(), top: splitTop(), dot: SPL.dot, handle: SPL.handle, yaw: Math.round(((yaw * 180 / Math.PI) % 360 + 360) % 360 * 100) / 100, eye, renders: SPL.renders, anchored: OH.anchored, span: OH.span }; },
    _splitCache(c) { SPL.cache = !!c; splitFree(); dirty = true; },
    // ---- from above (see "From above" before tick()) ----
    overhead(o) {
      if (!o || o.on === false) { ohLeave(); return; }
      const shots = Array.isArray(o.shots) ? o.shots.filter(s => s && s.id != null && s.v && Number.isFinite(+s.v.lat) && Number.isFinite(+s.v.lng)) : OH.shots;
      const key = shots.map(s => `${s.id}:${(+s.v.lat).toFixed(6)},${(+s.v.lng).toFixed(6)}`).join('|');
      OH.shots = shots;
      const flagged = shots.find(s => s.sel), was = OH.sel;
      if (o.sel != null) OH.sel = o.sel; else if (flagged) OH.sel = flagged.id; else if (!shots.some(s => s.id === OH.sel)) OH.sel = shots.length ? shots[0].id : null;
      if (o.sun != null) OH.sunOn = !!o.sun;
      if (o.marks != null) OH.marks = !!o.marks;
      if (o.shaded !== undefined) OH.shaded = typeof o.shaded === 'boolean' ? o.shaded : null;
      const up = o.heading_up_deg !== undefined ? o.heading_up_deg : o.up;
      const first = !OH.on;
      if (up !== undefined) ohSetUp(up); else if (first) ohSetUp('view');
      else if (OH.sel !== was) { if (OH.upMode === 'view') OH.rot = ohRad(ohAim(ohSelShot())); ohHold(); ohSay(); }   // another shot picked: my view turns to its aim, zoom goes back to its spot
      else if (OH.upMode === 'view') OH.rot = ohRad(ohAim(ohSelShot()));   // (its framing may have been saved since)
      if (first || o.fit || key !== OH.shotKey) { OH.shotKey = key; OH.needFit = true; }
      if (first) ohEnter(); else if (R && OH.needFit) ohFit();
      if (R) { relight = dirty = true; if (up !== undefined) ohSay(); }
    },
    overheadSel(id) { OH.sel = id; if (OH.upMode === 'view') { OH.rot = ohRad(ohAim(ohSelShot())); ohSay(); } ohHold(); dirty = true; },
    overheadUp(v) { ohSetUp(v === undefined ? 'view' : v); dirty = true; ohSay(); },
    overheadShade(v) { OH.shaded = typeof v === 'boolean' ? v : null; dirty = true; },
    overheadSun(v) { OH.sunOn = v !== false; relight = dirty = true; },
    others(list) { OTH.list = Array.isArray(list) ? list.filter(o => o && Number.isFinite(+o.lat) && Number.isFinite(+o.lng)) : []; othCalc(); dirty = true; },
    eyeHeight(m) { const v = Math.max(0.3048, Math.min(10000, +m)); if (!Number.isFinite(v)) return; EYE = v; touch('walk'); if (eye) told(); },
    othersOn(v) { OTH.on = v !== false; dirty = true; },
    // overheadRoutes([{ id, name, coords: [[lng, lat], ...] }]): the stop's trails drawn on the view from above (none = [])
    overheadRoutes(list) { OH.routes = Array.isArray(list) ? list.filter(r => r && Array.isArray(r.coords) && r.coords.length > 1).map(r => ({ id: r.id, name: r.name, coords: r.coords, color: r.color })) : []; dirty = true; },
    // overheadMe({ lat, lng, acc?, heading?, center? } | null): Find me's dot; center = put it in the middle of the screen
    overheadMe(o) {
      OH.me = o && Number.isFinite(+o.lat) && Number.isFinite(+o.lng) ? { lat: +o.lat, lng: +o.lng, acc: o.acc, heading: o.heading } : null;
      // outside the map (23 Nov 2026: at home the view went to the map's corner, all black): say so, keep the view on the shots
      let out = false;
      if (OH.me && FAR) { const q = ohXZ(OH.me); out = !(q.x >= 0 && q.x <= FAR.w && q.z >= 0 && q.z <= FAR.d); }
      if (OH.me && o.center && FAR) {
        if (out) ohFit();
        else { OH.anchored = false; const q = ohXZ(OH.me); OH.cx = q.x; OH.cz = q.z; if (+o.span > 0) OH.span = Math.max(OH_MIN, Math.min(OH_MAX, +o.span)); ohClamp(); }
        ohSay();
      }
      if (OH.me && out !== OH.meOut) { OH.meOut = out; post({ type: 'overheadMe', outside: out }); }
      if (!OH.me) OH.meOut = undefined;
      dirty = true;
    },
    overheadMarks(v) { OH.marks = v !== false; dirty = true; },   // the cone, the other shots' wedges and the sun arrows / band on or off
    overheadFit() { ohFit(); dirty = true; ohSay(); },
    // overheadZoom(k): k > 1 closer, < 1 farther, about the middle of the screen (the small view's + / - buttons)
    overheadZoom(k) { if (!(k > 0)) return; OH.span = Math.max(OH_MIN, Math.min(OH_MAX, OH.span / k)); ohHold(); touch('look'); ohSay(); },
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
    tapGo(on) { TAPGO.on = !!on; },
    // back(): undo the last tap-to-go jump (Phil, 18 Nov 2026)
    back() { if (!R || !TAPGO.hist.length) return; eye = TAPGO.hist.pop(); touch('walk'); told(); },
    home() { if (!R || !eye0) return; if (eye !== eye0) { TAPGO.hist.push(eye); if (TAPGO.hist.length > 50) TAPGO.hist.shift(); } eye = eye0; aim(); dirty = true; heading(); told(); },
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
