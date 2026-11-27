// CI emulator test only. The workflow adds `import './e2e/fetchGuard';` as the
// first line of App.tsx in the throwaway build; the real app never imports it.
// It lets the app READ from Supabase and blocks every write, so an automated
// tap-through can't change Phil's trips, stops, photos, ticks or plans.
// Blocked calls are logged as "E2E_BLOCKED <method> <url> <action>" to logcat.

const SUPABASE_HOST = 'ohshrzlvvxyovcjmdajc.supabase.co';
// Read-only database functions the app calls with POST.
const READ_RPCS = new Set([
  'planner_t_replan_mode', 'trip_sun_plan', 'sun_stop_pairs', 'sun_trip_shots', 'planner_t_trip', 'claude_spend_summary', 'planner_t_now_status', 'training_stop_photos',
]);
// Read-only solver-actions requests.
const READ_ACTIONS = new Set(['subject_grid', 'stop_settings', 'frames', 'planning_status', 'stop_curve', 'feeds']);

const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

// ── The test robot trip (27 Nov 2026) ───────────────────────────────────────
// Trip 7e57bed0-...-0004 is the planner test's own practice copy: on it the test really accepts, re-plans and saves
// notes (Teton Live, Phil's mock week, stays read-only). A write is let through when its body names that trip, or an
// id this build has seen belong to it (its stops, days, plans and notes, learned from the app's own reads).
const ROBOT = '7e57bed0-0000-4000-8000-000000000004';
const robotIds = new Set<string>([ROBOT]);
function learn(j: any, depth = 0) {
  if (!j || depth > 4) return;
  if (Array.isArray(j)) { for (const x of j) learn(x, depth + 1); return; }
  if (typeof j !== 'object') return;
  if (j.trip_id === ROBOT && j.id != null) robotIds.add(String(j.id));
  for (const k of ['stops', 'days', 'note', 'notes', 'runs', 'plans', 'data']) if (j[k]) learn(j[k], depth + 1);
}
function forRobot(url: string, body: any): boolean {
  const b = body && typeof body === 'object' ? body : {};
  for (const k of ['trip_id', 'p_trip', 'trip', 'tripId']) if (b[k] === ROBOT) return true;
  for (const k of ['id', 'stop_id', 'p_stop', 'run_id', 'note_id', 'day_id']) if (b[k] != null && robotIds.has(String(b[k]))) return true;
  const m = url.match(/[?&](?:id|stop_id|trip_id)=eq\.([0-9a-f-]+)/i);
  return !!m && robotIds.has(m[1]);
}

