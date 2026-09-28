import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import { downloadPhoto } from './photoCache';
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
      saveVantagePhotos(plan);
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

// Vantage reference photos go into the same on-phone store as trip photos, so
// they show offline. Already-saved ones are skipped; failures just retry on
// the next refresh.
async function saveVantagePhotos(plan: SunPlan): Promise<void> {
  const seen = new Set<string>();
  for (const st of Object.values(plan.stops ?? {})) {
    for (const p of st?.pairs ?? []) {
      if (!p.photo_id || !p.photo_url || seen.has(p.photo_id)) continue;
      seen.add(p.photo_id);
      await downloadPhoto(p.photo_id, p.photo_url).catch(() => {});
    }
  }
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
  shot_name: string | null;
  v_lat: number; v_lng: number; v_ground_m: number | null; v_status: string | null;
  subject_id: string;
  subject_name: string;
  s_lat: number; s_lng: number; s_height_m: number | null; s_ground_m: number | null; s_status: string | null;
  photo_id: string | null;
  photo_url: string | null;
  bearing: number | null;
  dist_m: number;
  warnings: string[];
};

export type ShotInput = {
  vantageId?: string | null;   // set to edit a shot already on the stop
  name: string;                // the shot's name
  vLat: number; vLng: number;
  sLat: number; sLng: number;
  sHeight?: number | null;
  subjectId?: string | null;   // share this subject point (add only)
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

// Adds or edits a shot. The label (T1, T2, ...) is assigned by the database.
export async function saveSunShot(tripId: string, stopId: string, p: ShotInput): Promise<PairCheck> {
  const { data, error } = await supabase.rpc('sun_shot_save', {
    p_stop_id: stopId,
    p_vantage_id: p.vantageId ?? null,
    p_name: p.name,
    p_v_lat: p.vLat, p_v_lng: p.vLng,
    p_s_lat: p.sLat, p_s_lng: p.sLng,
    p_s_height: p.sHeight ?? null,
    p_subject_id: p.subjectId ?? null,
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

// Sets (or clears, with null) a vantage's reference photo.
export async function setVantagePhoto(tripId: string, vantageId: string, photoId: string | null): Promise<PairCheck> {
  const { data, error } = await supabase.rpc('sun_vantage_set_photo', { p_vantage_id: vantageId, p_photo_id: photoId });
  if (error) throw rpcError(error);
  refreshSunPlan(tripId, true);
  return data as PairCheck;
}

// ── Shots from other stops (linked, not copied) ─────────────────────────────

export type TripShot = {
  vantage_id: string;
  code: string | null;
  shot_name: string;
  photo_id: string | null;
  photo_url: string | null;
  on_this_stop: boolean;
  stops: { stop_id: string; name: string; day: number }[];
};

// Every shot in the trip, marked with whether this stop already shows it.
export async function fetchTripShots(stopId: string): Promise<TripShot[]> {
  const { data, error } = await supabase.rpc('sun_trip_shots', { p_stop_id: stopId });
  if (error) throw rpcError(error);
  return Array.isArray(data) ? (data as TripShot[]) : [];
}

// Shows these shots on this stop too. The same shot, not a copy: editing it
// anywhere changes it everywhere; the sun is worked out for each stop's own
// date and time. Returns how many were added.
export async function linkShots(tripId: string, stopId: string, vantageIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('sun_pair_link', { p_stop_id: stopId, p_vantage_ids: vantageIds });
  if (error) throw rpcError(error);
  refreshSunPlan(tripId, true);
  return typeof data === 'number' ? data : 0;
}
