import { createClient } from 'jsr:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';

// SOLVER ACTIONS: the TEST app's one door for writes and webcam images.
// POST {action, ...}
//   mark_shot    {stop_id, status: 'got' | 'nailed' | null}   tick on a stop
//   frames       {lat?, lng?, n?}  latest frame of the n cameras nearest the
//                point, within MAX_CAMERA_KM (all active cameras without a
//                point), as signed URLs;
//                {trip_id}: cameras within MAX_CAMERA_KM of any of the
//                trip's stops (the Planner's strip);
//                {camera, at?}: that camera's frame at or before `at`.
//                Daylight, fresh frames only (sun > 3 deg, not stale): at night
//                or when a camera freezes, the tile shows the last good frame
//                and its real age (taken_at: the camera's own time when known,
//                else when it was fetched). camera.live_url is the camera's
//                newest picture for the Live button (templated archives: the
//                newest file at least LIVE_LAG_MIN old, its camera-local time
//                in camera.live_time; Roundshot panoramas: the newest file
//                their Location header names)
//   label_frame  {frame_id, label: clear|cloud_on_hills|fog|cant_tell|null}
//   stop_settings {stop_id}  the stop's planner settings and its shots
//   set_settings {stop_id, tier?, light_wanted?, fog_wanted?, needs_peaks?, star_vantage_id?}
//                Phil's own settings from the stop screen (source -> 'phil';
//                {stop_id} alone confirms Claude's suggestion as it is)
//   confirm_all  {trip_id}  keep every suggested setting on the trip as Phil's
//   subject_grid {trip_id}  each rated stop's best chance on every trip day
//                (solver_subject_grid: forecast inside the score build, else light only)
//   plan         {trip_id, trip_date, preview?}  plan a trip day now: light-only
//                past the forecast; preview: this week's forecast as that day;
//                {trip_id, trip_dates: [up to 3]} plans those days together;
//                refresh: true first rebuilds the trip's scores (solver_nightly,
//                ~6-10 s) when a rating, light, fog or shot changed since the
//                last build, so "Plan again" uses Phil's latest changes
//   apply_preview {run_id, rank}  what applying a plan would change
//   apply        {run_id, rank}  the test trips only (test bed, Faroes Live, Teton Live;
//                Phil, 1 Nov 2026: "accept all" in the TEST app) until Phil signs off
//                the solver; real trips get the preview
//   apply_week   {trip_id, apply?}  T's plan for the rest of the trip at once (today's
//                visits still ahead + every later day; past days and passed stops frozen;
//                solver_apply_week). apply: true writes on the test trips only; otherwise
//                (and on real trips) the preview
//   planning_status {trip_id}  T's newest week draft for the trip (replay_runs, no anon
//                read): {id, status, night, nights, trip_dates, made, updated_at}
//   stop_curve   {stop_id, trip_date}  the stop's chance per 15-min slot that trip day
//                (solver_stop_curve: newest raw score build, else light only) and
//                built_at, when that build was made
// Plans and settings are read straight from the tables (read-only policies).

// Trips "Accept all" may write to: the test bed, Faroes Live and Teton Live.
const TEST_TRIPS = new Set([
  '7e57bed0-0000-4000-8000-000000000001',
  '7e57bed0-0000-4000-8000-000000000002',
  '7e57bed0-0000-4000-8000-000000000003',
]);
const TIERS = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F'];
const LIGHTS = ['front', 'side', 'back', 'soft'];
const SETTING_COLS = 'stop_id, tier, light_wanted, fog_wanted, needs_peaks, star_vantage_id, shot_status, source';
const SIGNED_URL_S = 3600;
// A camera further than this says nothing about a stop (a Teton stop got
// Faroe cameras 6,400 km away).
const MAX_CAMERA_KM = 50;
// Templated archives (TetonCam) upload each 15-min file a few minutes late.
const LIVE_LAG_MIN = 10;
const TEMPLATE_STEP_MIN = 15;
// "Plan again" rebuilds at most this often per trip.
const REBUILD_MIN_GAP_MIN = 2;

