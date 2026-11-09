import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

// T-REVIEW (worksheet g3, Phil 9 Nov 2026: "yes"): Claude checks one of T's published plans for what
// the planner can't see (road and trail closures, avalanche danger for ski / snowshoe outings, wind and
// weather warnings, wildlife closures, opening hours), with live web search. Flags only: it never
// changes a plan or a stop. Queued by t_review_queue() (pg_cron t-review, every 10 min) for trips with
// planner_t_trips.review (Teton Live first). POST {review_id}: returns at once, fills the t_reviews row.
// Spend goes to claude_usage (fn t-review) and stops at CLAUDE_REVIEW_CAP_USD (default 15 a month) or
// the shared CLAUDE_MONTHLY_CAP_USD.

const REVIEW_CAP_USD = Number(Deno.env.get('CLAUDE_REVIEW_CAP_USD') ?? 15);
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
const MODEL = 'claude-opus-5-5';
const PRICE_IN = 4, PRICE_OUT = 20, PRICE_SEARCH = 0.01; // $ per million tokens, $ per web search

const SYSTEM = `You check a landscape photographer's plan for one day, made by a weather planner. The planner already weighs cloud, light and sun; it cannot see anything else. Your job is the rest: things that would stop a planned stop from happening or make it unsafe on that date.
Check, with web search and by reading official pages:
- Road and trail closures and road conditions for each stop on the plan (the park service's alerts and road status pages first, then the state road department).
- Avalanche danger, for ski and snowshoe outings (the regional avalanche center's current forecast).
- Weather warnings and advisories for the area (the National Weather Service or the national weather office): high wind, winter storm, dense fog, extreme cold.
- Wildlife or seasonal closures, and opening hours of anything the plan relies on (a visitor center, a groomed trail, a rental).
Rules:
- Flag only real, current problems that touch a planned stop on the plan's date. A normal seasonal closure that the stop's own notes already plan around (for example a road closed to cars that the plan skis in on) is not a problem: list it under checks, not flags.
- Say where each finding comes from (site name). If you could not find something out, say so in checks; never guess.
- Plain short words, no jargon. Times in the trip's local time.
When done, call submit_review once.`;

const SUBMIT = {
  name: 'submit_review',
  description: 'Your review of the plan. Call once, at the end.',
  input_schema: {
    type: 'object', required: ['verdict', 'summary', 'flags', 'checks'],
    properties: {
      verdict: { type: 'string', enum: ['ok', 'check', 'problem'], description: 'ok = nothing found; check = worth a look or a phone call; problem = a stop cannot happen or is unsafe as planned' },
      summary: { type: 'string', description: 'One to three plain sentences for the photographer.' },
      flags: { type: 'array', items: { type: 'object', required: ['stop', 'issue', 'severity', 'action', 'source'], properties: {
        stop: { type: 'string', description: 'Stop name as in the plan' },
        issue: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'warn', 'block'] },
        action: { type: 'string', enum: ['none', 'call ahead', 'skip', 'move', 'go earlier', 'go later'] },
        source: { type: 'string' } } } },
      checks: { type: 'array', items: { type: 'object', required: ['what', 'result', 'source'], properties: {
        what: { type: 'string' }, result: { type: 'string' }, source: { type: 'string' } } } },
    },
  },
};

