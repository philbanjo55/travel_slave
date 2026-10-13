// Pure decision logic for weather-pull, kept free of I/O so it can be unit
// tested (logic_test.ts). index.ts does the fetching and storing.
// deno-lint-ignore-file no-explicit-any

// Resolved per invocation from the weather_models table; these are only the
// fallback if that table is empty or unreachable.
export type Registry = {
  centres: Record<string, string[]>;
  models: string[];
  centreOf: Record<string, string>;
  resolutionOf: Record<string, number>;
  sortOf: Record<string, number>;
  // Region rule for blends (weather_models.native_model / outside_native).
  nativeOf: Record<string, string>;
  outsideOf: Record<string, string>;
  outsideResOf: Record<string, number>;
};

export function registryFrom(
  centres: Record<string, string[]>,
  res?: Record<string, number>,
  sort?: Record<string, number>,
  native?: { nativeOf: Record<string, string>; outsideOf: Record<string, string>; outsideResOf: Record<string, number> },
): Registry {
  const centreOf: Record<string, string> = {};
  for (const [c, ms] of Object.entries(centres)) for (const m of ms) centreOf[m] = c;
  return {
    centres, models: Object.values(centres).flat(), centreOf,
    resolutionOf: res ?? {}, sortOf: sort ?? {},
    nativeOf: native?.nativeOf ?? {}, outsideOf: native?.outsideOf ?? {}, outsideResOf: native?.outsideResOf ?? {},
  };
}

// REGION RULE, applied per stop.
// A "seamless" blend equals its sharp regional run inside that run's
// coverage and silently becomes a global model outside it (verified Oct
// 2026: icon_seamless == icon_global and dmi_seamless == ECMWF IFS 9 km at
// Teton stops). Coverage comes from model_grid_points, which is probed for
// every stop automatically, so no trip needs configuring. Outside coverage
// the blend is relabelled at its true resolution ('downgrade') or skipped
// because it would repeat a centre that already votes ('exclude').
// Unprobed coverage (a brand-new stop, for a few minutes) leaves the blend
// as it is.
export function stopRegistry(
  reg: Registry, grid: Record<string, { km: number|null; ok: boolean }>
): { reg: Registry; adjustments: any[] } {
  const adjustments: any[] = [];
  const resolutionOf = { ...reg.resolutionOf };
  const keep: string[] = [];
  for (const m of reg.models) {
    const native = reg.nativeOf[m];
    const cover = native ? grid[native] : undefined;
    if (native && cover && cover.ok === false) {
      if (reg.outsideOf[m] === 'exclude') {
        adjustments.push({ model: m, action: 'excluded', native_model: native });
        continue;
      }
      if (reg.outsideOf[m] === 'downgrade' && reg.outsideResOf[m] != null) {
        resolutionOf[m] = reg.outsideResOf[m];
        adjustments.push({ model: m, action: 'downgraded', native_model: native, resolution_km: resolutionOf[m] });
      }
    }
    keep.push(m);
  }
  const centres: Record<string, string[]> = {};
  for (const m of keep) (centres[reg.centreOf[m]] ??= []).push(m);
  return { reg: { ...reg, centres, models: keep, resolutionOf }, adjustments };
}

// MAIN MODEL BY MEASURED ACCURACY.
// model_skill holds, per ground-truth station and lead (forecast issued N
// days ahead), each model's error over the last 14 days against that
// station's METARs (refresh_model_skill_step, every 10 min, refreshed
// daily). When a trip uses primary_selection = 'skill', the main model is
// the best-scoring model at this stop's lead that has data this hour and
// carries cloud layers (scoring needs low/mid cloud). Too little evidence
// (under SKILL_MIN_HOURS) falls back to the resolution rule.
export const SKILL_MIN_HOURS = 120;

export type SkillRow = { skill_score: number; n_hours: number };

export function pickPrimary(
  ranked: string[], models: Record<string, any>, skillAtLead: Record<string, SkillRow> | null,
): { model: string | null; method: string; score: number | null; ranking: any[] | null } {
  const layered = (m: string) => models[m]?.cloud_cover_low_pct != null;
  if (skillAtLead) {
    const scored = ranked
      .filter(m => skillAtLead[m] && skillAtLead[m].n_hours >= SKILL_MIN_HOURS)
      .sort((a, b) => skillAtLead[a].skill_score - skillAtLead[b].skill_score);
    const pick = scored.find(layered);
    if (pick) {
      return {
        model: pick, method: 'skill', score: skillAtLead[pick].skill_score,
        ranking: scored.slice(0, 5).map(m => ({ model: m, skill_score: skillAtLead[m].skill_score, layered: layered(m) })),
      };
    }
  }
  const byRes = ranked.find(layered) ?? ranked[0] ?? null;
  return { model: byRes, method: skillAtLead ? 'resolution-fallback' : 'resolution', score: null, ranking: null };
}

