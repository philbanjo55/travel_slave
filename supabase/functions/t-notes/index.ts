import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { MODEL, SYSTEM, buildSchema, userText, toRules, sayLines, sunTimes, type Place, type TripCtx } from './logic.ts';

// T-NOTES ("Tell T about your day", worksheet g4, Phil 10 Nov 2026). Phil types a note on a trip day in the
// TEST app; Claude turns it into rules the planner already knows how to follow (table t_notes, read by
// solver-replay with run config tell). A note never changes stops, ticks or stop settings.
//   {action: 'read', trip_id, date, text, as_of?, dry?, answer?} -> Claude reads the note: a draft row with rules,
//       the plain-words lines Phil sees before his OK, what T can't use, or one question back (status asking).
//       answer = Phil's pick for a question (the note is read again with it). dry = nothing stored (tests).
//       as_of = "now" for tests (ISO); else the real time.
//   {action: 'quick', trip_id, date, kind: 'sleep_in' | 'nothing_long' | 'easy_day' | 'day_off' | 'back_by' | 'skip' | 'want', time?, place?}
//       -> the same rules without Claude, saved at once (a quick button).
//   {action: 'save', id}  -> draft -> active, then the affected days are re-planned (planner_t_note_replan).
//   {action: 'clear', id} -> active / draft -> cleared, re-planned.
// Spend: claude_usage (fn t-notes), stops at CLAUDE_NOTES_CAP_USD (default 5 a month) or CLAUDE_MONTHLY_CAP_USD.

const NOTES_CAP_USD = Number(Deno.env.get('CLAUDE_NOTES_CAP_USD') ?? 5);
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
const PRICE_IN = 4, PRICE_OUT = 20;  // $ per million tokens (Opus)

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
           bookings, hotels: (accs ?? []).map((a: any) => ({ name: String(a.name ?? 'the hotel').split(/[,(]/)[0].trim(), from: a.check_in, to: a.check_out })),
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
      if (body.action === 'save') {
        if (row.status !== 'draft') return json({ ok: false, error: row.status === 'active' ? 'already saved' : 'this note is not ready to save' }, 400);
        if (!(row.rules ?? []).length) return json({ ok: false, error: 'nothing in this note for T to follow' }, 400);
        await db.from('t_notes').update({ status: 'active', saved_at: new Date().toISOString() }).eq('id', row.id);
      } else {
        if (row.status === 'cleared') return json({ ok: true, note: row });
        await db.from('t_notes').update({ status: 'cleared', cleared_at: new Date().toISOString() }).eq('id', row.id);
        if (row.status !== 'active') return json({ ok: true });
      }
      return json({ ok: true, replan: await replan(row.trip_id, row.from_date, row.to_date) });
    }
    if (body.action !== 'read' && body.action !== 'quick') return json({ ok: false, error: 'unknown action' }, 400);
    const asOf = body.as_of ? new Date(body.as_of) : new Date();
    const ctx = await tripCtx(db, String(body.trip_id ?? ''), asOf);
    if (!ctx) return json({ ok: false, error: 'trip not found' }, 404);
    const date = String(body.date ?? '');
    if (!ctx.dates.includes(date)) return json({ ok: false, error: 'that date is not a day of this trip' }, 400);
    // A past day's card takes no notes (the app shows no box there; never left to Claude to pick another day).
    if (date < ctx.today) return json({ ok: false, error: 'That day is over, so T can\'t change it. Put the note on today or a later day.' }, 400);

    let out: { rules: any[]; cant: string[]; ask: any; raw: any[] }, cost: number | null = null, model: string | null = null;
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
      const parsed = JSON.parse(t);
      out = { ...toRules(ctx, date, parsed.rules ?? []), ask: parsed.ask ?? null, raw: parsed.rules ?? [] };
      out.cant.push(...((parsed.cant_use ?? []) as string[]));
      if (out.ask && out.rules.length) out.ask = null;  // a question only when nothing could be read
    }
    const say = sayLines(ctx, out.rules);
    const ds = out.rules.flatMap(r => r.dates ?? []), open = out.rules.some(r => !r.dates);
    const from = out.rules.length ? [...ds, ...out.rules.filter(r => !r.dates).map(r => r.from_date)].sort()[0] : date;
    const to = open ? null : (ds.length ? [...ds].sort().pop()! : date);
    const row = { trip_id: ctx.tripId, typed_on: date, text, source: body.action === 'quick' ? 'quick' : 'typed',
                  status: out.ask ? 'asking' : body.action === 'quick' ? 'active' : 'draft', rules: out.rules, say, info: out.cant, ask: out.ask,
                  from_date: from, to_date: to, cost_usd: cost, model, ...(body.action === 'quick' ? { saved_at: new Date().toISOString() } : {}) };
    if (body.dry) return json({ ok: true, note: row, raw: out.raw });
    const { data: ins, error } = await db.from('t_notes').insert(row).select('*').single();
    if (error) throw error;
    return json({ ok: true, note: ins, ...(body.action === 'quick' ? { replan: await replan(ctx.tripId, from, to) } : {}) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
