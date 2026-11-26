import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

// Hike / ski stops (Phil, 26 Nov 2026: "Anything that is an all trails/hike/xc ski should get a special badge ... and a
// lil more information about how long distance and time wise roughly it is"; he picked the green Stops badge (C) and
// the profile card (3), in miles). One row per AllTrails route linked to a stop (trail_routes.stop_id, the real trip's
// stop): its length, smoothed climb, a 100-point profile and the activity (ski in the Tetons, hike in the Faroes),
// all worked out once on the server (20261126010000_trail_info). A practice copy's stop finds its route by the stop's
// name. Saved on the phone, so it shows with no signal.

export type TrailInfo = {
  id: string; name: string; stop_id: string | null; stopName: string | null;
  length_m: number; climb_m: number; loop: boolean; activity: 'ski' | 'hike';
  profile: [number, number][];   // [metres along, metres up] x 100
};

const DIR = `${FileSystem.documentDirectory}pf_cache/`;
const FILE = `${DIR}trail_info.json`;
let cache: TrailInfo[] | null = null;
let asking: Promise<TrailInfo[]> | null = null;
const subs = new Set<(v: TrailInfo[]) => void>();

async function load(): Promise<TrailInfo[]> {
  if (asking) return asking;
  asking = (async () => {
    if (!cache) {
      try { cache = JSON.parse(await FileSystem.readAsStringAsync(FILE)) as TrailInfo[]; subs.forEach(f => f(cache!)); } catch { /* none saved yet */ }
    }
    try {
      const { data, error } = await supabase.from('trail_routes')
        .select('id,name,stop_id,length_m,climb_m,closed_loop,activity,profile,stops(name)');
      if (error) throw error;
      const rows: TrailInfo[] = (data ?? []).filter((r: any) => r.stop_id).map((r: any) => ({
        id: r.id, name: r.name, stop_id: r.stop_id, stopName: r.stops?.name ?? null,
        length_m: Number(r.length_m) || 0, climb_m: Number(r.climb_m) || 0, loop: !!r.closed_loop,
        activity: r.activity === 'hike' ? 'hike' : 'ski', profile: Array.isArray(r.profile) ? r.profile : [],
      }));
      cache = rows;
      subs.forEach(f => f(rows));
      try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch { /* there */ }
      try { await FileSystem.writeAsStringAsync(FILE, JSON.stringify(rows)); } catch { /* shown, not saved */ }
    } catch { /* no signal: the saved copy */ }
    asking = null;
    return cache ?? [];
  })();
  return asking;
}

export function useTrailInfo(): TrailInfo[] {
  const [v, setV] = useState<TrailInfo[]>(cache ?? []);
  useEffect(() => { subs.add(setV); load(); return () => { subs.delete(setV); }; }, []);
  return v;
}

// The route of a stop: linked to it, else (a practice copy, a repeat visit) one linked to a stop of the same name.
export function trailFor(list: TrailInfo[], stopIds: string[], name: string | null | undefined): TrailInfo | null {
  return list.find(t => t.stop_id && stopIds.includes(t.stop_id))
    ?? (name ? list.find(t => t.stopName && t.stopName.trim().toLowerCase() === name.trim().toLowerCase()) ?? null : null);
}

export const miles = (m: number) => { const v = m / 1609.344; return v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)); };
export const feet = (m: number) => Math.round((m * 3.28084) / 10) * 10;
// Rough time on the route: about 2.5 mph (4 km/h) plus an hour per 500 m of climb on skis, per 600 m on foot.
export function trailTime(t: TrailInfo): string {
  const h = t.length_m / 4000 + t.climb_m / (t.activity === 'ski' ? 500 : 600);
  if (h < 0.75) return `~${Math.max(15, Math.round((h * 60) / 15) * 15)} min`;
  const r = Math.round(h * 2) / 2;
  return `~${String(r).replace(/\.0$/, '')} h`;
}
export const trailWord = (t: TrailInfo) => (t.activity === 'ski' ? 'Ski' : 'Hike');
export const trailIcon = (t: TrailInfo) => (t.activity === 'ski' ? 'ski-cross-country' : 'hiking');
// "9.2 mi loop · ~4 h"
export const trailLine = (t: TrailInfo) => `${miles(t.length_m)} mi${t.loop ? ' loop' : ' one way'} · ${trailTime(t)}`;
