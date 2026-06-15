import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2';

// Offline cache keys — match the app's existing AsyncStorage convention in
// services/database.ts (pf_ prefix, JSON values).
const WEATHER_DAY_PREFIX = 'pf_weather_day_';
const WEATHER_STOP_PREFIX = 'pf_weather_stop_';

// On resume from background, Android may have killed the idle TCP socket; a
// bare fetch reuses it and sits for 1-2 MINUTES before the OS declares it dead.
// An AbortController makes any HTTP call fail fast instead of hanging. Exported
// so other resume-path callers (e.g. the network-sync ping) share one timeout.
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  ms = 12000
): Promise<Response> {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(killer);
  }
}

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────
export interface WeatherRow {
  stop_id: string;
  day_id: string;
  trip_id: string;
  fetched_at: string;
  forecast_valid_for: string | null;
  temperature_c: number | null;
  apparent_temperature_c: number | null;
  relative_humidity_pct: number | null;
  dew_point_c: number | null;
  cloud_cover_pct: number | null;
  cloud_cover_low_pct: number | null;
  cloud_cover_mid_pct: number | null;
  cloud_cover_high_pct: number | null;
  precip_probability_pct: number | null;
  precip_mm: number | null;
  rain_mm: number | null;
  showers_mm: number | null;
  snowfall_cm: number | null;
  weather_code: number | null;
  visibility_m: number | null;
  surface_pressure_hpa: number | null;
  wind_speed_kmh: number | null;
  wind_gusts_kmh: number | null;
  wind_direction_deg: number | null;
  is_day: boolean | null;
  uv_index: number | null;
  daylight_minutes: number | null;
  precip_hours: number | null;
  sunrise: string | null;
  sunset: string | null;
  is_golden_hour: boolean | null;
  is_dark: boolean | null;
  fog_risk: string | null;
  raw?: any;
}

export interface PullWeatherResult {
  ok: boolean;
  day_id: string;
  day_title?: string;
  test?: boolean;
  date_shifted?: boolean;
  forecast_date_used?: string;
  real_trip_date?: string | null;
  generated_at?: string;
  day_summary?: string;
  stops?: any[];
  error?: string;
}

// ─────────────────────────────────────────
// OFFLINE CACHE (stale-while-revalidate)
// Weather is small JSON (a few KB/day), so it lives in AsyncStorage — the same
// mechanism services/database.ts uses for trips + photo metadata. Rows are
// cached VERBATIM (including `raw` provenance and the score_* columns) so
// scoreConditions, the verification badges, and the day overview all keep
// working from cached rows without change.
// ─────────────────────────────────────────
interface CachedDay { cachedAt: number; byStop: Record<string, WeatherRow>; }
interface CachedStop { cachedAt: number; row: WeatherRow; }

export async function cacheWeatherForDay(
  dayId: string,
  byStop: Record<string, WeatherRow>
): Promise<void> {
  try {
    const payload: CachedDay = { cachedAt: Date.now(), byStop };
    await AsyncStorage.setItem(`${WEATHER_DAY_PREFIX}${dayId}`, JSON.stringify(payload));
  } catch (e) {
    console.warn('weather cache write failed (day):', e);
  }
}

export async function getCachedWeatherForDay(
  dayId: string
): Promise<Record<string, WeatherRow> | null> {
  try {
    const raw = await AsyncStorage.getItem(`${WEATHER_DAY_PREFIX}${dayId}`);
    if (!raw) return null;
    return (JSON.parse(raw) as CachedDay).byStop ?? null;
  } catch {
    return null;
  }
}

async function cacheWeatherForStop(stopId: string, row: WeatherRow): Promise<void> {
  try {
    const payload: CachedStop = { cachedAt: Date.now(), row };
    await AsyncStorage.setItem(`${WEATHER_STOP_PREFIX}${stopId}`, JSON.stringify(payload));
  } catch (e) {
    console.warn('weather cache write failed (stop):', e);
  }
}

