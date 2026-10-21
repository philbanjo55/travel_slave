// Solver data for the TEST app's Planner. Plans and stop settings are read
// straight from Supabase (read-only policies); everything that writes or
// needs a signed webcam URL goes through the solver-actions edge function.
import { supabase } from './supabase';

const ACTIONS_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-actions';

export type PlanVisit = {
  date: string; trip_date: string | null; stop_id: string; name: string; booked: boolean;
  arrive?: string; start: string | null; end?: string; wait_min?: number; drive_min?: number;
  value?: number; p_good?: number; peak_at?: string; light?: string | null; rated?: boolean;
  best?: { start: string; value: number; p_good: number; peak_at?: string } | null;
};
export type Plan = {
  rank: number; objective: number; mean: number; cvar11: number;
  drive_minutes: number | null; long_leg_minutes: number | null; note: string | null; visits: PlanVisit[];
};
export type RunDay = { date: string; trip_date: string | null; light_only?: boolean; start_hotel?: string; end_hotel?: string };
export type PlanRun = { id: string; created_at: string; plan_date: string; params: any; stats: any };
export type RunMode = 'forecast' | 'light' | 'preview';

export type CameraFrame = {
  camera: { code: string; name: string; island: string; lat: number; lng: number; image_url: string; live_url?: string; live_time?: string | null; distance_km: number | null };
  frame: null | {
    // taken_at: the camera's own time when known, else when it was fetched
    // (captured_at is only the hourly slot).
    id: string; captured_at: string; taken_at?: string; url: string | null; label: string | null; hills_visible: boolean | null;
    cloud_on_hills: string | null; sun_on_land: boolean | null; label_note: string | null;
    label_model: string | null; label_error: string | null; phil_label: string | null;
  };
};

