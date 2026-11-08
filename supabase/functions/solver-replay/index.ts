import { createClient } from 'jsr:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';
import { calChance, CAL_FALLBACK, regionOf, LIGHT_WORD, reasonText, goodShotsOf, moveWhyText } from './t2.ts';

// SOLVER REPLAY (test bench, backend only; Phil 25 Oct 2026)
// v84 (6 Nov 2026, Phil: count blue hour): run config blue = builds and light-only days score a clear blue hour as a
// good shot (lead + 10240); blue_judge = only the truth does (to judge plain T on the same rule).
// v82 (6 Nov 2026): run config sbfix = builds at lead + 5120 with the odds bug fixed (fit loads read sb = 0).
// v85 (6 Nov 2026): tool op audit {visits} (full rule check by exact search) and solve {polish: true} (grading).
// v92 (8 Nov 2026, worksheet E4/E7, version BD): run config runs = builds at lead + 81920 keep each member's
// hidden chance per slot, and a visit is valued by its expected best moment with persisting hidden / clear spells.
// v91 (8 Nov 2026): published plans carry params/stats.version = the planner_versions winner.
// v90 (8 Nov 2026, F5 / version BC): run config layers = builds at lead + 40960, ECMWF's hidden-peak odds
// from its low cloud (replay_layer_fit, single ECMWF runs in replay_wx_layers).
// v83 (6 Nov 2026): tool ops stop_detail {stop_id} and weather_detail for Claude.
// v81 (6 Nov 2026, worksheet G1): {run_id, kind, night, tool: context | solve | score | grade}: read-only
// tools for Claude planning a past night with the solver (claude-planner function).
// v80 (6 Nov 2026, Phil: test pace options B-D): run config visit_price (tier points per optional rated
// visit), chance_floor (optional stops only where that share of weather versions is good), end_at 'sunset'.
// v79 (6 Nov 2026, worksheet E1): run config cons = builds at lead + 2560, hidden-peak odds from the
// models' agreement at each hour (replay_cons_bin) instead of each model's own.
// v78 (6 Nov 2026, worksheet E2): run config far_hidden = light-only days count the peaks hidden in the
// place's usual share of the cloudiest sun scenarios (replay_clim_hidden) instead of always visible.
// v77 (6 Nov 2026, worksheet C5): week drafts chain their own steps within a night (run config chain:
// true turns it on; off by default) instead of one step per 20-s tick.
// v76 (6 Nov 2026, worksheet A3): run config nopk = builds at lead + 1280, where a stop with
// solver_stop_settings.needs_peaks false keeps its value when the peaks are hidden; nopk_judge = only
// the truth builds do (to judge plain T on the same truth).
// v75 (6 Nov 2026, worksheet B2): live day steps (morning, camera look, re-plan now) mark visits already
// over as done: true in what they publish; the TEST app shows them as done instead of a chance.
// v74 (6 Nov 2026, worksheet B1): run config polish_max lifts the 9-stop limit on the exact polish search
// (default 9 = unchanged); Y (polish_k 10) had never polished.
// v73 (6 Nov 2026, Phil: "Yes" to relearning the odds from the cameras): run config vfit = every build at
// lead + 640, whose hidden-peak odds and morning look odds are learned from the camera vote (replay_hidden_vote:
// cameras + airport majority, else the old rule) instead of the airport / TetonCam rule (planner version AN).
// v69 (5 Nov 2026, Phil: "a sunrise look THEN a before I leave look", "do whatever is smarter"): run config
// depart = a look 15 min before the plan's first departure (airport + cameras when light), as well as the
// dawn look: leaving before the dawn look it comes first and can change the first stop; leaving later it
// follows the dawn look. Its build is made here at that time (replay_build kind 'depart' / 'departf',
// p_look; the nearest fitted look's odds) and reused by look time. Bench only for now (planner version AK).
// (v68's fixed look 2 h before sunrise, run config predawn, was replaced before it ran.)
// v66 (5 Nov 2026, Phil: "an async planner whenever, even mid day"): Re-plan now. A request
// {run_id, kind, now: true, night, build_id, req_id} (queued by planner_t_now, sent by the tick once
// fresh camera pictures are in and the 'now' build is made) rebuilds today's plan as it stands
// (replay_live_today, saved by every live day step), keeps what is begun or left for by now, and
// re-plans the rest of today on the now build; published as 'T: re-plan now'. Nothing else of the run
// changes (no record, no state), and an error marks only the request.
// v65 (5 Nov 2026, Phil: "Yes do 1"): run config early = a second morning look at the first camera
// pictures after sunrise (replay_early_at, ~45-100 min after it): the majority of the cameras and the
// airport re-conditions the odds (replay_build kind 'early' / 'earlyf', morning fit lk 2) and the rest of
// the day is re-planned from where the morning plan is (the sunrise spot is kept). Live: the dawn
// re-plan is published and saved (stage 'morning'), the camera re-plan comes once the pictures are in
// and is published as 'T: morning re-plan (cameras)'.
// v64 (4 Nov 2026): run config fade = morning builds at lead + 160 (the dawn look's odds fade with the hours
// after it, planner version AH); sun = every build at lead + 320 (hidden-peaks odds split by whether the model
// also forecast sun, so thin high cloud is not read as grey overcast, AI).
// v63 (4 Nov 2026): run config fog = builds at lead + 80, whose hidden-peaks odds before 10:00 local come
// from those hours alone (valley inversion fog on clear mornings; planner version AG).
// v62 (4 Nov 2026): run config midday = a second re-plan at local noon (planner version AF): the report on
// the peaks in the hour before noon re-conditions the odds from 13:00 (replay_build kind 'midday' /
// 'middayf'), and the afternoon is re-planned from where the morning plan is. Bench only (not live).
// v61 (3 Nov 2026): bench tests miss_seed (one S/GOD visit a week missed: not shot, not seen, so it must be
// fitted in again) and slow_drive (stats.slow: the route replayed with every drive x that factor, scored).
// v60 (3 Nov 2026): run config shrink / clim_hidden / shrink_morning = careful score: forecast values
// blended toward light x the usual clear-peaks share (see the block after the score loads).
// v59 (3 Nov 2026): run config week_exact = Z, the rest of the week solved exactly per weather version
// in the Monte Carlo (in place of the quick stand-in), from the stand-in's answer, never worse.
// v58 (3 Nov 2026): run config brute = B1 brute-force day (every free place, every start slot, all weather
// versions; exact for the day score), in place of polish on the night plan and morning re-plan.
// v57 (3 Nov 2026): run config dawn_before_min = free stops start no earlier than civil dawn less
// that many minutes (Phil: 25), replacing the 05:00 day start and the 03:45 sunrise exception.
// v56 (3 Nov 2026, T2, on top of v55 learn): run config wx = rain, gusts and the waterfall rained-yesterday bonus in
// the builds (lead + 20); every visit carries chance (calibrated odds of a good shot, from
// solver_t_calib), n_fc / n_good (forecasts good of all), why (one plain line), and on published
// plans light (front/side/back/soft/no sun) and move_why (T's plan, when it moved a stop off Phil's
// time or day); stats exp_big / exp_big_mine (expected good shots, S and GOD, T vs Phil's day, a
// place counted once) and exp_all / exp_all_mine, n_fc; bench nights carry exp_all / exp_big.
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
const DEPART_LOOK_MIN = 15;
// Light-only scenarios: sun visibility (k/50)^2, k = 0..50. Same expansion
// as SQL solver_light_scores; solver_light_terms gives dir/soft per slot.
const SCENARIOS = Array.from({ length: 51 }, (_, k) => (k / 50) ** 2);
// Light-only scores per trip day, kept in the isolate for 10 min (28 Oct 2026: the
// Faroes week plans re-read and re-expanded 12 light days every night and ran out
// of CPU). Read-only once built; same values as before.
const LIGHT_CACHE = new Map<string, { at: number; rows: any[] }>();
// Score builds read in the isolate, kept 10 min (30 Oct 2026: every step of a night
// re-read the same builds). A build never changes once made; rows are read only.
const SCORE_CACHE = new Map<string, { at: number; rows: any[] }>();

