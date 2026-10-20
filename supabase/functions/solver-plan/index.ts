import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER DAY PLANNER (v0)
// POST {trip_id, date?, hotel_stop_id?, k?, beam?}
// Plans one day from the hotel and back over the trip's rated stops, using
// the latest score build (solver_scores: per stop, 15-min slot and ECMWF
// member, V x250), tier weights, drive minutes (solver_drive_matrix) and each
// stop's duration_minutes. Waiting for light is allowed.
//
//   visit value, per member k = tier weight x best V_k while you are there
//   plan value  = mean_k(total) + 0.5 x CVaR (mean of the worst 11 of 51)
//
// A subject shot twice in one day (stops whose starred shots aim within
// 300 m of each other, or share a shot) only counts the improvement. Search is
// a beam over partial routes; every partial route is a valid plan because
// the drive home is checked at each step. The top K distinct plans (stop-set
// Jaccard distance >= 0.34) are written to solver_runs / solver_plans.
// Time-locked stops are left out in v0 (they are booked, not planned).
// Proposals only: nothing here writes to stops.

const TIER_W: Record<string, number> = { GOD: 10, S: 5, A: 2, B: 1, C: 1, D: 0.5, F: 0 };
const LAMBDA = 0.5;
const TAIL = 11;           // worst 11 of 51 members
const SLOT = 15;           // minutes
const MAX_WAIT_SLOTS = 16; // 4 h
const DRIVE_PENALTY = 0.002; // tier points per driving minute: tie-break only
const SAME_SUBJECT_M = 300;

type Stop = { id: string; name: string; w: number; dur: number; star: string; group: number };
type State = {
  t: number; loc: number; visited: Uint8Array; total: Float32Array;
  groupBest: Map<number, Uint8Array>; route: Visit[]; drive: number; j: number; mean: number; cvar: number;
};
type Visit = { s: number; arrive: number; start: number; end: number; drive: number; gain: Float32Array };

function metric(total: Float32Array) {
  const n = total.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += total[i];
  const sorted = Float32Array.from(total).sort();
  const tail = Math.min(TAIL, n);
  let low = 0;
  for (let i = 0; i < tail; i++) low += sorted[i];
  const mean = sum / n, cvar = low / tail;
  return { mean, cvar, j: mean + LAMBDA * cvar };
}

function metersApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const tripId: string = body.trip_id;
    if (!tripId) return json({ error: 'trip_id required' }, 400);
    const K = Math.min(Math.max(body.k ?? 5, 1), 10);
    const BEAM = Math.min(Math.max(body.beam ?? 150, 10), 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const t0 = performance.now();

    const { data: build, error: bErr } = await db.from('solver_score_builds').select('id, built_at')
      .eq('trip_id', tripId).order('built_at', { ascending: false }).limit(1).maybeSingle();
    if (bErr) throw bErr;
    if (!build) return json({ ok: false, error: 'no score build for this trip' }, 404);

    const { data: trip } = await db.from('trips').select('timezone').eq('id', tripId).single();

    // Candidate stops: rated, not F, not time-locked, with a starred shot.
    const inputs = await all<any>((a, b) => db.from('solver_stop_inputs')
      .select('stop_id, name, tier, star_vantage_id, duration_minutes, time_locked')
      .eq('trip_id', tripId).not('tier', 'is', null).range(a, b));
    const cand = inputs.filter(r => (TIER_W[r.tier] ?? 0) > 0 && !r.time_locked && r.star_vantage_id);

    // Day: the requested local date, else the first date in the build.
    const scoresAll = await all<any>((a, b) => db.from('solver_scores').select('stop_id, slot_at, v')
      .eq('build_id', build.id).order('slot_at').range(a, b));
    const tz: string = body.tz ?? trip?.timezone ?? 'UTC';
    const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const dates = [...new Set(scoresAll.map(r => localDate(r.slot_at)))].sort();
    const date: string = body.date ?? dates[0];
    const scores = scoresAll.filter(r => localDate(r.slot_at) === date);
    if (!scores.length) return json({ ok: false, error: `no scores for ${date}`, dates }, 404);

    // Slot grid for the day: from 90 min before the first scored slot to 60 min after the last.
    const slotTimes = [...new Set(scores.map(r => Date.parse(r.slot_at)))].sort((a, b) => a - b);
    const dayStart = slotTimes[0] - 90 * 60000, dayEnd = slotTimes[slotTimes.length - 1] + 60 * 60000;
    const nSlots = Math.ceil((dayEnd - dayStart) / (SLOT * 60000));
    const idxOf = (ms: number) => Math.round((ms - dayStart) / (SLOT * 60000));

    // Hotel: requested stop, else the accommodation covering the date (or the
    // longest stay), mapped to the nearest stop so the drive grid applies.
    const { data: stopsAll } = await db.from('stops').select('id, name, lat, lng').eq('trip_id', tripId);
    let hotelId: string | undefined = body.hotel_stop_id;
    if (!hotelId) {
      const { data: acc } = await db.from('accommodations').select('name, lat, lng, check_in, check_out, nights').eq('trip_id', tripId);
      const covering = (acc ?? []).find(a => a.check_in <= date && date < a.check_out);
      const pick = covering ?? (acc ?? []).sort((a, b) => (b.nights ?? 0) - (a.nights ?? 0))[0];
      if (pick?.lat != null) {
        hotelId = (stopsAll ?? []).filter(s => s.lat != null)
          .sort((a, b) => metersApart(a, pick) - metersApart(b, pick))[0]?.id;
      }
    }
    if (!hotelId) return json({ ok: false, error: 'no hotel: pass hotel_stop_id' }, 400);

    // Same-subject groups from the starred shots' aim points.
    const vIds = [...new Set(cand.map(c => c.star_vantage_id))];
    const { data: vants } = await db.from('scout_vantages').select('id, subject_id').in('id', vIds);
    const subjIds = [...new Set((vants ?? []).map(v => v.subject_id))];
    const { data: subjs } = await db.from('scout_subjects').select('id, lat, lng').in('id', subjIds);
    const aim = new Map<string, { lat: number; lng: number }>();
    for (const v of vants ?? []) { const s = (subjs ?? []).find(x => x.id === v.subject_id); if (s?.lat != null) aim.set(v.id, s); }
    const parent = cand.map((_, i) => i);
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
      const pa = aim.get(cand[a].star_vantage_id), pb = aim.get(cand[b].star_vantage_id);
      const same = cand[a].star_vantage_id === cand[b].star_vantage_id || (pa && pb && metersApart(pa, pb) <= SAME_SUBJECT_M);
      if (same) parent[find(a)] = find(b);
    }

    const stops: Stop[] = cand.map((c, i) => ({
      id: c.stop_id, name: c.name, w: TIER_W[c.tier], dur: Math.max(c.duration_minutes ?? 60, SLOT),
      star: c.star_vantage_id, group: find(i),
    }));
    const N = stops.length, H = N; // index N = hotel
    const ids = [...stops.map(s => s.id), hotelId];

    // Drive minutes between candidates and the hotel.
    const dm = await all<any>((a, b) => db.from('solver_drive_matrix').select('from_stop_id, to_stop_id, minutes')
      .eq('trip_id', tripId).in('from_stop_id', ids).in('to_stop_id', ids).range(a, b));
    const pos = new Map(ids.map((id, i) => [id, i]));
    const D = Array.from({ length: N + 1 }, () => new Float64Array(N + 1).fill(Infinity));
    for (let i = 0; i <= N; i++) D[i][i] = 0;
    for (const r of dm) if (r.minutes != null) D[pos.get(r.from_stop_id)!][pos.get(r.to_stop_id)!] = r.minutes;

    // V per stop per slot (Uint8 per member), then W = best V over each
    // possible visit window [start, start + duration).
    const M = scores[0].v.length;
    const V: (Uint8Array | null)[][] = stops.map(() => new Array(nSlots).fill(null));
    const sIdx = new Map(stops.map((s, i) => [s.id, i]));
    for (const r of scores) {
      const si = sIdx.get(r.stop_id); if (si == null) continue;
      const ti = idxOf(Date.parse(r.slot_at)); if (ti < 0 || ti >= nSlots) continue;
      V[si][ti] = Uint8Array.from(r.v);
    }
    const W: (Uint8Array | null)[][] = stops.map((s, si) => {
      const len = Math.ceil(s.dur / SLOT);
      return Array.from({ length: nSlots }, (_, start) => {
        if (start + len > nSlots) return null;
        let best: Uint8Array | null = null;
        for (let t = start; t < start + len; t++) {
          const v = V[si][t]; if (!v) continue;
          if (!best) best = Uint8Array.from(v); else for (let k = 0; k < M; k++) if (v[k] > best[k]) best[k] = v[k];
        }
        return best;
      });
    });
    const wMean = W.map(row => row.map(w => { if (!w) return -1; let s = 0; for (const x of w) s += x; return s / w.length; }));

    // Beam search.
    const root: State = { t: 0, loc: H, visited: new Uint8Array(N), total: new Float32Array(M), groupBest: new Map(),
      route: [], drive: 0, j: 0, mean: 0, cvar: 0 };
    const pool: State[] = [];
    let beam: State[] = [root], expansions = 0;
    const lastSlot = nSlots - 1;
    while (beam.length) {
      const children = new Map<string, State>();
      for (const st of beam) {
        for (let s = 0; s < N; s++) {
          if (st.visited[s]) continue;
          const drive = D[st.loc][s]; if (!Number.isFinite(drive)) continue;
          const home = D[s][H]; if (!Number.isFinite(home)) continue;
          const len = Math.ceil(stops[s].dur / SLOT);
          const i0 = Math.ceil((st.t + drive) / SLOT);
          // Latest start that still leaves the visit and the drive home inside the day.
          const iMax = Math.floor(((dayEnd - dayStart) / 60000 - home) / SLOT) - len;
          if (i0 > iMax || i0 > lastSlot) continue;
          // Start options: earliest, best within 4 h of waiting, best of the day.
          const opts = new Set<number>([i0]);
          let bWait = -1, bWaitI = -1, bDay = -1, bDayI = -1;
          for (let i = i0; i <= Math.min(iMax, lastSlot); i++) {
            const m = wMean[s][i] ?? -1;
            if (m > bDay) { bDay = m; bDayI = i; }
            if (i <= i0 + MAX_WAIT_SLOTS && m > bWait) { bWait = m; bWaitI = i; }
          }
          if (bWaitI >= 0) opts.add(bWaitI);
          if (bDayI >= 0) opts.add(bDayI);
          for (const i of opts) {
            const w = W[s][i]; if (!w) continue;
            expansions++;
            const g = stops[s].group, prev = st.groupBest.get(g);
            const gain = new Float32Array(M), total = new Float32Array(M);
            for (let k = 0; k < M; k++) {
              const v = prev ? Math.max(0, w[k] - prev[k]) : w[k];
              gain[k] = stops[s].w * v / 250;
              total[k] = st.total[k] + gain[k];
            }
            const groupBest = new Map(st.groupBest);
            if (prev) { const nb = Uint8Array.from(prev); for (let k = 0; k < M; k++) if (w[k] > nb[k]) nb[k] = w[k]; groupBest.set(g, nb); }
            else groupBest.set(g, w);
            const visited = Uint8Array.from(st.visited); visited[s] = 1;
            const m = metric(total);
            const child: State = {
              t: (i + len) * SLOT, loc: s, visited, total, groupBest, drive: st.drive + drive,
              route: [...st.route, { s, arrive: st.t + drive, start: i * SLOT, end: (i + len) * SLOT, drive, gain }],
              mean: m.mean, cvar: m.cvar, j: m.j - DRIVE_PENALTY * (st.drive + drive + home),
            };
            const key = `${visited.join('')}|${s}`;
            const have = children.get(key);
            if (!have || have.j < child.j || (have.j === child.j && have.t > child.t)) children.set(key, child);
          }
        }
      }
      beam = [...children.values()].sort((a, b) => b.j - a.j).slice(0, BEAM);
      pool.push(...beam);
    }

    // Top K distinct plans by objective, plus the best worst-case plan.
    pool.sort((a, b) => b.j - a.j);
    const setOf = (st: State) => new Set(st.route.map(v => v.s));
    const jaccardDist = (a: Set<number>, b: Set<number>) => {
      let inter = 0; for (const x of a) if (b.has(x)) inter++;
      const uni = a.size + b.size - inter; return uni ? 1 - inter / uni : 0;
    };
    const picked: State[] = [];
    for (const st of pool) {
      if (picked.length >= K) break;
      const s = setOf(st);
      if (picked.every(p => jaccardDist(s, setOf(p)) >= 0.34)) picked.push(st);
    }
    const bestCvar = pool.reduce((a, b) => (b.cvar > a.cvar ? b : a), pool[0]);
    const notes = new Map<State, string>();
    if (bestCvar && !picked.includes(bestCvar)) { picked.push(bestCvar); notes.set(bestCvar, 'safest: best worst-case'); }

    const iso = (min: number) => new Date(dayStart + min * 60000).toISOString();
    const plans = picked.map((st, r) => ({
      rank: r + 1,
      objective: Math.round(st.j * 1000) / 1000, mean: Math.round(st.mean * 1000) / 1000, cvar11: Math.round(st.cvar * 1000) / 1000,
      drive_minutes: Math.round(st.drive + (st.route.length ? D[st.route[st.route.length - 1].s][H] : 0)),
      note: notes.get(st) ?? null,
      visits: st.route.map(v => {
        let gm = 0, good = 0; for (let k = 0; k < M; k++) { gm += v.gain[k]; }
        const w = W[v.s][v.start / SLOT]!; for (let k = 0; k < M; k++) if (w[k] >= 150) good++;
        return {
          stop_id: stops[v.s].id, name: stops[v.s].name, arrive: iso(v.arrive), start: iso(v.start), end: iso(v.end),
          wait_min: Math.round(v.start - v.arrive), drive_min: Math.round(v.drive),
          value_mean: Math.round(gm / M * 1000) / 1000, p_good: Math.round(good / M * 100) / 100,
        };
      }),
    }));

    const stats = { candidates: N, slots: nSlots, members: M, expansions, pool: pool.length,
                    ms: Math.round(performance.now() - t0), dates };
    const { data: run, error: rErr } = await db.from('solver_runs').insert({
      trip_id: tripId, build_id: build.id, plan_date: date, hotel_stop_id: hotelId,
      params: { k: K, beam: BEAM, lambda: LAMBDA, tail: TAIL, tz }, stats,
    }).select('id').single();
    if (rErr) throw rErr;
    if (plans.length) {
      const { error: pErr } = await db.from('solver_plans').insert(plans.map(p => ({ run_id: run.id, ...p })));
      if (pErr) throw pErr;
    }
    return json({ ok: true, run_id: run.id, date, hotel_stop_id: hotelId, stats, plans });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
