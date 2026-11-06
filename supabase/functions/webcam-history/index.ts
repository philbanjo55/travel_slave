import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import Anthropic from 'npm:@anthropic-ai/sdk';

// WEBCAM HISTORY LABELS
// Labels archived frames of past days from a camera whose image_url is a time
// template (TetonCam: .../{YYYY}/{MM}/{DD}/{HHmm}.jpg, kept since 2014), for
// the planner test bench: does its truth (satellite sun + airport ceiling)
// agree with what the camera saw? Rows are queued in webcam_history_labels
// (migration 20261025090000); pg_cron webcam-history calls this every minute
// while any are queued. Same prompt, schema and model as webcam-archive; only
// labels are stored, never images. Spend is logged to claude_usage (fn
// webcam-history) and stops at CLAUDE_HISTORY_CAP_USD (default 15) for this job
// or at the shared CLAUDE_MONTHLY_CAP_USD.
//
// POST {n: 8} labels up to n queued frames (max 12) in parallel.
// POST {save: 8} (v3, Phil 6 Nov 2026: "save them"): copies up to save (max 12) already-read frames
// into Storage bucket webcams at history/<code>/<YYYY-MM-DD>/<HH-mm>.jpg (camera-local time) and
// records image_path / image_bytes / image_url on the row. No Claude call, no spend.
// POST {compare: 8, model: 'claude-haiku-5-5'} (v4, worksheet F1): labels up to compare (max 12) saved
// frames again with another model into webcam_label_compare, to compare with the Opus labels. Its own
// cap CLAUDE_COMPARE_CAP_USD (default 3), logged as purpose label_compare.

const MODEL = Deno.env.get('CLAUDE_LABEL_MODEL') ?? 'claude-opus-5-5';
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
const HISTORY_CAP_USD = Number(Deno.env.get('CLAUDE_HISTORY_CAP_USD') ?? 15);
const FETCH_TIMEOUT_MS = 20_000;
const PRICES: Record<string, [number, number]> = {
  'claude-opus': [4, 20], 'claude-sonnet': [2, 10], 'claude-haiku': [0.1, 0.5],
};
const costUsd = (model: string, inTok: number, outTok: number) => {
  const p = Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1] ?? PRICES['claude-opus'];
  return (inTok * p[0] + outTok * p[1]) / 1e6;
};

const LABELS = ['clear', 'haze', 'low_cloud', 'fog', 'dark', 'camera_problem'];
const CLOUD = ['none', 'above_hills', 'touching_tops', 'covering_hills', 'unknown'];

