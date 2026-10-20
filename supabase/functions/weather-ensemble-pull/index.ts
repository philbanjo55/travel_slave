import { createClient } from 'jsr:@supabase/supabase-js@2';

// NIGHTLY ENSEMBLE ARCHIVE
// Open-Meteo keeps individual ensemble members for ~3 days only, so this is
// the only member-level history the solver's backtests will ever have.
// One row per pull x 0.25 degree cell x model x valid hour, members stored as
// arrays (index 0 = control). Kept separate from weather-pull, which is a
// per-day display pipeline with a 21-day prune.
//
// Scenario source is ECMWF (51 members). It serves no visibility or cloud
// base, so two thinner ensembles are archived for visibility only, and the
// 2 km HARMONIE deterministic run for the fog fields (visibility, cloud base,
// 2 m cloud) that become a shared, member-invariant gate.

const GRID = 0.25; // same cell convention as weather-pull's cellKey
const HORIZON_H = 72;
// OUTLOOK: when a live trip has days 4-15 days out, ECMWF (only) is pulled
// for 16 days and kept up to the last such trip day, so the solver can plan
// those days on real ensemble members instead of light only. Beyond 144 h
// ECMWF is 6-hourly. Approved by Phil 21 Oct 2026; sleeps outside trip windows.
const OUTLOOK_DAYS = 15;
// {outlook_until: 'YYYY-MM-DD'} in the body forces a window (testing).

type Spec = {
  model: string;
  api: 'ensemble' | 'forecast';
  stepH: number;        // native time step; Open-Meteo interpolates the rest
  meta: string;         // dataset name for the meta.json run-time lookup
  vars: Record<string, string>; // weather_ensemble column -> API variable
};

const SPECS: Spec[] = [
  { model: 'ecmwf_ifs025', api: 'ensemble', stepH: 3, meta: 'ecmwf_ifs025_ensemble', vars: {
      cloud_total: 'cloud_cover', cloud_low: 'cloud_cover_low', cloud_mid: 'cloud_cover_mid',
      rh: 'relative_humidity_2m', temp_c10: 'temperature_2m', dew_c10: 'dew_point_2m',
      wind_kmh10: 'wind_speed_10m', gust_kmh10: 'wind_gusts_10m', precip_mm10: 'precipitation',
      wcode: 'weather_code' } },
  { model: 'gfs025', api: 'ensemble', stepH: 3, meta: 'ncep_gefs025', vars: { vis: 'visibility' } },
  { model: 'ukmo_global_ensemble_20km', api: 'ensemble', stepH: 1, meta: 'ukmo_global_ensemble_20km', vars: { vis: 'visibility' } },
  { model: 'dmi_harmonie_arome_europe', api: 'forecast', stepH: 1, meta: 'dmi_harmonie_arome_europe', vars: {
      vis: 'visibility', cloud_base: 'cloud_base', cloud_2m: 'cloud_cover_2m',
      cloud_total: 'cloud_cover', cloud_low: 'cloud_cover_low', rh: 'relative_humidity_2m',
      temp_c10: 'temperature_2m', dew_c10: 'dew_point_2m', wcode: 'weather_code',
      wind_kmh10: 'wind_speed_10m', gust_kmh10: 'wind_gusts_10m', precip_mm10: 'precipitation' } },
];

// Free plan: members are stored as smallint[] wherever 0.1 resolution is
// enough (value x 10 in the *10 columns). vis and cloud_base stay real[].
const SCALE: Record<string, number> = {
  cloud_total: 1, cloud_low: 1, cloud_mid: 1, cloud_2m: 1, rh: 1, wcode: 1,
  temp_c10: 10, dew_c10: 10, wind_kmh10: 10, gust_kmh10: 10, precip_mm10: 10,
};

const HOST = { ensemble: 'https://ensemble-api.open-meteo.com', forecast: 'https://api.open-meteo.com' };
const PATH = { ensemble: '/v1/ensemble', forecast: '/v1/forecast' };

