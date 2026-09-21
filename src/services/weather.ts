import AsyncStorage from '@react-native-async-storage/async-storage';
import { slimCachedWeather } from './database';
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
  // Backend render contract, added by the latest_weather_per_stop view.
  // Absent on rows cached before it existed — see buildSourceComparison.
  display?: any;
  // Condition score, computed by weather_score() in the same view against the
  // stop's current shot_type. Absent on rows cached before it existed —
  // see readScore, which falls back to the stored score_* columns.
  score?: any;
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
// readScore, the verification badges, and the day overview all keep
// working from cached rows without change.
// ─────────────────────────────────────────
interface CachedDay { cachedAt: number; byStop: Record<string, WeatherRow>; }
interface CachedStop { cachedAt: number; row: WeatherRow; }

export async function cacheWeatherForDay(
  dayId: string,
  byStop: Record<string, WeatherRow>
): Promise<void> {
  try {
    // Slimmed on the way to disk. Android's AsyncStorage is one SQLite
    // database with a fixed total budget, and this trip's weather is held in
    // three places — here, the per-stop entries, and the trip's own per-day
    // entries. Three full copies of every model, ensemble and centre spread
    // exhausted it, which made writes start failing silently.
    const slim: Record<string, WeatherRow> = {};
    for (const [k, v] of Object.entries(byStop)) slim[k] = slimCachedWeather(v);
    const payload: CachedDay = { cachedAt: Date.now(), byStop: slim };
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

// Reclaim. Earlier builds wrote a full weather row per stop, each carrying
// every model, the ensemble and the centre spread. Those entries are only
// ever overwritten if that same stop is opened again, so they accumulate and
// crowd out the writes that matter — on Android this is one SQLite database
// with a fixed total budget, and once it is full, writes fail silently.
// The per-day entries and the trip's own copy both already cover every stop.
export async function pruneStopWeatherCache(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(k => k.startsWith(WEATHER_STOP_PREFIX));
    if (stale.length) await AsyncStorage.multiRemove(stale);
    return stale.length;
  } catch {
    return 0;
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
  opts: { test?: boolean; timeoutMs?: number } = {}
): Promise<PullWeatherResult> {
  // A single day fans out to 4 weather sources per stop; a stop-heavy day
  // (e.g. a 9-stop arrival day) can legitimately take 30s+. The default 12s
  // is right for snappy single-day/resume reads, but the whole-trip update
  // passes a generous timeout so heavy days don't false-fail mid-run.
  const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/weather-pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ day_id: dayId, test: opts.test === true }),
  }, opts.timeoutMs ?? 12000);
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
    // No per-stop write: the per-day entry and the trip's own copy both cover
    // this stop, and a third copy is what exhausted the storage budget.
    // getCachedWeatherForStop still READS legacy per-stop entries.
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
  // Pull stops alongside days so we can skip days with nothing to forecast.
  const { data: days, error } = await supabase
    .from('days')
    .select('id, date, stops(lat, lng, shot_type)')
    .eq('trip_id', tripId)
    .order('day_number', { ascending: true });
  if (error || !days) throw new Error('Failed to fetch days');

  // Two kinds of day produce no forecast and shouldn't count as failures:
  //  1. Past days — Open-Meteo's forecast endpoint returns no data for dates
  //     before today, so the pull comes back empty.
  //  2. Stopless logistics days (e.g. "Wheels Up", "Safe Home") — no mappable
  //     stop means nothing to score.
  // Filtering them here keeps the "Pulled X of Y" count honest and the run fast.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const pullable = (days as any[]).filter((d) => {
    const notPast = !d.date || new Date(d.date + 'T00:00:00') >= today;
    const hasStop = Array.isArray(d.stops) && d.stops.some(
      (s: any) => s.lat != null && s.lng != null && s.shot_type !== 'logistics'
    );
    return notPast && hasStop;
  });

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < pullable.length; i++) {
    const d = pullable[i] as { id: string; date: string | null };
    try {
      // 40s per-day ceiling: comfortably above the worst observed heavy-day
      // pull (~33s) so stop-heavy days don't abort mid-flight, while still
      // bounding a genuinely hung request.
      const res = await pullWeather(d.id, { test: useTestModeFor(d.date), timeoutMs: 40000 });
      if (res.ok) ok++; else failed++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, pullable.length);
    await new Promise(r => setTimeout(r, 250));
  }
  return { days: pullable.length, ok, failed };
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

