import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import Anthropic from 'npm:@anthropic-ai/sdk';
import jpeg from 'npm:jpeg-js@0.4.4';

// WEBCAM FOG ARCHIVE
// Every hour each active row of webcam_cameras (any trip: image_url, region,
// source and permission per camera; first set is Landsverk in the Faroes,
// approved by Landsverk) is stored and given cheap haze metrics (fog flattens
// contrast and edges). Night frames (sun below -6 deg) are skipped.
// Labels come from Claude (ANTHROPIC_API_KEY secret; CLAUDE_LABELS=false turns
// it off, CLAUDE_LABEL_MODEL overrides the model, CLAUDE_DAILY_CAP caps calls
// per UTC day, CLAUDE_MONTHLY_CAP_USD caps spend per UTC month, logged in
// claude_usage). Phil's own taps go to phil_label, never over Claude's label,
// so the two can be compared. These are the place-specific fog truth the
// solver's forecasts get scored against; METAR covers only airports.
//
// Storage (free plan, 1 GB): full frames kept 7 days, plus one frame per
// camera per day (the 12 UTC capture) kept permanently.
//
// POST {} archives this hour; {force: true} re-captures it; {backfill: n}
// labels up to n stored daylight frames that have no label yet.

const BUCKET = 'webcams';
const KEEP_DAYS = 7;
const KEEP_HOUR_UTC = 12;
const NIGHT_ALT = -6;
const MODEL = Deno.env.get('CLAUDE_LABEL_MODEL') ?? 'claude-opus-5-5';
const DAILY_CAP = Number(Deno.env.get('CLAUDE_DAILY_CAP') ?? 400);
const MONTHLY_CAP_USD = Number(Deno.env.get('CLAUDE_MONTHLY_CAP_USD') ?? 40);
// USD per million tokens [input, output]; unknown models are priced as Opus.
const PRICES: Record<string, [number, number]> = {
  'claude-opus': [4, 20], 'claude-sonnet': [2, 10], 'claude-haiku': [0.1, 0.5],
};
const costUsd = (model: string, inTok: number, outTok: number) => {
  const p = Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1] ?? PRICES['claude-opus'];
  return (inTok * p[0] + outTok * p[1]) / 1e6;
};

const LABELS = ['clear', 'haze', 'low_cloud', 'fog', 'dark', 'camera_problem'];
const CLOUD = ['none', 'above_hills', 'touching_tops', 'covering_hills', 'unknown'];

