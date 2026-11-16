// Place day windows test (16 Nov 2026): serve a solver-replay index.ts locally with every database WRITE kept in memory.
// A bench run lives only here: replay_runs / replay_run_state / replay_run_days / replay_live_today rows for the mock run
// ids are held in this process; every other table is read from the real project (reads only). Writes to any other
// table, unknown RPCs and calls back to the edge function are refused and listed (GET /__mock/dump -> blocked).
//   SR_PORT=8101 SR_FILE=<path to index.ts> SUPABASE_URL=https://ohshrzlvvxyovcjmdajc.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=placeholder deno run -A --no-lock --node-modules-dir=none tools/place_windows/mock_serve.ts
// Control: POST /__mock/reset {runs: [row], states: [row]}; GET /__mock/dump.
const port = Number(Deno.env.get('SR_PORT') ?? 8000);
const SB = Deno.env.get('SUPABASE_URL')!;
const MOCKED = new Set(['replay_runs', 'replay_run_state', 'replay_run_days', 'replay_live_today']);
const READ_RPC = new Set(['solver_light_terms', 'replay_clim_hidden', 'replay_early_at', 't_truth']);
const KEYS: Record<string, string[]> = { replay_runs: ['id'], replay_run_state: ['run_id', 'kind'], replay_run_days: ['run_id', 'night', 'kind'],
  replay_live_today: ['run_id', 'kind', 'replay_date'] };