// Rain cell for the comparison table. Probability is essentially Open-Meteo-only;
// the other sources emit precipitation AMOUNT instead. Show whichever exists so
// the column is comparable across sources rather than mostly dashes.
// Returns the display string plus a flag indicating which kind it is.
export const kmToMiles = (km: number) => km * 0.621371;

export function rainCell(
  probPct: number | null, amountMm: number | null
): { text: string; kind: 'prob' | 'amount' | 'none' } {
  if (probPct != null) return { text: `${Math.round(probPct)}%`, kind: 'prob' };
  if (amountMm != null) return { text: inchesText(amountMm / 25.4), kind: 'amount' };
  return { text: '—', kind: 'none' };
}

// ─────────────────────────────────────────
// GENERIC FIELD RENDERING
// The contract hands over every field a model reported, and the set grows
// whenever the edge function asks Open-Meteo for more. Rather than listing
// fields here — which would mean an app release every time the backend learns
// something — a field is rendered from the shape of its own name. A key ending
// _pct is a percentage, _kmh is a wind speed, _m is a height. An unrecognised
// key still renders: humanised label, raw value, no crash.
// Known keys get a better label and a better unit; everything else falls
// through to the suffix rules.
// ─────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  temperature_c: 'Temperature',
  apparent_temperature_c: 'Feels like',
  dew_point_c: 'Dew point',
  relative_humidity_pct: 'Humidity',
  cloud_cover_pct: 'Cloud cover',
  cloud_cover_low_pct: 'Low cloud',
  cloud_cover_mid_pct: 'Mid cloud',
  cloud_cover_high_pct: 'High cloud',
  cloud_cover_2m_pct: 'Fog at ground',
  cloud_base_m: 'Cloud base',
  cloud_top_m: 'Cloud top',
  visibility_m: 'Visibility',
  precip_mm: 'Precipitation',
  rain_mm: 'Rain',
  showers_mm: 'Showers',
  snowfall_cm: 'Snowfall',
  precip_probability_pct: 'Chance of precip',
  wind_speed_kmh: 'Wind',
  wind_gusts_kmh: 'Gusts',
  wind_direction_deg: 'Wind from',
  surface_pressure_hpa: 'Pressure',
  uv_index: 'UV index',
  weather_code: 'WMO code',
  conditions: 'Conditions',
  fog_risk: 'Fog risk',
  is_day: 'Daylight',
  wave_height_m: 'Wave height',
  wave_period_s: 'Wave period',
  wave_direction_deg: 'Waves from',
  swell_wave_height_m: 'Swell height',
  swell_wave_period_s: 'Swell period',
  wind_wave_height_m: 'Wind wave',
  sea_surface_temp_c: 'Sea temp',
  // Observed at the airfield, not forecast. Units differ from the models on
  // purpose — a METAR reports wind in knots and ceiling in feet, and it is
  // converted on display rather than rewritten at ingest.
  ceiling_ft: 'Ceiling',
  wind_speed_kt: 'Wind',
  wind_gust_kt: 'Gusts',
  wind_dir_deg: 'Wind from',
  cover: 'Sky cover',
  wx_string: 'Present weather',
  flight_category: 'Flight category',
  station: 'Station',
};

// Fields already shown as their own column in the comparison table. Hidden
// from the expanded detail so it does not just repeat the row above it.
// Ground-truth keys that are either shown in the summary line above the
// detail, or are not a measurement at all.
export const FIELD_NOT_A_VALUE = new Set([
  'station', 'observed_at', 'raw_metar', 'raw_taf',
]);

