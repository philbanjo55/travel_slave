// CI emulator test only. The workflow adds `import './e2e/fetchGuard';` as the
// first line of App.tsx in the throwaway build; the real app never imports it.
// It lets the app READ from Supabase and blocks every write, so an automated
// tap-through can't change Phil's trips, stops, photos, ticks or plans.
// Blocked calls are logged as "E2E_BLOCKED <method> <url> <action>" to logcat.

const SUPABASE_HOST = 'ohshrzlvvxyovcjmdajc.supabase.co';
// Read-only database functions the app calls with POST.
const READ_RPCS = new Set([
  'trip_sun_plan', 'sun_stop_pairs', 'sun_trip_shots', 'planner_t_trip', 'claude_spend_summary',
]);
// Read-only solver-actions requests.
const READ_ACTIONS = new Set(['subject_grid', 'stop_settings', 'frames', 'planning_status', 'stop_curve']);

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
    if (READ_ACTIONS.has(action)) return realFetch(input, init);
    return blocked(method, url, `action=${action}`);
  }
  return blocked(method, url, '');
}) as typeof fetch;

console.warn('E2E_GUARD installed: Supabase writes are blocked in this build');