const PROMPT = (region: string, name: string, island: string, hint: string) => `You are labelling a ${region} webcam frame for a landscape photographer's weather archive. The labels are scored against forecasts, so judge only what the image shows.
Camera: ${name} (${island}). ${hint}
These are road cameras: road, verges, barriers or rock filling much of the frame is normal. Judge the weather from whatever part shows sky, hills or distance, even a thin strip.
label:
- clear: hills and distance clearly visible, no fog or cloud on the hills
- haze: visibility reduced by haze or mist but hills still discernible
- low_cloud: cloud sitting on or hiding the hilltops, lower ground visible
- fog: fog at camera level, distant terrain hidden
- dark: too dark to judge
- camera_problem: frozen, blank, or lens so covered by water or snow that no sky, hills or distance can be judged
hills_visible: the hills in view can be seen to their tops.
cloud_on_hills: where the lowest cloud sits relative to the hills.
sun_on_land: direct sunlight is falling on the land or sea in view (shadows, sunlit patches), not just a bright overcast sky.
confidence: 0 to 1. note: one short sentence on what decided it.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'hills_visible', 'cloud_on_hills', 'sea_visible', 'rain_or_wet_lens', 'sun_on_land', 'confidence', 'note'],
  properties: {
    label: { type: 'string', enum: LABELS },
    hills_visible: { type: 'boolean' },
    cloud_on_hills: { type: 'string', enum: CLOUD },
    sea_visible: { type: 'boolean' },
    rain_or_wet_lens: { type: 'boolean' },
    sun_on_land: { type: 'boolean' },
    confidence: { type: 'number' },
    note: { type: 'string' },
  },
};

// Solar altitude in degrees (low-precision almanac formula, ~0.5 deg).
function sunAltitude(lat: number, lng: number, d: Date) {
  const rad = Math.PI / 180;
  const n = d.getTime() / 86400000 - 10957.5; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const ha = ((280.46061837 + 360.98564736629 * n + lng) % 360) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

// Luminance statistics on a 4-pixel grid. RMS contrast and mean horizontal
// gradient drop sharply in fog; the top third is where hills and sky meet.
function hazeMetrics(buf: Uint8Array) {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  const { width: w, height: h, data } = img;
  const stats = (y0: number, y1: number) => {
    let n = 0, sum = 0, sum2 = 0, edge = 0;
    for (let y = y0; y < y1; y += 4) {
      let prev = -1;
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4;
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        n++; sum += l; sum2 += l * l;
        if (prev >= 0) edge += Math.abs(l - prev);
        prev = l;
      }
    }
    const mean = sum / n;
    return { mean, contrast: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), edge: edge / n };
  };
  const full = stats(0, h), top = stats(0, Math.floor(h / 3));
  const r = (x: number) => Math.round(x * 100) / 100;
  return { width: w, height: h, luma_mean: r(full.mean), contrast_full: r(full.contrast),
           contrast_top: r(top.contrast), edge_full: r(full.edge), edge_top: r(top.edge) };
}

async function label(client: Anthropic, cam: any, buf: Uint8Array) {
  const msg: any = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: encodeBase64(buf) } },
        { type: 'text', text: PROMPT(cam.region ?? 'road', cam.name, cam.island ?? '', cam.hint ?? '') },
      ],
    }],
  } as any);
  if (msg.stop_reason === 'refusal') throw new Error(`refused: ${msg.stop_details?.category ?? ''}`);
  const text = msg.content.find((b: any) => b.type === 'text')?.text;
  if (!text) throw new Error(`no text (${msg.stop_reason})`);
  return { lab: JSON.parse(text), model: msg.model as string, usage: msg.usage };
}

const labelColumns = (lab: any, model: string | null, err: string | null) => ({
  label: LABELS.includes(lab?.label) ? lab.label : null,
  hills_visible: typeof lab?.hills_visible === 'boolean' ? lab.hills_visible : null,
  cloud_on_hills: CLOUD.includes(lab?.cloud_on_hills) ? lab.cloud_on_hills : null,
  sea_visible: typeof lab?.sea_visible === 'boolean' ? lab.sea_visible : null,
  rain_or_wet_lens: typeof lab?.rain_or_wet_lens === 'boolean' ? lab.rain_or_wet_lens : null,
  sun_on_land: typeof lab?.sun_on_land === 'boolean' ? lab.sun_on_land : null,
  label_confidence: typeof lab?.confidence === 'number' ? lab.confidence : null,
  label_note: typeof lab?.note === 'string' ? lab.note.slice(0, 500) : null,
  label_model: lab ? model : null,
  label_error: err,
});

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const apiKey = Deno.env.get('CLAUDE_LABELS') === 'false' ? undefined : Deno.env.get('ANTHROPIC_API_KEY');
    const claude = apiKey ? new Anthropic({ apiKey }) : null;

    // Calls left today under the cap.
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count: usedToday } = await supabase.from('webcam_frames').select('id', { count: 'exact', head: true })
      .like('label_model', 'claude%').gte('captured_at', dayStart.toISOString());
    let budget = Math.max(0, DAILY_CAP - (usedToday ?? 0));
    const { data: spentMonth } = await supabase.rpc('claude_spend_month');
    let spent = Number(spentMonth ?? 0);
    const tokens = { input: 0, output: 0 };
    const tryLabel = async (cam: any, buf: Uint8Array) => {
      if (!claude || budget <= 0) return { lab: null, model: null, err: claude ? 'daily cap reached' : null };
      if (spent >= MONTHLY_CAP_USD) return { lab: null, model: null, err: 'monthly spend cap reached' };
      budget--;
      try {
        const r = await label(claude, cam, buf);
        const inTok = r.usage?.input_tokens ?? 0, outTok = r.usage?.output_tokens ?? 0;
        tokens.input += inTok; tokens.output += outTok;
        const cost = costUsd(r.model ?? MODEL, inTok, outTok);
        spent += cost;
        await supabase.from('claude_usage').insert({ fn: 'webcam-archive', purpose: 'webcam_label', model: r.model,
          input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round(cost * 1e5) / 1e5 });
        return { lab: r.lab, model: r.model, err: null };
      } catch (e) { return { lab: null, model: null, err: String(e).slice(0, 300) }; }
    };

    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some(b => b.name === BUCKET)) await supabase.storage.createBucket(BUCKET, { public: false });

    // Captures are stamped to the hour so re-runs in the same hour are no-ops.
    const now = new Date();
    const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    const { data: cams, error: cErr } = await supabase.from('webcam_cameras').select('*').eq('active', true);
    if (cErr) throw cErr;

    const results: any[] = [];
    for (const cam of body.backfill ? [] : cams ?? []) {
      const res: any = { camera: cam.code };
      try {
        const alt = cam.lat != null ? sunAltitude(cam.lat, cam.lng, slot) : null;
        if (alt != null && alt < NIGHT_ALT && body.force !== true) { res.skipped = 'night'; results.push(res); continue; }
        const { data: existing } = await supabase.from('webcam_frames').select('id')
          .eq('camera_code', cam.code).eq('captured_at', slot.toISOString()).maybeSingle();
        if (existing && body.force !== true) { res.skipped = 'already captured this hour'; results.push(res); continue; }

        const sep = cam.image_url.includes('?') ? '&' : '?';
        const r = await fetch(`${cam.image_url}${sep}t=${Date.now()}`,
          { headers: { 'User-Agent': 'travel_slave webcam archive (permission: see webcam_cameras.permission_note)' } });
        if (!r.ok) throw new Error(`image ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());

        const path = `${cam.code}/${slot.toISOString().slice(0, 13)}.jpg`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw upErr;

        let metrics: any = {};
        try { metrics = hazeMetrics(buf); } catch (e) { res.metrics_error = String(e).slice(0, 200); }
        const l = await tryLabel(cam, buf);

        const row = {
          camera_code: cam.code, captured_at: slot.toISOString(), storage_path: path, bytes: buf.length,
          keep: slot.getUTCHours() === KEEP_HOUR_UTC, sun_altitude: alt, ...metrics,
          ...labelColumns(l.lab, l.model, l.err),
        };
        const { error: insErr } = await supabase.from('webcam_frames')
          .upsert(row, { onConflict: 'camera_code,captured_at' });
        if (insErr) throw insErr;
        Object.assign(res, { bytes: buf.length, label: row.label, cloud_on_hills: row.cloud_on_hills,
                             sun_on_land: row.sun_on_land, label_error: l.err });
      } catch (e: any) { res.error = String(e?.message ?? e).slice(0, 300); }
      results.push(res);
    }

    // Label stored daylight frames that have none yet (key added late, cap,
    // errors), newest first, while their image is still in storage.
    let backfilled = 0;
    if (claude) {
      const { data: pending, error: pErr } = await supabase.from('webcam_frames')
        .select('id,camera_code,storage_path,captured_at').is('label', null).not('storage_path', 'is', null)
        .gte('sun_altitude', NIGHT_ALT).neq('captured_at', slot.toISOString())
        .order('captured_at', { ascending: false }).limit(Math.min(Number(body.backfill ?? 4), 40));
      if (pErr) results.push({ backfill_error: pErr.message });
      results.push({ backfill_candidates: pending?.length ?? null });
      for (const f of pending ?? []) {
        const cam = (cams ?? []).find((c: any) => c.code === f.camera_code);
        const { data: blob, error: dErr } = await supabase.storage.from(BUCKET).download(f.storage_path);
        if (!cam || !blob) { results.push({ camera: f.camera_code, skipped: dErr?.message ?? 'camera not active' }); continue; }
        const l = await tryLabel(cam, new Uint8Array(await blob.arrayBuffer()));
        await supabase.from('webcam_frames').update(labelColumns(l.lab, l.model, l.err)).eq('id', f.id);
        if (l.err) break; // the same failure would repeat for the rest
        backfilled++;
        results.push({ camera: f.camera_code, captured_at: f.captured_at, ...l.lab });
      }
    }

    // Prune full images past KEEP_DAYS unless kept; labels and metrics stay.
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    const { data: old } = await supabase.from('webcam_frames').select('id,storage_path')
      .eq('keep', false).lt('captured_at', cutoff).not('storage_path', 'is', null).limit(500);
    let pruned = 0;
    if (old?.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(old.map(o => o.storage_path));
      if (!rmErr) {
        await supabase.from('webcam_frames').update({ storage_path: null }).in('id', old.map(o => o.id));
        pruned = old.length;
      }
    }

    return json({ ok: true, slot: slot.toISOString(), model: claude ? MODEL : null, tokens,
                  spent_month_usd: Math.round(spent * 100) / 100, backfilled, pruned, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
