// T2 helpers (3 Nov 2026): the pure parts of what T shows the app, kept apart so they can be
// unit tested (t2.test.ts, `node --test`). index.ts imports them.

export type Cal = { a: number; b: number };

// Calibrated chance of a good shot (truth V >= 0.6) from a visit's mean value (0..1).
export const calChance = (cal: Cal, value: number) => 1 / (1 + Math.exp(-(cal.a + cal.b * value)));

// Fallback fits (solver_t_calib, 3 Nov 2026) when the table can't be read.
export const CAL_FALLBACK: Record<'teton' | 'faroes', Cal> = {
  teton: { a: -4.53, b: 8.157 },
  faroes: { a: -3.65, b: 7.831 },
};
export const regionOf = (lat: number) => (lat > 55 ? 'faroes' : 'teton') as 'teton' | 'faroes';

// Minutes after local midnight -> "7:05 AM" (wraps past midnight either way).
export const hm12 = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440, h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// Sun altitude (deg) -> a plain word for the light.
export const lightWordOf = (alt: number) => (alt < -0.8 ? 'blue hour' : alt < 6 ? 'golden hour' : alt < 15 ? 'low sun' : 'daylight');

// solver_light_cache.light -> the app's words.
export const LIGHT_WORD: Record<string, string> = { front: 'front', side: 'side', backlit: 'back', 'in shadow': 'soft', 'no sun': 'no sun' };

export type ReasonIn = {
  anchor: boolean; rated: boolean; lightOnly: boolean; nGood: number | null; nFc: number | null;
  peakMinutes: number; peakAlt: number; waitMin: number; once: boolean;
};
// One plain line on why a visit is where it is.
export const reasonText = (r: ReasonIn) => {
  if (r.anchor) return 'Booked: kept at its time';
  if (!r.rated) return 'On the way';
  const parts = [r.lightOnly || r.nFc == null ? 'typical weather only (no forecast yet)' : `good in ${r.nGood} of ${r.nFc} forecasts`,
                 `best light ${hm12(r.peakMinutes)} (${lightWordOf(r.peakAlt)})`];
  if (r.waitMin >= 20) parts.push(`wait ${Math.round(r.waitMin)} min for it`);
  if (r.once) parts.push('once this trip');
  return parts.join(', ');
};

// Expected good shots: the sum of the chances, a place (key) counted once at its best visit,
// for every rated place (exp_all) and the top tiers alone (exp_big).
export const goodShotsOf = (vs: { chance?: number | null; key: string | null; top: boolean }[]) => {
  const best = new Map<string, { c: number; top: boolean }>();
  for (const x of vs) {
    if (x.chance == null || x.key == null) continue;
    if ((best.get(x.key)?.c ?? -1) < x.chance) best.set(x.key, { c: x.chance, top: x.top });
  }
  let all = 0, top = 0;
  for (const b of best.values()) { all += b.c; if (b.top) top += b.c; }
  return { exp_all: Math.round(all * 100) / 100, exp_big: Math.round(top * 100) / 100 };
};

// Why T's plan moved a stop off Phil's own time or day (null when it didn't).
export const moveWhyText = (m: {
  booked: boolean; nGood: number | null; nFc: number | null;
  own: { minutes: number; nGood: number | null; nFc: number | null } | null; startMinutes: number;
  ownDayLabel: string | null; sameDay: boolean;
}) => {
  if (m.booked || m.nGood == null) return null;
  if (m.own) {
    if (Math.abs(m.own.minutes - m.startMinutes) < 30 || m.own.nGood == null) return null;
    return `moved from your ${hm12(m.own.minutes)} to ${hm12(m.startMinutes)}: good in ${m.nGood} of ${m.nFc} forecasts then vs ${m.own.nGood} of ${m.own.nFc} at yours`;
  }
  if (m.ownDayLabel && !m.sameDay) return `moved here from your ${m.ownDayLabel}: good in ${m.nGood} of ${m.nFc} forecasts today`;
  if (!m.ownDayLabel) return `added: good in ${m.nGood} of ${m.nFc} forecasts today`;
  return null;
};
