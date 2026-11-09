// CI emulator test only. The workflow adds `import './e2e/fetchGuard';` as the
// first line of App.tsx in the throwaway build; the real app never imports it.
// It lets the app READ from Supabase and blocks every write, so an automated
// tap-through can't change Phil's trips, stops, photos, ticks or plans.
// Blocked calls are logged as "E2E_BLOCKED <method> <url> <action>" to logcat.

const SUPABASE_HOST = 'ohshrzlvvxyovcjmdajc.supabase.co';
// Read-only database functions the app calls with POST.
const READ_RPCS = new Set([
  'trip_sun_plan', 'sun_stop_pairs', 'sun_trip_shots', 'planner_t_trip', 'claude_spend_summary', 'planner_t_now_status',
]);
// Read-only solver-actions requests.
const READ_ACTIONS = new Set(['subject_grid', 'stop_settings', 'frames', 'planning_status', 'stop_curve', 'feeds']);

const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

function blocked(method: string, url: string, note: string): Response {
  console.warn(`E2E_BLOCKED ${method} ${url} ${note}`);
  return new Response(JSON.stringify({ ok: false, error: 'blocked by emulator test (read-only)' }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = (async (input: any, init?: any) => {
  const url: string = typeof input === 'string' ? input : input?.url ?? String(input);
  const method: string = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
  if (!url.includes(SUPABASE_HOST) || method === 'GET' || method === 'HEAD') return realFetch(input, init);
  const path = url.split(SUPABASE_HOST)[1] ?? '';
  const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
  if (rpc && READ_RPCS.has(rpc[1])) return realFetch(input, init);
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
    if (READ_ACTIONS.has(action)) return realFetch(input, init);
    return blocked(method, url, `action=${action}`);
  }
  return blocked(method, url, '');
}) as typeof fetch;

console.warn('E2E_GUARD installed: Supabase writes are blocked in this build');

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
