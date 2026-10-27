import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER PLANNER (v0.3, v20: improve my week, done by dark, keep together)
// POST {trip_id, date?, trip_date?, light?, hotel_stop_id?, multi?, days?, k?, beam?}
//   single day (default): plan `date` (a day in the latest score build).
//   trip_date alone: plan that trip day. Forecast scores when the build covers
//          its date, else light-only scores for its real date
//          (solver_light_scores: 51 made-up sun scenarios, no rain/wind/fog).
//          light: true forces light-only.
//   date + trip_date: plan the weather of `date` as if it were that trip day:
//          its hotels, its booked (time-locked) stops and its own stops.
//   multi: plan every day in the build (or `days: [{date?, trip_date?,
//          light?}]`) as one trip, so a subject shot on two days counts only
//          its better day, with 6 h between back at night and out again.
//   earliest / latest / earliest_sunrise: day window, "HH:MM" local.
//   block_of: a trip date (v18, Phil 26 Oct 2026, "day blocks"): plan only
//          that trip day's own rated stops, in the best order, on trip_date
//          (or date): which date suits the block. Routes that visit every
//          block stop win; if none fits, the ones that visit the most.
//          anchor_stops: [stop ids] fixed visits at their time_label on this
//          date (ski pickup / return). gear_stops: [stop ids] that need the
//          rental gear, only from gear_from and done by gear_to ("HH:MM").
//   improve: 'blocks' | 'free' with days: [every trip day] (v19, Phil 26 Oct
//          2026, "improve my week"): start from Phil's own week and keep any
//          change that scores better, until none does. blocks: swap whole
//          days between dates (fixed_days stay) and reorder each day; free:
//          also move single stops between days (not to or from fixed_days).
//          Every day is planned with its stops only, all of them visited
//          when they fit; a stop that
//          does not fit costs COVER_PENALTY x its tier weight, so the search
//          keeps everything planned. Rank 0 is Phil's week, rank 1 the
//          improved one (stats.improve: moves, start and end score).
//          anchors_on: [{stop_id, date}] fixed visits on a trip date.
//          gear: {stops, from: {date, time}, to: {date, time}}: gear stops
//          only from pickup to return, across the week.
//   Rules for every plan (v20, Phil 26 Oct 2026): done by dark, every free
//          stop ends by civil dusk (sun 6 deg below the horizon) at the trip's
//          middle; keep together, stops with the same
//          solver_stop_settings.together key are planned on one day, all of
//          them or none, and improve my week moves them as one.
//   variant: 'calib' plans from the calibrated score build (side-by-side
//          test on 🧪 Faroes Live); stored as kind calib_day / calib_multi
//          with stats.variant, so the app and the normal backtest skip it.
//
// Uses the latest score build (solver_scores: per stop, 15-min slot and ECMWF
// member, V x250), tier weights, drive minutes (solver_drive_matrix) and each
// stop's duration_minutes. Waiting for light is allowed.
//
//   visit value, per member k = tier weight x best V_k while you are there
//   plan value  = mean_k(total) + 0.5 x CVaR (mean of the worst 11 of 51)
//
// A subject (stops whose starred shots aim within 300 m of each other from
// stand spots within 1.5 km, or share a shot) counts once: repeats only add their improvement, within a
// day and across days. Shot status: a 'got' subject is worth only the
// improvement over its shot_value; a 'nailed' one is not planned and is worth
// nothing more. A day starts at the previous night's accommodation and ends
// at that night's, so move days run hotel to hotel. A day whose first own
// stop has a fixed time (stops.time_locked: landing at JAC) starts there, no
// earlier than that stop ends; a day whose last own stop has one (the flight
// home) ends there by its time. Booked stops are fixed
// visits at their time_label; free stops must still reach the next booking in
// time. Each day is a beam over partial routes from the hotel; multi-day
// combines the top routes of each day with a second beam.
//
// Rank 0, "my day": the trip day's own stops at their time_labels, scored
// the same way, each with its chance and its best time that day.
// Writes solver_runs / solver_plans. Proposals only: nothing here writes to
// stops (solver_apply_plan does, on request).

