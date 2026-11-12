// Local test relay: the page talks to this server; requests under /v1/ go on to Google's tile host
// through the session's proxy, which adds the saved key. Tiles are kept on disk only for the test run.
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = __dirname, CACHE = path.join(ROOT, 'cache'); fs.mkdirSync(CACHE, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
let n = 0, bytes = 0, roots = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/stats') { res.end(JSON.stringify({ n, bytes, roots })); return; }
  if (u.pathname.startsWith('/v1/')) {
    u.searchParams.delete('key');
    const ss = u.searchParams.getAll('session'); if (ss.length > 1) { u.searchParams.delete('session'); u.searchParams.set('session', ss[ss.length - 1]); }
    const isRoot = u.pathname.endsWith('root.json'), f = path.join(CACHE, crypto.createHash('sha1').update(u.pathname).digest('hex'));
    const send = b => { res.writeHead(200, { 'content-type': u.pathname.endsWith('.json') ? 'application/json' : 'model/gltf-binary' }); res.end(b); };
    if (fs.existsSync(f) && (!isRoot || Date.now() - fs.statSync(f).mtimeMs < 2 * 3600e3)) return send(fs.readFileSync(f));
    const c = spawn('curl', ['-sS', '-m', '90', '--fail-with-body', 'https://tile.googleapis.com' + u.pathname + u.search]); const chunks = [];
    c.stdout.on('data', d => chunks.push(d));
    c.on('close', code => { const b = Buffer.concat(chunks); if (code !== 0) { console.error('FAIL', code, u.pathname.slice(0, 80), b.slice(0, 160).toString().replace(/\s+/g, ' ')); res.writeHead(502); return res.end(b); } n++; bytes += b.length; if (isRoot) roots++; fs.writeFileSync(f, b); send(b); });
    return;
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname, file;
  if (p.startsWith('/draco/')) file = path.join(ROOT, 'node_modules/three/examples/jsm/libs/draco/gltf', p.slice(7));
  else if (p === '/teton-dem.png') file = path.join(ROOT, '../site/teton-dem.png');
  else file = path.join(ROOT, 'dist', p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
}).listen(8770, () => console.log('relay on 8770'));
