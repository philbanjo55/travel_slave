// Plain words for T's numbers (Phil, 3 Nov 2026: "smart, usable, understandable").
//
// One chance per stop, everywhere: T's own (the p_good on T's plans: "your day" = rank 0, T's
// plan = rank 1), shown as a verdict with its reason, never as a bare %:
//   Good bet  = a good shot in at least half of T's forecasts
//   Long shot = in some of them
//   Skip      = in (almost) none
// A day is scored as the good shots T expects of the big subjects (GOD + S): the sum of their
// chances, so 2 Good bets at 4 of 6 = 1.3 good shots. The week adds the days up.
//
// T may publish its own counts and reasons on a visit (n_fc, n_good, why, move_why) and its
// own day totals on a run (stats.n_fc, exp_big, exp_big_mine); without them the app works the
// same numbers out from p_good.
import { colors } from '../theme';
import type { Plan, PlanRun } from './planner';

export type Verdict = 'good' | 'long' | 'skip';
export const VERDICT_TEXT: Record<Verdict, string> = { good: 'Good bet', long: 'Long shot', skip: 'Skip' };
// The app's palette is black and white with one green: Good bet green, Long shot white, Skip grey.
export const VERDICT_COLOR: Record<Verdict, string> = { good: colors.signalOk, long: colors.textPrimary, skip: colors.textSecondary };

export const verdictOf = (p: number | null | undefined): Verdict =>
  p == null ? 'skip' : p >= 0.5 ? 'good' : p >= 0.1 ? 'long' : 'skip';

export const BIG = new Set(['GOD', 'S']);
export const isBig = (tier: string | null | undefined) => BIG.has(tier ?? '');

// How many forecasts T's chances are out of: T's own count when it publishes one, else 6 for
// Wyoming and 8 for the Faroes (its ECMWF members). Light-only days (no forecast reaches them
// yet) have none: T plays typical weather for the date.
export function forecastCount(run: PlanRun | null | undefined): number | null {
  if (!run) return null;
  if (run.stats?.days?.[0]?.light_only) return null;
  const n = Number(run.stats?.n_fc);
  if (Number.isFinite(n) && n > 0) return n;
  return run.params?.tz === 'Atlantic/Faroe' ? 8 : 6;
}
export const isLightOnly = (run: PlanRun | null | undefined) => !!run?.stats?.days?.[0]?.light_only;

type V = { p_good?: number | null; n_fc?: number | null; n_good?: number | null; why?: string | null };

// T's newer plans carry `chance` (calibrated odds of a good shot) beside the raw p_good. The app
// shows one chance per stop, so when a visit has `chance` it becomes the visit's p_good everywhere.
export function withChance<P extends { visits?: any[] }>(plans: P[]): P[] {
  for (const p of plans) for (const v of p.visits ?? []) {
    if (typeof v.chance === 'number' && Number.isFinite(v.chance)) { v.p_raw = v.p_good; v.p_good = v.chance; }
  }
  return plans;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// "4 of 6 forecasts", "about 4 in 10 forecasts", "4 in 10 typical days".
export function countText(v: V, run: PlanRun | null | undefined): string {
  const p = v.p_good ?? 0;
  if (v.n_fc && v.n_good != null) return `${v.n_good} of ${v.n_fc} forecasts`;
  if (isLightOnly(run)) {
    const k = Math.round(p * 10);
    return k <= 0 ? 'under 1 in 10 typical days' : k >= 10 ? 'nearly every typical day' : `${k} in 10 typical days`;
  }
  const n = forecastCount(run);
  if (n) {
    const k = p * n;
    if (Math.abs(k - Math.round(k)) < 0.04) return `${Math.round(k)} of ${n} forecasts`;
  }
  const k = Math.round(p * 10);
  return k <= 0 ? 'almost no forecast' : k >= 10 ? 'every forecast' : `about ${k} in 10 forecasts`;
}

// "Good bet · 4 of 6 forecasts". short: "4/6" style for tight rows.
export function chanceText(v: V, run: PlanRun | null | undefined): string {
  return `${VERDICT_TEXT[verdictOf(v.p_good)]} · ${countText(v, run)}`;
}

// The reason in words: T's own when it gives one, else from the count.
export function reasonText(v: V, run: PlanRun | null | undefined): string {
  if (v.why) return cap(v.why);
  const p = v.p_good ?? 0;
  const c = countText(v, run);
  if (isLightOnly(run)) return p > 0 ? `No forecast yet: good light ${c}` : 'No forecast yet: the light is rarely right here then';
  if (p <= 0) return `No good shot in any of the ${forecastCount(run) ?? ''} forecasts`.replace('  ', ' ');
  return `Good in ${c}`;
}

// Expected good shots of the big subjects (GOD + S) on a plan: each one's chance added up.
export function expShots(plan: Plan | undefined, tierOf: (id: string) => string | null | undefined, big = true): number {
  if (!plan) return 0;
  const seen = new Set<string>();
  let t = 0;
  for (const v of plan.visits) {
    if (v.p_good == null || seen.has(v.stop_id)) continue;
    const tier = tierOf(v.stop_id);
    if (!tier || (big ? !isBig(tier) : isBig(tier))) continue;
    seen.add(v.stop_id);
    t += v.p_good;
  }
  return t;
}
export const shotsText = (x: number) => (x >= 9.95 ? String(Math.round(x)) : x.toFixed(1));

// Which plan this is and when it was made: "Evening plan · 9:30 PM", "Morning re-plan · 6:40 AM".
// The planner version that made the plan (Phil, 8 Nov 2026): "T (BA)" once solver-replay v91 stamps it.
export function planVersionText(run: PlanRun | null | undefined): string {
  const v = run?.stats?.version ?? run?.params?.version;
  return v ? `T (${v})` : 'T';
}

export function planKindText(run: PlanRun | null | undefined): string {
  const v = run?.stats?.version ?? run?.params?.version;
  const base = planKindBase(run);
  if (!v) return base;
  return base === 'T plan' ? planVersionText(run) : `${planVersionText(run)}: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

function planKindBase(run: PlanRun | null | undefined): string {
  const step = run?.stats?.step;
  if (isLightOnly(run)) return 'Week draft · no forecast yet';
  if (step === 'morning') return 'Morning re-plan';
  if (step === 'early') return 'Morning re-plan (cameras)';
  if (step === 'now') return 'Re-plan now';
  if (step === 'night') return 'Evening plan';
  if (step === 'week') return 'Week draft';
  return 'T plan';
}

// The morning re-plan is useless once the day's first shoot has started (Teton Live 2 Nov:
// re-plan at 6:40, first stop 6:00). Returns the first stop's start when the plan came after it.
export function lateReplan(run: PlanRun | null | undefined, plans: (Plan | undefined)[]): string | null {
  if (!run || run.stats?.step !== 'morning') return null;
  const made = Date.parse(run.created_at);
  let first: string | null = null;
  for (const p of plans) for (const v of p?.visits ?? []) {
    if (v.start && v.p_good != null && (!first || v.start < first)) first = v.start;
  }
  return first && Date.parse(first) < made ? first : null;
}
