import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import type { Pair } from '../utils/sunEngine';

// Sun & Moon planner data: which vantage -> subject pairs each stop has, with
// their pins and terrain skylines (public.trip_sun_plan). Kept entirely apart
// from the trip and weather sync: its own call, its own cache file. If the
// call fails the last saved copy is used; if there is none the section simply
// does not appear. Nothing here can hold up or break the trip loading.

// Kill switch: false hides the Sun & Moon section everywhere and makes no calls.
export const SUN_PLANNER_ENABLED = true;

export type SunStop = {
  date: string;            // the stop's day, YYYY-MM-DD
  tz: string;
  utc_offset_min: number;  // on that date, so summer time is right
  pairs: Pair[];
};
export type SunPlan = {
  trip_id: string;
  generated_at: string;
  stops: Record<string, SunStop>;
};

const CACHE_DIR = `${FileSystem.documentDirectory}pf_cache/`;
const planFile = (tripId: string) => `${CACHE_DIR}sun_${tripId}.json`;
const REFRESH_EVERY_MS = 10 * 60 * 1000;
const CALL_TIMEOUT_MS = 15000;

const memory: Record<string, SunPlan> = {};
const lastTried: Record<string, number> = {};
const inflight: Record<string, Promise<SunPlan | null> | undefined> = {};
const listeners = new Set<(tripId: string) => void>();

function isPlan(x: any): x is SunPlan {
  return !!x && typeof x === 'object' && typeof x.stops === 'object' && x.stops !== null;
}

async function readCached(tripId: string): Promise<SunPlan | null> {
  try {
    const info = await FileSystem.getInfoAsync(planFile(tripId));
    if (!info.exists) return null;
    const p = JSON.parse(await FileSystem.readAsStringAsync(planFile(tripId)));
    return isPlan(p) ? p : null;
  } catch {
    return null;
  }
}

// Temp file then move, as the trip cache does, so a crash mid-write never
// leaves a truncated copy in place of a good one.
async function writeCached(tripId: string, plan: SunPlan): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  const tmp = `${planFile(tripId)}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(plan));
  await FileSystem.deleteAsync(planFile(tripId), { idempotent: true });
  await FileSystem.moveAsync({ from: tmp, to: planFile(tripId) });
}

async function fetchPlan(tripId: string): Promise<SunPlan | null> {
  const call = supabase.rpc('trip_sun_plan', { p_trip_id: tripId });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('sun plan timed out')), CALL_TIMEOUT_MS));
  const { data, error } = (await Promise.race([call, timeout])) as any;
  if (error) throw error;
  return isPlan(data) ? data : null;
}

// Refreshes from the network at most every 10 minutes per trip. Never throws.
export function refreshSunPlan(tripId: string, force = false): Promise<SunPlan | null> {
  if (!SUN_PLANNER_ENABLED) return Promise.resolve(null);
  if (inflight[tripId]) return inflight[tripId]!;
  if (!force && Date.now() - (lastTried[tripId] ?? 0) < REFRESH_EVERY_MS) {
    return Promise.resolve(memory[tripId] ?? null);
  }
  lastTried[tripId] = Date.now();
  const p = (async () => {
    try {
      const plan = await fetchPlan(tripId);
      if (!plan) return memory[tripId] ?? null;
      memory[tripId] = plan;
      listeners.forEach(fn => fn(tripId));
      writeCached(tripId, plan).catch(e => console.warn('[sun] cache write failed:', e));
      return plan;
    } catch (e) {
      console.warn('[sun] plan fetch failed, keeping the saved copy:', e);
      return memory[tripId] ?? null;
    } finally {
      inflight[tripId] = undefined;
    }
  })();
  inflight[tripId] = p;
  return p;
}

// The pairs for one stop: from memory, else the saved file, then refreshed in
// the background. Returns null until there is something to show.
export function useSunStop(tripId: string | null | undefined, stopId: string): SunStop | null {
  const [plan, setPlan] = useState<SunPlan | null>(tripId ? memory[tripId] ?? null : null);

  useEffect(() => {
    if (!SUN_PLANNER_ENABLED || !tripId) return;
    let alive = true;
    const onUpdate = (id: string) => { if (alive && id === tripId && memory[id]) setPlan(memory[id]); };
    listeners.add(onUpdate);
    (async () => {
      if (!memory[tripId]) {
        const cached = await readCached(tripId);
        if (cached && !memory[tripId]) memory[tripId] = cached;
        if (alive && memory[tripId]) setPlan(memory[tripId]);
      }
      refreshSunPlan(tripId);
    })();
    return () => { alive = false; listeners.delete(onUpdate); };
  }, [tripId]);

  const s = plan?.stops?.[stopId];
  if (!s || !Array.isArray(s.pairs) || s.pairs.length === 0 || !s.date) return null;
  return s;
}
