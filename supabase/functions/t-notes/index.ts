import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { MODEL, SYSTEM, buildSchema, userText, toRules, sayLines, sunTimes, toNow, nowLines, toRecap, recapLines, type NowWord, type Recap, type Place, type TripCtx } from './logic.ts';
import { askT } from './ask.ts';
import { whatIf, costLines } from './whatif.ts';

// T-NOTES ("Tell T about your day", worksheet g4, Phil 10 Nov 2026). Phil types a note on a trip day in the
// TEST app; Claude turns it into rules the planner already knows how to follow (table t_notes, read by
// solver-replay with run config tell). A note never changes stops, ticks or stop settings.
//   {action: 'read', trip_id, date, text, as_of?, dry?, answer?} -> Claude reads the note: a draft row with rules,
//       the plain-words lines Phil sees before his OK, what T can't use, or one question back (status asking).
//       answer = Phil's pick for a question (the note is read again with it). dry = nothing stored (tests).
//       as_of = "now" for tests (ISO); else the real time.
//   {action: 'quick', trip_id, date, kind: 'sleep_in' | 'nothing_long' | 'easy_day' | 'day_off' | 'back_by' | 'skip' | 'want', time?, place?}
//       -> the same rules without Claude, saved at once (a quick button).
//   A draft that changes days after today also gets t_notes.cost a few seconds later: what the note would make T give
//       up (the rest of the trip planned with and without it; whatif.ts). Only where notes are switched on for the trip.
//   A note can also say what is true right now (t_notes.now: where Phil is, how late he is, how much longer he is
//       staying, what he sees of the peaks): on save T re-plans the rest of today from it once (planner_t_now_here)
//       and a sky report is kept in t_reports. It can report how places went (t_notes.recap: proposed ticks, set on
//       save with solver_mark_shot; never lowers a tick). And it can ask T a question (status 'answer', t_notes.answer:
//       why a place is on a day, the best day for a place, what a change would cost); a question changes nothing.
//   {action: 'save', id}  -> draft -> active (a note with no lasting rule: done), then the affected days are
//       re-planned (planner_t_note_replan).
//   {action: 'clear', id} -> active / draft -> cleared, re-planned.
// Spend: claude_usage (fn t-notes), stops at CLAUDE_NOTES_CAP_USD (default 30 a month) or CLAUDE_MONTHLY_CAP_USD.

const NOTES_CAP_USD = Number(Deno.env.get('CLAUDE_NOTES_CAP_USD') ?? 30);  // 30: the reading tests alone used ~$21 in November 2026 (2-4 cents a note in use)
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
const PRICE_IN = 4, PRICE_OUT = 20;  // $ per million tokens (Opus)

