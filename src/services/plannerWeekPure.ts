// The pure half of plannerWeek (no network, no React): where T puts a stop across the trip,
// T's chance at Phil's own time, and the week's totals.
import type { Plan, PlanRun, PlanVisit } from './planner';
import { expShots, isBig, verdictOf } from './plannerWords';

export type TDay = { date: string; dayNumber: number | null; run: PlanRun; mine?: Plan; best?: Plan };
export type TWeek = { days: TDay[]; byDate: Map<string, TDay>; at: number };

// Phil keeps one stop row per day for the same place (Snake River Overlook is three rows), and T
// may plan any of them. So a stop is matched by its place: the row's own id, or the same name.
const placeName = (n: string | null | undefined) => (n ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const keyCache = new WeakMap<TWeek, Map<string, string>>();
function keysOf(week: TWeek): Map<string, string> {
  let m = keyCache.get(week);
  if (!m) {
    m = new Map();
    for (const d of week.days) for (const p of [d.best, d.mine]) for (const v of p?.visits ?? []) if (v.name) m.set(v.stop_id, placeName(v.name));
    keyCache.set(week, m);
  }
  return m;
}
export function samePlace(week: TWeek | null, a: string, b: string): boolean {
  if (a === b) return true;
  if (!week) return false;
  const k = keysOf(week), ka = k.get(a);
  return !!ka && ka === k.get(b);
}
export function placeKey(week: TWeek | null, id: string): string { return (week && keysOf(week).get(id)) || id; }

// Where T's plans put a stop across the trip, best first (its T chance each time).
export type Placement = { date: string; dayNumber: number | null; visit: PlanVisit; run: PlanRun };
export function placements(week: TWeek | null, stopId: string): Placement[] {
  const out: Placement[] = [];
  for (const d of week?.days ?? []) {
    const v = d.best?.visits.find(x => x.p_good != null && samePlace(week, x.stop_id, stopId));
    if (v) out.push({ date: d.date, dayNumber: d.dayNumber, visit: v, run: d.run });
  }
  return out.sort((a, b) => (b.visit.p_good ?? 0) - (a.visit.p_good ?? 0));
}
// T's chance for a stop at Phil's own time on a day ("your day").
export function mineVisit(week: TWeek | null, stopId: string, date: string): PlanVisit | null {
  return week?.byDate.get(date)?.mine?.visits.find(v => v.p_good != null && samePlace(week, v.stop_id, stopId)) ?? null;
}

// The week in good shots of the big subjects, from today on: T's plans vs Phil's own days,
// and how many big subjects T gives at least one good shot (chances combined per subject).
export type WeekTotals = { t: number; mine: number | null; days: number; covered: number; bigLeft: number };
export function weekTotals(week: TWeek | null, tierOf: (id: string) => string | null | undefined, fromDate: string,
                           done: (id: string) => boolean = () => false): WeekTotals | null {
  const ds = (week?.days ?? []).filter(d => d.date >= fromDate && d.best);
  if (!ds.length) return null;
  let t = 0, mine = 0, mineDays = 0;
  const miss = new Map<string, number>();
  const doneKeys = new Set<string>();
  for (const d of ds) {
    t += expShots(d.best, tierOf);
    if (d.mine) { mine += expShots(d.mine, tierOf); mineDays++; }
    for (const v of d.best!.visits) {
      if (v.p_good == null || !isBig(tierOf(v.stop_id))) continue;
      const k = placeKey(week, v.stop_id);
      miss.set(k, (miss.get(k) ?? 1) * (1 - v.p_good));
      if (done(v.stop_id)) doneKeys.add(k);
    }
  }
  const bigIds = new Set<string>();
  for (const d of ds) for (const p of [d.best, d.mine]) for (const v of p?.visits ?? []) {
    if (!isBig(tierOf(v.stop_id))) continue;
    if (done(v.stop_id)) doneKeys.add(placeKey(week, v.stop_id)); else bigIds.add(placeKey(week, v.stop_id));
  }
  for (const k of doneKeys) bigIds.delete(k);
  let covered = 0;
  for (const [k, m] of miss) if (!doneKeys.has(k)) covered += 1 - m;
  return { t, mine: mineDays === ds.length ? mine : null, days: ds.length, covered, bigLeft: bigIds.size };
}

// Is a stop a Good bet anywhere T has it this trip? (for "better on Day 6" hints)
export function bestElsewhere(week: TWeek | null, stopId: string, date: string): Placement | null {
  const here = placements(week, stopId).find(p => p.date === date)?.visit.p_good ?? mineVisit(week, stopId, date)?.p_good ?? 0;
  const other = placements(week, stopId).find(p => p.date !== date);
  return other && verdictOf(other.visit.p_good) !== verdictOf(here) && (other.visit.p_good ?? 0) > here ? other : null;
}
