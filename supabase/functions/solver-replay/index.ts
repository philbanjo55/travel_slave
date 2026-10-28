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
//   blk = improve my week, day blocks: the trip's remaining days with Phil's
//         stops on them, whole days swapped between dates and each day put in
//         order (solver-plan v20 improve 'blocks'); forecast 1-3 days ahead,
//         light only beyond; tomorrow is done, the rest carry to the next night
//   imp = improve my week, free: also single stops (or keep-together groups)
//         moved between days (solver-plan improve 'free')
//   mc1 = fm1 plus a Monte Carlo choice between candidate plans for
//         tomorrow, each scored with the rest of the week played out in 51
//         weather versions (see coverPlan); loads the whole week like blk/imp
//   mr1 = fm1 plus the morning-of replan (27 Oct 2026): 30 min before sunrise
//         the planner sees whether the peaks are hidden and re-plans the rest
//         of the day on the morning build (replay_build kind 'morning')
//   mrmc = mc1 plus the same morning replan of the plan Monte Carlo chose
//   fm1 = the old planner (tomorrow only) that also plans every rated place at
//         least once (Phil, 26 Oct 2026: "each stop is technically a must
//         do"): a long place goes on the day of the next 3 whose forecast
//         suits it best, or tomorrow when its last possible day is tomorrow or
//         the days left would not fit everything still to do; once-only stops
//         (solver_stop_settings.once: ski/snowshoe outings) are not repeated.
// fc_days (27 Oct 2026): forecast days ahead for fm1 / blk / imp, 1-7 (default 3).
// Run config (26 Oct 2026, the four-way test): fixed_days, anchors_on, gear as
// in solver-plan; budget_ms for the week search. Every plan obeys done by dark
// and keep together (solver-plan v20); 'my' is Phil's schedule as written.
// Each visit stores truth (V at that time against what happened).
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
// Week plans: a stop that no longer fits its day costs half its tier weight.
const COVER_PENALTY = 0.5;
// fm1: required stops rank first in the day search (ranking only, not value).
const MUST_BONUS = 1000;
// mc1: a ski outing the played-out week never fits costs 5 x its tier weight.
const MISS_PENALTY = 5;
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
// Morning-of replan (mr1 / mrmc): the planner looks at the peaks this long before sunrise and re-plans the rest of the day.
const LOOK_BEFORE_SUNRISE_MIN = 30;
// Light-only scenarios: sun visibility (k/50)^2, k = 0..50. Same expansion
// as SQL solver_light_scores; solver_light_terms gives dir/soft per slot.
const SCENARIOS = Array.from({ length: 51 }, (_, k) => (k / 50) ** 2);