let tables: Record<string, any[]> = {};
let blocked: any[] = [];
const reset = () => { tables = { replay_runs: [], replay_run_state: [], replay_run_days: [], replay_live_today: [] }; blocked = []; };
reset();
const mockRunIds = () => new Set(tables.replay_runs.map(r => String(r.id)));

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const match = (row: any, params: URLSearchParams) => {
  for (const [k, v] of params) {
    if (SKIP.has(k)) continue;
    const m = /^(not\.)?(eq|in|is)\.(.*)$/.exec(v);
    if (!m) throw new Error(`mock: filter ${k}=${v} not handled`);
    const [, neg, op, arg] = m;
    const cell = row[k];
    let ok: boolean;
    if (op === 'eq') ok = String(cell) === arg;
    else if (op === 'is') ok = arg === 'null' ? cell == null : String(cell) === arg;
    else ok = arg.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(cell));
    if (neg ? ok : !ok) return false;
  }
  return true;
};
const reply = (body: any, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const shape = (rows: any[], accept: string) => {
  if (accept.includes('vnd.pgrst.object')) return rows.length === 1 ? reply(rows[0]) : reply({ code: 'PGRST116', message: `mock: ${rows.length} rows` }, 406);
  return reply(rows);
};

const realFetch = globalThis.fetch.bind(globalThis);
// Light geometry for dates whose light cache was pruned (old bench dates): solver_light_terms answers nothing, so the
// same rows are computed read-only from vantage_light through the Management API (the network secret adds the token),
// as tools/one_pass/light_sql.py does (checked byte-identical to the cache path there). Kept per (trip, date).
const LIGHT = new Map<string, any[]>();
const lightSql = (trip: string, date: string) => `with z as (select solver_trip_tz('${trip}') tz)
select i.stop_id, to_json(x.slot_at)#>>'{}' slot_at,
       solver_light_dir(x.light, x.sun_alt, x.sun_visible, coalesce(i.light_wanted, '{front,side}')) dir,
       solver_light_soft(x.sun_alt, coalesce(i.light_wanted, '{front,side}')) soft,
       x.light = 'no sun' blue, i.fog_wanted
  from z, solver_stop_inputs i
  cross join lateral (select distinct on (l.local_time) (l.local_time at time zone z.tz) slot_at, l.sun_altitude::real sun_alt, l.light, l.sun_visible_from_vantage sun_visible
                        from vantage_light(i.star_vantage_id, '${date}'::date, 15, z.tz) l order by l.local_time) x
 where i.trip_id = '${trip}' and i.tier is not null and i.star_vantage_id is not null and x.sun_alt > -6
 order by x.slot_at, i.stop_id`;
const lightTerms = async (req: Request, url: URL) => {
  const body = await req.clone().json();
  const trip = String(body.p_trip_id), dates = (body.p_dates ?? []) as string[];
  const off = Number(url.searchParams.get('offset') ?? 0), lim = Number(url.searchParams.get('limit') ?? 1e9);
  const key = `${trip}|${dates.join(',')}`;
  const file = dates.length === 1 ? `${Deno.env.get('LIGHT_DIR') ?? 'light'}/${trip}_${dates[0]}.json` : '';
  if (!LIGHT.has(key) && file) { try { LIGHT.set(key, JSON.parse(await Deno.readTextFile(file))); } catch { /* not fetched ahead */ } }
  if (!LIGHT.has(key)) {
    const u2 = new URL(url.href); u2.searchParams.delete('offset'); u2.searchParams.delete('limit');
    const h2 = new Headers(req.headers); h2.delete('range'); h2.delete('range-unit');
    const r = await realFetch(new Request(u2.href, { method: 'POST', headers: h2, body: JSON.stringify(body) }));
    let rows: any[] = r.ok ? await r.json() : [];
    if (!rows.length && dates.length === 1 && /^[0-9a-f-]{36}$/.test(trip) && /^\d{4}-\d{2}-\d{2}$/.test(dates[0])) {
      for (let k = 0; k < 3 && !rows.length; k++) {
        const q = await realFetch('https://api.supabase.com/v1/projects/ohshrzlvvxyovcjmdajc/database/query', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `select coalesce(json_agg(t), '[]'::json) j from (${lightSql(trip, dates[0])}) t` }) });
        const j = q.ok ? await q.json() : null;
        rows = Array.isArray(j) ? (j[0]?.j ?? []) : [];
      }
      console.log('light computed', trip.slice(0, 8), dates[0], rows.length);
    }
    if (rows.length) LIGHT.set(key, rows); else return reply([]);
  }
  return reply(LIGHT.get(key)!.slice(off, off + lim));
};
globalThis.fetch = async (input: any, init?: any) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.href.startsWith(SB + '/functions/')) { blocked.push({ fn: url.pathname }); return reply({ ok: false, blocked: true }, 403); }
  if (!url.href.startsWith(SB + '/rest/v1/')) return realFetch(req);
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const method = req.method.toUpperCase();
  const accept = req.headers.get('accept') ?? '';
  const prefer = req.headers.get('prefer') ?? '';
  if (path.startsWith('rpc/')) {
    const fn = path.slice(4);
    if (fn === 'solver_light_terms') return lightTerms(req, url);
    if (READ_RPC.has(fn)) return realFetch(req);
    blocked.push({ rpc: fn, body: await req.text() });
    return reply(null);
  }
  const table = path.split('?')[0];
  const isMock = MOCKED.has(table) && (table !== 'replay_runs' || method !== 'GET' || [...url.searchParams].some(([k, v]) => k === 'id' && mockRunIds().has(v.replace(/^eq\./, ''))));
  if (method === 'GET' || method === 'HEAD') {
    if (!isMock) return realFetch(req);
    return shape(tables[table].filter(r => match(r, url.searchParams)), accept);
  }
  if (!MOCKED.has(table)) { blocked.push({ table, method, body: (await req.text()).slice(0, 500) }); return reply(accept.includes('vnd.pgrst.object') ? {} : [], 201); }
  const ret = prefer.includes('return=representation');
  if (method === 'PATCH') {
    const patch = await req.json();
    const rows = tables[table].filter(r => match(r, url.searchParams));
    for (const r of rows) Object.assign(r, structuredClone(patch));
    return ret ? shape(rows, accept) : reply(undefined, 204);
  }
  if (method === 'POST') {
    let body = await req.json();
    if (!Array.isArray(body)) body = [body];
    const keys = KEYS[table];
    const out: any[] = [];
    for (const b of body) {
      const i = tables[table].findIndex(r => keys.every(k => String(r[k]) === String(b[k])));
      if (i >= 0 && prefer.includes('resolution=merge-duplicates')) Object.assign(tables[table][i], structuredClone(b));
      else if (i >= 0) return reply({ code: '23505', message: 'mock: duplicate' }, 409);
      else tables[table].push(structuredClone(b));
      out.push(b);
    }
    return ret ? shape(out, accept) : reply(undefined, 201);
  }
  blocked.push({ table, method });
  return reply(undefined, 204);
};

const orig = Deno.serve.bind(Deno);
(Deno as any).serve = (h: any) => orig({ port, hostname: '127.0.0.1', onListen: () => console.log('listening', port) }, async (req: Request, info: any) => {
  const u = new URL(req.url);
  if (u.pathname === '/__mock/reset') {
    reset();
    const b = await req.json();
    tables.replay_runs = structuredClone(b.runs ?? []);
    tables.replay_run_state = structuredClone(b.states ?? []);
    return reply({ ok: true });
  }
  if (u.pathname === '/__mock/dump') return reply({ ...tables, blocked });
  if (u.pathname === '/__mock/run') { const b = await req.json(); for (const r of tables.replay_runs) Object.assign(r, b); return reply({ ok: true }); }
  return h(req, info);
});
await import(Deno.env.get('SR_FILE')!);
