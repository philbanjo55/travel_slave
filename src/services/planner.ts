// Solver data for the TEST app's Planner. Plans and stop settings are read
// straight from Supabase (read-only policies); everything that writes or
// needs a signed webcam URL goes through the solver-actions edge function.
import { AppState } from 'react-native';
import { supabase } from './supabase';

const ACTIONS_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-actions';

export type PlanVisit = {
  date: string; trip_date: string | null; stop_id: string; name: string; booked: boolean;
  arrive?: string; start: string | null; end?: string; wait_min?: number; drive_min?: number;
  value?: number; p_good?: number; peak_at?: string; light?: string | null; rated?: boolean;
  best?: { start: string; value: number; p_good: number; peak_at?: string } | null;
};
export type Plan = {
  rank: number; objective: number; mean: number; cvar11: number;
  drive_minutes: number | null; long_leg_minutes: number | null; note: string | null; visits: PlanVisit[];
};
export type RunDay = { date: string; trip_date: string | null; light_only?: boolean; start_hotel?: string; end_hotel?: string };
export type PlanRun = { id: string; created_at: string; plan_date: string; params: any; stats: any };
export type RunMode = 'forecast' | 'light' | 'preview';

export type CameraFrame = {
  camera: { code: string; name: string; island: string; lat: number; lng: number; image_url: string; live_url?: string; live_time?: string | null; distance_km: number | null };
  frame: null | {
    // taken_at: the camera's own time when known, else when it was fetched
    // (captured_at is only the hourly slot).
    id: string; captured_at: string; taken_at?: string; url: string | null; label: string | null; hills_visible: boolean | null;
    cloud_on_hills: string | null; sun_on_land: boolean | null; label_note: string | null;
    label_model: string | null; label_error: string | null; phil_label: string | null;
  };
};

export async function solverAction<T = any>(body: Record<string, any>): Promise<T> {
  // A weak signal must not hang the planner screens for ever: give up after 20 s.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  let r: Response;
  try {
    r = await fetch(ACTIONS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
    });
  } catch (e: any) {
    throw new Error(ctl.signal.aborted ? 'No answer from T (weak signal?)' : String(e?.message ?? e));
  } finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

// Which kind of plan a run is, for one trip day.
export function runMode(run: PlanRun): RunMode {
  const d: RunDay | undefined = run.stats?.days?.[0];
  if (d?.light_only) return 'light';
  if (d?.trip_date && d.date !== d.trip_date) return 'preview';
  return 'forecast';
}

export function runTripDate(run: PlanRun): string | null {
  const d: RunDay | undefined = run.stats?.days?.[0];
  return d?.trip_date ?? null;
}

// Planner T (Phil, 31 Oct 2026: T only): when T has planned a trip, the app shows only
// T's plans; the old planner keeps running in the background for the comparison.
export const isT = (r: PlanRun) => r.stats?.planner === 'T';

// Does T plan this trip (planner_t_trips)? Then "Plan again" runs T, never the old planner.
export async function usesT(tripId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('planner_t_trip', { p_trip: tripId });
  return !error && !!data;
}

// Plan again with T: a new week draft from tomorrow (one started in the last 2 min is reused).
export async function replanT(tripId: string): Promise<string> {
  const { data, error } = await supabase.rpc('planner_t_replan', { p_trip: tripId });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? 'T could not start');
  return data.since as string;
}

// T's newest plan for a trip day: the evening plan / morning re-plan, else the week draft.
export async function latestT(tripId: string, tripDate: string): Promise<PlanRun | null> {
  const m = latestByDay(await fetchDayRuns(tripId)).get(tripDate) ?? {};
  return m.forecast ?? m.light ?? null;
}

