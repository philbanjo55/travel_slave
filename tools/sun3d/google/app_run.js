// Drives the built HD page the way the app does (fake ReactNativeWebView, base64 chunks, S3D calls) and saves
// a picture per job. Needs app_relay.js running, playwright, and the Teton elevation file (build_dem.py).
//   PAGE=<built page.html> DEM=<teton-dem.png> OUT=<dir> node app_run.js '<json opts>'
//   opts: { w, h, dpr, err, origin: 'file' | 'relay', headers, tiles, base, handRoot, probe, path, ground, noStats,
//           jobs: [{ name, az, alt, focal?, size?: [w, h], view?: [eyeLat, eyeLng, targetLat, targetLng], wait? }] }
//   base = another door than the relay's, e.g. the deployed function; with headers {"x-tiles-test": "<token>"}
//   it can be tried while switched off. handRoot = fetch the root first and hand it to the page, as the app does.
// e.g. '{"path":true,"jobs":[{"name":"a_sro_1000","az":145.6,"alt":15.35},{"name":"b_sro_0815","az":125,"alt":2.3}]}'
const { chromium } = require('playwright'); const fs = require('fs');
const o = Object.assign({ w: 400, h: 240, dpr: 2, err: 0, origin: 'file', port: 8771, tag: '' }, JSON.parse(process.argv[2] || '{}'));
const path0 = require('path'), PAGE = path0.resolve(process.env.PAGE || 'page.html'), DEM = path0.resolve(process.env.DEM || 'teton-dem.png'), OUT = path0.resolve(process.env.OUT || '.');
const RELAY = 'http://127.0.0.1:' + o.port, BASE = o.base || RELAY + '/functions/v1/tiles-proxy';
const stats = async () => JSON.parse(await (await fetch(RELAY + '/stats')).text());
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.addInitScript(() => { window.__m = []; window.ReactNativeWebView = { postMessage: s => window.__m.push(JSON.parse(s)) }; });
  await p.goto(o.origin === 'relay' ? RELAY + '/page.html' : 'file://' + PAGE);
  const b64 = fs.readFileSync(DEM).toString('base64');
  const s0 = o.noStats ? null : await stats(), t0 = Date.now();
  let handed = null;
  if (o.handRoot) {
    const r = await fetch(BASE + '/v1/3dtiles/root.json', { headers: o.headers || {} }); handed = await r.text();
    console.log('root:', r.status, 'cache-control:', r.headers.get('cache-control'), '| etag:', r.headers.get('etag'), '| bytes', handed.length);
    if (o.probe) {   // one tile file: Google's caching headers as the door hands them on, then a revalidation
      let uri = null; (function w(t) { if (uri) return; if (t.content && t.content.uri) { uri = t.content.uri; return; } (t.children || []).forEach(w); })(JSON.parse(handed).root);
      const t1 = await fetch(BASE + uri, { headers: o.headers || {} }); const n = (await t1.arrayBuffer()).byteLength, tag = t1.headers.get('etag');
      console.log('tile:', t1.status, 'cache-control:', t1.headers.get('cache-control'), '| etag:', tag, '| bytes', n);
      const t2 = await fetch(BASE + uri, { headers: Object.assign({ 'if-none-match': tag || '' }, o.headers || {}) });
      console.log('same tile with if-none-match:', t2.status, 'bytes', (await t2.arrayBuffer()).byteLength, '| etag:', t2.headers.get('etag'));
    }
  }
  await p.evaluate(c => window.S3D.init(c), { n: 2048, north: 43.95, south: 43.45, west: -110.92, east: -110.24, W: 54727, D: 55566, base: 1500, step: 0.5, ground: o.ground || 'snow', eye: { lat: 43.7537, lng: -110.6241 }, target: { lat: 43.7411, lng: -110.8024 }, focal: 50,
    tiles: Object.assign(handed ? { root: handed } : {}, { base: BASE, draco: RELAY + '/draco/', errorTarget: o.err || undefined, headers: o.headers }, o.tiles || {}) });
  for (let i = 0; i < b64.length; i += 240000) await p.evaluate(s => window.S3D.chunk(s), b64.slice(i, i + 240000));
  await p.evaluate(() => window.S3D.done());
  const settle = async (name, max) => {
    const t = Date.now(); let last = null;
    while (Date.now() - t < max * 1000) {
      await p.waitForTimeout(1500);
      const m = await p.evaluate(() => window.__m);
      if (m.some(x => x.type === 'error')) return 'ERROR';
      last = m.filter(x => x.type === 'hd').pop();
      if (last && last.shown && !last.loading && Date.now() - t > 4000) return 'settled ' + Math.round((Date.now() - t) / 1000) + 's ' + JSON.stringify(last);
    }
    return 'TIMEOUT ' + JSON.stringify(last);
  };
  for (const j of o.jobs || []) {
    if (j.size) { await p.setViewportSize({ width: j.size[0], height: j.size[1] }); await p.waitForTimeout(300); }
    await p.evaluate(j => { if (j.view) window.S3D.view(...j.view); if (j.focal) window.S3D.focal(j.focal); window.S3D.sun(j.az, j.alt); }, j);
    const r = await settle(j.name, j.wait || 240);
    await p.screenshot({ path: OUT + '/' + j.name + '.png' });
    console.log(j.name, r, o.noStats ? '' : JSON.stringify(await stats()));
    if (r === 'ERROR') break;
  }
  if (o.path) { const path = []; for (let m = 420; m <= 1050; m += 4) { const f = (m - 478) / (1013 - 478); path.push([m, 122 + f * 116, Math.max(-5, 23.2 * Math.sin(Math.PI * f))]); } await p.evaluate(a => window.S3D.path(a), path); }
  const msgs = await p.evaluate(() => window.__m);
  const seen = {}; for (const m of msgs) seen[m.type] = m;
  console.log('last of each message:', JSON.stringify(seen));
  if (s0) { const s1 = await stats(); console.log('this run: files', s1.served - s0.served, 'MB', ((s1.servedBytes - s0.servedBytes) / 1e6).toFixed(1), 'fresh roots total', s1.roots, 'preflights', s1.options - s0.options, 'x-test seen', s1.xtest - s0.xtest, 'secs', Math.round((Date.now() - t0) / 1000)); }
  console.log('errors', [...new Set(errs)].slice(0, 8));
  await b.close();
})();