// Rebuild the trip's scores when its settings or shots changed after the
// newest build (the nightly build only runs at 10:41 / 19:41 UTC).
async function refreshBuild(db: any, tripId: string): Promise<boolean> {
  const { data: b } = await db.from('solver_score_builds').select('built_at').eq('trip_id', tripId).eq('variant', 'raw')
    .order('built_at', { ascending: false }).limit(1).maybeSingle();
  const built = b ? Date.parse(b.built_at) : 0;
  if (Date.now() - built < REBUILD_MIN_GAP_MIN * 60_000) return false;
  const latest = async (table: string, col: string) => {
    const { data } = await db.from(table).select(`${col}, stops!inner(trip_id)`).eq('stops.trip_id', tripId)
      .order(col, { ascending: false }).limit(1).maybeSingle();
    return data ? Date.parse(data[col]) : 0;
  };
  const changed = Math.max(await latest('solver_stop_settings', 'updated_at'), await latest('stop_sun_pairs', 'created_at'));
  if (changed <= built) return false;
  // Direct connection: the API's 8 s statement limit is too short for a build (~6-10 s).
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  try { await sql`select public.solver_nightly(${tripId}::uuid)`; } finally { await sql.end(); }
  return true;
}

function liveUrl(c: { image_url: string; tz: string | null }, now: Date): { url: string; time: string | null } {
  if (!c.image_url.includes('{')) return { url: c.image_url, time: null };
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: c.tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const step = TEMPLATE_STEP_MIN * 60_000;
  const t = new Date(Math.floor((now.getTime() - LIVE_LAG_MIN * 60_000) / step) * step);
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(t)) p[x.type] = x.value;
  return {
    url: c.image_url.replace('{YYYY}', p.year).replace('{MM}', p.month).replace('{DD}', p.day).replace('{HHmm}', p.hour + p.minute),
    time: `${p.hour}:${p.minute}`,
  };
}