// Waits for a T plan of the day made after `since` (up to 6 min). While T works it only asks
// the tiny planning status (every 6 s), and reads the plans once T is done; no network while
// the app is in the background, and it stops as soon as `alive()` says the screen is gone
// (Phil, 1 Nov 2026: nothing downloading in the background).
export async function waitForT(tripId: string, tripDate: string, since: string, alive: () => boolean = () => true): Promise<PlanRun | null> {
  const t0 = Date.now(), after = new Date(since).getTime();
  const find = async () => (await fetchDayRuns(tripId)).find(x => runTripDate(x) === tripDate && new Date(x.created_at).getTime() >= after) ?? null;
  while (Date.now() - t0 < 6 * 60000) {
    await new Promise(res => setTimeout(res, 6000));
    if (!alive()) return null;
    if (AppState.currentState !== 'active') continue;
    const st = await fetchPlanningStatus(tripId).catch(() => null);
    if (st && (st.status === 'queued' || st.status === 'running')) continue;
    const r = await find().catch(() => null);
    if (r || (st && st.status === 'done')) return r;
  }
  return null;
}

// Several trip days of T's plans shown together (each day's newest T plan, joined).
export async function fetchTDays(tripId: string, tripDates: string[]): Promise<{ run: PlanRun | null; plans: Plan[]; missing: string[] }> {
  const latest = latestByDay(await fetchDayRuns(tripId));
  const runs = tripDates.map(d => { const m = latest.get(d) ?? {}; return m.forecast ?? m.light ?? null; });
  const missing = tripDates.filter((_, i) => !runs[i]);
  const plans = await Promise.all(runs.map(r => (r ? fetchPlans(r.id) : Promise.resolve([] as Plan[]))));
  const best = plans.map(ps => ps.find(p => p.rank === 1)).filter((p): p is Plan => !!p);
  if (!best.length) return { run: null, plans: [], missing };
  const sum = (k: 'objective' | 'mean' | 'cvar11' | 'drive_minutes') => best.reduce((t, p) => t + (p[k] ?? 0), 0);
  // The days' ceilings add up like their scores (each day's own, when every day has one).
  const ceilings = runs.filter((r): r is PlanRun => !!r).map(r => Number(r.stats?.ceiling));
  const ceiling = ceilings.length && ceilings.every(c => c > 0) ? ceilings.reduce((t, c) => t + c, 0) : null;
  const first = runs.find(r => !!r) ?? null;
  const joined: Plan = { rank: 1, objective: sum('objective'), mean: sum('mean'), cvar11: sum('cvar11'), drive_minutes: sum('drive_minutes'),
                         long_leg_minutes: null, note: 'T: days together', visits: best.flatMap(p => p.visits) };
  return { run: first ? { ...first, stats: { ...first.stats, ceiling } } : null, plans: [joined], missing };
}

// Single-day runs for a trip, newest first (no plan bodies: they're large).
export async function fetchDayRuns(tripId: string, limit = 150): Promise<PlanRun[]> {
  const { data, error } = await supabase.from('solver_runs')
    .select('id, created_at, plan_date, params, stats')
    .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const runs = (data ?? []).filter((r: any) => r.stats?.kind === 'day') as PlanRun[];
  return runs.some(isT) ? runs.filter(isT) : runs;
}

// The newest run per trip day and mode.
export function latestByDay(runs: PlanRun[]): Map<string, Partial<Record<RunMode, PlanRun>>> {
  const out = new Map<string, Partial<Record<RunMode, PlanRun>>>();
  for (const r of runs) {
    const td = runTripDate(r);
    if (!td) continue;
    const m = out.get(td) ?? {};
    const mode = runMode(r);
    if (!m[mode]) m[mode] = r;
    out.set(td, m);
  }
  return out;
}

export async function fetchPlans(runId: string): Promise<Plan[]> {
  const { data, error } = await supabase.from('solver_plans')
    .select('rank, objective, mean, cvar11, drive_minutes, long_leg_minutes, note, visits')
    .eq('run_id', runId).order('rank');
  if (error) throw error;
  return (data ?? []) as Plan[];
}

