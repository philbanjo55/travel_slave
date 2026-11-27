import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import { MODEL, PRICE_IN, PRICE_OUT, LOOK_W, SYSTEM, schema, userText, namedNear, imageSize, toLook } from './look.ts';

// PHOTO-SPOT ("Find my spot", Phil 16 Nov 2026). Where was this stop photo taken from, and with what lens?
//   {action: 'request', stop_id, photo_id, again?}  (app)  -> {job}. One open job per photo; a done job is reused
//        unless again. Claude names the landmarks (the look, ~2 cents), then a GitHub Actions run
//        (.github/workflows/photo-spot.yml -> tools/sun3d/photospot/job.py) searches our terrain (~2 min).
//   {action: 'status', job_id} or {action: 'status', photo_id, stop_id}  (app)  -> {job}
//   {action: 'claim', job_id} / {action: 'finish', job_id, result | error, overlay_jpeg_base64}  (worker)
//        Authorization: Bearer <GitHub Actions OIDC token> (audience 'photo-spot', this repo, photo-spot.yml):
//        no shared secret, the repo is public.
//   {action: 'step', job_id, step: {key, done?, of?, attempt?, attempts?}}  (worker, 27 Nov 2026): where the search is,
//        for the app's progress bar; kept in photo_spot_jobs.progress while the job is 'solving' (updated_at untouched,
//        so the stale-job clock is as before). Same token as claim / finish.
//   {action: 'look_test', image_url, lat, lng, name?}  (tests) -> the look only, for a picture in bucket
//        photo-spot/test/ (the hand-solved film scans); nothing stored but the spend.
// Secrets: ANTHROPIC_API_KEY; GITHUB_DISPATCH_TOKEN (fine-grained token, this repo, Actions: write) starts the
// worker; without it a job waits as 'queued' (note says so) and is started on the next status call once it is set.
// Spend: claude_usage fn 'photo-spot'; refused at CLAUDE_PHOTOSPOT_CAP_USD (default 10 a month), at
// CLAUDE_MONTHLY_CAP_USD, or after PHOTOSPOT_DAILY_LOOKS looks a day (default 40).

const REPO = 'philbanjo55/travel_slave';
const WORKFLOW = 'photo-spot.yml';
const WORKFLOW_REF = 'update';   // branch the worker workflow lives on (the main app's branch)
const PROJECT = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const BUCKET = 'photo-spot';
const CAP_USD = Number(Deno.env.get('CLAUDE_PHOTOSPOT_CAP_USD') ?? 10);
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
const DAILY_LOOKS = Number(Deno.env.get('PHOTOSPOT_DAILY_LOOKS') ?? 40);
const STALE_MIN: Record<string, number> = { looking: 5, solving: 25, queued: 45 };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));

// The picture both Claude and the worker read: the stored photo through Supabase's resizer (never wider than LOOK_W).
function lookUrl(url: string) {
  if (!url.startsWith(PROJECT + '/storage/v1/object/public/')) return null;
  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + `?width=${LOOK_W}&quality=88&resize=contain`;
}

function publicJob(j: any) {
  if (!j) return null;
  const { look, ...rest } = j;
  return { ...rest, look: look ? { kind: look.kind, n: (look.landmarks ?? []).length, names: (look.landmarks ?? []).map((l: any) => l.name) } : null,
    overlay_url: j.result?.overlay_path ? `${PROJECT}/storage/v1/object/public/${BUCKET}/${j.result.overlay_path}` : null };
}

