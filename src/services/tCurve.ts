import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// T's own chance curve for one stop on one date (planner look round 2, Phil 28 Nov 2026): RPC t_stop_curve(p_stop, p_date)
// reads T's newest build for that day (forecast, morning, camera look or re-plan now) and gives, per 15 minutes, the
// average shot value (pct 0-100) and how many of the weather versions call it good. null = past the forecast (no build).
export type TSlot = { t: string; pct: number; good: number; of: number };
export type TCurve = { kind: string; made: string; slots: TSlot[] } | null;

const KEY = (stop: string, date: string) => `tcurve:${stop}:${date}`;
const mem = new Map<string, { at: number; v: TCurve }>();

export async function fetchTCurve(stopId: string, date: string): Promise<TCurve> {
  const k = KEY(stopId, date);
  const hit = mem.get(k);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v;
  try {
    const { data, error } = await supabase.rpc('t_stop_curve', { p_stop: stopId, p_date: date });
    if (error) throw error;
    const v = (data ?? null) as TCurve;
    mem.set(k, { at: Date.now(), v });
    AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});
    return v;
  } catch (e) {
    // No signal: the copy saved on the phone (undefined = never saved, shown as loading failed).
    const saved = await AsyncStorage.getItem(k).catch(() => null);
    if (saved != null) return JSON.parse(saved) as TCurve;
    throw e;
  }
}

// undefined while loading (or unreachable with nothing saved), null = no forecast that day.
export function useTCurves(stopId: string | null | undefined, dates: string[]): Map<string, TCurve | undefined> {
  const [m, setM] = useState<Map<string, TCurve | undefined>>(new Map());
  const key = `${stopId}|${dates.join(',')}`;
  useEffect(() => {
    if (!stopId || !dates.length) return;
    let alive = true;
    dates.forEach(d => {
      fetchTCurve(stopId, d).then(v => { if (alive) setM(prev => new Map(prev).set(d, v)); }).catch(() => {});
    });
    return () => { alive = false; };
  }, [key]);
  return m;
}

// The best window: the run of slots around the highest value that stay within 1 point of it.
export function bestWindow(slots: TSlot[]): [number, number] | null {
  if (!slots.length) return null;
  let top = 0;
  slots.forEach((s, i) => { if (s.pct > slots[top].pct) top = i; });
  if (slots[top].pct <= 0) return null;
  let a = top, b = top;
  while (a > 0 && slots[a - 1].pct >= slots[top].pct - 1) a--;
  while (b < slots.length - 1 && slots[b + 1].pct >= slots[top].pct - 1) b++;
  return [a, b];
}
