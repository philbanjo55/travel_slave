// "HD" picture for the 3D sun view (TEST app): Google's Photorealistic 3D Tiles,
// asked for through our own tiles-proxy edge function, which holds the Google
// key, an on / off switch and a daily and monthly cap (the monthly one keeps
// it inside Google's free allowance). Needs a signal; nothing of it is saved on the phone.
// The offline 3D view (services/terrain.ts) never depends on this file.

// Where the door lives. The HD button shows only when its health call says
// `enabled` (the function's TILES_ENABLED switch, off by default) and `ok`
// (Google key set, daily and monthly caps not reached). Deployed but not
// switched on = no button.
export const HD_TILES_BASE = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/tiles-proxy';

export type HdSetup = { base: string; origin: string; draco: string };

const HEALTH_TIMEOUT_MS = 6000;
const ROOT_TIMEOUT_MS = 12000;
const YES_FOR_MS = 5 * 60 * 1000;      // how long a "yes, it's there" is trusted
const NO_FOR_MS = 60 * 1000;           // and a "no" (no signal, not deployed, over the cap)
// The root tile set is the request Google bills. It is reused only as far as Google's own
// Cache-Control on it allows (its policy: those headers must be respected), and never over 90 minutes.
// Seen 12 Nov 2026: "private, max-age=0, must-revalidate", so today every HD view that opens asks
// for a fresh root (the small view and full screen are two), and each counts against the caps.
const ROOT_FOR_MS = 90 * 60 * 1000;

let setup: { at: number; value: HdSetup | null } | null = null;
let asking: Promise<HdSetup | null> | null = null;
let root: { until: number; text: string } | null = null;
let rooting: Promise<string | null> | null = null;
let monthLeft: number | null = null;
let dayLeft: number | null = null;

// How long Google's own Cache-Control lets a private holder keep this answer, in ms.
function keepMs(cacheControl: string | null): number {
  const cc = (cacheControl ?? '').toLowerCase();
  if (!cc || /no-store|no-cache/.test(cc)) return 0;
  const m = /max-age=(\d+)/.exec(cc);
  return m ? Math.min(ROOT_FOR_MS, Number(m[1]) * 1000) : 0;
}

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
      monthLeft = j && typeof j.month_left === 'number' ? j.month_left : null;
      dayLeft = j && typeof j.day_left === 'number' ? j.day_left : null;
      if (j && j.enabled === true && j.ok === true && typeof j.draco === 'string' && j.draco) {
        value = { base: HD_TILES_BASE, origin: HD_TILES_BASE.replace(/^(https?:\/\/[^/]+).*$/, '$1/'), draco: j.draco };
      }
    } catch { /* no signal or not deployed: no HD */ }
    setup = { at: Date.now(), value };
    asking = null;
    return value;
  })();
  return asking;
}

// Google's root tile set as text, held in memory only. Each fresh one is the request Google bills
// and the door counts against the month.
export function hdRoot(): Promise<string | null> {
  if (root && Date.now() < root.until) return Promise.resolve(root.text);
  if (rooting) return rooting;
  rooting = (async () => {
    let text: string | null = null;
    try {
      const res = await get(`${HD_TILES_BASE}/v1/3dtiles/root.json`, ROOT_TIMEOUT_MS);
      const body = res.ok ? await res.text() : '';
      if (body && JSON.parse(body)?.root) {
        text = body;
        const keep = keepMs(res.headers.get('cache-control'));
        root = keep > 0 ? { until: Date.now() + keep, text: body } : null;
        if (monthLeft != null) monthLeft = Math.max(0, monthLeft - 1);
        if (dayLeft != null) dayLeft = Math.max(0, dayLeft - 1);
      }
    } catch { /* no HD this time */ }
    rooting = null;
    return text;
  })();
  return rooting;
}

// After the page reports a failure: the held root (its session may have run out) and the "yes" are dropped.
// HD views left this calendar month (US Pacific time, the door's monthly cap); null = not known.
export function hdLeftThisMonth(): number | null {
  return monthLeft;
}

// HD views left today: the month's allowance shared over the days left in it (unused days roll over), never above
// the daily ceiling. null = not known.
export function hdLeftToday(): number | null {
  return dayLeft;
}

export function hdForget(): void {
  root = null;
  setup = null;
}
