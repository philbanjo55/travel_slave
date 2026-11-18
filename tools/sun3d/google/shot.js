const { chromium } = require('playwright');
const jobs = JSON.parse(process.argv[2]);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 240)); }); p.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  await p.goto('http://127.0.0.1:8770/?err=' + (process.argv[3] || 20));
  await p.waitForFunction(() => window.__g || window.__err, null, { timeout: 120000 });
  for (const j of jobs) {
    await p.evaluate(j => window.__g.set(j), j);
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < (j.wait || 240) * 1000) { await p.waitForTimeout(3000); if (await p.evaluate(() => window.__ready)) { ok = true; break; } }
    console.log(j.name, ok ? 'ready' : 'TIMEOUT', Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(await p.evaluate(() => window.__stats)));
    await p.locator('#view').screenshot({ path: 'out_' + j.name + '.png' });
  }
  console.log('credits', await p.evaluate(() => window.__g.credits()));
  console.log('errors', [...new Set(errs)].slice(0, 6));
  await b.close();
})();
