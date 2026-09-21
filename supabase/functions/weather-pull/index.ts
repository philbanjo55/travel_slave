import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// MODEL REGISTRY
// Grouped by forecasting CENTRE, deliberately. Eighteen model strings are
// not eighteen independent opinions: DMI and KNMI run the same UWC-West
// HARMONIE DINI, and every "_seamless" string is a blend that already
// contains its own raw model (and ECMWF past ~day 3). Spread is computed
// across centres, one representative each, so six ECMWF derivatives
// cannot vote six times and report false confidence.
const FALLBACK_CENTRES: Record<string, string[]> = {
  'DMI/KNMI HARMONIE': ['dmi_harmonie_arome_europe', 'dmi_seamless', 'knmi_harmonie_arome_europe'],
  'MET Norway':        ['metno_seamless'],
  'UK Met Office':     ['ukmo_seamless', 'ukmo_global_deterministic_10km'],
  'DWD ICON':          ['icon_eu', 'icon_seamless', 'icon_global'],
  'ECMWF':             ['ecmwf_ifs025'],
  'ECMWF AIFS':        ['ecmwf_aifs025_single'],
  'NOAA GFS':          ['gfs_seamless'],
  'Env. Canada':       ['gem_seamless', 'gem_global'],
  'Meteo-France':      ['meteofrance_seamless', 'meteofrance_arpege_europe'],
  'JMA':               ['jma_seamless'],
  'CMA':               ['cma_grapes_global'],
};
// Resolved per invocation from the weather_models table; these are only the
// fallback if that table is empty or unreachable.
type Registry = {
  centres: Record<string, string[]>;
  models: string[];
  centreOf: Record<string, string>;
  resolutionOf: Record<string, number>;
};
function registryFrom(centres: Record<string, string[]>, res?: Record<string, number>): Registry {
  const centreOf: Record<string, string> = {};
  for (const [c, ms] of Object.entries(centres)) for (const m of ms) centreOf[m] = c;
  return { centres, models: Object.values(centres).flat(), centreOf, resolutionOf: res ?? {} };
}
const FALLBACK_REGISTRY = registryFrom(FALLBACK_CENTRES);

// Which model fills the real columns, best first. DMI HARMONIE is 2 km and
// the only one here carrying cloud base/top and a native 2 m fog field,
// but it only reaches ~70 h - past that it returns nulls and we fall
// through to the next that actually has data for the target hour.
const FALLBACK_PRIMARY_ORDER = [
  'dmi_harmonie_arome_europe', 'dmi_seamless', 'knmi_harmonie_arome_europe',
  'icon_eu', 'ecmwf_ifs025', 'ukmo_seamless', 'gfs_seamless', 'icon_global',
];

// Ranking a model for a given stop. Resolution dominates and distance only
// breaks ties, deliberately: a 25 km model whose grid point happens to fall
// 1 km away is still reporting an average over 25 km. Being near is not the
// same as being local.
function rankModels(
  reg: Registry, avail: string[], grid: Record<string, { km: number|null }>
): string[] {
  return [...avail].sort((a, b) => {
    const ra = reg.resolutionOf[a] ?? 999, rb = reg.resolutionOf[b] ?? 999;
    if (ra !== rb) return ra - rb;
    const da = grid[a]?.km ?? 9999, db = grid[b]?.km ?? 9999;
    return da - db;
  });
}

// Run-to-run convergence must be measured on a LONG-horizon model. DMI keeps
// only ~70 h, so its previous_day2/day3 runs no longer cover the target and
// drift always reads 0. ECMWF's 15-day horizon means all three prior runs
// still cover it.
const CONVERGENCE_MODEL = 'ecmwf_ifs025';

const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m',
  'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'cloud_base', 'cloud_top', 'cloud_cover_2m',
  'precipitation_probability', 'precipitation', 'rain', 'showers', 'snowfall',
  'weather_code', 'visibility', 'surface_pressure',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'is_day', 'uv_index',
];
const DAILY_VARS = ['sunrise', 'sunset', 'daylight_duration', 'precipitation_hours', 'precipitation_sum', 'uv_index_max'];

// Variables compared across centres for the agreement calculation.
const COMPARE_VARS = [
  'cloud_cover', 'cloud_cover_low', 'precipitation', 'precipitation_probability',
  'visibility', 'wind_gusts_10m', 'cloud_base',
];

// Ensemble systems that return data at Faroes latitudes. bom_access_global_ensemble
// is deliberately absent: tested, returns nulls at 62N.
// NOTE: none of these serve visibility, so rain and wind uncertainty are
// measurable and fog uncertainty is not.
const ENSEMBLE_MODELS = [
  'ecmwf_ifs025', 'icon_eu', 'icon_global', 'gfs025', 'gfs05',
  'gem_global', 'ukmo_global_ensemble_20km',
];
// Chosen to have no shared prefixes - `cloud_cover` must not collide with
// `cloud_cover_low` when member keys are parsed back out.
const ENSEMBLE_VARS = ['precipitation', 'cloud_cover', 'wind_gusts_10m', 'temperature_2m'];

