// ---------------------------------------------------------------------------
// MET Norway (api.met.no) second-source adapter.
//
// Pulls Locationforecast 2.0 for a stop's coordinates + target hour, normalizes
// it into the SAME shape scoreConditions() already consumes (see WeatherRow in
// weather.ts), so the existing scorer/verification/confidence logic all work
// unchanged. This is the first adapter for the pluggable "second source" slot;
// future trips can add others (Icelandic Met, NWS) emitting the same shape.
//
// Runs frontend-side (the app's network can reach api.met.no; the sandbox can't).
// ---------------------------------------------------------------------------
import { scoreConditions, WeatherRow, ConditionScore } from './weather';

// MET Norway REQUIRES a descriptive User-Agent with contact info or returns 403.
const USER_AGENT = 'PhilmFrame/1.0 phil@philmframe.com';

// api.met.no caps coordinates at 4 decimals (else 400 Bad Request) and caches
// on the rounded URL — so we round to be a good citizen and to hit their cache.
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const msToKmh = (ms: number | null | undefined) => (ms == null ? null : Math.round(ms * 3.6 * 10) / 10);

// MET Norway returns a string symbol_code (e.g. "lightrain", "partlycloudy_day")
// instead of a WMO integer. scoreConditions switches on WMO codes, so map the
// symbol to the closest WMO code. We strip the _day/_night/_polartwilight suffix
// first. Only the precipitation-bearing codes really matter for scoring; clear/
// cloudy map to benign codes that carry no rain penalty.
function symbolToWmo(symbol: string | null | undefined): number | null {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  const map: Record<string, number> = {
    clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3,
    fog: 45,
    lightrainshowers: 80, rainshowers: 80, heavyrainshowers: 82,
    lightrainshowersandthunder: 95, rainshowersandthunder: 95, heavyrainshowersandthunder: 96,
    lightrain: 61, rain: 63, heavyrain: 65,
    lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 96,
    lightsleet: 66, sleet: 67, heavysleet: 67,
    lightsleetshowers: 66, sleetshowers: 67, heavysleetshowers: 67,
    lightsnow: 71, snow: 73, heavysnow: 75,
    lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
    lightssleetshowersandthunder: 95, // (MET typo-safe alias)
  };
  return map[s] ?? null;
}

interface MetNoResult {
  row: Partial<WeatherRow> & { score?: ConditionScore | null };
  raw: any;
  error?: string;
}

