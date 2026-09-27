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
  if (inflight[tripId]) {
    // A forced refresh (after an edit) must not reuse a download that
    // started before the edit: queue a fresh one behind it.
    return force ? inflight[tripId]!.then(() => refreshSunPlan(tripId, true)) : inflight[tripId]!;
  }
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
// the background. `ready` turns true once the saved copy has been checked, so
// callers can tell "no pairs" from "not loaded yet".
export function useSunStopState(tripId: string | null | undefined, stopId: string): { stop: SunStop | null; ready: boolean } {
  const [plan, setPlan] = useState<SunPlan | null>(tripId ? memory[tripId] ?? null : null);
  const [ready, setReady] = useState<boolean>(!!(tripId && memory[tripId]));

  useEffect(() => {
    if (!SUN_PLANNER_ENABLED || !tripId) return;
    let alive = true;
    const onUpdate = (id: string) => { if (alive && id === tripId && memory[id]) { setPlan(memory[id]); setReady(true); } };
    listeners.add(onUpdate);
    (async () => {
      if (!memory[tripId]) {
        const cached = await readCached(tripId);
        if (cached && !memory[tripId]) memory[tripId] = cached;
        if (alive && memory[tripId]) setPlan(memory[tripId]);
      }
      if (alive) setReady(true);
      refreshSunPlan(tripId);
    })();
    return () => { alive = false; listeners.delete(onUpdate); };
  }, [tripId]);

  const s = plan?.stops?.[stopId];
  const stop = !s || !Array.isArray(s.pairs) || s.pairs.length === 0 || !s.date ? null : s;
  return { stop, ready };
}

export function useSunStop(tripId: string | null | undefined, stopId: string): SunStop | null {
  return useSunStopState(tripId, stopId).stop;
}

// ── Editing a stop's pairs (needs a connection) ─────────────────────────────

export type PairCheck = {
  vantage_id: string;
  code: string | null;
  vantage_name: string;
  v_lat: number; v_lng: number; v_ground_m: number | null; v_status: string | null;
  subject_id: string;
  subject_name: string;
  s_lat: number; s_lng: number; s_height_m: number | null; s_ground_m: number | null; s_status: string | null;
  bearing: number | null;
  dist_m: number;
  warnings: string[];
};

export type PairInput = {
  vantageId?: string | null;   // set to edit a pair already on the stop
  code?: string | null;
  vantageName: string;
  vLat: number; vLng: number;
  subjectName: string;
  sLat: number; sLng: number;
  sHeight?: number | null;
};

function rpcError(error: any): Error {
  const msg = String(error?.message ?? error ?? 'Something went wrong');
  if (/network|fetch|timed out/i.test(msg)) return new Error('No connection. Try again when you have signal.');
  return new Error(msg);
}

export async function fetchStopPairs(stopId: string): Promise<PairCheck[]> {
  const { data, error } = await supabase.rpc('sun_stop_pairs', { p_stop_id: stopId });
  if (error) throw rpcError(error);
  return Array.isArray(data) ? (data as PairCheck[]) : [];
}

export async function saveSunPair(tripId: string, stopId: string, p: PairInput): Promise<PairCheck> {
  const { data, error } = await supabase.rpc('sun_pair_save', {
    p_stop_id: stopId,
    p_vantage_id: p.vantageId ?? null,
    p_code: p.code ?? null,
    p_vantage_name: p.vantageName,
    p_v_lat: p.vLat, p_v_lng: p.vLng,
    p_subject_name: p.subjectName,
    p_s_lat: p.sLat, p_s_lng: p.sLng,
    p_s_height: p.sHeight ?? null,
  });
  if (error) throw rpcError(error);
  refreshSunPlan(tripId, true);   // the planner picks up the change
  return data as PairCheck;
}

export async function removeSunPair(tripId: string, stopId: string, vantageId: string): Promise<void> {
  const { error } = await supabase.rpc('sun_pair_remove', { p_stop_id: stopId, p_vantage_id: vantageId });
  if (error) throw rpcError(error);
  refreshSunPlan(tripId, true);
}
