// Proof renderer, step 2: draws every view BEFORE and AFTER with headless Chromium (software GL) into out/<name>_<mode>.png.
//   node shot.js [name ...]        (all views of views.json when no name is given)
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg' };
(async () => {
  const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); const port = srv.address().port;
  const R2 = process.env.ROUND === '2'; const views = JSON.parse(fs.readFileSync(path.join(ROOT, 'views.json'))), want = process.argv.slice(2); fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  const b = await chromium.launch(); const W = 1500, H = 1200;
  for (const v of views) { if (want.length && !want.includes(v.name)) continue;
    for (const mode of (R2 ? ['r2'] : ['before', 'after'])) for (const f of (v.lenses || [v.lens])) {
      const p = await b.newPage({ viewport: { width: W, height: H } }); const t0 = Date.now();
      p.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
      await p.goto(`http://127.0.0.1:${port}/${R2 ? 'view2' : 'view'}.html?v=${v.name}&mode=${mode}&f=${f}&w=${W}&h=${H}`);
      await p.waitForFunction('window.__done || window.__err', null, { timeout: 600000 });
      const err = await p.evaluate('window.__err'); if (err) { console.log(v.name, mode, 'ERROR', err); await p.close(); continue; }
      const out = path.join(ROOT, 'out', `${v.name}_${mode}${f === v.lens ? '' : '_' + f}.png`);
      await p.locator('#view').screenshot({ path: out });
      console.log(v.name, mode, f + ' mm', ((Date.now() - t0) / 1000).toFixed(0) + ' s', mode !== 'before' ? 'buildings ' + await p.evaluate('window.__cells') : ''); await p.close(); } }
  await b.close(); srv.close();
})();