const MARINE_VARS = [
  'wave_height', 'wave_period', 'wave_direction',
  'swell_wave_height', 'swell_wave_period', 'wind_wave_height', 'sea_surface_temperature',
];

const METAR_STATION = 'EKVG';
const ENSEMBLE_GRID = 0.25; // ECMWF ensemble cell size; stops are deduped onto it

function wmoText(code: number): string {
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

function labelParses(label: string | null): boolean {
  return !!label && /(\d{1,2}):(\d{2})/.test(label);
}

function parseHour(label: string | null, fallback = 12): number {
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
function minutesFromISOrelativeTo(iso: string, baseDate: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) return null;
  const b = baseDate.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!b) return null;
  const isoDay  = Date.UTC(+m[1], +m[2]-1, +m[3]);
  const baseDay = Date.UTC(+b[1], +b[2]-1, +b[3]);
  const dayOffset = Math.round((isoDay - baseDay) / 86400000);
  return dayOffset*1440 + parseInt(m[4],10)*60 + parseInt(m[5],10);
}

function offsetStr(secs: number): string {
  const sign = secs < 0 ? '-' : '+'; const a = Math.abs(secs);
  return `${sign}${String(Math.floor(a/3600)).padStart(2,'0')}:${String(Math.floor((a%3600)/60)).padStart(2,'0')}`;
}

function addDays(base: Date, n: number): string {
  return new Date(base.getTime() + n*86400000).toISOString().slice(0,10);
}

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a,b)=>a-b); const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}
function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a,b)=>a+b,0)/xs.length;
  return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(xs.length-1));
}
function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a,b)=>a-b);
  const i = Math.min(s.length-1, Math.max(0, Math.round((p/100)*(s.length-1))));
  return s[i];
}
const r2 = (n: number | null) => n == null ? null : Math.round(n*100)/100;

async function getJson(url: string, headers?: Record<string,string>): Promise<{ j: any; err: string | null }> {
  try {
    const r = await fetch(url, headers ? { headers } : undefined);
    if (!r.ok) return { j: null, err: `${r.status}` };
    return { j: await r.json(), err: null };
  } catch (e) { return { j: null, err: String(e) }; }
}

