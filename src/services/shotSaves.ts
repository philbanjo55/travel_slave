import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { refreshSunPlan } from './sunPlan';
import type { Framing, IdealLight, Pair } from '../utils/sunEngine';

// Saves from the 3D view (TEST app, 14 Nov 2026): a shot's stand spot (walk mode's "Save as my spot") and its framing
// ("Save framing"). Phil goes through every shot of a trip in the 3D view, often with no signal, so a save that cannot
// reach the server waits on the phone (AsyncStorage) and is sent when there is signal again: at the next app start,
// when the app comes back to the front, and every 45 s while something is waiting. Only a missing connection keeps a
// save; a save the server refuses (the shot was taken off the stop, a move over 1 km) is dropped and said once.
// A newer save of the same kind for the same shot replaces a waiting one. The framing shows at once on the phone
// (framingOf), sent or not.

export type ShotSave =
  | { kind: 'move'; tripId: string; stopId: string; vantageId: string; lat: number; lng: number; at: string }
  | { kind: 'frame'; tripId: string; stopId: string; vantageId: string; framing: Framing }
  | { kind: 'unframe'; tripId: string; stopId: string; vantageId: string; at: string }
  // the shot's whole list of framings, the default first ([] = none; Phil, 24 Nov 2026: several framings on one shot)
  | { kind: 'frames'; tripId: string; stopId: string; vantageId: string; list: Framing[] }
  | { kind: 'ideal'; tripId: string; stopId: string; vantageId: string; ideal: IdealLight | null };   // null = forget

const KEY = 'pf_shot_saves';
const SEND_TIMEOUT_MS = 15000;
const RETRY_MS = 45000;

let queue: ShotSave[] | null = null;
let loading: Promise<ShotSave[]> | null = null;
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
const known: Record<string, Framing | null> = {};       // vantage id -> framing saved on this phone (null = forgotten)
const knownList: Record<string, Framing[]> = {};      // vantage id -> every framing saved on this phone (default first)
const knownIdeal: Record<string, IdealLight | null> = {};   // vantage id -> ideal light saved on this phone (null = forgotten)
const refused: Record<string, string> = {};             // vantage id -> why the server refused a waiting save
const listeners = new Set<() => void>();
const tell = () => listeners.forEach(fn => { try { fn(); } catch { /* a screen gone */ } });

const family = (j: ShotSave) => (j.kind === 'move' ? 'move' : j.kind === 'ideal' ? 'ideal' : 'frame');

async function load(): Promise<ShotSave[]> {
  if (queue) return queue;
  if (!loading) {
    loading = (async () => {
      let q: ShotSave[] = [];
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const p = raw ? JSON.parse(raw) : [];
        if (Array.isArray(p)) q = p.filter(j => j && typeof j.kind === 'string' && typeof j.vantageId === 'string');
      } catch { /* nothing saved, or unreadable: start empty */ }
      if (!queue) {
        queue = q;
        for (const j of q) remember(j);
      }
      return queue;
    })();
  }
  return loading;
}

// What a save tells this phone at once (sent or waiting).
function remember(j: ShotSave) {
  if (j.kind === 'frame') { known[j.vantageId] = j.framing; if (knownList[j.vantageId]) knownList[j.vantageId] = [j.framing, ...knownList[j.vantageId].slice(1)]; }
  else if (j.kind === 'unframe') { known[j.vantageId] = null; knownList[j.vantageId] = []; }
  else if (j.kind === 'frames') { known[j.vantageId] = j.list[0] ?? null; knownList[j.vantageId] = j.list; }
  else if (j.kind === 'ideal') knownIdeal[j.vantageId] = j.ideal;
}
function forget(j: ShotSave) {
  if (j.kind === 'ideal') delete knownIdeal[j.vantageId];
  else if (j.kind !== 'move') { delete known[j.vantageId]; delete knownList[j.vantageId]; }
}

async function persist(): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(queue ?? [])); } catch { /* kept in memory until the next try */ }
}

function isNoSignal(e: any): boolean {
  const msg = String(e?.message ?? e ?? '');
  return /network|fetch|timed out|timeout|no connection|offline|aborted|internet/i.test(msg);
}

async function send(j: ShotSave): Promise<void> {
  const call = j.kind === 'move'
    ? supabase.rpc('sun_vantage_move', { p_stop_id: j.stopId, p_vantage_id: j.vantageId, p_lat: j.lat, p_lng: j.lng })
    : j.kind === 'frame'
      ? supabase.rpc('sun_vantage_frame', {
        p_stop_id: j.stopId, p_vantage_id: j.vantageId, p_heading: j.framing.heading, p_pitch: j.framing.pitch,
        p_lens: j.framing.lens, p_orient: j.framing.orient, p_at: j.framing.at,
        // the photo placement: an object saves it; {} clears it; left out = the saved one stays
        ...(j.framing.photo === undefined ? {} : { p_photo: j.framing.photo ?? {} }),
        ...(j.framing.eye != null ? { p_eye_m: j.framing.eye } : {}),   // camera height (left out = eye height)
        // the crop (20 Nov 2026): an object saves it; null clears it ({}); left out = the saved one stays. Sent only when
        // there is one to save or clear, so a framing without crops never needs the newer server function
        ...(j.framing.crop === undefined ? {} : { p_crop: j.framing.crop ?? {} }),
      })
      : j.kind === 'frames'
        ? supabase.rpc('sun_vantage_framings', { p_stop_id: j.stopId, p_vantage_id: j.vantageId, p_list: j.list })
      : j.kind === 'ideal'
        ? supabase.rpc('sun_vantage_ideal', { p_stop_id: j.stopId, p_vantage_id: j.vantageId, p_az: j.ideal?.az ?? null, p_alt: j.ideal?.alt ?? null, p_at: j.ideal?.at ?? null })
        : supabase.rpc('sun_vantage_unframe', { p_stop_id: j.stopId, p_vantage_id: j.vantageId });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), SEND_TIMEOUT_MS));
  const { error } = (await Promise.race([call, timeout])) as any;
  if (error) throw error;
}

