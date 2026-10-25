import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER REPLAY (test bench, backend only; Phil 25 Oct 2026)
// POST {day_id, config?: {name?, tier_w?, lambda?, drive_penalty?, long_leg_min?, long_leg_penalty?, beam?}}
//   or {run_id, kind}: one plan's next night of a whole-trip run (replay_runs), see below.
// Replays one past day (replay_days): plans the trip day `trip_date` on the
// weather of `replay_date` with the same day search as solver-plan (copied
// from solver-plan v16; keep the two in step), then scores every plan against
// what happened (the day's truth build, satellite sunshine):
//   forecast  = planner on the day-ahead forecast build (models as members)
//   light     = planner on light only (51 made-up sun scenarios, no forecast)
//   my_day    = the trip day's own stops at their time_labels
//   hindsight = planner on the truth itself: the best day possible
// realized = tier-weighted value against the truth, same subject and shot
// rules as the planner. Writes replay_results; never touches stops or solver_*.
//
// Whole-trip runs (Phil, 25 Oct 2026): the trip's days in order on past days
// start_date, start_date + 1, ... Each night the planner plans the next 3
// days (forecasts made 1, 2 and 3 days ahead), the first of them is done and
// scored against what happened, and what it got counts as already shot
// ("got", shot_value) from then on, as on the real trip. Plans per night:
//   fc3 = forecast, 3 days ahead     fc1 = forecast, tomorrow only
//   lt3 = light only, 3 days ahead   hs3 = the truth, 3 days ahead (ceiling)
//   my  = the trip day's own stops at their time_labels
// One request per plan and night (the edge CPU limit is 2 s); each plan's
// night and what it has shot live in replay_run_state. replay_run_tick moves
// the run to the next night once all five are done.

let TIER_W: Record<string, number> = { GOD: 10, S: 5, A: 2, B: 1, C: 1, D: 0.5, F: 0 };
let LAMBDA = 0.5;
const TAIL = 11;             // worst 11 of 51 members
const SLOT = 15;             // minutes
const MAX_WAIT_SLOTS = 16;   // 4 h
let DRIVE_PENALTY = 0.002; // tier points per driving minute: tie-break only
// Drives under an hour are fine for anything (Phil, 21 Oct 2026); minutes
// beyond 60 on one leg cost 1 tier point per hour (made up, adjustable).
let LONG_LEG_MIN = 60;
let LONG_LEG_PENALTY = 1 / 60;
const over = (leg: number) => Math.max(0, leg - LONG_LEG_MIN);
const SAME_SUBJECT_M = 300;
// ...and only from about the same place: the Grand Teton from Mormon Row and
// from Oxbow Bend are different photos (Phil, 21 Oct 2026).
const SAME_STAND_M = 1500;
const DAY_POOL = 60;         // routes per day carried into the multi-day combine
const MULTI_BEAM = 150;
const GOOD = 150;            // V >= 0.6 counts as a good shot (p_good)
// Day window, local time: leave the hotel no earlier, be back no later
// (made up from Phil's own days, 05:45-22:30). Booked stops override it.
// Body: earliest / latest as "HH:MM".
const EARLIEST = '05:00';
const LATEST = '23:30';
// Sunrise (Phil, 21 Oct 2026): a GOD or S stop may start from 03:45 on a
// forecast day when at least half the members give a good shot there. Not on
// light-only days: no forecast to say it's worth the alarm.
const SUNRISE_EARLIEST = '03:45';
const SUNRISE_MIN_P = 0.5;
// Multi-day: at least 6 h from back at the hotel to leaving again.
const REST_HOURS = 6;
// Light-only scenarios: sun visibility (k/50)^2, k = 0..50. Same expansion
// as SQL solver_light_scores; solver_light_terms gives dir/soft per slot.
const SCENARIOS = Array.from({ length: 51 }, (_, k) => (k / 50) ** 2);

type PlanNode = { id: string; name: string; w: number; dur: number; group: number; free: boolean };
type Visit = { n: number; arrive: number; start: number; end: number; drive: number; anchor: boolean };
type State = {
  t: number; loc: number; next: number; visited: Uint8Array; m0: number; m1: number; groupBest: Map<number, Uint8Array>;
  total: Float32Array; route: Visit[]; drive: number; over: number; j: number; mean: number; cvar: number;
};
type DayPlan = {
  date: string; tripDate: string | null; light: boolean; start: number; end: number; dayStart: number; nSlots: number;
  routes: State[]; anchors: number; ms: number; winLo: number; winHi: number;
  W: (n: number, slot: number) => Uint8Array | null;
  peak: (n: number, slot: number) => number;
};

