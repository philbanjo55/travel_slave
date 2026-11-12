import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { IS_TEST_APP } from '../utils/variant';

// Elevation files for the 3D sun view (TEST app). One file per area, listed in
// public.terrain_regions and kept in the public Storage bucket `terrain`. The
// file is downloaded once and saved on the phone, so the view works with no
// signal afterwards. Nothing here touches the trip or weather caches.
//
// Two levels: a region is the wide grid (about 30 m a point). Where shots are
// close to their subject (the Faroes), public.terrain_near_regions lists small
// fine boxes (4-7 m a point) inside a region; a shot whose stand spot sits in
// one gets that file too, and the page draws both.
//
// Saved ahead (TEST app): whenever a trip's sun plan loads, saveTripTerrain
// fetches every file that trip's stand spots need, one at a time in the
// background, so a stop never opened at home still has its 3D view in the field.

export type TerrainRegion = {
  id: string;
  north: number; south: number; west: number; east: number;
  n: number; width_m: number; depth_m: number; base_m: number; step_m: number;
  path: string; bytes: number | null; ground: 'snow' | 'green';
};

export type TerrainNear = {
  id: string; parent: string;
  north: number; south: number; west: number; east: number;
  n: number; base_m: number; step_m: number;
  path: string; bytes: number | null;
};
type Point = { lat: number; lng: number };
type Box = { north: number; south: number; west: number; east: number };

const FILES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/';
const DIR = `${FileSystem.documentDirectory}pf_cache/`;
const LIST_FILE = `${DIR}terrain_regions.json`;
const NEAR_FILE = `${DIR}terrain_near_regions.json`;
const CALL_TIMEOUT_MS = 12000;

let regions: TerrainRegion[] | null = null;
let nears: TerrainNear[] | null = null;
const data: Record<string, string> = {};
const inflight: Record<string, Promise<string | null> | undefined> = {};

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

// The lists of areas (12 Nov 2026: saved copy first). With no signal the 3D view used to wait for the server to
// time out, once for each list (up to 24 s), before it looked at what the phone already had. Now a saved list is
// used at once and the server is asked behind it; its answer replaces the list in memory and on the phone for the
// next use. Only a phone with nothing saved waits for the server.
async function readList<T>(file: string): Promise<T[] | null> {
  try {
    const saved = JSON.parse(await FileSystem.readAsStringAsync(file));
    return Array.isArray(saved) && saved.length ? (saved as T[]) : null;
  } catch {
    return null;
  }
}

async function askList<T>(table: string, columns: string, file: string): Promise<T[] | null> {
  try {
    const call = supabase.from(table).select(columns);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('terrain list timed out')), CALL_TIMEOUT_MS));
    const { data: rows, error } = (await Promise.race([call, timeout])) as any;
    if (error || !Array.isArray(rows)) return null;
    try { await ensureDir(); await FileSystem.writeAsStringAsync(file, JSON.stringify(rows)); } catch { /* the list is still usable */ }
    return rows as T[];
  } catch {
    return null;
  }
}

const REGION_COLS = 'id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground';
const NEAR_COLS = 'id, parent, north, south, west, east, n, base_m, step_m, path, bytes';
let regionsAsk: Promise<TerrainRegion[] | null> | null = null;
let nearsAsk: Promise<TerrainNear[] | null> | null = null;

// The server's own list: one call at a time, kept in memory once it has answered.
function freshRegions(): Promise<TerrainRegion[] | null> {
  if (regions) return Promise.resolve(regions);
  if (!regionsAsk) regionsAsk = askList<TerrainRegion>('terrain_regions', REGION_COLS, LIST_FILE)
    .then(rows => { if (rows) regions = rows; regionsAsk = null; return rows; });
  return regionsAsk;
}

async function loadRegions(): Promise<TerrainRegion[]> {
  if (regions) return regions;
  const saved = await readList<TerrainRegion>(LIST_FILE);
  if (saved) { freshRegions().catch(() => undefined); return saved; }
  return (await freshRegions()) ?? [];
}

