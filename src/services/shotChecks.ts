import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Shots checked off at a stop (Phil, 18 Nov 2026): hold a shot chip to grey it out as done, hold again to undo.
// Phil's own checklist only; the planner never reads it. Kept on the phone first (works with no signal) and in table
// stop_shot_checks (stop_id, vantage_id): a change that cannot reach the server waits on the phone and is sent at the
// next app start or check, the newest change per shot winning.

const KEY = 'pf_shot_checks';          // { [stopId]: { [vantageId]: true } }
const PENDING = 'pf_shot_checks_todo';  // { ["stop|vantage"]: true (done) | false (undone) }

type Map = Record<string, Record<string, true>>;
let checks: Map = {};
let pending: Record<string, boolean> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try { checks = JSON.parse((await AsyncStorage.getItem(KEY)) || '{}') || {}; } catch { checks = {}; }
      try { pending = JSON.parse((await AsyncStorage.getItem(PENDING)) || '{}') || {}; } catch { pending = {}; }
    })();
  }
  return loaded;
}

async function save() {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(checks)); } catch { /* full or blocked: memory still has it */ }
  try { await AsyncStorage.setItem(PENDING, JSON.stringify(pending)); } catch { /* same */ }
}

async function send(stopId: string, vantageId: string, done: boolean): Promise<boolean> {
  try {
    const r = done
      ? await supabase.from('stop_shot_checks').upsert({ stop_id: stopId, vantage_id: vantageId }, { onConflict: 'stop_id,vantage_id', ignoreDuplicates: true })
      : await supabase.from('stop_shot_checks').delete().eq('stop_id', stopId).eq('vantage_id', vantageId);
    return !r.error;
  } catch {
    return false;
  }
}

async function flush() {
  const todo = Object.entries(pending);
  if (!todo.length) return;
  let changed = false;
  for (const [k, done] of todo) {
    const [stopId, vantageId] = k.split('|');
    if (await send(stopId, vantageId, done)) {
      if (pending[k] === done) { delete pending[k]; changed = true; }
    }
  }
  if (changed) await save();
}

// The stop's checks from the server (pending changes on the phone win over it), then any waiting changes sent.
async function refresh(stopId: string) {
  await load();
  await flush();
  try {
    const { data, error } = await supabase.from('stop_shot_checks').select('vantage_id').eq('stop_id', stopId);
    if (error || !data) return;
    const next: Record<string, true> = {};
    for (const r of data as { vantage_id: string }[]) next[r.vantage_id] = true;
    for (const [k, done] of Object.entries(pending)) {
      const [s, v] = k.split('|');
      if (s !== stopId) continue;
      if (done) next[v] = true; else delete next[v];
    }
    checks = { ...checks, [stopId]: next };
    await save();
    emit();
  } catch { /* no signal: the phone's copy stands */ }
}

export async function toggleShotCheck(stopId: string, vantageId: string): Promise<boolean> {
  await load();
  const cur = { ...(checks[stopId] ?? {}) };
  const done = !cur[vantageId];
  if (done) cur[vantageId] = true; else delete cur[vantageId];
  checks = { ...checks, [stopId]: cur };
  pending[`${stopId}|${vantageId}`] = done;
  await save();
  emit();
  if (await send(stopId, vantageId, done)) {
    if (pending[`${stopId}|${vantageId}`] === done) { delete pending[`${stopId}|${vantageId}`]; await save(); }
  }
  return done;
}

// The shots checked off at a stop: { vantageId: true }.
export function useShotChecks(stopId: string | null | undefined): Record<string, true> {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick(n => n + 1);
    listeners.add(l);
    if (stopId) load().then(() => { tick(n => n + 1); refresh(stopId); });
    return () => { listeners.delete(l); };
  }, [stopId]);
  return (stopId && checks[stopId]) || {};
}
