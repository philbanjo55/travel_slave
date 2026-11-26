import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { fetchTripSettings, ShotStatus, TripSetting } from './planner';
import { useSunPlan } from './sunPlan';
import { framingOf, framingsOf, useShotSaves } from './shotSaves';
import { stopPagePhotos } from '../utils/photoGroups';
import type { Pair } from '../utils/sunEngine';

// The trip page's Stops view (TEST app, Phil 15-16 Nov 2026, design "FINAL"): every rated place of the trip once,
// grouped by rank, with its first photo, how many of its shots are framed and what is left to shoot. Read only:
// the trip as the app holds it (phone cache included), the stops' settings (saved on the phone for no signal) and
// the trip's sun plan (its own saved copy). Nothing here writes to the server.

export const RANKS = ['GOD', 'S', 'A', 'B', 'C', 'D'];
const rankIndex = (t: string) => { const i = RANKS.indexOf(t); return i < 0 ? RANKS.length : i; };

export type Place = {
  key: string;
  name: string;
  tier: string;
  status: ShotStatus;           // null = not shot yet, 'got' = could do better, 'nailed'
  stopId: string;               // the place's first visit (the card opens it)
  dayId: string;
  photo: any | null;            // the first photo the stop page shows
  shots: number;
  framed: number;
  takes: number;                // every framing of every shot (a shot not framed yet counts once): the card's "6 shots"
  shotsKnown: boolean;          // false until the sun plan (or its saved copy) is in
  minutes: number | null;
  stopIds: string[];            // every visit of the place (the Stops page marks set all of them)
  checked: boolean;             // green: reviewed, good to go (stops.checked)
  review: boolean;              // yellow: working on it (stops.review)
};
export type RankGroup = { tier: string; places: Place[]; todo: number; redo: number; nailed: number };

// Same place = the same name (repeat visits keep it).
const nameKey = (n: any) => String(n ?? '').trim().toLowerCase();

export function tripPlaces(tripData: any, settings: Map<string, TripSetting>, pairsOf: (stopId: string) => Pair[] | null): Place[] {
  const visits: { s: any; dayId: string; tier: string; status: ShotStatus }[] = [];
  for (const d of tripData?.days ?? []) {
    for (const s of d?.stops ?? []) {
      if (!s?.id || !d?.id || s.shot_type === 'logistics') continue;
      const set = settings.get(s.id);
      if (!set?.tier) continue;
      visits.push({ s, dayId: d.id, tier: set.tier, status: set.shot_status ?? null });
    }
  }
  // Join visits that share a name (union-find).
  const parent = visits.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstBy = new Map<string, number>();
  visits.forEach((v, i) => {
    // by name only (26 Nov 2026, Phil: "Chapel of the Trans has 3 shots but there's only 1"): a photo group can hold
    // different places that share photos (Chapel + Menor's Ferry = 'moose-historic'), which joined them into one card
    // with both places' shots and hid Menor's Ferry; repeat visits keep the place's name (as stop_place_key, 18 Nov)
    for (const k of [`n:${nameKey(v.s.name)}`]) {
      if (!k) continue;
      const j = firstBy.get(k);
      if (j == null) firstBy.set(k, i); else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, typeof visits>();
  visits.forEach((v, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), v]); });

  const out: Place[] = [];
  for (const g of groups.values()) {
    const first = g[0];   // trip order
    const tier = g.map(v => v.tier).sort((a, b) => rankIndex(a) - rankIndex(b))[0];
    const status: ShotStatus = g.some(v => v.status === 'nailed') ? 'nailed' : g.some(v => v.status === 'got') ? 'got' : null;
    let photo: any = null;
    for (const v of g) { photo = stopPagePhotos(tripData, v.s.id)[0] ?? null; if (photo) break; }
    const seen = new Map<string, Pair>();
    let known = false;
    for (const v of g) {
      const ps = pairsOf(v.s.id);
      if (ps) known = true;
      for (const p of ps ?? []) if (p?.vantage_id && !seen.has(p.vantage_id)) seen.set(p.vantage_id, p);
    }
    const pairs = [...seen.values()];
    out.push({
      key: first.s.id, name: first.s.name ?? '', tier, status, stopId: first.s.id, dayId: first.dayId, photo,
      shots: pairs.length, framed: pairs.filter(p => !!framingOf(p)).length, shotsKnown: known,
      takes: pairs.reduce((n, p) => n + Math.max(1, framingsOf(p).length), 0),
      minutes: first.s.duration_minutes ?? null,
      stopIds: g.map(v => v.s.id),
      checked: g.some(v => !!v.s.checked), review: !g.some(v => !!v.s.checked) && g.some(v => !!v.s.review),
    });
  }
  return out;
}