const cellKey = (lat: number, lng: number) =>
  `${Math.round(lat/GRID)*GRID},${Math.round(lng/GRID)*GRID}`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Upstream 500s have wiped a whole night of ensemble stats before; retry
// before giving up on a cell. A 429 means the per-minute weighted quota is
// spent (51 members count heavily), so wait it out for longer.
async function getJson(url: string, attempts = 3): Promise<{ j: any; err: string | null }> {
  let err: string | null = null;
  for (let i = 0; i < attempts; i++) {
    let wait = 2000 * (i + 1);
    try {
      const r = await fetch(url);
      if (r.ok) return { j: await r.json(), err: null };
      err = `${r.status}`;
      if (r.status === 429) wait = 20000;
      else if (r.status >= 400 && r.status < 500) break;
    } catch (e) { err = String(e); }
    if (i < attempts - 1) await sleep(wait);
  }
  return { j: null, err };
}

// HARMONIE DINI is a European domain; elsewhere it only returns 400s.
const inDomain = (spec: Spec, lng: number) => spec.model !== 'dmi_harmonie_arome_europe' || lng > -40;

// Requests are spaced so the pull stays under Open-Meteo's per-minute limit
// even with the hourly weather-pull running.
const SPACING_MS = 700;

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

// Keys come back as `<var>` (control) and `<var>_memberNN`, optionally with a
// `_<model>` suffix. Matching on `<var>_member` keeps cloud_cover from
// swallowing cloud_cover_low.
function memberArrays(H: any, v: string, model: string): (number | null)[][] {
  const out: (number | null)[][] = [];
  const control = H[v] ?? H[`${v}_${model}`];
  if (Array.isArray(control)) out[0] = control;
  const re = new RegExp(`^${v}_member(\\d+)(?:_.*)?$`);
  for (const k of Object.keys(H)) {
    const m = k.match(re);
    if (m && Array.isArray(H[k])) out[parseInt(m[1], 10)] = H[k];
  }
  return out;
}