Deno.serve(async (req) => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const body = await req.json().catch(() => ({}));
  const id = Number(body.review_id);
  if (!id) return json({ ok: false, error: 'review_id needed' }, 400);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const work = (async () => {
    const fail = async (error: string, status = 'error') =>
      void await db.from('t_reviews').update({ status, error: error.slice(0, 500), done_at: new Date().toISOString() }).eq('id', id);
    try {
      const { data: rv } = await db.from('t_reviews').select('*').eq('id', id).single();
      if (!rv) return;
      const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
      const { data: mine } = await db.from('claude_usage').select('cost_usd').eq('fn', 't-review').gte('at', month.toISOString());
      const spentMine = (mine ?? []).reduce((t: number, r: any) => t + Number(r.cost_usd ?? 0), 0);
      const { data: all } = await db.rpc('claude_spend_month');
      if (spentMine >= REVIEW_CAP_USD || Number(all ?? 0) >= MONTHLY_CAP_USD) return await fail(`spend cap reached (reviews $${spentMine.toFixed(2)}, month $${Number(all ?? 0).toFixed(2)})`, 'skipped');

      const [{ data: plan }, { data: trip }] = await Promise.all([
        db.from('solver_plans').select('visits, note').eq('run_id', rv.run_id).eq('rank', 1).single(),
        db.from('trips').select('title, timezone').eq('id', rv.trip_id).single(),
      ]);
      const visits: any[] = plan?.visits ?? [];
      if (!visits.length) return await fail('plan has no visits', 'skipped');
      const tz = trip?.timezone ?? 'UTC';
      const ids = [...new Set(visits.map(v => v.stop_id).filter(Boolean))];
      const { data: stops } = await db.from('stops').select('id, name, lat, lng, info').in('id', ids);
      const byId = new Map((stops ?? []).map((s: any) => [s.id, s]));
      const lat = (stops ?? []).reduce((t: number, s: any) => t + Number(s.lat ?? 0), 0) / Math.max(1, (stops ?? []).length);
      const area = lat > 55 ? 'the Faroe Islands' : 'Grand Teton National Park and Jackson Hole, Wyoming, USA';
      const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      const lines = visits.map(v => {
        const s: any = byId.get(v.stop_id);
        const info = String(s?.info ?? '').replace(/\n\nCAMERAS TO CHECK[\s\S]*$/, '').slice(0, 900);
        return `- ${hm(v.start)}-${hm(v.end)} ${v.name}${s ? ` (${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)})` : ''}\n  Notes: ${info.replace(/\s+/g, ' ')}`;
      }).join('\n');
      const day = visits[0]?.trip_date ?? rv.plan_date;
      // Official pages to read first (fetching a known page saves the searches; v2, 9 Nov 2026: the first
      // review spent all 8 searches on one trail and never got to roads, warnings or avalanche danger).
      const mLat = lat.toFixed(3), mLng = ((stops ?? []).reduce((t: number, s: any) => t + Number(s.lng ?? 0), 0) / Math.max(1, (stops ?? []).length)).toFixed(3);
      const start = lat > 55
        ? `Start with: Landsverk road information (landsverk.fo), the Faroese weather office warnings (Veðurstova Føroya, vedur.fo), and Atlantic Airways / Strandfaraskip Landsins for any flight, ferry or boat in the plan.`
        : `Start by reading these pages: https://www.nps.gov/grte/planyourvisit/conditions.htm (park alerts, road and trail closures), https://www.nps.gov/grte/planyourvisit/hours.htm (visitor centers), https://api.weather.gov/alerts/active?point=${mLat},${mLng} (National Weather Service warnings, JSON). Search the Bridger-Teton Avalanche Center forecast only if the plan has a ski or snowshoe outing off groomed trail, and WYDOT (wyoroad.info) only for roads outside the park.`;
      const prompt = `Area: ${area}. Trip time zone: ${tz}. Today is ${new Date().toISOString().slice(0, 10)} (UTC).\nThe plan (${plan?.note ?? rv.note}) for ${day}:\n${lines}\n\n${start}\nCover all four kinds of check (closures, warnings, avalanche, hours) briefly before going deeper on any one. Check this plan as described, then call submit_review.`;

      const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
      const tools: any[] = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 12 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
        SUBMIT,
      ];
      const messages: any[] = [{ role: 'user', content: prompt }];
      let cost = 0, result: any = null;
      for (let turn = 0; turn < 8 && !result; turn++) {
        const res: any = await client.messages.create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages, output_config: { effort: 'medium' } } as any);
        const cw = res.usage?.cache_creation_input_tokens ?? 0, cr = res.usage?.cache_read_input_tokens ?? 0;
        const inTok = (res.usage?.input_tokens ?? 0) + Math.round(1.25 * cw + 0.1 * cr), outTok = res.usage?.output_tokens ?? 0;
        const searches = res.usage?.server_tool_use?.web_search_requests ?? 0;
        const c = (inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6 + searches * PRICE_SEARCH;
        cost += c;
        await db.from('claude_usage').insert({ fn: 't-review', purpose: 'plan_review', model: res.model, input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round(c * 1e5) / 1e5 });
        messages.push({ role: 'assistant', content: res.content });
        const sub = res.content.find((b: any) => b.type === 'tool_use' && b.name === 'submit_review');
        if (sub) { result = sub.input; break; }
        if (res.stop_reason === 'pause_turn') continue; // server tools paused: resend as is, the API resumes
        if (res.stop_reason === 'end_turn' || res.stop_reason === 'max_tokens') {
          messages.push({ role: 'user', content: 'Please call submit_review now with what you found.' });
          continue;
        }
        if (res.stop_reason === 'refusal') break;
      }
      if (!result) return await fail(`no review submitted (cost $${cost.toFixed(3)})`);
      await db.from('t_reviews').update({
        status: 'done', verdict: result.verdict, summary: result.summary, flags: result.flags ?? [], checks: result.checks ?? [],
        cost_usd: Math.round(cost * 1e4) / 1e4, done_at: new Date().toISOString(),
      }).eq('id', id);
    } catch (e) {
      await fail(String((e as Error)?.message ?? e));
    }
  })();
  (globalThis as any).EdgeRuntime?.waitUntil?.(work);
  return json({ ok: true, review_id: id });
});