async function getCachedWeatherForStop(stopId: string): Promise<WeatherRow | null> {
  // Prefer a dedicated per-stop entry; otherwise fall back to any cached day
  // that already holds this stop — so a stop loaded only via its day screen is
  // still available offline without ever having been fetched on its own.
  try {
    const raw = await AsyncStorage.getItem(`${WEATHER_STOP_PREFIX}${stopId}`);
    if (raw) return (JSON.parse(raw) as CachedStop).row ?? null;
  } catch {}
  try {
    const keys = await AsyncStorage.getAllKeys();
    for (const k of keys) {
      if (!k.startsWith(WEATHER_DAY_PREFIX)) continue;
      const raw = await AsyncStorage.getItem(k);
      if (!raw) continue;
      const hit = (JSON.parse(raw) as CachedDay).byStop?.[stopId];
      if (hit) return hit;
    }
  } catch {}
  return null;
}

// ─────────────────────────────────────────
// PULL — invokes the weather-pull edge function for one day.
// Mirrors calculateDriveTimes() in supabase.ts: raw fetch, publishable
// key as bearer. weather-pull is deployed with verify_jwt=false (matches
// the other functions), so the publishable key is accepted.
// `test` shifts the forecast to today+2 so it returns real data even
// though the trips are >16 days out (Open-Meteo's forecast horizon).
// ─────────────────────────────────────────
export async function pullWeather(
  dayId: string,
  opts: { test?: boolean } = {}
): Promise<PullWeatherResult> {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/weather-pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ day_id: dayId, test: opts.test === true }),
  });
  const result: PullWeatherResult = await res.json();
  // Make a fresh pull immediately offline-ready. The edge function's `stops`
  // payload is a DIFFERENT shape from the stored row (it carries `provenance`
  // + a nested `score`, not `raw` + flattened score_* columns), so rather than
  // cache the response directly we re-read the canonical view rows — which also
  // populates the day cache. The network is up (we just pulled), so this reads
  // fresh; it's wrapped so a cache refresh hiccup never fails the pull.
  if (result?.ok) {
    try { await fetchLatestWeatherForDay(dayId); } catch {}
  }
  return result;
}

// ─────────────────────────────────────────
// READ — latest stored forecast per stop for a day, from the
// latest_weather_per_stop view (distinct on stop_id, newest fetched_at).
// Returned keyed by stop_id for easy per-stop lookup.
// ─────────────────────────────────────────
// A read fired at the instant the app resumes can land on a TCP socket that
// died in the background; the OS takes 1-2 MINUTES to declare it dead, and the
// UI sits on stale rows the whole time. Racing a short timeout makes a dead
// socket fail fast (cache shows instantly) and the foreground retries land on
// a live connection seconds later.
function withTimeout<T>(p: Promise<T> | PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('read timeout')), ms)),
  ]);
}

export async function fetchLatestWeatherForDay(
  dayId: string
): Promise<Record<string, WeatherRow>> {
  try {
    const { data, error } = await withTimeout(
      supabase.from('latest_weather_per_stop').select('*').eq('day_id', dayId),
      6000
    );
    if (error) throw error;
    const rows = (data ?? []) as WeatherRow[];
    if (rows.length > 0) {
      const byStop: Record<string, WeatherRow> = {};
      for (const row of rows) byStop[row.stop_id] = row;
      await cacheWeatherForDay(dayId, byStop); // refresh the offline copy
      return byStop;
    }
    // Empty result. An offline/failed read can surface as empty-without-error
    // too, so NEVER let empty clobber or shadow a populated cache — prefer it.
    const cachedOnEmpty = await getCachedWeatherForDay(dayId);
    return (cachedOnEmpty && Object.keys(cachedOnEmpty).length) ? cachedOnEmpty : {};
  } catch (e: any) {
    // Read threw (offline / network error) → serve the last cached copy.
    const cached = await getCachedWeatherForDay(dayId);
    return cached ?? {};
  }
}

