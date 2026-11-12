import { createClient } from 'jsr:@supabase/supabase-js@2';

// Door to Google's Photorealistic 3D Tiles for the app's "HD" 3D sun view
// (tools/sun3d/app_view_google.js). The app and its page never hold the
// Google key: they ask here, and this adds it.
//   GET /tiles-proxy/health               -> { ok, draco, cap, used, left }   (no Google call; the app shows
//                                            its HD button only when ok, and hands `draco` to the page)
//   GET /tiles-proxy/v1/3dtiles/root.json -> Google's root tile set. This is the request Google bills,
//                                            so each one is counted and refused (429) over the day's cap.
//   GET /tiles-proxy/v1/3dtiles/...       -> any other tile file of a session a root request started
// Secrets: GOOGLE_TILES_KEY (a Google Cloud key limited to the Map Tiles API),
// TILES_DRACO_URL (public folder holding three.js's DRACO decoder files: draco_wasm_wrapper.js,
// draco_decoder.wasm, draco_decoder.js; Google's tiles are DRACO-packed and the page unpacks them),
// TILES_DAILY_CAP (root requests a UTC day, default 60).
// Table tiles_proxy_days + tiles_proxy_take_root(cap): 20261112070000_tiles_proxy.sql.
// If the count can't be taken (table missing, database down) nothing is asked of Google.
// Deploy with --no-verify-jwt: the page sends no headers, so the browser makes no extra
// preflight call per tile; the cap is what limits use (the repo and its app key are public).

const GOOGLE = 'https://tile.googleapis.com';
const MARK = '/v1/3dtiles/';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Max-Age': '86400',
};

Deno.serve(async (req) => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);

  const url = new URL(req.url);
  const key = Deno.env.get('GOOGLE_TILES_KEY');
  const draco = Deno.env.get('TILES_DRACO_URL') ?? null;
  const cap = Math.max(0, Math.floor(Number(Deno.env.get('TILES_DAILY_CAP') ?? 60)) || 0);
  const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    if (url.pathname.endsWith('/health')) {
      const day = new Date().toISOString().slice(0, 10);
      const { data, error } = await db().from('tiles_proxy_days').select('roots').eq('day', day).maybeSingle();
      if (error) return json({ ok: false, error: 'the count is not readable' });
      const used = data?.roots ?? 0, left = Math.max(0, cap - used);
      return json({ ok: !!key && !!draco && left > 0, set_up: !!key && !!draco, draco, cap, used, left });
    }

    const at = url.pathname.indexOf(MARK);
    const path = at < 0 ? '' : url.pathname.slice(at);
    if (!path || path.includes('..') || !/^\/v1\/3dtiles\/[A-Za-z0-9_\-./]+$/.test(path)) return json({ ok: false, error: 'not a tile address' }, 404);
    if (!key) return json({ ok: false, error: 'not set up' }, 503);

    // Google's renderers add the session to addresses that already carry one: keep the last. Never pass a key on.
    const q = url.searchParams;
    q.delete('key');
    const sessions = q.getAll('session');
    q.delete('session');
    if (sessions.length) q.set('session', sessions[sessions.length - 1]);

    const isRoot = path === MARK + 'root.json';
    if (isRoot) {
      q.delete('session');
      const { data, error } = await db().rpc('tiles_proxy_take_root', { p_cap: cap });
      if (error) return json({ ok: false, error: 'the count is not available' }, 503);
      if (data !== true) return json({ ok: false, error: 'daily limit reached', cap }, 429);
    } else if (!q.get('session')) {
      return json({ ok: false, error: 'no session' }, 400);
    }

    const qs = q.toString();
    const g = await fetch(GOOGLE + path + (qs ? '?' + qs : ''), { headers: { 'X-Goog-Api-Key': key } });
    const headers: Record<string, string> = { ...CORS, 'Content-Type': g.headers.get('content-type') ?? 'application/octet-stream' };
    // Tiles keep Google's own caching rule (private, a few hours); the root is never kept by the web view.
    headers['Cache-Control'] = isRoot || !g.ok ? 'no-store' : (g.headers.get('cache-control') ?? 'no-store');
    return new Response(g.body, { status: g.status, headers });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 502);
  }
});
