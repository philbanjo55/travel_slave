// T's whole trip at once: each trip day's newest T plan ("your day" rank 0 and T's plan rank 1),
// read in two small queries. The trip page, the stop page and the Planner all use it, so a stop
// shows the same chance everywhere and every move can say where the stop went and why.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from './supabase';
import { Plan, PlanRun, fetchDayRuns, latestByDay } from './planner';
import { TDay, TWeek } from './plannerWeekPure';
import { withChance } from './plannerWords';
export * from './plannerWeekPure';

export async function fetchTWeek(tripId: string, days: any[]): Promise<TWeek> {
  const latest = latestByDay(await fetchDayRuns(tripId));
  const dayNo = new Map(days.filter((d: any) => d.date).map((d: any) => [d.date, d.day_number as number]));
  const runs: PlanRun[] = [];
  for (const [date, m] of latest) {
    const r = m.forecast ?? m.light;
    if (r && (dayNo.size === 0 || dayNo.has(date))) runs.push(r);
  }
  const plans: (Plan & { run_id: string })[] = [];
  if (runs.length) {
    const { data, error } = await supabase.from('solver_plans')
      .select('run_id, rank, objective, mean, cvar11, drive_minutes, long_leg_minutes, note, visits')
      .in('run_id', runs.map(r => r.id)).in('rank', [0, 1]);
    if (error) throw error;
    plans.push(...withChance((data ?? []) as any[]));
  }
  const out: TDay[] = runs.map(run => {
    const date = run.stats?.days?.[0]?.trip_date ?? run.plan_date;
    const ps = plans.filter(p => p.run_id === run.id);
    return { date, dayNumber: dayNo.get(date) ?? null, run, mine: ps.find(p => p.rank === 0), best: ps.find(p => p.rank === 1) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { days: out, byDate: new Map(out.map(d => [d.date, d])), at: Date.now() };
}

// One read per trip per minute, shared by every screen showing it.
const cache = new Map<string, { at: number; p: Promise<TWeek> }>();
export function tripWeek(tripId: string, days: any[], fresh = false): Promise<TWeek> {
  const hit = cache.get(tripId);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = fetchTWeek(tripId, days);
  cache.set(tripId, { at: Date.now(), p });
  p.catch(() => { if (cache.get(tripId)?.p === p) cache.delete(tripId); });
  return p;
}
export function forgetWeek(tripId?: string) { if (tripId) cache.delete(tripId); else cache.clear(); }

// The week, read again when the screen comes back into view or the app to the front.
export function useTWeek(tripId: string | null | undefined, days: any[], key?: string | null): TWeek | null {
  const [w, setW] = useState<TWeek | null>(null);
  const focused = useIsFocused();
  const [n, setN] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active' && Date.now() - last.current > 60_000) setN(x => x + 1); });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!tripId || !focused) return;
    let alive = true;
    last.current = Date.now();
    tripWeek(tripId, days).then(x => { if (alive) setW(x); }).catch(() => {});
    return () => { alive = false; };
  }, [tripId, focused, n, key, days.length]);
  return w;
}

