// Local bench runner (C6, 9 Nov 2026). Runs planner bench steps in this container instead of the
// solver-replay edge function, so the 2 s edge CPU limit does not apply. Bench runs opt in with run
// config `local: true`: replay_run_tick still makes their builds and marks a step 'planning', but
// does not send it to the edge function; this worker picks those steps up and POSTs them to the
// same solver-replay code served locally (port 8000).
// The project key comes from this environment's network secret (header apikey), so the key in the
// environment here is a placeholder: the proxy replaces it.
//
//   SUPABASE_URL=https://ohshrzlvvxyovcjmdajc.supabase.co SUPABASE_SERVICE_ROLE_KEY=placeholder \
//     deno run -A --node-modules-dir=none tools/bench_local/worker.ts
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'placeholder';
const PORT = 8000; // Deno.serve's default port (index.ts calls Deno.serve itself)
const SLOTS = Number(Deno.env.get('LOCAL_SLOTS') ?? 6);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const rest = async (path: string) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return await r.json();
};

const inflight = new Map<string, number>();
let done = 0, failed = 0;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function poll() {
  const rows: { run_id: number; kind: string; started_at: string }[] =
    await rest('replay_run_state?status=eq.planning&select=run_id,kind,started_at');
  if (!rows.length) return;
  const ids = [...new Set(rows.map(r => r.run_id))];
  const runs: { id: number; local: string | null }[] = await rest(`replay_runs?id=in.(${ids.join(',')})&select=id,local:config->>local`);
  const local = new Set(runs.filter(r => r.local === 'true').map(r => r.id));
  for (const r of rows) {
    if (!local.has(r.run_id)) continue;
    const key = `${r.run_id}/${r.kind}/${r.started_at}`;
    if (inflight.has(key) || inflight.size >= SLOTS) continue;
    inflight.set(key, Date.now());
    const t0 = performance.now();
    fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: r.run_id, kind: r.kind }) })
      .then(async res => { const b = await res.text(); if (!res.ok) { failed++; log('fail', key, res.status, b.slice(0, 200)); } else done++; })
      .catch(e => { failed++; log('fail', key, String(e).slice(0, 200)); })
      .finally(() => { inflight.delete(key); if ((done + failed) % 25 === 0) log(`done ${done} failed ${failed} last ${Math.round(performance.now() - t0)} ms`); });
  }
}

const server = new Deno.Command(Deno.execPath(), {
  args: ['run', '-A', '--node-modules-dir=none', new URL('../../supabase/functions/solver-replay/index.ts', import.meta.url).pathname],
  env: { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY }, stdout: 'inherit', stderr: 'inherit',
}).spawn();
await new Promise(r => setTimeout(r, 4000));
log('worker up, server pid', server.pid);
for (;;) {
  try { await poll(); } catch (e) { log('poll error', String(e).slice(0, 200)); }
  await new Promise(r => setTimeout(r, 2000));
}
