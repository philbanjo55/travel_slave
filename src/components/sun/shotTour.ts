import type { SunPlan, SunStop } from '../../services/sunPlan';
import type { Pair } from '../../utils/sunEngine';

// Every shot of a trip in order (Phil, 14 Nov 2026: step through all the shots in the full-screen 3D view):
// by day, then the stop's place in the day, and within a stop the starred shot first, then the stop's own order.
// The shots come from the trip's sun plan (already on the phone); the day order, stop names and times from the trip
// as the app holds it (useTripStore). Stops off every day (set aside) have no date in the sun plan and are left out;
// a stop the trip data does not list goes by its date, after the listed ones of that date.

export type TourShot = {
  stopId: string;
  stopName: string;
  timeLabel: string | null;
  stop: SunStop;
  pair: Pair;
};

type DayLike = { day_number?: number | null; date?: string | null; stops?: { id: string; name?: string | null; position?: number | null; time_label?: string | null }[] };

export function buildTour(plan: SunPlan | null, days: DayLike[] | null | undefined, stars: Record<string, string | null> = {}): TourShot[] {
  if (!plan?.stops) return [];
  const where: Record<string, { day: number; pos: number; name: string; time: string | null }> = {};
  for (const d of days ?? []) {
    for (const s of d.stops ?? []) {
      if (s?.id) where[s.id] = { day: d.day_number ?? 9999, pos: s.position ?? 9999, name: s.name ?? '', time: s.time_label ?? null };
    }
  }
  const stops = Object.entries(plan.stops)
    .filter(([, st]) => st && Array.isArray(st.pairs) && st.pairs.length && st.date)
    .map(([id, st]) => ({ id, st, w: where[id] }));
  stops.sort((a, b) => (a.st.date < b.st.date ? -1 : a.st.date > b.st.date ? 1 : 0)
    || (a.w ? a.w.day : 99999) - (b.w ? b.w.day : 99999)
    || (a.w ? a.w.pos : 99999) - (b.w ? b.w.pos : 99999)
    || (a.w?.name ?? '').localeCompare(b.w?.name ?? '')
    || a.id.localeCompare(b.id));
  const out: TourShot[] = [];
  for (const { id, st, w } of stops) {
    const star = stars[id] ?? null;
    const isStar = (p: Pair) => p.starred === true || (!!star && p.vantage_id === star);
    const pairs = [...st.pairs.filter(isStar), ...st.pairs.filter(p => !isStar(p))];
    for (const p of pairs) out.push({ stopId: id, stopName: w?.name || p.shot_name || p.subject_name || 'Stop', timeLabel: w?.time ?? null, stop: st, pair: p });
  }
  return out;
}