// The fine boxes. None (no table yet, no signal and nothing saved) just means every shot draws from the wide grid.
async function loadNear(): Promise<TerrainNear[]> {
  if (nears) return nears;
  const ask = () => {
    if (!nearsAsk) nearsAsk = askList<TerrainNear>('terrain_near_regions', NEAR_COLS, NEAR_FILE)
      .then(rows => { if (rows) nears = rows; nearsAsk = null; return rows; });
    return nearsAsk;
  };
  const saved = await readList<TerrainNear>(NEAR_FILE);
  if (saved) { ask().catch(() => undefined); return saved; }
  return (await ask()) ?? [];
}

export function inRegion(r: Box, p: Point): boolean {
  return p.lat <= r.north && p.lat >= r.south && p.lng >= r.west && p.lng <= r.east;
}

// The area that holds this spot, or null when no elevation file covers it.
export async function regionFor(p: { lat: number; lng: number }): Promise<TerrainRegion | null> {
  const all = await loadRegions();
  const hit = all.find(r => inRegion(r, p));
  if (hit || regions) return hit ?? null;
  // Not in the saved list: a new area may have been added since it was saved, so this once wait for the server.
  return ((await freshRegions()) ?? []).find(r => inRegion(r, p)) ?? null;
}

// The fine box for a shot: the smallest one inside this region that holds the stand spot, taking first the ones
// that hold the subject too (Faroes close-ups: both on the fine grid; Tetons: a sharp foreground, the peak far off).
// A box whose edge is right by the stand spot is no use (the page draws the wide grid along the edge), so it is skipped.
export async function nearFor(region: TerrainRegion, stand: Point, subject: Point): Promise<TerrainNear | null> {
  return pickNear(await loadNear(), region, stand, subject);
}
function pickNear(all: TerrainNear[], region: TerrainRegion, stand: Point, subject: Point): TerrainNear | null {
  const edge = 4.2 * Math.max(region.width_m, region.depth_m) / 767 + 30;   // metres; the page's blend strip (tools/sun3d/app_view.js)
  const kx = 111320 * Math.cos(stand.lat * Math.PI / 180), kz = 111132;
  let best: TerrainNear | null = null, bestBoth = false, bestArea = Infinity;
  for (const r of all) {
    if (r.parent !== region.id || !inRegion(r, stand)) continue;
    const inside = Math.min((r.north - stand.lat) * kz, (stand.lat - r.south) * kz, (stand.lng - r.west) * kx, (r.east - stand.lng) * kx);
    if (inside < edge) continue;
    const both = inRegion(r, subject), area = (r.north - r.south) * (r.east - r.west);
    if ((both && !bestBoth) || (both === bestBoth && area < bestArea)) { best = r; bestBoth = both; bestArea = area; }
  }
  return best;
}

type TerrainFile = { id: string; path: string; bytes: number | null };
const fileFor = (r: TerrainFile) => `${DIR}terrain_${r.id}_${r.bytes ?? 0}.png`;
const fetching: Record<string, Promise<boolean> | undefined> = {};

async function onPhone(r: TerrainFile): Promise<boolean> {
  try { const info = await FileSystem.getInfoAsync(fileFor(r)); return info.exists && !!(info as any).size; } catch { return false; }
}

// Makes sure the file is on the phone (downloads it when it is not). Never throws; false = not there and no signal.
function saveFile(r: TerrainFile): Promise<boolean> {
  const file = fileFor(r), running = fetching[file];
  if (running) return running;
  const job = (async () => {
    try {
      await ensureDir();
      if (await onPhone(r)) return true;
      const tmp = `${file}.tmp`;
      const res = await FileSystem.downloadAsync(FILES_URL + r.path, tmp);
      if (res.status !== 200) { await FileSystem.deleteAsync(tmp, { idempotent: true }); return false; }
      await FileSystem.deleteAsync(file, { idempotent: true });
      await FileSystem.moveAsync({ from: tmp, to: file });
      return true;
    } catch {
      return false;
    } finally {
      fetching[file] = undefined;
    }
  })();
  fetching[file] = job;
  return job;
}

