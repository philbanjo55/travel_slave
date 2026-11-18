import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { fetchPlanningStatus, latestT, nowStatus, waitForT, PlanRun } from './planner';
import { trackReplanNow } from './replanNowStore';
import { kickPlanning } from './planningStatus';

// One-pass Re-plan (Phil, 15 Nov 2026: "if my initial plan has stop A on it but when I replan stop A is no longer
// there I want that to trickle down to the rest of the week ... at the same time"). One button instead of Re-plan now
// + Plan again: today first (where the plan says he is, the cameras, notes), then the rest of the trip planned around
// today's new plan (the server goes on by itself: planner_t_rest). Once today's stops are over: tomorrow on.
// TEST app only and OFF: Phil OKs the before / after first (no visible change while this is false).
export const ONE_PASS_UI = true;   // Phil OK'd the before / after, 18 Nov 2026

export type ReplanMode = 'today' | 'rest';

// What the button does right now (RPC planner_t_replan_mode): today + the rest, or tomorrow on.
export async function replanMode(tripId: string): Promise<ReplanMode> {
  const { data, error } = await supabase.rpc('planner_t_replan_mode', { p_trip: tripId });
  if (error || !data?.ok) return 'rest';
  return data.mode === 'today' ? 'today' : 'rest';
}

export function useReplanMode(tripId: string | null | undefined): ReplanMode | null {
  const [mode, setMode] = useState<ReplanMode | null>(null);
  useEffect(() => {
    if (!tripId || !ONE_PASS_UI) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (AppState.currentState === 'active') { const m = await replanMode(tripId).catch(() => null); if (alive && m) setMode(m); }
      if (alive) timer = setTimeout(tick, 60_000);
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [tripId]);
  return mode;
}

export const MODE_SUB: Record<ReplanMode, string> = { today: 'Today + rest of trip', rest: 'Tomorrow on' };

export type OnePassStart = { mode: ReplanMode; since: string; nowId: number | null };

// Starts the one Re-plan (RPC planner_t_replan_one). Today's part is followed by the Re-plan now store (the card's
// line and the Plans tab), the rest of the trip by the planning strip.
export async function startOnePass(tripId: string, title?: string): Promise<OnePassStart> {
  const { data, error } = await supabase.rpc('planner_t_replan_one', { p_trip: tripId });
  kickPlanning(tripId, data?.mode === 'today' ? 60_000 : 0);
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? data?.week?.error ?? 'T could not start');
  if (data.mode === 'today' && data.now?.id != null) {
    await trackReplanNow(tripId, Number(data.now.id), title);
    return { mode: 'today', since: data.now.since ?? new Date().toISOString(), nowId: Number(data.now.id) };
  }
  return { mode: 'rest', since: data.week?.since ?? new Date().toISOString(), nowId: null };
}

// Waits for one day's new plan after a one-pass start: today's comes with the re-plan, a later day's with the rest of
// the trip, which starts once today's re-plan is done (so that one is waited for first; up to 6 min, then as Plan again).
export async function waitOnePass(tripId: string, tripDate: string, today: string, s: OnePassStart, alive: () => boolean = () => true): Promise<PlanRun | null> {
  let since = s.since;
  if (s.mode === 'today' && s.nowId != null) {
    const t0 = Date.now();
    while (Date.now() - t0 < 6 * 60_000) {
      await new Promise(res => setTimeout(res, 5000));
      if (!alive()) return null;
      if (AppState.currentState !== 'active') continue;
      const st = await nowStatus(tripId).catch(() => null);
      if (st && st.id === s.nowId && (st.status === 'done' || st.status === 'error')) { since = st.done_at ?? since; break; }
    }
    if (tripDate === today) return latestT(tripId, tripDate);
    // The rest-of-trip draft is queued by the re-plan itself: give it a moment to show as running.
    for (let k = 0; k < 4; k++) {
      const p = await fetchPlanningStatus(tripId).catch(() => null);
      if (p && (p.status === 'queued' || p.status === 'running')) break;
      await new Promise(res => setTimeout(res, 3000));
    }
    since = s.since;
  }
  return waitForT(tripId, tripDate, since, alive);
}
