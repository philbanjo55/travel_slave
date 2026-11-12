import { createClient } from 'jsr:@supabase/supabase-js@2';

// Door to Google's Photorealistic 3D Tiles for the app's "HD" 3D sun view
// (tools/sun3d/app_view_google.js). The app and its page never hold the
// Google key: they ask here, and this adds it. Nothing is stored here: every
// answer is passed straight through, with Google's own Cache-Control and ETag.
//
//   GET /tiles-proxy/health               -> { ok, enabled, draco, day_*, month_* }   (no Google call)
//   GET /tiles-proxy/v1/3dtiles/root.json -> Google's root tile set: the request Google bills.
//                                            Counted, and refused (429) at the daily or monthly cap.
//   GET /tiles-proxy/v1/3dtiles/...       -> any other tile file of a session a root request started
//
// Environment values (all but the first are optional):
//   GOOGLE_TILES_KEY    a Google Cloud key limited to the Map Tiles API. Without it: 503.
//   TILES_ENABLED       "true" = on. Anything else = OFF (the default): health says enabled false,
//                       so the app shows no HD button, and tile requests get 403.
//   TILES_TEST_TOKEN    while off, a request with header x-tiles-test: <this value> is still served,
//                       so the whole path can be tried before it is switched on. Unset = no way in.
//   TILES_MONTHLY_CAP   root requests per calendar month, US Pacific time (Google's billing month).
//                       Default 900: Google's free allowance is 1,000 a month, so this keeps it free.
//   TILES_DAILY_CAP     root requests per day (US Pacific). Default 30.
//   TILES_DRACO_URL     folder with three.js's DRACO decoder files (the page unpacks Google's tiles
//                       with them). Default: the public terrain bucket's draco/ folder.
// Table tiles_proxy_days + tiles_proxy_take_root / tiles_proxy_usage: 20261112070000_tiles_proxy.sql.
// If the count can't be taken (table missing, database down) nothing is asked of Google.
// Deploy with --no-verify-jwt: the page sends no headers, so the browser makes no extra
// preflight call per tile; the caps are what limit use (the repo and its app key are public).

const GOOGLE = 'https://tile.googleapis.com';
const MARK = '/v1/3dtiles/';
const DRACO_DEFAULT = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/draco/';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-tiles-test, if-none-match, if-modified-since',
  'Access-Control-Expose-Headers': 'ETag, Cache-Control',
  'Access-Control-Max-Age': '86400',
};
// Google's caching headers go to the caller exactly as Google sent them; the caller's revalidation headers go to Google.
const PASS_DOWN = ['content-type', 'cache-control', 'etag', 'expires', 'last-modified', 'age'];
const PASS_UP = ['if-none-match', 'if-modified-since'];

const whole = (v: string | undefined, d: number) => { const n = Math.floor(Number(v ?? d)); return Number.isFinite(n) && n >= 0 ? n : d; };

Deno.serve(async (req) => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);

  const url = new URL(req.url);
  const key = Deno.env.get('GOOGLE_TILES_KEY');
  const enabled = Deno.env.get('TILES_ENABLED') === 'true';
  const token = Deno.env.get('TILES_TEST_TOKEN') ?? '';
  const test = token.length > 0 && req.headers.get('x-tiles-test') === token;
  const draco = Deno.env.get('TILES_DRACO_URL') || DRACO_DEFAULT;
  const dayCap = whole(Deno.env.get('TILES_DAILY_CAP'), 30);
  const monthCap = whole(Deno.env.get('TILES_MONTHLY_CAP'), 900);
  const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    if (url.pathname.endsWith('/health')) {
      const { data, error } = await db().rpc('tiles_proxy_usage');
      if (error || !data) return json({ ok: false, enabled, test, set_up: !!key, error: 'the count is not readable' });
      const dayUsed = Number(data.day_used) || 0, monthUsed = Number(data.month_used) || 0;
      const dayLeft = Math.max(0, dayCap - dayUsed), monthLeft = Math.max(0, monthCap - monthUsed);
      return json({
        ok: (enabled || test) && !!key && dayLeft > 0 && monthLeft > 0,
        enabled, test, set_up: !!key, draco,
        day: data.day, day_cap: dayCap, day_used: dayUsed, day_left: dayLeft,
        month: data.month, month_cap: monthCap, month_used: monthUsed, month_left: monthLeft,
        counted_in: 'US Pacific time',
      });
    }

    const at = url.pathname.indexOf(MARK);
    const path = at < 0 ? '' : url.pathname.slice(at);
    if (!path || path.includes('..') || !/^\/v1\/3dtiles\/[A-Za-z0-9_\-./]+$/.test(path)) return json({ ok: false, error: 'not a tile address' }, 404);
    if (!enabled && !test) return json({ ok: false, error: 'HD is switched off (TILES_ENABLED is not "true")' }, 403);
    if (!key) return json({ ok: false, error: 'not set up: no Google key' }, 503);

    // Google's renderers add the session to addresses that already carry one: keep the last. Never pass a key on.
    const q = url.searchParams;
    q.delete('key');
    const sessions = q.getAll('session');
    q.delete('session');
    if (sessions.length) q.set('session', sessions[sessions.length - 1]);

    const isRoot = path === MARK + 'root.json';
    if (isRoot) {
      q.delete('session');
      const { data, error } = await db().rpc('tiles_proxy_take_root', { p_day_cap: dayCap, p_month_cap: monthCap });
      if (error || !data) return json({ ok: false, error: 'the count is not available' }, 503);
      if (data.ok !== true) {
        const month = data.reason === 'month';
        return json({
          ok: false, reason: month ? 'month' : 'day',
          error: month ? `monthly limit reached: ${monthCap} HD views a month (this keeps Google's tiles free)` : `daily limit reached: ${dayCap} HD views a day`,
          day_used: data.day_used, month_used: data.month_used,
        }, 429);
      }
    } else if (!q.get('session')) {
      return json({ ok: false, error: 'no session' }, 400);
    }

    const up: Record<string, string> = { 'X-Goog-Api-Key': key };
    for (const h of PASS_UP) { const v = req.headers.get(h); if (v) up[h] = v; }
    const qs = q.toString();
    const g = await fetch(GOOGLE + path + (qs ? '?' + qs : ''), { headers: up });
    const headers = new Headers(CORS);
    for (const h of PASS_DOWN) { const v = g.headers.get(h); if (v) headers.set(h, v); }
    return new Response(g.status === 304 ? null : g.body, { status: g.status, headers });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 502);
  }
});