export async function solverAction<T = any>(body: Record<string, any>): Promise<T> {
  const r = await fetch(ACTIONS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

// Which kind of plan a run is, for one trip day.
export function runMode(run: PlanRun): RunMode {
  const d: RunDay | undefined = run.stats?.days?.[0];
  if (d?.light_only) return 'light';
  if (d?.trip_date && d.date !== d.trip_date) return 'preview';
  return 'forecast';
}

export function runTripDate(run: PlanRun): string | null {
  const d: RunDay | undefined = run.stats?.days?.[0];
  return d?.trip_date ?? null;
}

// Single-day runs for a trip, newest first (no plan bodies: they're large).
export async function fetchDayRuns(tripId: string, limit = 150): Promise<PlanRun[]> {
  const { data, error } = await supabase.from('solver_runs')
    .select('id, created_at, plan_date, params, stats')
    .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).filter((r: any) => r.stats?.kind === 'day');
}

// The newest run per trip day and mode.
export function latestByDay(runs: PlanRun[]): Map<string, Partial<Record<RunMode, PlanRun>>> {
  const out = new Map<string, Partial<Record<RunMode, PlanRun>>>();
  for (const r of runs) {
    const td = runTripDate(r);
    if (!td) continue;
    const m = out.get(td) ?? {};
    const mode = runMode(r);
    if (!m[mode]) m[mode] = r;
    out.set(td, m);
  }
  return out;
}

export async function fetchPlans(runId: string): Promise<Plan[]> {
  const { data, error } = await supabase.from('solver_plans')
    .select('rank, objective, mean, cvar11, drive_minutes, long_leg_minutes, note, visits')
    .eq('run_id', runId).order('rank');
  if (error) throw error;
  return (data ?? []) as Plan[];
}

// Best plan and "my day" scores for many runs at once (day list).
export async function fetchScores(runIds: string[]): Promise<Map<string, { best?: number; mine?: number; top?: string[] }>> {
  const out = new Map<string, { best?: number; mine?: number; top?: string[] }>();
  if (!runIds.length) return out;
  const { data, error } = await supabase.from('solver_plans')
    .select('run_id, rank, objective, visits').in('run_id', runIds).in('rank', [0, 1]);
  if (error) throw error;
  for (const p of data ?? []) {
    const e = out.get(p.run_id) ?? {};
    if (p.rank === 0) e.mine = p.objective;
    if (p.rank === 1) {
      e.best = p.objective;
      e.top = (p.visits as PlanVisit[]).filter(v => (v.p_good ?? 0) >= 0.5).map(v => v.name).slice(0, 3);
    }
    out.set(p.run_id, e);
  }
  return out;
}

export async function planDay(tripId: string, tripDate: string, preview = false): Promise<string> {
  const j = await solverAction<{ run_id: string }>({ action: 'plan', trip_id: tripId, trip_date: tripDate, preview });
  return j.run_id;
}

export type ShotStatus = 'got' | 'nailed' | null;

// The stop's planner settings and its shots, through solver-actions.
export type Light = 'front' | 'side' | 'back' | 'soft';
export type StopSettings = {
  tier: string | null; light_wanted: Light[] | null; fog_wanted: boolean | null;
  star_vantage_id: string | null; shot_status: ShotStatus; source: 'suggested' | 'phil';
};
export type StopShot = { vantage_id: string; position: number; name: string };
export const TIER_CHOICES = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F'];
export const LIGHT_CHOICES: { key: Light; text: string }[] = [
  { key: 'front', text: 'Front' }, { key: 'side', text: 'Side' }, { key: 'back', text: 'Back' }, { key: 'soft', text: 'Soft' },
];

export async function fetchStopSettings(stopId: string) {
  return solverAction<{ setting: StopSettings | null; shots: StopShot[] }>({ action: 'stop_settings', stop_id: stopId });
}

// Phil's own settings (source becomes 'phil'); an empty patch confirms the suggestion.
export async function saveStopSettings(stopId: string, patch: Partial<Pick<StopSettings, 'tier' | 'light_wanted' | 'fog_wanted' | 'star_vantage_id'>>) {
  const j = await solverAction<{ setting: StopSettings }>({ action: 'set_settings', stop_id: stopId, ...patch });
  return j.setting;
}

export async function fetchTripSettings(tripId: string) {
  const { data, error } = await supabase.from('solver_stop_settings')
    .select('stop_id, tier, shot_status, source, stops!inner(trip_id)').eq('stops.trip_id', tripId);
  if (error) throw error;
  return (data ?? []) as { stop_id: string; tier: string | null; shot_status: ShotStatus; source: string }[];
}

export const markShot = (stopId: string, status: ShotStatus) =>
  solverAction({ action: 'mark_shot', stop_id: stopId, status });

export async function fetchFrames(near?: { lat: number; lng: number }, n = 2): Promise<CameraFrame[]> {
  const j = await solverAction<{ cameras: CameraFrame[] }>({ action: 'frames', ...(near ? { lat: near.lat, lng: near.lng, n } : {}) });
  return j.cameras;
}

// Cameras within 50 km of any of the trip's stops.
export async function fetchTripFrames(tripId: string): Promise<CameraFrame[]> {
  const j = await solverAction<{ cameras: CameraFrame[] }>({ action: 'frames', trip_id: tripId });
  return j.cameras;
}

// Claude API spend this UTC month (webcam labels etc.), capped server-side.
export type ClaudeSpend = { month_usd: number; cap_usd: number; calls: number; today_usd: number; last_at: string | null };
export async function fetchClaudeSpend(): Promise<ClaudeSpend | null> {
  const { data, error } = await supabase.rpc('claude_spend_summary');
  return error ? null : (data as ClaudeSpend);
}
export const spendLine = (s: ClaudeSpend) =>
  `Claude this month: $${s.month_usd.toFixed(2)} of $${s.cap_usd} (today $${s.today_usd.toFixed(2)})`;

export type PhilLabel = 'clear' | 'cloud_on_hills' | 'fog' | 'cant_tell';
export const labelFrame = (frameId: string, label: PhilLabel | null) =>
  solverAction({ action: 'label_frame', frame_id: frameId, label });

export const applyPreview = (runId: string, rank: number) =>
  solverAction<{ preview_only: boolean; result: any }>({ action: 'apply_preview', run_id: runId, rank });

// "05:45" in the trip's timezone (falls back to the phone's).
export function hhmm(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

export function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

export const LIGHT_WORDS: Record<string, string> = {
  front: 'front light', side: 'side light', backlit: 'backlit', top: 'high sun',
  'in shadow': 'in shadow', 'no sun': 'blue hour', 'no direction': 'sun up',
};

// Plain words for a webcam frame's label.
export function frameSummary(f: CameraFrame['frame']): string {
  if (!f) return 'No frame yet';
  if (!f.label) return f.label_error ? 'Not labelled yet' : 'Not labelled yet';
  const what: Record<string, string> = {
    clear: 'Clear', haze: 'Hazy', low_cloud: 'Cloud on the hills', fog: 'Fog', dark: 'Too dark', camera_problem: 'Camera problem',
  };
  const parts = [what[f.label] ?? f.label];
  if (f.sun_on_land) parts.push('sun on the land');
  return parts.join(' · ');
}