async function runAt(spec: Spec): Promise<string | null> {
  const { j } = await getJson(`${HOST[spec.api]}/data/${spec.meta}/static/meta.json`, 1);
  const t = num(j?.last_run_initialisation_time);
  return t != null ? new Date(t * 1000).toISOString() : null;
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // One archive per hour at most, unless forced (the endpoint has no auth).
    if (body.force !== true) {
      const { data: recent } = await supabase.from('weather_ensemble_pulls').select('id')
        .gte('pulled_at', new Date(Date.now() - 3600_000).toISOString()).limit(1);
      if (recent?.length) return json({ ok: true, skipped: 'pulled within the last hour' });
    }

    // Cells of shooting stops on live trips. Logistics stops (airports) are
    // left out: they would add cells nobody photographs.
    const today = new Date().toISOString().slice(0, 10);
    const { data: trips, error: tErr } = await supabase.from('trips').select('id,archived,end_date');
    if (tErr) throw tErr;
    const tripIds = (trips ?? [])
      .filter((t: any) => t.archived !== true && (t.end_date == null || t.end_date >= today))
      .map((t: any) => t.id);
    const { data: stops, error: sErr } = await supabase.from('stops')
      .select('lat,lng,shot_type').in('trip_id', tripIds).not('lat', 'is', null);
    if (sErr) throw sErr;
    const cells = [...new Set((stops ?? [])
      .filter((s: any) => s.shot_type !== 'logistics')
      .map((s: any) => cellKey(s.lat, s.lng)))];

    // Last live trip day inside the outlook window (days 4-15), if any.
    const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    let outlookUntil: string | null = body.outlook_until ?? null;
    if (!outlookUntil && tripIds.length) {
      const { data: od } = await supabase.from('days').select('date').in('trip_id', tripIds)
        .gte('date', inDays(3)).lte('date', inDays(OUTLOOK_DAYS)).order('date', { ascending: false }).limit(1);
      outlookUntil = od?.[0]?.date ?? null;
    }

    const runs: Record<string, string | null> = {};
    for (const spec of SPECS) runs[spec.model] = await runAt(spec);

    const { data: pull, error: pErr } = await supabase.from('weather_ensemble_pulls')
      .insert({ run_at: runs, cells: cells.length }).select('id').single();
    if (pErr) throw pErr;

    const fromMs = Math.floor(Date.now() / 3600_000) * 3600_000;
    const toMs = fromMs + HORIZON_H * 3600_000;
    // To the end of the last outlook trip day (UTC +1 day covers late evening local).
    const outlookToMs = outlookUntil ? Date.parse(`${outlookUntil}T00:00:00Z`) + 2 * 86400000 : toMs;
    const errors: any[] = [];
    let ecmwfFailed = 0;
    const rows: any[] = [];

    for (const cell of cells) {
      const [lat, lng] = cell.split(',').map(Number);
      for (const spec of SPECS) {
        if (!inDomain(spec, lng)) continue;
        // Free-plan wall clock is 150 s; keep time to write what we have.
        if (Date.now() - t0 > 115_000) { errors.push({ cell, model: spec.model, error: 'time budget' }); continue; }
        const outlook = outlookUntil != null && spec.model === 'ecmwf_ifs025';
        const lastMs = outlook ? Math.max(toMs, outlookToMs) : toMs;
        const { j, err } = await getJson(
          `${HOST[spec.api]}${PATH[spec.api]}?latitude=${lat}&longitude=${lng}`
          + `&hourly=${Object.values(spec.vars).join(',')}&models=${spec.model}`
          + `&forecast_days=${outlook ? 16 : 4}&timezone=GMT&wind_speed_unit=kmh`);
        await sleep(SPACING_MS);
        if (err || !j?.hourly?.time) {
          errors.push({ cell, model: spec.model, error: err ?? 'no hourly' });
          if (spec.model === 'ecmwf_ifs025') ecmwfFailed++;
          continue;
        }
        const H = j.hourly;
        const cols: Record<string, (number | null)[][]> = {};
        for (const [col, v] of Object.entries(spec.vars)) cols[col] = memberArrays(H, v, spec.model);

        (H.time as string[]).forEach((t, i) => {
          const ms = Date.parse(`${t}:00Z`);
          if (!(ms >= fromMs && ms <= lastMs)) return;
          const step = ms - fromMs > 144 * 3600_000 ? Math.max(spec.stepH, 6) : spec.stepH;
          if (new Date(ms).getUTCHours() % step !== 0) return;
          const row: Record<string, any> = { pull_id: pull.id, cell_key: cell, model: spec.model,
                                             valid_at: new Date(ms).toISOString() };
          let any = false;
          for (const [col, members] of Object.entries(cols)) {
            if (!members.length) continue;
            const vals = Array.from({ length: members.length }, (_, k) => {
              const x = num(members[k]?.[i]);
              return x == null ? null : col in SCALE ? Math.round(x * SCALE[col]) : Math.round(x * 100) / 100;
            });
            if (vals.some(x => x != null)) { row[col] = vals; any = true; }
          }
          // A model outside its domain (HARMONIE at the Tetons) returns nulls.
          if (any) rows.push(row);
        });
      }
    }

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('weather_ensemble').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }

    const degraded = cells.length > 0 && ecmwfFailed === cells.length;
    await supabase.from('weather_ensemble_pulls').update({
      rows_written: rows.length, degraded, errors: errors.length ? errors : null,
      duration_ms: Date.now() - t0,
    }).eq('id', pull.id);

    return json({ ok: true, pull_id: pull.id, cells: cells.length, rows_written: rows.length, outlook_until: outlookUntil,
                  degraded, errors: errors.length, run_at: runs, duration_ms: Date.now() - t0 });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
