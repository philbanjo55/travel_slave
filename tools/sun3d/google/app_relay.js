// Test relay for the app's HD page (app_view_google.js). Like relay.js, but shaped like the real door
// (supabase/functions/tiles-proxy):
//   /functions/v1/tiles-proxy/v1/3dtiles/...  -> tile.googleapis.com (curl through the session proxy, which adds the key)
// with CORS, OPTIONS, counts at /stats (/reset), the DRACO files at /draco/ and the built page at /page.html.
//   WORK=<dir with node_modules (three) and room for cache/> PAGE=<built page.html> PORT=8771 node app_relay.js
// Tiles are kept in <WORK>/cache for the run only (the root for 2 hours: each fresh root is a billable request).
// Delete cache/ afterwards. BREAK=1 makes the door answer 503.
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const GT = path.resolve(process.env.WORK || '.'), CACHE = path.join(GT, 'cache'); fs.mkdirSync(CACHE, { recursive: true });
const PREFIX = '/functions/v1/tiles-proxy', PORT = +(process.env.PORT || 8771);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type, x-test', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' };
let rootReq = 0, n = 0, bytes = 0, roots = 0, hits = 0, hitBytes = 0, options = 0, xtest = 0, served = 0, servedBytes = 0, fails = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/stats') { res.writeHead(200, CORS); res.end(JSON.stringify({ rootReq, fresh: n, freshBytes: bytes, roots, cacheHits: hits, cacheBytes: hitBytes, served, servedBytes, options, xtest, fails })); return; }
  if (u.pathname === '/reset') { served = servedBytes = options = xtest = 0; res.writeHead(200, CORS); res.end('ok'); return; }
  if (req.method === 'OPTIONS') { options++; res.writeHead(204, CORS); return res.end(); }
  if (u.pathname.startsWith(PREFIX + '/v1/3dtiles/')) {
    if (process.env.BREAK) { res.writeHead(503, CORS); return res.end('down'); }
    if (req.headers['x-test']) xtest++;
    const p = u.pathname.slice(PREFIX.length);
    u.searchParams.delete('key');
    const ss = u.searchParams.getAll('session'); if (ss.length > 1) { u.searchParams.delete('session'); u.searchParams.set('session', ss[ss.length - 1]); }
    const isRoot = p.endsWith("root.json"); if (isRoot) rootReq++; const f = path.join(CACHE, crypto.createHash('sha1').update(p).digest('hex'));
    const send = b => { served++; servedBytes += b.length; res.writeHead(200, { ...CORS, 'content-type': p.endsWith('.json') ? 'application/json' : 'model/gltf-binary' }); res.end(b); };
    if (fs.existsSync(f) && (!isRoot || Date.now() - fs.statSync(f).mtimeMs < 2 * 3600e3)) { const b = fs.readFileSync(f); hits++; hitBytes += b.length; return send(b); }
    const q = u.searchParams.toString();
    const c = spawn('curl', ['-sS', '-m', '90', '--fail-with-body', 'https://tile.googleapis.com' + p + (q ? '?' + q : '')]); const chunks = [];
    c.stdout.on('data', d => chunks.push(d));
    c.on('close', code => { const b = Buffer.concat(chunks); if (code !== 0) { fails++; console.error('FAIL', code, p.slice(0, 80), b.slice(0, 160).toString().replace(/\s+/g, ' ')); res.writeHead(502, CORS); return res.end(b); } n++; bytes += b.length; if (isRoot) { roots++; console.log('FRESH ROOT', roots, new Date().toISOString()); } fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, b); send(b); });
    return;
  }
  let file = null;
  if (u.pathname.startsWith('/draco/')) file = path.join(GT, 'node_modules/three/examples/jsm/libs/draco/gltf', path.basename(u.pathname));
  else if (u.pathname === '/page.html') file = path.resolve(process.env.PAGE || 'page.html');
  if (!file || !fs.existsSync(file)) { res.writeHead(404, CORS); return res.end('no'); }
  res.writeHead(200, { ...CORS, 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
}).listen(PORT, () => console.log('relay on', PORT));