// Best plan and "your day" for many runs at once (day list), as % of a perfect day.
export type DayScore = { best?: number | null; mine?: number | null; hasMine: boolean; top?: string[] };
export async function fetchScores(runs: PlanRun[], tierOf: (stopId: string) => string | null | undefined): Promise<Map<string, DayScore>> {
  const out = new Map<string, DayScore>();
  if (!runs.length) return out;
  const { data, error } = await supabase.from('solver_plans')
    .select('run_id, rank, mean, cvar11, objective, visits').in('run_id', runs.map(r => r.id)).in('rank', [0, 1]);
  if (error) throw error;
  for (const r of runs) {
    const ps = (data ?? []).filter((p: any) => p.run_id === r.id) as (Plan & { run_id: string })[];
    const mine = ps.find(p => p.rank === 0), best = ps.find(p => p.rank === 1);
    const c = planCeiling(r, [mine, best], tierOf);
    out.set(r.id, {
      // Your day worth nothing (times passed, no light) shows T's best alone, not "0% →".
      mine: mine && mine.mean > 0 ? pctOf(mine.mean, c) : null, best: best ? pctOf(best.mean, c) : null, hasMine: !!mine,
      top: best?.visits.filter(v => (v.p_good ?? 0) >= 0.5).map(v => v.name).slice(0, 3),
    });
  }
  return out;
}

// refresh: rebuild the scores first if a setting or shot changed since the last build.
export async function planDay(tripId: string, tripDate: string, preview = false, refresh = false): Promise<string> {
  const j = await solverAction<{ run_id: string }>({ action: 'plan', trip_id: tripId, trip_date: tripDate, preview, refresh });
  return j.run_id;
}

// Several trip days planned together (a subject counts once, at its best day).
export async function planDays(tripId: string, tripDates: string[]): Promise<string> {
  const j = await solverAction<{ run_id: string }>({ action: 'plan', trip_id: tripId, trip_dates: tripDates });
  return j.run_id;
}

// Multi-day runs, newest first; trip dates from stats.days.
export async function fetchMultiRuns(tripId: string, limit = 60): Promise<PlanRun[]> {
  const { data, error } = await supabase.from('solver_runs')
    .select('id, created_at, plan_date, params, stats')
    .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).filter((r: any) => r.stats?.kind === 'multi');
}
export const runTripDates = (r: PlanRun): string[] =>
  (r.stats?.days ?? []).map((d: RunDay) => d.trip_date ?? d.date);

// Each rated stop's best chance on every trip day (forecast, else light only).
export type GridCell = { stop_id: string; trip_date: string; mean: number; p_good: number; best_at: string; source: 'forecast' | 'light' };
export async function fetchSubjectGrid(tripId: string): Promise<GridCell[]> {
  const j = await solverAction<{ grid: GridCell[] }>({ action: 'subject_grid', trip_id: tripId });
  return j.grid;
}

// Keep every suggested setting on the trip as Phil's own.
export async function confirmAllSettings(tripId: string): Promise<number> {
  const j = await solverAction<{ confirmed: number }>({ action: 'confirm_all', trip_id: tripId });
  return j.confirmed;
}

export const planTitle = (p: Plan) =>
  p.note?.startsWith('T: ') ? (p.note.includes('your day') ? 'Your day' : p.note.includes('morning') ? 'Morning re-plan' : p.note.includes('draft') ? 'Week draft'
    : p.note.includes('together') ? 'T plan' : 'Evening plan')
  : p.rank === 0 ? 'My day' : p.note?.startsWith('safest') ? 'Safest' : p.rank === 1 ? 'Best' : `Alt ${p.rank}`;

export type ShotStatus = 'got' | 'nailed' | null;

// The stop's planner settings and its shots, through solver-actions.
export type Light = 'front' | 'side' | 'back' | 'soft';
export type StopSettings = {
  tier: string | null; light_wanted: Light[] | null; fog_wanted: boolean | null;
  star_vantage_id: string | null; shot_status: ShotStatus; source: 'suggested' | 'phil';
};
export type StopShot = { vantage_id: string; position: number; name: string };
export const TIER_CHOICES = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F'];
export const LIGHT_CHOICES: { key: Light; text: string }[] = [
  { key: 'front', text: 'Front' }, { key: 'side', text: 'Side' }, { key: 'back', text: 'Back' }, { key: 'soft', text: 'Soft' },
];