function metric(total: Float32Array) {
  const n = total.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += total[i];
  const sorted = Float32Array.from(total).sort();
  const tail = Math.max(1, Math.min(n, Math.round(n * TAIL / 51)));
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

// "5:50 AM", "~5:50 PM", or 24-hour "05:50" / "17:50" -> minutes (350).
function labelMinutes(label: string | null): number | null {
  const m = /^~?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec((label ?? '').trim());
  if (!m || +m[2] > 59) return null;
  if (!m[3]) return +m[1] <= 23 ? +m[1] * 60 + +m[2] : null;
  let h = +m[1] % 12; if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + +m[2];
}

const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;
const DEFAULTS = { TIER_W: { ...TIER_W }, LAMBDA, DRIVE_PENALTY, LONG_LEG_MIN, LONG_LEG_PENALTY };

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let dayId: number | null = null, runId: number | null = null, kindOf: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    dayId = body.day_id ?? null;
    runId = body.run_id ?? null;
    kindOf = body.kind ?? null;
    // What to plan: one replay day, or the next nights of a whole-trip run.
    let run: any = null, tripId: string;
    let horizon: { i: number; date: string; trip_date: string; dayId: number; lead: number }[];
    if (runId != null) {
      run = (await db.from('replay_runs').select('*').eq('id', runId).single()).data;
      if (!run) return json({ ok: false, error: 'replay run not found' }, 404);
      tripId = run.trip_id;
      const n: number = run.night;
      const want = Array.from({ length: Math.min(3, run.nights - n) }, (_, h) => n + h)
        .map(i => ({ i, date: addDays(run.start_date, i), trip_date: run.trip_dates[i], lead: i - n + 1 }));
      const { data: rds } = await db.from('replay_days').select('id, replay_date').eq('trip_id', tripId).in('replay_date', want.map(w => w.date));
      horizon = want.map(w => ({ ...w, dayId: (rds ?? []).find(r => r.replay_date === w.date)?.id }));
      if (horizon.some(h => h.dayId == null)) return json({ ok: false, error: 'replay day missing' }, 404);
    } else {
      const { data: rd, error: rdErr } = await db.from('replay_days').select('id, trip_id, replay_date, trip_date').eq('id', dayId).single();
      if (rdErr || !rd) return json({ ok: false, error: 'replay day not found' }, 404);
      tripId = rd.trip_id;
      horizon = [{ i: 0, date: rd.replay_date, trip_date: rd.trip_date, dayId: rd.id, lead: 1 }];
    }
    const cfg = (run ? run.config : body.config) ?? {};
    const cfgName: string = cfg.name ?? 'base';
    // The isolate can serve several requests: start every call from the defaults.
    TIER_W = { ...DEFAULTS.TIER_W, ...(cfg.tier_w ?? {}) };
    LAMBDA = cfg.lambda ?? DEFAULTS.LAMBDA;
    DRIVE_PENALTY = cfg.drive_penalty ?? DEFAULTS.DRIVE_PENALTY;
    LONG_LEG_MIN = cfg.long_leg_min ?? DEFAULTS.LONG_LEG_MIN;
    LONG_LEG_PENALTY = cfg.long_leg_penalty ?? DEFAULTS.LONG_LEG_PENALTY;
    const BEAM = Math.min(Math.max(cfg.beam ?? 150, 10), 400);

    // Latest build per day: the forecast made `lead` days ahead, and the truth.
    // Run config (Faroes forecast tests, 25 Oct 2026): day1_lead 0 plans the
    // next day on the newest run (re-planning as the day goes); calsun reads
    // the build with each model's sun calibrated (stored as lead + 10).
    const leadOf = (l: number) => (l === 1 && cfg.day1_lead != null ? Number(cfg.day1_lead) : l) + (cfg.calsun ? 10 : 0);
    const { data: blds } = await db.from('replay_builds').select('id, replay_day_id, kind, lead, members')
      .in('replay_day_id', horizon.map(h => h.dayId)).order('created_at', { ascending: false });
    const fcB = horizon.map(h => (blds ?? []).find(b => b.replay_day_id === h.dayId && b.kind === 'forecast' && b.lead === leadOf(h.lead)));
    const trB = horizon.map(h => (blds ?? []).find(b => b.replay_day_id === h.dayId && b.kind === 'truth'));

    // A run's plan loads only what it plans on (and the truth of the day it does).
    const k0 = runId != null ? kindOf : null;
    const nFc = k0 == null ? horizon.length : k0 === 'fc3' ? horizon.length : k0 === 'fc1' ? 1 : 0;
    const nLt = k0 == null || k0 === 'lt3' ? horizon.length : 0;
    const nTr = k0 == null || k0 === 'hs3' ? horizon.length : 1;
    if (fcB.slice(0, nFc).some(b => !b) || trB.slice(0, nTr).some(b => !b)) return json({ ok: false, error: 'replay builds missing' }, 404);

    const { data: trip } = await db.from('trips').select('timezone').eq('id', tripId).single();
    const tz: string = trip?.timezone ?? 'UTC';
    // One row per stop (replay_scores_c): slot i = t0 + offs[i] x 15 min, v[i] = members.
    const scoresOf = (buildId: string) => all<any>((a, b) => db.from('replay_scores_c').select('stop_id, t0, offs, v')
      .eq('build_id', buildId).order('stop_id').range(a, b))
      .then(rows => rows.flatMap(r => {
        const t0 = Date.parse(r.t0);
        return (r.offs as number[]).map((o, i) => ({ stop_id: r.stop_id, slot_at: new Date(t0 + o * SLOT * 60000).toISOString(), v: r.v[i] }));
      }));
    const lightOf = (date: string) => all<any>((a, b) => db.rpc('solver_light_terms', { p_trip_id: tripId, p_dates: [date] }).order('slot_at').order('stop_id').range(a, b))
      .then(rows => rows.map(r => ({
        stop_id: r.stop_id, slot_at: r.slot_at,
        v: SCENARIOS.map(s => Math.round(250 * Math.max(0, Math.min(1,
          (r.blue ? r.dir : s * r.dir + (1 - s) * r.soft) * (r.fog_wanted ? 0.6 : 1))))),
      })));

    const [inputs, fcSc, trSc, ltSc, stopsAll, accs, tripDays] = await Promise.all([
      all<any>((a, b) => db.from('solver_stop_inputs')
        .select('stop_id, name, tier, star_vantage_id, duration_minutes, time_locked, day_id, shot_status, shot_value')
        .eq('trip_id', tripId).range(a, b)),
      Promise.all(fcB.slice(0, nFc).map(b => scoresOf(b!.id))), Promise.all(trB.slice(0, nTr).map(b => scoresOf(b!.id))),
      Promise.all(horizon.slice(0, nLt).map(h => lightOf(h.date))),
      all<any>((a, b) => db.from('stops').select('id, name, lat, lng, time_label, duration_minutes, drive_override_minutes, day_id, position, time_locked').eq('trip_id', tripId).range(a, b)),
      db.from('accommodations').select('name, lat, lng, check_in, check_out, nights').eq('trip_id', tripId).then(r => r.data ?? []),
      db.from('days').select('id, date').eq('trip_id', tripId).then(r => r.data ?? []),
    ]);
    if (fcSc.some(x => !x.length) || trSc.some(x => !x.length)) return json({ ok: false, error: 'empty replay builds' }, 404);
    // Shot status is about the real trip; a replay starts from nothing shot.
    for (const r of inputs) { r.shot_status = null; r.shot_value = null; }
    const specs = horizon.map(h => ({ date: h.date, trip_date: h.trip_date, light: false }));

    const stopById = new Map(stopsAll.map(s => [s.id, s]));

    // Rated stops with a starred shot: the only ones that carry value.
    const rated = inputs.filter(r => (TIER_W[r.tier] ?? 0) > 0 && r.star_vantage_id)
      .sort((a, b) => (a.stop_id < b.stop_id ? -1 : 1));

    // Same-subject groups from the starred shots' aim points.
    const vIds = [...new Set(rated.map(c => c.star_vantage_id))];
    const { data: vants } = await db.from('scout_vantages').select('id, subject_id, lat, lng').in('id', vIds);
    const subjIds = [...new Set((vants ?? []).map(v => v.subject_id))];
    const { data: subjs } = await db.from('scout_subjects').select('id, lat, lng').in('id', subjIds);
    const aim = new Map<string, { lat: number; lng: number }>();
    const stand = new Map<string, { lat: number; lng: number }>();
    for (const v of vants ?? []) {
      const s = (subjs ?? []).find(x => x.id === v.subject_id); if (s?.lat != null) aim.set(v.id, s);
      if (v.lat != null) stand.set(v.id, v);
    }
    const near = (a?: { lat: number; lng: number }, b?: { lat: number; lng: number }, m = 0) => !!a && !!b && metersApart(a, b) <= m;
    const parent = rated.map((_, i) => i);
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let a = 0; a < rated.length; a++) for (let b = a + 1; b < rated.length; b++) {
      const pa = aim.get(rated[a].star_vantage_id), pb = aim.get(rated[b].star_vantage_id);
      const va = rated[a].star_vantage_id, vb = rated[b].star_vantage_id;
      if (va === vb || (near(pa, pb, SAME_SUBJECT_M) && near(stand.get(va), stand.get(vb), SAME_STAND_M))) parent[find(a)] = find(b);
    }
    const groupW = new Map<number, number>();
    rated.forEach((r, i) => groupW.set(find(i), Math.max(groupW.get(find(i)) ?? 0, TIER_W[r.tier])));
    // What a subject already has (x250): nailed = everything, got = shot_value.
    let groupBase = new Map<number, number>();
    rated.forEach((r, i) => {
      const b = r.shot_status === 'nailed' ? 250 : r.shot_status === 'got' ? Math.round(250 * (r.shot_value ?? 0.5)) : 0;
      if (b > 0) groupBase.set(find(i), Math.max(groupBase.get(find(i)) ?? 0, b));
    });

    // Accommodation -> a stop named after it (else the nearest stop).
    const accStop = (acc: any): string | undefined => {
      if (acc?.lat == null) return undefined;
      const word = String(acc.name ?? '').split(/[ —,(]/)[0].toLowerCase();
      const near = stopsAll.filter(s => s.lat != null).sort((a, b) => metersApart(a, acc) - metersApart(b, acc));
      return (near.find(s => word.length > 2 && metersApart(s, acc) < 500 && s.name.toLowerCase().startsWith(word)) ?? near[0])?.id;
    };
    const accOn = (night: string) => accs.find(a => a.check_in <= night && night < a.check_out);
    const longest = [...accs].sort((a, b) => (b.nights ?? 0) - (a.nights ?? 0))[0];
    // Start: where Phil slept the night before. End: where Phil sleeps tonight
    // (last day: the last night's place). Unknown trip day: the longest stay.
    const hotelsFor = (tripDate: string | null) => {
      const before = tripDate ? accOn(dayBefore(tripDate)) : undefined;
      const tonight = (tripDate ? accOn(tripDate) : undefined) ?? before ?? longest;
      return { start: accStop(before ?? tonight), end: accStop(tonight) };
    };

    // Per-day setup: hotels, bookings, own stops.
    const lockedInputs = inputs.filter(r => r.time_locked);
    const days = specs.map(sp => {
      const tripDate = sp.trip_date ?? (tripDays.some(d => d.date === sp.date) ? sp.date : null);
      const h = hotelsFor(tripDate);
      const override: string | undefined = undefined;
      const dayIds = new Set(tripDays.filter(d => d.date === tripDate).map(d => d.id));
      const anchors = lockedInputs
        .map(r => ({ r, s: stopById.get(r.stop_id), min: labelMinutes(stopById.get(r.stop_id)?.time_label) }))
        .filter(a => a.s && dayIds.has(a.s.day_id) && a.min != null && a.s.lat != null)
        .map(a => ({ id: a.r.stop_id, startMs: zonedToUtc(sp.date, a.min!, tz), dur: a.s.duration_minutes ?? 15 }))
        .sort((a, b) => a.startMs - b.startMs);
      const own = stopsAll.filter(s => dayIds.has(s.day_id)).sort((a, b) => a.position - b.position);
      // Travel days: a booked arrival opens the day, a booked departure at the
      // end closes it (the live planner only knows rated bookings).
      const lockedMin = (re: RegExp) => own.filter(s => s.time_locked && re.test(s.name)).map(s => labelMinutes(s.time_label)).filter(m => m != null) as number[];
      const arrive = lockedMin(/arriv/i), depart = own.length && own[own.length - 1].time_locked && /depart/i.test(own[own.length - 1].name) ? lockedMin(/depart/i) : [];
      const earliestMin = arrive.length ? Math.max(...arrive) : null, latestMin = depart.length ? Math.min(...depart) : null;
      return { date: sp.date, light: sp.light, tripDate, startId: override ?? h.start, endId: override ?? h.end, anchors, own, earliestMin, latestMin };
    });
    if (days.some(d => !d.startId || !d.endId)) return json({ ok: false, error: 'no hotel: pass hotel_stop_id' }, 400);
    // Drive minutes between every stop any day can use.
    const ids = [...new Set([...rated.map(r => r.stop_id), ...days.flatMap(d => [d.startId!, d.endId!, ...d.anchors.map(a => a.id)])])];
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
        free: !!r && !r.time_locked && r.shot_status !== 'nailed',
      };
    });
    const freeNodes = nodes.map((n, i) => (n.free ? i : -1)).filter(i => i >= 0);

    // Value of seeing subject g at w after prev, over what is already shot.
    const gain = (g: number, w: number, prev: number | undefined) => Math.max(0, w - Math.max(prev ?? 0, groupBase.get(g) ?? 0));

    // One day: beam over partial routes from the morning hotel to the night's.
    // search = false: only the day's values (W), no routes (scoring against the truth).
    const planDay = (day: typeof days[number], scores: any[], search = true): DayPlan => {
      const td0 = performance.now();
      const H0 = pos.get(day.startId!)!, H = pos.get(day.endId!)!;
      const anchors = day.anchors.map(a => ({ n: pos.get(a.id)!, startMs: a.startMs, dur: a.dur }));
      const slotMs = scores.map(r => Date.parse(r.slot_at));
      // From 90 min before the first light (else the window opens), to an
      // hour after the last (else it closes); bookings always fit.
      const winStart = zonedToUtc(day.date, day.earliestMin ?? hhmm(EARLIEST), tz!), winEnd = zonedToUtc(day.date, day.latestMin ?? hhmm(LATEST), tz!);
      const earlyStart = day.light || day.earliestMin != null ? winStart : zonedToUtc(day.date, hhmm(SUNRISE_EARLIEST), tz!);
      const first = Math.min(Math.max(Math.min(...slotMs) - 90 * 60000, earlyStart), ...anchors.map(a => a.startMs - 90 * 60000));
      const last = Math.max(Math.min(Math.max(...slotMs) + 60 * 60000, winEnd), ...anchors.map(a => a.startMs + (a.dur + 60) * 60000));
      const dayStart = Math.floor(first / (SLOT * 60000)) * SLOT * 60000;
      const dayEnd = last;
      const nSlots = Math.ceil((dayEnd - dayStart) / (SLOT * 60000));
      const dayMin = (dayEnd - dayStart) / 60000;
      // Free stops stay inside the window even when a booking stretches the day.
      const winLo = Math.max(0, Math.ceil((winStart - dayStart) / (SLOT * 60000)));
      const earlyLo = Math.max(0, Math.ceil((earlyStart - dayStart) / (SLOT * 60000)));
      const winMin = Math.min(dayMin, (winEnd - dayStart) / 60000);
      const winHi = Math.floor(winMin / SLOT);
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
        if (start < 0 || start >= nSlots) return null;
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
      const pGood = (ni: number, start: number) => { const w = W(ni, start); if (!w) return 0; let g = 0; for (const x of w) if (x >= GOOD) g++; return g / M; };
      // Before the window only GOD/S stops, and only when the forecast is good.
      const startOk = (ni: number, i: number) => i >= winLo || (nodes[ni].w >= 5 && i >= earlyLo && pGood(ni, i) >= SUNRISE_MIN_P);
      // The slot in a visit window with the best mean V: when to shoot.
      const peak = (ni: number, start: number) => {
        let bt = start, bs = -1;
        for (let t = Math.max(start, 0); t < Math.min(start + Math.ceil(nodes[ni].dur / SLOT), nSlots); t++) {
          const v = V[ni][t]; if (!v) continue;
          let s = 0; for (const x of v) s += x;
          if (s > bs) { bs = s; bt = t; }
        }
        return bt;
      };
      const anchorSlot = anchors.map(a => Math.round((a.startMs - dayStart) / (SLOT * 60000)));

      const extend = (st: State, n: number, i: number, drive: number, anchor: boolean): State => {
        const len = Math.ceil(nodes[n].dur / SLOT);
        const w = nodes[n].w > 0 ? W(n, i) : null;
        const total = Float32Array.from(st.total);
        const groupBest = new Map(st.groupBest);
        if (w) {
          const g = nodes[n].group, prev = st.groupBest.get(g);
          for (let k = 0; k < M; k++) total[k] += nodes[n].w * gain(g, w[k], prev?.[k]) / 250;
          if (prev) { const nb = Uint8Array.from(prev); for (let k = 0; k < M; k++) if (w[k] > nb[k]) nb[k] = w[k]; groupBest.set(g, nb); }
          else groupBest.set(g, w);
        }
        const visited = Uint8Array.from(st.visited); visited[n] = 1;
        // Visited set as a 64-bit mask (two ints) for the dedupe key.
        const m0 = n < 32 ? (st.m0 | (1 << n)) >>> 0 : st.m0, m1 = n >= 32 ? (st.m1 | (1 << (n - 32))) >>> 0 : st.m1;
        const m = metric(total);
        const d = st.drive + drive, o = st.over + over(drive);
        return {
          t: (i + len) * SLOT, loc: n, next: st.next + (anchor ? 1 : 0), visited, m0, m1, groupBest, total, drive: d, over: o,
          route: [...st.route, { n, arrive: st.t + drive, start: i * SLOT, end: (i + len) * SLOT, drive, anchor }],
          mean: m.mean, cvar: m.cvar, j: m.j - DRIVE_PENALTY * (d + D[n][H]) - LONG_LEG_PENALTY * (o + over(D[n][H])),
        };
      };

      const root: State = { t: 0, loc: H0, next: 0, visited: new Uint8Array(nodes.length), m0: 0, m1: 0, groupBest: new Map(),
        total: new Float32Array(M), route: [], drive: 0, over: 0,
        j: -DRIVE_PENALTY * D[H0][H] - LONG_LEG_PENALTY * over(D[H0][H]), mean: 0, cvar: 0 };
      const pool: State[] = [];
      let beam: State[] = search ? [root] : [];
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
          // A free stop, if it still leaves time for the next booking (or the night's hotel).
          for (const s of freeNodes) {
            if (st.visited[s]) continue;
            const drive = D[st.loc][s], home = D[s][H];
            if (!Number.isFinite(drive) || !Number.isFinite(home)) continue;
            const len = Math.ceil(nodes[s].dur / SLOT);
            const i0 = Math.max(Math.ceil((st.t + drive) / SLOT), nodes[s].w >= 5 ? earlyLo : winLo);
            let iMax = Math.floor((winMin - home) / SLOT) - len;
            if (nextA) {
              const toA = D[s][nextA.n]; if (!Number.isFinite(toA)) continue;
              iMax = Math.min(iMax, Math.floor((nextSlot * SLOT - toA) / SLOT) - len);
            }
            if (i0 > iMax) continue;
            const opts = new Set<number>([i0]);
            let bWait = -1, bWaitI = -1, bDay = -1, bDayI = -1;
            for (let i = i0; i <= Math.min(iMax, nSlots - 1); i++) {
              if (i < winLo && !startOk(s, i)) continue;
              const m = wMean(s, i);
              if (m > bDay) { bDay = m; bDayI = i; }
              if (i <= i0 + MAX_WAIT_SLOTS && m > bWait) { bWait = m; bWaitI = i; }
            }
            if (bWaitI >= 0) opts.add(bWaitI);
            if (bDayI >= 0) opts.add(bDayI);
            for (const i of opts) if (W(s, i) && startOk(s, i)) keep(extend(st, s, i, drive, false));
          }
        }
        beam = [...children.values()].sort((a, b) => b.j - a.j).slice(0, BEAM);
        // Only routes that made every booking are plans.
        pool.push(...beam.filter(st => st.next === anchors.length && st.t + D[st.loc][H] <= dayMin));
      }
      if (!anchors.length) pool.push(root);
      pool.sort((a, b) => b.j - a.j);
      return { date: day.date, tripDate: day.tripDate, light: day.light, start: H0, end: H, dayStart, nSlots, routes: pool,
               anchors: anchors.length, ms: Math.round(performance.now() - td0), winLo, winHi, W, peak };
    };

    const iso = (p: DayPlan, min: number) => new Date(p.dayStart + min * 60000).toISOString();
    // Chance for a visit starting at a slot: mean V and share of members
    // with a good shot (best moment of the visit), and when that moment is.
    const chance = (p: DayPlan, n: number, slot: number) => {
      if (nodes[n].w <= 0) return null;
      const w = p.W(n, slot); if (!w) return null;
      let s = 0, g = 0;
      for (const x of w) { s += x; if (x >= GOOD) g++; }
      return { value: r2(s / w.length / 250), p_good: r2(g / w.length), peak_at: iso(p, p.peak(n, slot) * SLOT) };
    };
    const visitsOf = (p: DayPlan, st: State) => st.route.map(v => ({
      date: p.date, trip_date: p.tripDate, stop_id: nodes[v.n].id, name: nodes[v.n].name, booked: v.anchor,
      arrive: iso(p, v.arrive), start: iso(p, v.start), end: iso(p, v.end),
      wait_min: Math.round(v.start - v.arrive), drive_min: Math.round(v.drive),
      ...chance(p, v.n, Math.round(v.start / SLOT)),
    }));

    // Value of a route against the truth (plan `tp`, one member): tier x truth
    // V at the visit, a subject counted once (only its improvement over what
    // is already shot), as the planner counts.
    const truthAt = (tp: DayPlan, v: { n: number; startMs: number }) =>
      tp.W(v.n, Math.round((v.startMs - tp.dayStart) / (SLOT * 60000)))?.[0] ?? 0;
    const evalVisits = (tp: DayPlan, visits: { n: number; startMs: number }[]) => {
      const best = new Map<number, number>();
      let total = 0;
      for (const v of visits) {
        if (nodes[v.n].w <= 0) continue;
        const w = truthAt(tp, v);
        const g = nodes[v.n].group, prev = best.get(g);
        total += nodes[v.n].w * gain(g, w, prev) / 250;
        best.set(g, Math.max(prev ?? 0, w));
      }
      return total;
    };
    const routeOf = (p: DayPlan, st: State) => st.route.map(v => ({ n: v.n, startMs: p.dayStart + v.start * 60000 }));
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    // The trip day's own rated stops at their time_labels.
    const ownOf = (d: typeof days[number]) => d.own.map(s => ({ s, n: pos.get(s.id), min: labelMinutes(s.time_label) }))
      .filter(o => o.n != null && o.min != null);

    // Several days together (copied from solver-plan): each day's top routes,
    // a subject counted once at its best day per member, >= 6 h rest between
    // back at the hotel and leaving again, at most 3 combos per backbone.
    const combineBest = (planned: DayPlan[]): State[] | null => {
      if (planned.some(p => !p.routes.length)) return null;
      if (planned.length === 1) return [planned[0].routes[0]];
      const M = planned[0].routes[0].total.length;
      const totalOf = (groups: Map<number, Uint8Array>) => {
        const t = new Float32Array(M);
        for (const [g, w] of groups) { const wt = groupW.get(g) ?? 0; for (let k = 0; k < M; k++) t[k] += wt * gain(g, w[k], undefined) / 250; }
        return t;
      };
      const mergeInto = (groups: Map<number, Uint8Array>, add: Map<number, Uint8Array>) => {
        for (const [g, w] of add) {
          const prev = groups.get(g);
          if (!prev) groups.set(g, w);
          else { const nb = Uint8Array.from(prev); for (let k = 0; k < M; k++) if (w[k] > nb[k]) nb[k] = w[k]; groups.set(g, nb); }
        }
      };
      type Combo = { picks: State[]; groups: Map<number, Uint8Array>; drive: number; over: number; j: number; back: number | null; date: string | null };
      const homeLeg = (st: State, p: DayPlan) => D[st.loc][p.end];
      const departMs = (p: DayPlan, st: State) => st.route.length ? p.dayStart + (st.route[0].start - st.route[0].drive) * 60000 : null;
      const backMs = (p: DayPlan, st: State) => st.route.length ? p.dayStart + (st.t + homeLeg(st, p)) * 60000 : null;
      const backbone = (st: State) => [...st.groupBest.keys()].filter(g => (groupW.get(g) ?? 0) >= 5).sort((a, b) => a - b).join('.');
      const dayPool = (routes: State[]) => {
        const seen = new Map<string, number>(), out: State[] = [];
        for (const st of routes) {
          const key = backbone(st), n = seen.get(key) ?? 0;
          if (n >= 4) continue;
          seen.set(key, n + 1); out.push(st);
          if (out.length >= DAY_POOL) break;
        }
        return out;
      };
      let combos: Combo[] = [{ picks: [], groups: new Map(), drive: 0, over: 0, j: 0, back: null, date: null }];
      for (const p of planned) {
        const pool = dayPool(p.routes);
        const day = p.tripDate ?? p.date;
        const combine = (rest: boolean) => {
          const out: Combo[] = [];
          for (const c of combos) for (const st of pool) {
            const dep = departMs(p, st);
            if (rest && c.back != null && dep != null && c.date === dayBefore(day) && dep - c.back < REST_HOURS * 3600000) continue;
            const groups = new Map(c.groups);
            mergeInto(groups, st.groupBest);
            const m = metric(totalOf(groups));
            const drive = c.drive + st.drive + homeLeg(st, p), o = c.over + st.over + over(homeLeg(st, p));
            out.push({ picks: [...c.picks, st], groups, drive, over: o, j: m.j - DRIVE_PENALTY * drive - LONG_LEG_PENALTY * o, back: backMs(p, st), date: day });
          }
          return out;
        };
        let next = combine(true);
        if (!next.length) next = combine(false);
        next.sort((a, b) => b.j - a.j);
        const perBackbone = new Map<string, number>();
        combos = [];
        for (const c of next) {
          const key = c.picks.map(backbone).join('|'), n = perBackbone.get(key) ?? 0;
          if (n >= 3) continue;
          perBackbone.set(key, n + 1);
          combos.push(c);
          if (combos.length >= MULTI_BEAM) break;
        }
      }
      return combos.length ? combos[0].picks : null;
    };

    if (run) {
      // ---- One plan's night of a whole-trip run ----
      const kind: string = body.kind;
      const { data: ks } = await db.from('replay_run_state').select('night, state').eq('run_id', runId).eq('kind', kind).single();
      if (!ks) return json({ ok: false, error: 'no state for this plan' }, 404);
      const n: number = run.night;
      if (ks.night !== n) {
        await db.from('replay_run_state').update({ status: 'idle', updated_at: new Date().toISOString() }).eq('run_id', runId).eq('kind', kind);
        return json({ ok: true, skipped: 'already planned', run_id: runId, kind, night: ks.night });
      }
      const shotBefore: Record<string, number> = ks.state ?? {};
      // What a plan has shot, by group (key: the group's first stop id).
      const keyOf = (g: number) => rated[g].stop_id;
      const groupOfKey = new Map(rated.map((r, i) => [r.stop_id, find(i)]));
      groupBase = new Map<number, number>();
      for (const [k, v] of Object.entries(shotBefore)) {
        const g = groupOfKey.get(k); if (g != null) groupBase.set(g, Math.max(groupBase.get(g) ?? 0, v));
      }
      // What happened on the day being done.
      const truthN = planDay({ ...days[0], light: false }, trSc[0], false);
      let row: any;
      const record = (visits: { n: number; startMs: number }[], extra: any) => {
        const realized = evalVisits(truthN, visits);
        const shot = { ...shotBefore };
        for (const v of visits) {
          if (nodes[v.n].w <= 0) continue;
          const k = keyOf(nodes[v.n].group);
          shot[k] = Math.max(shot[k] ?? 0, truthAt(truthN, v));
        }
        row = { run_id: runId, night: n, kind, replay_date: days[0].date, trip_date: days[0].tripDate, realized: r3(realized), ...extra };
        return shot;
      };
      const plan = (nDays: number, scoresFor: (h: number) => any[], light: boolean, members: number) => {
        const planned = days.slice(0, nDays).map((d, h) => planDay({ ...d, light }, scoresFor(h)));
        // A later day with no route (a booking out of reach) still leaves tomorrow's best.
        const st = (combineBest(planned) ?? (planned[0].routes.length ? [planned[0].routes[0]] : null))?.[0] ?? null, p0 = planned[0];
        return record(st ? routeOf(p0, st) : [], {
          predicted: st ? r3(st.mean) : null, drive_minutes: st ? Math.round(st.drive) : null, visits: st ? visitsOf(p0, st) : [],
          stats: { members, horizon: nDays, ms: planned.reduce((t, p) => t + p.ms, 0), ...(st ? {} : { error: 'no route' }) },
        });
      };
      let shot: Record<string, number>;
      if (kind === 'fc3') shot = plan(days.length, h => fcSc[h], false, fcB[0]!.members);
      else if (kind === 'fc1') shot = plan(1, h => fcSc[h], false, fcB[0]!.members);
      else if (kind === 'lt3') shot = plan(days.length, h => ltSc[h], true, 51);
      else if (kind === 'hs3') shot = plan(days.length, h => trSc[h], false, 1);
      else if (kind === 'my') {
        const own = ownOf(days[0]);
        shot = record(own.map(o => ({ n: o.n!, startMs: zonedToUtc(days[0].date, o.min!, tz) })), {
          drive_minutes: days[0].own.reduce((t: number, s: any) => t + (s.drive_override_minutes ?? 0), 0),
          visits: own.map(o => ({ stop_id: o.s.id, name: o.s.name, start: new Date(zonedToUtc(days[0].date, o.min!, tz)).toISOString(), rated: nodes[o.n!].w > 0 })),
          stats: { own_stops: days[0].own.length, rated: own.filter(o => nodes[o.n!].w > 0).length },
        });
      } else return json({ ok: false, error: `unknown plan ${kind}` }, 400);
      const { error: rErr } = await db.from('replay_run_days').upsert(row, { onConflict: 'run_id,night,kind' });
      if (rErr) throw rErr;
      await db.from('replay_run_state').update({ night: n + 1, state: shot, status: 'idle', note: null, updated_at: new Date().toISOString() })
        .eq('run_id', runId).eq('kind', kind);
      return json({ ok: true, run_id: runId, kind, night: n, realized: row.realized, predicted: row.predicted });
    }

    // ---- One replay day ----
    const fcScores = fcSc[0], trScores = trSc[0], lightScores = ltSc[0], fcBuild = fcB[0]!;
    const day = days[0];
    const fc = planDay({ ...day, light: false }, fcScores);
    const lt = planDay({ ...day, light: true }, lightScores);
    const hs = planDay({ ...day, light: false }, trScores);
    const rows: any[] = [];
    const add = (plan: string, p: DayPlan | null, st: State | null, extra: any = {}) => {
      if (!p || !st) { rows.push({ replay_day_id: dayId, config: cfgName, plan, predicted: null, realized: null, stats: { error: 'no route' } }); return; }
      rows.push({
        replay_day_id: dayId, config: cfgName, plan, predicted: Math.round(st.mean * 1000) / 1000,
        realized: Math.round(evalVisits(hs, routeOf(p, st)) * 1000) / 1000, drive_minutes: Math.round(st.drive),
        visits: visitsOf(p, st), stats: { members: p === lt ? 51 : (p === hs ? 1 : fcBuild.members), ms: p.ms, routes: p.routes.length, ...extra },
      });
    };
    add('forecast', fc, fc.routes[0] ?? null);
    add('light', lt, lt.routes[0] ?? null);
    add('hindsight', hs, hs.routes[0] ?? null);

    // My day: the trip day's own rated stops at their time_labels.
    const own = ownOf(day);
    const ownVisits = own.map(o => ({ n: o.n!, startMs: zonedToUtc(day.date, o.min!, tz) }));
    const fcIdx = (ms: number) => Math.round((ms - fc.dayStart) / (SLOT * 60000));
    let predicted = 0;
    {
      const best = new Map<number, Uint8Array>();
      const M = fcBuild.members ?? 1;
      const tot = new Float32Array(M);
      for (const v of ownVisits) {
        if (nodes[v.n].w <= 0) continue;
        const w = fc.W(v.n, fcIdx(v.startMs)); if (!w) continue;
        const g = nodes[v.n].group, prev = best.get(g);
        for (let k = 0; k < M; k++) tot[k] += nodes[v.n].w * gain(g, w[k], prev?.[k]) / 250;
        best.set(g, prev ? Uint8Array.from(prev, (x, k) => Math.max(x, w[k])) : w);
      }
      predicted = metric(tot).mean;
    }
    rows.push({
      replay_day_id: dayId, config: cfgName, plan: 'my_day', predicted: Math.round(predicted * 1000) / 1000,
      realized: Math.round(evalVisits(hs, ownVisits) * 1000) / 1000,
      drive_minutes: day.own.reduce((t: number, s: any) => t + (s.drive_override_minutes ?? 0), 0),
      visits: own.map(o => ({ stop_id: o.s.id, name: o.s.name, start: new Date(zonedToUtc(day.date, o.min!, tz)).toISOString(), rated: nodes[o.n!].w > 0 })),
      stats: { own_stops: day.own.length, rated: own.filter(o => nodes[o.n!].w > 0).length, earliest: day.earliestMin, latest: day.latestMin },
    });

    const { error: wErr } = await db.from('replay_results').upsert(rows, { onConflict: 'replay_day_id,config,plan' });
    if (wErr) throw wErr;
    await db.from('replay_days').update({ status: 'done', note: null, updated_at: new Date().toISOString() }).eq('id', dayId);
    return json({ ok: true, day_id: dayId, config: cfgName, results: rows.map(r => ({ plan: r.plan, predicted: r.predicted, realized: r.realized, drive: r.drive_minutes })) });
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    if (runId != null) await db.from('replay_run_state').update({ status: 'error', note: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('run_id', runId).eq('kind', kindOf);
    else if (dayId != null) await db.from('replay_days').update({ status: 'error', note: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', dayId);
    return json({ ok: false, error: msg }, 500);
  }
});
