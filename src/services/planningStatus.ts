import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlanningStatus, fetchPlanningStatus, replanT } from './planner';

// T planning in the background (TEST app, redesign B1, Phil 1 Nov 2026). One shared store
// per trip, so the strip under the trip page header and above every Planner tab shows the
// same thing, and survives leaving the screen that tapped "Plan again". Polls every 10 s
// while T is queued or running, else every 60 s, and on focus. "New plans ready" stays
// until Phil taps it or opens Plans (ack).
export type PlanningView =
  | { kind: 'idle' }
  | { kind: 'running'; status: PlanningStatus | null }
  | { kind: 'ready'; status: PlanningStatus };

type Entry = { status: PlanningStatus | null; kicked: number; acked: string | null | undefined; ackLoaded: boolean };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const ACK_KEY = (tripId: string) => `planner_t_ack:${tripId}`;
const READY_FOR_MS = 24 * 3600_000;

const entry = (tripId: string): Entry => {
  let e = entries.get(tripId);
  if (!e) { e = { status: null, kicked: 0, acked: undefined, ackLoaded: false }; entries.set(tripId, e); }
  return e;
};
const emit = (tripId: string) => listeners.get(tripId)?.forEach(f => f());
const active = (s: PlanningStatus | null) => !!s && (s.status === 'queued' || s.status === 'running');

export function viewOf(tripId: string): PlanningView {
  const e = entry(tripId);
  const s = e.status;
  // Just tapped: show the strip before the server has the new run.
  if (Date.now() - e.kicked < 30_000 && !active(s) && !(s && s.made && Date.parse(s.made) >= e.kicked - 5_000)) return { kind: 'running', status: s };
  if (active(s)) return { kind: 'running', status: s };
  if (s && s.status === 'done' && s.made && e.ackLoaded && s.made !== e.acked
      && Date.now() - Date.parse(s.updated_at ?? s.made) < READY_FOR_MS) return { kind: 'ready', status: s };
  return { kind: 'idle' };
}

async function refresh(tripId: string) {
  const e = entry(tripId);
  if (!e.ackLoaded) {
    try { e.acked = await AsyncStorage.getItem(ACK_KEY(tripId)); } catch { e.acked = null; }
    e.ackLoaded = true;
  }
  try {
    const s = await fetchPlanningStatus(tripId);
    // First look on this phone: what is already done counts as seen.
    if (e.acked == null && s?.made && s.status === 'done' && !e.kicked) await ack(tripId, s.made);
    e.status = s;
  } catch { /* offline: keep the last state */ }
  emit(tripId);
  schedule(tripId);
}

function schedule(tripId: string) {
  const t = timers.get(tripId);
  if (t) clearTimeout(t);
  if (!listeners.get(tripId)?.size) { timers.delete(tripId); return; }
  const e = entry(tripId);
  const fast = active(e.status) || Date.now() - e.kicked < 30_000;
  // No network while the app is in the background; it checks again on the next tick back.
  timers.set(tripId, setTimeout(() => { if (AppState.currentState === 'active') refresh(tripId); else schedule(tripId); }, fast ? 10_000 : 60_000));
}

export async function ack(tripId: string, made?: string | null) {
  const e = entry(tripId);
  const m = made ?? e.status?.made ?? null;
  if (!m) return;
  e.acked = m; e.ackLoaded = true;
  try { await AsyncStorage.setItem(ACK_KEY(tripId), m); } catch { /* shown once more at worst */ }
  emit(tripId);
}

// "Plan again": start T's week draft and show the strip at once. Returns `since` for waitForT.
export async function startReplan(tripId: string): Promise<string> {
  const e = entry(tripId);
  e.kicked = Date.now();
  emit(tripId);
  try {
    const since = await replanT(tripId);
    return since;
  } finally {
    refresh(tripId);
  }
}

export function usePlanningStatus(tripId: string | null | undefined): PlanningView {
  const focused = useIsFocused();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tripId) return;
    const f = () => setTick(n => n + 1);
    let set = listeners.get(tripId);
    if (!set) { set = new Set(); listeners.set(tripId, set); }
    set.add(f);
    if (focused) refresh(tripId);
    return () => {
      set!.delete(f);
      if (!set!.size) { const t = timers.get(tripId); if (t) clearTimeout(t); timers.delete(tripId); }
    };
  }, [tripId, focused]);
  return tripId ? viewOf(tripId) : { kind: 'idle' };
}
