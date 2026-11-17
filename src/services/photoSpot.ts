import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// Find my spot (Phil, 16 Nov 2026): where was this photo taken from, and with which of his lenses can he make it?
// The photo viewer's "Find spot" asks edge function photo-spot; Claude names the landmarks, then a worker searches
// our terrain (about 3-4 minutes). Jobs are remembered on the phone, so leaving the screen (or the app) is fine:
// while the app is open every open job is asked about every 5 s; when one finishes with the app in the background
// a notification says so (only if notifications are already allowed), and the stop page shows a "Spot found" chip.

const URL_ = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/photo-spot';
const KEY = 'pf_photo_spot';
const POLL_MS = 5000;

export type Lens = { id: string; f: number; plan: string; best: boolean; possible: boolean; lat: number; lng: number; heading: number; pitch: number; move_m: number; crop_pct: number; turn_deg: number; kind: string };
export type SpotResult = {
  ok: boolean; verdict: string; why?: string;
  confidence: { word: string; spread_m: number | null; aim_deg: number | null; line: string };
  lat?: number; lng?: number; yaw?: number; pitch?: number; hfov?: number; fp_mm?: number; size?: [number, number];
  lenses?: Lens[]; foreground?: { name: string; dist_m: number } | null; main_landmark?: { name: string; lat: number; lng: number } | null;
  shot_name?: string; overlay_path?: string;
  // Camera height and the pins (17 Nov 2026); older jobs have none of these.
  height?: { best: number; lo: number; hi: number; open?: boolean } | null;   // metres above the ground, lo..hi possible
  aerial?: boolean;
  ground_alt?: { lat: number; lng: number; eye: number; dist_m: number } | null;   // aerial: the nearest spot on the ground
  hint?: SpotHint | null;              // the pins it was asked with, echoed
  dist_from_hint_m?: number | null;
  open_fit?: { lat: number; lng: number; verdict: string; dist_from_hint_m: number } | null;   // doesn't fit near the pin
};
// Find your spot's pins (17 Nov 2026): roughly where he stood (searched within 300 m) and, optionally, what he aimed at.
export type SpotHint = { lat: number; lng: number; aim_lat?: number; aim_lng?: number };
export type SpotJob = {
  id: string; stop_id: string; photo_id: string | null; photo_url: string | null;
  status: 'queued' | 'looking' | 'solving' | 'done' | 'error'; note: string | null; error: string | null;
  result: SpotResult | null; shots: Record<string, string>; overlay_url: string | null; created_at: string; updated_at: string;
};
export type Kept = { jobId: string; stopId: string; photoId: string; stopName?: string; job?: SpotJob | null; seen?: boolean; at: number };

const OPEN = new Set(['queued', 'looking', 'solving']);
export const isOpen = (j?: SpotJob | null) => !!j && OPEN.has(j.status);

let kept: Record<string, Kept> | null = null;   // by photo id + stop id
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
const k = (photoId: string, stopId: string) => `${photoId}|${stopId}`;

async function load() {
  if (kept) return kept;
  try { const v = await AsyncStorage.getItem(KEY); kept = v ? JSON.parse(v) : {}; } catch { kept = {}; }
  // forget finished jobs after two weeks
  for (const [key, e] of Object.entries(kept!)) if (Date.now() - e.at > 14 * 864e5) delete kept![key];
  return kept!;
}
function save() { AsyncStorage.setItem(KEY, JSON.stringify(kept ?? {})).catch(() => {}); }
function emit() { save(); subs.forEach(f => f()); }

async function call(body: any): Promise<{ ok: boolean; job?: SpotJob | null; error?: string }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({ ok: false, error: `error ${r.status}` }));
    return j;
  } catch { return { ok: false, error: 'Needs a signal' }; } finally { clearTimeout(t); }
}

async function notifyDone(e: Kept) {
  if (AppState.currentState === 'active') return;
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('photo-spot', { name: 'Find spot', importance: Notifications.AndroidImportance.DEFAULT });
    const ok = e.job?.status === 'done' && e.job?.result?.ok;
    await Notifications.scheduleNotificationAsync({
      content: { title: ok ? 'Spot found' : "Couldn't place the photo", body: e.stopName ?? 'Tap to see it', data: { kind: 'photo_spot', jobId: e.jobId } },
      trigger: Platform.OS === 'android' ? { channelId: 'photo-spot' } as any : null,
    });
  } catch { /* no notification: the stop page chip still shows it */ }
}