const TIER_W: Record<string, number> = { GOD: 10, S: 5, A: 2, B: 1, C: 1, D: 0.5, F: 0 };
const LAMBDA = 0.5;
const TAIL = 11;             // worst 11 of 51 members
const SLOT = 15;             // minutes
const MAX_WAIT_SLOTS = 16;   // 4 h
const DRIVE_PENALTY = 0.002; // tier points per driving minute: tie-break only
// Drives under an hour are fine for anything (Phil, 21 Oct 2026); minutes
// beyond 60 on one leg cost 1 tier point per hour (made up, adjustable).
const LONG_LEG_MIN = 60;
const LONG_LEG_PENALTY = 1 / 60;
const over = (leg: number) => Math.max(0, leg - LONG_LEG_MIN);
const SAME_SUBJECT_M = 300;
// ...and only from about the same place: the Grand Teton from Mormon Row and
// from Oxbow Bend are different photos (Phil, 21 Oct 2026).
const SAME_STAND_M = 1500;
const DAY_POOL = 60;         // routes per day carried into the multi-day combine
const MULTI_BEAM = 150;
const GOOD = 150;            // V >= 0.6 counts as a good shot (p_good)
// Improve my week: a stop that no longer fits its day costs half its tier
// weight on top of the value it loses, so the search keeps everything planned.
const COVER_PENALTY = 0.5;
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

