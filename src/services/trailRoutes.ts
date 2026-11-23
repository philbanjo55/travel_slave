import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

// Phil's AllTrails routes (GPX exports, table trail_routes, 23 Nov 2026) for the 3D view from above: a route belongs to
// the place where it runs, so a stop (on the real trip or a practice copy) gets every route whose box holds one of its
// shots' stand spots or the stop itself (1 km of slack). Saved on the phone, so the line shows with no signal.

export type TrailRoute = { id: string; name: string; coords: [number, number][] };   // [lng, lat]
type RouteMeta = { id: string; name: string; north: number; south: number; west: number; east: number; updated_at: string };

const DIR = `${FileSystem.documentDirectory}pf_cache/`;
const LIST = `${DIR}trail_routes.json`;
const routeFile = (m: RouteMeta) => `${DIR}trail_${m.id}_${Date.parse(m.updated_at) || 0}.json`;
const SLACK_DEG = 0.009;   // ~1 km

async function readJson<T>(f: string): Promise<T | null> {
  try { return JSON.parse(await FileSystem.readAsStringAsync(f)) as T; } catch { return null; }
}
async function writeJson(f: string, v: unknown) {
  try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch { /* there already */ }
  try { await FileSystem.writeAsStringAsync(f, JSON.stringify(v)); } catch { /* full phone: shown, not saved */ }
}

async function loadList(): Promise<RouteMeta[]> {
  try {
    const { data, error } = await supabase.from('trail_routes').select('id,name,north,south,west,east,updated_at');
    if (error) throw error;
    const rows = (data ?? []) as RouteMeta[];
    await writeJson(LIST, rows);
    return rows;
  } catch {
    return (await readJson<RouteMeta[]>(LIST)) ?? [];   // no signal: the list saved last time
  }
}

// Points closer than 4 m to the last one kept are dropped (a hand-drawn route has ~10,000)
function thin(coords: number[][]): [number, number][] {
  const out: [number, number][] = [];
  let lx = NaN, ly = NaN;
  for (const c of coords) {
    const lng = +c[0], lat = +c[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const dx = (lng - lx) * 111320 * Math.cos(lat * Math.PI / 180), dy = (lat - ly) * 111132;
    if (!out.length || Math.hypot(dx, dy) >= 4) { out.push([lng, lat]); lx = lng; ly = lat; }
  }
  const last = coords[coords.length - 1];
  if (last && out.length && (out[out.length - 1][0] !== +last[0] || out[out.length - 1][1] !== +last[1])) out.push([+last[0], +last[1]]);
  return out;
}

async function loadRoute(m: RouteMeta): Promise<TrailRoute | null> {
  const f = routeFile(m);
  const saved = await readJson<TrailRoute>(f);
  if (saved && Array.isArray(saved.coords)) return saved;
  try {
    const { data, error } = await supabase.from('trail_routes').select('id,name,geom').eq('id', m.id).single();
    if (error) throw error;
    const coords = thin(((data as any)?.geom?.coordinates ?? []) as number[][]);
    if (coords.length < 2) return null;
    const r: TrailRoute = { id: m.id, name: (data as any).name ?? m.name, coords };
    await writeJson(f, r);
    return r;
  } catch {
    return null;
  }
}

export async function trailRoutesNear(points: { lat: number; lng: number }[]): Promise<TrailRoute[]> {
  const pts = points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return [];
  const list = await loadList();
  const hit = list.filter(m => pts.some(p =>
    p.lat <= m.north + SLACK_DEG && p.lat >= m.south - SLACK_DEG && p.lng >= m.west - SLACK_DEG * 1.4 && p.lng <= m.east + SLACK_DEG * 1.4));
  const routes = await Promise.all(hit.map(loadRoute));
  return routes.filter((r): r is TrailRoute => !!r);
}

// The routes for a set of points (a stop's stand spots), loaded once per set
export function useTrailRoutes(points: { lat: number; lng: number }[]): TrailRoute[] {
  const key = points.map(p => `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`).sort().join('|');
  const [routes, setRoutes] = useState<TrailRoute[]>([]);
  useEffect(() => {
    let live = true;
    trailRoutesNear(points).then(r => { if (live) setRoutes(r); }).catch(() => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return routes;
}
