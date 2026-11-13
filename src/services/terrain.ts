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
// Third level (Grand Teton): public.terrain_detail_regions lists small boxes
// (about 500 m, 0.5-1 m a point) around a stand spot, made from a public laser
// survey: the highest return per cell, so trees and buildings are real shapes,
// plus a class mask (tree / building / water) for their colours. Two files a
// box. The page draws it inside the fine box, or the wide grid without one.
//
// Saved ahead (TEST app): whenever a trip's sun plan loads, saveTripTerrain
// fetches every file that trip's stand spots need, one at a time in the
// background, so a stop never opened at home still has its 3D view in the field.

export type TerrainRegion = {
  id: string;
  north: number; south: number; west: number; east: number;
  n: number; width_m: number; depth_m: number; base_m: number; step_m: number;
  path: string; bytes: number | null; ground: 'snow' | 'green';
  // Grand Teton (13 Nov 2026, absent until its migration is applied): a winter colour file of the whole grid (JPEG,
  // a foreground file: sent after the plain view) and the credit line to show with it
  color_path?: string | null; color_bytes?: number | null; color_credit?: string | null;
};

export type TerrainNear = {
  id: string; parent: string;
  north: number; south: number; west: number; east: number;
  n: number; base_m: number; step_m: number;
  path: string; bytes: number | null;
  // Faroes (absent until its migration is applied): an aerial photo of the box, for colour beyond the detail box
  color_path?: string | null; color_bytes?: number | null;
};
export type TerrainDetail = {
  id: string; parent: string;
  north: number; south: number; west: number; east: number;
  n: number; base_m: number; step_m: number;
  path: string; bytes: number | null;
  mask_path: string | null; mask_bytes: number | null;
  // round 3 (absent until its migration is applied): the trees' own laser returns, and where the water is in the 6 km around
  trees_path?: string | null; trees_bytes?: number | null; trees_bins?: number | null; trees_bin_m?: number | null;
  water_path?: string | null; water_bytes?: number | null; water_n?: number | null;
  water_north?: number | null; water_south?: number | null; water_west?: number | null; water_east?: number | null;
  // Faroes (13 Nov 2026): an aerial photo of the box (JPEG) and its building outlines (JSON, heights guessed: drawn,
  // never in the sun times); width_m / depth_m = the box's size in the files' own metres
  color_path?: string | null; color_bytes?: number | null;
  buildings_path?: string | null; buildings_bytes?: number | null;
  width_m?: number | null; depth_m?: number | null;
};
type Point = { lat: number; lng: number };
type Box = { north: number; south: number; west: number; east: number };

const FILES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/';
const DIR = `${FileSystem.documentDirectory}pf_cache/`;
const LIST_FILE = `${DIR}terrain_regions.json`;
const NEAR_FILE = `${DIR}terrain_near_regions.json`;
const DETAIL_FILE = `${DIR}terrain_detail_regions.json`;
const CALL_TIMEOUT_MS = 12000;

let regions: TerrainRegion[] | null = null;
let nears: TerrainNear[] | null = null;
let details: TerrainDetail[] | null = null;
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

const REGION_COLS = '*';   // every column there is: naming one the table does not have yet (color_path) would fail the whole list
const NEAR_COLS = '*';   // every column there is: naming one the table does not have yet (color_path) would fail the whole list
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