// Ranking a model for a given stop. Resolution dominates and distance only
// breaks ties, deliberately: a 25 km model whose grid point happens to fall
// 1 km away is still reporting an average over 25 km. Being near is not the
// same as being local.
export function rankModels(
  reg: Registry, avail: string[], grid: Record<string, { km: number|null }>
): string[] {
  return [...avail].sort((a, b) => {
    const ra = reg.resolutionOf[a] ?? 999, rb = reg.resolutionOf[b] ?? 999;
    if (ra !== rb) return ra - rb;
    const da = grid[a]?.km ?? 9999, db = grid[b]?.km ?? 9999;
    if (da !== db) return da - db;
    // At 2 km, DMI HARMONIE and DMI seamless are the same run on the same
    // grid point, so resolution and distance both tie and something has to
    // decide. Without these two the winner was whatever order the registry
    // query happened to return, which made primary_model unstable.
    const sa = reg.sortOf[a] ?? 9999, sb = reg.sortOf[b] ?? 9999;
    if (sa !== sb) return sa - sb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// Variables compared across centres for the agreement calculation.
export const COMPARE_VARS = [
  'cloud_cover', 'cloud_cover_low', 'precipitation', 'precipitation_probability',
  'visibility', 'wind_gusts_10m', 'cloud_base',
];

export function wmoText(code: number): string {
  const m: Record<number, string> = {
    0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',
    51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',
    61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',
    71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
    80:'Light showers',81:'Showers',82:'Violent showers',85:'Snow showers',86:'Snow showers',
    95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ hail'
  };
  return m[code] ?? `Code ${code}`;
}

export function labelParses(label: string | null): boolean {
  return !!label && /(\d{1,2}):(\d{2})/.test(label);
}

export function parseHour(label: string | null, fallback = 12): number {
  if (!label) return fallback;
  const m = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return fallback;
  let h = parseInt(m[1], 10); const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (min >= 30) h += 1;
  return Math.max(0, Math.min(23, h));
}

// Date-aware minutes from a base date's midnight. A sunset that rolls past
// midnight (e.g. 2026-07-07T00:05 for a July 6 forecast at high latitude) must
// read as 1445, NOT 5 - otherwise every daytime stop tests as "after sunset".
export function minutesFromISOrelativeTo(iso: string, baseDate: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) return null;
  const b = baseDate.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!b) return null;
  const isoDay  = Date.UTC(+m[1], +m[2]-1, +m[3]);
  const baseDay = Date.UTC(+b[1], +b[2]-1, +b[3]);
  const dayOffset = Math.round((isoDay - baseDay) / 86400000);
  return dayOffset*1440 + parseInt(m[4],10)*60 + parseInt(m[5],10);
}

export function offsetStr(secs: number): string {
  const sign = secs < 0 ? '-' : '+'; const a = Math.abs(secs);
  return `${sign}${String(Math.floor(a/3600)).padStart(2,'0')}:${String(Math.floor((a%3600)/60)).padStart(2,'0')}`;
}

export function addDays(base: Date, n: number): string {
  return new Date(base.getTime() + n*86400000).toISOString().slice(0,10);
}

export const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a,b)=>a-b); const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}

export function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a,b)=>a+b,0)/xs.length;
  return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(xs.length-1));
}

export function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a,b)=>a-b);
  const i = Math.min(s.length-1, Math.max(0, Math.round((p/100)*(s.length-1))));
  return s[i];
}

export const r2 = (n: number | null) => n == null ? null : Math.round(n*100)/100;

export function fogRisk(
  visibility: number|null, humidity: number|null, temp: number|null, dew: number|null, code: number|null
): string {
  if (code === 45 || code === 48) return 'likely';
  if (visibility != null) {
    if (visibility < 1000) return 'likely';
    if (visibility < 4000) return 'possible';
    return 'none';
  }
  const spread = (temp != null && dew != null) ? (temp - dew) : null;
  if (spread != null && humidity != null && spread <= 1.0 && humidity >= 95) return 'possible';
  return 'none';
}

// SCORING lives in the database, not here.
// public.weather_score() is called by latest_weather_per_stop for display and
// by a BEFORE INSERT trigger to stamp score_stars/label/reason/components onto
// every row this function writes. Keeping a second copy here meant the rules
// were encoded twice and could drift the moment either changed; it also meant
// a rule change needed a redeploy of this program.
//
// This function fetches and stores. It does not decide whether conditions are
// good — that is photographic judgement, and it belongs in one editable place.