type PlanNode = { id: string; name: string; w: number; ws: number; dur: number; group: number; free: boolean; together: string | null; once: boolean };
type Visit = { n: number; arrive: number; start: number; end: number; drive: number; anchor: boolean };
type State = {
  t: number; loc: number; next: number; visited: Uint8Array; m0: number; m1: number; groupBest: Map<number, Uint8Array>;
  total: Float32Array; route: Visit[]; drive: number; over: number; j: number; mean: number; cvar: number; mc: number;
};
type DayPlan = {
  date: string; tripDate: string | null; light: boolean; start: number; end: number; dayStart: number; nSlots: number;
  routes: State[]; anchors: number; ms: number; winLo: number; winHi: number; extends?: number; capped?: boolean;
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

// Sun height in degrees (NOAA low-precision formulas, about a minute off).
function sunAlt(lat: number, lng: number, ms: number) {
  const rad = Math.PI / 180, d = ms / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = ((18.697374558 + 24.06570982441908 * d) * 15 + lng) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}
// Civil dusk after local noon on a date (UTC ms): when it is too dark to be out shooting.
function civilDusk(date: string, lat: number, lng: number, tz: string) {
  let t = zonedToUtc(date, 12 * 60, tz);
  for (let i = 0; i < 144 && sunAlt(lat, lng, t) >= -6; i++) t += 5 * 60000;
  return t;
}

// Sunrise on a date (UTC ms, to the minute): the first minute from 03:00 local with the sun up.
function sunrise(date: string, lat: number, lng: number, tz: string) {
  let t = zonedToUtc(date, 3 * 60, tz);
  for (let i = 0; i < 540 && sunAlt(lat, lng, t) <= -0.833; i++) t += 60000;
  return t;
}

// Civil dawn before local noon on a date (UTC ms).
function civilDawn(date: string, lat: number, lng: number, tz: string) {
  let t = zonedToUtc(date, 12 * 60, tz);
  for (let i = 0; i < 144 && sunAlt(lat, lng, t) >= -6; i++) t -= 5 * 60000;
  return t;
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
    const week = kindOf === 'blk' || kindOf === 'imp' || kindOf === 'mc1' || kindOf === 'mrmc';
    // Forecast days ahead the week plans see (run config fc_days, 1-7; Previous Runs keeps 7).
    let fcDays = 3;
    let horizon: { i: number; date: string; trip_date: string; dayId: number; lead: number }[];
    if (runId != null) {
      run = (await db.from('replay_runs').select('*').eq('id', runId).single()).data;
      if (!run) return json({ ok: false, error: 'replay run not found' }, 404);
      tripId = run.trip_id;
      const n: number = run.night;
      fcDays = Math.min(Math.max(Number(run.config?.fc_days ?? 3), 1), 7);
      const want = Array.from({ length: Math.min(week ? Infinity : kindOf === 'fm1' || kindOf === 'mr1' ? fcDays : 3, run.nights - n) }, (_, h) => n + h)
        .map(i => ({ i, date: addDays(run.start_date, i), trip_date: run.trip_dates[i], lead: i - n + 1 }));
      const { data: rds } = await db.from('replay_days').select('id, replay_date').eq('trip_id', tripId).in('replay_date', want.map(w => w.date));
      horizon = want.map(w => ({ ...w, dayId: (rds ?? []).find(r => r.replay_date === w.date)?.id }));
      if (horizon.some(h => h.dayId == null && h.lead <= (week || kindOf === 'fm1' || kindOf === 'mr1' ? fcDays : 3))) return json({ ok: false, error: 'replay day missing' }, 404);
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
    const nFc = k0 == null ? horizon.length : k0 === 'fc3' || k0 === 'fm1' || k0 === 'mr1' ? horizon.length : k0 === 'fc1' ? 1 : week ? Math.min(fcDays, horizon.length) : 0;
    const needLt = (h: number) => k0 == null || k0 === 'lt3' || (week && h >= nFc);
    const nTr = k0 == null || k0 === 'hs3' ? horizon.length : 1;
    if (fcB.slice(0, nFc).some(b => !b) || trB.slice(0, nTr).some(b => !b)) return json({ ok: false, error: 'replay builds missing' }, 404);
    // mr1 / mrmc: tomorrow's forecast with the look at the peaks before sunrise (replay_build kind 'morning').
    // morning_fresh (run config, 28 Oct 2026, board b06): the morning build also swaps
    // ECMWF's night-before forecast for its overnight (00 UTC) run, ready before the look.
    const morning = k0 === 'mr1' || k0 === 'mrmc';
    const mKind = cfg.morning_fresh ? 'morningf' : 'morning';
    const mB = morning ? (blds ?? []).find(b => b.replay_day_id === horizon[0].dayId && b.kind === mKind) : undefined;
    if (morning && !mB) return json({ ok: false, error: 'morning build missing' }, 404);

    const { data: trip } = await db.from('trips').select('timezone').eq('id', tripId).single();
    const tz: string = trip?.timezone ?? 'UTC';
    // One row per stop (replay_scores_c): slot i = t0 + offs[i] x 15 min, v[i] = members.
    // Kept compact (27 Oct 2026, the bench ran out of memory with several plans
    // in one worker): slot time as ms, values (0-250) as bytes; the plans are unchanged.
    const scoresOf = (buildId: string) => all<any>((a, b) => db.from('replay_scores_c').select('stop_id, t0, offs, v')
      .eq('build_id', buildId).order('stop_id').range(a, b))
      .then(rows => rows.flatMap(r => {
        const t0 = Date.parse(r.t0);
        return (r.offs as number[]).map((o, i) => ({ stop_id: r.stop_id, ms: t0 + o * SLOT * 60000, v: Uint8Array.from(r.v[i]) }));
      }));
    const lightOf = (date: string) => all<any>((a, b) => db.rpc('solver_light_terms', { p_trip_id: tripId, p_dates: [date] }).order('slot_at').order('stop_id').range(a, b))
      .then(rows => rows.map(r => ({
        stop_id: r.stop_id, ms: Date.parse(r.slot_at),
        v: Uint8Array.from(SCENARIOS.map(s => Math.round(250 * Math.max(0, Math.min(1,
          (r.blue ? r.dir : s * r.dir + (1 - s) * r.soft) * (r.fog_wanted ? 0.6 : 1)))))),
      })));

    const [inputs, fcSc, trSc, ltSc, stopsAll, accs, tripDays] = await Promise.all([
      all<any>((a, b) => db.from('solver_stop_inputs')
        .select('stop_id, name, tier, star_vantage_id, duration_minutes, time_locked, day_id, shot_status, shot_value')
        .eq('trip_id', tripId).range(a, b)),
      Promise.all(fcB.slice(0, nFc).map(b => scoresOf(b!.id))), Promise.all(trB.slice(0, nTr).map(b => scoresOf(b!.id))),
      Promise.all(horizon.map((h, i) => needLt(i) ? lightOf(h.date) : Promise.resolve([] as any[]))),
      all<any>((a, b) => db.from('stops').select('id, name, lat, lng, time_label, duration_minutes, drive_override_minutes, day_id, position, time_locked').eq('trip_id', tripId).range(a, b)),
      db.from('accommodations').select('name, lat, lng, check_in, check_out, nights').eq('trip_id', tripId).then(r => r.data ?? []),
      db.from('days').select('id, date').eq('trip_id', tripId).then(r => r.data ?? []),
    ]);
    if (fcSc.some(x => !x.length) || trSc.some(x => !x.length)) return json({ ok: false, error: 'empty replay builds' }, 404);
    const mSc = mB ? await scoresOf(mB.id) : [];
    if (mB && !mSc.length) return json({ ok: false, error: 'empty morning build' }, 404);
    if (week && ltSc.some((x, i) => needLt(i) && !x.length)) return json({ ok: false, error: 'no light geometry for a later day' }, 404);
    // A week mixes forecast days (one member per model) with light-only days
    // (51 scenarios): each model stands for an equal share of the 51.
    if (week) for (const day of fcSc) for (const r of day) {
      const m = r.v.length; if (m === 51) continue;
      const src = r.v; r.v = Uint8Array.from({ length: 51 }, (_, k) => src[Math.floor(k * m / 51)]);
    }
    // Shot status is about the real trip; a replay starts from nothing shot.
    for (const r of inputs) { r.shot_status = null; r.shot_value = null; }
    const specs = horizon.map(h => ({ date: h.date, trip_date: h.trip_date, light: false }));

    const stopById = new Map(stopsAll.map(s => [s.id, s]));
    // locked_add [stop_id] (28 Oct 2026, #9 Faroes): stops treated as stops.time_locked
    // (the flights, so arrival / departure days start and end at them).
    for (const id of (cfg.locked_add ?? []) as string[]) { const s = stopById.get(id); if (s) s.time_locked = true; }
    // A rated stop locked in the itinerary (stops.time_locked: Glacier View on the
    // way to the flight, Phil 27 Oct 2026) is a booking too, not a free stop.
    // Rated only (a tier): the JAC arrive / depart logistics stops are locked too and
    // are the day's start / end, not visits (as bookings they left the flight day with no route).
    for (const r of inputs) if (r.tier && stopById.get(r.stop_id)?.time_locked) r.time_locked = true;

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
    // Keep together (stops that go on one day) and the trip's middle (done by dark).
    const { data: tg } = await db.from('solver_stop_settings').select('stop_id, together, once')
      .in('stop_id', rated.map(r => r.stop_id)).or('together.not.is.null,once.eq.true');
    // Proof-step switches (run config, Phil 27 Oct 2026: how much each input matters):
    // no_together / no_once / no_dark turn a rule off; cap_frac / cap_minus move the
    // big-outing day size (80% of daylight less 45 min); miss_penalty the Monte Carlo
    // cost of a never-done ski outing (5). Absent = as before.
    // together_add {stop_id: key} / once_add [stop_id] (28 Oct 2026, #9 Faroes): guessed
    // rules for a trip Phil has not set yet, kept in the run config so the trip is untouched.
    const togetherOf = new Map([...(cfg.no_together ? [] : (tg ?? []).filter(r => r.together).map(r => [r.stop_id, r.together as string] as [string, string])),
      ...(cfg.no_together ? [] : Object.entries((cfg.together_add ?? {}) as Record<string, string>))]);
    const onceIds = new Set([...(cfg.no_once ? [] : (tg ?? []).filter(r => r.once).map(r => r.stop_id as string)),
      ...(cfg.no_once ? [] : (cfg.once_add ?? []) as string[])]);
    const placed = stopsAll.filter(s => s.lat != null && rated.some(r => r.stop_id === s.id));
    const mid = { lat: placed.reduce((t, s) => t + s.lat, 0) / (placed.length || 1), lng: placed.reduce((t, s) => t + s.lng, 0) / (placed.length || 1) };
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
        .concat(((cfg.anchors_on ?? []) as any[]).filter(a => a.date === tripDate).map(a => stopById.get(a.stop_id))
          .filter((s: any) => s && s.lat != null && labelMinutes(s.time_label) != null)
          .map((s: any) => ({ id: s.id, startMs: zonedToUtc(sp.date, labelMinutes(s.time_label)!, tz), dur: s.duration_minutes ?? 15 })))
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
        // w plans (run config tier_w can change it); ws scores against the truth (always the default weights).
        id, name: s?.name ?? id, w: r ? TIER_W[r.tier] : 0, ws: r ? (DEFAULTS.TIER_W[r.tier] ?? 0) : 0,
        dur: Math.max(r?.duration_minutes ?? s?.duration_minutes ?? 60, SLOT),
        group: ri != null ? find(ri) : -1 - (pos.get(id) ?? 0),
        free: !!r && !r.time_locked && r.shot_status !== 'nailed', together: togetherOf.get(id) ?? null, once: onceIds.has(id),
      };
    });
    const freeNodes = nodes.map((n, i) => (n.free ? i : -1)).filter(i => i >= 0);

    // Value of seeing subject g at w after prev, over what is already shot.
    const gain = (g: number, w: number, prev: number | undefined) => Math.max(0, w - Math.max(prev ?? 0, groupBase.get(g) ?? 0));

    // One day: beam over partial routes from the morning hotel to the night's.
    // search = false: only the day's values (W), no routes (scoring against the truth).
    // only: plan just these stops (the week plans), visiting all that fit.
    const gear = new Set<string>(cfg.gear?.stops ?? []);
    // must: stops the route has to include (fm1); skip: stops left out (once-only, done).
    // from (mr1): the visits already under way at atMs stay; the route goes on from there, no earlier than atMs.
    type From = { visits: { n: number; startMs: number; drive: number; anchor: boolean }[]; atMs: number };
    // exact (proof check, Phil's #8): plan only these stops with no beam cut, every
    // start slot, and every (stops, place) state kept unless another reached it no
    // later with a higher score: near-exhaustive (the score is not additive, so a
    // kept-best state can still hide a better one in rare cases).
    const EXACT_MAX_EXTENDS = 1_500_000;
    const planDay = (day: typeof days[number], scores: any[], search = true, only?: number[], must?: number[], skip?: Set<number>, from?: From, exact?: number[]): DayPlan => {
      const td0 = performance.now();
      const cand = (exact ?? only ?? freeNodes).filter(n => !skip?.has(n));
      let nExt = 0, capped = false;
      const mustSet = new Set(must ?? []);
      const H0 = pos.get(day.startId!)!, H = pos.get(day.endId!)!;
      const anchors = day.anchors.map(a => ({ n: pos.get(a.id)!, startMs: a.startMs, dur: a.dur }));
      const slotMs = scores.map(r => r.ms);
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
      // Rental gear: those stops only between pickup and return (trip dates).
      const gearDate = day.tripDate ?? day.date, gFrom = cfg.gear?.from, gTo = cfg.gear?.to;
      const gearLo = !gFrom ? 0 : gearDate < gFrom.date ? Infinity : gearDate > gFrom.date ? 0
        : Math.ceil((zonedToUtc(day.date, hhmm(gFrom.time), tz!) - dayStart) / (SLOT * 60000));
      const gearHiMin = !gTo ? Infinity : gearDate > gTo.date ? -Infinity : gearDate < gTo.date ? Infinity
        : (zonedToUtc(day.date, hhmm(gTo.time), tz!) - dayStart) / 60000;
      // Done by dark: free stops end by civil dusk.
      const darkMin = placed.length && !cfg.no_dark ? (civilDusk(day.date, mid.lat, mid.lng, tz!) - dayStart) / 60000 : Infinity;

      // V per node per slot, W = best V over the visit window starting there.
      const V: (Uint8Array | null)[][] = nodes.map(() => new Array(nSlots).fill(null));
      for (const r of scores) {
        const ni = pos.get(r.stop_id); if (ni == null) continue;
        const ti = Math.round((r.ms - dayStart) / (SLOT * 60000));
        if (ti >= 0 && ti < nSlots) V[ni][ti] = r.v;  // read only (W copies before merging)
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
        nExt++;
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
        const d = st.drive + drive, o = st.over + over(drive), mc = st.mc + (mustSet.has(n) ? 1 : 0);
        return {
          t: (i + len) * SLOT, loc: n, next: st.next + (anchor ? 1 : 0), visited, m0, m1, groupBest, total, drive: d, over: o, mc,
          route: [...st.route, { n, arrive: st.t + drive, start: i * SLOT, end: (i + len) * SLOT, drive, anchor }],
          mean: m.mean, cvar: m.cvar, j: m.j - DRIVE_PENALTY * (d + D[n][H]) - LONG_LEG_PENALTY * (o + over(D[n][H])) + MUST_BONUS * mc,
        };
      };

      const root: State = { t: 0, loc: H0, next: 0, visited: new Uint8Array(nodes.length), m0: 0, m1: 0, groupBest: new Map(),
        total: new Float32Array(M), route: [], drive: 0, over: 0, mc: 0,
        j: -DRIVE_PENALTY * D[H0][H] - LONG_LEG_PENALTY * over(D[H0][H]), mean: 0, cvar: 0 };
      let start = root;
      if (from) {
        for (const v of from.visits) start = extend(start, v.n, Math.round((v.startMs - dayStart) / (SLOT * 60000)), v.drive, v.anchor);
        start = { ...start, t: Math.max(start.t, (from.atMs - dayStart) / 60000) };
      }
      let pool: State[] = [];
      let beam: State[] = search ? [start] : [];
      while (beam.length) {
        const children = new Map<string, State>();
        const front = new Map<string, State[]>();  // exact: per key, states no other beats on both time and score
        const keep = (c: State) => {
          const key = nodes.length <= 64 ? `${c.m0},${c.m1},${c.loc}` : `${c.visited.join('')}|${c.loc}`;
          if (exact) {
            const f = front.get(key) ?? [];
            if (f.some(s => s.t <= c.t && s.j >= c.j)) return;
            front.set(key, [...f.filter(s => !(c.t <= s.t && c.j >= s.j)), c]);
            return;
          }
          const have = children.get(key);
          if (!have || have.j < c.j || (have.j === c.j && have.t > c.t)) children.set(key, c);
        };
        for (const st of beam) {
          if (exact && nExt > EXACT_MAX_EXTENDS) { capped = true; break; }
          const nextA = st.next < anchors.length ? anchors[st.next] : null;
          const nextSlot = nextA ? anchorSlot[st.next] : Infinity;
          // The next booking, at its fixed time.
          if (nextA) {
            const drive = D[st.loc][nextA.n];
            if (Number.isFinite(drive) && st.t + drive <= nextSlot * SLOT) keep(extend(st, nextA.n, nextSlot, drive, true));
          }
          // A free stop, if it still leaves time for the next booking (or the night's hotel).
          for (const s of cand) {
            if (st.visited[s]) continue;
            const drive = D[st.loc][s], home = D[s][H];
            if (!Number.isFinite(drive) || !Number.isFinite(home)) continue;
            const len = Math.ceil(nodes[s].dur / SLOT);
            const isGear = gear.has(nodes[s].id);
            const i0 = Math.max(Math.ceil((st.t + drive) / SLOT), nodes[s].w >= 5 ? earlyLo : winLo, isGear ? gearLo : 0);
            let iMax = Math.min(Math.floor((winMin - home) / SLOT), Math.floor(darkMin / SLOT)) - len;
            if (isGear) iMax = Math.min(iMax, Math.floor(gearHiMin / SLOT) - len);
            if (nextA) {
              const toA = D[s][nextA.n]; if (!Number.isFinite(toA)) continue;
              iMax = Math.min(iMax, Math.floor((nextSlot * SLOT - toA) / SLOT) - len);
            }
            if (i0 > iMax) continue;
            const opts = new Set<number>([i0]);
            if (exact) for (let i = i0 + 1; i <= Math.min(iMax, nSlots - 1); i++) opts.add(i);
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
        beam = exact ? [...front.values()].flat() : [...children.values()].sort((a, b) => b.j - a.j).slice(0, BEAM);
        // Only routes that made every booking are plans.
        pool.push(...beam.filter(st => st.next === anchors.length && st.t + D[st.loc][H] <= dayMin));
      }
      if (start.next === anchors.length) pool.push(start);
      // Keep together: all of a group or none of it.
      const groups = new Map<string, number[]>();
      for (const n of cand) { const k = nodes[n].together; if (k) groups.set(k, [...(groups.get(k) ?? []), n]); }
      const split = [...groups.values()].filter(g => g.length > 1);
      if (split.length) pool = pool.filter(st => split.every(g => g.every(n => st.visited[n]) || g.every(n => !st.visited[n])));
      // Week plans: the routes that visit the most of the day's stops.
      if (only) {
        const seen = (st: State) => cand.filter(n => st.visited[n]).length;
        const most = Math.max(0, ...pool.map(seen));
        pool = pool.filter(st => seen(st) === most);
      }
      // fm1: only routes with every required stop count.
      if (mustSet.size) pool = pool.filter(st => st.mc === mustSet.size);
      pool.sort((a, b) => b.j - a.j);
      return { date: day.date, tripDate: day.tripDate, light: day.light, start: H0, end: H, dayStart, nSlots, routes: pool,
               anchors: anchors.length, ms: Math.round(performance.now() - td0), winLo, winHi, W, peak,
               ...(exact ? { extends: nExt, capped } : {}) };
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
        if (nodes[v.n].ws <= 0) continue;
        const w = truthAt(tp, v);
        const g = nodes[v.n].group, prev = best.get(g);
        total += nodes[v.n].ws * gain(g, w, prev) / 250;
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
      const { data: ks } = await db.from('replay_run_state').select('night, state, sets').eq('run_id', runId).eq('kind', kind).single();
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
        // What each visit got against what happened.
        if (row.visits?.length === visits.length) row.visits = row.visits.map((v: any, i: number) => ({ ...v, truth: r2(truthAt(truthN, visits[i]) / 250) }));
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
      // Improve my week (blk / imp): the remaining days' stop sets, carried
      // night to night; the search starts from them and keeps what scores better.
      let nextSets: Record<string, string[]> | null = null;  // blk / imp: day sets; fm1: {seen}
      const improveWeek = (mode: 'blocks' | 'free') => {
        const M = 51, light = (i: number) => i >= nFc;
        const scoresAt = (i: number) => light(i) ? ltSc[i] : fcSc[i];
        const keyDay = (i: number) => days[i].tripDate ?? days[i].date;
        const fixed = new Set<string>(cfg.fixed_days ?? []);
        const saved: Record<string, string[]> | null = ks.sets ?? null;
        let sets: number[][] = days.map((d, i) => (saved ? (saved[keyDay(i)] ?? []).map(id => pos.get(id)) : d.own.map((x: any) => pos.get(x.id)))
          .filter((x): x is number => x != null && nodes[x].free));
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
        // Only each day's best route is kept: whole day plans (scores per slot)
        // for ~200 tries ran the worker out of memory.
        const cache = new Map<string, { routes: State[]; end: number }>();
        const evalDay = (i: number, set: number[]) => {
          const k = i + '|' + [...set].sort((a, b) => a - b).join(',');
          let p = cache.get(k);
          if (!p) { const full = planDay({ ...days[i], light: light(i) }, scoresAt(i), true, set); p = { routes: full.routes.slice(0, 1), end: full.end }; cache.set(k, p); }
          return p;
        };
        const weekScore = (ss: number[][]) => {
          const groups = new Map<number, Uint8Array>();
          let drive = 0, o = 0, lost = 0;
          ss.forEach((set, i) => {
            const p = evalDay(i, set), st = p.routes[0];
            if (!st) { for (const x of set) lost += nodes[x].w; return; }
            mergeInto(groups, st.groupBest);
            drive += st.drive + D[st.loc][p.end]; o += st.over + over(D[st.loc][p.end]);
            for (const x of set) if (!st.visited[x]) lost += nodes[x].w;
          });
          return metric(totalOf(groups)).j - DRIVE_PENALTY * drive - LONG_LEG_PENALTY * o - COVER_PENALTY * lost;
        };
        const tS = performance.now(), budget = Math.min(Number(cfg.budget_ms ?? 700), 1200);
        const startScore = weekScore(sets);
        let best = startScore, moves = 0, improved = true;
        const tryIt = (ss: number[][]) => { const v = weekScore(ss); if (v > best + 1e-6) { sets = ss; best = v; moves++; return true; } return false; };
        search: while (improved) {
          improved = false;
          for (let a = 0; a < days.length; a++) for (let b = a + 1; b < days.length; b++) {
            if (performance.now() - tS > budget) break search;
            if (fixed.has(keyDay(a)) || fixed.has(keyDay(b))) continue;
            const ss = sets.slice(); [ss[a], ss[b]] = [ss[b], ss[a]];
            if (tryIt(ss)) { improved = true; continue search; }
          }
          if (mode === 'blocks') break;
          for (let a = 0; a < days.length; a++) for (const x of sets[a]) for (let b = 0; b < days.length; b++) {
            if (a === b || fixed.has(keyDay(a)) || fixed.has(keyDay(b))) continue;
            const k = nodes[x].together, unit = k ? sets[a].filter(y => nodes[y].together === k) : [x];
            if (unit[0] !== x) continue;
            if (performance.now() - tS > budget) break search;
            const ss = sets.map(y => y.slice()); ss[a] = ss[a].filter(y => !unit.includes(y)); ss[b].push(...unit);
            if (tryIt(ss)) { improved = true; continue search; }
          }
        }
        nextSets = Object.fromEntries(sets.slice(1).map((set, j) => [keyDay(j + 1), set.map(x => nodes[x].id)]));
        const p0 = planDay({ ...days[0], light: light(0) }, scoresAt(0), true, sets[0]), st = p0.routes[0] ?? null;
        return record(st ? routeOf(p0, st) : [], {
          predicted: st ? r3(st.mean) : null, drive_minutes: st ? Math.round(st.drive) : null, visits: st ? visitsOf(p0, st) : [],
          stats: { horizon: days.length, forecast_days: nFc, moves, start: r3(startScore), end: r3(best), day_plans: cache.size,
                   ms: Math.round(performance.now() - tS), finished: performance.now() - tS <= budget,
                   planned: sets[0].length, unplanned: st ? sets[0].filter(x => !st.visited[x]).map(x => nodes[x].name) : sets[0].map(x => nodes[x].name),
                   ...(st ? {} : { error: 'no route' }) },
        });
      };
      // fm1: tomorrow only, every rated place at least once over the trip.
      const coverPlan = async () => {
        const seenIds = new Set<string>((ks.sets as any)?.seen ?? []);
        const done = (x: number) => seenIds.has(nodes[x].id);
        // A place: a keep-together group (all of it), else a subject (any of its stops).
        const unitKey = (x: number) => nodes[x].together ? 't:' + nodes[x].together : 'g:' + nodes[x].group;
        const unitsAll = new Map<string, number[]>();
        for (const x of freeNodes) unitsAll.set(unitKey(x), [...(unitsAll.get(unitKey(x)) ?? []), x]);
        const covered = (u: number[]) => nodes[u[0]].together ? u.every(done) : u.some(done);
        const open = [...unitsAll.values()].filter(u => !covered(u));
        const skip = new Set(freeNodes.filter(x => nodes[x].once && done(x)));
        const remaining: string[] = (run.trip_dates as string[]).slice(n);
        const gFrom = cfg.gear?.from?.date, gTo = cfg.gear?.to?.date;
        const okOn = (u: number[], td: string) => !u.some(x => gear.has(nodes[x].id)) || ((!gFrom || td >= gFrom) && (!gTo || td <= gTo));
        const lastDay = (u: number[]) => { for (let i = remaining.length - 1; i >= 0; i--) if (okOn(u, remaining[i])) return i; return -1; };
        const durOf = (u: number[]) => nodes[u[0]].together ? u.reduce((t, x) => t + nodes[x].dur, 0) : Math.min(...u.map(x => nodes[x].dur));
        // Daylight minutes on a remaining trip day, after landing / before the flight; 70% of it for stops (drives).
        // Minutes a place could use on a remaining trip day: daylight (civil dawn
        // to dusk), after landing / before the flight, ski places only between
        // gear pickup and return; 80% of it, less 45 min, for the place itself
        // (a day packed to the minute does not survive drives and parking).
        const winOn = (i: number, u: number[]) => {
          const td = remaining[i], rd = addDays(run.start_date, n + i);
          if (!okOn(u, td)) return 0;
          const ids = new Set(tripDays.filter(d => d.date === td).map(d => d.id));
          const own = stopsAll.filter(x => ids.has(x.day_id)).sort((a, b) => a.position - b.position);
          let lo = civilDawn(rd, mid.lat, mid.lng, tz), hi = civilDusk(rd, mid.lat, mid.lng, tz);
          const a = own[0], z = own.length > 1 ? own[own.length - 1] : null;
          if (a?.time_locked && labelMinutes(a.time_label) != null) lo = Math.max(lo, zonedToUtc(rd, labelMinutes(a.time_label)! + (a.duration_minutes ?? 0), tz));
          if (z?.time_locked && labelMinutes(z.time_label) != null) hi = Math.min(hi, zonedToUtc(rd, labelMinutes(z.time_label)!, tz));
          if (u.some(x => gear.has(nodes[x].id))) {
            if (cfg.gear?.from && td === gFrom) lo = Math.max(lo, zonedToUtc(rd, hhmm(cfg.gear.from.time), tz));
            if (cfg.gear?.to && td === gTo) hi = Math.min(hi, zonedToUtc(rd, hhmm(cfg.gear.to.time), tz));
          }
          return Math.max(0, Number(cfg.cap_frac ?? 0.8) * (hi - lo) / 60000 - Number(cfg.cap_minus ?? 45));
        };
        // How good each place looks on each of the next 3 days (best moment, forecast mean).
        const atH = (h: number) => (h < nFc ? fcSc[h] : ltSc[h]);
        const looks = days.map((d, h) => planDay({ ...d, light: h >= nFc }, atH(h), false));
        const best = (x: number, h: number) => {
          const p = looks[h]; let b = 0;
          for (let i = p.winLo; i <= p.winHi; i++) { const w = p.W(x, i); if (!w) continue; let t = 0; for (const v of w) t += v; b = Math.max(b, t / w.length / 250); }
          return b;
        };
        const val = (u: number[], h: number) => h < days.length && okOn(u, remaining[h]) ? Math.max(...u.map(x => best(x, h))) : -1;
        // Long places (>= 90 min) are spread over the days left: each on a day it
        // fits, as many as each day holds, on the forecast days where they look
        // best (beyond the forecast: the place's average over the forecast days).
        // Tomorrow's share of that is required tomorrow; so is any place whose
        // last chance is tomorrow.
        // fm_version (run config, default 3) keeps the older versions runnable
        // for the proof step: 1 = cover1 (best of the next 3 days, capacity
        // check without the gear window), 2 = cover2 (every long place gets a
        // day), 3 = cover3 (only once-only outings, most urgent kept).
        const fmv = Number(cfg.fm_version ?? 3);
        // Only once-only outings (skis) need a protected day: repeatable places get many chances.
        const longs = open.filter(u => durOf(u) >= 90 && (fmv < 3 || u.some(x => nodes[x].once)));
        const prior = (u: number[]) => { const vs = days.map((_, h) => val(u, h)).filter(v => v >= 0); return vs.length ? vs.reduce((t, v) => t + v, 0) / vs.length : 0.4; };
        const score = (u: number[], i: number) => (i < days.length ? val(u, i) : prior(u)) - 0.001 * i;
        const win = longs.map(u => remaining.map((_, i) => winOn(i, u)));
        const gainT = longs.map(u => remaining.map((_, i) => score(u, i)));
        const used = remaining.map(() => 0), assign: number[] = [];
        let bestA: number[] = [], bestS = -Infinity, calls = 0;
        const dfs = (k: number, sc: number) => {
          if (++calls > 200000) return;
          if (k === longs.length) { if (sc > bestS) { bestS = sc; bestA = [...assign]; } return; }
          const u = longs[k], d = durOf(u);
          let any = false;
          for (let i = 0; i < remaining.length; i++) {
            if (used[i] + d > win[k][i]) continue;
            used[i] += d; assign.push(i); dfs(k + 1, sc + gainT[k][i]); assign.pop(); used[i] -= d; any = true;
          }
          if (!any) { assign.push(-1); dfs(k + 1, sc - 10); assign.pop(); }
        };
        dfs(0, 0);
        let req: number[][], want: number[][];
        if (fmv >= 3) {
          req = open.filter(u => !longs.includes(u) && lastDay(u) === 0);
          // When a day cannot hold them all, the most urgent stays: fewest days left that fit it, then the longest.
          const daysLeft = (u: number[]) => { const k = longs.indexOf(u); return win[k].filter(w => w >= durOf(u)).length; };
          want = longs.filter((_, k) => bestA[k] === 0).sort((a, b) => daysLeft(a) - daysLeft(b) || durOf(b) - durOf(a));
        } else if (fmv === 2) {
          req = open.filter(u => durOf(u) < 90 && lastDay(u) === 0);
          want = longs.filter((_, k) => bestA[k] === 0).sort((a, b) => durOf(b) - durOf(a));
        } else {
          // v1: 70% of plain daylight (no gear window), forced only when the days after tomorrow cannot hold what is left.
          const capOn = (i: number) => {
            const td = remaining[i], rd = addDays(run.start_date, n + i);
            const ids = new Set(tripDays.filter(d => d.date === td).map(d => d.id));
            const own = stopsAll.filter(x => ids.has(x.day_id)).sort((a, b) => a.position - b.position);
            let lo = civilDawn(rd, mid.lat, mid.lng, tz), hi = civilDusk(rd, mid.lat, mid.lng, tz);
            const a0 = own[0], z = own.length > 1 ? own[own.length - 1] : null;
            if (a0?.time_locked && labelMinutes(a0.time_label) != null) lo = Math.max(lo, zonedToUtc(rd, labelMinutes(a0.time_label)! + (a0.duration_minutes ?? 0), tz));
            if (z?.time_locked && labelMinutes(z.time_label) != null) hi = Math.min(hi, zonedToUtc(rd, labelMinutes(z.time_label)!, tz));
            return Math.max(0, (hi - lo) / 60000) * 0.7;
          };
          req = open.filter(u => lastDay(u) === 0);
          const rest = () => open.filter(u => !req.includes(u) && lastDay(u) >= 1);
          for (let guard = 0; guard < open.length; guard++) {
            const left = rest().sort((a, b) => lastDay(a) - lastDay(b));
            let short = false, cap = 0, need = 0;
            for (let D = 1; D < remaining.length && !short; D++) {
              cap += capOn(D);
              need = left.filter(u => lastDay(u) <= D).reduce((t, u) => t + durOf(u), 0);
              if (need > cap) short = true;
            }
            const pick = left.find(u => okOn(u, remaining[0]));
            if (!short || !pick || req.reduce((t, u) => t + durOf(u), 0) + durOf(pick) > capOn(0)) break;
            req.push(pick);
          }
          want = open.filter(u => !req.includes(u) && okOn(u, remaining[0]) && durOf(u) >= 90 && val(u, 0) > 0 && val(u, 0) >= Math.max(val(u, 1), val(u, 2)))
            .sort((a, b) => (val(b, 0) - Math.max(val(b, 1), val(b, 2))) - (val(a, 0) - Math.max(val(a, 1), val(a, 2))));
        }
        const mustOf = (u: number[]) => nodes[u[0]].together ? u : [u.reduce((a, b) => (best(b, 0) > best(a, 0) ? b : a))];
        // Plan tomorrow with these places required, dropping from the end when a day cannot hold them all.
        const planList = (l0: number[][]) => {
          let l = l0, pp: DayPlan, ss: State | null;
          for (;;) {
            pp = planDay({ ...days[0], light: false }, fcSc[0], true, undefined, l.flatMap(mustOf), skip);
            ss = pp.routes[0] ?? null;
            if (ss || !l.length) break;
            l = l.slice(0, -1);
          }
          return { p: pp, st: ss, list: l };
        };
        // split_morning (run config, 28 Oct 2026): the heaviest nights (Monte Carlo
        // + polish + morning re-plan, mostly the gear-pickup day) ran out of the
        // worker's CPU time. With it, the night plan is one request and the morning
        // re-plan the next: the night plan is saved in sets.pending and rebuilt
        // exactly (same visits, same scores) before the morning step. Same results.
        // With polish on, the night plan is split once more (28 Oct: one night died
        // in the night half): stage 'mc' = Monte Carlo done, 'night' = polish done.
        const split = !!cfg.split_morning && (kind === 'mr1' || kind === 'mrmc');
        const pend = (ks.sets as any)?.pending;
        const stage: string | null = split && pend?.night === n ? (pend.stage ?? 'night') : null;
        const phase2 = stage != null;
        let p0: DayPlan, st: State | null, list: number[][];
        if (phase2) {
          const vis = (pend.visits as any[]).map(v => ({ n: pos.get(v.id)!, startMs: v.startMs, drive: v.drive, anchor: v.anchor }));
          list = (pend.units as string[][]).map(ids => ids.map(id => pos.get(id)!));
          // Rebuilt with the same required places, so its score (j) is the original's.
          p0 = planDay({ ...days[0], light: false }, fcSc[0], false, undefined, list.flatMap(u => u), undefined, { visits: vis, atMs: 0 });
          st = p0.routes[0] ?? null;
        } else ({ p: p0, st, list } = planList([...req, ...want]));
        let mcStats: any = phase2 ? pend.mc : null, mrStats: any = null, exStats: any = phase2 ? pend.ex : null, polStats: any = phase2 ? pend.pol : null;
        // The near-exhaustive search (planDay exact) over a plan's own stops, the
        // required ones and the next best places up to k (keep-together partners
        // added whole); more than 9 stops is not tried.
        const exactOver = (scores: any[], s: State, mustN: number[], k: number, from?: From) => {
          const E = new Set<number>([...s.route.filter(v => nodes[v.n].free).map(v => v.n), ...mustN]);
          const addUnit = (x: number) => { for (const y of freeNodes) if (y === x || (nodes[x].together && nodes[y].together === nodes[x].together)) E.add(y); };
          [...E].forEach(addUnit);
          const others = freeNodes.filter(x => !E.has(x) && !skip.has(x)).sort((a, b) => best(b, 0) - best(a, 0));
          for (const x of others) { if (E.size >= k) break; addUnit(x); }
          if (E.size > 9) return { E, pe: null, se: null };
          const pe = planDay({ ...days[0], light: false }, scores, true, undefined, mustN, skip, from, [...E]);
          return { E, pe, se: pe.routes[0] ?? null };
        };
        // Polish (run config polish_k, 27 Oct 2026: the exact7 check found a better
        // day than the beam on 78% of days): keep the exact search's day when it
        // scores higher with the same required places.
        const polish = (scores: any[], p: DayPlan, s: State, mustN: number[], from?: From) => {
          const r = exactOver(scores, s, mustN, Number(cfg.polish_k), from);
          return r.se && r.pe && r.se.j > s.j + 1e-6 ? { p: r.pe, st: r.se, gain: r3(r.se.j - s.j) } : { p, st: s, gain: 0 };
        };
        if (cfg.exact_k && st && !phase2) {
          // Proof check (run config exact_k, stats only, the plan is unchanged):
          // tomorrow's night plan vs the near-exhaustive search. A higher exact
          // score means the beam missed a better day.
          const { E, pe, se } = exactOver(fcSc[0], st, list.flatMap(mustOf), Number(cfg.exact_k));
          if (!pe) exStats = { skipped: `${E.size} stops` };
          else {
            const names = (s: State) => s.route.filter(v => nodes[v.n].w > 0).map(v => nodes[v.n].name + ' ' + new Date(p0.dayStart + v.start * 60000).toISOString().slice(11, 16));
            exStats = { k: E.size, beam_j: r3(st.j), exact_j: se ? r3(se.j) : null, gain: se ? r3(se.j - st.j) : null,
                        same_stops: se ? se.route.length === st.route.length && se.route.every(v => st.visited[v.n]) : null,
                        exact: se ? names(se) : null, beam: names(st), ms: pe.ms, extends: pe.extends, capped: pe.capped };
          }
        }
        if ((kind === 'mc1' || kind === 'mrmc') && st && !phase2) {
          // Monte Carlo (Phil, 27 Oct 2026): a few candidate plans for tomorrow
          // (the fm1 plan, its next-best routes, and tomorrow with each open ski
          // outing or none), each scored as tomorrow plus the rest of the week
          // played out in 51 weather versions: forecast days in the forecast's
          // own versions (one model each), later days in light-only versions
          // shuffled per day. In each version a quick stand-in fills every later
          // day with the best places per minute that fit its daylight (ski
          // outings once, gear window kept); a ski outing never done costs
          // MISS_PENALTY x its tier weight, and a candidate after which the days
          // left cannot hold every open ski outing is dropped first. Best mean
          // + 0.5 x CVaR wins.
          const tMc = performance.now(), S = 51;
          const cands: { p: DayPlan; st: State; tag: string; list: number[][] }[] = [{ p: p0, st, tag: 'fm1', list }];
          const sameSet = (a: State, b: State) => a.route.length === b.route.length && a.route.every(v => b.visited[v.n]);
          for (const alt of p0.routes.slice(1, 6)) {
            if (cands.length >= 3) break;
            if (!cands.some(c => sameSet(c.st, alt))) cands.push({ p: p0, st: alt, tag: 'alt', list });
          }
          const tryList = (l: number[][], tag: string) => {
            const r = planList(l);
            if (r.st && !cands.some(c => sameSet(c.st, r.st!))) cands.push({ p: r.p, st: r.st, tag, list: r.list });
          };
          tryList([...req], 'no outing');
          for (const u of longs) if (!want.includes(u) && okOn(u, remaining[0])) tryList([...req, u], 'outing ' + nodes[u[0]].name);
          // Best V per free node per later day per version (0-250), versions shuffled beyond the forecast.
          const vb = days.map((_, h) => {
            const p = looks[h], m = new Map<number, Uint8Array>();
            for (const x of freeNodes) {
              const b = new Uint8Array(S);
              for (let i = p.winLo; i <= p.winHi; i++) { const w = p.W(x, i); if (!w) continue; for (let k = 0; k < S; k++) { const v = w[k % w.length]; if (v > b[k]) b[k] = v; } }
              if (h >= nFc) { const sh = new Uint8Array(S); for (let k = 0; k < S; k++) sh[k] = b[(k * 7 + h * 13) % S]; m.set(x, sh); } else m.set(x, b);
            }
            return m;
          });
          const cap = days.map((_, h) => freeNodes.map(x => (h === 0 ? 0 : winOn(h, [x]))));
          const onceUnits = [...unitsAll.values()].filter(u => u.some(x => nodes[x].once) && !covered(u));
          const scoreCand = (c: { p: DayPlan; st: State }) => {
            const tot = new Float32Array(S);
            for (let k = 0; k < S; k++) {
              const bestG = new Map<number, number>(groupBase);
              const did = new Set<number>(freeNodes.filter(x => done(x)));
              let v = 0;
              for (const r of c.st.route) {
                const x = r.n; if (nodes[x].w <= 0) continue;
                const w = c.p.W(x, Math.round(r.start / SLOT)); const val0 = w ? w[k % w.length] : 0;
                const g = nodes[x].group, prev = bestG.get(g) ?? 0;
                v += nodes[x].w * Math.max(0, val0 - prev) / 250; bestG.set(g, Math.max(prev, val0)); did.add(x);
              }
              for (let h = 1; h < days.length; h++) {
                const opts = freeNodes.map((x, j) => ({ x, j })).filter(o => !skip.has(o.x) && !(nodes[o.x].once && did.has(o.x)) && cap[h][o.j] > 0)
                  .map(o => { const g = nodes[o.x].group, gain = nodes[o.x].w * Math.max(0, vb[h].get(o.x)![k] - (bestG.get(g) ?? 0)) / 250; return { ...o, gain, r: gain / (nodes[o.x].dur + 30) }; })
                  .filter(o => o.gain > 0 || nodes[o.x].once).sort((a, b) => b.r - a.r);
                let used = 0;
                for (const o of opts) {
                  const d = nodes[o.x].dur + 30; if (used + d > cap[h][o.j]) continue;
                  used += d; did.add(o.x); v += o.gain;
                  const g = nodes[o.x].group; bestG.set(g, Math.max(bestG.get(g) ?? 0, vb[h].get(o.x)![k]));
                }
              }
              for (const u of onceUnits) if (!u.every(x => did.has(x))) v -= Number(cfg.miss_penalty ?? MISS_PENALTY) * u.reduce((t, x) => t + nodes[x].w, 0);
              tot[k] = v;
            }
            return metric(tot);
          };
          // Every ski outing must still fit after tomorrow: a candidate that leaves
          // more outings than the days after it can hold is out (Phil: every place
          // is a must-do), whatever the weather says.
          const fitsLater = (st: State) => {
            const left = longs.filter(u => !u.every(x => st.visited[x]));
            const used = remaining.map(() => 0);
            const place = (k: number): boolean => {
              if (k === left.length) return true;
              const u = left[k], d = durOf(u), wk = win[longs.indexOf(u)];
              for (let i = 1; i < remaining.length; i++) {
                if (used[i] + d > wk[i]) continue;
                used[i] += d; const ok = place(k + 1); used[i] -= d;
                if (ok) return true;
              }
              return false;
            };
            return place(0);
          };
          const ok = cands.filter(c => fitsLater(c.st));
          const pool = ok.length ? ok : cands.slice(0, 1);
          const scored = pool.map(c => ({ c, m: scoreCand(c) }));
          const pick = scored.reduce((a, b) => (b.m.j > a.m.j ? b : a));
          mcStats = { dropped: cands.length - pool.length, cands: scored.map(x => ({ tag: x.c.tag, j: r3(x.m.j), mean: r3(x.m.mean), stops: x.c.st.route.filter(v => nodes[v.n].w > 0).map(v => nodes[v.n].name) })),
                      chose: pick.c.tag, ms: Math.round(performance.now() - tMc) };
          p0 = pick.c.p; st = pick.c.st; list = pick.c.list;
        }
        const save = async (stg: string) => {
          const pending = { night: n, stage: stg, visits: st!.route.map(v => ({ id: nodes[v.n].id, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor })),
                            units: list.map(u => mustOf(u).map(x => nodes[x].id)), mc: mcStats, ex: exStats, pol: polStats };
          await db.from('replay_run_state').update({ sets: { ...(ks.sets ?? {}), pending }, status: 'idle', note: null, updated_at: new Date().toISOString() })
            .eq('run_id', runId).eq('kind', kind);
          return null;
        };
        if (split && !phase2 && cfg.polish_k && st) return await save('mc');
        if (cfg.polish_k && st && stage !== 'night') {
          const r = polish(fcSc[0], p0, st, list.flatMap(mustOf));
          polStats = { night: r.gain }; p0 = r.p; st = r.st;
        }
        if (split && stage !== 'night' && st) return await save('night');
        if ((kind === 'mr1' || kind === 'mrmc') && st) {
          // Morning-of replan (Phil, 27 Oct 2026): the night's plan (v3, or the one
          // Monte Carlo chose) stands up to 30 min before sunrise; then the planner
          // sees whether the peaks are hidden (the airport or the camera, the
          // latest report in the hour before) and re-plans the rest of the day on
          // the morning build, with the same required places (dropped from the
          // end only if they no longer fit).
          const atMs = sunrise(days[0].date, mid.lat, mid.lng, tz) - LOOK_BEFORE_SUNRISE_MIN * 60000;
          // mr_commit 'departure' (27 Oct 2026, the first full test lost the sunrise
          // shot on 50 of 97 clear mornings): a visit you have already left for at
          // the look is kept too; without it the replan restarts from where you were.
          const leftBy = (v: { start: number; arrive: number; drive: number }) =>
            cfg.mr_commit === 'departure' ? p0.dayStart + (v.arrive - v.drive) * 60000 < atMs : false;
          const before = st.route.filter(v => p0.dayStart + v.start * 60000 < atMs || leftBy(v))
            .map(v => ({ n: v.n, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor }));
          let l = list, pm: DayPlan | null = null, sm: State | null = null;
          for (;;) {
            pm = planDay({ ...days[0], light: false }, mSc, true, undefined, l.flatMap(mustOf), skip, { visits: before, atMs });
            sm = pm.routes[0] ?? null;
            if (sm || !l.length) break;
            l = l.slice(0, -1);
          }
          if (cfg.polish_k && sm && pm) {
            const r = polish(mSc, pm, sm, l.flatMap(mustOf), { visits: before, atMs });
            polStats = { ...(polStats ?? {}), morning: r.gain }; pm = r.p; sm = r.st;
          }
          const { data: look } = await db.from('replay_hidden_truth').select('hr, hidden').eq('trip_id', tripId)
            .gte('hr', new Date(atMs - 3600000).toISOString()).lte('hr', new Date(atMs).toISOString()).order('hr', { ascending: false }).limit(1);
          const show = (p: DayPlan, s: State) => s.route.filter(v => nodes[v.n].w > 0)
            .map(v => nodes[v.n].name + ' ' + new Date(p.dayStart + v.start * 60000).toISOString().slice(11, 16));
          mrStats = { look_at: new Date(atMs).toISOString(), hidden: look?.[0]?.hidden ?? null, kept: before.length, night: show(p0, st) };
          if (sm && pm) {
            const morning = show(pm, sm);
            mrStats = { ...mrStats, morning, changed: morning.join('|') !== mrStats.night.join('|'), dropped: list.length - l.length };
            p0 = pm; st = sm;
          } else mrStats.error = 'no morning route: the night plan stands';
        }
        if (st) for (const v of st.route) seenIds.add(nodes[v.n].id);
        nextSets = { seen: [...seenIds] };
        return record(st ? routeOf(p0, st) : [], {
          predicted: st ? r3(st.mean) : null, drive_minutes: st ? Math.round(st.drive) : null, visits: st ? visitsOf(p0, st) : [],
          stats: { members: fcB[0]!.members, required: req.length, wanted: want.length, kept: list.length, open: open.length,
                   ms: p0.ms, ...(exStats ? { exact: exStats } : {}), ...(polStats ? { polish: polStats } : {}), ...(mcStats ? { mc: mcStats } : {}), ...(mrStats ? { mr: mrStats } : {}), ...(st ? {} : { error: 'no route' }) },
        });
      };
      let shot: Record<string, number>;
      if (kind === 'fm1' || kind === 'mc1' || kind === 'mr1' || kind === 'mrmc') {
        const cs = await coverPlan();
        if (!cs) return json({ ok: true, partial: 'night plan saved; the morning step comes next', run_id: runId, kind, night: n });
        shot = cs;
      }
      else if (kind === 'blk') shot = improveWeek('blocks');
      else if (kind === 'imp') shot = improveWeek('free');
      else if (kind === 'fc3') shot = plan(days.length, h => fcSc[h], false, fcB[0]!.members);
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
      await db.from('replay_run_state').update({ night: n + 1, state: shot, ...(nextSets ? { sets: nextSets } : {}), status: 'idle', note: null, updated_at: new Date().toISOString() })
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