export async function fetchStopSettings(stopId: string) {
  return solverAction<{ setting: StopSettings | null; shots: StopShot[] }>({ action: 'stop_settings', stop_id: stopId });
}

// Phil's own settings (source becomes 'phil'); an empty patch confirms the suggestion.
export async function saveStopSettings(stopId: string, patch: Partial<Pick<StopSettings, 'tier' | 'light_wanted' | 'fog_wanted' | 'star_vantage_id'>>) {
  const j = await solverAction<{ setting: StopSettings }>({ action: 'set_settings', stop_id: stopId, ...patch });
  return j.setting;
}

export type TripSetting = StopSettings & { stop_id: string; updated_at?: string };
export async function fetchTripSettings(tripId: string): Promise<TripSetting[]> {
  const { data, error } = await supabase.from('solver_stop_settings')
    .select('stop_id, tier, light_wanted, fog_wanted, star_vantage_id, shot_status, source, updated_at, stops!inner(trip_id)')
    .eq('stops.trip_id', tripId);
  if (error) throw error;
  return (data ?? []) as any;
}

export const markShot = (stopId: string, status: ShotStatus) =>
  solverAction({ action: 'mark_shot', stop_id: stopId, status });

export async function fetchFrames(near?: { lat: number; lng: number }, n = 2): Promise<CameraFrame[]> {
  const j = await solverAction<{ cameras: CameraFrame[] }>({ action: 'frames', ...(near ? { lat: near.lat, lng: near.lng, n } : {}) });
  return j.cameras;
}

// Cameras within 50 km of any of the trip's stops.
export async function fetchTripFrames(tripId: string): Promise<CameraFrame[]> {
  const j = await solverAction<{ cameras: CameraFrame[] }>({ action: 'frames', trip_id: tripId });
  return j.cameras;
}

// Claude API spend this UTC month (webcam labels etc.), capped server-side.
export type ClaudeSpend = { month_usd: number; cap_usd: number; calls: number; today_usd: number; last_at: string | null };
export async function fetchClaudeSpend(): Promise<ClaudeSpend | null> {
  const { data, error } = await supabase.rpc('claude_spend_summary');
  return error ? null : (data as ClaudeSpend);
}
export const spendLine = (s: ClaudeSpend) =>
  `Claude this month: $${s.month_usd.toFixed(2)} of $${s.cap_usd} (today $${s.today_usd.toFixed(2)})`;

export type PhilLabel = 'clear' | 'cloud_on_hills' | 'fog' | 'cant_tell';
export const labelFrame = (frameId: string, label: PhilLabel | null) =>
  solverAction({ action: 'label_frame', frame_id: frameId, label });

export const applyPreview = (runId: string, rank: number) =>
  solverAction<{ preview_only: boolean; result: any }>({ action: 'apply_preview', run_id: runId, rank });