type PlanNode = { id: string; name: string; w: number; dur: number; group: number; free: boolean; together: string | null };
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
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const tripId: string = body.trip_id;
    if (!tripId) return json({ error: 'trip_id required' }, 400);
    const K = Math.min(Math.max(body.k ?? 5, 1), 10);
    // Multi-day at 300: a check on 21 Oct found 1.8% better 3-day plans than at 100, same time.
    const BEAM = Math.min(Math.max(body.beam ?? (body.multi || body.days ? 300 : 150), 10), 400);
    const variant = body.variant === 'calib' ? 'calib' : 'raw';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const t0 = performance.now();

    const { data: build, error: bErr } = await db.from('solver_score_builds').select('id, built_at')
      .eq('trip_id', tripId).eq('variant', variant).order('built_at', { ascending: false }).limit(1).maybeSingle();
    if (bErr) throw bErr;
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

    // The build's dates, from its first and last slot.
    const buildDates: string[] = [];
    if (build) {
      const edge = (asc: boolean) => db.from('solver_scores').select('slot_at').eq('build_id', build.id)
        .order('slot_at', { ascending: asc }).limit(1).maybeSingle().then(r => r.data?.slot_at as string | undefined);
      const [lo, hi] = await Promise.all([edge(true), edge(false)]);
      if (lo && hi) for (let d = slotDate(lo); d <= slotDate(hi); d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) buildDates.push(d);
    }

    // What to plan: forecast days use the build, light days their own date.
    const rawDays: { date?: string; trip_date?: string; light?: boolean }[] =
      body.days ?? (body.multi ? buildDates.map(d => ({ date: d })) : [{ date: body.date, trip_date: body.trip_date, light: body.light }]);
    const specs = rawDays.map(di => {
      const light = !!di.light || (!di.date && !!di.trip_date && !buildDates.includes(di.trip_date));
      const date = light ? (di.trip_date ?? di.date)! : (di.date ?? buildDates[0]);
      return { date, trip_date: di.trip_date, light };
    });
    if (!specs.length || specs.some(s => !s.date)) return json({ ok: false, error: 'nothing to plan: no score build and no trip_date' }, 404);
    const forecastDates = [...new Set(specs.filter(s => !s.light).map(s => s.date))];
    const lightDates = [...new Set(specs.filter(s => s.light).map(s => s.date))];
    if (forecastDates.length && !build) return json({ ok: false, error: 'no score build for this trip' }, 404);

    const [inputs, scoresAll, lightAll, stopsAll, accs, tripDays] = await Promise.all([
      all<any>((a, b) => db.from('solver_stop_inputs')
        .select('stop_id, name, tier, star_vantage_id, duration_minutes, time_locked, day_id, shot_status, shot_value')
        .eq('trip_id', tripId).range(a, b)),
      forecastDates.length
        ? all<any>((a, b) => db.from('solver_scores').select('stop_id, slot_at, v').eq('build_id', build!.id).order('slot_at').order('stop_id').range(a, b))
        : Promise.resolve([] as any[]),
      lightDates.length
        ? all<any>((a, b) => db.rpc('solver_light_terms', { p_trip_id: tripId, p_dates: lightDates }).order('slot_at').order('stop_id').range(a, b))
            .then(rows => rows.map(r => ({
              stop_id: r.stop_id, slot_at: r.slot_at,
              v: SCENARIOS.map(s => Math.round(250 * Math.max(0, Math.min(1,
                (r.blue ? r.dir : s * r.dir + (1 - s) * r.soft) * (r.fog_wanted ? 0.6 : 1))))),
            })))
        : Promise.resolve([] as any[]),
      all<any>((a, b) => db.from('stops').select('id, name, lat, lng, time_label, duration_minutes, drive_override_minutes, day_id, position, time_locked').eq('trip_id', tripId).range(a, b)),
      db.from('accommodations').select('name, lat, lng, check_in, check_out, nights').eq('trip_id', tripId).then(r => r.data ?? []),
      db.from('days').select('id, date').eq('trip_id', tripId).then(r => r.data ?? []),
    ]);
    const stopById = new Map(stopsAll.map(s => [s.id, s]));
    // A rated stop locked in the itinerary (stops.time_locked: Glacier View on the
    // way to the flight, Phil 27 Oct 2026) is a booking too, not a free stop.
    for (const r of inputs) if (stopById.get(r.stop_id)?.time_locked) r.time_locked = true;
    const byDate = (rows: any[]) => {
      const m = new Map<string, any[]>();
      for (const r of rows) { const d = slotDate(r.slot_at); if (!m.has(d)) m.set(d, []); m.get(d)!.push(r); }
      return m;
    };
    const scoresByDate = byDate(scoresAll), lightByDate = byDate(lightAll);

    // Rated stops with a starred shot: the only ones that carry value.
    // Block mode: only the stops of trip day block_of.
    const blockIds = body.block_of
      ? new Set(stopsAll.filter(s => tripDays.some(d => d.date === body.block_of && d.id === s.day_id)).map(s => s.id))
      : null;
    const rated = inputs.filter(r => (TIER_W[r.tier] ?? 0) > 0 && r.star_vantage_id && (!blockIds || blockIds.has(r.stop_id)));

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
    const { data: tg } = await db.from('solver_stop_settings').select('stop_id, together')
      .in('stop_id', rated.map(r => r.stop_id)).not('together', 'is', null);
    const togetherOf = new Map((tg ?? []).map(r => [r.stop_id, r.together as string]));
    const placed = stopsAll.filter(s => s.lat != null && rated.some(r => r.stop_id === s.id));
    const mid = { lat: placed.reduce((t, s) => t + s.lat, 0) / (placed.length || 1), lng: placed.reduce((t, s) => t + s.lng, 0) / (placed.length || 1) };
    // What a subject already has (x250): nailed = everything, got = shot_value.
    const groupBase = new Map<number, number>();
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
      const override: string | undefined = specs.length === 1 ? body.hotel_stop_id : undefined;
      const dayIds = new Set(tripDays.filter(d => d.date === tripDate).map(d => d.id));
      const anchors = lockedInputs
        .map(r => ({ r, s: stopById.get(r.stop_id), min: labelMinutes(stopById.get(r.stop_id)?.time_label) }))
        .filter(a => a.s && dayIds.has(a.s.day_id) && a.min != null && a.s.lat != null)
        .map(a => ({ id: a.r.stop_id, startMs: zonedToUtc(sp.date, a.min!, tz), dur: a.s.duration_minutes ?? 15 }))
        .concat((specs.length === 1 ? body.anchor_stops ?? [] : []).map((id: string) => stopById.get(id))
          .filter((s: any) => s && s.lat != null && labelMinutes(s.time_label) != null)
          .map((s: any) => ({ id: s.id, startMs: zonedToUtc(sp.date, labelMinutes(s.time_label)!, tz), dur: s.duration_minutes ?? 15 })))
        .concat(((body.anchors_on ?? []) as any[]).filter(a => a.date === (sp.trip_date ?? sp.date)).map(a => stopById.get(a.stop_id))
          .filter((s: any) => s && s.lat != null && labelMinutes(s.time_label) != null)
          .map((s: any) => ({ id: s.id, startMs: zonedToUtc(sp.date, labelMinutes(s.time_label)!, tz), dur: s.duration_minutes ?? 15 })))
        .sort((a, b) => a.startMs - b.startMs);
      const own = stopsAll.filter(s => dayIds.has(s.day_id)).sort((a, b) => a.position - b.position);
      // Arrival / departure days: a fixed-time first or last stop is where the day starts or ends.
      const edge = (s: any) => s && s.time_locked && s.lat != null && labelMinutes(s.time_label) != null ? s : null;
      const arrive = edge(own[0]), leave = own.length > 1 ? edge(own[own.length - 1]) : null;
      const notBeforeMs = arrive ? zonedToUtc(sp.date, labelMinutes(arrive.time_label)! + (arrive.duration_minutes ?? 0), tz) : null;
      const byMs = leave ? zonedToUtc(sp.date, labelMinutes(leave.time_label)!, tz) : null;
      return { date: sp.date, light: sp.light, tripDate, own, notBeforeMs, byMs,
               anchors: anchors.filter(a => a.id !== arrive?.id && a.id !== leave?.id),
               startId: override ?? arrive?.id ?? h.start, endId: override ?? leave?.id ?? h.end };
    });
    if (days.some(d => !d.startId || !d.endId)) return json({ ok: false, error: 'no hotel: pass hotel_stop_id' }, 400);
    const noScores = days.filter(d => !(d.light ? lightByDate : scoresByDate).get(d.date)?.length).map(d => d.date);
    if (noScores.length) return json({ ok: false, error: 'no scores for these dates', dates: noScores }, 404);

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
        free: !!r && !r.time_locked && r.shot_status !== 'nailed', together: togetherOf.get(id) ?? null,
      };
    });
    const freeNodes = nodes.map((n, i) => (n.free ? i : -1)).filter(i => i >= 0);

    // Value of seeing subject g at w after prev, over what is already shot.
    const gain = (g: number, w: number, prev: number | undefined) => Math.max(0, w - Math.max(prev ?? 0, groupBase.get(g) ?? 0));

    // One day: beam over partial routes from the morning hotel to the night's.
    // only: plan just these stops (blocks, improve my week), visiting all that fit.
    const planDay = (day: typeof days[number], only?: number[]): DayPlan => {
      const td0 = performance.now();
      const cand = only ?? freeNodes;
      const H0 = pos.get(day.startId!)!, H = pos.get(day.endId!)!;
      const anchors = day.anchors.map(a => ({ n: pos.get(a.id)!, startMs: a.startMs, dur: a.dur }));
      const scores = (day.light ? lightByDate : scoresByDate).get(day.date) ?? [];
      const slotMs = scores.map(r => Date.parse(r.slot_at));
      // From 90 min before the first light (else the window opens), to an
      // hour after the last (else it closes); bookings always fit.
      const winStart = zonedToUtc(day.date, hhmm(body.earliest ?? EARLIEST), tz!), winEnd = zonedToUtc(day.date, hhmm(body.latest ?? LATEST), tz!);
      const earlyStart = day.light ? winStart : zonedToUtc(day.date, hhmm(body.earliest_sunrise ?? SUNRISE_EARLIEST), tz!);
      const first = Math.min(Math.max(Math.min(...slotMs) - 90 * 60000, earlyStart), ...anchors.map(a => a.startMs - 90 * 60000));
      const last = Math.max(Math.min(Math.max(...slotMs) + 60 * 60000, winEnd), ...anchors.map(a => a.startMs + (a.dur + 60) * 60000));
      const dayStart = Math.floor(first / (SLOT * 60000)) * SLOT * 60000;
      const dayEnd = last;
      const nSlots = Math.ceil((dayEnd - dayStart) / (SLOT * 60000));
      const dayMin = (dayEnd - dayStart) / 60000;
      // Free stops stay inside the window even when a booking stretches the day.
      const winLo = Math.max(0, Math.ceil((winStart - dayStart) / (SLOT * 60000)));
      const earlyLo = Math.max(0, Math.ceil((earlyStart - dayStart) / (SLOT * 60000)));
      // A flight home: be back at the airport by its time.
      const winMin = Math.min(dayMin, (winEnd - dayStart) / 60000, day.byMs != null ? (day.byMs - dayStart) / 60000 : Infinity);
      const endBy = Math.min(dayMin, day.byMs != null ? (day.byMs - dayStart) / 60000 : Infinity);
      const winHi = Math.floor(winMin / SLOT);
      const M = scores[0]?.v.length ?? 51;
      // Rental gear: those stops only between pickup and return.
      // gear: one window over the week; gear_from / gear_to: this date only.
      const gear = new Set<string>(body.gear?.stops ?? body.gear_stops ?? []);
      const gearDate = day.tripDate ?? day.date;
      const gFrom = body.gear?.from ?? (body.gear_from ? { date: gearDate, time: body.gear_from } : null);
      const gTo = body.gear?.to ?? (body.gear_to ? { date: gearDate, time: body.gear_to } : null);
      const gearLo = !gFrom ? 0 : gearDate < gFrom.date ? Infinity : gearDate > gFrom.date ? 0
        : Math.ceil((zonedToUtc(day.date, hhmm(gFrom.time), tz!) - dayStart) / (SLOT * 60000));
      const gearHiMin = !gTo ? Infinity : gearDate > gTo.date ? -Infinity : gearDate < gTo.date ? Infinity
        : (zonedToUtc(day.date, hhmm(gTo.time), tz!) - dayStart) / 60000;
      // Done by dark: free stops end by civil dusk.
      const darkMin = placed.length ? (civilDusk(day.date, mid.lat, mid.lng, tz!) - dayStart) / 60000 : Infinity;

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

      // Landing: nothing before the arrival stop ends.
      const t0Min = day.notBeforeMs != null ? Math.max(0, (day.notBeforeMs - dayStart) / 60000) : 0;
      const root: State = { t: t0Min, loc: H0, next: 0, visited: new Uint8Array(nodes.length), m0: 0, m1: 0, groupBest: new Map(),
        total: new Float32Array(M), route: [], drive: 0, over: 0,
        j: -DRIVE_PENALTY * D[H0][H] - LONG_LEG_PENALTY * over(D[H0][H]), mean: 0, cvar: 0 };
      let pool: State[] = [];
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
        pool.push(...beam.filter(st => st.next === anchors.length && st.t + D[st.loc][H] <= endBy));
      }
      if (!anchors.length) pool.push(root);
      // Keep together: all of a group or none of it.
      const groups = new Map<string, number[]>();
      for (const n of cand) { const k = nodes[n].together; if (k) groups.set(k, [...(groups.get(k) ?? []), n]); }
      const split = [...groups.values()].filter(g => g.length > 1);
      if (split.length) pool = pool.filter(st => split.every(g => g.every(n => st.visited[n]) || g.every(n => !st.visited[n])));
      // Block mode: the routes that visit every block stop (else the most).
      if (blockIds || only) {
        const seen = (st: State) => cand.filter(n => st.visited[n]).length;
        const most = Math.max(0, ...pool.map(seen));
        pool = pool.filter(st => seen(st) === most);
      }
      pool.sort((a, b) => b.j - a.j);
      return { date: day.date, tripDate: day.tripDate, light: day.light, start: H0, end: H, dayStart, nSlots, routes: pool,
               anchors: anchors.length, ms: Math.round(performance.now() - td0), winLo, winHi, W, peak };
    };

    // Members per slot (forecast builds and light scores both carry 51).
    const M = (scoresAll[0] ?? lightAll[0])?.v.length ?? 51;
    // A subject counts once, at its best day per member, over what is already shot.
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

    let planned: DayPlan[];
    let improve: any = null;
    if (body.improve) {
      // Improve my week: start from Phil's days, keep any change that scores better.
      const mode = body.improve === 'blocks' ? 'blocks' : 'free';
      const keyOf = (d: typeof days[number]) => d.tripDate ?? d.date;
      const fixed = new Set<string>(body.fixed_days ?? []);
      let sets: number[][] = days.map(d => d.own.map(s => pos.get(s.id)).filter((n): n is number => n != null && nodes[n].free));
      // Only each day's best route is kept while searching (memory); the
      // chosen days are planned again in full at the end.
      const cache = new Map<string, { routes: State[]; end: number }>();
      const evalDay = (i: number, set: number[]) => {
        const k = i + '|' + [...set].sort((a, b) => a - b).join(',');
        let p = cache.get(k);
        if (!p) { const full = planDay(days[i], set); p = { routes: full.routes.slice(0, 1), end: full.end }; cache.set(k, p); }
        return p;
      };
      const weekScore = (ss: number[][]) => {
        const groups = new Map<number, Uint8Array>();
        let drive = 0, o = 0, lost = 0;
        ss.forEach((set, i) => {
          const p = evalDay(i, set), st = p.routes[0];
          if (!st) { for (const n of set) lost += nodes[n].w; return; }
          mergeInto(groups, st.groupBest);
          drive += st.drive + D[st.loc][p.end]; o += st.over + over(D[st.loc][p.end]);
          for (const n of set) if (!st.visited[n]) lost += nodes[n].w;
        });
        return metric(totalOf(groups)).j - DRIVE_PENALTY * drive - LONG_LEG_PENALTY * o - COVER_PENALTY * lost;
      };
      const tS = performance.now(), budget = Math.min(Number(body.budget_ms ?? 1200), 1500);
      const startScore = weekScore(sets);
      let best = startScore;
      const moves: string[] = [];
      const name = (n: number) => nodes[n].name;
      const tryIt = (ss: number[][], what: string) => {
        const v = weekScore(ss);
        if (v > best + 1e-6) { sets = ss; best = v; moves.push(what); return true; }
        return false;
      };
      let improved = true;
      search: while (improved) {
        improved = false;
        // Swap two days (their whole stop lists).
        for (let a = 0; a < days.length; a++) for (let b = a + 1; b < days.length; b++) {
          if (performance.now() - tS > budget) break search;
          if (fixed.has(keyOf(days[a])) || fixed.has(keyOf(days[b]))) continue;
          const ss = sets.slice(); [ss[a], ss[b]] = [ss[b], ss[a]];
          if (tryIt(ss, `swap ${keyOf(days[a])} and ${keyOf(days[b])}`)) { improved = true; continue search; }
        }
        if (mode === 'blocks') break;
        // Move one stop (or its keep-together group) to another day; fixed days keep their stops.
        for (let a = 0; a < days.length; a++) for (const n of sets[a]) for (let b = 0; b < days.length; b++) {
          if (a === b || fixed.has(keyOf(days[a])) || fixed.has(keyOf(days[b]))) continue;
          const k = nodes[n].together, unit = k ? sets[a].filter(x => nodes[x].together === k) : [n];
          if (unit[0] !== n) continue;
          if (performance.now() - tS > budget) break search;
          const ss = sets.map(x => x.slice()); ss[a] = ss[a].filter(x => !unit.includes(x)); ss[b].push(...unit);
          if (tryIt(ss, `move ${name(n)} from ${keyOf(days[a])} to ${keyOf(days[b])}`)) { improved = true; continue search; }
        }
      }
      planned = sets.map((set, i) => planDay(days[i], set));
      const unplanned = sets.flatMap((set, i) => set.filter(n => !planned[i].routes[0]?.visited[n]).map(n => ({ name: name(n), trip_date: keyOf(days[i]) })));
      improve = { mode, start: r2(startScore), end: r2(best), moves, unplanned, day_plans: cache.size,
                  ms: Math.round(performance.now() - tS), finished: performance.now() - tS <= budget };
    } else {
      planned = days.map(d => planDay(d));
      const missing = planned.filter(p => !p.routes.length);
      if (missing.length) return json({ ok: false, error: 'bookings cannot all be reached', days: missing.map(p => p.date) }, 422);
    }

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

    type Combo = { picks: State[]; groups: Map<number, Uint8Array>; total: Float32Array; drive: number; over: number; j: number;
                   mean: number; cvar: number; back: number | null; date: string | null };
    const homeLeg = (st: State, p: DayPlan) => D[st.loc][p.end];
    // Leaving the hotel (just in time for the first visit) and back at night, ms.
    const departMs = (p: DayPlan, st: State) => st.route.length ? p.dayStart + (st.route[0].start - st.route[0].drive) * 60000 : null;
    const backMs = (p: DayPlan, st: State) => st.route.length ? p.dayStart + (st.t + homeLeg(st, p)) * 60000 : null;
    const restRelaxed: string[] = [];
    let combos: Combo[];
    if (improve) {
      // The improved week as one plan.
      if (planned.some(p => !p.routes[0])) return json({ ok: false, error: 'a day cannot be planned', improve }, 422);
      const picks = planned.map(p => p.routes[0]);
      const groups = new Map<number, Uint8Array>();
      for (const st of picks) mergeInto(groups, st.groupBest);
      const total = totalOf(groups), m = metric(total);
      const drive = planned.reduce((t, p) => t + (p.routes[0] ? p.routes[0].drive + homeLeg(p.routes[0], p) : 0), 0);
      const o = planned.reduce((t, p) => t + (p.routes[0] ? p.routes[0].over + over(homeLeg(p.routes[0], p)) : 0), 0);
      combos = [{ picks, groups, total, drive, over: o, mean: m.mean, cvar: m.cvar,
                  j: m.j - DRIVE_PENALTY * drive - LONG_LEG_PENALTY * o, back: null, date: null }];
    } else if (planned.length === 1) {
      combos = planned[0].routes.map(st => ({ picks: [st], groups: st.groupBest, total: st.total, drive: st.drive, over: st.over, j: st.j,
                                              mean: st.mean, cvar: st.cvar, back: null, date: null }));
    } else {
      // Each day's candidate routes, at most 4 per backbone (its GOD/S subjects).
      const dayPool = (routes: State[]) => {
        const seen = new Map<string, number>(), out: State[] = [];
        for (const st of routes) {
          const key = [...st.groupBest.keys()].filter(g => (groupW.get(g) ?? 0) >= 5).sort((a, b) => a - b).join('.');
          const n = seen.get(key) ?? 0;
          if (n >= 4) continue;
          seen.set(key, n + 1); out.push(st);
          if (out.length >= DAY_POOL) break;
        }
        return out;
      };
      combos = [{ picks: [], groups: new Map(), total: new Float32Array(M), drive: 0, over: 0, j: 0, mean: 0, cvar: 0, back: null, date: null }];
      for (const p of planned) {
        const pool = dayPool(p.routes);
        const day = p.tripDate ?? p.date;
        const combine = (rest: boolean) => {
          const out: Combo[] = [];
          for (const c of combos) for (const st of pool) {
            // Enough sleep after the night before (consecutive days only).
            const dep = departMs(p, st);
            if (rest && c.back != null && dep != null && c.date === dayBefore(day) && dep - c.back < REST_HOURS * 3600000) continue;
            const groups = new Map(c.groups);
            mergeInto(groups, st.groupBest);
            const total = totalOf(groups);
            const m = metric(total);
            const drive = c.drive + st.drive + homeLeg(st, p);
            const o = c.over + st.over + over(homeLeg(st, p));
            out.push({ picks: [...c.picks, st], groups, total, drive, over: o, mean: m.mean, cvar: m.cvar,
                       j: m.j - DRIVE_PENALTY * drive - LONG_LEG_PENALTY * o, back: backMs(p, st), date: day });
          }
          return out;
        };
        let next = combine(true);
        // Bookings that leave no room for 6 h: plan anyway and say so.
        if (!next.length) { next = combine(false); restRelaxed.push(day); }
        // Keep at most 3 combos per backbone (which GOD/S subjects go on
        // which day), so the beam holds real alternatives, not 150
        // reshuffles of minor stops around one schedule.
        next.sort((a, b) => b.j - a.j);
        const perBackbone = new Map<string, number>();
        combos = [];
        for (const c of next) {
          const key = c.picks.map(st => [...st.groupBest.keys()].filter(g => (groupW.get(g) ?? 0) >= 5).sort((a, b) => a - b).join('.')).join('|');
          const n = perBackbone.get(key) ?? 0;
          if (n >= 3) continue;
          perBackbone.set(key, n + 1);
          combos.push(c);
          if (combos.length >= MULTI_BEAM) break;
        }
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

    const plans: any[] = picked.map((c, r) => ({
      rank: r + 1,
      objective: Math.round(c.j * 1000) / 1000, mean: Math.round(c.mean * 1000) / 1000, cvar11: Math.round(c.cvar * 1000) / 1000,
      drive_minutes: Math.round(c.picks.reduce((s, st, d) => s + st.drive + homeLeg(st, planned[d]), 0)),
      long_leg_minutes: Math.round(c.picks.reduce((s, st, d) => s + st.over + over(homeLeg(st, planned[d])), 0)),
      note: safestAdded && c === safest ? 'safest: best worst-case' : null,
      visits: c.picks.flatMap((st, d) => visitsOf(planned[d], st)),
    }));

    // My day: the own stops on each trip day, at their time_labels.
    const ownDays = planned.map((p, d) => {
      const own = days[d].own;
      if (!own.length) return null;
      const groups = new Map<number, Uint8Array>();
      const visits = own.map(s => {
        const n = pos.get(s.id);
        const min = labelMinutes(s.time_label);
        const slot = min == null ? null : Math.round((zonedToUtc(p.date, min, tz!) - p.dayStart) / (SLOT * 60000));
        const rated = n != null && nodes[n].w > 0;
        let at = null, best = null;
        if (rated && slot != null) {
          at = chance(p, n!, slot);
          const w = p.W(n!, slot);
          if (w) mergeInto(groups, new Map([[nodes[n!].group, w]]));
        }
        if (rated) {
          let bi = -1, bm = -1;
          for (let i = p.winLo; i <= p.winHi; i++) { const c = chance(p, n!, i); if (c && c.value > bm) { bm = c.value; bi = i; } }
          if (bi >= 0) best = { start: iso(p, bi * SLOT), ...chance(p, n!, bi) };
        }
        return {
          date: p.date, trip_date: p.tripDate, stop_id: s.id, name: s.name, booked: !!inputs.find(r => r.stop_id === s.id)?.time_locked,
          start: slot != null ? iso(p, slot * SLOT) : null, rated, ...at, best,
        };
      });
      const drive = own.reduce((t, s) => t + (s.drive_override_minutes ?? 0), 0);
      return { groups, visits, drive };
    });
    if (ownDays.some(o => o)) {
      const groups = new Map<number, Uint8Array>();
      for (const o of ownDays) if (o) mergeInto(groups, o.groups);
      const m = metric(totalOf(groups));
      const drive = ownDays.reduce((t, o) => t + (o?.drive ?? 0), 0);
      plans.unshift({
        rank: 0, objective: Math.round((m.j - DRIVE_PENALTY * drive) * 1000) / 1000,
        mean: Math.round(m.mean * 1000) / 1000, cvar11: Math.round(m.cvar * 1000) / 1000, drive_minutes: drive,
        note: 'my day: the trip day as it stands', visits: ownDays.flatMap(o => o?.visits ?? []),
      });
    }

    // Light at each scored visit's best moment, from the light cache.
    const starOf = new Map(rated.map(r => [r.stop_id, r.star_vantage_id]));
    const want = plans.flatMap(p => p.visits).filter(v => v.peak_at && starOf.has(v.stop_id));
    if (want.length) {
      const { data: lc } = await db.from('solver_light_cache').select('vantage_id, slot_at, light')
        .in('vantage_id', [...new Set(want.map(v => starOf.get(v.stop_id)))])
        .in('slot_at', [...new Set(want.map(v => v.peak_at))]);
      const lightAt = new Map((lc ?? []).map(r => [`${r.vantage_id}|${Date.parse(r.slot_at)}`, r.light]));
      for (const v of want) v.light = lightAt.get(`${starOf.get(v.stop_id)}|${Date.parse(v.peak_at)}`) ?? null;
    }

    const stats = {
      kind: (variant === 'calib' ? 'calib_' : '') + (planned.length > 1 ? 'multi' : 'day'), variant, members: M,
      days: planned.map(p => ({ date: p.date, trip_date: p.tripDate, light_only: p.light, start_hotel: nodes[p.start].name,
                                end_hotel: nodes[p.end].name, bookings: p.anchors, routes: p.routes.length, ms: p.ms })),
      candidates: freeNodes.length, ms: Math.round(performance.now() - t0), build_dates: buildDates,
      ...(blockIds ? { block_of: body.block_of, block_stops: freeNodes.map(n => nodes[n].name) } : {}),
      ...(improve ? { improve } : {}),
      window: { earliest: body.earliest ?? EARLIEST, latest: body.latest ?? LATEST, sunrise: body.earliest_sunrise ?? SUNRISE_EARLIEST,
                sunrise_min_p_good: SUNRISE_MIN_P, rest_hours: REST_HOURS, rest_relaxed: restRelaxed },
    };
    const { data: run, error: rErr } = await db.from('solver_runs').insert({
      trip_id: tripId, build_id: forecastDates.length ? build!.id : null, plan_date: planned[0].date, hotel_stop_id: nodes[planned[0].end].id,
      params: { k: K, beam: BEAM, lambda: LAMBDA, tail: TAIL, tz, days: rawDays, variant }, stats,
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