// The elevation file of a region or a fine box as base64, from the phone when it is already saved.
export function terrainData(r: TerrainFile): Promise<string | null> {
  if (data[r.id]) return Promise.resolve(data[r.id]);
  const running = inflight[r.id];
  if (running) return running;
  const job = (async () => {
    try {
      if (!(await saveFile(r))) return null;
      const b64 = await FileSystem.readAsStringAsync(fileFor(r), { encoding: 'base64' as any });
      if (!b64) return null;
      data[r.id] = b64;
      return b64;
    } catch {
      return null;
    } finally {
      inflight[r.id] = undefined;
    }
  })();
  inflight[r.id] = job;
  return job;
}

// ---- Saved ahead for a whole trip ----

// areas = the files the trip's stand spots need (wide regions + fine boxes); saved = how many are on the phone.
export type TripTerrain = { areas: number; saved: number; bytes: number; busy: boolean };
const tripState: Record<string, TripTerrain | undefined> = {};
const tripRun: Record<string, { again: Shot[] | null } | undefined> = {};
const tripListeners = new Set<(tripId: string) => void>();
type Shot = { v: Point; s: Point };

function setTrip(tripId: string, t: TripTerrain): void {
  tripState[tripId] = t;
  tripListeners.forEach(fn => fn(tripId));
}

// Every terrain file this trip's shots use, by the same choice the 3D panel makes. Works with no signal from the saved lists.
async function tripFiles(shots: Shot[]): Promise<TerrainFile[]> {
  const out = new Map<string, TerrainFile>();
  const [all, allNear] = [await loadRegions(), await loadNear()];   // asked once, not per shot
  for (const sh of shots) {
    const r = all.find(x => inRegion(x, sh.v));
    if (!r) continue;
    out.set(`r:${r.id}`, r);
    const nr = pickNear(allNear, r, sh.v, sh.s);
    if (nr) out.set(`n:${nr.id}`, nr);
  }
  return [...out.values()];
}

// Called whenever a trip's sun plan is loaded or refreshed. TEST app only. Fetches what is missing, one file at a
// time, in the background; returns at once, never throws, and never holds anything else up. A file that fails (no
// signal) is simply tried again the next time the plan loads.
export function saveTripTerrain(tripId: string, shots: Shot[]): void {
  if (!IS_TEST_APP || !tripId) return;
  const run = tripRun[tripId];
  if (run) { run.again = shots; return; }   // one run per trip; the newest pins go next
  const mine: { again: Shot[] | null } = { again: null };
  tripRun[tripId] = mine;
  (async () => {
    try {
      const files = await tripFiles(shots);
      const bytes = files.reduce((n, f) => n + (f.bytes ?? 0), 0);
      const have = await Promise.all(files.map(onPhone));
      let saved = have.filter(Boolean).length;
      setTrip(tripId, { areas: files.length, saved, bytes, busy: saved < files.length });
      for (let i = 0; i < files.length; i++) {
        if (have[i]) continue;
        if (await saveFile(files[i])) { saved++; setTrip(tripId, { areas: files.length, saved, bytes, busy: true }); }
      }
      setTrip(tripId, { areas: files.length, saved, bytes, busy: false });
    } catch {
      const t = tripState[tripId];
      if (t) setTrip(tripId, { ...t, busy: false });
    } finally {
      tripRun[tripId] = undefined;
      if (mine.again) saveTripTerrain(tripId, mine.again);
    }
  })();
}

// For the 3D panel's status line: null until the trip's files have been counted.
export function useTripTerrain(tripId: string | null | undefined): TripTerrain | null {
  const [t, setT] = useState<TripTerrain | null>(tripId ? tripState[tripId] ?? null : null);
  useEffect(() => {
    if (!tripId) { setT(null); return; }
    setT(tripState[tripId] ?? null);
    const on = (id: string) => { if (id === tripId) setT(tripState[id] ?? null); };
    tripListeners.add(on);
    return () => { tripListeners.delete(on); };
  }, [tripId]);
  return t;
}

export function tripTerrainLine(t: TripTerrain | null): string | null {
  if (!t || t.areas === 0) return null;
  if (t.saved >= t.areas) return `3D terrain saved for this trip: ${t.saved} of ${t.areas} areas. Works with no signal.`;
  const left = t.areas - t.saved;
  return t.busy ? `Saving 3D terrain for this trip: ${t.saved} of ${t.areas} areas…` : `3D terrain: ${left} of ${t.areas} areas still to download (needs signal).`;
}
