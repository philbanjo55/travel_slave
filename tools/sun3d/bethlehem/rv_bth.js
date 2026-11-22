// Bethlehem 3D check: renders the app page (src/components/sun/sun3dHtml.ts extracted as <page dir>/index.html) the way
// Sun3DPanel feeds it: init + wide + near, done; after 'ready': fore {range, detail, water, houses, canopy} + chunks in the
// panel's order + foreDone. Saves a picture per job, the page's messages, the moments (first / last light), timings and
// the browser's peak memory (all Chromium processes, RSS) and the page's JS heap.
//   node rv_bth.js <page dir> <files dir> <out dir> <jobs.json> [only keys]
// jobs: [{key, eye:{lat,lng}, target:{lat,lng}, focal, mins (local EST minutes on 25 Nov 2026), detail: <detail row json
//         path or null>, base: true = the plain view only, houses: true, trees: true, range: true, W, H, view?, emily?}]
// env: WAIT (ms after the foreground, default 6000), BLOCK=1 (refuse every network request)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const [, , pageDir, FILES, outDir, jobsFile, only] = process.argv;
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const jobs = J(jobsFile).filter(j => !only || only.split(',').includes(j.key));
const b64 = f => fs.readFileSync(f.startsWith('/') ? f : path.join(FILES, f)).toString('base64');
const CH = 240000, TREE_CH = 60000;
const feed = async (p, data, which, ch = CH) => { for (let i = 0; i < data.length; i += ch) await p.evaluate(([s, w]) => window.S3D.chunk(s, w), [data.slice(i, i + ch), which]); };
// sun: NOAA as tools/sun3d/sun.js, for any UTC moment
function sunPos(ms, lat, lng) {
  const R = Math.PI / 180, JD = ms / 86400000 + 2440587.5, T = (JD - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T), e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * R) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * R);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * R);
  const decl = Math.asin(Math.sin(eps * R) * Math.sin(lam * R)), y = Math.tan(eps * R / 2) ** 2;
  const eot = 4 / R * (y * Math.sin(2 * L0 * R) - 2 * e * Math.sin(M * R) + 4 * e * y * Math.sin(M * R) * Math.cos(2 * L0 * R) - 0.5 * y * y * Math.sin(4 * L0 * R) - 1.25 * e * e * Math.sin(2 * M * R));
  const utcMin = ((ms / 60000) % 1440 + 1440) % 1440, tst = ((utcMin + eot + 4 * lng) % 1440 + 1440) % 1440, ha = (tst / 4 - 180) * R;
  const cz = Math.sin(lat * R) * Math.sin(decl) + Math.cos(lat * R) * Math.cos(decl) * Math.cos(ha), zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  let alt = 90 - zen / R; const a = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat * R) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat * R) * Math.sin(zen))))) / R;
  const az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  if (alt > -0.575) alt += 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * R) / 60;
  return { alt, az };
}
const DAY0 = Date.UTC(2026, 10, 25, 5, 0);   // 25 Nov 2026 00:00 EST
const hm = m => m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const rssNow = () => { try { const rows = execSync('ps -eo pid=,ppid=,rss=').toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number)); const kids = new Map(); for (const [pid, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(pid); }
  const rss = new Map(rows.map(r => [r[0], r[2]])); let kb = 0; const st = [...(kids.get(process.pid) || [])]; while (st.length) { const q = st.pop(); kb += rss.get(q) || 0; for (const c of kids.get(q) || []) st.push(c); } return kb / 1024; } catch (e) { return 0; } };
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const all = {};
  for (const j of jobs) {
    const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
    let rssPeak = 0; const timer = setInterval(() => { rssPeak = Math.max(rssPeak, rssNow()); }, 200);
    try {
      const p = await b.newPage({ viewport: { width: j.W || 1000, height: j.H || 800 }, deviceScaleFactor: 1 });
      const errs = [], reqs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 300))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
      await p.addInitScript(() => { window.__m = []; window.ReactNativeWebView = { postMessage: s => window.__m.push(JSON.parse(s)) }; window.__hp = 0; setInterval(() => { const m = performance.memory; if (m) window.__hp = Math.max(window.__hp, m.usedJSHeapSize); }, 20); });
      await p.goto('file://' + path.resolve(pageDir, 'index.html'));
      p.on('request', r => { const u = r.url(); if (!/^(file|blob|data):/.test(u)) reqs.push(u.slice(0, 80)); });
      if (process.env.BLOCK) await p.route(u => !/^(file|blob|data):/.test(String(u)), r => { reqs.push('BLOCKED ' + r.request().url().slice(0, 80)); r.abort(); });
      const R = J(path.join(FILES, 'region.json')), N = J(path.join(FILES, 'near.json'));
      const lens = j.lens || { f: j.focal, fw: 120, fh: 96, box: true };
      const cfg = { n: R.n, north: R.north, south: R.south, west: R.west, east: R.east, W: R.width_m, D: R.depth_m, base: R.base_m, step: R.step_m, ground: R.ground,
        eye: j.eye, target: j.target, focal: j.focal, lens, inline: false, treeStyle: 'shapes', trees: true, ice: R.ground !== 'green', view: j.view,
        near: { n: N.n, north: N.north, south: N.south, west: N.west, east: N.east, base: N.base_m, step: N.step_m } };
      await p.evaluate(c => window.S3D.init(c), cfg);
      await feed(p, b64(R.path)); await feed(p, b64(N.path), 'near');
      await p.evaluate(() => { window.__t = performance.now(); window.S3D.done(); });
      await p.waitForFunction(() => window.__m.some(m => m.type === 'ready' || m.type === 'error'), null, { timeout: 300000 });
      const readyMs = await p.evaluate(() => Math.round(performance.now() - window.__t));
      const pathArr = []; for (let m = 0; m < 1440; m += 4) { const q = sunPos(DAY0 + m * 60000, j.eye.lat, j.eye.lng); if (q.alt > -2.5) pathArr.push([m, Math.round(q.az * 100) / 100, Math.round(q.alt * 100) / 100]); }
      const sp = sunPos(DAY0 + j.mins * 60000, j.eye.lat, j.eye.lng);
      await p.evaluate(([az, alt, pa]) => { window.S3D.sun(az, alt); window.S3D.path(pa); }, [sp.az, sp.alt, pathArr]);
      let foreMs = null, housesMs = null, wideMs = null;
      if (!j.base) {
        const det = j.detail ? J(j.detail) : null, rng = j.range ? J(path.join(FILES, 'range.json')) : null;
        const hts = j.houses ? J(path.join(FILES, 'house_tiles.json')) : [], tts = j.trees ? J(path.join(FILES, 'tree_tiles.json')) : [];
        const leaf = det && det.leaf_mask_path ? (/_mask_v6\.png$/.test(det.leaf_mask_path) ? 2 : 1) : undefined;
        const fo = { detail: det ? { n: det.n, north: det.north, south: det.south, west: det.west, east: det.east, base: det.base_m, step: det.step_m, width: det.width_m, depth: det.depth_m, bare: det.bare, leaf } : undefined,
          water: det && det.water_path ? { n: det.water_n, north: det.water_north, south: det.water_south, west: det.water_west, east: det.water_east } : undefined, ice: R.ground !== 'green',
          canopy: tts.length ? { tiles: tts.map(t => ({ n: t.n, north: t.north, south: t.south, west: t.west, east: t.east, step: t.step_m, lod: t.lod ? 1 : 0 })), leaf: true } : undefined,
          range: rng ? { n: rng.n, north: rng.north, south: rng.south, west: rng.west, east: rng.east, base: rng.base_m, step: rng.step_m } : undefined,
          houses: hts.length ? { tiles: hts.map(t => ({ north: t.north, south: t.south, west: t.west, east: t.east })) } : undefined };
        await p.evaluate(() => { window.__f = performance.now(); });
        await p.evaluate(fo => window.S3D.fore(fo), fo);
        const DF = f => b64(path.join(path.dirname(j.detail), f));
        if (rng) await feed(p, b64(rng.path), 'range');
        if (det) { await feed(p, DF(det.path), 'detail'); await feed(p, DF(det.leaf_mask_path || det.mask_path), 'mask'); if (det.water_path) await feed(p, DF(det.water_path), 'water'); if (det.color_path) await feed(p, b64(det.color_path), 'color'); }
        if (N.color_path) await feed(p, b64(N.color_path), 'ncolor');
        if (R.color_path) await feed(p, b64(R.color_path), 'wcolor');
        for (let i = 0; i < hts.length; i++) await feed(p, b64(hts[i].path), 'house:' + i);
        for (let i = 0; i < tts.length; i++) await feed(p, b64(tts[i].leaf_path), 'canopy:' + i, TREE_CH);
        await p.evaluate(() => window.S3D.foreDone());
        await p.waitForFunction(() => window.__m.some(m => m.type === 'foreground'), null, { timeout: 300000 }).catch(() => {});
        foreMs = await p.evaluate(() => Math.round(performance.now() - window.__f));
        if (hts.length) { await p.waitForFunction(() => window.__m.some(m => m.type === 'houses'), null, { timeout: 300000 }).catch(() => {}); housesMs = await p.evaluate(() => Math.round(performance.now() - window.__f)); }
        if (tts.length) { await p.waitForFunction(() => window.__m.some(m => m.type === 'wideTrees'), null, { timeout: 300000 }).catch(() => {}); wideMs = await p.evaluate(() => Math.round(performance.now() - window.__f)); }
        await p.evaluate(([az, alt, pa]) => { window.S3D.sun(az, alt); window.S3D.path(pa); }, [sp.az, sp.alt, pathArr]);
      }
      if (j.view) await p.evaluate(v => window.S3D.view(v), j.view);
      await p.waitForTimeout(+(process.env.WAIT || 6000));
      await p.evaluate(f => window.S3D.focal(f), j.focal); await p.waitForTimeout(3000);
      await p.screenshot({ path: path.join(outDir, `${j.key}.png`), timeout: 300000 });
      const msgs = await p.evaluate(() => window.__m); const pick = t => msgs.filter(m => m.type === t).slice(-1)[0];
      const mo = pick('moments') || {}, heap = await p.evaluate(() => Math.round(window.__hp / 1048576));
      const res = { key: j.key, readyMs, foreMs, housesMs, wideMs, rssPeak: Math.round(rssPeak), heap, sun: { az: +sp.az.toFixed(1), alt: +sp.alt.toFixed(2) },
        fore: pick('foreground') || null, houses: pick('houses') || null, range: pick('range') || null, wide: pick('wideTrees') || null, state: pick('state') || null,
        moments: { firstSubject: hm(mo.firstSubject), firstHere: hm(mo.firstHere), lastHere: hm(mo.lastHere), lastSubject: hm(mo.lastSubject) },
        stages: msgs.filter(m => m.type === 'detail').map(m => m.stage + ':' + m.ms).join(' '), look: pick('look') || null, reqs, errs };
      all[j.key] = res; console.log(JSON.stringify(res));
    } catch (e) { console.log(j.key, 'FAILED', String(e).slice(0, 300)); }
    clearInterval(timer); await b.close();
  }
  fs.writeFileSync(path.join(outDir, `result${only ? '_' + only.replace(/,/g, '_') : ''}.json`), JSON.stringify(all, null, 1));
})();