// targetIso: the stop's local datetime we want, as an ISO string in UTC
// (e.g. "2026-06-23T20:00:00Z"). We pick the timeseries entry at-or-before it.
export async function fetchMetNoForStop(
  lat: number,
  lng: number,
  targetIsoUtc: string,
  shotType: string | null,
  extras?: { sunriseIso?: string | null; sunsetIso?: string | null; isDark?: boolean }
): Promise<MetNoResult> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${round4(lat)}&lon=${round4(lng)}`;
  let json: any;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    // 203 is NORMAL for MET Norway (non-authoritative / beta), not an error.
    if (!res.ok && res.status !== 203) {
      return { row: {}, raw: null, error: `met.no ${res.status}` };
    }
    json = await res.json();
  } catch (e: any) {
    return { row: {}, raw: null, error: String(e?.message ?? e) };
  }

  const series: any[] = json?.properties?.timeseries ?? [];
  if (!series.length) return { row: {}, raw: json, error: 'no timeseries' };

  // Find the entry at-or-before the target time (series is hourly near-term,
  // 6-hourly past ~3 days). Track match quality for the VERIFIED badge.
  const targetMs = Date.parse(targetIsoUtc);
  let chosen = series[0];
  let matchMethod = 'positional-fallback';
  let exact = false;
  for (const entry of series) {
    const t = Date.parse(entry.time);
    if (t === targetMs) { chosen = entry; exact = true; matchMethod = 'exact'; break; }
    if (t <= targetMs) { chosen = entry; matchMethod = 'nearest-before'; }
    else break;
  }

  const inst = chosen?.data?.instant?.details ?? {};
  // Precip: prefer the 1-hour block; fall back to 6-hour (only block past ~3d out).
  const p1 = chosen?.data?.next_1_hours?.details;
  const p6 = chosen?.data?.next_6_hours?.details;
  const precipBlock = p1 ?? p6 ?? {};
  const symbol = chosen?.data?.next_1_hours?.summary?.symbol_code
    ?? chosen?.data?.next_6_hours?.summary?.symbol_code ?? null;

  // Option A: derive a visibility proxy from fog_area_fraction, since MET Norway
  // has no visibility field but scoreConditions leans on it. High fog fraction
  // => low visibility. We also set fog_risk so the fog branch of the scorer fires.
  const fogPct: number | null = inst.fog_area_fraction ?? null;
  let visibility_m: number | null = null;
  let fog_risk: string = 'none';
  if (fogPct != null) {
    if (fogPct >= 80) { visibility_m = 500; fog_risk = 'likely'; }
    else if (fogPct >= 40) { visibility_m = 3000; fog_risk = 'possible'; }
    else if (fogPct >= 15) { visibility_m = 7000; fog_risk = 'none'; }
    else { visibility_m = 20000; fog_risk = 'none'; }
  }

  const row: Partial<WeatherRow> = {
    temperature_c: inst.air_temperature ?? null,
    relative_humidity_pct: inst.relative_humidity ?? null,
    dew_point_c: inst.dew_point_temperature ?? null,
    surface_pressure_hpa: inst.air_pressure_at_sea_level ?? null,
    cloud_cover_pct: inst.cloud_area_fraction ?? null,
    cloud_cover_low_pct: inst.cloud_area_fraction_low ?? null,
    cloud_cover_mid_pct: inst.cloud_area_fraction_medium ?? null,
    cloud_cover_high_pct: inst.cloud_area_fraction_high ?? null,
    wind_speed_kmh: msToKmh(inst.wind_speed),
    wind_gusts_kmh: msToKmh(inst.wind_speed_of_gust),
    wind_direction_deg: inst.wind_from_direction ?? null,
    precip_probability_pct: precipBlock.probability_of_precipitation ?? null,
    precip_mm: precipBlock.precipitation_amount ?? null,
    rain_mm: precipBlock.precipitation_amount ?? null,  // MET Norway doesn't split rain/showers
    showers_mm: 0,
    snowfall_cm: 0,
    weather_code: symbolToWmo(symbol),
    visibility_m,
    fog_risk: fog_risk as any,
    uv_index: inst.ultraviolet_index_clear_sky ?? null,
    is_dark: extras?.isDark ?? false,
    sunrise: extras?.sunriseIso ?? null,
    sunset: extras?.sunsetIso ?? null,
  };

  const score = scoreConditions(shotType, row as WeatherRow);

  const provenance = {
    source: 'met.no /locationforecast/2.0/compact',
    source_lat: round4(lat), source_lng: round4(lng),
    requested_time_utc: targetIsoUtc,
    matched_time_utc: chosen?.time ?? null,
    match_method: matchMethod,
    exact_hour: exact,
    symbol_code: symbol,
    model_updated_at: json?.properties?.meta?.updated_at ?? null,
    pulled_at: new Date().toISOString(),
  };

  return { row: { ...row, score }, raw: { provenance, instant: inst, precip: precipBlock, symbol } };
}

// ---------------------------------------------------------------------------
// Cross-source comparison. Takes the existing Open-Meteo row and the MET Norway
// row, returns combined (averaged) score, the spread, an agreement rating, and
// WHICH field they most disagree on (richer than a bare rating).
// ---------------------------------------------------------------------------
export interface ComparisonResult {
  openMeteoStars: number | null;
  metnoStars: number | null;
  combinedStars: number | null;     // average, rounded
  spread: number | null;            // |difference| in stars
  agreement: 'TIGHT' | 'LOOSE' | 'SPLIT' | 'SINGLE';
  divergentField: string | null;    // the field they most disagree on, if SPLIT/LOOSE
  note: string;
}

export function compareForecasts(
  openMeteo: WeatherRow | null | undefined,
  metno: (Partial<WeatherRow> & { score?: ConditionScore | null }) | null | undefined,
  openMeteoScore?: ConditionScore | null
): ComparisonResult {
  const omStars = openMeteoScore?.stars ?? (openMeteo as any)?.score_stars ?? null;
  const mnStars = metno?.score?.stars ?? null;

  if (omStars == null || mnStars == null) {
    return {
      openMeteoStars: omStars, metnoStars: mnStars,
      combinedStars: omStars ?? mnStars ?? null,
      spread: null, agreement: 'SINGLE', divergentField: null,
      note: 'Only one source available.',
    };
  }

  const spread = Math.abs(omStars - mnStars);
  const combined = Math.round((omStars + mnStars) / 2);

  // Identify the biggest underlying disagreement for context.
  const fieldDiffs: [string, number, string][] = [];
  const pushDiff = (label: string, a: number | null | undefined, b: number | null | undefined, scale: number, unit: string) => {
    if (a == null || b == null) return;
    fieldDiffs.push([label, Math.abs(a - b) / scale, `${label}: ${Math.round(a)}${unit} vs ${Math.round(b)}${unit}`]);
  };
  pushDiff('cloud', openMeteo?.cloud_cover_pct, metno?.cloud_cover_pct, 100, '%');
  pushDiff('rain chance', openMeteo?.precip_probability_pct, metno?.precip_probability_pct, 100, '%');
  pushDiff('gusts', openMeteo?.wind_gusts_kmh, metno?.wind_gusts_kmh, 50, ' km/h');
  pushDiff('rain amt', (openMeteo?.rain_mm ?? 0) + (openMeteo?.showers_mm ?? 0), metno?.rain_mm, 5, 'mm');
  fieldDiffs.sort((a, b) => b[1] - a[1]);
  const topDiff = fieldDiffs[0];

  let agreement: ComparisonResult['agreement'];
  if (spread <= 0.5) agreement = 'TIGHT';
  else if (spread <= 1) agreement = 'LOOSE';
  else agreement = 'SPLIT';

  let note: string;
  if (agreement === 'TIGHT') note = 'Both models agree — trust this.';
  else if (agreement === 'LOOSE') note = topDiff ? `Slight disagreement (${topDiff[2]}).` : 'Slight disagreement.';
  else note = topDiff ? `Models disagree — ${topDiff[2]}. Treat as uncertain.` : 'Models disagree — treat as uncertain.';

  return {
    openMeteoStars: omStars, metnoStars: mnStars,
    combinedStars: combined, spread,
    agreement,
    divergentField: agreement === 'TIGHT' ? null : (topDiff?.[0] ?? null),
    note,
  };
}