// The detail boxes. None (no table yet, no signal and nothing saved) just means no real foreground is drawn.
// Saved copy first, the server behind it: the list must never hold a first picture up (it is asked once per app run,
// and the answer replaces the saved copy for the next call).
let detailAsk: Promise<TerrainDetail[] | null> | null = null;
function askDetail(): Promise<TerrainDetail[] | null> {
  if (detailAsk) return detailAsk;
  detailAsk = (async () => {
    try {
      const call = supabase.from('terrain_detail_regions')
        .select('*');   // every column there is: naming one the table does not have yet would fail the whole list
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('terrain list timed out')), CALL_TIMEOUT_MS));
      const { data: rows, error } = (await Promise.race([call, timeout])) as any;
      if (error || !Array.isArray(rows)) throw error ?? new Error('no detail list');
      details = rows as TerrainDetail[];
      try { await ensureDir(); await FileSystem.writeAsStringAsync(DETAIL_FILE, JSON.stringify(rows)); } catch { /* the list is still usable */ }
      return details;
    } catch {
      detailAsk = null;   // no signal: asked again next time
      return null;
    }
  })();
  return detailAsk;
}
async function loadDetail(): Promise<TerrainDetail[]> {
  if (details) return details;
  const ask = askDetail();
  try {
    const saved = JSON.parse(await FileSystem.readAsStringAsync(DETAIL_FILE));
    if (Array.isArray(saved)) return saved as TerrainDetail[];
  } catch { /* nothing saved yet: wait for the server */ }
  return (await ask) ?? [];
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

// The detail box for a shot: one inside this region (and inside the shot's fine box when it has one: the page draws
// the detail inside that) that holds the stand spot at least 100 m from its edge, taking first the ones that hold the
// subject too, then the one the stand spot sits deepest in. `near` must be the fine box the shot really uses.
export async function detailFor(region: TerrainRegion, near: TerrainNear | null, stand: Point, subject: Point): Promise<TerrainDetail | null> {
  return pickDetail(await loadDetail(), region, near, stand, subject);
}
function pickDetail(all: TerrainDetail[], region: TerrainRegion, near: TerrainNear | null, stand: Point, subject: Point): TerrainDetail | null {
  const kx = 111320 * Math.cos(stand.lat * Math.PI / 180), kz = 111132;
  let best: TerrainDetail | null = null, bestBoth = false, bestIn = 0;
  for (const r of all) {
    if (r.parent !== region.id || !inRegion(r, stand)) continue;
    if (near && !(r.north <= near.north && r.south >= near.south && r.west >= near.west && r.east <= near.east)) continue;
    const inside = Math.min((r.north - stand.lat) * kz, (stand.lat - r.south) * kz, (stand.lng - r.west) * kx, (r.east - stand.lng) * kx);
    if (inside < 100) continue;
    const both = inRegion(r, subject);
    if (!best || (both && !bestBoth) || (both === bestBoth && inside > bestIn)) { best = r; bestBoth = both; bestIn = inside; }
  }
  return best;
}
// The class mask of a detail box, as a file of its own (null when the box has none: it then draws as bare shapes).
export function detailMask(d: TerrainDetail): TerrainFile | null {
  return d.mask_path ? { id: `${d.id}_mask`, path: d.mask_path, bytes: d.mask_bytes } : null;
}

// The two round 3 files of a detail box, each null when the row has none.
export function detailTrees(d: TerrainDetail): TerrainFile | null {
  return d.trees_path ? { id: `${d.id}_trees`, path: d.trees_path, bytes: d.trees_bytes ?? null } : null;
}
export function detailWater(d: TerrainDetail): TerrainFile | null {
  return d.water_path && d.water_n && d.water_north != null && d.water_south != null && d.water_west != null && d.water_east != null
    ? { id: `${d.id}_water`, path: d.water_path, bytes: d.water_bytes ?? null } : null;
}

// The Faroes extras, each null when the row has none: the detail box's photo and buildings, the fine box's photo.
export function detailColor(d: TerrainDetail): TerrainFile | null {
  return d.color_path ? { id: `${d.id}_color`, path: d.color_path, bytes: d.color_bytes ?? null } : null;
}
export function detailBuildings(d: TerrainDetail): TerrainFile | null {
  return d.buildings_path ? { id: `${d.id}_bld`, path: d.buildings_path, bytes: d.buildings_bytes ?? null } : null;
}
// The wide grid's winter colour (Grand Teton), null when the region has none.
export function regionColor(r: TerrainRegion): TerrainFile | null {
  return r.color_path ? { id: `${r.id}_color`, path: r.color_path, bytes: r.color_bytes ?? null } : null;
}
export function nearColor(n: TerrainNear): TerrainFile | null {
  return n.color_path ? { id: `${n.id}_color`, path: n.color_path, bytes: n.color_bytes ?? null } : null;
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

// areas = what the trip's stand spots need (wide regions, fine boxes, detail boxes); saved = how many are on the phone.
// A detail box is one area with up to six files (heights, class mask, tree returns, wide water; Faroes: photo,
// buildings), a fine box up to two (heights; Faroes: photo; Tetons: winter colour), a region up to two (heights;
// Tetons: winter colour): an area counts as saved when all its files are there.
export type TripTerrain = { areas: number; saved: number; bytes: number; busy: boolean };
const tripState: Record<string, TripTerrain | undefined> = {};
const tripRun: Record<string, { again: Shot[] | null } | undefined> = {};
const tripListeners = new Set<(tripId: string) => void>();
type Shot = { v: Point; s: Point };

function setTrip(tripId: string, t: TripTerrain): void {
  tripState[tripId] = t;
  tripListeners.forEach(fn => fn(tripId));
}

// Every terrain area this trip's shots use (each a list of files), by the same choice the 3D panel makes. Works with
// no signal from the saved lists.
async function tripAreas(shots: Shot[]): Promise<TerrainFile[][]> {
  const out = new Map<string, TerrainFile[]>();
  const [all, allNear, allDetail] = [await loadRegions(), await loadNear(), await loadDetail()];   // asked once, not per shot
  for (const sh of shots) {
    const r = all.find(x => inRegion(x, sh.v));
    if (!r) continue;
    out.set(`r:${r.id}`, [r, regionColor(r)].filter((f): f is TerrainFile => !!f));
    const nr = pickNear(allNear, r, sh.v, sh.s);
    if (nr) out.set(`n:${nr.id}`, [nr, nearColor(nr)].filter((f): f is TerrainFile => !!f));
    const dt = pickDetail(allDetail, r, nr, sh.v, sh.s);
    if (dt) out.set(`d:${dt.id}`, [dt, detailMask(dt), detailTrees(dt), detailWater(dt), detailColor(dt), detailBuildings(dt)].filter((f): f is TerrainFile => !!f));
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
      const areas = await tripAreas(shots);
      const bytes = areas.reduce((n, a) => n + a.reduce((k, f) => k + (f.bytes ?? 0), 0), 0);
      const have = await Promise.all(areas.map(async a => (await Promise.all(a.map(onPhone))).every(Boolean)));
      let saved = have.filter(Boolean).length;
      setTrip(tripId, { areas: areas.length, saved, bytes, busy: saved < areas.length });
      for (let i = 0; i < areas.length; i++) {
        if (have[i]) continue;
        let ok = true;
        for (const f of areas[i]) ok = (await saveFile(f)) && ok;   // files already there are not fetched again
        if (ok) { saved++; setTrip(tripId, { areas: areas.length, saved, bytes, busy: true }); }
      }
      setTrip(tripId, { areas: areas.length, saved, bytes, busy: false });
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