// "05:45" in the trip's timezone (falls back to the phone's).
export function hhmm(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

export function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

export const LIGHT_WORDS: Record<string, string> = {
  front: 'front light', side: 'side light', backlit: 'backlit', top: 'high sun',
  'in shadow': 'in shadow', 'no sun': 'blue hour', 'no direction': 'sun up',
};

// Plain words for a webcam frame's label.
export function frameSummary(f: CameraFrame['frame']): string {
  if (!f) return 'No frame yet';
  if (!f.label) return f.label_error ? 'Not labelled yet' : 'Not labelled yet';
  const what: Record<string, string> = {
    clear: 'Clear', haze: 'Hazy', low_cloud: 'Cloud on the hills', fog: 'Fog', dark: 'Too dark', camera_problem: 'Camera problem',
  };
  const parts = [what[f.label] ?? f.label];
  if (f.sun_on_land) parts.push('sun on the land');
  return parts.join(' · ');
}

// Tonight's brief for one trip day: the newest plan against the one before
// it (same kind), in plain lines. Built here from saved plans, no extra call.
export type Brief = { tripDate: string; runAt: string; headline: string; leave: string | null; changes: string[] };
export async function fetchBrief(tripId: string, tripDate: string, tierOf: (stopId: string) => string | null): Promise<Brief | null> {
  const runs = (await fetchDayRuns(tripId)).filter(r => runTripDate(r) === tripDate && runMode(r) !== 'preview');
  if (!runs.length) return null;
  const mode = runMode(runs[0]);
  const [now, before] = runs.filter(r => runMode(r) === mode);
  const best = async (r?: PlanRun) => (r ? (await fetchPlans(r.id)).find(p => p.rank === 1) : undefined);
  const [pNow, pBefore] = await Promise.all([best(now), best(before)]);
  if (!pNow) return null;
  const tz: string | undefined = now.params?.tz;
  const scored = pNow.visits.filter(v => v.p_good != null);
  const big = scored.filter(v => ['GOD', 'S'].includes(tierOf(v.stop_id) ?? ''));
  const top = [...(big.length ? big : scored)].sort((a, b) => (b.p_good ?? 0) - (a.p_good ?? 0))[0];
  const headline = top
    ? `Go for ${top.name} at ${hhmm(top.peak_at ?? top.start, tz)} (${Math.round((top.p_good ?? 0) * 100)}%).`
    : 'Nothing rated looks good this day.';
  const first = pNow.visits.find(v => v.start);
  const leave = first?.start
    ? `Leave ${hhmm(new Date(new Date(first.start).getTime() - (first.drive_min ?? 0) * 60000).toISOString(), tz)} for ${first.name}.`
    : null;
  const changes: string[] = [];
  if (pBefore) {
    const was = new Map(pBefore.visits.map(v => [v.stop_id, v.p_good ?? 0]));
    for (const v of scored) {
      const a = was.get(v.stop_id);
      if (a == null) continue;
      const d = (v.p_good ?? 0) - a;
      if (Math.abs(d) >= 0.15) changes.push(`${d > 0 ? '↑' : '↓'} ${v.name} ${Math.round(a * 100)}% → ${Math.round((v.p_good ?? 0) * 100)}%`);
    }
    const newIn = pNow.visits.filter(v => v.p_good != null && !was.has(v.stop_id)).map(v => v.name);
    if (newIn.length) changes.push(`New in the plan: ${newIn.slice(0, 3).join(', ')}`);
  }
  return { tripDate, runAt: now.created_at, headline, leave, changes: changes.slice(0, 4) };
}

// ---- One score scale (Phil, 1 Nov 2026: redesign) -------------------------------------
// Every plan score in the app is "% of a perfect day": the plan's expected value (mean) or
// its bad-weather value (cvar11) over the most the day could add. T (solver-replay v51+)
// stores that ceiling on the run (stats.ceiling: every rated place in either plan seen
// perfectly, over what is already shot); older runs fall back to the tier weights of the
// distinct rated stops in "your day" and the best plan. Weights as in solver-plan /
// solver-replay TIER_W.
export const TIER_W: Record<string, number> = { GOD: 10, S: 5, A: 2, B: 1, C: 1, D: 0.5, F: 0 };

export function planCeiling(run: PlanRun | null, plans: (Plan | undefined)[], tierOf: (stopId: string) => string | null | undefined): number {
  const c = Number(run?.stats?.ceiling);
  if (Number.isFinite(c) && c > 0) return c;
  const ids = new Set<string>();
  for (const p of plans) for (const v of p?.visits ?? []) ids.add(v.stop_id);
  let t = 0;
  for (const id of ids) t += TIER_W[tierOf(id) ?? ''] ?? 0;
  return t;
}

// 0-100, or null when the day has nothing rated (ceiling 0).
export function pctOf(x: number | null | undefined, ceiling: number): number | null {
  if (x == null || !(ceiling > 0)) return null;
  const p = Math.max(0, Math.min(100, Math.round((100 * x) / ceiling)));
  return p === 0 && x > 0 ? 1 : p; // something, however little, never reads as a bare 0
}
export const pctText = (p: number | null) => (p == null ? '—' : `${p}%`);

export type PlanPct = { pct: number | null; bad: number | null };
export const planPct = (p: Plan | undefined, ceiling: number): PlanPct =>
  ({ pct: pctOf(p?.mean, ceiling), bad: pctOf(p?.cvar11, ceiling) });

// "8:05 AM" <-> minutes after midnight; an ISO time as minutes in the trip's timezone.
export function labelMinutes(label: string | null | undefined): number | null {
  const m = (label ?? '').replace(/^~\s*/, '').match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}
export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
// "5:15 PM" in the trip's timezone, the way the app writes stop times.
export function clock12(iso: string | null | undefined, tz?: string): string {
  const m = tzMinutes(iso, tz);
  return m == null ? '—' : minutesLabel(m);
}
export function tzMinutes(iso: string | null | undefined, tz?: string): number | null {
  if (!iso) return null;
  const [h, m] = hhmm(iso, tz).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? (h % 24) * 60 + m : null;
}

// What T's best plan changes on one trip day, against the day as it stands now (so the
// list empties once the plan is accepted). moved: a stop of this day at a new time (>= 10
// min); added: a stop brought in from another day (or a new visit of a place); skipped: a
// rated stop of the day the plan leaves out (applying keeps it on the day).
export type DayChange = {
  kind: 'moved' | 'added' | 'skipped'; stop_id: string; name: string;
  was: string | null; now: string | null; fromDay?: number | null; p_good?: number | null; wasP?: number | null;
};
export function dayChanges(dayStops: any[], allDays: any[], mine: Plan | undefined, best: Plan | undefined, tz: string | undefined,
                           tierOf: (stopId: string) => string | null | undefined): DayChange[] {
  if (!best) return [];
  const out: DayChange[] = [];
  const onDay = new Map(dayStops.map((s: any) => [s.id, s]));
  const inBest = new Set(best.visits.map(v => v.stop_id));
  const mineP = new Map((mine?.visits ?? []).map(v => [v.stop_id, v.p_good ?? null]));
  for (const v of best.visits) {
    if (v.booked) continue;
    const now = tzMinutes(v.start, tz);
    const s = onDay.get(v.stop_id);
    if (s) {
      const was = labelMinutes(s.time_label);
      if (now != null && (was == null || Math.abs(was - now) >= 10)) {
        out.push({ kind: 'moved', stop_id: v.stop_id, name: v.name, was: s.time_label ?? null, now: now != null ? minutesLabel(now) : null,
                   p_good: v.p_good ?? null, wasP: mineP.get(v.stop_id) ?? null });
      }
    } else {
      const from = allDays.find((d: any) => (d.stops ?? []).some((x: any) => x.id === v.stop_id));
      out.push({ kind: 'added', stop_id: v.stop_id, name: v.name, was: null, now: now != null ? minutesLabel(now) : null,
                 fromDay: from?.day_number ?? null, p_good: v.p_good ?? null });
    }
  }
  for (const s of dayStops) {
    if (inBest.has(s.id) || s.time_locked) continue;
    if (!(TIER_W[tierOf(s.id) ?? ''] > 0)) continue;
    out.push({ kind: 'skipped', stop_id: s.id, name: s.name, was: s.time_label ?? null, now: null, wasP: mineP.get(s.id) ?? null });
  }
  return out;
}
const firstWord = (n: string) => n.split(/\s+[—–-]\s+|\s+\+\s+/)[0];
// "3 changes: Shane Cabins to 10:15, stay at Snake River till 9:45, Emily's Pond in"
export function changesLine(ch: DayChange[]): string {
  const real = ch.filter(c => c.kind !== 'skipped');
  const bits = real.map(c => c.kind === 'added'
    ? `add ${firstWord(c.name)}${c.now ? ` at ${c.now.replace(' ', ' ')}` : ''}${c.fromDay ? ` (from Day ${c.fromDay})` : ''}`
    : `${firstWord(c.name)} to ${c.now?.replace(' ', ' ') ?? '?'}`);
  const skipped = ch.filter(c => c.kind === 'skipped').map(c => firstWord(c.name));
  const head = `${real.length} change${real.length === 1 ? '' : 's'}`;
  return `${head}: ${bits.join(', ')}${skipped.length ? `; skips ${skipped.join(', ')}` : ''}`;
}

// Why "your day" has no score, in words (never a bare 0).
export function mineReason(mine: Plan | undefined, tripDate: string, dayStops: any[], tierOf: (id: string) => string | null | undefined, tz?: string): string | null {
  const rated = dayStops.filter((s: any) => TIER_W[tierOf(s.id) ?? ''] > 0);
  if (!rated.length) return 'No rated stops on this day.';
  if (!mine) return "T scores your own day from its next plan.";
  if ((mine.mean ?? 0) > 0) return null;
  let todayStr = '';
  try { todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { todayStr = new Date().toISOString().slice(0, 10); }
  if (todayStr === tripDate) {
    const nowMin = tzMinutes(new Date().toISOString(), tz) ?? 0;
    const left = rated.filter((s: any) => (labelMinutes(s.time_label) ?? 0) + (s.duration_minutes ?? 0) > nowMin);
    if (!left.length) return 'No rated stops left today.';
    return "Today's schedule has slipped: your stops' times have passed. T's plan re-times them.";
  }
  return 'Your stops at their times get no good light in any weather version.';
}

// T's planning in the background (B1): its newest week draft for the trip.
export type PlanningStatus = { id: number; status: string; night: number; nights: number; trip_dates: string[]; made: string | null; updated_at: string | null };
export async function fetchPlanningStatus(tripId: string): Promise<PlanningStatus | null> {
  const j = await solverAction<{ status: PlanningStatus | null }>({ action: 'planning_status', trip_id: tripId });
  return j.status;
}

// One stop's chance per 15-min slot on a trip day (stop page "Today" chart).
export type CurveSlot = { slot_at: string; mean: number; p_good: number; source: 'forecast' | 'light' };
export async function fetchStopCurve(stopId: string, tripDate: string): Promise<{ slots: CurveSlot[]; builtAt: string | null }> {
  const j = await solverAction<{ slots: CurveSlot[]; built_at?: string | null }>({ action: 'stop_curve', stop_id: stopId, trip_date: tripDate });
  return { slots: (j.slots ?? []).map(s => ({ ...s, mean: Number(s.mean), p_good: Number(s.p_good) })), builtAt: j.built_at ?? null };
}

// "Accept all" writes on the test trips only (test bed, Faroes Live, Teton Live); real trips
// get the preview until Phil signs the solver off (solver-actions TEST_TRIPS).
export const TEST_TRIPS = new Set([
  '7e57bed0-0000-4000-8000-000000000001',
  '7e57bed0-0000-4000-8000-000000000002',
  '7e57bed0-0000-4000-8000-000000000003',
]);
export const canApply = (tripId: string) => TEST_TRIPS.has(tripId);
// Whole-week Accept (Phil, 3 Nov 2026): T's plan for the rest of the trip at once: today's
// visits still ahead and every later day; past days and passed stops never change; the rated
// stops T's week leaves out are set aside (tier kept). apply false = preview. Writes on the
// test trips only.
export const applyWeek = (tripId: string, apply: boolean) =>
  solverAction<{ preview_only: boolean; result: any }>({ action: 'apply_week', trip_id: tripId, apply });

// Is this trip day already over (before today in the trip's timezone)?
export function isPastDay(date: string, tz?: string): boolean {
  let today = new Date().toISOString().slice(0, 10);
  try { today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { /* phone's date */ }
  return date < today;
}

export const applyPlan = (runId: string, rank: number) =>
  solverAction<{ preview_only: boolean; result: any }>({ action: 'apply', run_id: runId, rank });