// Local tests only (tools/tell_t/flow_test.py; never set on the deployed function): T_NOTES_TEST=1 lets a request carry
// Claude's answer ready-made (body.parsed) and force a what-if on a trip without notes switched on; SOLVER_URL points
// the what-if at a planner running on this machine.
const TEST = Deno.env.get('T_NOTES_TEST') === '1';
const SOLVER_URL = Deno.env.get('SOLVER_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/solver-replay`;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function tripCtx(db: any, tripId: string, asOf: Date): Promise<TripCtx | null> {
  const { data: trip } = await db.from('trips').select('id, title, timezone').eq('id', tripId).maybeSingle();
  if (!trip) return null;
  const tz = trip.timezone ?? 'UTC';
  const [{ data: days }, { data: accs }] = await Promise.all([
    db.from('days').select('id, date').eq('trip_id', tripId).order('date'),
    db.from('accommodations').select('name, check_in, check_out').eq('trip_id', tripId),
  ]);
  const dayIds = (days ?? []).map((d: any) => d.id);
  const { data: stops } = await db.from('stops').select('id, day_id, name, lat, lng, duration_minutes, time_label, time_locked, position').in('day_id', dayIds);
  const { data: sets } = await db.from('solver_stop_settings').select('stop_id, tier').in('stop_id', (stops ?? []).map((s: any) => s.id));
  const tier = new Map<string, string | null>((sets ?? []).map((s: any) => [s.stop_id, s.tier]));
  const dateOf = new Map<string, string>((days ?? []).map((d: any) => [d.id, d.date]));
  // A place = every rated stop with the same name (Oxbow Bend is on three days: one place).
  const byName = new Map<string, Place>();
  for (const s of (stops ?? []).filter((s: any) => tier.get(s.id) && !s.time_locked)) {
    const p: Place = byName.get(s.name) ?? { name: s.name, ids: [], minutes: [], days: [], tier: tier.get(s.id)! };
    p.ids.push(s.id); p.minutes.push(s.duration_minutes ?? 60); p.days.push(dateOf.get(s.day_id)!);
    byName.set(s.name, p);
  }
  const bookings = (stops ?? []).filter((s: any) => s.time_locked).map((s: any) => ({ name: s.name, date: dateOf.get(s.day_id)!, time: s.time_label ?? '' }));
  // Rental gear from the trip's planner settings (planner_t_trips.config.gear): the window is 30 min after pickup to
  // 20 min before the return, so the shop times are worked back from it.
  const { data: pt } = await db.from('planner_t_trips').select('config').eq('trip_id', tripId).maybeSingle();
  const g = pt?.config?.gear, shift = (x: any, m: number) => { if (!x?.time) return undefined; const [h, mi] = String(x.time).split(':').map(Number), v = h * 60 + mi + m; return { date: x.date, time: `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` }; };
  const gearIds = new Set<string>((g?.stops ?? []) as string[]);
  const gear = gearIds.size ? { places: [...byName.values()].filter(p => p.ids.some(id => gearIds.has(id))).map(p => p.name).sort(), pickup: shift(g.from, -30), ret: shift(g.to, 20) } : undefined;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(fmt.formatToParts(asOf).map(p => [p.type, p.value]));
  const placed = (stops ?? []).filter((s: any) => s.lat != null && s.lng != null);
  const lat = placed.reduce((t: number, s: any) => t + s.lat, 0) / (placed.length || 1), lng = placed.reduce((t: number, s: any) => t + s.lng, 0) / (placed.length || 1);
  const sun = placed.length ? Object.fromEntries((days ?? []).map((d: any) => [d.date, sunTimes(d.date, lat, lng, tz)])) : undefined;
  return { tripId, name: trip.title, tz, sun, gear, dates: (days ?? []).map((d: any) => d.date), places: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
           bookings, hotels: (accs ?? []).map((a: any) => ({ name: String(a.name ?? 'the hotel').split(/[,(]| — /)[0].trim(), from: a.check_in, to: a.check_out })),
           today: `${parts.year}-${parts.month}-${parts.day}`, nowClock: `${parts.hour}:${parts.minute}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const body = await req.json().catch(() => ({}));
    const replan = async (tripId: string, from: string | null, to: string | null) => {
      // A planning step in flight is never touched: try again a few seconds later (a step takes 1-5 s).
      for (let i = 0; ; i++) {
        const { data, error } = await db.rpc('planner_t_note_replan', { p_trip: tripId, p_from: from, p_to: to });
        if (error) return { ok: false, error: error.message };
        if (!data?.busy || i >= 5) return data;
        await new Promise(r => setTimeout(r, 4000));
      }
    };
    if (body.action === 'save' || body.action === 'clear') {
      const { data: row } = await db.from('t_notes').select('*').eq('id', body.id).maybeSingle();
      if (!row) return json({ ok: false, error: 'note not found' }, 404);
      if (!TEST && body.action === 'save') {
        const { data: tell } = await db.rpc('planner_t_tell', { p_trip: row.trip_id });
        if (tell !== true) return json({ ok: false, error: 'Notes for T are not switched on for this trip yet.' }, 403);
      }
      if (body.action === 'save') {
        if (row.status !== 'draft') return json({ ok: false, error: row.status === 'active' || row.status === 'done' ? 'already saved' : 'this note is not ready to save' }, 400);
        const nRules = (row.rules ?? []).length, now = (row.now ?? null) as NowWord | null, recap = ((row.recap ?? []) as Recap[]);
        if (!nRules && !now && !recap.length) return json({ ok: false, error: 'nothing in this note for T to follow' }, 400);
        // 1. Ticks from the recap. The entry on the note's day (else the nearest day before it, else the first);
        // a tick is never lowered (a nailed place stays nailed), and "missed" leaves the ticks as they are.
        const marks: { place: string; result: string; set: boolean }[] = [];
        for (const r of recap) {
          const order = r.ids.map((id, i) => ({ id, d: r.days?.[i] ?? '' })).sort((a, b) => a.d.localeCompare(b.d));
          const pick = order.find(o => o.d === row.typed_on) ?? [...order].reverse().find(o => o.d && o.d < row.typed_on) ?? order[0];
          const { data: cur } = await db.from('solver_stop_settings').select('stop_id, shot_status').in('stop_id', r.ids);
          // deno-lint-ignore no-explicit-any
          const has = (st: string) => ((cur ?? []) as any[]).some(c => c.shot_status === st);
          const set = r.result === 'nailed' ? !has('nailed') : r.result === 'got' ? !has('nailed') && !has('got') : false;
          if (set) {
            const { error } = await db.rpc('solver_mark_shot', { p_stop_id: pick.id, p_status: r.result, p_at: new Date().toISOString() });
            if (error) return json({ ok: false, error: `could not mark ${r.place}: ${error.message}` }, 500);
          }
          marks.push({ place: r.place, result: r.result, set });
        }
        await db.from('t_notes').update({ status: nRules ? 'active' : 'done', saved_at: new Date().toISOString() }).eq('id', row.id);
        const tz = (await db.from('trips').select('timezone').eq('id', row.trip_id).maybeSingle()).data?.timezone ?? 'UTC';
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        // 2. Rules (and new ticks) re-plan the days they touch; 3. word from the field re-plans the rest of today.
        const re = nRules ? await replan(row.trip_id, row.from_date, row.to_date) : marks.some(m => m.set) ? await replan(row.trip_id, today, null) : null;
        let nowRe: unknown = null;
        if (now) {
          if (now.sky) await db.from('t_reports').insert({ trip_id: row.trip_id, sky: now.sky, place: now.here?.place ?? null, text: row.text, note_id: row.id });
          if (now.here || now.late_min || now.stay_min || now.sky === 'out' || now.sky === 'hidden') {
            const here = { ...(now.here?.stop_id ? { stop_id: now.here.stop_id } : {}), ...(now.here?.hotel ? { hotel: true } : {}),
                           ...(now.late_min ? { late_min: now.late_min } : {}), ...(now.stay_min ? { stay_min: now.stay_min } : {}), ...(now.sky ? { sky: now.sky } : {}) };
            const { data, error } = await db.rpc('planner_t_now_here', { p_trip: row.trip_id, p_here: here });
            nowRe = error ? { ok: false, error: error.message } : data;
          }
        }
        return json({ ok: true, ...(re ? { replan: re } : {}), ...(now ? { now: nowRe } : {}), ...(marks.length ? { marks } : {}) });
      } else {
        if (row.status === 'cleared') return json({ ok: true, note: row });
        await db.from('t_notes').update({ status: 'cleared', cleared_at: new Date().toISOString() }).eq('id', row.id);
        if (row.status !== 'active') return json({ ok: true });
      }
      return json({ ok: true, replan: await replan(row.trip_id, row.from_date, row.to_date) });
    }
    if (body.action !== 'read' && body.action !== 'quick') return json({ ok: false, error: 'unknown action' }, 400);
    // Nothing is stored for a trip where notes are not switched on (planner_t_tell). A dry read (tests) stores nothing.
    if (!TEST && !(body.action === 'read' && body.dry)) {
      const { data: tell } = await db.rpc('planner_t_tell', { p_trip: String(body.trip_id ?? '') });
      if (tell !== true) return json({ ok: false, error: 'Notes for T are not switched on for this trip yet.' }, 403);
    }
    const asOf = body.as_of ? new Date(body.as_of) : new Date();
    const ctx = await tripCtx(db, String(body.trip_id ?? ''), asOf);
    if (!ctx) return json({ ok: false, error: 'trip not found' }, 404);
    const date = String(body.date ?? '');
    if (!ctx.dates.includes(date)) return json({ ok: false, error: 'that date is not a day of this trip' }, 400);
    // A past day's card takes no notes (the app shows no box there; never left to Claude to pick another day).
    if (date < ctx.today) return json({ ok: false, error: 'That day is over, so T can\'t change it. Put the note on today or a later day.' }, 400);

    let out: { rules: any[]; cant: string[]; ask: any; raw: any[]; now?: NowWord | null; recap?: Recap[]; question?: any; nowRaw?: any; recapRaw?: any }, cost: number | null = null, model: string | null = null;
    let text = String(body.text ?? '').trim().slice(0, 1000);
    if (body.action === 'quick') {
      const k = String(body.kind ?? ''), place = ctx.places.find(p => p.name === body.place)?.name;
      const one = (r: any) => [{ dates: [date], rest_of_trip: false, time: null, from: null, to: null, places: [], then_places: [], at_place: null, minutes: null, count: null, factor: null, tier: null, label: null, why: 'Quick button', ...r }];
      const raw = k === 'sleep_in' ? one({ type: 'leave_after', time: body.time ?? '08:30' })
        : k === 'nothing_long' ? one({ type: 'max_visit', minutes: 90 })
        : k === 'day_off' ? one({ type: 'day_off' })
        : k === 'easy_day' ? [...one({ type: 'max_stops', count: 3 }), ...one({ type: 'max_visit', minutes: 120 })]
        : k === 'back_by' && body.time ? one({ type: 'back_by', time: body.time })
        : k === 'skip' && place ? one({ type: 'skip', places: [place] })
        : k === 'want' && place ? one({ type: 'must', places: [place] }) : null;
      if (!raw) return json({ ok: false, error: 'that quick button needs a time or a place' }, 400);
      text = k === 'sleep_in' ? 'Sleep in' : k === 'nothing_long' ? 'Nothing long' : k === 'day_off' ? 'Day off' : k === 'easy_day' ? 'Easy day' : k === 'back_by' ? `Back by ${body.time}` : k === 'skip' ? `Skip ${place}` : `Want ${place}`;
      out = { ...toRules(ctx, date, raw), ask: null, raw };
    } else {
      if (text.length < 2) return json({ ok: false, error: 'the note is empty' }, 400);
      let parsed: any;
      if (TEST && body.parsed) parsed = body.parsed;
      else {
        const key = Deno.env.get('ANTHROPIC_API_KEY');
        if (!key) return json({ ok: false, error: 'Claude is not set up for notes' }, 500);
        const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const { data: mine } = await db.from('claude_usage').select('cost_usd').eq('fn', 't-notes').gte('at', month.toISOString());
        const spentMine = (mine ?? []).reduce((t: number, r: any) => t + Number(r.cost_usd ?? 0), 0);
        const { data: all } = await db.rpc('claude_spend_month');
        if (spentMine >= NOTES_CAP_USD || Number(all ?? 0) >= MONTHLY_CAP_USD) return json({ ok: false, error: 'the monthly Claude limit is reached: use the quick buttons' }, 429);
        const client = new Anthropic({ apiKey: key });
        const msg: any = await client.beta.messages.create({
          model: MODEL, max_tokens: 4000,
          betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: buildSchema(ctx) } },
          system: SYSTEM,
          messages: [{ role: 'user', content: userText(ctx, date, text, body.answer ?? null) }],
        } as any);
        const inTok = msg.usage?.input_tokens ?? 0, outTok = msg.usage?.output_tokens ?? 0;
        cost = Math.round((inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6 * 1e5) / 1e5; model = msg.model ?? MODEL;
        await db.from('claude_usage').insert({ fn: 't-notes', purpose: 'note_read', model, input_tokens: inTok, output_tokens: outTok, cost_usd: cost });
        if (msg.stop_reason === 'refusal') return json({ ok: false, error: 'Claude could not read that note' }, 422);
        const t = msg.content.find((b: any) => b.type === 'text')?.text;
        if (!t) return json({ ok: false, error: `no answer from Claude (${msg.stop_reason})` }, 502);
        parsed = JSON.parse(t);
      }
      out = { ...toRules(ctx, date, parsed.rules ?? []), ask: parsed.ask ?? null, raw: parsed.rules ?? [], nowRaw: parsed.now ?? null, recapRaw: parsed.recap ?? [] };
      const q = parsed.question && typeof parsed.question === 'object' ? parsed.question : null;
      if (q) out.question = { kind: String(q.kind), places: ((q.places ?? []) as string[]).filter(n => ctx.places.some(p => p.name === n)), text: String(q.text ?? '').slice(0, 300) };
      else {
        const nw = toNow(ctx, date, parsed.now), rc = toRecap(ctx, date, parsed.recap ?? []);
        out.now = nw.now; out.recap = rc.recap; out.cant.push(...nw.cant, ...rc.cant);
      }
      out.cant.push(...((parsed.cant_use ?? []) as string[]));
      if (out.ask && (out.rules.length || out.now || out.recap?.length || out.question)) out.ask = null;  // a question back only when nothing could be read
    }
    // Ask T: a question is answered and nothing is kept as a rule. "What if ...": the rules are the "if".
    let answer: any = null;
    if (out.question) {
      const ifRules = out.question.kind === 'what_if' ? out.rules : [];
      out.rules = [];
      const lines: string[] = [];
      if (out.question.kind === 'what_if') {
        if (!ifRules.length) lines.push('T could not tell what change you mean. Try "what if we skip Jenny Lake?" or "what if we are back by 4 on Friday?".');
        else if (!body.dry) {
          const c = await whatIf(db, ctx.tripId, ifRules, SOLVER_URL, { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }, TEST && !!body.force);
          lines.push(...(c.status === 'none' ? ['T can\'t work that out for this trip yet.'] : costLines(c)));
          // The comparison covers the days after today; a change that also touches today is said, not hidden.
          if (c.status !== 'none' && ifRules.some((r: any) => (r.dates ?? [r.from_date]).some((d: string) => d <= ctx.today))) lines.push('Today\'s own plan would change too: T re-plans today when you send it as a note.');
        }
      } else lines.push(...await askT(db, ctx, out.question));   // read-only, so a dry read answers too
      answer = { ...out.question, lines, ...(ifRules.length ? { if_rules: ifRules, if_say: sayLines(ctx, ifRules) } : {}) };
    }
    const say = [...sayLines(ctx, out.rules), ...nowLines(out.now ?? null), ...recapLines(out.recap ?? [])];
    const ds = out.rules.flatMap(r => r.dates ?? []), open = out.rules.some(r => !r.dates);
    const from = out.rules.length ? [...ds, ...out.rules.filter(r => !r.dates).map(r => r.from_date)].sort()[0] : date;
    const to = open ? null : (ds.length ? [...ds].sort().pop()! : date);
    const row = { trip_id: ctx.tripId, typed_on: date, text, source: body.action === 'quick' ? 'quick' : 'typed',
                  status: answer ? 'answer' : out.ask ? 'asking' : body.action === 'quick' ? 'active' : 'draft', rules: out.rules, say, info: out.cant, ask: out.ask,
                  now: out.now ?? null, recap: out.recap?.length ? out.recap : null, answer,
                  from_date: from, to_date: to, cost_usd: cost, model, ...(body.action === 'quick' ? { saved_at: new Date().toISOString() } : {}) };
    if (body.dry) return json({ ok: true, note: row, raw: out.raw, raw_now: out.nowRaw ?? null, raw_recap: out.recapRaw ?? [] });
    const { data: ins, error } = await db.from('t_notes').insert(row).select('*').single();
    if (error) throw error;
    // What the note would cost, worked out after the answer has gone back (the app reads t_notes.cost when it lands).
    if (ins.status === 'draft' && out.rules.length && (to == null || to > ctx.today)) {
      const job = (async () => {
        try {
          const c = await whatIf(db, ctx.tripId, out.rules, SOLVER_URL, { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }, TEST && !!body.force);
          await db.from('t_notes').update({ cost: { ...c, lines: costLines(c), at: new Date().toISOString() } }).eq('id', ins.id);
        } catch (e) { await db.from('t_notes').update({ cost: { status: 'none', why: String((e as Error)?.message ?? e).slice(0, 200) } }).eq('id', ins.id); }
      })();
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(job) : await job;
    }
    return json({ ok: true, note: ins, ...(body.action === 'quick' ? { replan: await replan(ctx.tripId, from, to) } : {}) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
