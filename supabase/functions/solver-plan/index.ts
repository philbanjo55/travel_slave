import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER PLANNER (v0.2)
// POST {trip_id, date?, trip_date?, hotel_stop_id?, multi?, days?, k?, beam?}
//   single day (default): plan `date` (a day in the latest score build).
//   multi: plan every day in the build (or `days: [{date, trip_date?}]`) as
//          one trip, so a subject shot on two days counts only its better day.
//   trip_date: plan the weather of `date` as if it were that trip day: its
//          hotel and its booked (time-locked) stops. Defaults to `date` when
//          the trip has a day on that date, else no bookings apply.
//
// Uses the latest score build (solver_scores: per stop, 15-min slot and ECMWF
// member, V x250), tier weights, drive minutes (solver_drive_matrix) and each
// stop's duration_minutes. Waiting for light is allowed.
//
//   visit value, per member k = tier weight x best V_k while you are there
//   plan value  = mean_k(total) + 0.5 x CVaR (mean of the worst 11 of 51)
//
// A subject (stops whose starred shots aim within 300 m of each other, or
// share a shot) counts once: repeats only add their improvement, within a
// day and across days. Booked stops are fixed visits at their time_label;
// free stops must still reach the next booking in time. Each day is a beam
// over partial routes from the hotel and back; multi-day combines the top
// routes of each day with a second beam. Writes solver_runs / solver_plans.
// Proposals only: nothing here writes to stops.

const TIER_W: Record<string, number> = { GOD: 10, S: 5, A: 2, B: 1, C: 1, D: 0.5, F: 0 };
const LAMBDA = 0.5;
const TAIL = 11;             // worst 11 of 51 members
const SLOT = 15;             // minutes
const MAX_WAIT_SLOTS = 16;   // 4 h
const DRIVE_PENALTY = 0.002; // tier points per driving minute: tie-break only
const SAME_SUBJECT_M = 300;
const DAY_POOL = 60;         // routes per day carried into the multi-day combine
const MULTI_BEAM = 150;

type PlanNode = { id: string; name: string; w: number; dur: number; group: number; free: boolean };
type Visit = { n: number; arrive: number; start: number; end: number; drive: number; anchor: boolean };
type State = {
  t: number; loc: number; next: number; visited: Uint8Array; m0: number; m1: number; groupBest: Map<number, Uint8Array>;
  total: Float32Array; route: Visit[]; drive: number; j: number; mean: number; cvar: number;
};
type DayPlan = { date: string; tripDate: string | null; hotel: number; dayStart: number; routes: State[]; anchors: number; ms: number };

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

// Wall-clock minutes in a zone on a local date -> UTC ms.
function zonedToUtc(date: string, minutes: number, tz: string) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60000;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return guess - (asLocal - guess);
}

