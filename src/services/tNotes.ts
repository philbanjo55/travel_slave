// "Tell T about your day" (TEST app, worksheet g4; Phil, 10 Nov 2026). A note typed on a day card is read by
// Claude into rules T follows (edge function t-notes, table t_notes). Nothing is in force until Phil has seen the
// plain-words preview and tapped "Looks right". A note never edits stops; ticks change only from an evening recap
// and only after the same OK. Notes are read straight from Supabase (read-only policy); every write goes through
// the edge function. With no signal a note waits on the phone and is sent when the app next has a connection.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { startReplanNow } from './replanNowStore';
import { startReplan } from './planningStatus';

const NOTES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/t-notes';

export type NoteLine = { text: string; when: string; why?: string };
export type NoteAsk = { question: string; options: string[] };
export type NoteCost = { status?: string; lines?: string[] } | null;
export type NoteAnswer = { kind: string; places: string[]; text: string; lines: string[]; if_say?: NoteLine[] } | null;
export type TNote = {
  id: number; trip_id: string; typed_on: string; text: string; source: 'typed' | 'quick';
  status: 'draft' | 'asking' | 'active' | 'cleared' | 'done' | 'answer';
  rules: any[]; say: NoteLine[]; info: string[]; ask: NoteAsk | null; from_date: string | null; to_date: string | null;
  cost: NoteCost; now: any | null; recap: any[] | null; answer: NoteAnswer; created_at: string; saved_at: string | null;
};
export type QuickKind = 'sleep_in' | 'nothing_long' | 'easy_day' | 'day_off' | 'back_by' | 'skip' | 'want';

const COLS = 'id, trip_id, typed_on, text, source, status, rules, say, info, ask, from_date, to_date, cost, now, recap, answer, created_at, saved_at';

async function call<T = any>(body: Record<string, any>, timeoutMs = 45_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(NOTES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e: any) {
    const err: any = new Error(ctl.signal.aborted ? 'No answer from T (weak signal?)' : 'No signal');
    err.offline = true;
    throw err;
  } finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

// Is Tell T switched on for this trip? (Off until Phil says go: the box does not show at all.)
export async function notesOn(tripId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('planner_t_tell', { p_trip: tripId });
  if (error) return false;
  return data === true;
}
export function useNotesOn(tripId: string | null | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    if (!tripId) { setOn(false); return; }
    const key = `tnotes_on:${tripId}`;
    AsyncStorage.getItem(key).then(v => { if (live && v === '1') setOn(true); }).catch(() => {});
    notesOn(tripId).then(v => { if (!live) return; setOn(v); AsyncStorage.setItem(key, v ? '1' : '0').catch(() => {}); }).catch(() => {});
    return () => { live = false; };
  }, [tripId]);
  return on;
}

export const readNote = (tripId: string, date: string, text: string, answer?: { question: string; choice: string }) =>
  call<{ note: TNote }>({ action: 'read', trip_id: tripId, date, text, ...(answer ? { answer } : {}) }).then(r => r.note);
export const quickNote = (tripId: string, date: string, kind: QuickKind, extra: { time?: string; place?: string } = {}) =>
  call<{ note: TNote; replan?: any }>({ action: 'quick', trip_id: tripId, date, kind, ...extra });
export const saveNote = (id: number) => call<{ replan?: any; now?: any; marks?: { place: string; result: string; set: boolean }[] }>({ action: 'save', id });
export const clearNote = (id: number) => call<{ replan?: any }>({ action: 'clear', id });

// After a note is saved or removed the server has already started the re-plans it needs. This puts the app's own
// trackers on them (the same ones the Re-plan now and Plan again buttons use), so the day card says T is working
// and loads the new plan when it lands. Both calls pick up the request already running; neither starts a second.
export function followReplan(tripId: string, r: any) {
  const did: string[] = r?.replan?.did ?? [];
  if (r?.now?.ok || did.includes('now')) startReplanNow(tripId).catch(() => {});
  if (did.includes('week')) startReplan(tripId).catch(() => {});
}