export const FIELD_IN_TABLE = new Set([
  'cloud_cover_pct', 'cloud_cover_low_pct', 'cloud_base_m', 'visibility_m',
  'precip_mm', 'precip_probability_pct', 'wind_gusts_kmh', 'wind_speed_kmh',
  'temperature_c',
]);

// Hourly precipitation in inches is a small number: 0.5 mm is 0.02 in. Two
// decimals, and an explicit "<.01" rather than rounding real rain to zero.
export function inchesText(inches: number): string {
  if (inches <= 0) return '0 in';
  if (inches < 0.01) return '<.01 in';
  return `${inches.toFixed(2)} in`;
}

export function fieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  return key
    .replace(/_(pct|kmh|mm|cm|hpa|deg|c|m|s)$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, ch => ch.toUpperCase());
}

// Value → display string, in the units the rest of the app already uses:
// °F, mph, feet, miles. Returns null for a value worth omitting entirely.
export function fieldValueText(key: string, v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);

  if (key === 'weather_code') return String(v);
  if (key === 'uv_index') return v.toFixed(1);
  if (key.endsWith('_pct')) return `${Math.round(v)}%`;
  if (key.endsWith('_kmh')) return `${Math.round(kmhToMph(v))} mph`;
  // The METAR's own units. Knots to mph so observed wind can be read against
  // the models' forecast wind without doing arithmetic on a clifftop.
  if (key.endsWith('_kt')) return `${Math.round(v * 1.15078)} mph`;
  if (key.endsWith('_ft')) return `${Math.round(v).toLocaleString()} ft`;
  if (key.endsWith('_deg')) return `${windDir(v)} (${Math.round(v)}°)`;
  // Everything imperial. Open-Meteo answers in metric and we convert on
  // display rather than at ingest, so the stored numbers stay comparable with
  // the source and only this function decides what you read.
  if (key.endsWith('_hpa')) return `${(v * 0.02953).toFixed(2)} inHg`;
  if (key.endsWith('_mm')) return inchesText(v / 25.4);
  if (key.endsWith('_cm')) return inchesText(v / 2.54);
  if (key.endsWith('_c')) return `${Math.round(cToF(v))}°F`;
  if (key.endsWith('_s')) return `${v.toFixed(1)} s`;
  if (key === 'visibility_m') return visibilityText(v);
  // Wave heights are small metres and read better as feet with a decimal;
  // cloud base and top are large and round to the nearest hundred feet.
  if (key.endsWith('_m')) {
    const ft = v * 3.28084;
    return ft < 100 ? `${ft.toFixed(1)} ft` : `${(Math.round(ft / 100) * 100).toLocaleString()} ft`;
  }
  return String(v);
}

// Every field of a source, ready to render, in a stable order: the ones we
// have a label for first (in the order declared above, which groups sky, then
// precipitation, then wind), then anything new the backend has started
// sending, alphabetically.
export function allFields(
  values: Record<string, any>,
  opts?: { skipTableFields?: boolean; skipNonValues?: boolean }
): { key: string; label: string; text: string }[] {
  const known = Object.keys(FIELD_LABELS);
  const order = (k: string) => {
    const i = known.indexOf(k);
    return i === -1 ? 1000 : i;
  };
  return Object.keys(values ?? {})
    .filter(k => !(opts?.skipTableFields && FIELD_IN_TABLE.has(k)))
    .filter(k => !(opts?.skipNonValues && FIELD_NOT_A_VALUE.has(k)))
    .map(k => ({ key: k, label: fieldLabel(k), text: fieldValueText(k, values[k]) }))
    .filter(f => f.text != null)
    .sort((a, b) => {
      const oa = order(a.key), ob = order(b.key);
      if (oa !== ob) return oa - ob;
      return a.key < b.key ? -1 : 1;
    }) as { key: string; label: string; text: string }[];
}

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

