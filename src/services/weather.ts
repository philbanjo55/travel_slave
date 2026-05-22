import { supabase } from './supabase';

const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2';

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
  const res = await fetch(`${SUPABASE_URL}/functions/v1/weather-pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ day_id: dayId, test: opts.test === true }),
  });
  return res.json();
}

// ─────────────────────────────────────────
// READ — latest stored forecast per stop for a day, from the
// latest_weather_per_stop view (distinct on stop_id, newest fetched_at).
// Returned keyed by stop_id for easy per-stop lookup.
// ─────────────────────────────────────────
export async function fetchLatestWeatherForDay(
  dayId: string
): Promise<Record<string, WeatherRow>> {
  const { data, error } = await supabase
    .from('latest_weather_per_stop')
    .select('*')
    .eq('day_id', dayId);
  if (error || !data) return {};
  const byStop: Record<string, WeatherRow> = {};
  for (const row of data as WeatherRow[]) byStop[row.stop_id] = row;
  return byStop;
}

export async function fetchLatestWeatherForStop(
  stopId: string
): Promise<WeatherRow | null> {
  const { data, error } = await supabase
    .from('latest_weather_per_stop')
    .select('*')
    .eq('stop_id', stopId)
    .maybeSingle();
  if (error || !data) return null;
  return data as WeatherRow;
}

// Open-Meteo forecasts ~16 days out. If the target date is beyond that horizon
// (or missing), fall back to test mode (today+2) so we still get real,
// sanity-checkable data. Within range, use the real trip date. This lets the
// buttons "just work" now and automatically switch to true trip-date forecasts
// as each day comes within range — no manual toggle.
export function useTestModeFor(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true;
  const target = new Date(`${dateStr}T12:00:00`).getTime();
  if (isNaN(target)) return true;
  const days = (target - Date.now()) / 86400000;
  return days < 0 || days > 15;
}

// Pull weather for every day in a trip (the "whole trip" update). Calls
// weather-pull once per day, auto-deciding test mode per day's date.
// Sequential with light pacing since each day fans out to Open-Meteo per stop.
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

export function tempText(c: number | null): string {
  return c == null ? '—' : `${Math.round(c)}°C`;
}

export function windText(kmh: number | null): string {
  return kmh == null ? '—' : `${Math.round(kmh)} km/h`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function windDir(deg: number | null): string {
  if (deg == null) return '';
  return COMPASS[Math.round(deg / 45) % 8];
}

export function visibilityText(m: number | null): string {
  if (m == null) return '—';
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
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
const SEVERE = (c: number | null) => c != null && (c === 65 || c === 82 || c === 75 || c >= 95);

export function scoreConditions(shotType: string | null, r: WeatherRow): ConditionScore | null {
  if (!shotType || shotType === 'logistics') return null;

  const cloud = r.cloud_cover_pct ?? 50;
  const gust = r.wind_gusts_kmh ?? r.wind_speed_kmh ?? 0;
  const pop = r.precip_probability_pct ?? 0;
  const rain = (r.rain_mm ?? 0) + (r.showers_mm ?? 0);
  const code = r.weather_code;
  const vis = r.visibility_m;
  const foggy = r.fog_risk === 'likely' || r.fog_risk === 'possible';

  // Light-dependent shots are impossible after dark — overrides everything.
  if (r.is_dark) return { stars: 0, label: 'Poor', reason: 'After dark' };

  let s = 2;
  let reason = '';

  switch (shotType) {
    case 'waterfall':
    case 'canyon': {
      if (cloud >= 65) { s += 1; reason = 'Soft overcast light'; }
      else if (cloud < 25) { s -= 1; reason = 'Harsh direct sun'; }
      if (gust < 12) { s += 1; if (!reason) reason = 'Calm — clean long exposures'; }
      else if (gust > 30) { s -= 1; reason = 'Wind will move foliage'; }
      if (SEVERE(code) || rain > 10) { s -= 2; reason = 'Heavy rain — spate / safety risk'; }
      break;
    }
    case 'mountain': {
      if (cloud < 30) { s += 1; reason = 'Clear summits'; }
      else if (cloud > 75) { s -= 2; reason = 'Summits likely socked in'; }
      if (r.is_golden_hour) { s += 1; reason = 'Golden-hour light on peaks'; }
      if (foggy || (vis != null && vis < 2000)) { s -= 1; reason = 'Low visibility'; }
      break;
    }
    case 'seascape': {
      if (gust > 55) return { stars: 0, label: 'Poor', reason: 'Dangerous wind / swell' };
      if (gust < 15) { s += 1; reason = 'Calm sea'; }
      else if (gust > 40) { s -= 2; reason = 'Heavy swell — exposed rocks'; }
      if (SEVERE(code)) { s -= 2; reason = 'Storm conditions'; }
      else if (cloud >= 30 && cloud <= 85) { s += 1; if (!reason) reason = 'Some sky drama'; }
      break;
    }
    case 'reflection': {
      // Wind dominates — mirror water needs near-still air.
      if (gust < 6) s = 4;
      else if (gust < 10) s = 3;
      else if (gust < 16) s = 2;
      else if (gust < 25) s = 1;
      else s = 0;
      reason = gust < 10 ? 'Near-still — mirror water' : 'Wind will break reflection';
      if (SEVERE(code) || rain > 10) s = Math.min(s, 1);
      break;
    }
    case 'castle': {
      if (cloud >= 40 && cloud <= 90) { s += 1; reason = 'Moody sky'; }
      if (r.is_golden_hour) { s += 1; reason = 'Golden-hour light on stone'; }
      if (SEVERE(code)) { s -= 1; reason = 'Heavy rain — hard to shoot'; }
      break;
    }
    case 'urban': {
      s = 3; // weather-light
      if (SEVERE(code)) { s -= 2; reason = 'Heavy rain'; }
      else reason = 'Generally workable';
      break;
    }
    default: {
      if (cloud >= 65) s += 1;
      if (SEVERE(code)) s -= 1;
      reason = 'Mixed';
    }
  }

  s = clamp(s);
  return { stars: s, label: LABELS[s], reason: reason || LABELS[s] };
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
  const summary = `${sky[0].toUpperCase() + sky.slice(1)}, ${wind} (gusts ${Math.round(maxGust)} km/h), ${rain}.`
    + (foggy ? ` Fog ${foggy > 1 ? 'risk at several stops' : 'risk at one stop'}.` : '')
    + (golden ? ` ${golden} stop${golden > 1 ? 's' : ''} near golden hour.` : '');

  const forecastDate = ok[0].forecast_valid_for ? ok[0].forecast_valid_for.slice(0, 10) : null;
  const preview = !dayDate || (forecastDate != null && forecastDate !== dayDate);

  return { count: ok.length, tempMin, tempMax, avgCloud, maxPrecip, maxGust, foggy, golden, code, summary, preview, forecastDate };
}

// Per-row preview/real resolution (for the stop card flag).
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