async function setJob(id: string, patch: Record<string, unknown>) {
  const { data } = await db.from('photo_spot_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
  return data;
}

async function spendOk(): Promise<string | null> {
  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const day = new Date(Date.now() - 864e5);
  const { data: mine } = await db.from('claude_usage').select('cost_usd, at').eq('fn', 'photo-spot').gte('at', month.toISOString());
  const spent = (mine ?? []).reduce((t: number, r: any) => t + Number(r.cost_usd ?? 0), 0);
  const today = (mine ?? []).filter((r: any) => new Date(r.at) >= day).length;
  const { data: all } = await db.rpc('claude_spend_month');
  if (spent >= CAP_USD || Number(all ?? 0) >= MONTHLY_CAP_USD) return 'the monthly Claude limit is reached';
  if (today >= DAILY_LOOKS) return 'too many photos today, try tomorrow';
  return null;
}

async function stopCtx(stopId: string) {
  const { data: stop } = await db.from('stops').select('id, name, lat, lng, trip_id').eq('id', stopId).maybeSingle();
  if (!stop || stop.lat == null || stop.lng == null) return null;
  const { data: regions } = await db.from('terrain_regions').select('id, north, south, west, east');
  const region = (regions ?? []).find((r: any) => stop.lat < r.north && stop.lat > r.south && stop.lng > r.west && stop.lng < r.east);
  // the trip's subjects (a practice copy uses its main trip's)
  const { data: trip } = await db.from('trips').select('id, training_of').eq('id', stop.trip_id).maybeSingle();
  const { data: subjects } = await db.from('scout_subjects').select('name, lat, lng, subject_kind').in('trip_id', [stop.trip_id, trip?.training_of].filter(Boolean));
  return { stop, region: region?.id ?? null, subjects: subjects ?? [] };
}

// Claude's look at one picture. Returns {look, cost} or throws with words for the app.
async function runLook(imgUrl: string, ctx: { stop: any; region: string; subjects: any[] }) {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Claude is not set up');
  const why = await spendOk();
  if (why) throw new Error(why);
  const res = await fetch(imgUrl);
  if (!res.ok) throw new Error(`could not read the photo (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const size = imageSize(bytes);
  if (!size) throw new Error('the photo is not a JPEG or PNG');
  const named = namedNear(ctx.region, ctx.stop.lat, ctx.stop.lng, ctx.subjects);
  let b64 = ''; for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const client = new Anthropic({ apiKey: key });
  const msg: any = await client.beta.messages.create({
    model: MODEL, max_tokens: 6000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema(named.map(n => n.name)) } },
    system: SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: size.type, data: btoa(b64) } },
      { type: 'text', text: userText(ctx.stop, named, size.w, size.h) },
    ] }],
  } as any);
  const inTok = msg.usage?.input_tokens ?? 0, outTok = msg.usage?.output_tokens ?? 0;
  const cost = Math.round((inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6 * 1e5) / 1e5;
  await db.from('claude_usage').insert({ fn: 'photo-spot', purpose: 'photo_look', model: msg.model ?? MODEL, input_tokens: inTok, output_tokens: outTok, cost_usd: cost });
  if (msg.stop_reason === 'refusal') throw new Error('Claude could not look at this photo');
  const t = msg.content.find((b: any) => b.type === 'text')?.text;
  if (!t) throw new Error(`no answer from Claude (${msg.stop_reason})`);
  const look = toLook(JSON.parse(t), named, size.w, size.h);
  return { look, cost };
}

async function dispatch(jobId: string): Promise<string | null> {
  const tok = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!tok) return 'waiting for the worker to be set up';
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'photo-spot' },
    body: JSON.stringify({ ref: WORKFLOW_REF, inputs: { job_id: jobId } }),
  });
  if (r.status !== 204) return `the worker did not start (${r.status})`;
  await setJob(jobId, { dispatched_at: new Date().toISOString(), note: 'starting the search' });
  return null;
}

// The look, then the worker. Runs after the app already has its job id.
async function lookThenSolve(job: any, ctx: any, hint: Record<string, number> | null = null) {
  try {
    const img = lookUrl(job.photo_url);
    if (!img) throw new Error('the photo is not stored online');
    const { look, cost } = await runLook(img, ctx);
    if (hint) look.hint = hint;
    // a drone photo is searched too since 17 Nov 2026 (the worker also tries the air, up to 122 m)
    const flag = look.kind !== 'ground' && look.kind !== 'drone' ? { close_up: 'a close-up with no sky line', screenshot: 'a screenshot, not a photo', no_sky: 'the sky line is hidden' }[look.kind as string] : null;
    if (flag) { await setJob(job.id, { status: 'done', look, cost_usd: cost, note: null, result: { ok: false, verdict: 'not placed', why: flag } }); return; }
    await setJob(job.id, { status: 'queued', look, cost_usd: cost, note: 'starting the search' });
    const why = await dispatch(job.id);
    if (why) await setJob(job.id, { note: why });
  } catch (e) {
    await setJob(job.id, { status: 'error', error: String((e as Error)?.message ?? e).slice(0, 300), note: null });
  }
}

// A job stuck in one state too long is closed, so a new request can start.
async function freshen(j: any) {
  if (!j || !(j.status in STALE_MIN)) return j;
  const since = j.status === 'queued' ? (j.dispatched_at ?? null) : j.updated_at;
  if (j.status === 'queued' && !j.dispatched_at) {
    // the worker token may have been added since: try once more. Not while the first dispatch may still be on its way
    // (16 Nov 2026: the app's 5 s status poll landed between 'queued' and dispatched_at and started a second worker,
    // whose claim then failed and GitHub emailed 'All jobs have failed').
    if (Date.now() - new Date(j.updated_at).getTime() < 60e3) return j;
    if (Deno.env.get('GITHUB_DISPATCH_TOKEN') && j.look) { const why = await dispatch(j.id); if (!why) return (await db.from('photo_spot_jobs').select('*').eq('id', j.id).maybeSingle()).data; }
    return j;
  }
  if (since && Date.now() - new Date(since).getTime() > STALE_MIN[j.status] * 60e3) {
    return await setJob(j.id, { status: 'error', error: j.status === 'looking' ? 'the look stopped' : 'the search stopped', note: null });
  }
  return j;
}

async function workerAuth(req: Request): Promise<string | null> {
  const tok = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tok) return 'no token';
  try {
    const { payload } = await jwtVerify(tok, JWKS, { issuer: 'https://token.actions.githubusercontent.com', audience: 'photo-spot' });
    const p: any = payload;
    if (p.repository !== REPO) return 'wrong repository';
    if (!String(p.workflow_ref ?? '').startsWith(`${REPO}/.github/workflows/${WORKFLOW}@`)) return 'wrong workflow';
    if (!['workflow_dispatch', 'push'].includes(p.event_name)) return 'wrong event';
    return null;
  } catch (e) { return 'bad token: ' + String((e as Error)?.message ?? e).slice(0, 80); }
}

const TERRAIN_SQL: [string, string, string][] = [
  ['regions', 'terrain_regions', 'id,path,base_m,step_m,n,north,south,west,east'],
  ['range', 'terrain_range_regions', 'id,parent,path,base_m,step_m,n,north,south,west,east'],
  ['near', 'terrain_near_regions', 'id,parent,path,base_m,step_m,n,north,south,west,east'],
  ['houses', 'terrain_house_tiles', 'id,parent,north,south,west,east,path'],
  ['detail', 'terrain_detail_regions_v4', 'id,parent,path,leaf_mask_path,base_m,step_m,n,north,south,west,east'],
  ['trees', 'terrain_tree_tiles', 'id,parent,path,step_m,north,south,west,east'],
];

async function terrainRows(region: string) {
  const out: Record<string, any[]> = {};
  for (const [k, t, cols] of TERRAIN_SQL) {
    let q: any = db.from(t).select(cols);
    if (k === 'regions') q = q.eq('id', region); else q = q.eq('parent', region);
    if (k === 'detail') q = q.not('leaf_mask_path', 'is', null);
    if (k === 'trees') q = q.eq('lod', 0);
    const { data, error } = await q;
    if (error) throw new Error(`${t}: ${error.message}`);
    out[k] = data ?? [];
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'send JSON' }, 400); }
  const action = body.action;
  try {
    if (action === 'request') {
      const { stop_id, photo_id } = body;
      // The user's own pins (17 Nov 2026): "I stood about here" and optionally "aiming at"; a request with pins always
      // starts a new search. Anything that is not a pair of finite coordinates is dropped.
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const h = body.hint && typeof body.hint === 'object' ? body.hint : null;
      const hint = h && num(h.lat) != null && num(h.lng) != null && Math.abs(h.lat) <= 90 && Math.abs(h.lng) <= 180
        ? { lat: h.lat, lng: h.lng, radius_m: 300, ...(num(h.aim_lat) != null && num(h.aim_lng) != null ? { aim_lat: h.aim_lat, aim_lng: h.aim_lng } : {}) }
        : null;
      if (!stop_id || !photo_id) return json({ ok: false, error: 'stop_id and photo_id are needed' }, 400);
      const { data: open } = await db.from('photo_spot_jobs').select('*').eq('photo_id', photo_id).eq('stop_id', stop_id).order('created_at', { ascending: false }).limit(1);
      let last = await freshen(open?.[0]);
      if (last && ['queued', 'looking', 'solving'].includes(last.status)) return json({ ok: true, job: publicJob(last) });
      if (last && last.status === 'done' && !body.again && !hint) return json({ ok: true, job: publicJob(last) });
      const { data: photo } = await db.from('stop_photos').select('id, stop_id, storage_url, url').eq('id', photo_id).maybeSingle();
      if (!photo) return json({ ok: false, error: 'photo not found' }, 404);
      const url = photo.storage_url ?? (String(photo.url ?? '').startsWith('http') ? photo.url : null);
      if (!url || !lookUrl(url)) return json({ ok: false, error: 'the photo is not stored online' }, 422);
      const ctx = await stopCtx(stop_id);
      if (!ctx) return json({ ok: false, error: 'the stop has no position' }, 422);
      if (!ctx.region) return json({ ok: false, error: 'no 3D terrain here yet' }, 422);
      const why = await spendOk();
      if (why) return json({ ok: false, error: why }, 429);
      const { data: job, error } = await db.from('photo_spot_jobs').insert({ stop_id, photo_id, photo_url: url, status: 'looking', note: 'looking at the photo' }).select('*').single();
      if (error) {   // another request just opened one
        const { data: again } = await db.from('photo_spot_jobs').select('*').eq('photo_id', photo_id).eq('stop_id', stop_id).order('created_at', { ascending: false }).limit(1);
        return json({ ok: true, job: publicJob(again?.[0]) });
      }
      // @ts-ignore EdgeRuntime is the Supabase edge runtime
      EdgeRuntime.waitUntil(lookThenSolve(job, ctx, hint));
      return json({ ok: true, job: publicJob(job) });
    }

    if (action === 'status') {
      let j: any = null;
      if (body.job_id) j = (await db.from('photo_spot_jobs').select('*').eq('id', body.job_id).maybeSingle()).data;
      else if (body.photo_id) {
        let q = db.from('photo_spot_jobs').select('*').eq('photo_id', body.photo_id);
        if (body.stop_id) q = q.eq('stop_id', body.stop_id);
        j = (await q.order('created_at', { ascending: false }).limit(1)).data?.[0] ?? null;
      }
      return json({ ok: true, job: publicJob(await freshen(j)) });
    }

    if (action === 'look_test') {
      const u = String(body.image_url ?? '');
      if (!u.startsWith(`${PROJECT}/storage/v1/object/public/${BUCKET}/test/`)) return json({ ok: false, error: 'test pictures only' }, 403);
      const ctx = { stop: { name: body.name ?? 'test', lat: Number(body.lat), lng: Number(body.lng) }, region: body.region ?? 'grand_teton', subjects: [] as any[] };
      if (body.trip_id) ctx.subjects = (await db.from('scout_subjects').select('name, lat, lng, subject_kind').eq('trip_id', body.trip_id)).data ?? [];
      const out = await runLook(lookUrl(u)!, ctx);
      return json({ ok: true, ...out });
    }

    if (action === 'claim' || action === 'finish' || action === 'step') {
      const bad = await workerAuth(req);
      if (bad) return json({ ok: false, error: bad }, 401);
      const { data: j } = await db.from('photo_spot_jobs').select('*').eq('id', body.job_id).maybeSingle();
      if (!j) return json({ ok: false, error: 'no such job' }, 404);
      if (action === 'step') {
        if (j.status !== 'solving') return json({ ok: false, error: `job is ${j.status}` }, 409);
        const st = body.step && typeof body.step === 'object' ? body.step : {};
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
        const progress = { key: String(st.key ?? '').slice(0, 20), done: num(st.done), of: num(st.of),
          attempt: typeof st.attempt === 'string' ? st.attempt.slice(0, 10) : num(st.attempt), attempts: num(st.attempts), at: new Date().toISOString() };
        await db.from('photo_spot_jobs').update({ progress }).eq('id', j.id).eq('status', 'solving');
        return json({ ok: true });
      }
      if (action === 'claim') {
        if (!['queued', 'solving'].includes(j.status) || !j.look) return json({ ok: false, error: `job is ${j.status}` }, 409);
        const ctx = await stopCtx(j.stop_id);
        if (!ctx?.region) return json({ ok: false, error: 'no region' }, 422);
        await setJob(j.id, { status: 'solving', note: 'searching the terrain', run_id: body.run_id ?? null });
        await db.from('photo_spot_jobs').update({ progress: null }).eq('id', j.id);   // a retried run starts its bar afresh (an error, e.g. no column yet, changes nothing)
        // the stop's own stand pins (17 Nov 2026): the solver's tie-break between spots that fit about as well. Pins Find
        // spot placed itself are left out (they would vote for its own earlier answers).
        const { data: sp } = await db.from('stop_sun_pairs').select('scout_vantages(lat, lng, notes)').eq('stop_id', j.stop_id);
        const stand_pins = (sp ?? []).map((r: any) => r.scout_vantages).filter((v: any) => v && v.lat != null && v.lng != null &&
          !String(v.notes ?? '').startsWith('Placed by Find spot')).map((v: any) => ({ lat: v.lat, lng: v.lng }));
        return json({ ok: true, job: { id: j.id, stop: ctx.stop, region: ctx.region, look: j.look, photo_url: lookUrl(j.photo_url) ?? j.photo_url, stand_pins },
          rows: await terrainRows(ctx.region) });
      }
      if (j.status !== 'solving') return json({ ok: false, error: `job is ${j.status}` }, 409);
      const result = body.result ?? null;
      if (body.overlay_jpeg_base64 && result) {
        const bin = Uint8Array.from(atob(body.overlay_jpeg_base64), c => c.charCodeAt(0));
        const path = `${j.id}.jpg`;
        const up = await db.storage.from(BUCKET).upload(path, bin, { contentType: 'image/jpeg', upsert: true });
        if (!up.error) result.overlay_path = path;
      }
      const patch = body.error ? { status: 'error', error: String(body.error).slice(0, 300), note: null }
        : { status: 'done', result, error: null, note: null };
      return json({ ok: true, job: publicJob(await setJob(j.id, patch)) });
    }
    return json({ ok: false, error: 'unknown action' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
