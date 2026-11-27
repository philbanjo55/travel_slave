// node tw.js <page dir> <out dir> <tag> <mode: plain | base | trees> [keys]
// Feeds the app page as Sun3DPanel does (init + wide + near, done; after 'ready': fore + its chunks + foreDone), for
// the jobs of review3d/jobs.json (or tw_jobs.json); trees = the park-wide tree tiles too (those within RANGE of the stand
// pin, as services/terrain.ts picks them). Saves a picture, the moments and the timings.
// env: W, H, WAIT, BLOCK=1 (abort any network request), JOBS (jobs file), RANGE (m, default 7000), MINS (override minutes)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const RV = '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/review3d', FILES = path.join(RV, 'files');
const TW = '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/trees_wide';
const [, , pageDir, outDir, tag, mode, only] = process.argv;
const jobs = JSON.parse(fs.readFileSync(process.env.JOBS || path.join(RV, 'jobs.json'), 'utf8')).filter(j => j.trip === 'teton' && (!only || only.split(',').includes(j.key)));   // (a job with `pose` is drawn from that camera: pages patched with photo_match2/pages/patch.py)
const regions = JSON.parse(fs.readFileSync(path.join(RV, 'terrain_regions.json'))), nears = JSON.parse(fs.readFileSync(path.join(RV, 'terrain_near_regions.json'))), details = JSON.parse(fs.readFileSync(path.join(RV, 'terrain_detail_regions.json')));
const LEAFT = process.env.WLEAFDIR ? Object.fromEntries(JSON.parse(fs.readFileSync(path.join(process.env.WLEAFDIR, '..', 'leaf_tiles.json'))).map(r => [r.id, r.leaf_path])) : null;
const LEAFM = process.env.LEAFDIR ? Object.fromEntries(JSON.parse(fs.readFileSync(path.join(process.env.LEAFDIR, '..', 'leaf_rows.json'))).map(r => [r.id, r.leaf_mask_path])) : null;
const tiles = JSON.parse(fs.readFileSync(path.join(TW, 'work', 'tiles.json')));
// sharp-range test (14 Nov 2026): RANGES=<range.json> RFILES=<dir> (the range level), DETAILS=<detail json> DFILES=<dir>[:<dir>] (new detail boxes,
// picked as services/terrain.ts pickDetail), HOUSES=<tiles.json> HFILES=<dir> (park-wide buildings within HRANGE m, 8000)
const SH = '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/sharp';
const ranges = process.env.RANGES ? JSON.parse(fs.readFileSync(process.env.RANGES)) : null;
const newDet = process.env.DETAILS ? JSON.parse(fs.readFileSync(process.env.DETAILS)) : null;
const houses = process.env.HOUSES ? JSON.parse(fs.readFileSync(process.env.HOUSES)) : null;
const fileIn = (dirs, f) => { for (const d of (dirs || '').split(':')) if (d && fs.existsSync(path.join(d, f))) return path.join(d, f); return path.join(FILES, f); };
const KZ = 111132, KX = lat => 111320 * Math.cos(lat * Math.PI / 180);
const inBox = (r, p) => p.lat <= r.north && p.lat >= r.south && p.lng >= r.west && p.lng <= r.east;
const margin = (r, p) => Math.min((r.north - p.lat) * KZ, (p.lat - r.south) * KZ, (p.lng - r.west) * KX(p.lat), (r.east - p.lng) * KX(p.lat));
function rangeFor(all, stand, subj) {   // = services/terrain.ts pickRange
  const kx = KX(subj.lat), dx = (stand.lng - subj.lng) * kx, dz = (stand.lat - subj.lat) * KZ, d = Math.hypot(dx, dz) || 1, t = Math.min(1500, d / 2);
  const P = { lat: subj.lat + dz / d * t / KZ, lng: subj.lng + dx / d * t / kx };
  let best = null, bd = Infinity;
  for (const r of all) { if (!inBox(r, subj) || margin(r, subj) < 1000) continue; const c = { lat: (r.north + r.south) / 2, lng: (r.west + r.east) / 2 }, e = Math.hypot((c.lat - P.lat) * KZ, (c.lng - P.lng) * kx); if (e < bd) { best = r; bd = e; } }
  if (best) return best;
  for (let s = 1000; s <= 30000; s += 250) {   // along the line of sight: the first box it reaches
    const q = { lat: stand.lat - dz / d * s / KZ, lng: stand.lng - dx / d * s / kx };
    for (const r of all) if (inBox(r, q) && margin(r, q) >= 500) return r;
  }
  return null;
}
function detailFor(all, near, stand, subject) {   // = services/terrain.ts pickDetail
  let best = null, bb = false, bi = 0;
  for (const r of all) {
    if (!inBox(r, stand)) continue;
    if (near && !(r.north <= near.north && r.south >= near.south && r.west >= near.west && r.east <= near.east)) continue;
    const inside = margin(r, stand); if (inside < 100) continue;
    const both = inBox(r, subject);
    if (!best || (both && !bb) || (both === bb && inside > bi)) { best = r; bb = both; bi = inside; }
  }
  return best;
}
const housesFor = v => (houses || []).filter(t => Math.hypot(Math.max(t.west - v.lng, 0, v.lng - t.east) * KX(v.lat), Math.max(t.south - v.lat, 0, v.lat - t.north) * KZ) <= +(process.env.HRANGE || 8000));
const RANGE = +(process.env.RANGE || 12000);
const sunPos = new Function(fs.readFileSync(path.join(RV, 'render.js'), 'utf8').match(/function sunPos[\s\S]*?\n}\n/)[0] + '; return sunPos;')();
const b64 = f => fs.readFileSync(f.startsWith('/') ? f : path.join(FILES, f)).toString('base64');
const CH = 240000;
const feed = async (p, data, which) => { for (let i = 0; i < data.length; i += CH) await p.evaluate(([s, w]) => window.S3D.chunk(s, w), [data.slice(i, i + CH), which]); };
const hm = m => m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// the tiles a stand pin gets: every tile whose box comes within RANGE of it, nearest first (services/terrain.ts treeTilesFor)
const tilesFor = v => { const kx = 111320 * Math.cos(v.lat * Math.PI / 180), kz = 111132, boxes = new Map(), all = JSON.parse(require('fs').readFileSync(require('path').join('/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/trees_wide', 'work', 'tiles.json')));
  for (const t of all) { const d = Math.hypot(Math.max(t.west - v.lng, 0, v.lng - t.east) * kx, Math.max(t.south - v.lat, 0, v.lat - t.north) * kz); if (d > RANGE) continue; const k = t.north + '|' + t.west, b = boxes.get(k) || { d, byLod: {} }; b.byLod[t.lod ? 1 : 0] = t; boxes.set(k, b); }
  return [...boxes.values()].sort((a, b) => a.d - b.d).map(b => (b.d <= +(process.env.NEAR || 3000) ? b.byLod[0] || b.byLod[1] : b.byLod[1] || b.byLod[0])); };
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const all = {};
  // the whole browser's memory (every Chromium process), sampled every 200 ms: peak RSS in MB while a job runs
  const { execSync } = require('child_process'); let rssPeak = 0;
  const rssNow = () => { try { const rows = execSync('ps -eo pid=,ppid=,rss=').toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number)); const kids = new Map(); for (const [pid, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(pid); }
    const rss = new Map(rows.map(r => [r[0], r[2]])); let kb = 0; const st = [...(kids.get(process.pid) || [])]; while (st.length) { const q = st.pop(); kb += rss.get(q) || 0; for (const c of kids.get(q) || []) st.push(c); } return kb / 1024; } catch (e) { return 0; } };
  const bpid = process.pid;
  const rssTimer = bpid ? setInterval(() => { rssPeak = Math.max(rssPeak, rssNow()); }, 200) : null;
  for (const j of jobs) {
    try {
      rssPeak = 0;
      const p = await b.newPage({ viewport: { width: +(process.env.W || 900), height: +(process.env.H || 600) }, deviceScaleFactor: 1 });
      const errs = [], reqs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 300))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
      await p.addInitScript(() => {   // frame cost (as the smoothness bench): rAF callback start -> graphics done (a 1-pixel read-back), frames that drew
        const B = window.__b = { on: false, frames: [], drew: false, gl: null }; const px1 = new Uint8Array(4);
        const gc = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (t, o) { const gl = gc.call(this, t, o); if (gl && !gl.__h && /webgl/.test(t)) { gl.__h = true; B.gl = gl; const de = gl.drawElements.bind(gl); gl.drawElements = (...a) => { B.drew = true; return de(...a); }; } return gl; };
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = cb => raf(t => { if (!B.on) return cb(t); const t0 = performance.now(); B.drew = false; cb(t); const t1 = performance.now(); if (B.drew && B.gl) { B.gl.readPixels(0, 0, 1, 1, B.gl.RGBA, B.gl.UNSIGNED_BYTE, px1); B.frames.push(performance.now() - t0); (B.js || (B.js = [])).push(t1 - t0); } });
        window.__drag = ms => new Promise(done => { const c = document.getElementById('view'), ev = (t, x) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: 300, pointerId: 1, bubbles: true })); let x = 200, dir = 1; const t0 = performance.now(); B.frames = []; B.on = true; ev('pointerdown', x);
          const step = () => { if (performance.now() - t0 > ms) { ev('pointerup', x); B.on = false; return done(B.frames.slice()); } x += dir; if (x > 260 || x < 140) dir = -dir; ev('pointermove', x); raf(step); }; raf(step); });
      });
      if (process.env.DUMP) await p.addInitScript(() => { window.__treeDump = {}; });
      if (j.pose) await p.addInitScript(P => { window.__pose = P; }, j.pose);
      await p.addInitScript(() => { window.__m = []; window.ReactNativeWebView = { postMessage: s => window.__m.push(JSON.parse(s)) }; window.__hp = 0; window.__ht = 0; setInterval(() => { const m = performance.memory; if (m) { window.__hp = Math.max(window.__hp, m.usedJSHeapSize); window.__ht = Math.max(window.__ht, m.totalJSHeapSize); } }, 20); });
      await p.goto('file://' + path.resolve(pageDir, 'index.html'));
      p.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('blob:') && !u.startsWith('data:')) reqs.push(u.slice(0, 80)); });
      if (process.env.BLOCK) await p.route(u => !/^(file|blob|data):/.test(String(u)), r => { reqs.push('BLOCKED ' + r.request().url().slice(0, 80)); r.abort(); });
      const region = regions.find(r => r.id === j.region), near = nears.find(r => r.id === j.near);
      const det = newDet ? detailFor(newDet, near, j.v, j.s) : details.find(r => r.id === j.detail);
      const rng = ranges ? rangeFor(ranges, j.v, j.s) : null, hts = houses ? housesFor(j.v) : [];
      const DB = f => b64(fileIn(process.env.DFILES, f));
      const eye = j.v, target = j.s, ice = region.ground !== 'green';
      const cfgE = { x: (eye.lng - region.west) * region.width_m / (region.east - region.west), z: (region.north - eye.lat) * region.depth_m / (region.north - region.south) };
      const cfg = { n: region.n, north: region.north, south: region.south, west: region.west, east: region.east, W: region.width_m, D: region.depth_m, base: region.base_m, step: region.step_m, ground: region.ground,
        eye, target, focal: +(process.env.FOCAL || 135), lens: { f: +(process.env.FOCAL || 135), fw: 120, fh: 96, box: !process.env.NOBOX }, inline: true, treeStyle: process.env.TSTYLE || undefined, near: near ? { n: near.n, north: near.north, south: near.south, west: near.west, east: near.east, base: near.base_m, step: near.step_m } : undefined, ice };
      if (process.env.LEVEL) cfg.level = { look: +process.env.LEVEL, sun: +process.env.LEVEL };
      await p.evaluate(f => { window.__focal = f; }, cfg.focal);
      await p.evaluate(c => window.S3D.init(c), cfg);
      await feed(p, b64(region.path)); if (near) await feed(p, b64(near.path), 'near');
      await p.evaluate(() => { window.__t = performance.now(); window.S3D.done(); });
      await p.waitForFunction(() => window.__m.some(m => m.type === 'ready' || m.type === 'error'), null, { timeout: 240000 });
      const readyMs = await p.evaluate(() => Math.round(performance.now() - window.__t));
      const dayStart = Date.UTC(+j.date.slice(0, 4), +j.date.slice(5, 7) - 1, +j.date.slice(8, 10)) - j.off * 60000;
      const pathArr = []; for (let m = 0; m < 1440; m += 4) { const q = sunPos(dayStart + m * 60000, eye.lat, eye.lng); if (q.alt > -2.5) pathArr.push([m, Math.round(q.az * 100) / 100, Math.round(q.alt * 100) / 100]); }
      const sp = sunPos(dayStart + (+(process.env.MINS || j.mins)) * 60000, eye.lat, eye.lng);
      await p.evaluate(([az, alt, pa]) => { window.S3D.sun(az, alt); window.S3D.path(pa); }, [sp.az, sp.alt, pathArr]);
      let foreMs = null, wideMs = null, tl = [];
      if (mode !== 'plain') {
        tl = mode === 'trees' ? tilesFor(eye) : [];
        const fo = { detail: det ? { n: det.n, north: det.north, south: det.south, west: det.west, east: det.east, base: det.base_m, step: det.step_m, width: det.width_m ?? undefined, depth: det.depth_m ?? undefined, bare: det.bare ?? (newDet ? true : undefined),
          trees: det.trees_path ? { bins: det.trees_bins ?? 64, bin: det.trees_bin_m ?? 0.6 } : undefined, leaf: LEAFM && LEAFM[det.id] ? (/_mask_v6\.png$/.test(LEAFM[det.id]) ? 2 : true) : undefined } : undefined,
          water: det && det.water_path && det.water_n ? { n: det.water_n, north: det.water_north, south: det.water_south, west: det.water_west, east: det.water_east } : undefined, ice,
          canopy: tl.length && !process.env.NOCFG ? { tiles: tl.map(t => ({ n: t.n, north: t.north, south: t.south, west: t.west, east: t.east, step: t.step_m, lod: t.lod })), max: process.env.CAPMAX ? +process.env.CAPMAX : undefined, leaf: LEAFT ? true : undefined } : undefined };
        await p.evaluate(() => { window.__f = performance.now(); });
        if (rng) { fo.range = { n: rng.n, north: rng.north, south: rng.south, west: rng.west, east: rng.east, base: rng.base_m, step: rng.step_m, light: process.env.LIGHT ? true : undefined }; }
        if (hts.length) fo.houses = { tiles: hts.map(t => ({ north: t.north, south: t.south, west: t.west, east: t.east })) };
        await p.evaluate(fo => { window.S3D.fore(fo); }, fo);
        if (rng) await feed(p, b64(path.join(process.env.RFILES, rng.path)), 'range');
        if (det) { await feed(p, DB(det.path), 'detail'); if (det.mask_path) await feed(p, LEAFM && LEAFM[det.id] ? b64(path.join(process.env.LEAFDIR, LEAFM[det.id])) : DB(det.mask_path), 'mask'); if (det.trees_path) await feed(p, DB(det.trees_path), 'trees'); if (fo.water) await feed(p, DB(det.water_path), 'water'); if (det.color_path) await feed(p, DB(det.color_path), 'color'); }
        for (let i = 0; i < hts.length; i++) await feed(p, b64(path.join(process.env.HFILES, hts[i].path)), 'house:' + i);
        if (near && near.color_path) await feed(p, b64(near.color_path), 'ncolor');
        if (region.color_path) await feed(p, b64(region.color_path), 'wcolor');
        for (let i = 0; i < tl.length; i++) { const d = b64(LEAFT ? path.join(process.env.WLEAFDIR, LEAFT[tl[i].id]) : path.join(TW, 'files', tl[i].path)); for (let k = 0; k < d.length; k += 60000) await p.evaluate(([q, w]) => window.S3D.chunk(q, w), [d.slice(k, k + 60000), 'canopy:' + i]); }   // the panel's TREE_CHUNK
        await p.evaluate(() => window.S3D.foreDone());
        await p.waitForFunction(() => window.__m.some(m => m.type === 'foreground'), null, { timeout: 240000 }).catch(() => {});
        if (rng) await p.waitForFunction(() => window.__m.some(m => m.type === 'range'), null, { timeout: 240000 }).catch(() => {});
        const rangeMs = rng ? await p.evaluate(() => { const m = window.__m.find(m => m.type === 'range'); return m && m.ms; }) : null;
        if (hts.length) await p.waitForFunction(() => window.__m.some(m => m.type === 'houses'), null, { timeout: 240000 }).catch(() => {});
        foreMs = await p.evaluate(() => Math.round(performance.now() - window.__f));
        if (tl.length) { await p.waitForFunction(() => window.__m.some(m => m.type === 'wideTrees'), null, { timeout: 240000 }).catch(() => {}); wideMs = await p.evaluate(() => Math.round(performance.now() - window.__f)); }
        await p.evaluate(([az, alt, pa]) => { window.S3D.sun(az, alt); window.S3D.path(pa); }, [sp.az, sp.alt, pathArr]);
      }
      await p.waitForTimeout(+(process.env.WAIT || 6000));
      // settle: one more redraw asked for, then wait until two frames that drew have finished (software graphics can take
      // seconds a frame: a fixed wait could photograph a frame from before the last stage came in)
      const settled = await p.evaluate(async () => { const B = window.__b; B.frames = []; B.on = true; window.S3D.focal(+(window.__focal || 135)); const t0 = performance.now(); while (B.frames.length < 1 && performance.now() - t0 < 90000) await new Promise(r => setTimeout(r, 200)); B.on = false; return [B.frames.length, Math.round(performance.now() - t0)]; });
      if (process.env.REDRAW) { for (let i = 0; i < 3; i++) { await p.evaluate(() => window.S3D.focal(135)); await p.waitForTimeout(2500); } console.log('REDRAW', JSON.stringify(await p.evaluate(() => [window.__hd, window.__campos]))); }
      if (process.env.HIDE) { await p.evaluate(h => { window.__hide = h.split(','); window.S3D.focal(135); }, process.env.HIDE); await p.waitForTimeout(1500); }
      let perf = null;
      if (process.env.IDLE) { const n = await p.evaluate(async () => { window.__b.frames = []; window.__b.on = true; await new Promise(r => setTimeout(r, 5000)); window.__b.on = false; return window.__b.frames.map(Math.round); }); console.log(j.key, tag, 'IDLE frames in 5 s', JSON.stringify(n)); }
      if (process.env.PERF) {   // frame time while dragging, CPU slowed PERF x (the page's own 'perf' message: fence-timed median / worst, its level)
        const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.PERF });
        const W0 = +(process.env.W || 900), H0 = +(process.env.H || 600), drag = async () => { await p.mouse.move(W0 * 0.7, H0 * 0.5); await p.mouse.down(); for (let i = 0; i < +(process.env.STEPS || 30); i++) { await p.mouse.move(W0 * 0.7 - (i % 30) * 12, H0 * 0.5 + (i % 2)); await p.waitForTimeout(100); } await p.mouse.up(); await p.waitForTimeout(3000); };
        if (process.env.PERFRAF) {   // continuous drag for PERFRAF ms, frame costs measured outside the page (works at any speed)
          await p.evaluate(ms => window.__drag(ms), 2000); await p.waitForTimeout(2000);
          const fr = await p.evaluate(ms => window.__drag(ms), +process.env.PERFRAF);
          const js = await p.evaluate(() => (window.__b.js || []).slice(-5).map(Math.round)); const srt = fr.slice().sort((a, b) => a - b); perf = { js, level: +(process.env.LEVEL || 0), frames: fr.length, median: Math.round(srt[srt.length >> 1]), p90: Math.round(srt[Math.floor(srt.length * 0.9)] || 0) };
        } else if (process.env.PERFCYC) {   // fixed quality level (LEVEL): one-step drags, each one frame at that level, timed by the page (fence)
          await p.evaluate(() => { window.__m = window.__m.filter(m => m.type !== 'perf'); });
          // the finger held down: a small step, then a pause long enough for the frame to finish (the page times it), again
          await p.mouse.move(W0 * 0.6, H0 * 0.5); await p.mouse.down();
          for (let i = 0; i < +process.env.PERFCYC; i++) { await p.mouse.move(W0 * 0.6 - 14 * (i % 2 ? 0 : 1), H0 * 0.5); await p.waitForTimeout(+(process.env.STEPMS || 2500)); }
          await p.mouse.up(); await p.waitForTimeout(1500);
          const pm = await p.evaluate(() => window.__m.filter(m => m.type === 'perf').slice(-1)[0] || null);
          perf = { level: +(process.env.LEVEL || 0), median: pm && pm.ms, worst: pm && pm.worst, frames: pm && pm.frames, quality: pm && pm.quality };
        } else {
        await drag(); await p.evaluate(() => { window.__m = window.__m.filter(m => m.type !== 'perf'); });
        await drag(); await p.waitForTimeout(1500);
        perf = await p.evaluate(() => window.__m.filter(m => m.type === 'perf').slice(-1)[0] || null);
        }
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await p.waitForTimeout(2000);
        console.log(j.key, tag, 'PERF', JSON.stringify(perf));
      }
      await p.screenshot({ path: path.join(outDir, `${j.key}_${tag}.png`), timeout: 180000 });
      // every shot-day's first / last light, at 4-minute steps (the app's path), for the sun-time proof
      const heap = await p.evaluate(() => [Math.round(window.__hp / 1048576), Math.round(window.__ht / 1048576)]);
      if (process.env.HEAP) console.log('JS heap peak used / total MB', heap);
      if (process.env.DBG) console.log('DBG', JSON.stringify(await p.evaluate(() => [window.__dbg && window.__dbg.eye, window.__campos])));
      if (process.env.DUMP) {   // the drawn trees (near: all; park-wide: within 700 m of the eye), rounded
        const dump = await p.evaluate(() => { const D = window.__treeDump || {}, R = a => Array.from(a || [], v => Math.round(v * 100) / 100), o = {};
          if (D.near) { o.near = { style: D.near.style }; for (const k of ['P', 'A']) if (D.near[k]) o.near[k] = R(D.near[k]); if (D.near.trees) { o.near.trees = {}; for (const k in D.near.trees) o.near.trees[k] = R(D.near.trees[k]); } }
          if (D.wide) o.wide = { P: R(D.wide.P), A: R(D.wide.A) };
          return o; });
        if (dump.wide) { const P = dump.wide.P, A = dump.wide.A, ex = cfgE.x, ez = cfgE.z, P2 = [], A2 = []; for (let i = 0; i < P.length / 3; i++) if (Math.hypot(P[i * 3] - ex, P[i * 3 + 2] - ez) < 700) { P2.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); A2.push(A[i * 4], A[i * 4 + 1], A[i * 4 + 2], A[i * 4 + 3]); } dump.wide = { P: P2, A: A2, total: P.length / 3 }; }
        dump.cfg = { west: region.west, east: region.east, north: region.north, south: region.south, W: region.width_m, D: region.depth_m, eye: j.v, det: det ? det.id : null };
        fs.writeFileSync(path.join(outDir, `${j.key}_${tag}_dump.json`), JSON.stringify(dump));
      }
      const msgs = await p.evaluate(() => window.__m);
      const pick = t => msgs.filter(m => m.type === t).slice(-1)[0];
      const mo = pick('moments') || {};
      const res = { settled, perf, rssPeak: Math.round(rssPeak), key: j.key, stop: j.stop, range: pick('range') || null, houses: pick('houses') || null, rangeId: rng ? rng.id : null, detailId: det ? det.id : null, heap, sun: { az: +sp.az.toFixed(2), alt: +sp.alt.toFixed(2) }, readyMs, foreMs, wideMs, tiles: tl.length, tileBytes: tl.reduce((n, t) => n + t.bytes, 0),
        fore: pick('foreground') || null, wide: pick('wideTrees') || null, state: pick('state'), moments: mo, momentsHM: { firstSubject: hm(mo.firstSubject), firstHere: hm(mo.firstHere), lastHere: hm(mo.lastHere), lastSubject: hm(mo.lastSubject), trees: mo.trees },
        stages: msgs.filter(m => m.type === 'detail').map(m => m.stage + ':' + m.ms).join(' '), reqs, errs };
      all[j.key] = res;
      console.log(j.key, tag, JSON.stringify({ range: res.range && [res.range.ok, res.range.ms, res.range.msg], houses: res.houses && [res.houses.ok, res.houses.count, res.houses.inBox, res.houses.ms, res.houses.msg], det: res.detailId, heap, readyMs, foreMs, wideMs, tiles: tl.length, wide: res.wide, mo: res.momentsHM, st: res.state && [res.state.subjectLit, res.state.hereLit], reqs: reqs.length, errs }));
      await p.close();
    } catch (e) { console.log(j.key, 'FAILED', String(e).slice(0, 300)); }
  }
  if (rssTimer) clearInterval(rssTimer);
  fs.writeFileSync(path.join(outDir, `result_${tag}.json`), JSON.stringify(all, null, 1));
  await b.close();
  console.log('node VmHWM MB', Math.round(+fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s+(\d+)/)[1] / 1024));
})();