// ── Faults on request (the test asks with RPC e2e_fault(kind, match, secs); table e2e_faults) ──────────────────
type Fault = { kind: 'error' | 'timeout' | 'offline' | 'slow'; match: string; until: string };
let faults: Fault[] = [];
const KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2';
async function pollFaults() {
  try {
    const r = await realFetch(`https://${SUPABASE_HOST}/rest/v1/e2e_faults?select=kind,match,until&until=gt.${encodeURIComponent(new Date().toISOString())}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    const j = await r.json();
    const next: Fault[] = Array.isArray(j) ? j : [];
    if (JSON.stringify(next) !== JSON.stringify(faults)) console.warn(`E2E_FAULTS now ${JSON.stringify(next.map(f => `${f.kind}:${f.match}`))}`);
    faults = next;
  } catch { /* keep the last list */ }
}
setInterval(pollFaults, 2000);
function faultFor(url: string, bodyText: string): Fault | null {
  const now = Date.now();
  if (url.includes('/rest/v1/e2e_faults')) return null;
  return faults.find(f => Date.parse(f.until) > now && (url.includes(f.match) || bodyText.includes(`"${f.match}"`))) ?? null;
}
async function applyFault(f: Fault, input: any, init: any, method: string, url: string): Promise<Response> {
  console.warn(`E2E_FAULT ${f.kind} ${method} ${url.split(SUPABASE_HOST)[1] ?? url}`);
  if (f.kind === 'offline') throw new TypeError('Network request failed');
  if (f.kind === 'error') return new Response(JSON.stringify({ ok: false, error: 'test fault: server error', message: 'test fault: server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const signal: AbortSignal | undefined = init?.signal;
  if (f.kind === 'timeout') {
    return new Promise<Response>((_, rej) => {
      const t = setTimeout(() => rej(new TypeError('Network request timed out')), 90_000);
      signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })); });
    });
  }
  await new Promise(r => setTimeout(r, 8000));   // slow
  return guarded(input, init, true);
}

function blocked(method: string, url: string, note: string): Response {
  console.warn(`E2E_BLOCKED ${method} ${url} ${note}`);
  return new Response(JSON.stringify({ ok: false, error: 'blocked by emulator test (read-only)' }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  });
}

async function readAndLearn(input: any, init: any): Promise<Response> {
  const r = await realFetch(input, init);
  try { if (r.ok) learn(await r.clone().json()); } catch { /* not JSON */ }
  return r;
}

async function guarded(input: any, init: any, faultDone = false): Promise<Response> {
  const url: string = typeof input === 'string' ? input : input?.url ?? String(input);
  const method: string = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
  if (!url.includes(SUPABASE_HOST)) return realFetch(input, init);
  const bodyText = typeof init?.body === 'string' ? init.body : '';
  const f = faultDone ? null : faultFor(url, bodyText);
  if (f) return applyFault(f, input, init, method, url);
  if (method === 'GET' || method === 'HEAD') return readAndLearn(input, init);
  const path = url.split(SUPABASE_HOST)[1] ?? '';
  let body: any = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { /* not JSON */ }
  // the app's own log lines: kept, marked e2e so they are never read as Phil's taps
  if (path.startsWith('/rest/v1/app_logs')) {
    const mark = (x: any) => (x && typeof x === 'object' ? { ...x, data: { ...(x.data ?? {}), e2e: true } } : x);
    const nb = Array.isArray(body) ? body.map(mark) : mark(body);
    return realFetch(input, { ...init, body: JSON.stringify(nb) });
  }
  if (forRobot(url, body)) {
    console.warn(`E2E_ROBOT ${method} ${path.slice(0, 80)} ${body?.action ?? ''}`);
    return readAndLearn(input, init);
  }
  const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
  if (rpc && READ_RPCS.has(rpc[1])) return readAndLearn(input, init);
  // Tell T (11 Nov 2026): the box shows only where notes are switched on. This test build says "on" for every trip so
  // the screens can be tapped through; nothing can be stored (reads are forced dry, every other notes call is blocked).
  if (rpc && rpc[1] === 'planner_t_tell') {
    console.warn('E2E_TELL on (test build only)');
    return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (path.startsWith('/functions/v1/t-notes')) {
    let b: any = {};
    try { b = JSON.parse(String(init?.body ?? '{}')); } catch { /* unreadable body: block */ }
    if (b.action === 'read') {
      const r = await realFetch(input, { ...init, body: JSON.stringify({ ...b, dry: true }) });
      try {
        const j = await r.clone().json();
        console.warn(`E2E_TELL read ok=${j.ok} status=${j.note?.status} say=${JSON.stringify((j.note?.say ?? []).map((l: any) => l.text))} answer=${JSON.stringify(j.note?.answer?.lines ?? null)} err=${j.error ?? ''}`);
      } catch (e) { console.warn(`E2E_TELL unreadable ${String(e)}`); }
      return r;
    }
    return blocked(method, url, `t-notes action=${b.action ?? ''}`);
  }
  // Find spot (16 Nov 2026): status reads are real; a new request is answered here with a made-up open job (nothing
  // is asked of Claude or GitHub), whose status stays 'looking', so the progress card can be checked.
  if (path.startsWith('/functions/v1/photo-spot')) {
    let b: any = {};
    try { b = JSON.parse(String(init?.body ?? '{}')); } catch { /* unreadable body: block */ }
    const fake = (photo: string, stop: string) => ({ id: `e2e-${photo}`, stop_id: stop, photo_id: photo, photo_url: null, status: 'looking', note: 'looking at the photo',
      error: null, result: null, shots: {}, overlay_url: null, created_at: new Date(Date.now() - 30000).toISOString(), updated_at: new Date().toISOString() });
    const ok = (job: any) => new Response(JSON.stringify({ ok: true, job }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (b.action === 'request') { console.warn(`E2E_SPOT request photo=${b.photo_id} (made-up job, nothing started)`); return ok(fake(b.photo_id, b.stop_id)); }
    if (b.action === 'status' && String(b.job_id ?? '').startsWith('e2e-')) return ok(fake(String(b.job_id).slice(4), ''));
    if (b.action === 'status') {
      const r = await realFetch(input, init);
      try { const j = await r.clone().json(); console.warn(`E2E_SPOT status ${b.job_id ?? b.photo_id} -> ${j.job?.status ?? 'none'} ok=${j.job?.result?.ok ?? ''}`); } catch { /* ignore */ }
      return r;
    }
    return blocked(method, url, `photo-spot action=${b.action ?? ''}`);
  }
  if (path.startsWith('/functions/v1/solver-actions')) {
    let action = '';
    try { action = JSON.parse(String(init?.body ?? '{}')).action ?? ''; } catch { /* unreadable body: block */ }
    if (action === 'feeds') {
      // Feeds page test: print what the app got for each camera, so the job log shows it.
      const r = await realFetch(input, init);
      try {
        const j = await r.clone().json();
        for (const c of j.cameras ?? []) {
          console.warn(`E2E_FEEDS cam ${c.code} status=${c.status} live_url=${c.live_url} live_time=${c.live_time} src=${c.live_source_time} last=${c.last_checked} taken=${c.frame?.taken_at} stale=${c.stale_reason}`);
        }
        for (const s of j.stations ?? []) console.warn(`E2E_FEEDS station ${s.icao} hr=${s.obs?.hr} ceiling=${s.obs?.ceiling_ft} hidden=${s.peaks_hidden}`);
        console.warn(`E2E_FEEDS updated ${JSON.stringify(j.updated)}`);
      } catch (e) { console.warn(`E2E_FEEDS unreadable ${String(e)}`); }
      return r;
    }
    if (READ_ACTIONS.has(action)) return readAndLearn(input, init);
    return blocked(method, url, `action=${action}`);
  }
  return blocked(method, url, '');
}

globalThis.fetch = ((input: any, init?: any) => guarded(input, init)) as typeof fetch;

console.warn('E2E_GUARD installed: Supabase writes are blocked in this build, except on the test robot trip');
pollFaults();

// Trip-jump test: log every change of the trip held in memory (the one the trip, day,
// planner and stop screens draw), so the job log shows which trip's data landed and when.
// Required lazily, after the fetch patch above, so the Supabase client is made with the guard.
setTimeout(() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useTripStore } = require('../src/store/tripStore');
    let last: string | null | undefined;
    const say = (s: any) => {
      const t = s.currentTripData?.trip;
      const key = t ? `${t.id}` : null;
      if (key === last) return;
      last = key;
      console.warn(`E2E_TRIP ${Date.now()} ${t ? t.title : '(none)'} days=${s.currentTripData?.days?.length ?? 0}`);
    };
    say(useTripStore.getState());
    useTripStore.subscribe(say);
  } catch (e) { console.warn(`E2E_TRIP unavailable ${String(e)}`); }
}, 0);