type PlanNode = { id: string; name: string; w: number; ws: number; dur: number; group: number; free: boolean; together: string | null; once: boolean };
type Visit = { n: number; arrive: number; start: number; end: number; drive: number; anchor: boolean };
type State = {
  t: number; loc: number; next: number; visited: Uint8Array; m0: number; m1: number; groupBest: Map<number, Uint8Array>;
  total: Float32Array; route: Visit[]; drive: number; over: number; j: number; mean: number; cvar: number; mc: number;
  nopt?: number;  // optional rated visits so far (run config visit_price, v80)
};
type DayPlan = {
  date: string; tripDate: string | null; light: boolean; start: number; end: number; dayStart: number; nSlots: number;
  routes: State[]; anchors: number; ms: number; winLo: number; winHi: number; extends?: number; capped?: boolean;
  brute?: { tried: number; capped: boolean; from_inc: boolean };
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

// Sunset after local noon on a date (UTC ms): run config end_at 'sunset' (v80, pace test D).
function sunsetAfterNoon(date: string, lat: number, lng: number, tz: string) {
  let t = zonedToUtc(date, 12 * 60, tz);
  for (let i = 0; i < 720 && sunAlt(lat, lng, t) > -0.833; i++) t += 60000;
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
  // Timing (28 Oct 2026, Faroes nights ran out of CPU): stats.t = ms to data loaded / to done.
  const tReq = performance.now();
  let tLoaded = 0, tWait = 0, tLight = 0;
  let nowReqId: number | null = null, nowOut: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    dayId = body.day_id ?? null;
    runId = body.run_id ?? null;
    kindOf = body.kind ?? null;
    nowReqId = body.now ? Number(body.req_id) : null;
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
      // rescore (live runs): body.night is a night already planned whose truth came in.
      const n: number = body.rescore || body.now || body.tool ? Number(body.night) : run.night;
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
    // trace (run config, 28 Oct 2026): progress marks in app_logs, to see how far a
    // night that runs out of CPU got (ms = wall since the request, wait = DB waits after the load).
    const mark = async (stage: string) => {
      if (!cfg.trace || runId == null) return;
      const t = performance.now();
      await db.from('app_logs').insert({ level: 'trace', message: 'solver-replay', data: { run_id: runId, kind: kindOf, stage,
        ms: Math.round(t - tReq), loaded: Math.round(tLoaded - tReq), wait: Math.round(tWait) } });
      tWait += performance.now() - t;
    };
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
    // the build with each model's sun calibrated (stored as lead + 10); learn (v55, Phil 3 Nov
    // 2026) the build whose hidden-peaks odds also learn from the season's last 30 days
    // before the day (lead + 40).
    // wx (run config, T2, v56, 3 Nov 2026): the builds that also weigh rain, wind and the waterfall
    // bonus (replay_build lead + 20, on top of learn's + 40; the truth with ERA5 rain and gusts as
    // lead 20, the morning build as lead 21). Truth and morning builds are matched by lead, so a
    // wx build never stands in for a plain one.
    // Drafts plan from light only (no forecast to carry rain or wind): no wx builds for them.
    const WX = cfg.wx && !cfg.draft ? 20 : 0;
    const FOG = cfg.fog && !cfg.draft ? 80 : 0;
    // vfit (v73, 6 Nov 2026, planner version AN): builds at lead + 640 use the hidden-peak and look odds
    // learned from the camera vote (counts hb + 10 / lk + 10); carried with SUN in every lead below.
    const FADE = cfg.fade && !cfg.draft ? 160 : 0, SUN = (cfg.sun && !cfg.draft ? 320 : 0) + (cfg.vfit && !cfg.draft ? 640 : 0) + (cfg.nopk && !cfg.draft ? 1280 : 0) + (cfg.cons && !cfg.draft ? 2560 : 0) + (cfg.sbfix && !cfg.draft ? 5120 : 0) + (cfg.blue && !cfg.draft ? 10240 : 0) + (cfg.layers && !cfg.draft ? 40960 : 0) + (cfg.runs && !cfg.draft ? 81920 : 0);
    const leadOf = (l: number) => (l === 1 && cfg.day1_lead != null ? Number(cfg.day1_lead) : l) + (cfg.calsun ? 10 : 0) + (cfg.learn ? 40 : 0) + WX + FOG + SUN;
    const { data: blds } = await db.from('replay_builds').select('id, replay_day_id, kind, lead, members, look_at')
      .in('replay_day_id', horizon.map(h => h.dayId).filter(x => x != null)).order('created_at', { ascending: false });
    const fcB = horizon.map(h => (blds ?? []).find(b => b.replay_day_id === h.dayId && b.kind === 'forecast' && b.lead === leadOf(h.lead)));
    // truth_vote (run config, v71, Phil 6 Nov 2026): days judged by the camera vote (truth build lead + 5).
    const trB = horizon.map(h => (blds ?? []).find(b => b.replay_day_id === h.dayId && b.kind === 'truth' && b.lead === WX + (cfg.truth_vote ? 5 : 0) + (cfg.nopk || cfg.nopk_judge ? 1280 : 0) + (cfg.blue || cfg.blue_judge ? 10240 : 0)));

    // A run's plan loads only what it plans on (and the truth of the day it does).
    const k0 = runId != null ? kindOf : null;
    // draft (run config, Phil 31 Oct 2026: T plans every trip day in the TEST app): the whole
    // remaining trip planned night after night from light only (no forecast reaches it yet), no
    // morning step, the day's expected value counted as shot; published as the week draft.
    const draft = !!cfg.draft;
    // A rescore (live) needs only the day's truth: the forecast builds may be gone by then.
    const nFc = body.rescore ? 0 : body.now ? 1 : draft ? 0 : k0 == null ? horizon.length : k0 === 'fc3' || k0 === 'fm1' || k0 === 'mr1' ? horizon.length : k0 === 'fc1' ? 1 : week ? Math.min(fcDays, horizon.length) : 0;
    const needLt = (h: number) => !body.rescore && (k0 == null || k0 === 'lt3' || (week && h >= nFc));
    const nTr = k0 == null || k0 === 'hs3' ? horizon.length : 1;
    // live (run config, 29 Oct 2026): real upcoming dates planned as the trip's days, so the
    // day's truth comes later (the night is scored by a rescore request once it is in).
    const live = !!cfg.live;
    if (fcB.slice(0, nFc).some(b => !b) || trB.slice(0, nTr).some(b => !b) && !live) return json({ ok: false, error: 'replay builds missing' }, 404);
    // mr1 / mrmc: tomorrow's forecast with the look at the peaks before sunrise (replay_build kind 'morning').
    // morning_fresh (run config, 28 Oct 2026, board b06): the morning build also swaps
    // ECMWF's night-before forecast for its overnight (00 UTC) run, ready before the look.
    const morning = (k0 === 'mr1' || k0 === 'mrmc') && !draft;
    const mKind = cfg.morning_fresh ? 'morningf' : 'morning';
    const mB = morning ? (blds ?? []).find(b => b.replay_day_id === horizon[0].dayId && b.kind === mKind && b.lead === 1 + WX + FOG + FADE + SUN) : undefined;
    if (morning && !mB && !live) return json({ ok: false, error: 'morning build missing' }, 404);
    // midday (v62): the noon look's build, same models as the morning one.
    const middayOn = morning && !!cfg.midday && !live && !cfg.early;
    const dKind = cfg.morning_fresh ? 'middayf' : 'midday';
    const dB = middayOn ? (blds ?? []).find(b => b.replay_day_id === horizon[0].dayId && b.kind === dKind && b.lead === 1 + WX + FOG + FADE + SUN) : undefined;
    if (middayOn && !dB) return json({ ok: false, error: 'midday build missing' }, 404);
    // early (v65): the camera look's build, same models and lead as the morning one. Live, it is built
    // only once the pictures are in, so the dawn request runs without it.
    const earlyOn = morning && !!cfg.early;
    const eKind = cfg.morning_fresh ? 'earlyf' : 'early';
    const eB = earlyOn ? (blds ?? []).find(b => b.replay_day_id === horizon[0].dayId && b.kind === eKind && b.lead === 1 + WX + FOG + FADE + SUN) : undefined;
    if (earlyOn && !eB && !live) return json({ ok: false, error: 'early build missing' }, 404);
    // depart (v69): the look before you leave, same models and lead as the morning one; built when needed.
    const departOn = morning && !!cfg.depart && !live;
    // hourly (v89, Phil 7 Nov 2026: "async mid day planning will help"): bench only. From hourly_from to
    // hourly_to (local hours), each hour the camera vote (replay_hidden_vote, the hour just ended) is read;
    // when it flips (peaks came out / clouded over) the rest of the day is re-planned on a look build made
    // for that time (as the look before you leave), at most hourly_max times a day.
    const hourlyOn = morning && !!cfg.hourly && !live;
    const depKind = cfg.morning_fresh ? 'departf' : 'depart';

    const { data: trip } = await db.from('trips').select('timezone').eq('id', tripId).single();
    const tz: string = trip?.timezone ?? 'UTC';
    // One row per stop (replay_scores_c): slot i = t0 + offs[i] x 15 min, v[i] = members.
    // Kept compact (27 Oct 2026, the bench ran out of memory with several plans
    // in one worker): slot time as ms, values (0-250) as bytes; the plans are unchanged.
    // to51: a week plan's forecast days, each model standing for an equal share of 51 versions
    // (done here, once per cached build, instead of on the rows after loading).
    const scoresOf = (buildId: string, to51 = false) => {
      const key = `${buildId}|${to51 ? 51 : 0}`, hit = SCORE_CACHE.get(key);
      if (hit && Date.now() - hit.at < 600000) return Promise.resolve(hit.rows);
      return all<any>((a, b) => db.from('replay_scores_c').select('stop_id, t0, offs, v, h')
        .eq('build_id', buildId).order('stop_id').range(a, b))
        .then(rows => {
          const out = rows.flatMap(r => {
            const t0 = Date.parse(r.t0);
            return (r.offs as number[]).map((o, i) => {
              const src = r.v[i] as number[], m = src.length;
              const v = to51 && m !== 51 ? Uint8Array.from({ length: 51 }, (_, k) => src[Math.floor(k * m / 51)]) : Uint8Array.from(src);
              // E4 (v92): each member's hidden-peak chance per slot (x 250), builds with the runs switch only.
              const hs = r.h?.[i] as number[] | undefined;
              const h = hs ? (to51 && m !== 51 ? Uint8Array.from({ length: 51 }, (_, k) => hs[Math.floor(k * m / 51)]) : Uint8Array.from(hs)) : null;
              return { stop_id: r.stop_id, ms: t0 + o * SLOT * 60000, v, h };
            });
          });
          if (out.length) {
            if (SCORE_CACHE.size >= 24) SCORE_CACHE.clear();
            SCORE_CACHE.set(key, { at: Date.now(), rows: out });
          }
          return out;
        });
    };
    // far_hidden (run config, v78, worksheet E2, 6 Nov 2026): on light-only days (past the forecast) the
    // cloudiest share of the 51 sun scenarios has the peaks hidden, that share being the place's usual
    // hidden share for the time of year (replay_clim_hidden; the camera-vote counts with vfit). Before, a
    // light-only day assumed the peaks were out (a 6:30 AM barn showed 100% on a draft).
    const lightOf = async (date: string) => {
      const h = cfg.far_hidden && !cfg.light_plain
        ? Number((await db.rpc('replay_clim_hidden', { p_trip: tripId, p_date: date, p_vote: !!cfg.vfit })).data ?? 0) : 0;
      const nh = Math.round(h * 51);
      const key = `${tripId}|${date}|${nh}|${cfg.blue ? 'b' : ''}`, hit = LIGHT_CACHE.get(key);
      if (hit && Date.now() - hit.at < 600000) return hit.rows;
      return all<any>((a, b) => db.rpc('solver_light_terms', { p_trip_id: tripId, p_dates: [date] }).order('slot_at').order('stop_id').range(a, b))
        .then(rows => {
          const t = performance.now();
          const out = rows.map(r => {
            const v = new Uint8Array(51);
            for (let k = 0; k < 51; k++) {
              const s = SCENARIOS[k], hid = k < nh;
              const f = r.fog_wanted ? (hid ? 1 : 0.6) : (hid ? 0.1 : 1);
              // blue (v84): a clear blue hour counts as a good shot (0.6, 0.75 with soft light wanted; was 0.3 / 0.4).
              const bdir = r.blue && cfg.blue ? (r.dir >= 0.35 ? 0.75 : 0.6) : r.dir;
              v[k] = Math.round(250 * Math.max(0, Math.min(1, (r.blue ? bdir : s * r.dir + (1 - s) * r.soft) * f)));
            }
            return { stop_id: r.stop_id, ms: Date.parse(r.slot_at), v };
          });
          tLight += performance.now() - t;
          if (LIGHT_CACHE.size >= 60) LIGHT_CACHE.clear();
          LIGHT_CACHE.set(key, { at: Date.now(), rows: out });
          return out;
        });
    };

    const [inputs, fcSc, trSc, ltSc, stopsAll, accs, tripDays] = await Promise.all([
      all<any>((a, b) => db.from('solver_stop_inputs')
        .select('stop_id, name, tier, star_vantage_id, duration_minutes, time_locked, day_id, shot_status, shot_value')
        .eq('trip_id', tripId).range(a, b)),
      Promise.all(fcB.slice(0, nFc).map(b => scoresOf(b!.id, week))),Promise.all(trB.slice(0, nTr).map(b => b ? scoresOf(b.id) : Promise.resolve([] as any[]))),
      Promise.all(horizon.map((h, i) => needLt(i) ? lightOf(h.date) : Promise.resolve([] as any[]))),
      all<any>((a, b) => db.from('stops').select('id, name, lat, lng, time_label, duration_minutes, drive_override_minutes, day_id, position, time_locked').eq('trip_id', tripId).range(a, b)),
      db.from('accommodations').select('name, lat, lng, check_in, check_out, nights').eq('trip_id', tripId).then(r => r.data ?? []),
      db.from('days').select('id, date').eq('trip_id', tripId).then(r => r.data ?? []),
    ]);
    if (fcSc.some(x => !x.length) || trSc.some((x, i) => !x.length && !(live && !trB[i]))) return json({ ok: false, error: 'empty replay builds' }, 404);
    let mSc = mB ? await scoresOf(mB.id) : [];
    if (mB && !mSc.length) return json({ ok: false, error: 'empty morning build' }, 404);
    const dSc = dB ? await scoresOf(dB.id) : [];
    if (dB && !dSc.length) return json({ ok: false, error: 'empty midday build' }, 404);
    const eSc = eB ? await scoresOf(eB.id) : [];
    if (eB && !eSc.length) return json({ ok: false, error: 'empty early build' }, 404);
    // Re-plan now (v66): the build made for this request (look = when it was asked).
    const nowReq = !!body.now && live && !draft;
    const nB = nowReq ? (blds ?? []).find(b => b.id === body.build_id) : undefined;
    if (nowReq && !nB) throw new Error('now build missing');
    const nSc = nB ? await scoresOf(nB.id) : [];
    if (nB && !nSc.length) throw new Error('empty now build');
    if (week && ltSc.some((x, i) => needLt(i) && !x.length)) return json({ ok: false, error: 'no light geometry for a later day' }, 404);
    // A draft plans tomorrow on light only too.
    if (draft) fcSc[0] = ltSc[0];
    // A week mixes forecast days (one member per model) with light-only days
    // (51 scenarios): each model stands for an equal share of the 51.
    if (week) for (const day of fcSc) for (const r of day) {
      const m = r.v.length; if (m === 51) continue;
      const src = r.v; r.v = Uint8Array.from({ length: 51 }, (_, k) => src[Math.floor(k * m / 51)]);
      if (r.h) { const hs = r.h; r.h = Uint8Array.from({ length: 51 }, (_, k) => hs[Math.floor(k * m / 51)]); }
    }
    // Careful score (run config shrink, v60, Phil 3 Nov 2026: "test the more careful score idea";
    // Y showed that searching harder on the forecast lost points): each forecast value is blended
    // toward a climate value that knows the light but not the weather: shrink x forecast +
    // (1 - shrink) x (the light-only value at that slot, averaged over its sun scenarios) x
    // (1 - 0.9 x clim_hidden, the usual share of daylight with the peaks hidden). The light
    // stays exact; how much a forecast's weather can move a plan shrinks. Night forecasts only;
    // shrink_morning also blends the morning build (made after a look at the peaks). New rows,
    // the cached ones are never changed.
    if (cfg.shrink != null) {
      const a = Math.max(0, Math.min(1, Number(cfg.shrink))), ch = Number(cfg.clim_hidden ?? 0.6);
      const blend = async (rows: any[], date: string) => {
        const lt = await lightOf(date);
        const clim = new Map<string, number>();
        for (const r of lt) { let s = 0; for (const x of r.v) s += x; clim.set(r.stop_id + '|' + r.ms, (s / r.v.length) * (1 - 0.9 * ch)); }
        return rows.map(r => {
          const c = clim.get(r.stop_id + '|' + r.ms); if (c == null) return r;
          const src = r.v as Uint8Array, v = new Uint8Array(src.length);
          for (let k = 0; k < src.length; k++) v[k] = Math.round(a * src[k] + (1 - a) * c);
          return { ...r, v };
        });
      };
      for (let i = 0; i < fcSc.length; i++) if (!(draft && i === 0)) fcSc[i] = await blend(fcSc[i], horizon[i].date);
      if (cfg.shrink_morning && mSc.length) mSc = await blend(mSc, horizon[0].date);
    }
    // Shot status is about the real trip; a replay starts from nothing shot. v53 (Phil, 1 Nov
    // 2026): the plans the app shows (publish) go by Phil's ticks instead: nailed = done for the
    // rest of the trip, got = only a clearly better shot is worth going back for, not shot =
    // still wanted, even where T had planned it before.
    // Walk the trip (run config walk, v86, Phil 6 Nov 2026: "tests that mimic going through a
    // week, marking things off each evening"): a bench run that plans through the app's ticks
    // path. Its marks are not Phil's: each evening the day's visits are marked from the truth
    // (replay_run_state.sets.ticks: hidden = missed, a good shot = got at its value, >= walk_nail
    // = nailed) and the next night plans from those marks as the app would. Points are still
    // scored on what was really shot (the run's state), so they compare with the usual bench.
    const walk = !!cfg.walk && !cfg.publish;
    const ticks = !!cfg.publish || walk;
    let walkTicks: Record<string, { s: string; v: number }> = {};
    if (walk && runId != null) {
      const { data: wk } = await db.from('replay_run_state').select('sets').eq('run_id', runId).eq('kind', body.kind).maybeSingle();
      walkTicks = ((wk?.sets as any)?.ticks ?? {}) as Record<string, { s: string; v: number }>;
    }
    if (walk) for (const r of inputs) { const t = walkTicks[r.stop_id]; r.shot_status = t?.s ?? null; r.shot_value = t?.v ?? null; }
    else if (!ticks) for (const r of inputs) { r.shot_status = null; r.shot_value = null; }
    const tickedIds = new Set<string>(inputs.filter((r: any) => r.shot_status === 'got' || r.shot_status === 'nailed').map((r: any) => r.stop_id));
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
    const tierOf = new Map<string, string>(rated.map(r => [r.stop_id, r.tier]));

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
    tLoaded = performance.now();
    await mark('loaded');
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
    // Calibration for chance (solver_t_calib, refit by solver_t_fit_calib from bench + Phil's grades).
    const region = regionOf(mid.lat);
    const CAL = { ...CAL_FALLBACK[region] };
    { const { data: cr } = await db.from('solver_t_calib').select('a, b').eq('region', region).maybeSingle();
      if (cr && Number.isFinite(cr.a) && Number.isFinite(cr.b)) { CAL.a = cr.a; CAL.b = cr.b; } }
    // What a subject already has (x250): nailed = everything, got = shot_value.
    let groupBase = new Map<number, number>();
    rated.forEach((r, i) => {
      const b = r.shot_status === 'nailed' ? 250 : r.shot_status === 'got' ? Math.round(250 * (r.shot_value ?? 0.5)) : 0;
      if (b > 0) groupBase.set(find(i), Math.max(groupBase.get(find(i)) ?? 0, b));
    });
    const tickBase = new Map(groupBase);
    // A ticked place is done through every entry of it (v54: a nailed entry leaves the plannable
    // stops, so "every place once" saw the place's other entries as never visited and forced one
    // back in on the last day).
    const tickedGroups = new Set<number>(rated.map((r, i) => (tickedIds.has(r.stop_id) ? find(i) : -1)).filter(g => g >= 0));

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
      // A day whose last stop is its last booking (the flight home, 30 Oct 2026: the Faroes
      // flight day had no route, every plan had to drive 85 min back to the hotel after it) ends there.
      const lastOwn = own[own.length - 1];
      const endAt = anchors.length && lastOwn && anchors[anchors.length - 1].id === lastOwn.id ? lastOwn.id : undefined;
      return { date: sp.date, light: sp.light, tripDate, startId: override ?? h.start, endId: override ?? endAt ?? h.end, anchors, own, earliestMin, latestMin };
    });
    if (days.some(d => !d.startId || !d.endId)) return json({ ok: false, error: 'no hotel: pass hotel_stop_id' }, 400);
    // Drive minutes between every stop any day can use.
    const ids = [...new Set([...rated.map(r => r.stop_id), ...days.flatMap(d => [d.startId!, d.endId!, ...d.anchors.map(a => a.id)])])];
    const tDm = performance.now();
    const dm = await all<any>((a, b) => db.from('solver_drive_matrix').select('from_stop_id, to_stop_id, minutes')
      .eq('trip_id', tripId).in('from_stop_id', ids).in('to_stop_id', ids).range(a, b));
    tWait += performance.now() - tDm;
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
    // Why a day has no route (30 Oct 2026, the Faroes bench's last two days): its ends, bookings and window.
    const whyNot = (d: typeof days[number]) => {
      const nm = (id?: string) => stopById.get(id ?? '')?.name ?? id;
      const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
      return { start: nm(d.startId), end: nm(d.endId), earliest: d.earliestMin, latest: d.latestMin,
               bookings: d.anchors.map(a => `${nm(a.id)} ${hm(a.startMs)} ${a.dur}m`),
               legs: d.anchors.map((a, i) => { const f = pos.get(i ? d.anchors[i - 1].id : d.startId!), t = pos.get(a.id); return f != null && t != null ? D[f][t] : null; })
                 .concat([(() => { const f = pos.get(d.anchors.length ? d.anchors[d.anchors.length - 1].id : d.startId!), t = pos.get(d.endId!); return f != null && t != null ? D[f][t] : null; })()]) };
    };

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
    // Polish stops sooner (run config polish_cap, default 250k; 30 Oct 2026: on the Faroes one
    // polish could take ~6 s and every retry of that night died; the most a Teton polish has
    // needed is ~150k). A capped search keeps the best full day it found.
    let exactCap = EXACT_MAX_EXTENDS;
    type Brute = { inc?: State | null; budgetMs?: number; cap?: number };
    const planDay = (day: typeof days[number], scores: any[], search = true, only?: number[], must?: number[], skip?: Set<number>, from?: From, exact?: number[], brute?: Brute): DayPlan => {
      const td0 = performance.now();
      const cand = (exact ?? only ?? freeNodes).filter(n => !skip?.has(n));
      let nExt = 0, capped = false;
      const mustSet = new Set(must ?? []);
      const H0 = pos.get(day.startId!)!, H = pos.get(day.endId!)!;
      const anchors = day.anchors.map(a => ({ n: pos.get(a.id)!, startMs: a.startMs, dur: a.dur }));
      const slotMs = scores.map(r => r.ms);
      // From 90 min before the first light (else the window opens), to an
      // hour after the last (else it closes); bookings always fit.
      // Run config dawn_before_min (v57, Phil 3 Nov 2026: "no stop before 25 minutes to first light"): free
      // stops start no earlier than civil dawn less that many minutes, in place of the 05:00 window and the
      // 03:45 sunrise exception; a booked arrival later than that still opens the day.
      const dawnLo = cfg.dawn_before_min != null ? civilDawn(day.date, mid.lat, mid.lng, tz!) - Number(cfg.dawn_before_min) * 60000 : null;
      const winStart0 = zonedToUtc(day.date, day.earliestMin ?? hhmm(EARLIEST), tz!), winEnd = zonedToUtc(day.date, day.latestMin ?? hhmm(LATEST), tz!);
      const winStart = dawnLo == null ? winStart0 : day.earliestMin != null ? Math.max(winStart0, dawnLo) : dawnLo;
      const earlyStart = dawnLo != null || day.light || day.earliestMin != null ? winStart : zonedToUtc(day.date, hhmm(SUNRISE_EARLIEST), tz!);
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
      // Pace test D (v80, run config end_at 'sunset'): free stops end by sunset instead.
      const darkMin = placed.length && !cfg.no_dark
        ? ((cfg.end_at === 'sunset' ? sunsetAfterNoon(day.date, mid.lat, mid.lng, tz!) : civilDusk(day.date, mid.lat, mid.lng, tz!)) - dayStart) / 60000 : Infinity;

      // V per node per slot, W = best V over the visit window starting there.
      const V: (Uint8Array | null)[][] = nodes.map(() => new Array(nSlots).fill(null));
      const HP: (Uint8Array | null)[][] = nodes.map(() => new Array(nSlots).fill(null));
      for (const r of scores) {
        const ni = pos.get(r.stop_id); if (ni == null) continue;
        const ti = Math.round((r.ms - dayStart) / (SLOT * 60000));
        if (ti >= 0 && ti < nSlots) { V[ni][ti] = r.v; HP[ni][ti] = (r as any).h ?? null; }  // read only (W copies before merging)
      }
      // E4 / E7 whole-day weather (v92, run config runs): a visit is worth its best moment, and hidden / clear
      // spells persist (Teton winter: a hidden hour stays hidden ~90%, a clear one turns hidden ~10%), so a long
      // visit that starts under cloud has a real chance of a clear spell. Per member, the peaks' state is
      // followed slot by slot (it stays put with chance rho per 15 min, else is drawn fresh from that slot's
      // hidden chance) and the visit's value is the expected best moment. Before: the best slot's expected value.
      const RUNS = !!cfg.runs && !cfg.draft;
      const RHO = Math.pow(Math.max(0, Math.min(0.99, Number(cfg.runs_rho ?? 0.8))), 0.25);
      const runBest = (ni: number, start: number, len: number): Uint8Array | null => {
        const ts: number[] = [];
        for (let t = start; t < Math.min(start + len, nSlots); t++) if (V[ni][t]) { if (!HP[ni][t]) return null; ts.push(t); }
        if (!ts.length) return null;
        const out = new Uint8Array(M);
        for (let k = 0; k < M; k++) {
          let vis = new Map<number, number>(), hid = new Map<number, number>();
          ts.forEach((t, j) => {
            const v = V[ni][t]![k], p = HP[ni][t]![k] / 250;
            const b = Math.min(250, Math.round(v / (1 - 0.9 * p))), c = Math.round(b * 0.1);
            if (j === 0) { vis.set(b, 1 - p); hid.set(c, p); return; }
            const p11 = RHO + (1 - RHO) * p, p01 = (1 - RHO) * p;
            const nv = new Map<number, number>(), nh = new Map<number, number>();
            const add = (m: Map<number, number>, val: number, pr: number) => { if (pr > 0) m.set(val, (m.get(val) ?? 0) + pr); };
            for (const [val, pr] of hid) { add(nh, Math.max(val, c), pr * p11); add(nv, Math.max(val, b), pr * (1 - p11)); }
            for (const [val, pr] of vis) { add(nh, Math.max(val, c), pr * p01); add(nv, Math.max(val, b), pr * (1 - p01)); }
            vis = nv; hid = nh;
          });
          let e = 0; for (const [val, pr] of vis) e += val * pr; for (const [val, pr] of hid) e += val * pr;
          out[k] = Math.max(0, Math.min(250, Math.round(e)));
        }
        return out;
      };
      const wCache = new Map<number, Uint8Array | null>();
      const W = (ni: number, start: number): Uint8Array | null => {
        if (start < 0 || start >= nSlots) return null;
        const key = ni * 10000 + start;
        if (wCache.has(key)) return wCache.get(key)!;
        const len = Math.ceil(nodes[ni].dur / SLOT);
        if (RUNS) { const rb = runBest(ni, start, len); if (rb) { wCache.set(key, rb); return rb; } }
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
      // Pace test C (v80, run config chance_floor): an optional rated stop only where at least that share of
      // weather versions is good; required places (every-place rule) and bookings are exempt.
      const FLOOR = Number(cfg.chance_floor ?? 0);
      const VISIT_PRICE = Number(cfg.visit_price ?? 0);
      const floorOk = (ni: number, i: number) => !FLOOR || nodes[ni].w <= 0 || mustSet.has(ni) || pGood(ni, i) >= FLOOR;
      const startOk = (ni: number, i: number) => (i >= winLo || (nodes[ni].w >= 5 && i >= earlyLo && pGood(ni, i) >= SUNRISE_MIN_P)) && floorOk(ni, i);
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
        // Pace test B (v80, run config visit_price): each optional rated visit costs that many tier points.
        const nopt = (st.nopt ?? 0) + (nodes[n].w > 0 && !mustSet.has(n) && !anchor ? 1 : 0);
        return {
          t: (i + len) * SLOT, loc: n, next: st.next + (anchor ? 1 : 0), visited, m0, m1, groupBest, total, drive: d, over: o, mc,
          route: [...st.route, { n, arrive: st.t + drive, start: i * SLOT, end: (i + len) * SLOT, drive, anchor }], nopt,
          mean: m.mean, cvar: m.cvar, j: m.j - DRIVE_PENALTY * (d + D[n][H]) - LONG_LEG_PENALTY * (o + over(D[n][H])) + MUST_BONUS * mc - VISIT_PRICE * nopt,
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
      if (brute && search) {
        // B1 brute force (Phil, 3 Nov 2026: "every stop, time, weather at that given time,
        // light"): every free place in every order, every 15-min start slot, scored on all
        // weather versions (each slot's V already holds that moment's light, sun / cloud,
        // hidden peaks, rain and wind). Depth first, exact for the day's score j:
        //  - a later start of a visit is skipped only when an earlier allowed start is at least
        //    as good in every weather version (finishing sooner never hurts: one can wait);
        //  - a branch stops when even its best case cannot beat the best day found so far:
        //    per version, today's value plus the top gains of the places still open that could
        //    still fit (j is monotone in every version's total, drive costs only grow);
        //  - the best day found starts as the incumbent (T's day), so the result is never worse.
        // Stops (keeps the best found, capped = true) at the node cap or the time budget.
        const tb = performance.now(), budget = brute.budgetMs ?? 1200, cap = brute.cap ?? 3_000_000;
        const tgm = new Map<string, number[]>();
        for (const n of cand) { const k = nodes[n].together; if (k) tgm.set(k, [...(tgm.get(k) ?? []), n]); }
        const tgs = [...tgm.values()].filter(g => g.length > 1);
        const ok = (st: State) => st.next === anchors.length && st.t + D[st.loc][H] <= dayMin
          && tgs.every(g => g.every(n => st.visited[n]) || g.every(n => !st.visited[n]))
          && (!mustSet.size || st.mc === mustSet.size);
        // The most each node can add today, per version (its best slot, nothing else shot today).
        const G: (Float32Array | null)[] = nodes.map((nd, n) => {
          if (nd.w <= 0) return null;
          let g: Float32Array | null = null;
          for (let t = 0; t < nSlots; t++) {
            const v = V[n][t]; if (!v) continue;
            g ??= new Float32Array(M);
            for (let k = 0; k < M; k++) { const x = nd.w * gain(nd.group, v[k], undefined) / 250; if (x > g[k]) g[k] = x; }
          }
          return g;
        });
        const minDur = Math.max(SLOT, Math.min(...cand.map(n => nodes[n].dur)));
        // Start slots of a visit from i0 on that no earlier allowed start beats in every version.
        const slotCache = new Map<number, number[]>();
        const slotsFrom = (s: number, i0: number) => {
          const key = s * 10000 + i0;
          let r = slotCache.get(key);
          if (!r) {
            r = []; const kept: Uint8Array[] = [];
            for (let i = Math.max(0, i0); i < nSlots; i++) {
              const w = W(s, i); if (!w || !startOk(s, i)) continue;
              if (kept.some(q => { for (let k = 0; k < M; k++) if (w[k] > q[k]) return false; return true; })) continue;
              kept.push(w); r.push(i);
            }
            slotCache.set(key, r);
          }
          return r;
        };
        const col = new Float32Array(cand.length + 1);
        const bound = (st: State) => {
          const u = Float32Array.from(st.total);
          for (let a = st.next; a < anchors.length; a++) { const g = G[anchors[a].n]; if (g) for (let k = 0; k < M; k++) u[k] += g[k]; }
          const open = cand.filter(n => !st.visited[n] && G[n]);
          const K = Math.min(open.length, Math.max(0, Math.floor((winMin - st.t) / minDur)));
          if (K > 0) for (let k = 0; k < M; k++) {
            const c = col.subarray(0, open.length);
            for (let q = 0; q < open.length; q++) c[q] = G[open[q]]![k];
            c.sort();
            for (let q = open.length - K; q < open.length; q++) u[k] += c[q];
          }
          return metric(u).j - DRIVE_PENALTY * st.drive - LONG_LEG_PENALTY * st.over + MUST_BONUS * mustSet.size;
        };
        const inc = brute.inc && ok(brute.inc) ? brute.inc : null;
        let bestSt: State | null = inc, bestJ = inc ? inc.j : -Infinity, tried = 0, stopped = false;
        const dfs = (st: State) => {
          if (stopped) return;
          tried++;
          if (tried > cap || ((tried & 1023) === 0 && performance.now() - tb > budget)) { stopped = true; return; }
          if (ok(st) && st.j > bestJ + 1e-9) { bestSt = st; bestJ = st.j; }
          if (bound(st) <= bestJ + 1e-9) return;
          const kids: State[] = [];
          const nextA = st.next < anchors.length ? anchors[st.next] : null;
          const nextSlot = nextA ? anchorSlot[st.next] : Infinity;
          if (nextA) {
            const drive = D[st.loc][nextA.n];
            const afterBooking = st.next > 0 && st.route.length > 0 && st.route[st.route.length - 1].anchor;
            if (Number.isFinite(drive) && (st.t + drive <= nextSlot * SLOT || afterBooking)) kids.push(extend(st, nextA.n, nextSlot, drive, true));
          }
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
            for (const i of slotsFrom(s, i0)) { if (i > iMax) break; kids.push(extend(st, s, i, drive, false)); }
          }
          kids.sort((a, b) => b.j - a.j);
          for (const c of kids) { if (stopped) return; dfs(c); }
        };
        dfs(start);
        const bs = bestSt as State | null;
        return { date: day.date, tripDate: day.tripDate, light: day.light, start: H0, end: H, dayStart, nSlots, routes: bs ? [bs] : [],
                 anchors: anchors.length, ms: Math.round(performance.now() - td0), winLo, winHi, W, peak,
                 extends: nExt, capped: stopped, brute: { tried, capped: stopped, from_inc: !!bs && bs === inc } };
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
          if (exact && nExt > exactCap) { capped = true; break; }
          const nextA = st.next < anchors.length ? anchors[st.next] : null;
          const nextSlot = nextA ? anchorSlot[st.next] : Infinity;
          // The next booking, at its fixed time.
          if (nextA) {
            const drive = D[st.loc][nextA.n];
            // Back-to-back bookings keep the itinerary's times (30 Oct 2026: a ferry stop's length
            // already holds the crossing, which the drive table adds again).
            const afterBooking = st.next > 0 && st.route.length > 0 && st.route[st.route.length - 1].anchor;
            if (Number.isFinite(drive) && (st.t + drive <= nextSlot * SLOT || afterBooking)) keep(extend(st, nextA.n, nextSlot, drive, true));
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
    // chance (T2, 3 Nov 2026, Phil: "make sure 70% means 70%"): p_good is the share of the
    // 6-8 forecasts with a good shot, so it moves in steps of 17% and said 0% for visits that came
    // good 7-23% of the time. chance = the calibrated odds of a good shot (truth V >= 0.6) from
    // the visit's mean value: logistic fit on T's bench visits (solver_t_calib, refit by
    // solver_t_fit_calib(); held-out Brier Teton 0.094 vs 0.128 for p_good, Faroes 0.158 vs 0.218).
    const calOf = (v: number) => calChance(CAL, v);
    const chance = (p: DayPlan, n: number, slot: number) => {
      if (nodes[n].w <= 0) return null;
      const w = p.W(n, slot); if (!w) return null;
      let s = 0, g = 0;
      for (const x of w) { s += x; if (x >= GOOD) g++; }
      const value = s / w.length / 250;
      return { value: r2(value), p_good: r2(g / w.length), chance: r2(calOf(value)),
               n_fc: p.light ? null : w.length, n_good: p.light ? null : g, peak_at: iso(p, p.peak(n, slot) * SLOT) };
    };
    // reason (T2): one short line per visit for the app, in plain words, from what the plan used.
    const localMin = (ms: number, date: string) => (ms - zonedToUtc(date, 0, tz)) / 60000;
    const reasonOf = (p: DayPlan, v: Visit, c: ReturnType<typeof chance>) => {
      const peakMs = c ? Date.parse(c.peak_at) : 0;
      return reasonText({ anchor: v.anchor, rated: !!c, lightOnly: p.light, nGood: c?.n_good ?? null, nFc: c?.n_fc ?? null,
        peakMinutes: c ? localMin(peakMs, p.date) : 0, peakAlt: c ? sunAlt(mid.lat, mid.lng, peakMs) : 0,
        waitMin: v.start - v.arrive, once: nodes[v.n].once });
    };
    const visitsOf = (p: DayPlan, st: State) => st.route.map(v => {
      const c = chance(p, v.n, Math.round(v.start / SLOT));
      return {
        date: p.date, trip_date: p.tripDate, stop_id: nodes[v.n].id, name: nodes[v.n].name, booked: v.anchor,
        arrive: iso(p, v.arrive), start: iso(p, v.start), end: iso(p, v.end),
        wait_min: Math.round(v.start - v.arrive), drive_min: Math.round(v.drive),
        ...c, why: reasonOf(p, v, c),
      };
    });
    // Expected good shots (T2): the sum of the calibrated chances, a subject counted once (its best
    // visit), for every rated place and for the top tiers (S and GOD) alone.
    const goodShots = (vs: any[]) => goodShotsOf(vs.map(x => {
      const n0 = pos.get(x.stop_id), t = tierOf.get(x.stop_id);
      return { chance: x.chance, key: n0 == null ? null : String(nodes[n0].group), top: t === 'S' || t === 'GOD' };
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
      const tKs = performance.now();
      const { data: ks } = await db.from('replay_run_state').select('night, state, sets, note').eq('run_id', runId).eq('kind', kind).single();
      tWait += performance.now() - tKs;
      if (!ks) return json({ ok: false, error: 'no state for this plan' }, 404);
      const n: number = body.rescore || body.now || body.tool ? Number(body.night) : run.night;
      if (body.rescore) {
        // Live: score a night already planned against the truth that has come in since.
        if (!trSc[0].length) return json({ ok: false, error: 'no truth yet' }, 404);
        const tN = planDay({ ...days[0], light: false }, trSc[0], false);
        const { data: rd } = await db.from('replay_run_days').select('visits').eq('run_id', runId).eq('night', n).eq('kind', kind).single();
        if (!rd) return json({ ok: false, error: 'night not planned' }, 404);
        const vs = ((rd.visits ?? []) as any[]).filter(v => pos.has(v.stop_id) && v.start);
        const visits = vs.map(v => ({ n: pos.get(v.stop_id)!, startMs: Date.parse(v.start) }));
        const realized = r3(evalVisits(tN, visits));
        const scored = ((rd.visits ?? []) as any[]).map(v => pos.has(v.stop_id) && v.start ? { ...v, truth: r2(truthAt(tN, { n: pos.get(v.stop_id)!, startMs: Date.parse(v.start) }) / 250) } : v);
        await db.from('replay_run_days').update({ realized, visits: scored }).eq('run_id', runId).eq('night', n).eq('kind', kind);
        return json({ ok: true, rescored: true, run_id: runId, kind, night: n, realized });
      }
      if (body.tool) {
        // Tool mode (v81, worksheet G1, 6 Nov 2026): Claude plans one past night with the solver as a tool.
        // Read only, never saves. Nothing shot before (groupBase empty), so Claude's plan and T's are
        // graded on the same footing. ops: context | solve {must, skip} | score {visits} | grade {visits}.
        groupBase = new Map();
        const op = String(body.tool), fc = fcSc[0];
        if (!fc.length) return json({ ok: false, error: 'no forecast build for this night' }, 404);
        const p = planDay({ ...days[0], light: false }, fc, false);
        const slotOf = (ms: number) => Math.round((ms - p.dayStart) / (SLOT * 60000));
        const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
        const ratedN = nodes.map((_, i) => i).filter(i => nodes[i].w > 0);
        const nOf = (id: string) => pos.get(id);
        const visitsIn = (vs: any[]) => (vs ?? []).map(v => ({ n: nOf(String(v.stop_id)), startMs: Date.parse(String(v.start)) }))
          .filter(v => v.n != null && Number.isFinite(v.startMs)).sort((a, b) => a.startMs - b.startMs) as { n: number; startMs: number }[];
        const valueOf = (vs: { n: number; startMs: number }[]) => {
          const M = fc[0].v.length, total = new Float32Array(M), best = new Map<number, Uint8Array>();
          const per = vs.map(v => {
            const slot = slotOf(v.startMs), w = nodes[v.n].w > 0 ? p.W(v.n, slot) : null;
            if (w) {
              const g = nodes[v.n].group, prev = best.get(g);
              for (let k = 0; k < M; k++) total[k] += nodes[v.n].w * gain(g, w[k], prev?.[k]) / 250;
              best.set(g, prev ? Uint8Array.from(prev, (x, k) => Math.max(x, w[k])) : w);
            }
            const c = chance(p, v.n, slot);
            return { stop_id: nodes[v.n].id, name: nodes[v.n].name, start: clock(v.startMs), p_good: c?.p_good ?? null, value: c?.value ?? null };
          });
          const m = metric(total);
          return { mean: r3(m.mean), bad_day: r3(m.cvar), score: r3(m.j), visits: per };
        };
        if (op === 'context') {
          const hours: number[] = [];
          for (let sl = p.winLo; sl <= p.winHi; sl += 4) hours.push(sl);
          return json({ ok: true, date: days[0].date, trip_date: days[0].tripDate, tz,
            start_place: nodes[p.start].name, end_place: nodes[p.end].name,
            window: { from: clock(p.dayStart + p.winLo * SLOT * 60000), to: clock(p.dayStart + p.winHi * SLOT * 60000),
                      sunrise: clock(sunrise(days[0].date, mid.lat, mid.lng, tz)), dark: clock(civilDusk(days[0].date, mid.lat, mid.lng, tz)) },
            tier_points: TIER_W,
            stops: ratedN.map(n => ({ stop_id: nodes[n].id, name: nodes[n].name, tier: tierOf.get(nodes[n].id) ?? null, minutes: nodes[n].dur,
              once_only: nodes[n].once, together: nodes[n].together,
              drive_from_start: Math.round(D[p.start][n]), drive_to_end: Math.round(D[n][p.end]),
              hourly: hours.map(sl => { const c = chance(p, n, sl); return [clock(p.dayStart + sl * SLOT * 60000), c ? Math.round(c.p_good * 100) : null]; }) })),
            drive_minutes: Object.fromEntries(ratedN.map(a => [nodes[a].id, Object.fromEntries(ratedN.filter(b => b !== a).map(b => [nodes[b].id, Math.round(D[a][b])]))])) });
        }
        if (op === 'solve') {
          const must = (body.must ?? []).map((id: string) => nOf(id)).filter((x: any) => x != null) as number[];
          const skipS = new Set<number>((body.skip ?? []).map((id: string) => nOf(id)).filter((x: any) => x != null));
          let r = planDay({ ...days[0], light: false }, fc, true, undefined, must, skipS);
          // polish (v85, grading only): the exact search T runs on its night plan, over the plan's places, the
          // required ones and the next best by forecast up to 7, kept when it scores higher.
          if (body.polish && r.routes[0]) {
            const E = new Set<number>([...r.routes[0].route.filter(v => nodes[v.n].free).map(v => v.n), ...must]);
            const mean = (x: number) => { let b = 0; for (let sl = p.winLo; sl <= p.winHi; sl++) { const w = p.W(x, sl); if (w) { let t = 0; for (const y of w) t += y; b = Math.max(b, t / w.length); } } return b * nodes[x].w; };
            for (const x of freeNodes.filter(x => !E.has(x) && !skipS.has(x)).sort((a, b) => mean(b) - mean(a))) { if (E.size >= 7) break; E.add(x); }
            if (E.size <= 9) {
              exactCap = 250_000;
              const pe = planDay({ ...days[0], light: false }, fc, true, undefined, must, skipS, undefined, [...E]);
              exactCap = EXACT_MAX_EXTENDS;
              if (pe.routes[0] && pe.routes[0].j > r.routes[0].j + 1e-6) r = pe;
            }
          }
          return json({ ok: true, plans: r.routes.slice(0, 3).map(st => ({
            ...valueOf(st.route.map(v => ({ n: v.n, startMs: p.dayStart + v.start * 60000 }))),
            stops: st.route.map(v => ({ stop_id: nodes[v.n].id, name: nodes[v.n].name, start_iso: new Date(p.dayStart + v.start * 60000).toISOString(),
              start: clock(p.dayStart + v.start * 60000), end: clock(p.dayStart + v.end * 60000), drive_min: Math.round(v.drive) })),
            back: clock(p.dayStart + (st.t + D[st.loc][p.end]) * 60000) })) });
        }
        if (op === 'score') {
          const vs = visitsIn(body.visits);
          const problems: string[] = [];
          let loc = p.start, free = p.dayStart + p.winLo * SLOT * 60000, last = 0;
          for (const v of vs) {
            const arrive = free + D[loc][v.n] * 60000;
            if (v.startMs + 60000 < arrive) problems.push(`${nodes[v.n].name}: arrives ${Math.round((arrive - v.startMs) / 60000)} min after its start time`);
            const end = v.startMs + nodes[v.n].dur * 60000;
            if (end > civilDusk(days[0].date, mid.lat, mid.lng, tz) && nodes[v.n].w > 0) problems.push(`${nodes[v.n].name}: runs past dark`);
            free = Math.max(end, arrive + nodes[v.n].dur * 60000); loc = v.n; last = free;
          }
          const back = (last || free) + D[loc][p.end] * 60000;
          return json({ ok: true, ...valueOf(vs), back: clock(back), problems });
        }
        if (op === 'stop_detail') {
          // Every weather version's value for one place in 15-min steps (0-100), with the light and sun height.
          const n0 = nOf(String(body.stop_id));
          if (n0 == null) return json({ ok: false, error: 'unknown stop_id' }, 400);
          const vid = (rated.find(r => r.stop_id === nodes[n0].id) as any)?.star_vantage_id;
          const { data: lc } = vid ? await db.from('solver_light_cache').select('slot_at, light, sun_alt')
            .eq('vantage_id', vid).eq('local_date', days[0].date).order('slot_at') : { data: [] as any[] };
          const lightAt = new Map((lc ?? []).map((r: any) => [Date.parse(r.slot_at), r]));
          const raw: any[] = fcB[0] ? await scoresOf(fcB[0].id) : fc;  // the models' own values, not stretched to 51
          const rows = raw.filter((r: any) => r.stop_id === nodes[n0].id).sort((a: any, b: any) => a.ms - b.ms);
          return json({ ok: true, name: nodes[n0].name, minutes: nodes[n0].dur, versions: raw[0]?.v.length ?? 0,
            note: 'Each number is one weather model\'s value for a shot at that time (100 = peaks out in the light wanted, 0 = hidden or rained out); a visit counts its best moment.',
            slots: rows.map((r: any) => { const l: any = lightAt.get(r.ms);
              return { t: clock(r.ms), light: l?.light ?? null, sun: l ? Math.round(l.sun_alt) : null, v: Array.from(r.v as Uint8Array, x => Math.round(x / 2.5)) }; }) });
        }
        if (op === 'weather_detail') {
          // Each weather model's cloud cover (%) and direct sun (W/m2) by hour at the trip's forecast point.
          const { data: pl } = await db.from('replay_places').select('fc_point').eq('trip_id', tripId).maybeSingle();
          const { data: wx } = pl ? await db.from('replay_wx_day').select('model, cloud, dr').eq('point_key', pl.fc_point).eq('day', days[0].date) : { data: [] as any[] };
          const hrs = Array.from({ length: 24 }, (_, h) => h);
          return json({ ok: true, point: pl?.fc_point ?? null, hours_utc: hrs,
            models: (wx ?? []).filter((m: any) => !/@[0-9]/.test(m.model)).map((m: any) => ({ model: m.model, cloud: m.cloud, sun: m.dr })) });
        }
        if (op === 'audit') {
          // Full rule check (v85): can these places be scheduled together under every solver rule (window, early
          // start, gear window, keep-together, dark, bookings)? The exact search must fit them all.
          const E = [...new Set(visitsIn(body.visits).map(v => v.n))].filter(n => nodes[n].free);
          if (E.length > 10) return json({ ok: true, checked: false, reason: 'too many places to check exactly' });
          exactCap = 400_000;
          const pe = planDay({ ...days[0], light: false }, fc, true, undefined, E, new Set<number>(), undefined, E);
          exactCap = EXACT_MAX_EXTENDS;
          const st = pe.routes.find(r => E.every(n => r.visited[n])) ?? null;
          return json({ ok: true, checked: true, feasible: !!st, capped: !!pe.capped,
            missing: st ? [] : E.filter(n => !(pe.routes[0]?.visited[n])).map(n => nodes[n].name) });
        }
        if (op === 'grade') {
          if (!trSc[0].length) return json({ ok: false, error: 'no truth for this night' }, 404);
          const tN = planDay({ ...days[0], light: false }, trSc[0], false);
          const vs = visitsIn(body.visits);
          return json({ ok: true, realized: r3(evalVisits(tN, vs)), visits: vs.map(v => ({ name: nodes[v.n].name, truth: r2(truthAt(tN, v) / 250) })) });
        }
        return json({ ok: false, error: `unknown tool ${op}` }, 400);
      }
      if (ks.night !== n && !body.now) {
        await db.from('replay_run_state').update({ status: 'idle', updated_at: new Date().toISOString() }).eq('run_id', runId).eq('kind', kind);
        return json({ ok: true, skipped: 'already planned', run_id: runId, kind, night: ks.night });
      }
      await mark('state');
      // What a plan has shot, by group (key: the group's first stop id). The app's plans (ticks):
      // the days already done count only through Phil's ticks, not through what T planned for
      // them; a week draft still counts its own earlier draft days (its state from night 0 on).
      const shotBefore: Record<string, number> = ticks && !draft && !walk ? {} : (ks.state ?? {});
      const keyOf = (g: number) => rated[g].stop_id;
      const groupOfKey = new Map(rated.map((r, i) => [r.stop_id, find(i)]));
      groupBase = new Map<number, number>(ticks ? tickBase : []);
      // walk: plans see only the marks; the truth of what was shot scores the points (truthBase).
      const truthBase = new Map<number, number>();
      for (const [k, v] of Object.entries(shotBefore)) {
        const g = groupOfKey.get(k); if (g == null) continue;
        if (walk) truthBase.set(g, Math.max(truthBase.get(g) ?? 0, v));
        else groupBase.set(g, Math.max(groupBase.get(g) ?? 0, v));
      }
      let walkStats: any = null;
      // What happened on the day being done (live: not known yet, scored later; what a
      // visit got is counted as the forecast's mean until then).
      const truthN = trSc[0].length ? planDay({ ...days[0], light: false }, trSc[0], false) : null;
      const fcN = truthN ? null : planDay({ ...days[0], light: draft }, fcSc[0], false);
      const meanAt = (tp: DayPlan, v: { n: number; startMs: number }) => {
        const w = tp.W(v.n, Math.round((v.startMs - tp.dayStart) / (SLOT * 60000))); if (!w) return 0;
        let t = 0; for (const x of w) t += x; return t / w.length;
      };
      await mark('truth');
      let row: any;
      // Missed-stop test (run config miss_seed, v61, Phil 3 Nov 2026): on one night per week
      // (picked from the week's start date and the seed) the first planned S or GOD visit is
      // missed: it earns nothing and is not counted as shot or seen, so the planner has to fit
      // it in again later in the week. Bench only (needs the truth; never on published runs).
      let missNight = -1, missedNode: number | null = null;
      if (cfg.miss_seed != null && trSc[0].length && !cfg.publish) {
        let h = 0; for (const ch of `${run.start_date}|${cfg.miss_seed}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        missNight = h % Math.max(1, run.nights);
      }
      const pickMissed = (route: { n: number }[]) => (missNight === n ? (route.find(v => nodes[v.n].w >= 5)?.n ?? null) : null);
      // Slow-drive test (run config slow_drive, v61): the day's route replayed with every drive
      // that much longer (1.25 = winter roads); each visit starts when it really could (never
      // before its plan) and is scored against the truth then. Stats only: the plan is unchanged.
      const slowOf = (vs: { n: number; startMs: number }[]) => {
        const mult = Number(cfg.slow_drive), H0 = pos.get(days[0].startId!);
        let prevEnd: number | null = null, prevN: number | null = H0 ?? null, late = 0, delay = 0;
        const out = [...vs].sort((a, b) => a.startMs - b.startMs).map(v => {
          const leg = prevN != null ? D[prevN][v.n] : 0, ok = Number.isFinite(leg);
          const earliest = prevEnd == null ? v.startMs + (ok ? leg * (mult - 1) * 60000 : 0) : prevEnd + (ok ? leg * mult * 60000 : 0);
          const s = Math.max(v.startMs, earliest);
          if (s > v.startMs + 60000) { late++; delay += (s - v.startMs) / 60000; }
          prevEnd = s + nodes[v.n].dur * 60000; prevN = v.n;
          return { n: v.n, startMs: s };
        });
        return { out, late, delay: Math.round(delay) };
      };
      const record = (visits0: { n: number; startMs: number }[], extra: any) => {
        const visits = missedNode == null ? visits0 : visits0.filter(v => v.n !== missedNode);
        const planBase = groupBase;
        if (walk) groupBase = truthBase;
        const realized = truthN ? evalVisits(truthN, visits) : null;
        groupBase = planBase;
        const shot = { ...shotBefore };
        for (const v of visits) {
          if (nodes[v.n].w <= 0) continue;
          const k = keyOf(nodes[v.n].group);
          shot[k] = Math.max(shot[k] ?? 0, truthN ? truthAt(truthN, v) : meanAt(fcN!, v));
        }
        row = { run_id: runId, night: n, kind, replay_date: days[0].date, trip_date: days[0].tripDate, realized: realized == null ? null : r3(realized), ...extra };
        if (Array.isArray(row.visits) && row.stats) row.stats = { ...row.stats, ...goodShots(row.visits) };
        if (row.stats && missedNode != null) row.stats = { ...row.stats, missed: nodes[missedNode].name };
        if (row.stats && walkStats) row.stats = { ...row.stats, walk: walkStats };
        if (row.stats && cfg.slow_drive && truthN && visits.length) {
          const sl = slowOf(visits);
          row.stats = { ...row.stats, slow: { realized: r3(evalVisits(truthN, sl.out)), late: sl.late, delay_min: sl.delay } };
        }
        // What each visit got against what happened.
        if (truthN && row.visits?.length === visits.length) row.visits = row.visits.map((v: any, i: number) => ({ ...v, truth: r2(truthAt(truthN, visits[i]) / 250) }));
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
      // publish (run config, Phil 31 Oct 2026: T in the TEST app): a live run on a real
      // (or training) trip also writes its evening plan and its morning re-plan to
      // solver_runs / solver_plans (stats.planner 'T', variant 'T', rank 1), which the
      // app reads; the backtest scores them like any plan.
      // v51 (Phil, 1 Nov 2026: one score scale in the app): rank 0 = Phil's own day (the trip
      // day's own stops at their time_labels) on the same weather versions and already-shot
      // values as T's plan, and stats.ceiling = the most the day could add (every rated place
      // in either plan seen perfectly, over what is already shot). The app shows each plan's
      // mean as a % of that ceiling. v52: a week draft counts its own earlier days as shot (to
      // plan the week), which made "your day" worth ~0 wherever T went earlier: drafts score
      // both plans and the ceiling on the day's own merit (live nights keep the real shots).
      const publish = async (step: 'night' | 'morning' | 'early' | 'now' | 'week', p: DayPlan, s: State, extra: any = {}, atMsPub?: number) => {
        // v91 (Phil, 8 Nov 2026: "add the version label"): every published plan carries the planner
        // version it ran as = the winner in planner_versions (what the live planner runs); the app shows it.
        const { data: pvw } = await db.from('planner_versions').select('letter').eq('status', 'winner').maybeSingle();
        const version: string | null = pvw?.letter ?? null;
        if (!cfg.publish || !live) return;
        const d0 = days[0];
        const visits = visitsOf(p, s);
        const slotOf = (ms: number) => Math.round((ms - p.dayStart) / (SLOT * 60000));
        const M = s.total.length;
        const base = draft ? new Map<number, number>() : groupBase;
        const gainB = (g: number, w: number, prev: number | undefined) => Math.max(0, w - Math.max(prev ?? 0, base.get(g) ?? 0));
        const scoreRoute = (route: { n: number; ms: number }[]) => {
          const tot = new Float32Array(M), seen = new Map<number, Uint8Array>();
          for (const { n: n0, ms } of route) {
            if (nodes[n0].w <= 0) continue;
            const w = p.W(n0, slotOf(ms));
            if (!w || w.length !== M) continue;
            const g = nodes[n0].group, prev = seen.get(g);
            for (let k = 0; k < M; k++) tot[k] += nodes[n0].w * gainB(g, w[k], prev?.[k]) / 250;
            seen.set(g, prev ? Uint8Array.from(prev, (x, k) => Math.max(x, w[k])) : w);
          }
          return metric(tot);
        };
        const own = ownOf(d0);
        const mine = own.map(o => {
          const n0 = o.n!, ms = zonedToUtc(d0.date, o.min!, tz), rated = nodes[n0].w > 0;
          return { date: p.date, trip_date: p.tripDate, stop_id: o.s.id, name: o.s.name, booked: !!o.s.time_locked,
                   start: new Date(ms).toISOString(), rated, ...((rated && chance(p, n0, slotOf(ms))) || {}) };
        });
        // For the app (T2, the planner-screens thread): the light at each planned time, and for T's
        // plan why a stop moved off Phil's own time or day.
        const vOf = new Map(rated.map(r => [r.stop_id, r.star_vantage_id as string]));
        const want = [...new Set([...visits, ...mine].map(x => vOf.get(x.stop_id)).filter(Boolean))] as string[];
        const lc = want.length ? await all<any>((a, b) => db.from('solver_light_cache').select('vantage_id, slot_at, light')
          .eq('local_date', p.date).in('vantage_id', want).order('slot_at').range(a, b)) : [];
        const lightBy = new Map<string, { ms: number; l: string }[]>();
        for (const r of lc) { const k = r.vantage_id; if (!lightBy.has(k)) lightBy.set(k, []); lightBy.get(k)!.push({ ms: Date.parse(r.slot_at), l: r.light }); }
        const lightAt = (stopId: string, at: string | undefined) => {
          const rows = lightBy.get(vOf.get(stopId) ?? ''); if (!rows || !at) return null;
          const ms = Date.parse(at); let best = rows[0];
          for (const r of rows) if (Math.abs(r.ms - ms) < Math.abs(best.ms - ms)) best = r;
          return Math.abs(best.ms - ms) <= 20 * 60000 ? (LIGHT_WORD[best.l] ?? best.l) : null;
        };
        for (const x of visits as any[]) {
          x.light = lightAt(x.stop_id, x.start);
          if (x.why && x.light && x.light !== 'no sun' && !x.booked) x.why += `, ${x.light} light`;
          const st0 = stopById.get(x.stop_id), ownDay = st0 ? tripDays.find(d => d.id === st0.day_id)?.date : undefined;
          const o = own.find(m => m.s.id === x.stop_id);
          const oms = o ? zonedToUtc(d0.date, o.min!, tz) : 0, c0 = o ? chance(p, o.n!, slotOf(oms)) : null;
          const mw = moveWhyText({ booked: !!x.booked, nGood: x.n_good ?? null, nFc: x.n_fc ?? null,
            own: o ? { minutes: o.min!, nGood: c0?.n_good ?? null, nFc: c0?.n_fc ?? null } : null,
            startMinutes: localMin(Date.parse(x.start), p.date),
            ownDayLabel: ownDay ? new Date(ownDay + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null,
            sameDay: ownDay === d0.tripDate });
          if (mw) x.move_why = mw;
        }
        for (const x of mine as any[]) x.light = x.rated ? lightAt(x.stop_id, x.start) : null;
        // Done stops (v75, worksheet B2, 6 Nov 2026: a 3:16 PM re-plan showed 85% for a stop shot at
        // 6:15 AM): a live day step publishes in real time, so a visit already over is marked done and
        // the app shows it as done, not as a chance. Night plans and drafts are all ahead: unchanged.
        const doneBy = atMsPub ?? Date.now();
        if (step !== 'night' && step !== 'week') {
          for (const x of visits as any[]) if (Date.parse(x.end) <= doneBy) x.done = true;
          for (const x of mine as any[]) {
            const n0 = pos.get(x.stop_id);
            if (n0 != null && Date.parse(x.start) + nodes[n0].dur * 60000 <= doneBy) x.done = true;
          }
        }
        const mm = scoreRoute(own.map(o => ({ n: o.n!, ms: zonedToUtc(d0.date, o.min!, tz) })));
        const bm = draft ? scoreRoute(s.route.map(v => ({ n: v.n, ms: p.dayStart + v.start * 60000 }))) : { mean: s.mean, cvar: s.cvar };
        const placeW = new Map<number, number>();
        for (const n0 of [...s.route.map(v => v.n), ...own.map(o => o.n!)]) {
          if (nodes[n0].w > 0) placeW.set(nodes[n0].group, Math.max(placeW.get(nodes[n0].group) ?? 0, nodes[n0].w));
        }
        let ceiling = 0;
        for (const [g, w] of placeW) ceiling += w * gainB(g, 250, undefined) / 250;
        const { data: sr, error: e1 } = await db.from('solver_runs').insert({
          trip_id: tripId, plan_date: d0.date, params: { planner: 'T', version, replay_run: runId, night: n, step, tz },
          stats: { kind: 'day', planner: 'T', variant: 'T', version, step, ceiling: r3(ceiling), ...extra,
                   n_fc: draft ? null : M, exp_big: goodShots(visits).exp_big, exp_big_mine: goodShots(mine).exp_big,
                   exp_all: goodShots(visits).exp_all, exp_all_mine: goodShots(mine).exp_all,
                   days: [{ date: d0.date, trip_date: d0.tripDate, light_only: draft,
                            start_hotel: stopById.get(d0.startId ?? '')?.name ?? null, end_hotel: stopById.get(d0.endId ?? '')?.name ?? null }] },
        }).select('id').single();
        if (e1) throw e1;
        const { error: e2 } = await db.from('solver_plans').insert([{
          run_id: sr.id, rank: 0, objective: r3(mm.j), mean: r3(mm.mean), cvar11: r3(mm.cvar),
          drive_minutes: d0.own.reduce((t: number, x: any) => t + (x.drive_override_minutes ?? 0), 0),
          visits: mine, note: 'T: your day',
        }, {
          run_id: sr.id, rank: 1, objective: r3(s.j), mean: r3(bm.mean), cvar11: r3(bm.cvar), drive_minutes: Math.round(s.drive),
          visits, note: step === 'night' ? 'T: evening plan' : step === 'week' ? 'T: week draft' : step === 'early' ? 'T: morning re-plan (cameras)' : step === 'now' ? 'T: re-plan now' : 'T: morning re-plan',
        }]);
        if (e2) throw e2;
      };
      const coverPlan = async () => {
        // Places done: the app's plans go by Phil's ticks (got / nailed) for the days already
        // done, plus a draft's own earlier draft days; the bench by what its plans visited.
        const seenIds = new Set<string>([...(ticks && !draft ? [] : ((ks.sets as any)?.seen ?? [])), ...(ticks ? tickedIds : [])]);
        const done = (x: number) => seenIds.has(nodes[x].id) || (ticks && tickedGroups.has(nodes[x].group));
        // A place: a keep-together group (all of it), else a subject (any of its stops).
        const unitKey = (x: number) => nodes[x].together ? 't:' + nodes[x].together : 'g:' + nodes[x].group;
        const unitsAll = new Map<string, number[]>();
        for (const x of freeNodes) unitsAll.set(unitKey(x), [...(unitsAll.get(unitKey(x)) ?? []), x]);
        const covered = (u: number[]) => nodes[u[0]].together ? u.every(done) : u.some(done);
        const open = [...unitsAll.values()].filter(u => !covered(u));
        // tickfix (v87, 7 Nov 2026, from the walk-the-trip test): a once-only place that is done stays
        // off the plan, unless its keep-together partner is still wanted (Bradley is reached through
        // Taggart: the pair goes again as a pair); and on the ticks path every entry of a nailed place
        // stays off (nothing left to gain there).
        const tickfix = !!cfg.tickfix;
        const openTog = new Set<string>(tickfix ? [...unitsAll.entries()].filter(([k, u]) => k.startsWith('t:') && !covered(u)).map(([k]) => k) : []);
        const nailedGroups = new Set<number>(tickfix && ticks ? rated.map((r, i) => (r.shot_status === 'nailed' ? find(i) : -1)).filter(g => g >= 0) : []);
        const skip = new Set(freeNodes.filter(x => (nodes[x].once && done(x) && !openTog.has(unitKey(x))) || nailedGroups.has(nodes[x].group)));
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
        await mark('dfs');
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
        // mustfix (v87, worksheet b6, 7 Nov 2026): when the beam finds no day with every required place,
        // try the exact search over just those places (as the audit tool does) before dropping one. On 2 of
        // 20 test nights Claude found such a day where the beam found none.
        let mustRescued = 0, rescueTries = 0;
        const rescue = (scores: any[], light: boolean, mustN: number[], from?: From): { p: DayPlan; st: State } | null => {
          // v88: at most rescue_tries (2) exact searches per request, capped at rescue_cap (150k): v87 retried after
          // every dropped place at 400k and 16 of 112 test weeks ran out of time on the gear-pickup and flight days.
          if (!cfg.mustfix || !mustN.length || rescueTries >= Number(cfg.rescue_tries ?? 2)) return null;
          // v89: skip when the request has used most of its CPU already (the gear-pickup and flight days sat
          // near the 2 s limit before the rescue and timed out on 12 of 168 test weeks): the plan then does
          // what it did before the fix.
          if (performance.now() - tReq - tWait > Number(cfg.rescue_ms ?? 1000)) return null;
          rescueTries++;
          const E = [...new Set(mustN)].filter(n => nodes[n].free && !skip.has(n));
          if (!E.length || E.length > 10) return null;
          exactCap = Number(cfg.rescue_cap ?? 150_000);
          const pe = planDay({ ...days[0], light }, scores, true, undefined, mustN, skip, from, E);
          exactCap = EXACT_MAX_EXTENDS;
          const st = pe.routes.find(r => E.every(x => r.visited[x])) ?? null;
          if (st) mustRescued++;
          return st ? { p: pe, st } : null;
        };
        // Plan tomorrow with these places required, dropping from the end when a day cannot hold them all.
        const planList = (l0: number[][]) => {
          let l = l0, pp: DayPlan, ss: State | null;
          for (;;) {
            pp = planDay({ ...days[0], light: draft }, fcSc[0], true, undefined, l.flatMap(mustOf), skip);
            ss = pp.routes[0] ?? null;
            if (ss || !l.length) break;
            { const r = rescue(fcSc[0], draft, l.flatMap(mustOf)); if (r) { pp = r.p; ss = r.st; break; } }
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
        // split_mc (run config, 28 Oct 2026, the Faroes Monte Carlo nights ran out of
        // CPU): Monte Carlo too is spread over requests (stage 'cands', see below).
        const split = (!!cfg.split_morning && (kind === 'mr1' || kind === 'mrmc')) || (!!cfg.split_mc && (kind === 'mc1' || kind === 'mrmc'));
        // req_budget_ms (run config, 30 Oct 2026: a Teton night took 4-5 requests 20 s
        // apart): a request goes on to the next step while its work so far (wall time
        // after loading, less DB waits) is under the budget. Steps give the same results
        // however they are grouped (each split point saves what the next one rebuilds
        // exactly). A retry after a request that never answered goes one step at a time.
        const reqBudget = ks.note === 'retry' ? 0 : Number(cfg.req_budget_ms ?? 0);
        const goOn = () => reqBudget > 0 && performance.now() - tLoaded - tWait < reqBudget;
        const pend = (ks.sets as any)?.pending;
        const stage: string | null = split && pend?.night === n ? (pend.stage ?? 'night') : null;
        const phase2 = stage != null && stage !== 'cands';
        let p0: DayPlan, st: State | null, list: number[][];
        // Today's plan as it stands (v66), for Re-plan now: every live day step saves it.
        const saveToday = async (p: DayPlan, s: State, l: number[][], step: string, mr: any) => {
          if (!live || draft || !cfg.publish) return;
          const { error } = await db.from('replay_live_today').upsert({
            run_id: runId, kind, replay_date: days[0].date, step, mr: mr ?? null, updated_at: new Date().toISOString(),
            visits: s.route.map(v => ({ id: nodes[v.n].id, startMs: p.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor })),
            units: l.map(u => mustOf(u).map(x => nodes[x].id)),
          }, { onConflict: 'run_id,kind,replay_date' });
          if (error) throw error;
        };
        let today: any = null;
        if (nowReq) {
          today = (await db.from('replay_live_today').select('visits, units, mr').eq('run_id', runId).eq('kind', kind).eq('replay_date', days[0].date).maybeSingle()).data;
          if (!today) throw new Error('T has not re-planned today yet (the morning re-plan comes first)');
          const vis = (today.visits as any[]).filter(v => pos.has(v.id)).map(v => ({ n: pos.get(v.id)!, startMs: v.startMs, drive: v.drive, anchor: v.anchor }));
          list = (today.units as string[][]).map(ids => ids.filter(id => pos.has(id)).map(id => pos.get(id)!)).filter(u => u.length);
          p0 = planDay({ ...days[0], light: false }, nSc, false, undefined, list.flatMap(u => u), skip, { visits: vis, atMs: 0 });
          st = p0.routes[0] ?? null;
          if (!st) throw new Error("today's plan could not be rebuilt");
        } else if (stage != null) {
          const vis = (pend.visits as any[]).map(v => ({ n: pos.get(v.id)!, startMs: v.startMs, drive: v.drive, anchor: v.anchor }));
          list = (pend.units as string[][]).map(ids => ids.map(id => pos.get(id)!));
          // Rebuilt with the same required places, so its score (j) is the original's.
          // skip too (30 Oct 2026): without it a keep-together pair whose once-only half was
          // done earlier failed the all-or-none check and the night came back 'no route'.
          // stage 'morning' (v62, midday on): the morning re-plan, rebuilt on the morning build.
          p0 = stage === 'morning'
            ? planDay({ ...days[0], light: false }, mSc, false, undefined, list.flatMap(u => u), skip, { visits: vis, atMs: 0 })
            : planDay({ ...days[0], light: draft }, fcSc[0], false, undefined, list.flatMap(u => u), skip, { visits: vis, atMs: 0 });
          st = p0.routes[0] ?? null;
        } else ({ p: p0, st, list } = planList([...req, ...want]));
        await mark('plan0');
        let mcStats: any = phase2 ? pend.mc : null, mrStats: any = stage === 'morning' ? pend.mr : null, exStats: any = phase2 ? pend.ex : null, polStats: any = phase2 ? pend.pol : null;
        // The near-exhaustive search (planDay exact) over a plan's own stops, the
        // required ones and the next best places up to k (keep-together partners
        // added whole); more than 9 stops is not tried.
        const exactOver = (scores: any[], s: State, mustN: number[], k: number, from?: From, cap = EXACT_MAX_EXTENDS) => {
          const E = new Set<number>([...s.route.filter(v => nodes[v.n].free).map(v => v.n), ...mustN]);
          const addUnit = (x: number) => { for (const y of freeNodes) if (y === x || (nodes[x].together && nodes[y].together === nodes[x].together)) E.add(y); };
          [...E].forEach(addUnit);
          const others = freeNodes.filter(x => !E.has(x) && !skip.has(x)).sort((a, b) => best(b, 0) - best(a, 0));
          for (const x of others) { if (E.size >= k) break; addUnit(x); }
          // Run config polish_max (v74, worksheet B1, 6 Nov 2026): the search gave up silently above
          // 9 stops, so polish_k 10 (Y) never polished. Default 9 keeps every earlier result; the
          // node cap (polish_cap) keeps a bigger search inside the CPU limit.
          if (E.size > Number(cfg.polish_max ?? 9)) return { E, pe: null, se: null };
          exactCap = cap;
          const pe = planDay({ ...days[0], light: draft }, scores, true, undefined, mustN, skip, from, [...E]);
          exactCap = EXACT_MAX_EXTENDS;
          return { E, pe, se: pe.routes[0] ?? null };
        };
        // Polish (run config polish_k, 27 Oct 2026: the exact7 check found a better
        // day than the beam on 78% of days): keep the exact search's day when it
        // scores higher with the same required places.
        const polish = (scores: any[], p: DayPlan, s: State, mustN: number[], from?: From) => {
          const r = exactOver(scores, s, mustN, Number(cfg.polish_k), from, Number(cfg.polish_cap ?? 250_000));
          return r.se && r.pe && r.se.j > s.j + 1e-6 ? { p: r.pe, st: r.se, gain: r3(r.se.j - s.j), capped: !!r.pe.capped } : { p, st: s, gain: 0, capped: !!r.pe?.capped };
        };
        // B1 brute force (run config brute, v58, Phil 3 Nov 2026): every free place, every start
        // slot, the day's exact best for its score, starting from the plan in hand; used in
        // place of (or after) polish, same required places. brute_ms / brute_cap: per-search
        // time budget (default 1200 ms) and node cap; a stopped search keeps the best it found.
        const bruteOver = (scores: any[], p: DayPlan, s: State, mustN: number[], from?: From) => {
          const pb = planDay({ ...days[0], light: draft }, scores, true, undefined, mustN, skip, from, undefined,
                             { inc: s, budgetMs: Number(cfg.brute_ms ?? 1200), cap: Number(cfg.brute_cap ?? 3_000_000) });
          const sb = pb.routes[0];
          const info = { tried: pb.brute?.tried ?? 0, ms: pb.ms, ...(pb.brute?.capped ? { capped: true } : {}) };
          return sb && sb !== s && sb.j > s.j + 1e-6 ? { p: pb, st: sb, gain: r3(sb.j - s.j), info } : { p, st: s, gain: 0, info };
        };
        if (nowReq && st) {
          // Re-plan now (v66): what is begun (or left for, mr_commit 'departure') by now stays; the
          // rest of today is re-planned on the now build (the cameras' majority and the airport
          // re-condition the odds from now), same required places (dropped from the end only if
          // they no longer fit).
          const atMs = Date.parse(body.at ?? new Date().toISOString());
          const leftBy = (v: { start: number; arrive: number; drive: number }) =>
            cfg.mr_commit === 'departure' ? p0.dayStart + (v.arrive - v.drive) * 60000 < atMs : false;
          const before = st.route.filter(v => p0.dayStart + v.start * 60000 < atMs || leftBy(v))
            .map(v => ({ n: v.n, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor }));
          let l = list, pn: DayPlan | null = null, sn: State | null = null;
          for (;;) {
            pn = planDay({ ...days[0], light: false }, nSc, true, undefined, l.flatMap(mustOf), skip, { visits: before, atMs });
            sn = pn.routes[0] ?? null;
            if (sn || !l.length) break;
            { const r = rescue(nSc, false, l.flatMap(mustOf), { visits: before, atMs }); if (r) { pn = r.p; sn = r.st; break; } }
            l = l.slice(0, -1);
          }
          let gain: number | null = null;
          if (cfg.polish_k && sn && pn) {
            const r = polish(nSc, pn, sn, l.flatMap(mustOf), { visits: before, atMs });
            gain = r.gain; pn = r.p; sn = r.st;
          }
          await mark('now');
          const { data: tt } = await db.rpc('t_truth', { p_trip: tripId, p_hr: new Date(Math.floor(atMs / 3600000) * 3600000).toISOString(), p_lat: mid.lat, p_lng: mid.lng });
          const show = (p: DayPlan, s: State) => s.route.filter(v => nodes[v.n].w > 0)
            .map(v => nodes[v.n].name + ' ' + new Date(p.dayStart + v.start * 60000).toISOString().slice(11, 16));
          const was = show(p0, st);
          const nd: any = { asked_at: new Date(atMs).toISOString(), hidden: (tt as any)?.a ?? (tt as any)?.old ?? null, majority: (tt as any)?.a ?? null,
                            cams: (tt as any)?.cams ?? null, cams_hidden: (tt as any)?.cams_hidden ?? null, airport: (tt as any)?.airport ?? null,
                            kept: before.length, was, ...(gain != null ? { polish: gain } : {}) };
          if (sn && pn) {
            const now = show(pn, sn);
            Object.assign(nd, { plan: now, changed: now.join('|') !== was.join('|'), dropped: list.length - l.length });
            p0 = pn; st = sn; list = l;
          } else nd.error = 'no route from now: the plan stands';
          const mr = { ...(today?.mr ?? {}), now: nd };
          await publish('now', p0, st, { mr }, atMs);
          await saveToday(p0, st, list, 'now', mr);
          nowOut = nd;
          return null;
        }
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
          // Run config mc_outings caps the outing candidates (the best tomorrow, in their
          // usual order); default: every open outing.
          const outs = longs.filter(u => !want.includes(u) && okOn(u, remaining[0]));
          const nOut = Number(cfg.mc_outings ?? Infinity);
          const keepOut = new Set([...outs].sort((a, b) => gainT[longs.indexOf(b)][0] - gainT[longs.indexOf(a)][0]).slice(0, nOut));
          // Best V per free node per later day per version (0-250), versions shuffled beyond the forecast.
          const makeVb = () => days.map((_, h) => {
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
          // Z, week brute force (run config week_exact, v59, Phil 3 Nov 2026: "start building the
          // week brute force"): in each weather version the rest of the week is solved exactly
          // instead of by the quick stand-in below. Same model as the stand-in: every open place
          // on any later day or on none (keep-together places as one, on one day), each day's
          // size cap[h] (80% of daylight less 45 min, the gear window kept, 30 min a stop for
          // getting there), a subject counted once at its best over the week, every ski outing
          // never done costing MISS_PENALTY x its weight. Depth first from the stand-in's answer
          // (so never worse), cut by a bound: value so far, plus the best each undecided place
          // could add, filling the minutes left fractionally by value per minute, less the misses
          // already certain. week_cap (default 200k) stops a search; it then keeps the best found.
          const WEEK_CAP = Number(cfg.week_cap ?? 200_000), PEN = Number(cfg.miss_penalty ?? MISS_PENALTY);
          const capMax = cap.map(row => Math.max(0, ...row));
          const laterExact = (vb: Map<number, Uint8Array>[], k: number, bestG0: Map<number, number>, did0: Set<number>, greedyLater: number) => {
            const Hn = days.length;
            const elig = freeNodes.map((x, j) => ({ x, j })).filter(o => !skip.has(o.x) && !(nodes[o.x].once && did0.has(o.x)));
            const byKey = new Map<string, { x: number; j: number }[]>();
            for (const o of elig) { const key = nodes[o.x].together ? 't:' + nodes[o.x].together : 'n:' + o.x; byKey.set(key, [...(byKey.get(key) ?? []), o]); }
            const gainOn = (ms: { x: number }[], h: number) => ms.reduce((t, o) => t + nodes[o.x].w * Math.max(0, vb[h].get(o.x)![k] - (bestG0.get(nodes[o.x].group) ?? 0)) / 250, 0);
            const items = [...byKey.values()].map(ms => {
              const dur = ms.reduce((t, o) => t + nodes[o.x].dur + 30, 0);
              const ds: { h: number; c: number; g: number }[] = [];
              for (let h = 1; h < Hn; h++) { const c = Math.min(...ms.map(o => cap[h][o.j])); if (c > 0 && c >= dur) ds.push({ h, c, g: gainOn(ms, h) }); }
              ds.sort((a, b) => b.g - a.g);
              return { ms, dur, ds, ub: ds.length ? ds[0].g : 0, once: ms.some(o => nodes[o.x].once) };
            }).filter(it => it.ds.length && (it.ub > 0 || it.once));
            items.sort((a, b) => (Number(b.once) - Number(a.once)) || (b.ub / b.dur - a.ub / a.dur));
            const itemOf = new Map<number, number>();
            items.forEach((it, i) => it.ms.forEach(o => itemOf.set(o.x, i)));
            const suf = items.map((_, i) => items.map((it, q) => ({ it, q })).slice(i).sort((a, b) => b.it.ub / b.it.dur - a.it.ub / a.it.dur).map(o => o.q));
            const chosen = new Int8Array(items.length).fill(-1);
            const used = new Array(Hn).fill(0), lim = new Array(Hn).fill(Infinity);
            const bestG = new Map(bestG0);
            const unitW = onceUnits.map(u => u.reduce((t, x) => t + nodes[x].w, 0));
            const doneAt = (x: number, upto: number) => did0.has(x) || (itemOf.has(x) && itemOf.get(x)! < upto && chosen[itemOf.get(x)!] >= 0);
            // Misses already certain once items before i are decided (a place not offered counts as decided).
            const missed = (i: number, final: boolean) => {
              let p = 0;
              onceUnits.forEach((u, ui) => {
                if (u.some(x => !doneAt(x, items.length) && (final || !itemOf.has(x) || (itemOf.get(x)! < i && chosen[itemOf.get(x)!] < 0)))) p += PEN * unitW[ui];
              });
              return p;
            };
            let best = greedyLater, tried = 0, stopped = false;
            const dfs = (i: number, cur: number) => {
              if (stopped) return;
              if (++tried > WEEK_CAP) { stopped = true; return; }
              if (i === items.length) { const v = cur - missed(i, true); if (v > best + 1e-9) best = v; return; }
              let room = 0;
              for (let h = 1; h < Hn; h++) room += Math.max(0, Math.min(capMax[h], lim[h]) - used[h]);
              let b = 0;
              for (const q of suf[i]) { const it = items[q]; if (it.dur <= room) { b += it.ub; room -= it.dur; } else { b += it.ub * room / it.dur; break; } }
              if (cur + b - missed(i, false) <= best + 1e-9) return;
              const it = items[i];
              for (const d of it.ds) {
                if (used[d.h] + it.dur > Math.min(lim[d.h], d.c)) continue;
                let g = 0; const undo: [number, number | undefined][] = [];
                for (const o of it.ms) {
                  const gr = nodes[o.x].group, vv = vb[d.h].get(o.x)![k], pb = bestG.get(gr) ?? 0;
                  if (vv > pb) { g += nodes[o.x].w * (vv - pb) / 250; undo.push([gr, bestG.get(gr)]); bestG.set(gr, vv); }
                }
                const ol = lim[d.h]; used[d.h] += it.dur; lim[d.h] = Math.min(ol, d.c); chosen[i] = d.h;
                dfs(i + 1, cur + g);
                used[d.h] -= it.dur; lim[d.h] = ol; chosen[i] = -1;
                for (let q = undo.length - 1; q >= 0; q--) { const [gr, pv] = undo[q]; if (pv === undefined) bestG.delete(gr); else bestG.set(gr, pv); }
                if (stopped) return;
              }
              dfs(i + 1, cur);
            };
            dfs(0, 0);
            return { later: best, gain: best - greedyLater, tried, capped: stopped };
          };
          const scoreCand = (c: { p: DayPlan; st: State }, vb: Map<number, Uint8Array>[]) => {
            const tot = new Float32Array(S);
            const we = cfg.week_exact ? { better: 0, gain: 0, tried: 0, capped: 0 } : null;
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
              const v0 = v, bestG0 = we ? new Map(bestG) : bestG, did0 = we ? new Set(did) : did;
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
              if (we) {
                const r = laterExact(vb, k, bestG0, did0, v - v0);
                v = v0 + r.later;
                we.tried += r.tried; if (r.capped) we.capped++; if (r.gain > 1e-9) { we.better++; we.gain += r.gain; }
              }
              tot[k] = v;
            }
            const m = metric(tot);
            return we ? { ...m, we: { better: we.better, gain: r3(we.gain / S), tried: we.tried, capped: we.capped } } : m;
          };
          // Every ski outing must still fit after tomorrow: a candidate that leaves
          // more outings than the days after it can hold is out (Phil: every place
          // is a must-do), whatever the weather says.
          const fitsLater = (st: State) => {
            const left = longs.filter(u => !u.every(x => st.visited[x]));
            const used = remaining.map(() => 0);
            // Same 200k cap as the outing-day search (run config mc_fit_steps); past it, keep the candidate.
            let steps = 0;
            const place = (k: number): boolean => {
              if (k === left.length || ++steps > Number(cfg.mc_fit_steps ?? 200000)) return true;
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
          if (!cfg.split_mc) {
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
            for (const u of outs) if (keepOut.has(u)) tryList([...req, u], 'outing ' + nodes[u[0]].name);
            await mark('cands');
            const vb = makeVb();
            await mark('vb');
            const ok = cands.filter(c => fitsLater(c.st));
            await mark('fits');
            const pool = ok.length ? ok : cands.slice(0, 1);
            const scored = pool.map(c => ({ c, m: scoreCand(c, vb) }));
            const pick = scored.reduce((a, b) => (b.m.j > a.m.j ? b : a));
            mcStats = { dropped: cands.length - pool.length, cands: scored.map(x => ({ tag: x.c.tag, j: r3(x.m.j), mean: r3(x.m.mean), stops: x.c.st.route.filter(v => nodes[v.n].w > 0).map(v => nodes[v.n].name), ...((x.m as any).we ? { we: (x.m as any).we } : {}) })),
                        chose: pick.c.tag, ms: Math.round(performance.now() - tMc) };
            p0 = pick.c.p; st = pick.c.st; list = pick.c.list;
          } else {
            // split_mc: the same candidates in the same order, one heavy step per request,
            // kept in sets.pending (stage 'cands'): first the fm1 plan and its next-best
            // routes, then their scores, then each other candidate (planned and scored),
            // then the pick, rebuilt exactly from its visits. Scores use tomorrow's
            // values (looks[0], the same day and forecast as every candidate's plan).
            const ser = (p: DayPlan, s: State, l: number[][], tag: string) => ({ tag,
              visits: s.route.map(v => ({ id: nodes[v.n].id, startMs: p.dayStart + v.start * 60000, start: v.start, drive: v.drive, anchor: v.anchor })),
              units: l.map(u => mustOf(u).map(x => nodes[x].id)) });
            const lite = (c: any) => {
              const visited: boolean[] = new Array(nodes.length).fill(false);
              const route = (c.visits as any[]).map(v => { const x = pos.get(v.id)!; visited[x] = true; return { n: x, start: v.start }; });
              return { p: looks[0], st: { route, visited } as unknown as State };
            };
            const sameIds = (c: any, s: State) => c.visits.length === s.route.length && s.route.every(v => (c.visits as any[]).some(w => w.id === nodes[v.n].id));
            const saveMc = async (cs: any[], todo: any[]) => {
              const pending = { night: n, stage: 'cands', visits: st!.route.map(v => ({ id: nodes[v.n].id, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor })),
                                units: list.map(u => mustOf(u).map(x => nodes[x].id)), cands: cs, todo, ms: (stage === 'cands' ? pend.ms ?? 0 : 0) + Math.round(performance.now() - tMc) };
              await db.from('replay_run_state').update({ sets: { ...(ks.sets ?? {}), pending }, status: 'idle', note: null, updated_at: new Date().toISOString() })
                .eq('run_id', runId).eq('kind', kind);
              return null;
            };
            const scoreLite = (c: any, vb: Map<number, Uint8Array>[]) => {
              const l = lite(c), m = scoreCand(l, vb);
              c.fits = fitsLater(l.st); c.m = { j: m.j, mean: m.mean }; if ((m as any).we) c.we = (m as any).we;
              c.stops = l.st.route.filter(v => nodes[v.n].w > 0).map(v => nodes[v.n].name);
            };
            let cs: any[], todo: any[];
            if (stage !== 'cands') {
              cs = [ser(p0, st, list, 'fm1')];
              for (const alt of p0.routes.slice(1, 6)) {
                if (cs.length >= 3) break;
                if (!cs.some(c => sameIds(c, alt))) cs.push(ser(p0, alt, list, 'alt'));
              }
              const ids = (l: number[][]) => l.map(u => u.map(x => nodes[x].id));
              todo = [{ tag: 'no outing', units: ids([...req]) },
                ...outs.filter(u => keepOut.has(u)).map(u => ({ tag: 'outing ' + nodes[u[0]].name, units: ids([...req, u]) }))];
              await mark('cands');
              // Round-trip through JSON so the next step sees exactly what a saved stage holds.
              if (!goOn()) return await saveMc(cs, todo);
              cs = JSON.parse(JSON.stringify(cs)); todo = JSON.parse(JSON.stringify(todo));
            } else { cs = pend.cands as any[]; todo = pend.todo as any[]; }
            // Each day search is its own step (planList's retries with one place fewer
            // included, same order), and a request starts another only while the
            // slowest so far still fits in mc_budget_ms (default 800). The steps do not
            // depend on how they are grouped, so results are the same.
            const tB = performance.now(), budget = Number(cfg.mc_budget_ms ?? 800);
            let vbL: Map<number, Uint8Array>[] | null = null;
            const getVb = () => (vbL ??= makeVb());
            for (const c of cs) if (!c.m) scoreLite(c, getVb());
            const unitIds = (l: number[][]) => l.map(u => u.map(x => nodes[x].id));
            let k = 0, searched = 0, slowest = 0;
            while (k < todo.length) {
              if (searched && performance.now() - tB + slowest > budget) break;
              const l = (todo[k].units as string[][]).map(u => u.map(id => pos.get(id)!));
              const t1 = performance.now();
              const pp = planDay({ ...days[0], light: draft }, fcSc[0], true, undefined, l.flatMap(mustOf), skip);
              searched++; slowest = Math.max(slowest, performance.now() - t1);
              const ss = pp.routes[0] ?? null;
              if (!ss && l.length) { todo[k] = { ...todo[k], units: unitIds(l.slice(0, -1)) }; continue; }
              if (ss && !cs.some(c => sameIds(c, ss))) { const c = ser(pp, ss, l, todo[k].tag); scoreLite(c, getVb()); cs.push(c); }
              k++;
            }
            await mark('fits');
            if (k < todo.length) return await saveMc(cs, todo.slice(k));
            const ok = cs.filter(c => c.fits);
            const pool = ok.length ? ok : cs.slice(0, 1);
            const pick = pool.reduce((a, b) => (b.m.j > a.m.j ? b : a));
            mcStats = { dropped: cs.length - pool.length, cands: pool.map(c => ({ tag: c.tag, j: r3(c.m.j), mean: r3(c.m.mean), stops: c.stops, ...(c.we ? { we: c.we } : {}) })),
                        chose: pick.tag, ms: (pend?.ms ?? 0) + Math.round(performance.now() - tMc) };
            const vis = (pick.visits as any[]).map(v => ({ n: pos.get(v.id)!, startMs: v.startMs, drive: v.drive, anchor: v.anchor }));
            list = (pick.units as string[][]).map(u => u.map(id => pos.get(id)!));
            p0 = planDay({ ...days[0], light: draft }, fcSc[0], false, undefined, list.flatMap(u => u), skip, { visits: vis, atMs: 0 });
            st = p0.routes[0] ?? null;
          }
          await mark('mc');
        }
        const save = async (stg: string) => {
          const pending = { night: n, stage: stg, visits: st!.route.map(v => ({ id: nodes[v.n].id, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor })),
                            units: list.map(u => mustOf(u).map(x => nodes[x].id)), mc: mcStats, ex: exStats, pol: polStats, ...(mrStats ? { mr: mrStats } : {}) };
          // Drafts chain their own steps (v77, worksheet C5, 6 Nov 2026): instead of waiting for the next
          // 20-s tick, a draft marks its next step as planning and calls itself; the tick skips planning
          // steps and resets one stuck for 2 min, so a lost call costs only that wait.
          const chain = draft && cfg.chain === true; // off by default until a quiet-bench test shows it helps (6 Nov: 11 min vs 5 under load)
          const now = new Date().toISOString();
          await db.from('replay_run_state').update({ sets: { ...(ks.sets ?? {}), pending }, status: chain ? 'planning' : 'idle', note: null,
                                                      ...(chain ? { started_at: now } : {}), updated_at: now })
            .eq('run_id', runId).eq('kind', kind);
          if (chain) {
            const go = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/solver-replay`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: runId, kind }),
            }).then(r => r.body?.cancel()).catch(() => {});
            (globalThis as any).EdgeRuntime?.waitUntil?.(go);
          }
          return null;
        };
        if (split && !phase2 && (cfg.polish_k || cfg.brute) && st && !goOn()) return await save('mc');
        const pastNight = stage === 'night' || stage === 'morning';
        if (cfg.polish_k && st && !pastNight) {
          const r = polish(fcSc[0], p0, st, list.flatMap(mustOf));
          polStats = { night: r.gain, ...(r.capped ? { night_capped: true } : {}) }; p0 = r.p; st = r.st;
        }
        if (cfg.brute && st && !pastNight) {
          const r = bruteOver(fcSc[0], p0, st, list.flatMap(mustOf));
          polStats = { ...(polStats ?? {}), brute_night: r.gain, brute_night_info: r.info }; p0 = r.p; st = r.st;
        }
        // Live: the morning step comes hours later, so the night plan is always saved here.
        if (split && !pastNight && st && ((live && !draft) || !goOn())) { if (!draft) await publish('night', p0, st); return await save('night'); }
        // Look before you leave (v69): 15 min before the plan's first departure, on a build made for that
        // time; re-plans from there (what is begun or left for is kept), same required places.
        const dawnAt = sunrise(days[0].date, mid.lat, mid.lng, tz) - LOOK_BEFORE_SUNRISE_MIN * 60000;
        const departAt = () => {
          if (!st || !st.route.length) return null;
          const v = st.route[0], dep = p0.dayStart + (v.arrive - v.drive) * 60000;
          return Math.floor((dep - DEPART_LOOK_MIN * 60000) / 300000) * 300000;
        };
        const departStep = async (atMs: number, key = 'depart') => {
          const LEAD = 1 + WX + FOG + FADE + SUN;
          let id = (blds ?? []).find(x => x.replay_day_id === horizon[0].dayId && x.kind === depKind && x.lead === LEAD && x.look_at && Date.parse(x.look_at) === atMs)?.id as string | undefined;
          if (!id) {
            // Direct connection: the API stops a statement at 8 s and a build takes ~10 s.
            const t = performance.now();
            const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
            try {
              const rows = await sql`select public.replay_build(${horizon[0].dayId}::bigint, ${depKind}::text, ${LEAD}::int, ${new Date(atMs).toISOString()}::timestamptz) id`;
              id = rows[0].id as string;
            } finally { await sql.end(); }
            tWait += performance.now() - t;
          }
          const sc = await scoresOf(id!);
          if (!sc.length) throw new Error('empty depart build');
          const leftBy = (v: { start: number; arrive: number; drive: number }) =>
            cfg.mr_commit === 'departure' ? p0.dayStart + (v.arrive - v.drive) * 60000 < atMs : false;
          const before = st!.route.filter(v => p0.dayStart + v.start * 60000 < atMs || leftBy(v))
            .map(v => ({ n: v.n, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor }));
          let l = list, pp: DayPlan | null = null, sp: State | null = null;
          for (;;) {
            pp = planDay({ ...days[0], light: false }, sc, true, undefined, l.flatMap(mustOf), skip, { visits: before, atMs });
            sp = pp.routes[0] ?? null;
            if (sp || !l.length) break;
            { const r = rescue(sc, false, l.flatMap(mustOf), { visits: before, atMs }); if (r) { pp = r.p; sp = r.st; break; } }
            l = l.slice(0, -1);
          }
          if (cfg.polish_k && sp && pp) {
            const r = polish(sc, pp, sp, l.flatMap(mustOf), { visits: before, atMs });
            polStats = { ...(polStats ?? {}), [key]: r.gain, ...(r.capped ? { [key + '_capped']: true } : {}) }; pp = r.p; sp = r.st;
          }
          await mark(key);
          const { data: look } = await db.from('replay_hidden_truth').select('hr, hidden').eq('trip_id', tripId)
            .gte('hr', new Date(atMs - 3600000).toISOString()).lte('hr', new Date(atMs).toISOString()).order('hr', { ascending: false }).limit(1);
          const show = (p: DayPlan, s: State) => s.route.filter(v => nodes[v.n].w > 0)
            .map(v => nodes[v.n].name + ' ' + new Date(p.dayStart + v.start * 60000).toISOString().slice(11, 16));
          const was = show(p0, st!);
          const dd: any = { look_at: new Date(atMs).toISOString(), before_dawn: atMs < dawnAt, hidden: look?.[0]?.hidden ?? null, kept: before.length, was };
          if (sp && pp) {
            const now = show(pp, sp);
            Object.assign(dd, { plan: now, changed: now.join('|') !== was.join('|'), dropped: list.length - l.length });
            p0 = pp; st = sp; list = l;
          } else dd.error = 'no route from the depart look: the plan stands';
          if (key === 'depart') mrStats = { ...(mrStats ?? {}), depart: dd };
          else mrStats = { ...(mrStats ?? {}), [key]: [...((mrStats ?? {})[key] ?? []), dd] };
        };
        let departDone = false;
        if (departOn && st && !draft && stage !== 'morning') {
          const at = departAt();
          if (at != null && at < dawnAt) { await departStep(at); departDone = true; }
        }
        if ((kind === 'mr1' || kind === 'mrmc') && st && !draft && stage !== 'morning') {
          // Morning-of replan (Phil, 27 Oct 2026): the night's plan (v3, or the one
          // Monte Carlo chose) stands up to 30 min before sunrise; then the planner
          // sees whether the peaks are hidden (the airport or the camera, the
          // latest report in the hour before) and re-plans the rest of the day on
          // the morning build, with the same required places (dropped from the
          // end only if they no longer fit).
          if (!mSc.length) throw new Error('morning build missing');
          const atMs = dawnAt;
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
            { const r = rescue(mSc, false, l.flatMap(mustOf), { visits: before, atMs }); if (r) { pm = r.p; sm = r.st; break; } }
            l = l.slice(0, -1);
          }
          if (cfg.polish_k && sm && pm) {
            const r = polish(mSc, pm, sm, l.flatMap(mustOf), { visits: before, atMs });
            polStats = { ...(polStats ?? {}), morning: r.gain, ...(r.capped ? { morning_capped: true } : {}) }; pm = r.p; sm = r.st;
          }
          if (cfg.brute && sm && pm) {
            const r = bruteOver(mSc, pm, sm, l.flatMap(mustOf), { visits: before, atMs });
            polStats = { ...(polStats ?? {}), brute_morning: r.gain, brute_morning_info: r.info }; pm = r.p; sm = r.st;
          }
          await mark('morning');
          const { data: look } = await db.from('replay_hidden_truth').select('hr, hidden').eq('trip_id', tripId)
            .gte('hr', new Date(atMs - 3600000).toISOString()).lte('hr', new Date(atMs).toISOString()).order('hr', { ascending: false }).limit(1);
          const show = (p: DayPlan, s: State) => s.route.filter(v => nodes[v.n].w > 0)
            .map(v => nodes[v.n].name + ' ' + new Date(p.dayStart + v.start * 60000).toISOString().slice(11, 16));
          mrStats = { ...(mrStats ?? {}), look_at: new Date(atMs).toISOString(), hidden: look?.[0]?.hidden ?? null, kept: before.length, night: show(p0, st) };
          if (sm && pm) {
            const morning = show(pm, sm);
            mrStats = { ...mrStats, morning, changed: morning.join('|') !== mrStats.night.join('|'), dropped: list.length - l.length };
            p0 = pm; st = sm;
            if (middayOn || earlyOn || departOn) list = l;
          } else mrStats.error = 'no morning route: the night plan stands';
        }
        // Leaving after the dawn look: the look before you leave follows it.
        if (departOn && !departDone && st && !draft && stage !== 'morning') {
          const at = departAt();
          if (at != null && at > dawnAt) await departStep(at);
        }
        if (earlyOn && st) {
          // Camera look (v65, Phil 5 Nov 2026): the morning plan stands until the first camera pictures
          // after sunrise; then the majority of the cameras and the airport re-conditions the odds from an
          // hour later and the rest of the day is re-planned on the early build, same required places
          // (dropped from the end only if they no longer fit). Visits begun (or left for, mr_commit
          // 'departure') by then are kept, so the sunrise spot stays. Live: the dawn re-plan goes to the
          // app now and is saved (stage 'morning'); the tick calls again once the pictures are in.
          if (stage !== 'morning' && (live || (split && !goOn()))) {
            if (live) { await publish('morning', p0, st, mrStats ? { mr: mrStats } : {}); await saveToday(p0, st, list, 'morning', mrStats); }
            return await save('morning');
          }
          if (!eSc.length) throw new Error('early build missing');
          const { data: ea, error: eaE } = await db.rpc('replay_early_at', { p_trip: tripId, p_date: days[0].date });
          if (eaE) throw eaE;
          const atMs = Date.parse(ea as string);
          const leftBy = (v: { start: number; arrive: number; drive: number }) =>
            cfg.mr_commit === 'departure' ? p0.dayStart + (v.arrive - v.drive) * 60000 < atMs : false;
          const before = st.route.filter(v => p0.dayStart + v.start * 60000 < atMs || leftBy(v))
            .map(v => ({ n: v.n, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor }));
          let l = list, pe: DayPlan | null = null, se: State | null = null;
          for (;;) {
            pe = planDay({ ...days[0], light: false }, eSc, true, undefined, l.flatMap(mustOf), skip, { visits: before, atMs });
            se = pe.routes[0] ?? null;
            if (se || !l.length) break;
            { const r = rescue(eSc, false, l.flatMap(mustOf), { visits: before, atMs }); if (r) { pe = r.p; se = r.st; break; } }
            l = l.slice(0, -1);
          }
          if (cfg.polish_k && se && pe) {
            const r = polish(eSc, pe, se, l.flatMap(mustOf), { visits: before, atMs });
            polStats = { ...(polStats ?? {}), early: r.gain, ...(r.capped ? { early_capped: true } : {}) }; pe = r.p; se = r.st;
          }
          await mark('early');
          const { data: tt } = await db.rpc('t_truth', { p_trip: tripId, p_hr: new Date(Math.floor(atMs / 3600000) * 3600000).toISOString(), p_lat: mid.lat, p_lng: mid.lng });
          const show = (p: DayPlan, s: State) => s.route.filter(v => nodes[v.n].w > 0)
            .map(v => nodes[v.n].name + ' ' + new Date(p.dayStart + v.start * 60000).toISOString().slice(11, 16));
          const was = show(p0, st);
          const ed: any = { look_at: new Date(atMs).toISOString(), hidden: (tt as any)?.a ?? (tt as any)?.old ?? null, majority: (tt as any)?.a ?? null,
                            cams: (tt as any)?.cams ?? null, cams_hidden: (tt as any)?.cams_hidden ?? null, airport: (tt as any)?.airport ?? null, kept: before.length };
          if (se && pe) {
            const now = show(pe, se);
            Object.assign(ed, { plan: now, changed: now.join('|') !== was.join('|'), dropped: list.length - l.length });
            p0 = pe; st = se; list = l;
          } else ed.error = 'no early route: the morning plan stands';
          mrStats = { ...(mrStats ?? {}), early: ed };
        }
        if (middayOn && st) {
          // Midday re-plan (v62, Phil 4 Nov 2026): the morning plan stands until local noon; then
          // the latest report on the peaks (the hour before noon) re-conditions the odds from 13:00
          // and the afternoon is re-planned on the midday build, same required places (dropped from
          // the end only if they no longer fit). A visit already left for at noon is kept
          // (mr_commit 'departure'). With split on, the morning plan is saved first (stage 'morning').
          if (split && stage !== 'morning' && !goOn()) return await save('morning');
          const atMs = zonedToUtc(days[0].date, 12 * 60, tz);
          const leftBy = (v: { start: number; arrive: number; drive: number }) =>
            cfg.mr_commit === 'departure' ? p0.dayStart + (v.arrive - v.drive) * 60000 < atMs : false;
          const before = st.route.filter(v => p0.dayStart + v.start * 60000 < atMs || leftBy(v))
            .map(v => ({ n: v.n, startMs: p0.dayStart + v.start * 60000, drive: v.drive, anchor: v.anchor }));
          let l = list, pd: DayPlan | null = null, sd: State | null = null;
          for (;;) {
            pd = planDay({ ...days[0], light: false }, dSc, true, undefined, l.flatMap(mustOf), skip, { visits: before, atMs });
            sd = pd.routes[0] ?? null;
            if (sd || !l.length) break;
            { const r = rescue(dSc, false, l.flatMap(mustOf), { visits: before, atMs }); if (r) { pd = r.p; sd = r.st; break; } }
            l = l.slice(0, -1);
          }
          if (cfg.polish_k && sd && pd) {
            const r = polish(dSc, pd, sd, l.flatMap(mustOf), { visits: before, atMs });
            polStats = { ...(polStats ?? {}), midday: r.gain, ...(r.capped ? { midday_capped: true } : {}) }; pd = r.p; sd = r.st;
          }
          await mark('midday');
          const { data: look } = await db.from('replay_hidden_truth').select('hr, hidden').eq('trip_id', tripId)
            .gte('hr', new Date(atMs - 3600000).toISOString()).lte('hr', new Date(atMs).toISOString()).order('hr', { ascending: false }).limit(1);
          const show = (p: DayPlan, s: State) => s.route.filter(v => nodes[v.n].w > 0)
            .map(v => nodes[v.n].name + ' ' + new Date(p.dayStart + v.start * 60000).toISOString().slice(11, 16));
          const was = show(p0, st);
          const md: any = { look_at: new Date(atMs).toISOString(), hidden: look?.[0]?.hidden ?? null, kept: before.length };
          if (sd && pd) {
            const now = show(pd, sd);
            Object.assign(md, { plan: now, changed: now.join('|') !== was.join('|'), dropped: list.length - l.length });
            p0 = pd; st = sd;
          } else md.error = 'no midday route: the morning plan stands';
          mrStats = { ...(mrStats ?? {}), midday: md };
        }
        if (hourlyOn && st) {
          const fromH = Number(cfg.hourly_from ?? 9), toH = Number(cfg.hourly_to ?? 15), maxN = Number(cfg.hourly_max ?? 2);
          const ats: number[] = [];
          for (let h = fromH; h <= toH; h++) ats.push(zonedToUtc(days[0].date, h * 60, tz));
          const { data: hv } = await db.from('replay_hidden_vote').select('hr, hidden').eq('trip_id', tripId)
            .gte('hr', new Date(ats[0] - 2 * 3600000).toISOString()).lte('hr', new Date(ats[ats.length - 1]).toISOString());
          const voteAt = new Map<number, boolean>((hv ?? []).map((r: any) => [Date.parse(r.hr), !!r.hidden]));
          let prev = voteAt.get(ats[0] - 2 * 3600000) ?? null, done = 0, skipped = 0;
          const flips: string[] = [];
          for (const at of ats) {
            const cur = voteAt.get(at - 3600000) ?? null;
            if (cur != null && prev != null && cur !== prev) {
              flips.push(new Date(at).toISOString().slice(11, 16) + (cur ? ' hidden' : ' clear'));
              if (done < maxN && st) {
                if (reqBudget > 0 && !goOn()) skipped++;
                else { await departStep(at, 'hourly'); done++; }
              }
            }
            if (cur != null) prev = cur;
          }
          mrStats = { ...(mrStats ?? {}), hourly_flips: flips, hourly_done: done, ...(skipped ? { hourly_skipped: skipped } : {}) };
        }
        if (st) { missedNode = pickMissed(st.route); for (const v of st.route) if (v.n !== missedNode) seenIds.add(nodes[v.n].id); }
        nextSets = { seen: [...seenIds] };
        if (walk) {
          // The evening marks (walk): each rated visit of the day, scored on the truth at its time.
          const nailAt = Number(cfg.walk_nail ?? 0.9), goodAt = 0.6;
          const tk: Record<string, { s: string; v: number }> = { ...walkTicks };
          const marked: any[] = [], bad: string[] = [];
          const onceDone = new Set<number>(rated.map((r, i) => (onceIds.has(r.stop_id) && walkTicks[r.stop_id] ? find(i) : -1)).filter(g => g >= 0));
          const byTog = new Map<string, number>();
          for (const v of st?.route ?? []) {
            const nd = nodes[v.n]; if (nd.w <= 0) continue;
            const t0 = walkTicks[nd.id];
            // Checks: a nailed place planned again; a once-only place repeated; a keep-together group split.
            if (tickedGroups.has(nd.group) && rated.some((r, i) => find(i) === nd.group && walkTicks[r.stop_id]?.s === 'nailed')) bad.push('nailed again: ' + nd.name);
            if (nd.once && onceDone.has(nd.group)) bad.push('once-only repeated: ' + nd.name);
            if (nd.together) byTog.set(nd.together, (byTog.get(nd.together) ?? 0) + 1);
            if (v.n === missedNode || !truthN) continue;
            const t = truthAt(truthN, { n: v.n, startMs: p0.dayStart + v.start * 60000 }) / 250;
            const s = t >= nailAt ? 'nailed' : t >= goodAt ? 'got' : null;
            marked.push({ name: nd.name, truth: r2(t), mark: s ?? 'missed', was: t0?.s ?? null });
            if (!s || t0?.s === 'nailed') continue;
            if (s === 'nailed' || !t0 || t > (t0.v ?? 0)) tk[nd.id] = { s, v: r2(t) };
          }
          for (const [key, k] of byTog) {
            const all = nodes.filter(x => x.together === key && x.free).length;
            if (k < all) bad.push('together split: ' + key);
          }
          walkStats = { marked, bad, nailed: Object.values(tk).filter(x => x.s === 'nailed').length, got: Object.values(tk).filter(x => x.s === 'got').length };
          (nextSets as any).ticks = tk;
        }
        if (st) await publish(draft ? 'week' : earlyOn ? 'early' : 'morning', p0, st, mrStats ? { mr: mrStats } : {});
        if (st && !draft) await saveToday(p0, st, list, earlyOn ? 'early' : 'morning', mrStats);
        return record(st ? routeOf(p0, st) : [], {
          predicted: st ? r3(st.mean) : null, drive_minutes: st ? Math.round(st.drive) : null, visits: st ? visitsOf(p0, st) : [],
          stats: { members: fcB[0]?.members ?? 51, required: req.length, wanted: want.length, kept: list.length, open: open.length,
                   ms: p0.ms, ...(mustRescued ? { must_rescued: mustRescued } : {}), ...(exStats ? { exact: exStats } : {}), ...(polStats ? { polish: polStats } : {}), ...(mcStats ? { mc: mcStats } : {}), ...(mrStats ? { mr: mrStats } : {}), ...(st ? {} : { error: 'no route', why: whyNot(days[0]) }) },
        });
      };
      let shot: Record<string, number>;
      if (kind === 'fm1' || kind === 'mc1' || kind === 'mr1' || kind === 'mrmc') {
        const cs = await coverPlan();
        if (body.now) {
          await db.from('planner_t_now').update({ status: nowOut?.error ? 'error' : 'done', done_at: new Date().toISOString(), result: nowOut ?? null,
                                                  note: nowOut?.error ?? null }).eq('id', body.req_id);
          return json({ ok: true, now: nowOut, run_id: runId, kind, night: n });
        }
        if (!cs) return json({ ok: true, partial: 'night plan saved; the morning step comes next', run_id: runId, kind, night: n });
        shot = cs;
      }
      else if (kind === 'blk') { await mark('climb'); shot = improveWeek('blocks'); }
      else if (kind === 'imp') { await mark('climb'); shot = improveWeek('free'); }
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
      row.stats = { ...(row.stats ?? {}), t: { loaded: Math.round(tLoaded - tReq), wait: Math.round(tWait), light: Math.round(tLight), done: Math.round(performance.now() - tReq) } };
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
    // Re-plan now: an error marks the request only, never the run.
    if (nowReqId != null) { await db.from('planner_t_now').update({ status: 'error', note: msg.slice(0, 300), done_at: new Date().toISOString() }).eq('id', nowReqId); return json({ ok: false, error: msg }, 500); }
    if (runId != null) await db.from('replay_run_state').update({ status: 'error', note: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('run_id', runId).eq('kind', kindOf);
    else if (dayId != null) await db.from('replay_days').update({ status: 'error', note: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', dayId);
    return json({ ok: false, error: msg }, 500);
  }
});
