import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

// CLAUDE PLANNER (worksheet G1, Phil 6 Nov 2026): Claude plans one past test night with the solver as a
// tool, then both Claude's plan and T's are graded against what happened (nothing shot before, so the
// two are on the same footing). Bench only; never touches a trip.
//
// POST {run_id, night, kind?: 'mrmc', model?: 'claude-opus-5-5', effort?: 'medium', max_calls?: 12}
// returns at once with the claude_pilot row id; the work runs in the background and fills the row.
// Tools (solver-replay tool mode, read only): solve_day {must?, skip?}, score_plan {visits},
// submit_plan {visits, notes}. Spend is logged to claude_usage (fn claude-planner) and stops at
// CLAUDE_PILOT_CAP_USD (default 5) or the shared CLAUDE_MONTHLY_CAP_USD.

const PILOT_CAP_USD = Number(Deno.env.get('CLAUDE_PILOT_CAP_USD') ?? 5);
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
const PRICES: Record<string, [number, number]> = { 'claude-opus': [4, 20], 'claude-sonnet': [2, 10], 'claude-haiku': [0.1, 0.5] };
const costUsd = (model: string, inTok: number, outTok: number) => {
  const p = Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1] ?? PRICES['claude-opus'];
  return (inTok * p[0] + outTok * p[1]) / 1e6;
};

const SYSTEM = `You plan one day of a landscape photographer's trip. The photographer shoots the places listed; each has a tier (GOD most important, then S, A, B, C, D), a visit length in minutes, and drive times between places.
A shot is good when the subject is visible (peaks not hidden by cloud) in decent light. For each place you get, per hour, the share of weather forecasts that say a good shot (0-100).
The day starts and ends at the start place. Rules: be at each place for its full visit length; drives take the listed minutes; free visits should end by dark; a place marked once_only is a ski or hike outing that can only be done once on the trip; places with the same 'together' key go on the same day or not at all.
Points: a visit earns its tier points times how good the shot turns out (0-1); the same place twice counts only its better shot.
You have a solver. solve_day returns its best plans, optionally forcing places in (must) or out (skip). score_plan scores any plan you write, on the same forecasts, and lists rule problems. Use them to test ideas: the solver is good at timing and routing, you may know things it doesn't (for example that a long outing on a poor day wastes the day, or that spreading risk is wise). When you are done, call submit_plan with your final visits (stop_id and start time as ISO 8601 UTC). Keep tool calls under the limit you are given.`;