// The trip's notes that matter now: in force, waiting for the OK, or a question back. Kept on the phone for no signal.
const cacheKey = (tripId: string) => `tnotes:${tripId}`;
export async function fetchNotes(tripId: string): Promise<TNote[]> {
  try {
    const { data, error } = await supabase.from('t_notes').select(COLS).eq('trip_id', tripId)
      .in('status', ['active', 'draft', 'asking']).order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    const rows = (data ?? []) as TNote[];
    AsyncStorage.setItem(cacheKey(tripId), JSON.stringify(rows)).catch(() => {});
    return rows;
  } catch {
    try { const v = await AsyncStorage.getItem(cacheKey(tripId)); return v ? JSON.parse(v) : []; } catch { return []; }
  }
}
export async function fetchNote(id: number): Promise<TNote | null> {
  const { data } = await supabase.from('t_notes').select(COLS).eq('id', id).maybeSingle();
  return (data as TNote | null) ?? null;
}

// Does a note in force cover this trip day?
export function covers(n: TNote, date: string): boolean {
  const rs = n.rules ?? [];
  if (!rs.length) return n.typed_on === date;
  return rs.some((r: any) => Array.isArray(r.dates) ? r.dates.includes(date) : (!r.from_date || date >= r.from_date) && (!r.to_date || date <= r.to_date));
}
export const restOfTrip = (n: TNote) => (n.rules ?? []).some((r: any) => !Array.isArray(r.dates));

// ---- One shared store per trip (the day card, the sheet and the Setup tab show the same notes) ----
export type Waiting = { key: string; tripId: string; date: string; text: string; at: number };
const QKEY = 'tnotes_waiting';
const notes = new Map<string, TNote[]>();
const subs = new Map<string, Set<() => void>>();
let waiting: Waiting[] = [];
let loaded = false;
let sending = false;
const emit = (tripId: string) => subs.get(tripId)?.forEach(f => f());

async function loadWaiting() {
  if (loaded) return;
  loaded = true;
  try { const v = await AsyncStorage.getItem(QKEY); waiting = v ? JSON.parse(v) : []; } catch { waiting = []; }
}
const saveWaiting = () => AsyncStorage.setItem(QKEY, JSON.stringify(waiting)).catch(() => {});

export async function refreshNotes(tripId: string) {
  notes.set(tripId, await fetchNotes(tripId));
  emit(tripId);
}

// No signal: the note waits on the phone. It is read (never saved) once there is a connection; Phil still gives the OK.
export async function queueNote(tripId: string, date: string, text: string) {
  await loadWaiting();
  waiting = [...waiting, { key: `${Date.now()}`, tripId, date, text, at: Date.now() }];
  await saveWaiting();
  emit(tripId);
}
export async function dropWaiting(key: string) {
  await loadWaiting();
  const w = waiting.find(x => x.key === key);
  waiting = waiting.filter(x => x.key !== key);
  await saveWaiting();
  if (w) emit(w.tripId);
}
export async function sendWaiting() {
  await loadWaiting();
  if (sending || !waiting.length || AppState.currentState !== 'active') return;
  sending = true;
  try {
    for (const w of [...waiting]) {
      try { await readNote(w.tripId, w.date, w.text); }
      catch (e: any) { if (e?.offline) break; }   // still no signal: try again later. Any other answer: the note is dropped below.
      waiting = waiting.filter(x => x.key !== w.key);
      await saveWaiting();
      await refreshNotes(w.tripId);
    }
  } finally { sending = false; }
}
AppState.addEventListener('change', s => { if (s === 'active') sendWaiting(); });

export function useNotes(tripId: string | null | undefined): { notes: TNote[]; waiting: Waiting[] } {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tripId) return;
    const f = () => setTick(n => n + 1);
    let s = subs.get(tripId);
    if (!s) { s = new Set(); subs.set(tripId, s); }
    s.add(f);
    loadWaiting().then(() => { f(); sendWaiting(); });
    refreshNotes(tripId);
    const sub = AppState.addEventListener('change', st => { if (st === 'active') refreshNotes(tripId); });
    return () => { s!.delete(f); sub.remove(); };
  }, [tripId]);
  return { notes: tripId ? notes.get(tripId) ?? [] : [], waiting: tripId ? waiting.filter(w => w.tripId === tripId) : [] };
}
