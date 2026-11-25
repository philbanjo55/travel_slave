import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

// Phil's AllTrails routes (GPX exports, table trail_routes, 23 Nov 2026) for the 3D view from above. Every stop shows
// all the routes of its area (Phil: "each 3D map should have the routes, all of them, each its own color", with where
// each starts and ends): every route within ~80 km of the stop's shots, so the real trip, its practice copies and a
// stop with no AllTrails link of its own all see them. Each route keeps one colour everywhere (by name). Saved on the
// phone, so the lines show with no signal.

export type TrailRoute = { id: string; name: string; coords: [number, number][]; color?: string; dash?: boolean };   // [lng, lat]

// Clear of the picture's own marks: the sun's orange, the picked stand spot's red, Find me's blue
// Trail colours kept apart from the shot dots' lens colours (Phil, 25 Nov 2026: "make sure the colors don't clash with
// the colored tracks"; lensColors.tsx has red, orange, yellow, green, teal, purple, pink, brown, black, grey): white,
// sky blue, indigo and sand; a fifth route and on draws the same four dashed.
const COLORS = ['#FFFFFF', '#80D8FF', '#3F51B5', '#D7B98E'];
type RouteMeta = { id: string; name: string; north: number; south: number; west: number; east: number; updated_at: string };

const DIR = `${FileSystem.documentDirectory}pf_cache/`;
const LIST = `${DIR}trail_routes.json`;
const routeFile = (m: RouteMeta) => `${DIR}trail_${m.id}_${Date.parse(m.updated_at) || 0}.json`;
const SLACK_DEG = 0.72;   // ~80 km: the routes of the area, not another trip's

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
  // colours by name order among the routes shown together (not the whole list: the Teton routes once shared colours)
  const order = [...hit].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(m => m.id);
  const routes = await Promise.all(hit.map(loadRoute));
  return routes.filter((r): r is TrailRoute => !!r).map(r => {
    const i = Math.max(0, order.indexOf(r.id));
    return { ...r, color: COLORS[i % COLORS.length], dash: Math.floor(i / COLORS.length) % 2 === 1 };
  });
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