function fogRisk(
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

// SCORING
// UNCHANGED from v25 on purpose. The source list changed in this version;
// the scoring maths is a separate decision and is deliberately not touched
// here, so any change in stars is attributable to the primary model
// switching from Open-Meteo's unnamed `best_match` to a named 2 km model.
// NOTE: the phone app carries its own copy of this function in
// src/services/weather.ts. The two must be changed together.
const LABELS = ['Poor','Poor','Fair','Good','Excellent'];
const clampStars = (n:number) => Math.max(0, Math.min(4, n));

function scoreConditions(shotType: string | null, r: any) {
  if (!shotType || shotType === 'logistics') return null;
  if (r.is_dark) return { stars: 0, label: 'Poor', reason: 'After dark', components: { rain:0, visibility:0, wind:0, dark:true } };
  const gust = r.wind_gusts_kmh ?? r.wind_speed_kmh ?? 0;
  const pop = r.precip_probability_pct ?? 0;
  const rainAmt = (r.rain_mm ?? 0) + (r.showers_mm ?? 0);
  const snow = r.snowfall_cm ?? 0;
  const code = r.weather_code;
  const vis = r.visibility_m;
  const fog = r.fog_risk;
  const longDistance = shotType === 'mountain' || shotType === 'seascape';
  const closeSubject = shotType === 'waterfall' || shotType === 'canyon' || shotType === 'urban';

  const heavyCode = (rainAmt > 1.0 || pop >= 55);
  const lightCode = (rainAmt > 0.1 || pop >= 35);
  let rainPen = 0;
  if (rainAmt > 4 || ((code === 65 || code === 82 || code === 75 || (code != null && code >= 95)) && heavyCode)) rainPen = 4;
  else if (rainAmt > 2 || ((code === 63 || code === 81 || code === 73) && heavyCode)) rainPen = 3;
  else if (rainAmt > 0.7 || (code === 61 && lightCode)) rainPen = 2;
  else if (rainAmt > 0.1 || (((code != null && code >= 51 && code <= 57) || code === 80 || code === 71) && lightCode) || snow > 0) rainPen = 1;
  if (rainPen <= 1 && pop >= 60) rainPen += 1;
  else if (rainPen === 0 && pop >= 40) rainPen += 0.5;
  if (shotType === 'seascape' && rainPen > 0 && rainAmt <= 0.7) rainPen = Math.max(0, rainPen - 0.5);

  const dayTotal = r.precip_total_mm;
  const hourWet = (pop >= 30) || (rainAmt > 0.1);
  if (dayTotal != null && hourWet) {
    let persistFloor = 0;
    if (dayTotal >= 10) persistFloor = 3;
    else if (dayTotal >= 5) persistFloor = 2;
    else if (dayTotal >= 2.5) persistFloor = 1;
    if (shotType === 'seascape') persistFloor = Math.max(0, persistFloor - 0.5);
    rainPen = Math.max(rainPen, persistFloor);
  }

  let visBase = 0;
  if (fog === 'likely' || (vis != null && vis < 1000)) visBase = 2;
  else if (fog === 'possible' || (vis != null && vis < 4000)) visBase = 1;
  else if (vis != null && vis < 8000) visBase = 0.5;
  let obscure = 0;
  if (shotType === 'mountain') {
    const lowCloud = r.cloud_cover_low_pct ?? r.cloud_cover_pct ?? 0;
    if (lowCloud >= 90) obscure = 2;
    else if (lowCloud >= 70) obscure = 1;
  }
  const visPen = (longDistance ? visBase * 1.5 : closeSubject ? Math.min(visBase, 1) : visBase) + obscure;

  let windPen = 0;
  if (shotType === 'reflection') windPen = gust < 10 ? 0 : gust < 16 ? 1 : gust < 26 ? 2.5 : 4;
  else if (shotType === 'seascape') windPen = gust > 70 ? 3 : gust > 50 ? 2 : gust > 36 ? 1 : gust > 26 ? 0.5 : 0;
  else if (shotType === 'waterfall' || shotType === 'canyon') windPen = gust > 60 ? 3 : gust > 45 ? 2 : gust > 30 ? 1 : gust > 20 ? 0.5 : 0;
  else windPen = gust > 80 ? 2 : gust > 60 ? 1 : gust > 45 ? 0.5 : 0;

  const stars = clampStars(Math.round(4 - rainPen - visPen - windPen));
  const factors: [number, string][] = [
    [rainPen, rainPen >= 3 ? 'Heavy rain' : rainPen >= 2 ? 'Rain likely' : 'Some rain risk'],
    [visPen, fog === 'likely' ? 'Fog — poor visibility' : (shotType === 'mountain' && obscure > 0) ? 'Summit likely in cloud' : 'Haze / low visibility'],
    [windPen, shotType === 'reflection' ? 'Wind breaking the reflection' : shotType === 'seascape' ? 'Big swell — hard to hold steady' : 'Windy — motion in long exposures'],
  ];
  const top = factors.reduce((m,f)=> f[0] > m[0] ? f : m, [0,''] as [number,string]);
  const reason = (top[0] >= 1 || (top[0] >= 0.5 && stars < 4))
    ? top[1]
    : (stars >= 4 ? 'Dry, calm, clear — go' : 'Workable — dry and open');
  return { stars, label: LABELS[stars], reason, components: { rain: rainPen, visibility: visPen, wind: windPen, dark: false } };
}

// MULTI-MODEL PULL
// One HTTP request returns all eighteen models, variables suffixed with the
// model name. Variables a model does not serve come back as nulls, not as
// an error, so the union of variables can be requested unconditionally.

function readModelRow(H: any, idx: number, model: string, centreOf: Record<string,string>) {
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
function consensus(
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

// ENSEMBLE
// Deduped onto the 0.25 degree ECMWF grid: 72 stops fall into ~10 cells,
// so this is ~10 calls per pass rather than 72.
const cellKey = (lat: number, lng: number) =>
  `${Math.round(lat/ENSEMBLE_GRID)*ENSEMBLE_GRID},${Math.round(lng/ENSEMBLE_GRID)*ENSEMBLE_GRID}`;

function memberSeries(H: any, v: string): number[][] {
  // Keys are `<var>` (control) and `<var>_member01_<model>`. ENSEMBLE_VARS are
  // chosen so no requested variable is a prefix of another.
  const out: number[][] = [];
  for (const k of Object.keys(H)) {
    if (k !== v && !k.startsWith(`${v}_`)) continue;
    if (Array.isArray(H[k])) out.push(H[k]);
  }
  return out;
}

function ensembleStats(H: any, idx: number) {
  const stats: Record<string, any> = {};
  let memberCount = 0;
  for (const v of ENSEMBLE_VARS) {
    const series = memberSeries(H, v);
    const vals = series.map(s => num(s?.[idx])).filter((x): x is number => x != null);
    if (!vals.length) continue;
    memberCount = Math.max(memberCount, vals.length);
    const s: Record<string, any> = {
      members: vals.length,
      median: r2(median(vals)), p10: r2(pct(vals,10)), p90: r2(pct(vals,90)),
      min: r2(Math.min(...vals)), max: r2(Math.max(...vals)), stdev: r2(stdev(vals)),
    };
    const frac = (f: (x:number)=>boolean) => Math.round(100 * vals.filter(f).length / vals.length);
    if (v === 'precipitation')   s.prob_any_rain_pct   = frac(x => x > 0.1);
    if (v === 'precipitation')   s.prob_wet_pct        = frac(x => x > 0.5);
    if (v === 'wind_gusts_10m')  s.prob_gust_over_40_pct = frac(x => x > 40);
    if (v === 'wind_gusts_10m')  s.prob_gust_over_60_pct = frac(x => x > 60);
    if (v === 'cloud_cover')     s.prob_broken_sky_pct = frac(x => x < 70);
    stats[v] = s;
  }
  return { member_count: memberCount, by_variable: stats };
}

// EKVG GROUND TRUTH
function parseMetar(o: any) {
  const clouds: any[] = Array.isArray(o?.clouds) ? o.clouds : [];
  const ceilLayer = clouds.find(c => c?.cover === 'OVC' || c?.cover === 'BKN') ?? clouds[0] ?? null;
  const visSm = num(o?.visib);
  return {
    station: o?.icaoId ?? METAR_STATION,
    observed_at: o?.reportTime ? new Date(o.reportTime).toISOString() : null,
    lat: num(o?.lat), lng: num(o?.lon),
    temperature_c: num(o?.temp),
    dew_point_c: num(o?.dewp),
    wind_dir_deg: num(o?.wdir),
    wind_speed_kt: num(o?.wspd),
    wind_gust_kt: num(o?.wgst),
    visibility_m: visSm != null ? Math.round(visSm * 1609.34) : null,
    ceiling_ft: num(ceilLayer?.base),
    cover: o?.cover ?? ceilLayer?.cover ?? null,
    flight_category: o?.fltCat ?? null,
    wx_string: o?.wxString ?? null,
    raw_metar: o?.rawOb ?? null,
    raw_taf: o?.rawTaf ?? null,
    raw: o ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const dayId: string | undefined = body.day_id;
    const test: boolean = body.test === true;
    const testOffset: number = Number.isFinite(body.test_offset_days) ? body.test_offset_days : 0;
    if (!dayId) return new Response(JSON.stringify({ ok:false, error:'day_id is required' }),
      { status:400, headers:{ ...corsHeaders, 'Content-Type':'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: day, error: dayErr } = await supabase
      .from('days').select('id,date,trip_id,title').eq('id', dayId).single();
    if (dayErr || !day) return new Response(JSON.stringify({ ok:false, error:'day not found', detail:dayErr?.message }),
      { status:404, headers:{ ...corsHeaders, 'Content-Type':'application/json' } });

    const { data: stops, error: stopsErr } = await supabase
      .from('stops').select('id,name,time_label,lat,lng,shot_type,position')
      .eq('day_id', dayId).not('lat','is',null).order('position');
    if (stopsErr) throw stopsErr;
    if (!stops || !stops.length) return new Response(JSON.stringify({ ok:true, day_id:dayId, stops:[], day_summary:'No mappable stops.' }),
      { headers:{ ...corsHeaders, 'Content-Type':'application/json' } });

    const now = new Date();
    const usedDate = (test || !day.date) ? addDays(now, testOffset) : day.date as string;
    const dateShifted = (test || !day.date);

    // The model list lives in the database, not in this file, so a trip in a
    // new region needs a row rather than a redeploy. Falls back to the
    // built-in list only if the table is empty or unreachable.
    let reg = FALLBACK_REGISTRY;
    let registrySource = 'fallback-constant';
    {
      const { data: rows } = await supabase
        .from('weather_models')
        .select('model,centre,resolution_km')
        .eq('active', true);
      if (rows && rows.length) {
        const centres: Record<string, string[]> = {};
        const res: Record<string, number> = {};
        for (const r of rows as any[]) {
          (centres[r.centre] ??= []).push(r.model);
          if (r.resolution_km != null) res[r.model] = Number(r.resolution_km);
        }
        reg = registryFrom(centres, res);
        registrySource = 'weather_models';
      }
    }

    // Where each model actually samples each stop, measured once and cached.
    // Two uses: skip models proven not to cover a stop (saves the call and
    // the nulls), and record how far off every reported number really is.
    const gridByStop = new Map<string, Record<string, { km: number|null; ok: boolean }>>();
    {
      const stopIds = stops.map((s: any) => s.id);
      const { data: gp } = await supabase
        .from('model_grid_points')
        .select('model,stop_id,distance_km,has_data')
        .in('stop_id', stopIds);
      for (const g of (gp ?? []) as any[]) {
        const m = gridByStop.get(g.stop_id) ?? {};
        m[g.model] = { km: g.distance_km, ok: g.has_data };
        gridByStop.set(g.stop_id, m);
      }
    }

    // Ground truth, once per invocation rather than once per stop.
    let metar: any = null, metarErr: string | null = null;
    {
      const { j, err } = await getJson(
        `https://aviationweather.gov/api/data/metar?ids=${METAR_STATION}&format=json&taf=true`);
      if (err) metarErr = err;
      else if (Array.isArray(j) && j.length) {
        metar = parseMetar(j[0]);
        if (metar.observed_at) {
          await supabase.from('weather_observations')
            .upsert(metar, { onConflict: 'station,observed_at' });
        }
      }
    }

    // Ensemble, once per 0.25 degree cell rather than once per stop.
    const ensembleByCell = new Map<string, any>();
    for (const s of stops) {
      const key = cellKey(s.lat as number, s.lng as number);
      if (ensembleByCell.has(key)) continue;
      const [clat, clng] = key.split(',').map(Number);
      const { j, err } = await getJson(
        `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${clat}&longitude=${clng}`
        + `&hourly=${ENSEMBLE_VARS.join(',')}&models=${ENSEMBLE_MODELS.join(',')}`
        + `&start_date=${usedDate}&end_date=${usedDate}&timezone=auto&wind_speed_unit=kmh`);
      ensembleByCell.set(key, err ? { error: err } : j);
    }

    const rows: any[] = []; const results: any[] = [];

    for (const s of stops) {
      const hour = parseHour(s.time_label);
      const hh = String(hour).padStart(2,'0');
      const base = `latitude=${s.lat}&longitude=${s.lng}&timezone=auto&wind_speed_unit=kmh`
        + `&start_date=${usedDate}&end_date=${usedDate}`;

      // Skip models measured as not covering this stop. Unprobed models are
      // requested anyway - absence of a measurement is not evidence.
      const grid = gridByStop.get(s.id) ?? {};
      const askModels = reg.models.filter(m => grid[m] === undefined || grid[m].ok);

      const [multi, marine] = await Promise.all([
        getJson(`https://api.open-meteo.com/v1/forecast?${base}`
          + `&hourly=${HOURLY_VARS.join(',')}&daily=${DAILY_VARS.join(',')}&models=${askModels.join(',')}`),
        getJson(`https://marine-api.open-meteo.com/v1/marine?${base}&hourly=${MARINE_VARS.join(',')}`),
      ]);

      if (multi.err || !multi.j?.hourly?.time) {
        results.push({ stop_id:s.id, name:s.name, error: multi.err ?? 'no hourly' });
        continue;
      }

      const w = multi.j, H = w.hourly;
      let idx = H.time.indexOf(`${usedDate}T${hh}:00`);
      let matchMethod = 'exact';
      if (idx === -1) { idx = H.time.findIndex((t:string)=>t.startsWith(`${usedDate}T${hh}`)); matchMethod = 'hour-prefix'; }
      if (idx === -1) { idx = Math.min(hour, H.time.length-1); matchMethod = 'positional-fallback'; }
      if (!labelParses(s.time_label)) matchMethod = 'label-fallback';
      const matchedTime = H.time[idx] ?? null;
      const off = w.utc_offset_seconds ?? 0;

      // Every model that has something to say at this hour.
      const models: Record<string, any> = {};
      for (const m of askModels) {
        const row = readModelRow(H, idx, m, reg.centreOf);
        if (row) {
          row.distance_km = grid[m]?.km ?? null;      // how far this number really is
          row.resolution_km = reg.resolutionOf[m] ?? null;
          models[m] = row;
        }
      }
      // Primary is now chosen per stop by resolution then distance, rather
      // than from a fixed global order.
      const ranked = rankModels(reg, Object.keys(models), grid);
      const primaryModel = ranked[0]
        ?? FALLBACK_PRIMARY_ORDER.find(m => models[m])
        ?? Object.keys(models)[0] ?? null;
      if (!primaryModel) {
        results.push({ stop_id:s.id, name:s.name, error:'no model returned data for this hour' });
        continue;
      }
      const P = models[primaryModel];

      // Daily fields are astronomical, identical across models; take whichever
      // suffix is present.
      const D = w.daily ?? {};
      const daily = (v: string) => {
        if (Array.isArray(D[v])) return D[v][0] ?? null;
        for (const m of [primaryModel, ...askModels]) {
          const a = D[`${v}_${m}`];
          if (Array.isArray(a) && a[0] != null) return a[0];
        }
        return null;
      };
      const sunrise = daily('sunrise'), sunset = daily('sunset');
      const stopMin = hour*60;
      const srMin = sunrise ? minutesFromISOrelativeTo(sunrise, usedDate) : null;
      const ssMin = sunset  ? minutesFromISOrelativeTo(sunset,  usedDate) : null;
      const isGolden = (srMin!=null && stopMin>=srMin && stopMin<=srMin+90) || (ssMin!=null && stopMin>=ssMin-90 && stopMin<=ssMin);
      const isDark = (srMin!=null && stopMin<srMin-30) || (ssMin!=null && stopMin>ssMin+30);
      const dl = daily('daylight_duration');

      // Sea state.
      let sea: any = null;
      if (!marine.err && marine.j?.hourly?.time) {
        const MH = marine.j.hourly;
        let midx = MH.time.indexOf(`${usedDate}T${hh}:00`);
        if (midx === -1) midx = MH.time.findIndex((t:string)=>t.startsWith(`${usedDate}T${hh}`));
        if (midx !== -1) {
          const m = (v:string) => Array.isArray(MH[v]) ? num(MH[v][midx]) : null;
          sea = {
            wave_height_m: m('wave_height'), wave_period_s: m('wave_period'),
            wave_direction_deg: m('wave_direction'),
            swell_wave_height_m: m('swell_wave_height'), swell_wave_period_s: m('swell_wave_period'),
            wind_wave_height_m: m('wind_wave_height'), sea_surface_temp_c: m('sea_surface_temperature'),
          };
        }
      }

      // Ensemble for this stop's grid cell.
      const ecell = ensembleByCell.get(cellKey(s.lat as number, s.lng as number));
      let ensemble: any = null;
      if (ecell && !ecell.error && ecell.hourly?.time) {
        let eidx = ecell.hourly.time.indexOf(`${usedDate}T${hh}:00`);
        if (eidx === -1) eidx = ecell.hourly.time.findIndex((t:string)=>t.startsWith(`${usedDate}T${hh}`));
        if (eidx !== -1) ensemble = { ...ensembleStats(ecell.hourly, eidx), grid_cell: cellKey(s.lat as number, s.lng as number) };
      } else if (ecell?.error) ensemble = { error: ecell.error };

      // Run-to-run convergence. Measured on CONVERGENCE_MODEL, not the primary:
      // see the note on that constant.
      let convergence: any = null;
      {
        const cvars = ['cloud_cover','precipitation','wind_gusts_10m'];
        const want = cvars.flatMap(v => [v, `${v}_previous_day1`, `${v}_previous_day2`, `${v}_previous_day3`]);
        const { j, err } = await getJson(
          `https://previous-runs-api.open-meteo.com/v1/forecast?${base}`
          + `&hourly=${want.join(',')}&models=${CONVERGENCE_MODEL}`);
        if (err) convergence = { error: err };
        else if (j?.hourly?.time) {
          let cidx = j.hourly.time.indexOf(`${usedDate}T${hh}:00`);
          if (cidx === -1) cidx = j.hourly.time.findIndex((t:string)=>t.startsWith(`${usedDate}T${hh}`));
          if (cidx !== -1) {
            const CH = j.hourly; const outv: Record<string, any> = {};
            for (const v of cvars) {
              const runs = [v, `${v}_previous_day1`, `${v}_previous_day2`, `${v}_previous_day3`]
                .map(k => {
                  const a = CH[k] ?? CH[`${k}_${CONVERGENCE_MODEL}`];
                  return Array.isArray(a) ? num(a[cidx]) : null;
                })
                .filter((x): x is number => x != null);
              if (runs.length > 1) {
                outv[v] = { runs, drift: r2(Math.max(...runs) - Math.min(...runs)), stdev: r2(stdev(runs)) };
              }
            }
            convergence = { model: CONVERGENCE_MODEL, by_variable: outv };
          }
        }
      }

      const cons = consensus(models, reg, grid);

      const ex: any = {
        // Primary model, flattened - the shape v25 produced, so anything
        // already reading `raw` keeps working.
        temperature_c: P.temperature_c, apparent_temperature_c: P.apparent_temperature_c,
        relative_humidity_pct: P.relative_humidity_pct, dew_point_c: P.dew_point_c,
        cloud_cover_pct: P.cloud_cover_pct, cloud_cover_low_pct: P.cloud_cover_low_pct,
        cloud_cover_mid_pct: P.cloud_cover_mid_pct, cloud_cover_high_pct: P.cloud_cover_high_pct,
        cloud_base_m: P.cloud_base_m, cloud_top_m: P.cloud_top_m, cloud_cover_2m_pct: P.cloud_cover_2m_pct,
        precip_probability_pct: P.precip_probability_pct, precip_mm: P.precip_mm,
        rain_mm: P.rain_mm, showers_mm: P.showers_mm, snowfall_cm: P.snowfall_cm,
        weather_code: P.weather_code, conditions: P.conditions,
        visibility_m: P.visibility_m, surface_pressure_hpa: P.surface_pressure_hpa,
        wind_speed_kmh: P.wind_speed_kmh, wind_gusts_kmh: P.wind_gusts_kmh,
        wind_direction_deg: P.wind_direction_deg,
        is_day: P.is_day, uv_index: P.uv_index,
        sunrise, sunset, is_golden_hour: !!isGolden, is_dark: !!isDark, fog_risk: P.fog_risk,
        daylight_minutes: dl != null ? Math.round(dl/60) : null,
        precip_hours: daily('precipitation_hours'),
        precip_total_mm: daily('precipitation_sum'),
        uv_index_max: daily('uv_index_max'),
        local_hour: hour,
        forecast_valid_for: matchedTime ? `${matchedTime}:00${offsetStr(off)}` : `${usedDate}T${hh}:00:00${offsetStr(off)}`,
        primary_model: primaryModel,
        model_count: Object.keys(models).length,
        models,
        // Back-compat: the phone app reads raw.{metno,ukmo,met_eireann} by
        // name. Fed from the new model map so it keeps working unchanged.
        // Remove once the app loops raw.models generically.
        metno: models['metno_seamless']
          ? { ...models['metno_seamless'], score: scoreConditions(s.shot_type, models['metno_seamless']) }
          : { error: 'no data at this hour' },
        ukmo: models['ukmo_seamless']
          ? { ...models['ukmo_seamless'], score: scoreConditions(s.shot_type, models['ukmo_seamless']) }
          : { error: 'no data at this hour' },
        met_eireann: { error: 'HARMONIE-Ireland domain does not reach 62N' },
        consensus: cons,
        ensemble,
        convergence,
        sea,
        metar: metar ? { observed_at: metar.observed_at, raw_metar: metar.raw_metar, raw_taf: metar.raw_taf,
                         ceiling_ft: metar.ceiling_ft, visibility_m: metar.visibility_m,
                         flight_category: metar.flight_category, station: metar.station } : (metarErr ? { error: metarErr } : null),
        provenance: {
          source_lat: s.lat, source_lng: s.lng,
          timezone: w.timezone ?? null, utc_offset_seconds: off,
          forecast_date: usedDate,
          requested_time_label: s.time_label ?? null,
          requested_hour: hour,
          matched_time_local: matchedTime,
          match_method: matchMethod,
          date_mode: dateShifted ? 'preview' : 'trip-date',
          source: `open-meteo /v1/forecast?models=${primaryModel}`,
          primary_model: primaryModel,
          registry_source: registrySource,
          models_in_registry: reg.models.length,
          models_requested: askModels.length,
          models_returned: Object.keys(models).length,
          models_skipped_no_coverage: reg.models.length - askModels.length,
          centres_returned: cons.centre_count,
          primary_distance_km: grid[primaryModel]?.km ?? null,
          primary_resolution_km: reg.resolutionOf[primaryModel] ?? null,
          pulled_at: new Date().toISOString(),
          version: 'v29-registry',
        },
      };

      const sc = scoreConditions(s.shot_type, ex);
      ex.score = sc;

      const cc = cons.by_variable['cloud_cover'];
      const gg = cons.by_variable['wind_gusts_10m'];
      const pp = cons.by_variable['precipitation_probability'];
      const worst = [
        pp ? ['rain chance', (pp.max - pp.min) / 100, `rain chance: ${Math.round(pp.min)}-${Math.round(pp.max)}%`] : null,
        gg ? ['gusts', (gg.max - gg.min) / 50, `gusts: ${Math.round(gg.min)}-${Math.round(gg.max)} km/h`] : null,
        cc ? ['cloud', (cc.max - cc.min) / 100, `cloud: ${Math.round(cc.min)}-${Math.round(cc.max)}%`] : null,
      ].filter(Boolean).sort((a:any,b:any)=> b[1]-a[1])[0] as any;
      const normSpread = worst ? worst[1] : null;
      const agreement = normSpread == null ? 'SINGLE' : normSpread <= 0.15 ? 'TIGHT' : normSpread <= 0.4 ? 'LOOSE' : 'SPLIT';
      ex.comparison = {
        agreement,
        centre_count: cons.centre_count,
        divergent_field: agreement === 'TIGHT' ? null : (worst ? worst[0] : null),
        spread: r2(normSpread),
        note: agreement === 'TIGHT' ? `All ${cons.centre_count} centres agree - trust this.`
            : agreement === 'LOOSE' ? `Slight disagreement across ${cons.centre_count} centres (${worst?.[2]}).`
            : `Centres disagree - ${worst?.[2]}. Treat as uncertain.`,
      };

      const hasCore = P.temperature_c != null && P.cloud_cover_pct != null;
      if (hasCore) {
        rows.push({
          stop_id:s.id, day_id:dayId, trip_id:day.trip_id,
          forecast_valid_for:ex.forecast_valid_for, fetched_at: new Date().toISOString(),
          source: primaryModel, primary_model: primaryModel, model_count: ex.model_count,
          temperature_c:P.temperature_c, apparent_temperature_c:P.apparent_temperature_c,
          relative_humidity_pct:P.relative_humidity_pct, dew_point_c:P.dew_point_c,
          cloud_cover_pct:P.cloud_cover_pct, cloud_cover_low_pct:P.cloud_cover_low_pct,
          cloud_cover_mid_pct:P.cloud_cover_mid_pct, cloud_cover_high_pct:P.cloud_cover_high_pct,
          cloud_base_m:P.cloud_base_m, cloud_top_m:P.cloud_top_m, cloud_cover_2m_pct:P.cloud_cover_2m_pct,
          precip_probability_pct:P.precip_probability_pct, precip_mm:P.precip_mm,
          rain_mm:P.rain_mm, showers_mm:P.showers_mm, snowfall_cm:P.snowfall_cm,
          weather_code:P.weather_code, visibility_m:P.visibility_m, surface_pressure_hpa:P.surface_pressure_hpa,
          wind_speed_kmh:P.wind_speed_kmh, wind_gusts_kmh:P.wind_gusts_kmh, wind_direction_deg:P.wind_direction_deg,
          is_day:P.is_day, uv_index:P.uv_index,
          daylight_minutes:ex.daylight_minutes, precip_hours:ex.precip_hours,
          sunrise: sunrise?`${sunrise}:00${offsetStr(off)}`:null, sunset: sunset?`${sunset}:00${offsetStr(off)}`:null,
          is_golden_hour:!!isGolden, is_dark:!!isDark, fog_risk:P.fog_risk,
          wave_height_m: sea?.wave_height_m ?? null, wave_period_s: sea?.wave_period_s ?? null,
          wave_direction_deg: sea?.wave_direction_deg ?? null,
          swell_wave_height_m: sea?.swell_wave_height_m ?? null,
          swell_wave_period_s: sea?.swell_wave_period_s ?? null,
          wind_wave_height_m: sea?.wind_wave_height_m ?? null,
          sea_surface_temp_c: sea?.sea_surface_temp_c ?? null,
          score_stars: sc?.stars ?? null, score_label: sc?.label ?? null,
          score_reason: sc?.reason ?? null, score_components: sc?.components ?? null,
          raw:ex,
        });
      } else {
        ex.error = 'no model data yet (horizon edge) - existing row preserved';
      }

      results.push({ stop_id:s.id, name:s.name, shot_type:s.shot_type, time_label:s.time_label, ...ex });
    }

    // Preview rows must never land on top of a real trip-date forecast.
    // Reads the VIEW, not the table: the table now holds every pull ever
    // made for these stops.
    let writeRows = rows;
    if (dateShifted && rows.length) {
      const ids = rows.map(r => r.stop_id);
      const { data: existing } = await supabase
        .from('latest_weather_per_stop').select('stop_id, raw, temperature_c').in('stop_id', ids);
      const protectedIds = new Set(
        (existing ?? [])
          .filter((e:any) => e?.raw?.provenance?.date_mode === 'trip-date' && e?.temperature_c != null)
          .map((e:any) => e.stop_id)
      );
      writeRows = rows.filter(r => !protectedIds.has(r.stop_id));
    }
    // INSERT, not upsert. The unique index on stop_id is gone; every pull is
    // now kept so convergence and model skill can be measured over time.
    if (writeRows.length) {
      const { error } = await supabase.from('weather_forecasts').insert(writeRows);
      if (error) throw error;
    }

    const ok = results.filter(r => r.cloud_cover_pct != null);
    let summary = 'No forecast data returned.';
    if (ok.length) {
      const avg = (a:number[]) => Math.round(a.reduce((x,y)=>x+y,0)/a.length);
      const avgCloud = avg(ok.map(r=>r.cloud_cover_pct));
      const maxRain = Math.max(...ok.map(r=>r.precip_probability_pct ?? 0));
      const maxGust = Math.max(...ok.map(r=>r.wind_gusts_kmh ?? 0));
      const golden = ok.filter(r=>r.is_golden_hour).length;
      const foggy = ok.filter(r=>r.fog_risk && r.fog_risk!=='none').length;
      const split = ok.filter(r=>r.comparison?.agreement === 'SPLIT').length;
      const sky = avgCloud<25?'mostly clear':avgCloud<60?'partly cloudy':avgCloud<85?'cloudy':'overcast';
      const wind = maxGust<20?'calm':maxGust<40?'breezy':maxGust<60?'windy':'very windy';
      const rain = maxRain<20?'low rain risk':maxRain<50?`${maxRain}% rain risk`:`high rain risk (${maxRain}%)`;
      summary = `${sky[0].toUpperCase()+sky.slice(1)}, ${wind} (gusts ${Math.round(maxGust)} km/h), ${rain}.`
        + (foggy?` Fog ${foggy>1?'risk at several stops':'risk at one stop'}.`:'')
        + (golden?` ${golden} stop${golden>1?'s':''} near golden hour.`:'')
        + (split?` Models split at ${split} stop${split>1?'s':''}.`:'');
    }

    return new Response(JSON.stringify({
      ok:true, day_id:dayId, day_title:day.title, test, date_shifted:dateShifted,
      forecast_date_used:usedDate, real_trip_date:day.date, generated_at:new Date().toISOString(),
      version:'v29-registry',
      registry_source: registrySource,
      models_in_registry: reg.models.length,
      ensemble_cells: ensembleByCell.size,
      rows_written: writeRows.length,
      metar: metar ? metar.raw_metar : (metarErr ? `error: ${metarErr}` : null),
      day_summary:summary, stops:results,
    }), { headers:{ ...corsHeaders, 'Content-Type':'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message ?? e) }),
      { status:500, headers:{ ...corsHeaders, 'Content-Type':'application/json' } });
  }
});