function ensureTimer() {
  if (timer || !queue?.length) return;
  timer = setInterval(() => { flushShotSaves(); }, RETRY_MS);
}
function stopTimerIfEmpty() {
  if (timer && !queue?.length) { clearInterval(timer); timer = null; }
}

// Sends what is waiting, oldest first; stops at the first one that still has no signal. Never throws.
export async function flushShotSaves(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const trips = new Set<string>();
  try {
    const q = await load();
    while (q.length) {
      const j = q[0];
      try {
        await send(j);
        trips.add(j.tripId);
      } catch (e: any) {
        if (isNoSignal(e)) break;
        refused[j.vantageId] = String(e?.message ?? e ?? 'refused');   // the server said no: dropped, and said once
        if (q[0] === j) forget(j);   // (unless a newer save already took its place)
      }
      const i = q.indexOf(j);   // by identity: a newer save of this shot may have taken its place while it was sent
      if (i >= 0) q.splice(i, 1);
      await persist();
      tell();
    }
  } finally {
    flushing = false;
    stopTimerIfEmpty();
    ensureTimer();
  }
  trips.forEach(t => { refreshSunPlan(t, true); });
}

// Starts the retries once (first use of the 3D view): a send at once, then when the app comes back to the front.
export function startShotSaves(): void {
  if (started) return;
  started = true;
  load().then(() => { ensureTimer(); flushShotSaves(); });
  AppState.addEventListener('change', st => { if (st === 'active') flushShotSaves(); });
}

// 'sent' = the server has it; 'queued' = no signal, kept on the phone and sent later. Throws when the server refuses.
export async function saveShot(j: ShotSave): Promise<'sent' | 'queued'> {
  const q = await load();
  delete refused[j.vantageId];
  remember(j);
  tell();
  const waiting = q.findIndex(x => x.vantageId === j.vantageId && family(x) === family(j));
  if (waiting >= 0 || q.length) {   // something is already waiting: keep the order, replace an older save of this shot
    if (waiting >= 0) q[waiting] = j; else q.push(j);
    await persist(); tell(); ensureTimer();
    flushShotSaves();
    return 'queued';
  }
  try {
    await send(j);
  } catch (e: any) {
    if (!isNoSignal(e)) {
      forget(j);
      tell();
      throw new Error(String(e?.message ?? e ?? 'Something went wrong'));
    }
    q.push(j);
    await persist(); tell(); ensureTimer();
    return 'queued';
  }
  refreshSunPlan(j.tripId, true);   // the 3D view, the sun times and the planner pick it up
  return 'sent';
}

// The shot's framing as this phone knows it: a save made here (sent or waiting) wins over the trip's sun plan.
export function framingOf(pair: Pair): Framing | null {
  if (Object.prototype.hasOwnProperty.call(known, pair.vantage_id)) return known[pair.vantage_id];
  const f = pair.framing;
  return f && Number.isFinite(f.heading) && Number.isFinite(f.pitch) ? f : null;
}

// Every framing of the shot as this phone knows it, the default (the one the shot opens with) first.
const okFraming = (f: Framing | null | undefined): f is Framing => !!f && Number.isFinite(f.heading) && Number.isFinite(f.pitch) && typeof f.lens === 'string';
export function framingsOf(pair: Pair): Framing[] {
  if (Object.prototype.hasOwnProperty.call(knownList, pair.vantage_id)) return knownList[pair.vantage_id];
  const more = Array.isArray(pair.framing_more) ? pair.framing_more.filter(okFraming) : [];
  const first = framingOf(pair);
  return first ? [first, ...more] : [];
}

// The shot's ideal light as this phone knows it: a save made here (sent or waiting) wins over the trip's sun plan.
export function idealOf(pair: Pair): IdealLight | null {
  if (Object.prototype.hasOwnProperty.call(knownIdeal, pair.vantage_id)) return knownIdeal[pair.vantage_id];
  const i = pair.ideal;
  return i && Number.isFinite(i.az) && Number.isFinite(i.alt) ? i : null;
}

// What of this shot is still waiting for signal.
export function waitingFor(vantageId: string): { move: boolean; frame: boolean } {
  const q = queue ?? [];
  return { move: q.some(j => j.vantageId === vantageId && j.kind === 'move'), frame: q.some(j => j.vantageId === vantageId && (j.kind === 'frame' || j.kind === 'unframe' || j.kind === 'frames')) };
}

// A waiting save of this shot the server refused (shown once, then forgotten).
export function takeRefusal(vantageId: string): string | null {
  const r = refused[vantageId] ?? null;
  delete refused[vantageId];
  return r;
}

// Re-renders the caller whenever a save is made, sent or dropped.
export function useShotSaves(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    startShotSaves();
    const fn = () => setN(x => x + 1);
    listeners.add(fn);
    load().then(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return n;
}