export async function fetchLatestWeatherForStop(
  stopId: string
): Promise<WeatherRow | null> {
  try {
    const { data, error } = await supabase
      .from('latest_weather_per_stop')
      .select('*')
      .eq('stop_id', stopId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return (await getCachedWeatherForStop(stopId)); // empty → prefer cache over blank
    const row = data as WeatherRow;
    await cacheWeatherForStop(stopId, row); // refresh the offline copy
    return row;
  } catch {
    // Offline / read failed → per-stop cache, then any day cache holding it.
    return await getCachedWeatherForStop(stopId);
  }
}

// One-shot weather load for an entire trip, keyed by stop_id. Used by the trip
// store to FOLD weather into the trip data itself — so it gets cached with the
// trip (cacheFullTrip) and rendered straight off each stop, exactly like the
// itinerary text and photos. No per-screen async fetch, so nothing to race or
// blank out offline.
export async function fetchWeatherForTrip(
  tripId: string
): Promise<Record<string, WeatherRow>> {
  try {
    const { data, error } = await supabase
      .from('latest_weather_per_stop')
      .select('*')
      .eq('trip_id', tripId);
    if (error || !data) return {};
    const byStop: Record<string, WeatherRow> = {};
    for (const r of data as WeatherRow[]) byStop[r.stop_id] = r;
    return byStop;
  } catch {
    return {};
  }
}

// Open-Meteo forecasts ~16 days out. If the target date is beyond that horizon
// (or missing), fall back to test mode (today+2) so we still get real,
// sanity-checkable data. Within range, use the real trip date. This lets the
// buttons "just work" now and automatically switch to true trip-date forecasts
// as each day comes within range — no manual toggle.
export function useTestModeFor(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true;
  // Compare CALENDAR dates (not ms deltas) so the result doesn't flip with the
  // time of day. Open-Meteo serves today + 15 full days (16-day horizon), so a
  // trip date is "in range" when it's 0..15 calendar days ahead. Outside that
  // (past, or >15 days out) we fall back to preview/test mode.
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return true;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target - today) / 86400000);
  return diffDays < 0 || diffDays > 15;
}

// Pull weather for every day in a trip (the "whole trip" update). Calls
// weather-pull once per day, auto-deciding test mode per day's date.
// Sequential with light pacing since each day fans out to Open-Meteo per stop.
// Each successful pull also refreshes that day's offline cache (pullWeather →
// fetchLatestWeatherForDay), so a whole-trip update leaves every day usable
// offline without visiting each day screen first.
export async function pullWeatherForTrip(
  tripId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ days: number; ok: number; failed: number }> {
  const { data: days, error } = await supabase
    .from('days')
    .select('id, date')
    .eq('trip_id', tripId)
    .order('day_number', { ascending: true });
  if (error || !days) throw new Error('Failed to fetch days');

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i] as { id: string; date: string | null };
    try {
      const res = await pullWeather(d.id, { test: useTestModeFor(d.date) });
      if (res.ok) ok++; else failed++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, days.length);
    await new Promise(r => setTimeout(r, 150));
  }
  return { days: days.length, ok, failed };
}

// ─────────────────────────────────────────
// FORMATTING HELPERS
// ─────────────────────────────────────────
const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail',
};

export function conditionsText(code: number | null): string {
  if (code == null) return '—';
  return WMO[code] ?? `Code ${code}`;
}

// Display is imperial (US). Stored data stays metric — only formatting converts.
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kmhToMph = (k: number) => k * 0.621371;

export function tempText(c: number | null): string {
  return c == null ? '—' : `${Math.round(cToF(c))}°F`;
}

