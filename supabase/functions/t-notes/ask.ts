// Ask T (Tell T, worksheet g4): questions that change nothing. The answers are put together here from what T has
// already stored (its newest plan for each day, the forecast grid per place), never written by Claude, so an answer
// cannot say something the plan does not.
import { dayWords, type TripCtx } from './logic.ts';

const list = (a: string[]) => a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const clockIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

// deno-lint-ignore no-explicit-any
export async function askT(db: any, ctx: TripCtx, q: { kind: string; places: string[]; text: string }): Promise<string[]> {
  const places = (q.places ?? []).map(n => ctx.places.find(p => p.name === n)).filter((p): p is NonNullable<typeof p> => !!p);
  if ((q.kind !== 'why' && q.kind !== 'best_day') || !places.length)
    return ["T can't answer that one yet. It can tell you why a place is on a day, the best day for a place, and what a change would cost (\"what if we skip ...\")."];
  const left = ctx.dates.filter(d => d >= ctx.today);
  const dates = left.length ? left : ctx.dates;
  // T's newest plan for each day (a whole-week accept is a copy, not a plan).
  const { data: runs } = await db.from('solver_runs').select('id, plan_date, created_at, stats').eq('trip_id', ctx.tripId)
    .eq('stats->>planner', 'T').in('plan_date', dates).order('created_at', { ascending: false }).limit(500);
  const newest = new Map<string, string>();
  // deno-lint-ignore no-explicit-any
  for (const r of (runs ?? []) as any[]) if (r.stats?.kind !== 'week_apply' && !newest.has(r.plan_date)) newest.set(r.plan_date, r.id);
  const { data: plans } = newest.size ? await db.from('solver_plans').select('run_id, visits').in('run_id', [...newest.values()]).eq('rank', 1) : { data: [] };
  // deno-lint-ignore no-explicit-any
  const visits = ((plans ?? []) as any[]).flatMap(p => (p.visits ?? []) as any[]).filter(v => !v.booked);
  const { data: grid } = await db.rpc('solver_subject_grid', { p_trip: ctx.tripId });
  const L: string[] = [];
  for (const p of places) {
    // deno-lint-ignore no-explicit-any
    const on = visits.filter((v: any) => v.name === p.name).sort((a: any, b: any) => String(a.start).localeCompare(String(b.start)));
    // deno-lint-ignore no-explicit-any
    const where = (v: any) => `${dayWords(v.trip_date ?? v.date)} at ${clockIn(v.start, ctx.tz)}`;
    // deno-lint-ignore no-explicit-any
    const pct = (v: any) => (typeof v.chance === 'number' ? ` About ${Math.round(v.chance * 100)}% chance of a good shot.` : '');
    // The forecast grid: each day's best moment for the place (any of its entries), best first.
    const best = new Map<string, { mean: number; at: string; source: string }>();
    // deno-lint-ignore no-explicit-any
    for (const g of ((grid ?? []) as any[]).filter(g => p.ids.includes(g.stop_id) && dates.includes(g.trip_date))) {
      const b = best.get(g.trip_date);
      if (!b || g.mean > b.mean) best.set(g.trip_date, { mean: Number(g.mean), at: g.best_at, source: g.source });
    }
    const ranked = [...best.entries()].sort((a, b) => b[1].mean - a[1].mean || a[0].localeCompare(b[0]));
    if (q.kind === 'why') {
      if (!on.length) L.push(`${p.name} is not on T's plan for any day left.`);
      // deno-lint-ignore no-explicit-any
      for (const v of on as any[]) L.push(`${p.name} is on ${where(v)}: ${v.why ?? 'its best fit that day'}.${v.move_why ? ` It ${v.move_why}.` : ''}${pct(v)}`);
    } else {
      if (ranked.length) {
        const top = ranked[0], near = ranked.filter(r => r !== top && top[1].mean - r[1].mean <= 0.05).slice(0, 2);
        const when = (r: typeof top) => `${dayWords(r[0])}${r[1].at ? ` around ${clockIn(r[1].at, ctx.tz)}` : ''}${r[1].source === 'light' ? ' (typical weather only, no forecast yet)' : ''}`;
        L.push(`${p.name} looks best on ${when(top)}${near.length ? `; ${list(near.map(r => dayWords(r[0])))} ${near.length === 1 ? 'is' : 'are'} about as good` : ''}.`);
        const worst = ranked[ranked.length - 1];
        if (ranked.length > 2 && top[1].mean - worst[1].mean > 0.15) L.push(`Its weakest day is ${dayWords(worst[0])}.`);
      } else L.push(`T has no forecast or light numbers for ${p.name} yet.`);
      // deno-lint-ignore no-explicit-any
      // deno-lint-ignore no-explicit-any
      const onBest = ranked.length && (on as any[]).some(v => ranked.some(r => r[0] === (v.trip_date ?? v.date) && ranked[0][1].mean - r[1].mean <= 0.05));
      L.push(on.length ? `T has it on ${list((on as any[]).map(where))}.${on.length === 1 ? pct(on[0]) : ''}${ranked.length && !onBest ? ' T picked that day to fit the rest of the week (every place once, the drives, your bookings).' : ''}` : `T has not put it on a day yet.`);
    }
  }
  return L;
}
