import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER DRIVE GRID
// Drive time between every pair of spots a trip's stops sit at, for the
// solver. Stops within ~100 m share a spot (coordinates rounded to 3 dp), and
// legs are stored per spot pair in solver_drive_legs, not per trip, so a
// later trip reuses any spot it shares and a repeat call costs nothing unless
// a stop moves: only pairs not yet stored are sent to Google. That also caps
// what an unauthenticated caller can spend.
// Points over MAX_KM from the trip's middle (home airport, connections) are
// left out. Google won't route across car ferries (ROUTE_NOT_FOUND);
// solver_drive_matrix prices those legs through solver_ferry_links.

const MAPS_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!;
const MAX_KM = 300;
const MAX_ELEMENTS_PER_CALL = 2500;

type Spot = { lat: number; lng: number };
const key = (a: Spot, b: Spot) => `${a.lat},${a.lng}|${b.lat},${b.lng}`;

function km(a: Spot, b: Spot) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// Routes API matrix: up to 625 elements and 50 waypoints per request.
async function routesMatrix(origins: Spot[], dests: Spot[]) {
  const wp = (s: Spot) => ({ waypoint: { location: { latLng: { latitude: s.lat, longitude: s.lng } } } });
  const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition,status',
    },
    body: JSON.stringify({ origins: origins.map(wp), destinations: dests.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
  });
  if (!r.ok) throw Object.assign(new Error(`routes ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status });
  const rows: any[] = await r.json();
  return rows.map(e => ({
    o: e.originIndex ?? 0, d: e.destinationIndex ?? 0,
    ok: e.condition === 'ROUTE_EXISTS',
    minutes: e.duration ? Math.round(parseInt(e.duration) / 60) : null,
    km: e.distanceMeters != null ? Math.round(e.distanceMeters / 100) / 10 : null,
    status: e.condition ?? e.status?.message ?? 'unknown',
  }));
}

// Legacy Distance Matrix fallback when the key lacks the Routes API: 100 elements per request.
async function legacyMatrix(origins: Spot[], dests: Spot[]) {
  const s = (xs: Spot[]) => xs.map(p => `${p.lat},${p.lng}`).join('|');
  const r = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${s(origins)}&destinations=${s(dests)}&mode=driving&key=${MAPS_KEY}`);
  const j = await r.json();
  if (j.status !== 'OK') throw new Error(`distancematrix ${j.status}: ${j.error_message ?? ''}`);
  return j.rows.flatMap((row: any, o: number) => row.elements.map((e: any, d: number) => ({
    o, d, ok: e.status === 'OK',
    minutes: e.duration ? Math.round(e.duration.value / 60) : null,
    km: e.distance ? Math.round(e.distance.value / 100) / 10 : null,
    status: e.status,
  })));
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const { trip_id } = await req.json().catch(() => ({}));
    if (!trip_id) return json({ error: 'trip_id required' }, 400);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Spots come from SQL so they are rounded exactly as solver_drive_matrix
    // rounds them (JS Math.round and Postgres round() disagree on halves).
    const { data: rows, error } = await supabase.rpc('solver_trip_spots', { p_trip_id: trip_id });
    if (error) throw error;
    const all = new Map<string, Spot>();
    for (const r of rows ?? []) { const p = { lat: Number(r.lat), lng: Number(r.lng) }; all.set(`${p.lat},${p.lng}`, p); }
    const pts = [...all.values()];
    if (pts.length < 2) return json({ ok: true, spots: pts.length, fetched: 0 });
    const mid = { lat: pts.map(p => p.lat).sort((a, b) => a - b)[pts.length >> 1], lng: pts.map(p => p.lng).sort((a, b) => a - b)[pts.length >> 1] };
    const spots = pts.filter(p => km(p, mid) <= MAX_KM);

    // Paged: PostgREST caps a response at 1000 rows, and a leg missed here
    // would be paid for again.
    const stored = new Set<string>();
    const lats = [...new Set(spots.map(s => s.lat))];
    for (let from = 0; ; from += 1000) {
      const { data: have, error: hErr } = await supabase.from('solver_drive_legs')
        .select('from_lat,from_lng,to_lat,to_lng').in('from_lat', lats)
        .order('from_lat').order('from_lng').order('to_lat').order('to_lng').range(from, from + 999);
      if (hErr) throw hErr;
      for (const h of have ?? []) stored.add(key({ lat: h.from_lat, lng: h.from_lng }, { lat: h.to_lat, lng: h.to_lng }));
      if (!have || have.length < 1000) break;
    }

    // Origins with at least one missing leg, each against its missing destinations.
    const missing = new Map<string, { o: Spot; ds: Spot[] }>();
    for (const o of spots) for (const d of spots) {
      if (o === d || stored.has(key(o, d))) continue;
      const k = `${o.lat},${o.lng}`;
      if (!missing.has(k)) missing.set(k, { o, ds: [] });
      missing.get(k)!.ds.push(d);
    }
    const todo = [...missing.values()];
    let useLegacy = false, elements = 0, fetched = 0, noRoute = 0;
    const errors: string[] = [];

    const store = async (os: Spot[], ds: Spot[], res: any[], source: string) => {
      const now = new Date().toISOString();
      const rows = res.map(x => ({
        from_lat: os[x.o].lat, from_lng: os[x.o].lng, to_lat: ds[x.d].lat, to_lng: ds[x.d].lng,
        minutes: x.ok ? x.minutes : null, distance_km: x.ok ? x.km : null,
        status: String(x.status).slice(0, 60), source, fetched_at: now,
      })).filter(r => !(r.from_lat === r.to_lat && r.from_lng === r.to_lng));
      const { error: upErr } = await supabase.from('solver_drive_legs').upsert(rows, { onConflict: 'from_lat,from_lng,to_lat,to_lng' });
      if (upErr) throw upErr;
      elements += os.length * ds.length;
      fetched += rows.length; noRoute += rows.filter(r => r.minutes == null).length;
    };

    // One block of origins x destinations: Routes API, or legacy in 10 x 10
    // pieces once Routes has refused the key.
    const runBlock = async (os: Spot[], ds: Spot[]) => {
      if (!useLegacy) {
        try { return await store(os, ds, await routesMatrix(os, ds), 'routes'); }
        catch (e: any) {
          if (e.status !== 403 && e.status !== 400) throw e;
          useLegacy = true; console.log(`switched to Distance Matrix: ${e.message}`);
        }
      }
      for (const o10 of chunk(os, 10)) for (const d10 of chunk(ds, 10))
        await store(o10, d10, await legacyMatrix(o10, d10), 'distancematrix');
    };

    // Origins missing the same destinations share blocks, so one new spot
    // costs ~2N legs, not the whole grid again.
    const bySig = new Map<string, { os: Spot[]; ds: Spot[] }>();
    for (const g of todo) {
      const sig = g.ds.map(d => `${d.lat},${d.lng}`).sort().join(';');
      if (!bySig.has(sig)) bySig.set(sig, { os: [], ds: g.ds });
      bySig.get(sig)!.os.push(g.o);
    }
    outer: for (const { os: allOs, ds: allDs } of bySig.values()) {
      for (const origins of chunk(allOs, 25)) for (const dests of chunk(allDs, 25)) {
        if (elements + origins.length * dests.length > MAX_ELEMENTS_PER_CALL) { errors.push('element cap reached; call again'); break outer; }
        try { await runBlock(origins, dests); } catch (e: any) { errors.push(String(e?.message ?? e).slice(0, 300)); }
      }
    }

    return json({ ok: errors.length === 0, spots: spots.length, left_out: pts.length - spots.length,
                  already_stored: stored.size, fetched, no_route: noRoute, elements, api: useLegacy ? 'distancematrix' : 'routes', errors });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
