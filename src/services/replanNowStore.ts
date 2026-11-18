import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NowStatus, nowStatus, replanNow } from './planner';

// Re-plan now (TEST app, Phil 5 Nov 2026): one shared store per trip, so the trip page's day card and
// the Plans tab show the same request, and it keeps going when Phil leaves the screen. The request runs
// on the server; the app checks it every 5 s while it is open and shows the result on the card (no
// notification: Phil, 5 Nov 2026). Closed app: the request is remembered on the phone and checked as
// soon as the app opens again.
export type NowView =
  | { phase: 'idle' }
  | { phase: 'running'; since: number }
  | { phase: 'done'; status: NowStatus; message: string; at: number }
  | { phase: 'error'; message: string; at: number };

type Pending = { tripId: string; id: number; title?: string; since: number };
const KEY = 'replan_now_pending';
const SHOW_FOR_MS = 15 * 60_000;
const views = new Map<string, NowView>();
const listeners = new Map<string, Set<() => void>>();
const planListeners = new Set<() => void>();
let pending: Pending[] = [];
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const emit = (tripId: string) => listeners.get(tripId)?.forEach(f => f());
const set = (tripId: string, v: NowView) => { views.set(tripId, v); emit(tripId); };

// Screens showing a day's plan reload it when a re-plan lands.
export function onPlanLanded(f: () => void) { planListeners.add(f); return () => { planListeners.delete(f); }; }

export function messageOf(s: NowStatus): string {
  const peaks = s.hidden === 1 ? 'cameras show the peaks hidden' : s.hidden === 0 ? 'cameras show the peaks out' : 'no camera reading';
  return s.changed ? `New plan for the rest of today (${peaks}).` : `Nothing better for the rest of today (${peaks}): the plan stands.`;
}

async function save() {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* checked again while open */ }
}

async function load() {
  if (loaded) return;
  loaded = true;
  try { const v = await AsyncStorage.getItem(KEY); pending = v ? JSON.parse(v) : []; } catch { pending = []; }
  for (const p of pending) if (!views.has(p.tripId)) views.set(p.tripId, { phase: 'running', since: p.since });
}

async function check() {
  timer = null;
  await load();
  if (!pending.length) return;
  if (AppState.currentState === 'active') {
    for (const p of [...pending]) {
      const s = await nowStatus(p.tripId).catch(() => null);
      const finished = s && s.id === p.id && (s.status === 'done' || s.status === 'error');
      const lost = s && s.id !== p.id && Date.now() - p.since > 10 * 60_000;
      if (!finished && !lost) continue;
      pending = pending.filter(x => x !== p);
      await save();
      if (s!.status === 'done' && s!.id === p.id) {
        const message = messageOf(s!);
        set(p.tripId, { phase: 'done', status: s!, message, at: Date.now() });
        planListeners.forEach(f => f());
      } else {
        const message = `T could not re-plan now: ${s!.note ?? 'no answer'}`;
        set(p.tripId, { phase: 'error', message, at: Date.now() });
      }
    }
  }
  if (pending.length) timer = setTimeout(check, 5000);
}

function kick() { if (!timer) timer = setTimeout(check, 5000); }

AppState.addEventListener('change', st => { if (st === 'active') { if (timer) clearTimeout(timer); timer = null; check(); } });

// App start: carry on with a request made before the app was closed.
export async function resumeReplanNow() { await load(); if (pending.length) kick(); }

// Starts a request (a running one is reused by the server). Throws the server's reason (e.g. no
// morning re-plan yet) so the screen can show it.
export async function startReplanNow(tripId: string, title?: string): Promise<void> {
  await load();
  const { id } = await replanNow(tripId);
  if (!pending.some(p => p.tripId === tripId && p.id === id)) pending = [...pending.filter(p => p.tripId !== tripId), { tripId, id, title, since: Date.now() }];
  await save();
  set(tripId, { phase: 'running', since: Date.now() });
  kick();
}

export function failReplanNow(tripId: string, message: string) { set(tripId, { phase: 'error', message, at: Date.now() }); }

export function useReplanNow(tripId: string | null | undefined): NowView {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tripId) return;
    const f = () => setTick(n => n + 1);
    let s = listeners.get(tripId);
    if (!s) { s = new Set(); listeners.set(tripId, s); }
    s.add(f);
    load().then(() => { f(); if (pending.length) kick(); });
    return () => { s!.delete(f); };
  }, [tripId]);
  const v = tripId ? views.get(tripId) : undefined;
  if (!v) return { phase: 'idle' };
  if ((v.phase === 'done' || v.phase === 'error') && Date.now() - v.at > SHOW_FOR_MS) return { phase: 'idle' };
  return v;
}