export function windText(kmh: number | null): string {
  return kmh == null ? '—' : `${Math.round(kmhToMph(kmh))} mph`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function windDir(deg: number | null): string {
  if (deg == null) return '';
  return COMPASS[Math.round(deg / 45) % 8];
}

export function visibilityText(m: number | null): string {
  if (m == null) return '—';
  const mi = m / 1609.34;
  if (mi < 0.1) return `${Math.round(m * 3.28084)} ft`;
  return `${mi.toFixed(1)} mi`;
}

// Sun times arrive as ISO with offset (e.g. 2026-06-28T04:38:00+01:00).
export function clockFromISO(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return '—';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${min} ${ap}`;
}

// Fog-risk badge appearance. Returns null for 'none' (no badge shown).
export function fogBadge(risk: string | null): { label: string; tone: 'warn' | 'alert' } | null {
  if (risk === 'likely') return { label: 'FOG LIKELY', tone: 'alert' };
  if (risk === 'possible') return { label: 'FOG POSSIBLE', tone: 'warn' };
  return null;
}

// Weather-code → Ionicons name (the "logo" for the conditions).
export function conditionIcon(code: number | null): string {
  if (code == null) return 'partly-sunny-outline';
  if (code <= 1) return 'sunny-outline';
  if (code === 2) return 'partly-sunny-outline';
  if (code === 3) return 'cloud-outline';
  if (code === 45 || code === 48) return 'cloudy-outline';
  if (code >= 71 && code <= 77) return 'snow-outline';
  if (code === 85 || code === 86) return 'snow-outline';
  if (code >= 95) return 'thunderstorm-outline';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rainy-outline';
  return 'partly-sunny-outline';
}

// ─────────────────────────────────────────
// SHOT-TYPE-AWARE CONDITION SCORE
// Rates the forecast against what each shot_type actually wants. This is the
// in-app "ranking" — a fast glance, NOT a substitute for judgment in chat.
// Heuristic v1, deliberately simple; tune thresholds as we learn.
// Returns null for logistics (no photographic relevance).
// ─────────────────────────────────────────
export interface ConditionScore {
  stars: number;    // 0..4
  label: string;    // Poor | Fair | Good | Excellent
  reason: string;   // one-line dominant factor
}

const LABELS = ['Poor', 'Poor', 'Fair', 'Good', 'Excellent'];
const clamp = (n: number) => Math.max(0, Math.min(4, n));

export function scoreConditions(shotType: string | null, r: WeatherRow): ConditionScore | null {
  if (!shotType || shotType === 'logistics') return null;
  if (r.is_dark) return { stars: 0, label: 'Poor', reason: 'After dark' };

  const cloud = r.cloud_cover_pct ?? 50;
  const gust = r.wind_gusts_kmh ?? r.wind_speed_kmh ?? 0;
  const pop = r.precip_probability_pct ?? 0;
  const rainAmt = (r.rain_mm ?? 0) + (r.showers_mm ?? 0);
  const snow = r.snowfall_cm ?? 0;
  const code = r.weather_code;
  const vis = r.visibility_m;
  const fog = r.fog_risk;

  // How much the subject depends on seeing distance.
  const longDistance = shotType === 'mountain' || shotType === 'seascape';
  const closeSubject = shotType === 'waterfall' || shotType === 'canyon' || shotType === 'urban';

  // Start from a perfect window and subtract weighted penalties.
  // Priority (Phil): rain > visibility > wind > light/other.

  // #1 RAIN — the largest lever (0..3). Intensity-led; probability only nudges.
  let rainPen = 0;
  if (code === 65 || code === 82 || code === 75 || (code != null && code >= 95) || rainAmt > 6) rainPen = 3;            // heavy / storm
  else if (code === 61 || code === 63 || code === 81 || code === 73 || rainAmt > 2) rainPen = 2;                          // steady rain
  else if ((code != null && code >= 51 && code <= 57) || code === 80 || code === 71 || rainAmt > 0.2 || snow > 0) rainPen = 1; // drizzle / light
  if (rainPen === 0 && pop >= 55) rainPen = 1;  // likely-but-light: a nudge, not a hammer
  // Seascapes shrug off light rain: wet rock and a moody sky are the look, not a
  // washout, and you're close to the subject with a rain cover. Trace drizzle
  // (the rainPen===1 tier) is waived; steady/heavy rain (2–3) still bites.
  if (shotType === 'seascape' && rainPen === 1) rainPen = 0;

  // #2 VISIBILITY — scaled up for long-distance landscapes, capped for close subjects.
  let visBase = 0;
  if (fog === 'likely' || (vis != null && vis < 1000)) visBase = 2;
  else if (fog === 'possible' || (vis != null && vis < 4000)) visBase = 1;
  else if (vis != null && vis < 8000) visBase = 0.5;
  // For mountains, low cloud sitting on the summit is itself a visibility problem.
  let obscure = 0;
  if (shotType === 'mountain') {
    const lowCloud = r.cloud_cover_low_pct ?? cloud;
    if (lowCloud >= 90) obscure = 2;
    else if (lowCloud >= 70) obscure = 1;
  }
  const visPen = (longDistance ? visBase * 1.5 : closeSubject ? Math.min(visBase, 1) : visBase) + obscure;

  // #3 WIND — type-specific. Reflection is the special case where it gates everything.
  let windPen = 0;
  if (shotType === 'reflection') {
    windPen = gust < 6 ? 0 : gust < 10 ? 0.5 : gust < 16 ? 1.5 : gust < 25 ? 2.5 : 4;
  } else if (shotType === 'seascape') {
    // Capped at 2: heavy seas are dramatic subject matter (big-wave headlands
    // like Mullaghmore are often BEST in a blow) — wind hurts execution, not
    // the shot itself, so a gale bottoms out at Fair unless rain stacks on.
    windPen = gust > 45 ? 2 : gust > 30 ? 1 : gust > 20 ? 0.5 : 0;
  } else if (shotType === 'waterfall' || shotType === 'canyon') {
    windPen = gust > 45 ? 2 : gust > 30 ? 1 : gust > 18 ? 0.5 : 0;
  } else if (shotType === 'mountain' || shotType === 'castle') {
    windPen = gust > 70 ? 1 : gust > 50 ? 0.5 : 0;
  }

  // #4 LIGHT — minor trim only ("the other shit").
  let lightPen = 0;
  if (shotType === 'waterfall' || shotType === 'canyon') {
    if (cloud < 25) lightPen = 1;        // harsh sun blows out moving water
    else if (cloud < 45) lightPen = 0.5;
  } else if (shotType === 'castle') {
    if (cloud > 92) lightPen = 0.5;      // featureless white sky behind a castle reads dull
  }
  // Seascapes intentionally get NO flat-light penalty: 100% overcast is the
  // softbox that makes moody long-exposure B&W seas — it's an asset, not a ding.

  const s = clamp(Math.round(4 - rainPen - visPen - windPen - lightPen));

  // Surface the dominant factor as the reason.
  const factors: [number, string][] = [
    [rainPen, rainPen >= 3 ? 'Heavy rain' : rainPen >= 2 ? 'Rain likely' : 'Some rain risk'],
    [visPen, fog === 'likely' ? 'Fog — poor visibility'
      : (shotType === 'mountain' && obscure > 0) ? 'Summit likely in cloud'
      : 'Haze / low visibility'],
    [windPen,
      shotType === 'reflection' ? 'Wind breaking the reflection'
      : shotType === 'seascape' ? 'Big swell — dramatic seas, hard to hold steady'
      : 'Windy — motion in long exposures'],
    [lightPen, (shotType === 'waterfall' || shotType === 'canyon') ? 'Harsh sun on the water' : 'Flat, featureless light'],
  ];
  const top = factors.reduce((m, f) => (f[0] > m[0] ? f : m), [0, ''] as [number, string]);
  // Only headline a problem if it's actually meaningful (>=1 point) OR the day
  // isn't already Excellent. A lone 0.5 trim on a 4-star day shouldn't print a
  // warning like "Windy" — that contradicts the verdict. Otherwise affirm it.
  const reason = (top[0] >= 1 || (top[0] >= 0.5 && s < 4))
    ? top[1]
    : (s >= 4 ? 'Excellent window — soft light, calm, clear' : 'Clear window — dry, open, calm');

  return { stars: s, label: LABELS[s], reason };
}

// ─────────────────────────────────────────
// DAY-LEVEL OVERVIEW
// Aggregates a day's stored stop forecasts into one overview, mirroring the
// edge function's summary so it works on cached data without a fresh pull.
// Also resolves the preview/real flag (all stops in a day share one date).
// ─────────────────────────────────────────
export interface DayOverview {
  count: number;
  tempMin: number;
  tempMax: number;
  avgCloud: number;
  maxPrecip: number;
  maxGust: number;
  foggy: number;
  golden: number;
  code: number;       // representative condition code (for the day icon)
  summary: string;
  preview: boolean;        // true = today+2 preview, false = real trip date
  forecastDate: string | null; // YYYY-MM-DD the forecast is actually for
}

function representativeCode(codes: number[]): number {
  if (!codes.length) return 3;
  const sev = (c: number) =>
    c >= 95 ? 6 : (c >= 71 && c <= 86) ? 5 : (c >= 61 && c <= 82) ? 4
    : (c >= 51 && c <= 57) ? 3 : (c === 45 || c === 48) ? 2 : c === 3 ? 1 : 0;
  return codes.reduce((best, c) => (sev(c) > sev(best) ? c : best), codes[0]);
}

export function summarizeDay(
  rows: WeatherRow[],
  dayDate?: string | null
): DayOverview | null {
  const ok = rows.filter(r => r.cloud_cover_pct != null && r.temperature_c != null);
  if (!ok.length) return null;

  const temps = ok.map(r => r.temperature_c as number);
  const tempMin = Math.round(Math.min(...temps));
  const tempMax = Math.round(Math.max(...temps));
  const avgCloud = Math.round(ok.reduce((s, r) => s + (r.cloud_cover_pct || 0), 0) / ok.length);
  const maxPrecip = Math.max(...ok.map(r => r.precip_probability_pct ?? 0));
  const maxGust = Math.max(...ok.map(r => r.wind_gusts_kmh ?? 0));
  const golden = ok.filter(r => r.is_golden_hour).length;
  const foggy = ok.filter(r => r.fog_risk && r.fog_risk !== 'none').length;
  const code = representativeCode(ok.map(r => r.weather_code).filter((c): c is number => c != null));

  const sky = avgCloud < 25 ? 'mostly clear' : avgCloud < 60 ? 'partly cloudy' : avgCloud < 85 ? 'cloudy' : 'overcast';
  const wind = maxGust < 20 ? 'calm' : maxGust < 40 ? 'breezy' : maxGust < 60 ? 'windy' : 'very windy';
  const rain = maxPrecip < 20 ? 'low rain risk' : maxPrecip < 50 ? `${maxPrecip}% rain risk` : `high rain risk (${maxPrecip}%)`;
  const summary = `${sky[0].toUpperCase() + sky.slice(1)}, ${wind} (gusts ${Math.round(kmhToMph(maxGust))} mph), ${rain}.`
    + (foggy ? ` Fog ${foggy > 1 ? 'risk at several stops' : 'risk at one stop'}.` : '')
    + (golden ? ` ${golden} stop${golden > 1 ? 's' : ''} near golden hour.` : '');

  // Resolve live vs preview from the PHOTOGRAPHIC stops (score_label set).
  // Logistics stops never get real-mode rows, so they'd falsely flag a live
  // day as preview. If any photo stop's forecast date mismatches the trip
  // date, stay conservative and call the day preview.
  const scored = ok.filter(r => (r as any).score_label != null);
  const base = scored.length ? scored : ok;
  const dates = base
    .map(r => (r.forecast_valid_for ? r.forecast_valid_for.slice(0, 10) : null))
    .filter((x): x is string => x != null);
  const forecastDate = dates[0] ?? null;
  const preview = !dayDate || dates.length === 0 || dates.some(fd => fd !== dayDate);

  return { count: ok.length, tempMin, tempMax, avgCloud, maxPrecip, maxGust, foggy, golden, code, summary, preview, forecastDate };
}

// Per-row preview/real resolution (for the stop card flag).
// Forecast confidence from lead time alone. Forecast skill decays with how far
// out the target date is: <=3 days is reliable, 4-7 directional, 8+ is noise.
// The hourly cron keeps rows freshly pulled, so "days until the stop's date"
// is the honest measure of how settled the numbers are. Past/missing dates
// return null (no chip).
// When was this weather actually fetched? Lets the user distinguish the hourly
// async refresh from a manual pull at a glance.
export function lastFetchedISO(rows: WeatherRow[]): string | null {
  let best: string | null = null;
  for (const r of rows) if (r.fetched_at && (!best || r.fetched_at > best)) best = r.fetched_at;
  return best;
}
export function updatedAgoText(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Updated ${hrs}h ago`;
  return `Updated ${Math.round(hrs / 24)}d ago`;
}

export type ForecastConfidence = { level: 'HIGH' | 'MEDIUM' | 'LOW'; daysOut: number };
export function forecastConfidence(dateStr?: string | null): ForecastConfidence | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysOut = Math.round((target - today) / 86400000);
  if (daysOut < 0) return null;
  return { level: daysOut <= 3 ? 'HIGH' : daysOut <= 7 ? 'MEDIUM' : 'LOW', daysOut };
}

