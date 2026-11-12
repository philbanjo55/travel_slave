// "HD" picture for the 3D sun view (TEST app): Google's Photorealistic 3D Tiles,
// asked for through our own tiles-proxy edge function, which holds the Google
// key and a daily cap. Needs a signal; nothing of it is saved on the phone.
// The offline 3D view (services/terrain.ts) never depends on this file.

// Where the door lives. Until the function is deployed (with its secrets) the
// health call fails and the HD button never shows.
export const HD_TILES_BASE = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/tiles-proxy';

export type HdSetup = { base: string; origin: string; draco: string };

const HEALTH_TIMEOUT_MS = 6000;
const ROOT_TIMEOUT_MS = 12000;
const YES_FOR_MS = 5 * 60 * 1000;      // how long a "yes, it's there" is trusted
const NO_FOR_MS = 60 * 1000;           // and a "no" (no signal, not deployed, over the cap)
const ROOT_FOR_MS = 90 * 60 * 1000;    // one root request starts a Google session of a few hours: reuse it

let setup: { at: number; value: HdSetup | null } | null = null;
let asking: Promise<HdSetup | null> | null = null;
let root: { at: number; text: string } | null = null;
let rooting: Promise<string | null> | null = null;

async function get(url: string, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(timer); }
}

// The HD setup when the phone is online and the door is deployed, set up and under its cap; else null.
export function hdSetup(): Promise<HdSetup | null> {
  if (!HD_TILES_BASE) return Promise.resolve(null);
  if (setup && Date.now() - setup.at < (setup.value ? YES_FOR_MS : NO_FOR_MS)) return Promise.resolve(setup.value);
  if (asking) return asking;
  asking = (async () => {
    let value: HdSetup | null = null;
    try {
      const res = await get(`${HD_TILES_BASE}/health`, HEALTH_TIMEOUT_MS);
      const j: any = res.ok ? await res.json() : null;
      if (j && j.ok === true && typeof j.draco === 'string' && j.draco) {
        value = { base: HD_TILES_BASE, origin: HD_TILES_BASE.replace(/^(https?:\/\/[^/]+).*$/, '$1/'), draco: j.draco };
      }
    } catch { /* no signal or not deployed: no HD */ }
    setup = { at: Date.now(), value };
    asking = null;
    return value;
  })();
  return asking;
}

// Google's root tile set as text. Each fresh one is the request Google bills and the door counts,
// so it is asked for once and handed to every HD view for the next hour and a half.
export function hdRoot(): Promise<string | null> {
  if (root && Date.now() - root.at < ROOT_FOR_MS) return Promise.resolve(root.text);
  if (rooting) return rooting;
  rooting = (async () => {
    let text: string | null = null;
    try {
      const res = await get(`${HD_TILES_BASE}/v1/3dtiles/root.json`, ROOT_TIMEOUT_MS);
      const body = res.ok ? await res.text() : '';
      if (body && JSON.parse(body)?.root) { text = body; root = { at: Date.now(), text: body }; }
    } catch { /* no HD this time */ }
    rooting = null;
    return text;
  })();
  return rooting;
}

// After the page reports a failure: the held root (its session may have run out) and the "yes" are dropped.
export function hdForget(): void {
  root = null;
  setup = null;
}