// MULTI-MODEL PULL
// One HTTP request returns all eighteen models, variables suffixed with the
// model name. Variables a model does not serve come back as nulls, not as
// an error, so the union of variables can be requested unconditionally.

export function readModelRow(H: any, idx: number, model: string, centreOf: Record<string,string>) {
  const at = (v: string) => {
    const arr = H[`${v}_${model}`] ?? H[v];
    return Array.isArray(arr) ? num(arr[idx]) : null;
  };
  const temp = at('temperature_2m');
  if (temp == null && at('cloud_cover') == null) return null; // model has nothing here
  const vis = at('visibility');
  const hum = at('relative_humidity_2m');
  const dew = at('dew_point_2m');
  const code = at('weather_code');
  return {
    temperature_c: temp,
    apparent_temperature_c: at('apparent_temperature'),
    relative_humidity_pct: hum,
    dew_point_c: dew,
    surface_pressure_hpa: at('surface_pressure'),
    cloud_cover_pct: at('cloud_cover'),
    cloud_cover_low_pct: at('cloud_cover_low'),
    cloud_cover_mid_pct: at('cloud_cover_mid'),
    cloud_cover_high_pct: at('cloud_cover_high'),
    cloud_base_m: at('cloud_base'),
    cloud_top_m: at('cloud_top'),
    cloud_cover_2m_pct: at('cloud_cover_2m'),
    precip_probability_pct: at('precipitation_probability'),
    precip_mm: at('precipitation'),
    rain_mm: at('rain'),
    showers_mm: at('showers'),
    snowfall_cm: at('snowfall'),
    weather_code: code,
    conditions: code != null ? wmoText(code) : null,
    visibility_m: vis,
    wind_speed_kmh: at('wind_speed_10m'),
    wind_gusts_kmh: at('wind_gusts_10m'),
    wind_direction_deg: at('wind_direction_10m'),
    is_day: at('is_day') === 1,
    uv_index: at('uv_index'),
    fog_risk: fogRisk(vis, hum, temp, dew, code),
    centre: centreOf[model] ?? null,
  };
}

// Spread across CENTRES, not across model strings. One representative per
// centre: the first listed for it that returned data (listed best-resolution
// first), so DMI's 2 km run speaks for HARMONIE rather than its own blend.
export function consensus(
  models: Record<string, any>, reg: Registry, grid: Record<string, { km: number|null }>
) {
  // One representative per centre: the finest-resolution member that returned
  // data, distance breaking ties. Previously this was a hardcoded order.
  const reps: Record<string, any> = {};
  const repModel: Record<string, string> = {};
  for (const [centre, list] of Object.entries(reg.centres)) {
    const avail = list.filter(m => models[m]);
    if (!avail.length) continue;
    const best = rankModels(reg, avail, grid)[0];
    reps[centre] = models[best];
    repModel[centre] = best;
  }
  const centreNames = Object.keys(reps);
  const fieldOf: Record<string,string> = {
    cloud_cover: 'cloud_cover_pct',
    cloud_cover_low: 'cloud_cover_low_pct',
    precipitation: 'precip_mm',
    precipitation_probability: 'precip_probability_pct',
    visibility: 'visibility_m',
    wind_gusts_10m: 'wind_gusts_kmh',
    cloud_base: 'cloud_base_m',
  };
  const byVar: Record<string, any> = {};
  for (const v of COMPARE_VARS) {
    const f = fieldOf[v];
    const vals: number[] = [];
    const per: Record<string, number> = {};
    for (const c of centreNames) {
      const x = num(reps[c]?.[f]);
      if (x != null) { vals.push(x); per[c] = x; }
    }
    if (!vals.length) continue;
    byVar[v] = {
      centres_reporting: vals.length,
      median: r2(median(vals)),
      min: r2(Math.min(...vals)),
      max: r2(Math.max(...vals)),
      stdev: r2(stdev(vals)),
      by_centre: per,
    };
  }
  return {
    centres: centreNames, centre_count: centreNames.length,
    representatives: repModel,
    by_variable: byVar,
  };
}

// How far ahead of `nowMs` the forecast hour is, in whole days, clamped to
// the 1-7 range model_skill is graded on. Unknown times count as lead 1.
export function leadDayFor(validAtMs: number, nowMs: number): number {
  if (!Number.isFinite(validAtMs)) return 1;
  return Math.min(7, Math.max(1, Math.round((validAtMs - nowMs) / 86400000)));
}
