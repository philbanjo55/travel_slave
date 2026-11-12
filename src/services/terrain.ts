import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

// Elevation files for the 3D sun view (TEST app). One file per area, listed in
// public.terrain_regions and kept in the public Storage bucket `terrain`. The
// file is downloaded once and saved on the phone, so the view works with no
// signal afterwards. Nothing here touches the trip or weather caches.

export type TerrainRegion = {
  id: string;
  north: number; south: number; west: number; east: number;
  n: number; width_m: number; depth_m: number; base_m: number; step_m: number;
  path: string; bytes: number | null; ground: 'snow' | 'green';
};

const FILES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/';
const DIR = `${FileSystem.documentDirectory}pf_cache/`;
const LIST_FILE = `${DIR}terrain_regions.json`;
const CALL_TIMEOUT_MS = 12000;

let regions: TerrainRegion[] | null = null;
const data: Record<string, string> = {};
const inflight: Record<string, Promise<string | null> | undefined> = {};

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

async function loadRegions(): Promise<TerrainRegion[]> {
  if (regions) return regions;
  try {
    const call = supabase.from('terrain_regions')
      .select('id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground');
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('terrain list timed out')), CALL_TIMEOUT_MS));
    const { data: rows, error } = (await Promise.race([call, timeout])) as any;
    if (error || !Array.isArray(rows)) throw error ?? new Error('no terrain list');
    regions = rows as TerrainRegion[];
    try { await ensureDir(); await FileSystem.writeAsStringAsync(LIST_FILE, JSON.stringify(rows)); } catch { /* the list is still usable */ }
    return regions;
  } catch {
    // No signal: the last saved list. Not kept in memory, so the next try asks again.
    try {
      const saved = JSON.parse(await FileSystem.readAsStringAsync(LIST_FILE));
      return Array.isArray(saved) ? (saved as TerrainRegion[]) : [];
    } catch {
      return [];
    }
  }
}

export function inRegion(r: TerrainRegion, p: { lat: number; lng: number }): boolean {
  return p.lat <= r.north && p.lat >= r.south && p.lng >= r.west && p.lng <= r.east;
}

// The area that holds this spot, or null when no elevation file covers it.
export async function regionFor(p: { lat: number; lng: number }): Promise<TerrainRegion | null> {
  const all = await loadRegions();
  return all.find(r => inRegion(r, p)) ?? null;
}

// The region's elevation file as base64, from the phone when it is already saved.
export function terrainData(r: TerrainRegion): Promise<string | null> {
  if (data[r.id]) return Promise.resolve(data[r.id]);
  const running = inflight[r.id];
  if (running) return running;
  const file = `${DIR}terrain_${r.id}_${r.bytes ?? 0}.png`;
  const job = (async () => {
    try {
      await ensureDir();
      const info = await FileSystem.getInfoAsync(file);
      if (!info.exists || !(info as any).size) {
        const tmp = `${file}.tmp`;
        const res = await FileSystem.downloadAsync(FILES_URL + r.path, tmp);
        if (res.status !== 200) { await FileSystem.deleteAsync(tmp, { idempotent: true }); return null; }
        await FileSystem.deleteAsync(file, { idempotent: true });
        await FileSystem.moveAsync({ from: tmp, to: file });
      }
      const b64 = await FileSystem.readAsStringAsync(file, { encoding: 'base64' as any });
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