async function poll() {
  const all = await load();
  const open = Object.values(all).filter(e => !e.job || isOpen(e.job));
  if (!open.length) { if (timer) { clearInterval(timer); timer = null; } return; }
  for (const e of open) {
    const r = await call({ action: 'status', job_id: e.jobId });
    if (!r.ok || !r.job) continue;
    const was = e.job?.status;
    e.job = r.job;
    if (was && OPEN.has(was) && !OPEN.has(r.job.status)) { e.seen = false; notifyDone(e); }
  }
  emit();
}
function ensurePolling() { if (!timer) { timer = setInterval(() => { poll().catch(() => {}); }, POLL_MS); poll().catch(() => {}); } }

// App start / stop page: carry on with jobs started earlier.
export async function resumePhotoSpots() {
  const all = await load();
  if (Object.values(all).some(e => !e.job || isOpen(e.job))) ensurePolling();
}

export async function requestSpot(stopId: string, photoId: string, stopName?: string, again = false, hint?: SpotHint | null): Promise<{ job: SpotJob | null; error?: string }> {
  const all = await load();
  // a request with pins always starts a new search
  const r = await call({ action: 'request', stop_id: stopId, photo_id: photoId, again: again || !!hint, ...(hint ? { hint } : {}) });
  if (!r.ok || !r.job) return { job: null, error: r.error ?? "Couldn't start" };
  all[k(photoId, stopId)] = { jobId: r.job.id, stopId, photoId, stopName, job: r.job, seen: !isOpen(r.job), at: Date.now() };
  emit();
  if (isOpen(r.job)) ensurePolling();
  return { job: r.job };
}

export async function fetchSpotJob(jobId: string): Promise<SpotJob | null> {
  const all = await load();
  const e = Object.values(all).find(x => x.jobId === jobId);
  const r = await call({ action: 'status', job_id: jobId });
  if (r.ok && r.job) { if (e) { e.job = r.job; emit(); } return r.job; }
  return e?.job ?? null;
}

// The newest job of a photo on the server (the viewer asks once when a photo opens).
export async function lookupSpot(photoId: string, stopId: string): Promise<SpotJob | null> {
  const all = await load();
  const r = await call({ action: 'status', photo_id: photoId, stop_id: stopId });
  if (!r.ok || !r.job) return all[k(photoId, stopId)]?.job ?? null;
  const cur = all[k(photoId, stopId)];
  all[k(photoId, stopId)] = { ...(cur ?? { seen: true }), jobId: r.job.id, stopId, photoId, job: r.job, at: cur?.at ?? Date.now() };
  emit();
  if (isOpen(r.job)) ensurePolling();
  return r.job;
}

export function markSpotSeen(jobId: string) {
  if (!kept) return;
  const e = Object.values(kept).find(x => x.jobId === jobId);
  if (e && !e.seen) { e.seen = true; emit(); }
}

export function addShotRemember(jobId: string, lens: string, vantageId: string) {
  if (!kept) return;
  const e = Object.values(kept).find(x => x.jobId === jobId);
  if (e?.job) { e.job = { ...e.job, shots: { ...(e.job.shots ?? {}), [lens]: vantageId } }; emit(); }
}

function useKept(): Record<string, Kept> {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set(n => n + 1);
    subs.add(f);
    if (!kept) load().then(f);
    return () => { subs.delete(f); };
  }, []);
  return kept ?? {};
}

export function useSpot(photoId?: string | null, stopId?: string | null): Kept | null {
  const all = useKept();
  return photoId && stopId ? all[k(photoId, stopId)] ?? null : null;
}

// Finished jobs of this stop not looked at yet (the stop page's "Spot found" chip).
export function useStopSpotsNew(stopId?: string | null): Kept[] {
  const all = useKept();
  useEffect(() => { resumePhotoSpots().catch(() => {}); }, []);
  return stopId ? Object.values(all).filter(e => e.stopId === stopId && e.job?.status === 'done' && !e.seen) : [];
}

// Progress for the card: a rough share of the ~2 minutes, from when the job was made.
export function spotProgress(j?: SpotJob | null): number {
  if (!j) return 0;
  if (!isOpen(j)) return 1;
  const s = (Date.now() - new Date(j.created_at).getTime()) / 1000;
  const base = j.status === 'looking' ? 0.05 : j.status === 'queued' ? 0.15 : 0.25;
  return Math.min(0.95, Math.max(base, s / 150));
}