Deno.serve(async (req) => {
  const json = (b: any, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const runId = Number(body.run_id), night = Number(body.night), kind = String(body.kind ?? 'mrmc');
    const model = String(body.model ?? 'claude-opus-5-5'), effort = String(body.effort ?? 'medium');
    const maxCalls = Math.min(Math.max(Number(body.max_calls ?? 12), 2), 20);
    if (!Number.isFinite(runId) || !Number.isFinite(night)) return json({ ok: false, error: 'run_id and night required' }, 400);
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key || Deno.env.get('CLAUDE_LABELS') === 'false') return json({ ok: false, error: 'Claude off' });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: month } = await db.rpc('claude_spend_month');
    if (Number(month ?? 0) >= MONTHLY_CAP_USD) return json({ ok: false, error: 'monthly spend cap reached' });
    const { data: spent } = await db.from('claude_usage').select('cost_usd').eq('fn', 'claude-planner');
    const pilot = (spent ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
    if (pilot >= PILOT_CAP_USD) return json({ ok: false, error: 'pilot cap reached', spent: pilot });
    const { data: row, error: rowErr } = await db.from('claude_pilot').insert({ run_id: runId, night, kind, model }).select('id').single();
    if (rowErr) throw rowErr;

    const tool = async (op: string, extra: any = {}) => {
      const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/solver-replay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, kind, night, tool: op, ...extra }),
      });
      return await r.json();
    };

    const work = (async () => {
      let cost = 0, calls = 0, submitted: any = null, notes = '';
      const transcript: any[] = [];
      try {
        const ctx = await tool('context');
        if (!ctx.ok) throw new Error(`context: ${ctx.error}`);
        const { data: rd } = await db.from('replay_run_days').select('visits').eq('run_id', runId).eq('night', night).eq('kind', kind).maybeSingle();
        const tVisits = ((rd?.visits ?? []) as any[]).filter(v => v.stop_id && v.start).map(v => ({ stop_id: v.stop_id, start: v.start }));
        const best = await tool('solve');
        const bestVisits = (best.plans?.[0]?.stops ?? []).map((v: any) => ({ stop_id: v.stop_id, start: v.start_iso }));

        const client = new Anthropic({ apiKey: key });
        const tools: any[] = [
          { name: 'solve_day', description: "The solver's best plans for the day (up to 3), each with its visits, forecast mean points, bad-day points and each visit's chance. must: stop_ids that have to be in; skip: stop_ids left out.",
            input_schema: { type: 'object', properties: { must: { type: 'array', items: { type: 'string' } }, skip: { type: 'array', items: { type: 'string' } } } } },
          { name: 'score_plan', description: 'Score a plan you propose on the same forecasts: mean points, bad-day points, each visit\'s chance, and any rule problems (late arrival, past dark).',
            input_schema: { type: 'object', required: ['visits'], properties: { visits: { type: 'array', items: { type: 'object', required: ['stop_id', 'start'], properties: { stop_id: { type: 'string' }, start: { type: 'string', description: 'ISO 8601 UTC' } } } } } } },
          { name: 'submit_plan', description: 'Your final plan for the day. Ends the task.',
            input_schema: { type: 'object', required: ['visits'], properties: { visits: { type: 'array', items: { type: 'object', required: ['stop_id', 'start'], properties: { stop_id: { type: 'string' }, start: { type: 'string' } } } }, notes: { type: 'string', description: 'One or two sentences on why.' } } } },
        ];
        const messages: any[] = [{ role: 'user', content: `Plan this day. You may call tools at most ${maxCalls} times in all, including submit_plan.\n\n${JSON.stringify({ ...ctx, ok: undefined })}` }];
        for (let turn = 0; turn < maxCalls + 2 && !submitted; turn++) {
          const res: any = await client.messages.create({
            model, max_tokens: 16000, system: SYSTEM, tools, messages,
            output_config: { effort },
          } as any);
          const inTok = res.usage?.input_tokens ?? 0, outTok = res.usage?.output_tokens ?? 0, c = costUsd(res.model ?? model, inTok, outTok);
          cost += c;
          await db.from('claude_usage').insert({ fn: 'claude-planner', purpose: 'pilot_plan', model: res.model, input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round(c * 1e5) / 1e5 });
          messages.push({ role: 'assistant', content: res.content });
          if (res.stop_reason === 'refusal' || res.stop_reason === 'end_turn') { notes = 'stopped without submitting'; break; }
          const uses = res.content.filter((b: any) => b.type === 'tool_use');
          if (!uses.length) break;
          const results: any[] = [];
          for (const u of uses) {
            calls++;
            transcript.push({ tool: u.name, input: u.input });
            let out: any;
            if (calls > maxCalls && u.name !== 'submit_plan') out = { error: 'tool call limit reached: submit your plan now' };
            else if (u.name === 'solve_day') out = await tool('solve', { must: u.input.must ?? [], skip: u.input.skip ?? [] });
            else if (u.name === 'score_plan') out = await tool('score', { visits: u.input.visits ?? [] });
            else if (u.name === 'submit_plan') { submitted = u.input.visits ?? []; notes = String(u.input.notes ?? ''); out = { ok: true }; }
            else out = { error: 'unknown tool' };
            results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) });
          }
          messages.push({ role: 'user', content: results });
        }
        const [cg, tg, bg] = await Promise.all([
          submitted ? tool('grade', { visits: submitted }) : Promise.resolve(null),
          tVisits.length ? tool('grade', { visits: tVisits }) : Promise.resolve(null),
          bestVisits.length ? tool('grade', { visits: bestVisits }) : Promise.resolve(null),
        ]);
        await db.from('claude_pilot').update({
          status: submitted ? 'done' : 'no plan', claude_plan: submitted, claude_realized: cg?.realized ?? null,
          t_plan: tVisits, t_realized: tg?.realized ?? null, solver_best_realized: bg?.realized ?? null,
          calls, cost_usd: Math.round(cost * 1e4) / 1e4, note: notes.slice(0, 1000), transcript, done_at: new Date().toISOString(),
        }).eq('id', row.id);
      } catch (e: any) {
        await db.from('claude_pilot').update({ status: 'error', note: String(e?.message ?? e).slice(0, 500), calls, cost_usd: Math.round(cost * 1e4) / 1e4, transcript, done_at: new Date().toISOString() }).eq('id', row.id);
      }
    })();
    (globalThis as any).EdgeRuntime?.waitUntil?.(work);
    return json({ ok: true, id: row.id });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