// Copied from webcam-archive so the labels are comparable.
const PROMPT = (region: string, name: string, place: string, hint: string) => `You are labelling a ${region ? region + ' ' : ''}webcam frame for a landscape photographer's weather archive. The labels are scored against forecasts, so judge only what the image shows.\nCamera: ${name}${place ? ` (${place})` : ''}. ${hint}\nForeground (road, verges, buildings, trees, snow, rock) filling much of the frame is normal. Judge the weather from whatever part shows sky, mountains, hills or distance, even a thin strip.\nlabel:\n- clear: hills or mountains and distance clearly visible, no fog or cloud on them\n- haze: visibility reduced by haze or mist but hills still discernible\n- low_cloud: cloud sitting on or hiding the hilltops, lower ground visible\n- fog: fog at camera level, distant terrain hidden\n- dark: too dark to judge\n- camera_problem: frozen, blank, or lens so covered by water or snow that no sky, hills or distance can be judged\nhills_visible: the hills in view can be seen to their tops.\ncloud_on_hills: where the lowest cloud sits relative to the hills.\nsun_on_land: direct sunlight is falling on the land or sea in view (shadows, sunlit patches), not just a bright overcast sky.\ncamera_time: the date and time printed on the image (caption bar or overlay), written YYYY-MM-DD HH:MM exactly as shown (do not convert time zones); an empty string if none is printed.\nconfidence: 0 to 1. note: one short sentence on what decided it.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'hills_visible', 'cloud_on_hills', 'sea_visible', 'rain_or_wet_lens', 'sun_on_land', 'camera_time', 'confidence', 'note'],
  properties: {
    label: { type: 'string', enum: LABELS },
    hills_visible: { type: 'boolean' },
    cloud_on_hills: { type: 'string', enum: CLOUD },
    sea_visible: { type: 'boolean' },
    rain_or_wet_lens: { type: 'boolean' },
    sun_on_land: { type: 'boolean' },
    camera_time: { type: 'string' },
    confidence: { type: 'number' },
    note: { type: 'string' },
  },
};

async function label(client: Anthropic, cam: any, buf: Uint8Array, model = MODEL) {
  // Haiku has no server-side fallback (a fallbacks list is a 400), so only Opus/Sonnet send it.
  const fb = model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  const msg: any = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    ...fb,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: encodeBase64(buf) } },
        { type: 'text', text: PROMPT(cam.region ?? '', cam.name, cam.island ?? '', cam.hint ?? '') },
      ],
    }],
  } as any);
  if (msg.stop_reason === 'refusal') throw new Error(`refused: ${msg.stop_details?.category ?? ''}`);
  const text = msg.content.find((b: any) => b.type === 'text')?.text;
  if (!text) throw new Error(`no text (${msg.stop_reason})`);
  return { lab: JSON.parse(text), model: msg.model as string, usage: msg.usage };
}

// local_time is 'YYYY-MM-DD HH:MM' in the camera's tz. Every token, every time it appears; {HH} and {mm}
// too (Roundshot: .../{YYYY}-{MM}-{DD}/{HH}-{mm}-00/{YYYY}-{MM}-{DD}-{HH}-{mm}-00_quarter.jpg, v2 6 Nov 2026).
const frameUrl = (template: string, local: string) => template
  .replaceAll('{YYYY}', local.slice(0, 4)).replaceAll('{MM}', local.slice(5, 7)).replaceAll('{DD}', local.slice(8, 10))
  .replaceAll('{HHmm}', local.slice(11, 13) + local.slice(14, 16))
  .replaceAll('{HH}', local.slice(11, 13)).replaceAll('{mm}', local.slice(14, 16));
// A camera that takes a picture every 10 min may have none at the exact time: try the next two.
const later = (local: string, min: number) => {
  const d = new Date(local.replace(' ', 'T') + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + min);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

// Fetch a past frame: the exact time, then (10-min cameras) the next two pictures.
async function fetchFrame(tpl: string, local: string) {
  let r: Response | null = null, url = '';
  for (const off of tpl.includes('{mm}') ? [0, 10, 20] : [0]) {
    url = frameUrl(tpl, later(local, off));
    r = await fetch(url, {
      headers: { 'User-Agent': 'travel_slave webcam history (permission: see webcam_cameras.permission_note)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (r.ok || r.status !== 404) break;
    await r.body?.cancel();
  }
  if (!r!.ok) { await r!.body?.cancel(); throw new Error(`image ${r!.status}`); }
  return { buf: new Uint8Array(await r!.arrayBuffer()), url };
}

async function saveFrames(supabase: any, n: number) {
  const { data: rows, error } = await supabase.from('webcam_history_labels')
    .select('camera_code,taken_at,local_time').in('status', ['done', 'error']).is('image_path', null).is('save_error', null)
    .order('taken_at').limit(n);
  if (error) throw error;
  if (!rows?.length) return { ok: true, saved: 0 };
  const { data: cams } = await supabase.from('webcam_cameras').select('code,history_url,image_url')
    .in('code', [...new Set(rows.map((f: any) => f.camera_code))]);
  const results = await Promise.all(rows.map(async (f: any) => {
    const cam = (cams ?? []).find((c: any) => c.code === f.camera_code);
    let upd: any;
    try {
      const { buf, url } = await fetchFrame(cam.history_url ?? cam.image_url, f.local_time);
      const path = `history/${f.camera_code}/${f.local_time.slice(0, 10)}/${f.local_time.slice(11, 13)}-${f.local_time.slice(14, 16)}.jpg`;
      const { error: upErr } = await supabase.storage.from('webcams')
        .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;
      upd = { image_path: path, image_bytes: buf.length, image_url: url, save_error: null };
    } catch (e: any) {
      upd = { save_error: String(e?.message ?? e).slice(0, 300) };
    }
    await supabase.from('webcam_history_labels').update(upd).eq('camera_code', f.camera_code).eq('taken_at', f.taken_at);
    return { camera: f.camera_code, local_time: f.local_time, bytes: upd.image_bytes ?? null, error: upd.save_error ?? null };
  }));
  return { ok: true, saved: results.filter(r => !r.error).length, results };
}

const COMPARE_CAP_USD = Number(Deno.env.get('CLAUDE_COMPARE_CAP_USD') ?? 3);
async function compareFrames(supabase: any, claude: Anthropic, model: string, n: number) {
  const { data: spent } = await supabase.from('claude_usage').select('cost_usd').eq('purpose', 'label_compare');
  const used = (spent ?? []).reduce((a: number, r: any) => a + Number(r.cost_usd ?? 0), 0);
  if (used >= COMPARE_CAP_USD) return { ok: false, error: 'compare cap reached', spent: used };
  const { data: rows, error } = await supabase.rpc('webcam_compare_next', { p_model: model, p_n: n });
  if (error) throw error;
  if (!rows?.length) return { ok: true, done: 0 };
  const { data: cams } = await supabase.from('webcam_cameras').select('*').in('code', [...new Set(rows.map((f: any) => f.camera_code))]);
  const results = await Promise.all(rows.map(async (f: any) => {
    const cam = (cams ?? []).find((c: any) => c.code === f.camera_code);
    let row: any = { camera_code: f.camera_code, taken_at: f.taken_at, model, updated_at: new Date().toISOString() };
    try {
      const { data: blob, error: dErr } = await supabase.storage.from('webcams').download(f.image_path);
      if (dErr) throw dErr;
      const l = await label(claude, cam, new Uint8Array(await blob.arrayBuffer()), model);
      const inTok = l.usage?.input_tokens ?? 0, outTok = l.usage?.output_tokens ?? 0;
      const cost = costUsd(l.model ?? model, inTok, outTok);
      await supabase.from('claude_usage').insert({ fn: 'webcam-history', purpose: 'label_compare', model: l.model,
        input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round(cost * 1e5) / 1e5 });
      const lab = l.lab;
      row = { ...row, status: 'done', served_model: l.model, cost_usd: cost,
        label: LABELS.includes(lab?.label) ? lab.label : null,
        hills_visible: typeof lab?.hills_visible === 'boolean' ? lab.hills_visible : null,
        cloud_on_hills: CLOUD.includes(lab?.cloud_on_hills) ? lab.cloud_on_hills : null,
        sun_on_land: typeof lab?.sun_on_land === 'boolean' ? lab.sun_on_land : null,
        confidence: typeof lab?.confidence === 'number' ? lab.confidence : null,
        note: typeof lab?.note === 'string' ? lab.note.slice(0, 500) : null };
    } catch (e: any) {
      row = { ...row, status: 'error', error: String(e?.message ?? e).slice(0, 300) };
    }
    await supabase.from('webcam_label_compare').upsert(row);
    return { camera: f.camera_code, local_time: f.local_time, status: row.status, hills: row.hills_visible ?? null, error: row.error ?? null };
  }));
  return { ok: true, done: results.filter(r => r.status === 'done').length, results };
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const n = Math.min(Math.max(Number(body.n ?? 8), 1), 12);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (body.save) return json(await saveFrames(supabase, Math.min(Math.max(Number(body.save), 1), 12)));
    if (body.compare) {
      const key = Deno.env.get('ANTHROPIC_API_KEY');
      if (!key) return json({ ok: false, error: 'no API key' });
      return json(await compareFrames(supabase, new Anthropic({ apiKey: key }), String(body.model ?? 'claude-haiku-5-5'),
        Math.min(Math.max(Number(body.compare), 1), 12)));
    }
    const apiKey = Deno.env.get('CLAUDE_LABELS') === 'false' ? undefined : Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ ok: false, error: 'Claude labels off' });
    const claude = new Anthropic({ apiKey });

    const { data: spentMonth } = await supabase.rpc('claude_spend_month');
    if (Number(spentMonth ?? 0) >= MONTHLY_CAP_USD) return json({ ok: false, error: 'monthly spend cap reached' });
    const { data: hist } = await supabase.from('claude_usage').select('cost_usd').eq('fn', 'webcam-history');
    const spentHistory = (hist ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
    if (spentHistory >= HISTORY_CAP_USD) return json({ ok: false, error: 'history cap reached', spent: spentHistory });

    const { data: queued, error: qErr } = await supabase.from('webcam_history_labels')
      .select('camera_code,taken_at,local_time').eq('status', 'queued').order('taken_at').limit(n);
    if (qErr) throw qErr;
    if (!queued?.length) return json({ ok: true, done: 0 });
    for (const f of queued) {
      await supabase.from('webcam_history_labels').update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('camera_code', f.camera_code).eq('taken_at', f.taken_at);
    }
    const codes = [...new Set(queued.map(f => f.camera_code))];
    const { data: cams } = await supabase.from('webcam_cameras').select('*').in('code', codes);

    const results = await Promise.all(queued.map(async (f: any) => {
      const cam = (cams ?? []).find((c: any) => c.code === f.camera_code);
      const key = { camera_code: f.camera_code, taken_at: f.taken_at };
      let row: any;
      try {
        // webcam_cameras.history_url: the archive's address template when it differs from the live one.
        const { buf } = await fetchFrame(cam.history_url ?? cam.image_url, f.local_time);
        const l = await label(claude, cam, buf);
        const inTok = l.usage?.input_tokens ?? 0, outTok = l.usage?.output_tokens ?? 0;
        const cost = costUsd(l.model ?? MODEL, inTok, outTok);
        await supabase.from('claude_usage').insert({ fn: 'webcam-history', purpose: 'webcam_history_label', model: l.model,
          input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round(cost * 1e5) / 1e5 });
        const lab = l.lab;
        row = {
          status: 'done', error: null, model: l.model,
          label: LABELS.includes(lab?.label) ? lab.label : null,
          hills_visible: typeof lab?.hills_visible === 'boolean' ? lab.hills_visible : null,
          cloud_on_hills: CLOUD.includes(lab?.cloud_on_hills) ? lab.cloud_on_hills : null,
          sun_on_land: typeof lab?.sun_on_land === 'boolean' ? lab.sun_on_land : null,
          rain_or_wet_lens: typeof lab?.rain_or_wet_lens === 'boolean' ? lab.rain_or_wet_lens : null,
          confidence: typeof lab?.confidence === 'number' ? lab.confidence : null,
          note: typeof lab?.note === 'string' ? lab.note.slice(0, 500) : null,
          camera_time_text: typeof lab?.camera_time === 'string' && lab.camera_time.trim() ? lab.camera_time.trim().slice(0, 40) : null,
        };
      } catch (e: any) {
        row = { status: 'error', error: String(e?.message ?? e).slice(0, 300) };
      }
      row.updated_at = new Date().toISOString();
      await supabase.from('webcam_history_labels').update(row).eq('camera_code', key.camera_code).eq('taken_at', key.taken_at);
      return { local_time: f.local_time, status: row.status, label: row.label, error: row.error };
    }));
    return json({ ok: true, done: results.filter(r => r.status === 'done').length, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