// Roundshot's .../cams/<id>/<size> answers 200 with an empty body and the
// newest picture in Location, which an app image can't follow: resolve it
// here (its file name carries the camera-local time).
async function resolveRoundshot(l: { url: string; time: string | null }) {
  if (!/roundshot\.com\/cams\//.test(l.url)) return l;
  try {
    const r = await fetch(l.url, { signal: AbortSignal.timeout(5000) });
    await r.body?.cancel();
    // 200 + Location (some clients) or a real redirect that fetch followed (v17: before, the
    // followed case kept the bare address and no time).
    const loc = r.headers.get('location');
    const target = loc ? new URL(loc, l.url).toString() : r.redirected ? r.url : null;
    if (!target) return l;
    const m = target.match(/\d{4}-\d{2}-\d{2}-(\d{2})-(\d{2})-\d{2}_[a-z]+\.jpg/);
    return { url: target, time: m ? `${m[1]}:${m[2]}` : null };
  } catch { return l; }
}

// Sun height in degrees (NOAA low precision, as webcam-archive).
function sunAlt(lat: number, lng: number, d: Date) {
  const rad = Math.PI / 180;
  const n = d.getTime() / 86400000 - 10957.5;
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const ha = ((280.46061837 + 360.98564736629 * n + lng) % 360) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const url = Deno.env.get('SUPABASE_URL')!;
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    switch (body.action) {
      case 'mark_shot': {
        if (!body.stop_id) return json({ error: 'stop_id required' }, 400);
        const { data, error } = await db.rpc('solver_mark_shot', {
          p_stop_id: body.stop_id, p_status: body.status ?? null,
          p_at: body.status ? new Date().toISOString() : null,
        });
        if (error) throw error;
        return json({ ok: true, setting: data });
      }

      case 'frames': {
        const { data: cams, error } = await db.from('webcam_cameras')
          .select('code, name, island, lat, lng, image_url, source, tz').eq('active', true);
        if (error) throw error;
        const now = new Date();
        const here = body.lat != null && body.lng != null ? { lat: Number(body.lat), lng: Number(body.lng) } : null;
        let tripStops: { lat: number; lng: number }[] | null = null;
        if (body.trip_id) {
          const { data: st, error: sErr } = await db.from('stops').select('lat, lng')
            .eq('trip_id', body.trip_id).not('lat', 'is', null);
          if (sErr) throw sErr;
          tripStops = st ?? [];
        }
        const dist = (c: any) => here ? km(here, c)
          : tripStops ? Math.min(Infinity, ...tripStops.map(s => km(s, c))) : null;
        const ranked = (cams ?? []).filter(c => c.lat != null && (!body.camera || c.code === body.camera))
          .map(c => { const d = dist(c); const l = liveUrl(c, now);
            return { ...c, live_url: l.url, live_time: l.time, distance_km: d == null ? null : Math.round(d * 10) / 10 }; })
          .filter(c => c.distance_km == null || c.distance_km <= MAX_CAMERA_KM)
          .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
          .slice(0, here ? Math.min(Number(body.n ?? 2), 8) : 12);
        const out = await Promise.all(ranked.map(async c0 => {
          const l = await resolveRoundshot({ url: c0.live_url, time: c0.live_time });
          const c = { ...c0, live_url: l.url, live_time: l.time };
          const { data: f } = await db.from('webcam_frames')
            .select('id, captured_at, fetched_at, camera_time, storage_path, label, hills_visible, cloud_on_hills, sun_on_land, label_note, label_model, label_error, phil_label, edge_top')
            .eq('camera_code', c.code).not('storage_path', 'is', null).gt('sun_altitude', 3).eq('stale', false)
            .lte('captured_at', body.at ?? new Date().toISOString())
            .order('captured_at', { ascending: false }).limit(1).maybeSingle();
          let signed: string | null = null;
          if (f?.storage_path) {
            const { data: s } = await db.storage.from('webcams').createSignedUrl(f.storage_path, SIGNED_URL_S);
            signed = s?.signedUrl ?? null;
          }
          return { camera: c, frame: f ? { ...f, url: signed, taken_at: f.camera_time ?? f.fetched_at ?? f.captured_at,
                                           label_error: f.label_error ? 'not labelled yet' : null } : null };
        }));
        return json({ ok: true, cameras: out });
      }

      case 'label_frame': {
        const allowed = ['clear', 'cloud_on_hills', 'fog', 'cant_tell'];
        if (!body.frame_id || (body.label != null && !allowed.includes(body.label))) return json({ error: 'frame_id and a valid label required' }, 400);
        const { error } = await db.from('webcam_frames')
          .update({ phil_label: body.label ?? null, phil_labeled_at: body.label ? new Date().toISOString() : null })
          .eq('id', body.frame_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'stop_settings': {
        if (!body.stop_id) return json({ error: 'stop_id required' }, 400);
        const [{ data: setting, error: sErr }, { data: pairs, error: pErr }] = await Promise.all([
          db.from('solver_stop_settings').select(SETTING_COLS).eq('stop_id', body.stop_id).maybeSingle(),
          db.from('stop_sun_pairs').select('vantage_id, position, scout_vantages(shot_name, name)')
            .eq('stop_id', body.stop_id).order('position'),
        ]);
        if (sErr) throw sErr;
        if (pErr) throw pErr;
        const shots = (pairs ?? []).map((p: any) => ({
          vantage_id: p.vantage_id, position: p.position,
          name: p.scout_vantages?.shot_name ?? p.scout_vantages?.name ?? 'shot',
        }));
        return json({ ok: true, setting, shots });
      }

      case 'set_settings': {
        if (!body.stop_id) return json({ error: 'stop_id required' }, 400);
        const patch: Record<string, any> = { source: 'phil' };
        if ('tier' in body) {
          if (body.tier != null && !TIERS.includes(body.tier)) return json({ error: `tier must be one of ${TIERS.join(', ')}` }, 400);
          patch.tier = body.tier;
        }
        if ('light_wanted' in body) {
          if (!Array.isArray(body.light_wanted) || body.light_wanted.some((l: any) => !LIGHTS.includes(l))) {
            return json({ error: `light_wanted must be a list of ${LIGHTS.join(', ')}` }, 400);
          }
          patch.light_wanted = [...new Set(body.light_wanted)];
        }
        if ('fog_wanted' in body) patch.fog_wanted = !!body.fog_wanted;
        // needs_peaks (v19, worksheet A3, Phil 6 Nov 2026: opt out per stop): false = looks fine under cloud.
        if ('needs_peaks' in body) patch.needs_peaks = body.needs_peaks !== false;
        if ('star_vantage_id' in body) patch.star_vantage_id = body.star_vantage_id ?? null;
        const { data: have } = await db.from('solver_stop_settings').select('stop_id').eq('stop_id', body.stop_id).maybeSingle();
        const q = have
          ? db.from('solver_stop_settings').update(patch).eq('stop_id', body.stop_id)
          : db.from('solver_stop_settings').insert({ stop_id: body.stop_id, time_locked: false, ...patch });
        const { data, error } = await q.select(SETTING_COLS).single();
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, setting: data });
      }

      case 'confirm_all': {
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const { data: st, error: sErr } = await db.from('stops').select('id').eq('trip_id', body.trip_id);
        if (sErr) throw sErr;
        const { data, error } = await db.from('solver_stop_settings').update({ source: 'phil' })
          .in('stop_id', (st ?? []).map(x => x.id)).eq('source', 'suggested').select('stop_id');
        if (error) throw error;
        return json({ ok: true, confirmed: data?.length ?? 0 });
      }

      case 'subject_grid': {
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const { data, error } = await db.rpc('solver_subject_grid', { p_trip: body.trip_id });
        if (error) throw error;
        return json({ ok: true, grid: data ?? [] });
      }

      case 'plan': {
        const dates: string[] | null = Array.isArray(body.trip_dates) ? body.trip_dates.slice(0, 3) : null;
        if (!body.trip_id || (!body.trip_date && !dates?.length)) return json({ error: 'trip_id and trip_date (or trip_dates) required' }, 400);
        const planBody: any = dates?.length
          ? { trip_id: body.trip_id, days: dates.map(d => ({ trip_date: d })), k: 4 }
          : { trip_id: body.trip_id, trip_date: body.trip_date, k: 4 };
        if (body.preview && !dates) planBody.date = new Date().toISOString().slice(0, 10);
        const refreshed = body.refresh ? await refreshBuild(db, body.trip_id) : false;
        const r = await fetch(`${url}/functions/v1/solver-plan`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(planBody),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) return json({ ok: false, error: j?.error ?? `planner ${r.status}`, detail: j }, 200);
        return json({ ok: true, run_id: j.run_id, refreshed });
      }

      case 'apply_preview':
      case 'apply': {
        if (!body.run_id || body.rank == null) return json({ error: 'run_id and rank required' }, 400);
        const { data: run } = await db.from('solver_runs').select('trip_id').eq('id', body.run_id).maybeSingle();
        if (!run) return json({ error: 'run not found' }, 404);
        const write = body.action === 'apply' && TEST_TRIPS.has(run.trip_id);
        const { data, error } = await db.rpc('solver_apply_plan', { p_run_id: body.run_id, p_rank: body.rank, p_apply: write });
        if (error) return json({ ok: false, error: error.message });
        return json({ ok: true, preview_only: !write, result: data });
      }

      case 'apply_week': {
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const write = !!body.apply && TEST_TRIPS.has(body.trip_id);
        const { data, error } = await db.rpc('solver_apply_week', { p_trip: body.trip_id, p_apply: write });
        if (error) return json({ ok: false, error: error.message });
        return json({ ok: true, preview_only: !write, result: data });
      }

      case 'planning_status': {
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const { data: r, error } = await db.from('replay_runs')
          .select('id, status, night, nights, trip_dates, config, updated_at')
          .eq('trip_id', body.trip_id).eq('config->>name', 'draft_T')
          .order('id', { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        return json({ ok: true, status: r ? { id: r.id, status: r.status, night: r.night, nights: r.nights, trip_dates: r.trip_dates,
                                               made: r.config?.made ?? null, updated_at: r.updated_at } : null });
      }

      case 'feeds': {
        // Feeds page (v17, Phil 3 Nov 2026: "make sure when something is live it's actually live";
        // a trip-level page next to the Planner). Every camera within MAX_CAMERA_KM of the trip's
        // stops with a status from what the archive saw, the live picture's own time when its
        // source tells it (Roundshot: the time in its address; others: Last-Modified, read now),
        // the METAR stations within 30 km with their newest report, and when the forecasts and
        // T's plans last updated.
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const now = new Date();
        const { data: st, error: sErr } = await db.from('stops').select('lat, lng').eq('trip_id', body.trip_id).not('lat', 'is', null);
        if (sErr) throw sErr;
        const pts = st ?? [];
        const near = (c: { lat: number; lng: number }, maxKm: number) => {
          const d = pts.length ? Math.min(...pts.map(s => km(s, c))) : Infinity;
          return d <= maxKm ? Math.round(d * 10) / 10 : null;
        };
        const { data: cams, error } = await db.from('webcam_cameras')
          .select('code, name, island, lat, lng, image_url, source, tz').eq('active', true);
        if (error) throw error;
        const listed = (cams ?? []).filter(c => c.lat != null).map(c => ({ c, d: near(c, MAX_CAMERA_KM) }))
          .filter(x => x.d != null).sort((a, b) => a.d! - b.d!).slice(0, 12);
        const cameras = await Promise.all(listed.map(async ({ c, d }) => {
          const sun = sunAlt(c.lat, c.lng, now);
          const l0 = liveUrl(c, now);
          const l = await resolveRoundshot({ url: l0.url, time: l0.time });
          // The live picture's own time: Roundshot / templated cameras carry it; else ask the server.
          let liveSource: string | null = null;
          if (!l.time && !c.image_url.includes('{')) {
            try {
              const h = await fetch(l.url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
              const lm = h.headers.get('last-modified'); const t = lm ? Date.parse(lm) : NaN;
              if (Number.isFinite(t)) liveSource = new Date(t).toISOString();
            } catch { /* no answer: unknown */ }
          }
          const { data: last } = await db.from('webcam_frames')
            .select('captured_at, fetched_at, camera_time, source_time, stale, stale_reason, storage_path, label, hills_visible, cloud_on_hills, label_note')
            .eq('camera_code', c.code).order('captured_at', { ascending: false }).limit(1).maybeSingle();
          const { data: good } = await db.from('webcam_frames')
            .select('captured_at, fetched_at, camera_time, source_time, storage_path, label, hills_visible, cloud_on_hills, label_note')
            .eq('camera_code', c.code).eq('stale', false).not('storage_path', 'is', null)
            .order('captured_at', { ascending: false }).limit(1).maybeSingle();
          const ageMin = (t?: string | null) => (t ? Math.round((now.getTime() - Date.parse(t)) / 60000) : null);
          const lastAt = last ? (last.fetched_at ?? last.captured_at) : null;
          // live: archived in the last 90 min and not frozen; frozen: the newest frame is stale;
          // night: sun below -6 deg (no captures); offline: daylight but nothing for over 90 min.
          const status = sun < -6 ? 'night' : last?.stale ? 'frozen' : (ageMin(lastAt) ?? 1e9) <= 90 ? 'live' : 'offline';
          let url: string | null = null;
          if (good?.storage_path) {
            const { data: s } = await db.storage.from('webcams').createSignedUrl(good.storage_path, SIGNED_URL_S);
            url = s?.signedUrl ?? null;
          }
          return {
            code: c.code, name: c.name, source: c.source, distance_km: d, tz: c.tz, status, image_url: c.image_url,
            stale_reason: last?.stale ? last.stale_reason : null,
            live_url: l.url, live_time: l.time, live_source_time: liveSource,
            last_checked: lastAt,
            frame: good ? { url, taken_at: good.camera_time ?? good.source_time ?? good.fetched_at ?? good.captured_at,
                            label: good.label, hills_visible: good.hills_visible, cloud_on_hills: good.cloud_on_hills, note: good.label_note } : null,
          };
        }));
        const { data: sts } = await db.from('metar_stations').select('icao, name, lat, lng, hidden_ceiling_ft');
        const stations = await Promise.all((sts ?? []).filter(s => s.lat != null && near(s, 30) != null).map(async s => {
          const { data: o } = await db.from('station_obs_hourly')
            .select('hr, fetched_at, ceiling_ft, lowest_cloud_ft, cloud_pct, visibility_m, temperature_c, wx_string, fog')
            .eq('station', s.icao).order('hr', { ascending: false }).limit(1).maybeSingle();
          return { icao: s.icao, name: s.name, distance_km: near(s, 30), hidden_ceiling_ft: s.hidden_ceiling_ft,
                   peaks_hidden: o && s.hidden_ceiling_ft && o.ceiling_ft != null ? o.ceiling_ft < s.hidden_ceiling_ft : null, obs: o ?? null };
        }));
        const one = async (q: any) => { const { data } = await q.limit(1).maybeSingle(); return data; };
        const fc = await one(db.from('weather_forecasts').select('fetched_at').eq('trip_id', body.trip_id).order('fetched_at', { ascending: false }));
        const ens = await one(db.from('weather_ensemble_pulls').select('pulled_at, run_at').order('pulled_at', { ascending: false }));
        const build = await one(db.from('solver_score_builds').select('built_at').eq('trip_id', body.trip_id).eq('variant', 'raw').order('built_at', { ascending: false }));
        const plan = await one(db.from('solver_runs').select('created_at').eq('trip_id', body.trip_id).eq('stats->>planner', 'T').order('created_at', { ascending: false }));
        return json({ ok: true, now: now.toISOString(), cameras, stations,
                      updated: { forecast: fc?.fetched_at ?? null, ensemble: ens?.pulled_at ?? null, ensemble_run: ens?.run_at ?? null,
                                 planner_scores: build?.built_at ?? null, plan: plan?.created_at ?? null } });
      }

      case 'stop_curve': {
        if (!body.stop_id || !body.trip_date) return json({ error: 'stop_id and trip_date required' }, 400);
        const { data, error } = await db.rpc('solver_stop_curve', { p_stop: body.stop_id, p_date: body.trip_date });
        if (error) throw error;
        // When the forecast behind it was built (the app's "updated" line).
        const { data: st } = await db.from('stops').select('trip_id').eq('id', body.stop_id).maybeSingle();
        const { data: b } = st ? await db.from('solver_score_builds').select('built_at').eq('trip_id', st.trip_id).eq('variant', 'raw')
          .order('built_at', { ascending: false }).limit(1).maybeSingle() : { data: null };
        return json({ ok: true, slots: data ?? [], built_at: b?.built_at ?? null });
      }

      default:
        return json({ error: `unknown action ${body.action}` }, 400);
    }
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