const statusOrder = (s: ShotStatus) => (s === 'nailed' ? 2 : s === 'got' ? 1 : 0);

// GOD, S, A, B, C, D (any other rank after them); inside a rank: not shot, could do better, nailed.
export function rankGroups(places: Place[]): RankGroup[] {
  const tiers = [...new Set(places.map(p => p.tier))].sort((a, b) => rankIndex(a) - rankIndex(b) || a.localeCompare(b));
  return tiers.map(tier => {
    const ps = places.filter(p => p.tier === tier).sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
    return {
      tier, places: ps,
      todo: ps.filter(p => !p.status).length, redo: ps.filter(p => p.status === 'got').length, nailed: ps.filter(p => p.status === 'nailed').length,
    };
  });
}

export function tallyText(g: RankGroup): string {
  return [g.todo ? `${g.todo} to shoot` : null, g.redo ? `${g.redo} to redo` : null, g.nailed ? `${g.nailed} nailed` : null]
    .filter(Boolean).join(' · ');
}

// The trip's stop settings (tier, shot status): the copy saved on the phone at once, then the server's when it answers.
const KEY = (tripId: string) => `stopsPage:settings:${tripId}`;
const memory: Record<string, TripSetting[]> = {};
const asked: Record<string, number> = {};
const listeners = new Set<(tripId: string) => void>();

// One server read per trip at a time (the tab and the view both ask), at most every 20 s.
async function askServer(tripId: string): Promise<void> {
  if (Date.now() - (asked[tripId] ?? 0) < 20_000) return;
  asked[tripId] = Date.now();
  try {
    const fresh = await Promise.race([
      fetchTripSettings(tripId),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
    const slim = fresh.map(r => ({ stop_id: r.stop_id, tier: r.tier, shot_status: r.shot_status } as TripSetting));
    memory[tripId] = slim;
    AsyncStorage.setItem(KEY(tripId), JSON.stringify(slim)).catch(() => {});
    listeners.forEach(fn => fn(tripId));
  } catch { asked[tripId] = 0; /* no signal: keep the saved copy, ask again next time */ }
}

export function useTripSettings(tripId: string | null | undefined): { settings: Map<string, TripSetting>; ready: boolean } {
  const [rows, setRows] = useState<TripSetting[] | null>(tripId ? memory[tripId] ?? null : null);
  const focused = useIsFocused();
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    const fn = (id: string) => { if (alive && id === tripId) setRows(memory[id]); };
    listeners.add(fn);
    return () => { alive = false; listeners.delete(fn); };
  }, [tripId]);
  useEffect(() => {
    if (!tripId || !focused) return;
    let alive = true;
    (async () => {
      if (!memory[tripId]) {
        try {
          const v = await AsyncStorage.getItem(KEY(tripId));
          const j = v ? JSON.parse(v) : null;
          if (Array.isArray(j) && !memory[tripId]) memory[tripId] = j;
        } catch { /* nothing saved */ }
        if (alive && memory[tripId]) setRows(memory[tripId]);
      }
      askServer(tripId);
    })();
    return () => { alive = false; };
  }, [tripId, focused]);
  return { settings: new Map((rows ?? []).map(r => [r.stop_id, r])), ready: rows != null };
}

// Everything the Stops view shows for a trip.
export function useTripPlaces(tripId: string | null | undefined, tripData: any): { groups: RankGroup[]; count: number; ready: boolean } {
  const { settings, ready } = useTripSettings(tripId);
  const plan = useSunPlan(tripId);
  useShotSaves();   // a framing saved on this phone shows at once
  const pairsOf = (id: string) => {
    if (!plan) return null;
    const s = plan.stops?.[id];
    return Array.isArray(s?.pairs) ? s!.pairs : [];
  };
  const places = tripPlaces(tripData, settings, pairsOf);
  return { groups: rankGroups(places), count: places.length, ready };
}