// The maths now lives in ONE place: weather_score() in the database, exposed
// by latest_weather_per_stop as `score`. Editing that function changes every
// stop immediately — no edge deploy, no app release, no re-pull — and applies
// to rows already stored.
//
// The app used to carry its own copy so the stars could follow a stop's
// CURRENT shot_type rather than whatever it was at pull time. The view keeps
// that property by joining stops live, so the copy is gone.
//
// Two sources, in order:
//   1. row.score — computed by the view against the stop's current type.
//   2. the score_* columns the edge function wrote at pull time, for rows
//      cached before the view exposed `score`. Those reflect the shot_type as
//      it was at that pull, so they can lag a type change until the next sync.
export function readScore(shotType: string | null, r: WeatherRow): ConditionScore | null {
  if (!shotType || shotType === 'logistics') return null;

  const live = (r as any)?.score;
  if (live && typeof live === 'object' && live.stars != null) {
    return { stars: live.stars, label: live.label, reason: live.reason };
  }

  const stars = (r as any)?.score_stars;
  if (stars != null) {
    return {
      stars,
      label: (r as any).score_label ?? LABELS[stars] ?? '',
      reason: (r as any).score_reason ?? '',
    };
  }
  return null;
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

// ─────────────────────────────────────────
// MULTI-SOURCE COMPARISON (read-only)
//
// Driven entirely by the backend render contract at row.display, built by the
// latest_weather_per_stop view. Adding a model, renaming one, or changing the
// primary in another region needs no change here — the list is whatever the
// contract hands us, already ordered.
//
// Ordering comes from the backend: grid size first, distance breaking ties. A
// coarse model whose nearest grid point happens to land close is still
// averaging over its whole cell, so resolution is the real signal.
//
// Older cached rows predate the contract, so a legacy fallback reconstructs
// the four named sources from raw.{metno,ukmo,met_eireann}. That path can go
// once no cached row is older than the contract.
// ─────────────────────────────────────────
export type SourceKey = string;

export interface SourceReading {
  key: SourceKey;            // the model string, e.g. dmi_harmonie_arome_europe
  name: string;
  centre: string | null;
  present: boolean;
  isPrimary: boolean;
  resolutionKm: number | null;   // grid size — how local this number can be
  distanceKm: number | null;     // how far the sampled grid point actually is
  isBlend: boolean;
  blendNote: string | null;
  gustMeasured: boolean;
  note?: string;
  // Every field the backend collected for this model, untouched. The named
  // fields below are convenience accessors onto the same data — anything the
  // edge function starts collecting shows up here with no change in this file
  // and no change in the view, which passes the model object through whole.
  values: Record<string, any>;
  temperature_c: number | null;
  cloud_cover_pct: number | null;
  cloud_cover_low_pct: number | null;
  cloud_base_m: number | null;
  precip_probability_pct: number | null;
  rain_mm: number | null;
  wind_speed_kmh: number | null;
  wind_gusts_kmh: number | null;
  visibility_m: number | null;
  relative_humidity_pct: number | null;
  surface_pressure_hpa: number | null;
  weather_code: number | null;
  fog_risk: string | null;
  stars: number | null;
}

export interface EnsembleVar {
  min: number | null; p10: number | null; median: number | null;
  p90: number | null; max: number | null; stdev: number | null;
  members: number | null;
  // Threshold probabilities live alongside the percentiles, named per
  // variable by the backend (prob_wet_pct, prob_gust_over_40_pct, ...).
  probs: Record<string, number>;
}

export interface SourceUncertainty {
  members: number | null;
  gridCell: string | null;
  probAnyRainPct: number | null;
  probWetPct: number | null;
  probGustOver40Pct: number | null;
  probGustOver60Pct: number | null;
  probBrokenSkyPct: number | null;
  fogProbabilityAvailable: boolean;
  // The full spread per variable — p10/median/p90 says how wide the
  // possibilities are, which a single probability cannot.
  byVariable: Record<string, EnsembleVar>;
}

// How far one model's own forecast for this hour has moved between its last
// four runs. Small drift means the model has settled; large drift means it is
// still arguing with itself and the number on screen is soft.
export interface ConvergenceVar {
  runs: number[];
  drift: number | null;
  stdev: number | null;
}

// Spread across forecasting CENTRES (one representative each), not across
// model strings — six ECMWF derivatives are not six opinions.
export interface ConsensusVar {
  min?: number | null; max?: number | null; mean?: number | null;
  spread?: number | null; agreement?: string | null;
  [k: string]: any;
}

export interface SeaState {
  wave_height_m: number | null;
  wave_period_s: number | null;
  wave_direction_deg: number | null;
  swell_wave_height_m: number | null;
  swell_wave_period_s: number | null;
  wind_wave_height_m: number | null;
  sea_surface_temp_c: number | null;
  [k: string]: any;
}

export interface GroundTruth {
  station: string | null;
  observedAt: string | null;
  ceilingFt: number | null;
  visibilityM: number | null;
  flightCategory: string | null;
  rawMetar: string | null;
  rawTaf: string | null;        // the forecast the airfield itself is flying on
  // Everything else the observation carries — observed temperature and dew
  // point, wind, sky cover, present weather. Same principle as a model's
  // values: passed through whole, rendered generically.
  values: Record<string, any>;
}

export interface SourceComparison {
  sources: SourceReading[];
  hasMulti: boolean;
  fromContract: boolean;      // false = legacy cached row
  centreCount: number | null;
  agreement: string | null;   // AGREED | MIXED | CONTESTED — or, on a legacy
                              // cached row, the old TIGHT | LOOSE | SPLIT.
  cloudConsensus: number | null;
  cloudOutlier: SourceKey | null;
  cloudOutlierDelta: number | null;
  uncertainty: SourceUncertainty | null;
  groundTruth: GroundTruth | null;
  verdict: string;
  // Contract v2. Null on older cached rows.
  contractVersion: number;
  primaryModel: string | null;
  horizonHours: number | null;
  fetchedAt: string | null;
  forecastValidFor: string | null;
  consensus: Record<string, ConsensusVar> | null;
  convergence: { model: string | null; byVariable: Record<string, ConvergenceVar> } | null;
  sea: SeaState | null;
  score: any | null;
  provenance: any | null;
}

const n = (v: any): number | null => {
  if (v == null) return null;
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : null;
};

function fromContract(display: any, row: WeatherRow): SourceComparison {
  const sources: SourceReading[] = (display.sources ?? []).map((s: any) => {
    const v = s.values ?? {};
    return {
      key: s.model,
      name: s.label ?? s.model,
      centre: s.centre ?? null,
      present: v.temperature_c != null || v.cloud_cover_pct != null,
      isPrimary: !!s.is_primary,
      resolutionKm: n(s.resolution_km),
      distanceKm: n(s.distance_km),
      isBlend: !!s.is_blend,
      blendNote: s.blend_note ?? null,
      gustMeasured: v.wind_gusts_kmh != null,
      values: v,
      temperature_c: n(v.temperature_c),
      cloud_cover_pct: n(v.cloud_cover_pct),
      cloud_cover_low_pct: n(v.cloud_cover_low_pct),
      cloud_base_m: n(v.cloud_base_m),
      precip_probability_pct: n(v.precip_probability_pct),
      rain_mm: n(v.precip_mm),
      wind_speed_kmh: n(v.wind_speed_kmh),
      wind_gusts_kmh: n(v.wind_gusts_kmh),
      visibility_m: n(v.visibility_m),
      relative_humidity_pct: n(v.relative_humidity_pct),
      surface_pressure_hpa: n(v.surface_pressure_hpa),
      weather_code: n(v.weather_code),
      fog_risk: v.fog_risk ?? null,
      stars: null,
    };
  });

  // Outlier on cloud, weighted to the models that can actually resolve this
  // stop. A 55 km model disagreeing is not news; a 2 km one is.
  const local = sources.filter(s => s.cloud_cover_pct != null && (s.resolutionKm ?? 99) <= 15);
  const pool = local.length >= 2 ? local : sources.filter(s => s.cloud_cover_pct != null);
  let cloudConsensus: number | null = null;
  let cloudOutlier: SourceKey | null = null;
  let cloudOutlierDelta: number | null = null;
  if (pool.length >= 2) {
    const vals = pool.map(s => s.cloud_cover_pct as number);
    cloudConsensus = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    let worst = 0;
    for (const s of pool) {
      const others = pool.filter(o => o.key !== s.key).map(o => o.cloud_cover_pct as number);
      const mean = others.reduce((a, b) => a + b, 0) / others.length;
      const d = Math.abs((s.cloud_cover_pct as number) - mean);
      if (d > worst) { worst = d; cloudOutlier = s.key; cloudOutlierDelta = Math.round(d); }
    }
    if (worst < 25) { cloudOutlier = null; cloudOutlierDelta = null; }
  }

  const u = display.uncertainty;
  const g = display.ground_truth;
  const agreement = display.agreement?.level ?? null;
  const centreCount = n(display.centre_count);

  const verdict = display.agreement?.note
    ?? (sources.length ? `${sources.length} sources` : 'No sources');

  return {
    sources,
    hasMulti: sources.filter(s => s.present).length >= 2,
    fromContract: true,
    centreCount,
    agreement,
    cloudConsensus, cloudOutlier, cloudOutlierDelta,
    uncertainty: u ? {
      members: n(u.members),
      gridCell: u.grid_cell ?? null,
      // v1 kept the probabilities at the top level; v2 moved them under the
      // variable they belong to. Read either.
      probAnyRainPct: n(u.prob_any_rain_pct ?? uv(u, 'precipitation', 'prob_any_rain_pct')),
      probWetPct: n(u.prob_wet_pct ?? uv(u, 'precipitation', 'prob_wet_pct')),
      probGustOver40Pct: n(u.prob_gust_over_40_pct ?? uv(u, 'wind_gusts_10m', 'prob_gust_over_40_pct')),
      probGustOver60Pct: n(u.prob_gust_over_60_pct ?? uv(u, 'wind_gusts_10m', 'prob_gust_over_60_pct')),
      probBrokenSkyPct: n(u.prob_broken_sky_pct ?? uv(u, 'cloud_cover', 'prob_broken_sky_pct')),
      fogProbabilityAvailable: !!u.fog_probability_available,
      byVariable: ensembleVars(u.by_variable),
    } : null,
    groundTruth: g ? {
      station: g.station ?? null,
      observedAt: g.observed_at ?? null,
      ceilingFt: n(g.ceiling_ft),
      visibilityM: n(g.visibility_m),
      flightCategory: g.flight_category ?? null,
      rawMetar: g.raw_metar ?? null,
      rawTaf: g.raw_taf ?? null,
      values: g,
    } : null,
    verdict,
    contractVersion: n(display.version) ?? 1,
    primaryModel: display.primary_model ?? null,
    horizonHours: n(display.horizon_hours),
    fetchedAt: display.fetched_at ?? null,
    forecastValidFor: display.forecast_valid_for ?? null,
    consensus: display.consensus ?? null,
    convergence: display.convergence ? {
      model: display.convergence.model ?? null,
      byVariable: display.convergence.by_variable ?? {},
    } : null,
    sea: display.sea ?? null,
    score: display.score ?? null,
    provenance: display.provenance ?? null,
  };
}

// Pull one threshold probability out of the v2 by_variable shape.
function uv(u: any, variable: string, key: string): any {
  return u?.by_variable?.[variable]?.[key] ?? null;
}

// Split each ensemble variable into its distribution and whatever threshold
// probabilities the backend attached to it. The probs are collected by shape
// (any prob_*_pct key) rather than by name, so a new threshold needs no change
// here.
function ensembleVars(by: any): Record<string, EnsembleVar> {
  const out: Record<string, EnsembleVar> = {};
  for (const [k, raw] of Object.entries(by ?? {})) {
    const v = raw as any;
    const probs: Record<string, number> = {};
    for (const [pk, pv] of Object.entries(v)) {
      if (pk.startsWith('prob_') && typeof pv === 'number') probs[pk] = pv;
    }
    out[k] = {
      min: n(v.min), p10: n(v.p10), median: n(v.median),
      p90: n(v.p90), max: n(v.max), stdev: n(v.stdev),
      members: n(v.members), probs,
    };
  }
  return out;
}

// Legacy path for rows cached before the render contract existed.
function fromLegacyRaw(row: WeatherRow): SourceComparison {
  const mk = (key: string, name: string, sub: any): SourceReading => ({
    key, name, centre: null,
    present: !!sub && !sub.error && (sub.temperature_c != null || sub.cloud_cover_pct != null),
    isPrimary: false, resolutionKm: null, distanceKm: null, isBlend: false,
    blendNote: null,
    gustMeasured: sub?.wind_gusts_kmh != null && !sub?.gust_is_estimated,
    note: sub?.error ? 'unavailable' : undefined,
    values: (sub && typeof sub === 'object') ? sub : {},
    temperature_c: sub?.temperature_c ?? null,
    cloud_cover_pct: sub?.cloud_cover_pct ?? null,
    cloud_cover_low_pct: sub?.cloud_cover_low_pct ?? null,
    cloud_base_m: sub?.cloud_base_m ?? null,
    precip_probability_pct: sub?.precip_probability_pct ?? null,
    rain_mm: sub?.rain_mm ?? null,
    wind_speed_kmh: sub?.wind_speed_kmh ?? null,
    wind_gusts_kmh: sub?.wind_gusts_kmh ?? null,
    visibility_m: sub?.visibility_m ?? null,
    relative_humidity_pct: sub?.relative_humidity_pct ?? null,
    surface_pressure_hpa: sub?.surface_pressure_hpa ?? null,
    weather_code: sub?.weather_code ?? null,
    fog_risk: sub?.fog_risk ?? null,
    stars: sub?.score?.stars ?? null,
  });

  const primary: SourceReading = {
    ...mk('primary', row.raw?.primary_model ?? 'Primary', null),
    present: row.temperature_c != null,
    isPrimary: true,
    temperature_c: row.temperature_c, cloud_cover_pct: row.cloud_cover_pct,
    precip_probability_pct: row.precip_probability_pct, rain_mm: row.rain_mm,
    wind_speed_kmh: row.wind_speed_kmh, wind_gusts_kmh: row.wind_gusts_kmh,
    visibility_m: row.visibility_m, relative_humidity_pct: row.relative_humidity_pct,
    surface_pressure_hpa: row.surface_pressure_hpa, weather_code: row.weather_code,
    stars: row.raw?.score?.stars ?? null, gustMeasured: true, note: undefined,
  };

  const sources = [
    primary,
    mk('metno', 'MET Norway', row.raw?.metno),
    mk('ukmo', 'UK Met Office', row.raw?.ukmo),
  ];
  const present = sources.filter(s => s.present);
  return {
    sources, hasMulti: present.length >= 2, fromContract: false,
    centreCount: null, agreement: row.raw?.comparison?.agreement ?? null,
    cloudConsensus: null, cloudOutlier: null, cloudOutlierDelta: null,
    uncertainty: null, groundTruth: null,
    verdict: `${present.length} sources (cached before source detail was added)`,
    contractVersion: 0, primaryModel: row.raw?.primary_model ?? null,
    horizonHours: null, fetchedAt: row.fetched_at ?? null,
    forecastValidFor: null, consensus: null, convergence: null,
    sea: row.raw?.sea ?? null, score: row.raw?.score ?? null, provenance: null,
  };
}

export function buildSourceComparison(row: WeatherRow): SourceComparison {
  const display = (row as any)?.display;
  if (display && Array.isArray(display.sources) && display.sources.length) {
    return fromContract(display, row);
  }
  return fromLegacyRaw(row);
}
