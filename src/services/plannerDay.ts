// The trip page's day card, in words (no React, no network): the good shots T expects of the
// big subjects on T's plan and on Phil's own day, the week from today, one line per change
// saying where the stop went and why, and a flag when the morning re-plan came too late.
import { DayChange, Plan, PlanRun, PlanVisit, mineReason } from './planner';
import { VERDICT_TEXT, countText, expShots, isBig, lateReplan, verdictOf } from './plannerWords';
import { TWeek, WeekTotals, mineVisit, placements, samePlace, weekTotals } from './plannerWeekPure';

export type DayCore = {
  run: PlanRun | null; mine?: Plan; best?: Plan; tiers: Map<string, string>; week?: TWeek | null; nailed?: Set<string>;
};

export type DayScore = {
  mine: number | null; best: number; others: number; bigOnDay: boolean; reason: string | null; changes: DayChange[];
  reasons: string[]; week: WeekTotals | null; late: string | null; first: PlanVisit | null; lowerWhy: string | null;
};
const short = (v: { p_good?: number | null } | null | undefined, run: PlanRun | null | undefined) =>
  v ? countText(v, run).replace(/ forecasts$/, '') : 'not scored';

// Today in the trip's own time zone (falls back to the plan's date).
export function tripToday(run: PlanRun | null | undefined, fallback: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: run?.params?.tz }).format(new Date()); } catch { return fallback; }
}
// Another day T plans a stop on that hasn't passed yet, best first.
const elsewhere = (week: TWeek | null, stopId: string, date: string, today: string) =>
  placements(week, stopId).filter(p => p.date !== date && p.date >= today);

// One line per change: where the stop goes and why, in T's own chances.
export function moveReasons(changes: DayChange[], planner: DayCore, date: string): string[] {
  const run = planner.run, week = planner.week ?? null;
  const dateOfDay = (n: number | null | undefined) => week?.days.find(d => d.dayNumber === n)?.date ?? null;
  const today = tripToday(run, date);
  // A stop T brings in from another day isn't also "left out" here (Phil had it twice).
  const added = changes.filter(c => c.kind === 'added').map(c => c.stop_id);
  return changes.filter(c => !(c.kind === 'skipped' && added.some(a => samePlace(week, a, c.stop_id)))).map(c => {
    if (c.kind === 'moved') {
      const now = c.p_good != null ? countText({ p_good: c.p_good }, run) : 'unscored';
      return `${c.name} ${c.was ?? ''} → ${c.now ?? '?'}: ${now}${c.wasP != null ? `, vs ${short({ p_good: c.wasP }, run)} at your time` : ''}`.replace('  ', ' ');
    }
    if (c.kind === 'added') {
      const there = c.fromDay ? mineVisit(week, c.stop_id, dateOfDay(c.fromDay) ?? '') : null;
      const fromRun = c.fromDay ? week?.byDate.get(dateOfDay(c.fromDay) ?? '')?.run : null;
      return `${c.name} from Day ${c.fromDay ?? '?'} at ${c.now ?? '?'}: ${countText({ p_good: c.p_good ?? 0 }, run)} here${there ? `, vs ${short(there, fromRun)} on Day ${c.fromDay}` : ''}`;
    }
    // Skipped: where T does it instead, if anywhere.
    if (planner.nailed?.has(c.stop_id)) return `${c.name}: left out, already nailed`;
    const other = elsewhere(week, c.stop_id, date, today)[0];
    const here = c.wasP != null ? short({ p_good: c.wasP }, run) : null;
    if (other) {
      const there = countText(other.visit, other.run);
      const same = here != null && Math.abs((other.visit.p_good ?? 0) - (c.wasP ?? 0)) < 0.05;
      return same
        ? (here === short(other.visit, other.run)
          ? `${c.name} → Day ${other.dayNumber ?? '?'} instead: same chance there (${there}), and it frees this day for others`
          : `${c.name} → Day ${other.dayNumber ?? '?'} instead: about the same chance (${there} there, ${here} here), and it frees this day for others`)
        : `${c.name} → Day ${other.dayNumber ?? '?'} instead: ${VERDICT_TEXT[verdictOf(other.visit.p_good)]}, ${there} there${here ? ` vs ${here} here` : ''}`;
    }
    return `${c.name}: left out${here ? `, ${here} here` : ''}; T has no better day left for it`;
  });
}

export function dayScore(planner: DayCore | null, date: string, dayStops: any[], changes: DayChange[]): DayScore | null {
  if (!planner?.run || !planner.best) return null;
  const tierOf = (id: string) => planner.tiers.get(id) ?? null;
  const tz: string | undefined = planner.run.params?.tz;
  const reason = mineReason(planner.mine, date, dayStops, tierOf, tz);
  const best = planner.run.stats?.exp_big != null ? Number(planner.run.stats.exp_big) : expShots(planner.best, tierOf);
  const mine = reason ? null : planner.run.stats?.exp_big_mine != null ? Number(planner.run.stats.exp_big_mine) : expShots(planner.mine, tierOf);
  const bigOnDay = [planner.best, planner.mine].some(p => (p?.visits ?? []).some(v => isBig(tierOf(v.stop_id))));
  const first = planner.best.visits.filter(v => v.p_good != null && v.start).sort((a, b) => a.start!.localeCompare(b.start!))[0] ?? null;
  const today = tripToday(planner.run, date);
  const week = weekTotals(planner.week ?? null, tierOf, date < today ? date : today, id => !!planner.nailed?.has(id));
  // T's day can score below yours: it moved a big subject to a better day of the week.
  let lowerWhy: string | null = null;
  if (mine != null && best + 0.05 < mine) {
    const wk = planner.week ?? null;
    const gone = changes.find(c => c.kind === 'skipped' && isBig(tierOf(c.stop_id)) && elsewhere(wk, c.stop_id, date, today).length > 0);
    const to = gone ? elsewhere(wk, gone.stop_id, date, today)[0] : null;
    lowerWhy = gone && to
      ? `T's day is lower than yours because it moves ${gone.name} to Day ${to.dayNumber}, where it's a ${VERDICT_TEXT[verdictOf(to.visit.p_good)]}. The week is what counts.`
      : "T's day is lower than yours because it saves big subjects for better days. The week is what counts.";
  }
  return {
    mine, best, others: expShots(planner.best, tierOf, false), bigOnDay, reason, changes,
    reasons: moveReasons(changes.filter(c => isBig(tierOf(c.stop_id)) || c.kind !== 'skipped'), planner, date),
    week, late: lateReplan(planner.run, [planner.best, planner.mine]), first, lowerWhy,
  };
}