// "5:50 AM" -> 350
function labelMinutes(label: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label ?? '').trim());
  if (!m) return null;
  let h = +m[1] % 12; if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + +m[2];
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const tripId: string = body.trip_id;
    if (!tripId) return json({ error: 'trip_id required' }, 400);
    const K = Math.min(Math.max(body.k ?? 5, 1), 10);
    const BEAM = Math.min(Math.max(body.beam ?? (body.multi || body.days ? 100 : 150), 10), 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const t0 = performance.now();

    const { data: build, error: bErr } = await db.from('solver_score_builds').select('id, built_at')
      .eq('trip_id', tripId).order('built_at', { ascending: false }).limit(1).maybeSingle();
    if (bErr) throw bErr;
    if (!build) return json({ ok: false, error: 'no score build for this trip' }, 404);
    // Timezone: trip setting, else what Open-Meteo reported for the trip's
    // stops (as solver_build_scores and trip_sun_plan do), else UTC.
    const { data: trip } = await db.from('trips').select('timezone').eq('id', tripId).single();
    let tz: string | undefined = body.tz ?? trip?.timezone ?? undefined;
    if (!tz) {
      const { data: tripStops } = await db.from('stops').select('id').eq('trip_id', tripId);
      const { data: wf } = await db.from('weather_forecasts').select('tz:raw->provenance->>timezone')
        .in('stop_id', (tripStops ?? []).map(s => s.id)).not('raw->provenance->>timezone', 'is', null)
        .order('fetched_at', { ascending: false }).limit(1);
      tz = (wf?.[0] as any)?.tz ?? 'UTC';
    }
    // One formatter, and each slot's local date worked out once: building
    // formatters per score row used up the 2 s CPU limit.
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const dateCache = new Map<string, string>();
    const slotDate = (slotAt: string) => {
      let d = dateCache.get(slotAt);
      if (d === undefined) { d = fmt.format(new Date(slotAt)); dateCache.set(slotAt, d); }
      return d;
    };

    const [inputs, scoresAll, stopsAll, accs, tripDays] = await Promise.all([
      all<any>((a, b) => db.from('solver_stop_inputs')
        .select('stop_id, name, tier, star_vantage_id, duration_minutes, time_locked, day_id')
        .eq('trip_id', tripId).range(a, b)),
      all<any>((a, b) => db.from('solver_scores').select('stop_id, slot_at, v').eq('build_id', build.id).order('slot_at').range(a, b)),
      all<any>((a, b) => db.from('stops').select('id, name, lat, lng, time_label, duration_minutes, day_id').eq('trip_id', tripId).range(a, b)),
      db.from('accommodations').select('name, lat, lng, check_in, check_out, nights').eq('trip_id', tripId).then(r => r.data ?? []),
      db.from('days').select('id, date').eq('trip_id', tripId).then(r => r.data ?? []),
    ]);
    const stopById = new Map(stopsAll.map(s => [s.id, s]));
    const scoresByDate = new Map<string, any[]>();
    for (const r of scoresAll) {
      const d = slotDate(r.slot_at);
      if (!scoresByDate.has(d)) scoresByDate.set(d, []);
      scoresByDate.get(d)!.push(r);
    }
    const dates = [...scoresByDate.keys()].sort();
    const dayInputs: { date: string; trip_date?: string }[] =
      body.days ?? (body.multi ? dates.map(d => ({ date: d })) : [{ date: body.date ?? dates[0], trip_date: body.trip_date }]);

    // Rated stops with a starred shot: the only ones that carry value.
    const rated = inputs.filter(r => (TIER_W[r.tier] ?? 0) > 0 && r.star_vantage_id);

    // Same-subject groups from the starred shots' aim points.
    const vIds = [...new Set(rated.map(c => c.star_vantage_id))];
    const { data: vants } = await db.from('scout_vantages').select('id, subject_id').in('id', vIds);
    const subjIds = [...new Set((vants ?? []).map(v => v.subject_id))];
    const { data: subjs } = await db.from('scout_subjects').select('id, lat, lng').in('id', subjIds);
    const aim = new Map<string, { lat: number; lng: number }>();
    for (const v of vants ?? []) { const s = (subjs ?? []).find(x => x.id === v.subject_id); if (s?.lat != null) aim.set(v.id, s); }
    const parent = rated.map((_, i) => i);
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let a = 0; a < rated.length; a++) for (let b = a + 1; b < rated.length; b++) {
      const pa = aim.get(rated[a].star_vantage_id), pb = aim.get(rated[b].star_vantage_id);
      if (rated[a].star_vantage_id === rated[b].star_vantage_id || (pa && pb && metersApart(pa, pb) <= SAME_SUBJECT_M)) parent[find(a)] = find(b);
    }
    const groupW = new Map<number, number>();
    rated.forEach((r, i) => groupW.set(find(i), Math.max(groupW.get(find(i)) ?? 0, TIER_W[r.tier])));

    // Hotel for a trip date: the accommodation covering it, else the longest
    // stay; mapped to a stop named after it (else the nearest stop).
    const hotelFor = (tripDate: string | null): string | undefined => {
      const covering = tripDate ? accs.find(a => a.check_in <= tripDate && tripDate < a.check_out) : undefined;
      const pick = covering ?? [...accs].sort((a, b) => (b.nights ?? 0) - (a.nights ?? 0))[0];
      if (pick?.lat == null) return undefined;
      const word = String(pick.name ?? '').split(/[ —,(]/)[0].toLowerCase();
      const near = stopsAll.filter(s => s.lat != null).sort((a, b) => metersApart(a, pick) - metersApart(b, pick));
      return (near.find(s => word.length > 2 && metersApart(s, pick) < 500 && s.name.toLowerCase().startsWith(word)) ?? near[0])?.id;
    };

    // Per-day setup: hotel, bookings, node list.
    const lockedInputs = inputs.filter(r => r.time_locked);
    const days = dayInputs.map(di => {
      const tripDate = di.trip_date ?? (tripDays.some(d => d.date === di.date) ? di.date : null);
      const hotelId: string | undefined = (dayInputs.length === 1 ? body.hotel_stop_id : undefined) ?? hotelFor(tripDate);
      const dayIds = new Set(tripDays.filter(d => d.date === tripDate).map(d => d.id));
      const anchors = lockedInputs
        .map(r => ({ r, s: stopById.get(r.stop_id), min: labelMinutes(stopById.get(r.stop_id)?.time_label) }))
        .filter(a => a.s && dayIds.has(a.s.day_id) && a.min != null && a.s.lat != null)
        .map(a => ({ id: a.r.stop_id, startMs: zonedToUtc(di.date, a.min!, tz), dur: a.s.duration_minutes ?? 15 }))
        .sort((a, b) => a.startMs - b.startMs);
      return { date: di.date, tripDate, hotelId, anchors };
    });
    if (days.some(d => !d.hotelId)) return json({ ok: false, error: 'no hotel: pass hotel_stop_id' }, 400);

    // Drive minutes between every stop any day can use.
    const ids = [...new Set([...rated.map(r => r.stop_id), ...days.flatMap(d => [d.hotelId!, ...d.anchors.map(a => a.id)])])];
    const dm = await all<any>((a, b) => db.from('solver_drive_matrix').select('from_stop_id, to_stop_id, minutes')
      .eq('trip_id', tripId).in('from_stop_id', ids).in('to_stop_id', ids).range(a, b));
    const pos = new Map(ids.map((id, i) => [id, i]));
    const D = Array.from({ length: ids.length }, () => new Float64Array(ids.length).fill(Infinity));
    for (let i = 0; i < ids.length; i++) D[i][i] = 0;
    for (const r of dm) if (r.minutes != null) D[pos.get(r.from_stop_id)!][pos.get(r.to_stop_id)!] = r.minutes;

    const ratedIdx = new Map(rated.map((r, i) => [r.stop_id, i]));
    const nodes: PlanNode[] = ids.map(id => {
      const ri = ratedIdx.get(id), r = ri != null ? rated[ri] : null, s = stopById.get(id);
      return {
        id, name: s?.name ?? id, w: r ? TIER_W[r.tier] : 0,
        dur: Math.max(r?.duration_minutes ?? s?.duration_minutes ?? 60, SLOT),
        group: ri != null ? find(ri) : -1 - (pos.get(id) ?? 0),
        free: !!r && !r.time_locked,
      };
    });
    const freeNodes = nodes.map((n, i) => (n.free ? i : -1)).filter(i => i >= 0);

    // One day: beam over partial routes from the hotel and back.
    const planDay = (day: typeof days[number]): DayPlan => {
      const td0 = performance.now();
      const H = pos.get(day.hotelId!)!;
      const anchors = day.anchors.map(a => ({ n: pos.get(a.id)!, startMs: a.startMs, dur: a.dur }));
      const scores = scoresByDate.get(day.date) ?? [];
      const slotMs = scores.map(r => Date.parse(r.slot_at));
      const first = Math.min(...slotMs, ...anchors.map(a => a.startMs)), last = Math.max(...slotMs, ...anchors.map(a => a.startMs + a.dur * 60000));
      const dayStart = Math.floor((first - 90 * 60000) / (SLOT * 60000)) * SLOT * 60000;
      const dayEnd = last + 60 * 60000;
      const nSlots = Math.ceil((dayEnd - dayStart) / (SLOT * 60000));
      const dayMin = (dayEnd - dayStart) / 60000;
      const M = scores[0]?.v.length ?? 51;

      // V per node per slot, W = best V over the visit window starting there.
      const V: (Uint8Array | null)[][] = nodes.map(() => new Array(nSlots).fill(null));
      for (const r of scores) {
        const ni = pos.get(r.stop_id); if (ni == null) continue;
        const ti = Math.round((Date.parse(r.slot_at) - dayStart) / (SLOT * 60000));
        if (ti >= 0 && ti < nSlots) V[ni][ti] = Uint8Array.from(r.v);
      }
      const wCache = new Map<number, Uint8Array | null>();
      const W = (ni: number, start: number): Uint8Array | null => {
        const key = ni * 10000 + start;
        if (wCache.has(key)) return wCache.get(key)!;
        const len = Math.ceil(nodes[ni].dur / SLOT);
        let best: Uint8Array | null = null;
        for (let t = start; t < Math.min(start + len, nSlots); t++) {
          const v = V[ni][t]; if (!v) continue;
          if (!best) best = Uint8Array.from(v); else for (let k = 0; k < M; k++) if (v[k] > best[k]) best[k] = v[k];
        }
        wCache.set(key, best);
        return best;
      };
      const wMean = (ni: number, start: number) => { const w = W(ni, start); if (!w) return -1; let s = 0; for (const x of w) s += x; return s / M; };
      const anchorSlot = anchors.map(a => Math.round((a.startMs - dayStart) / (SLOT * 60000)));

      const extend = (st: State, n: number, i: number, drive: number, anchor: boolean): State => {
        const len = Math.ceil(nodes[n].dur / SLOT);
        const w = nodes[n].w > 0 ? W(n, i) : null;
        const total = Float32Array.from(st.total);
        const groupBest = new Map(st.groupBest);
        if (w) {
          const g = nodes[n].group, prev = st.groupBest.get(g);
          for (let k = 0; k < M; k++) total[k] += nodes[n].w * (prev ? Math.max(0, w[k] - prev[k]) : w[k]) / 250;
          if (prev) { const nb = Uint8Array.from(prev); for (let k = 0; k < M; k++) if (w[k] > nb[k]) nb[k] = w[k]; groupBest.set(g, nb); }
          else groupBest.set(g, w);
        }
        const visited = Uint8Array.from(st.visited); visited[n] = 1;
        // Visited set as a 64-bit mask (two ints) for the dedupe key.
        const m0 = n < 32 ? (st.m0 | (1 << n)) >>> 0 : st.m0, m1 = n >= 32 ? (st.m1 | (1 << (n - 32))) >>> 0 : st.m1;
        const m = metric(total);
        const d = st.drive + drive;
        return {
          t: (i + len) * SLOT, loc: n, next: st.next + (anchor ? 1 : 0), visited, m0, m1, groupBest, total, drive: d,
          route: [...st.route, { n, arrive: st.t + drive, start: i * SLOT, end: (i + len) * SLOT, drive, anchor }],
          mean: m.mean, cvar: m.cvar, j: m.j - DRIVE_PENALTY * (d + D[n][H]),
        };
      };

      const root: State = { t: 0, loc: H, next: 0, visited: new Uint8Array(nodes.length), m0: 0, m1: 0, groupBest: new Map(),
        total: new Float32Array(M), route: [], drive: 0, j: 0, mean: 0, cvar: 0 };
      const pool: State[] = [];
      let beam: State[] = [root];
      while (beam.length) {
        const children = new Map<string, State>();
        const keep = (c: State) => {
          const key = nodes.length <= 64 ? `${c.m0},${c.m1},${c.loc}` : `${c.visited.join('')}|${c.loc}`;
          const have = children.get(key);
          if (!have || have.j < c.j || (have.j === c.j && have.t > c.t)) children.set(key, c);
        };
        for (const st of beam) {
          const nextA = st.next < anchors.length ? anchors[st.next] : null;
          const nextSlot = nextA ? anchorSlot[st.next] : Infinity;
          // The next booking, at its fixed time.
          if (nextA) {
            const drive = D[st.loc][nextA.n];
            if (Number.isFinite(drive) && st.t + drive <= nextSlot * SLOT) keep(extend(st, nextA.n, nextSlot, drive, true));
          }
          // A free stop, if it still leaves time for the next booking (or home).
          for (const s of freeNodes) {
            if (st.visited[s]) continue;
            const drive = D[st.loc][s], home = D[s][H];
            if (!Number.isFinite(drive) || !Number.isFinite(home)) continue;
            const len = Math.ceil(nodes[s].dur / SLOT);
            const i0 = Math.ceil((st.t + drive) / SLOT);
            let iMax = Math.floor((dayMin - home) / SLOT) - len;
            if (nextA) {
              const toA = D[s][nextA.n]; if (!Number.isFinite(toA)) continue;
              iMax = Math.min(iMax, Math.floor((nextSlot * SLOT - toA) / SLOT) - len);
            }
            if (i0 > iMax) continue;
            const opts = new Set<number>([i0]);
            let bWait = -1, bWaitI = -1, bDay = -1, bDayI = -1;
            for (let i = i0; i <= Math.min(iMax, nSlots - 1); i++) {
              const m = wMean(s, i);
              if (m > bDay) { bDay = m; bDayI = i; }
              if (i <= i0 + MAX_WAIT_SLOTS && m > bWait) { bWait = m; bWaitI = i; }
            }
            if (bWaitI >= 0) opts.add(bWaitI);
            if (bDayI >= 0) opts.add(bDayI);
            for (const i of opts) if (W(s, i)) keep(extend(st, s, i, drive, false));
          }
        }
        beam = [...children.values()].sort((a, b) => b.j - a.j).slice(0, BEAM);
        // Only routes that made every booking are plans.
        pool.push(...beam.filter(st => st.next === anchors.length && st.t + D[st.loc][H] <= dayMin));
      }
      if (!anchors.length) pool.push(root);
      pool.sort((a, b) => b.j - a.j);
      return { date: day.date, tripDate: day.tripDate, hotel: H, dayStart, routes: pool, anchors: anchors.length,
               ms: Math.round(performance.now() - td0) };
    };

    const planned = days.map(planDay);
    const missing = planned.filter(p => !p.routes.length);
    if (missing.length) return json({ ok: false, error: 'bookings cannot all be reached', days: missing.map(p => p.date) }, 422);

    const iso = (p: DayPlan, min: number) => new Date(p.dayStart + min * 60000).toISOString();
    const visitsOf = (p: DayPlan, st: State) => st.route.map(v => ({
      date: p.date, stop_id: nodes[v.n].id, name: nodes[v.n].name, booked: v.anchor,
      arrive: iso(p, v.arrive), start: iso(p, v.start), end: iso(p, v.end),
      wait_min: Math.round(v.start - v.arrive), drive_min: Math.round(v.drive),
    }));
    const subjectSet = (groupsByDay: Map<number, Uint8Array>[]) => new Set(groupsByDay.flatMap((g, d) => [...g.keys()].map(k => `${d}:${k}`)));
    // Tier-weighted Jaccard distance over "day:subject" keys, so swapping a
    // C-tier church barely counts and moving a GOD subject to another day does.
    const keyW = (k: string) => groupW.get(Number(k.split(':')[1])) ?? 0.5;
    const jaccardDist = (a: Set<string>, b: Set<string>) => {
      let inter = 0, uni = 0;
      for (const x of a) { const w = keyW(x); uni += w; if (b.has(x)) inter += w; }
      for (const x of b) if (!a.has(x)) uni += keyW(x);
      return uni ? 1 - inter / uni : 0;
    };

    type Combo = { picks: State[]; groups: Map<number, Uint8Array>; total: Float32Array; drive: number; j: number; mean: number; cvar: number };
    let combos: Combo[];
    if (planned.length === 1) {
      combos = planned[0].routes.map(st => ({ picks: [st], groups: st.groupBest, total: st.total, drive: st.drive, j: st.j, mean: st.mean, cvar: st.cvar }));
    } else {
      // Multi-day: a subject counts once, at its best day per member.
      const M = planned[0].routes[0].total.length;
      const totalOf = (groups: Map<number, Uint8Array>) => {
        const t = new Float32Array(M);
        for (const [g, w] of groups) { const wt = groupW.get(g) ?? 0; for (let k = 0; k < M; k++) t[k] += wt * w[k] / 250; }
        return t;
      };
      combos = [{ picks: [], groups: new Map(), total: new Float32Array(M), drive: 0, j: 0, mean: 0, cvar: 0 }];
      for (const p of planned) {
        const next: Combo[] = [];
        for (const c of combos) for (const st of p.routes.slice(0, DAY_POOL)) {
          const groups = new Map(c.groups);
          for (const [g, w] of st.groupBest) {
            const prev = groups.get(g);
            if (!prev) groups.set(g, w);
            else { const nb = Uint8Array.from(prev); for (let k = 0; k < M; k++) if (w[k] > nb[k]) nb[k] = w[k]; groups.set(g, nb); }
          }
          const total = totalOf(groups);
          const m = metric(total);
          const drive = c.drive + st.drive + D[st.loc][p.hotel];
          next.push({ picks: [...c.picks, st], groups, total, drive, mean: m.mean, cvar: m.cvar, j: m.j - DRIVE_PENALTY * drive });
        }
        combos = next.sort((a, b) => b.j - a.j).slice(0, MULTI_BEAM);
      }
    }

    // Top K distinct plans, plus the safest. Distinct: at least 40% of the
    // tier-weighted day-subjects differ for one day, 25% across several
    // (multi-day plans share most of their subjects).
    combos.sort((a, b) => b.j - a.j);
    const minDist = planned.length > 1 ? 0.25 : 0.4;
    const setOf = (c: Combo) => subjectSet(c.picks.map(st => st.groupBest));
    const picked: Combo[] = [];
    for (const c of combos) {
      if (picked.length >= K) break;
      const s = setOf(c);
      if (picked.every(p => jaccardDist(s, setOf(p)) >= minDist)) picked.push(c);
    }
    const safest = combos.reduce((a, b) => (b.cvar > a.cvar ? b : a), combos[0]);
    const safestAdded = !!safest && !picked.includes(safest);
    if (safestAdded) picked.push(safest);

    const plans = picked.map((c, r) => ({
      rank: r + 1,
      objective: Math.round(c.j * 1000) / 1000, mean: Math.round(c.mean * 1000) / 1000, cvar11: Math.round(c.cvar * 1000) / 1000,
      drive_minutes: Math.round(c.picks.reduce((s, st, d) => s + st.drive + D[st.loc][planned[d].hotel], 0)),
      note: safestAdded && c === safest ? 'safest: best worst-case' : null,
      visits: c.picks.flatMap((st, d) => visitsOf(planned[d], st)),
    }));

    const stats = {
      kind: planned.length > 1 ? 'multi' : 'day', members: combos[0]?.total.length,
      days: planned.map(p => ({ date: p.date, trip_date: p.tripDate, hotel: nodes[p.hotel].name, bookings: p.anchors, routes: p.routes.length, ms: p.ms })),
      candidates: freeNodes.length, ms: Math.round(performance.now() - t0), dates,
    };
    const { data: run, error: rErr } = await db.from('solver_runs').insert({
      trip_id: tripId, build_id: build.id, plan_date: planned[0].date, hotel_stop_id: nodes[planned[0].hotel].id,
      params: { k: K, beam: BEAM, lambda: LAMBDA, tail: TAIL, tz, days: dayInputs }, stats,
    }).select('id').single();
    if (rErr) throw rErr;
    if (plans.length) {
      const { error: pErr } = await db.from('solver_plans').insert(plans.map(p => ({ run_id: run.id, ...p })));
      if (pErr) throw pErr;
    }
    return json({ ok: true, run_id: run.id, stats, plans });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