export function forecastMode(
  row: WeatherRow,
  dayDate?: string | null
): { preview: boolean; forecastDate: string | null } {
  const forecastDate = row.forecast_valid_for ? row.forecast_valid_for.slice(0, 10) : null;
  const preview = !dayDate || (forecastDate != null && forecastDate !== dayDate);
  return { preview, forecastDate };
}

// "2026-05-24" → "May 24"
export function shortDate(d: string | null): string {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────
// VERIFY — re-fetch Open-Meteo from a row's OWN stored provenance and compare.
// Proves the stored data corresponds to the recorded location/date/hour.
// A value difference (not a coordinate/time difference) usually just means
// Open-Meteo refreshed its model run since the pull — not a pipeline error.
// ─────────────────────────────────────────
export interface VerifyCheck { field: string; stored: number | null; source: number | null; match: boolean; }
// Derive the green/red verification status straight from a row's provenance —
// no network call. "Verified" = the exact requested hour was found in the
// Open-Meteo response and all core fields landed. This recomputes automatically
// whenever the row changes (i.e. when a day is re-pulled).
export interface VerifyStatus { verified: boolean; reason: string; }
export function verificationStatus(row: WeatherRow | null | undefined): VerifyStatus {
  const p = row?.raw?.provenance;
  if (!p) return { verified: false, reason: 'No provenance — re-pull this day to verify' };
  if (p.match_method !== 'exact') return { verified: false, reason: `Hour matched by ${p.match_method}, not exact` };
  if (!p.matched_time_local) return { verified: false, reason: 'No matched timestamp recorded' };
  const core = [row?.temperature_c, row?.cloud_cover_pct, row?.wind_gusts_kmh, row?.weather_code];
  if (core.some(v => v == null)) return { verified: false, reason: 'One or more core fields missing' };
  return { verified: true, reason: 'Exact hour match · data complete' };
}

export interface VerifyResult {
  ok: boolean;
  matchedTime: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  checks: VerifyCheck[];
  error?: string;
}

export async function verifyStopWeather(row: WeatherRow): Promise<VerifyResult> {
  const prov = row.raw?.provenance;
  if (!prov || prov.source_lat == null || prov.source_lng == null || !prov.forecast_date) {
    return { ok: false, matchedTime: null, lat: null, lng: null, timezone: null, checks: [],
      error: 'No provenance on this forecast — re-pull the day to enable verification.' };
  }
  const lat = prov.source_lat, lng = prov.source_lng, date = prov.forecast_date;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + `&hourly=temperature_2m,wind_gusts_10m,cloud_cover,weather_code&timezone=auto&wind_speed_unit=kmh`
    + `&start_date=${date}&end_date=${date}`;
  try {
    const res = await fetch(url);
    const j = await res.json();
    const time: string[] = j?.hourly?.time ?? [];
    let idx = prov.matched_time_local ? time.indexOf(prov.matched_time_local) : -1;
    if (idx === -1 && prov.requested_hour != null) idx = prov.requested_hour;
    const at = (a: any[]) => (a && idx >= 0 ? (a[idx] ?? null) : null);
    const approx = (a: number | null, b: number | null) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.1;
    const checks: VerifyCheck[] = [
      { field: 'Temp °C', stored: row.temperature_c, source: at(j.hourly?.temperature_2m) },
      { field: 'Gusts km/h', stored: row.wind_gusts_kmh, source: at(j.hourly?.wind_gusts_10m) },
      { field: 'Cloud %', stored: row.cloud_cover_pct, source: at(j.hourly?.cloud_cover) },
      { field: 'Code', stored: row.weather_code, source: at(j.hourly?.weather_code) },
    ].map(c => ({ ...c, match: approx(c.stored, c.source) }));
    return {
      ok: checks.every(c => c.match),
      matchedTime: time[idx] ?? null,
      lat, lng, timezone: j?.timezone ?? prov.timezone ?? null, checks,
    };
  } catch (e: any) {
    return { ok: false, matchedTime: null, lat, lng, timezone: prov.timezone ?? null, checks: [],
      error: String(e?.message ?? e) };
  }
}
