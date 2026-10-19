import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import jpeg from 'npm:jpeg-js@0.4.4';

// WEBCAM FOG ARCHIVE
// Landsverk road/harbour webcams (lv.fo/tmp/<code>.jpg, refreshed every
// ~30 min; archiving approved by Landsverk). Every 3 h each active camera's
// frame is stored, given cheap haze metrics (fog flattens contrast and edges)
// and labelled by Gemini's free tier. These are the place-specific fog truth
// the solver's forecasts get scored against; EKVG METAR covers only the airport.
//
// Storage (free plan, 1 GB): full frames kept 7 days, plus one frame per
// camera per day (the 12 UTC capture) kept permanently.

const BUCKET = 'webcams';
const KEEP_DAYS = 7;
const KEEP_HOUR_UTC = 12;
// Google retires models for new keys quickly (2.5-flash was refused in Oct
// 2026), so the GEMINI_MODEL secret overrides this without a redeploy.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';

const LABELS = ['clear', 'haze', 'low_cloud', 'fog', 'dark', 'camera_problem'];
const CLOUD = ['none', 'above_hills', 'touching_tops', 'covering_hills', 'unknown'];

const PROMPT = (name: string, island: string, hint: string) => `You are labelling a Faroe Islands road webcam frame for a landscape photographer's fog archive.
Camera: ${name} (${island}). ${hint}
Judge only what the image shows. Labels:
- clear: hills and distance clearly visible, no fog or cloud on the hills
- haze: visibility reduced by haze or mist but hills still discernible
- low_cloud: cloud sitting on or hiding the hilltops, lower ground visible
- fog: fog at camera level, distant terrain hidden
- dark: too dark to judge (night)
- camera_problem: frozen, blank, blurred by water/snow on the lens, or obstructed
Answer with the JSON schema only.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    label: { type: 'STRING', enum: LABELS },
    hills_visible: { type: 'BOOLEAN' },
    cloud_on_hills: { type: 'STRING', enum: CLOUD },
    sea_visible: { type: 'BOOLEAN' },
    rain_or_wet_lens: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    note: { type: 'STRING' },
  },
  required: ['label', 'hills_visible', 'cloud_on_hills', 'confidence'],
};

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

async function label(key: string, cam: any, buf: Uint8Array) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: PROMPT(cam.name, cam.island ?? '', cam.hint ?? '') },
          { inline_data: { mime_type: 'image/jpeg', data: encodeBase64(buf) } },
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      }),
    });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`gemini ${r.status}: ${j?.error?.message ?? ''}`.slice(0, 300));
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini: empty response');
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const geminiKey = Deno.env.get('GEMINI_API_KEY');

    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some(b => b.name === BUCKET)) await supabase.storage.createBucket(BUCKET, { public: false });

    // Captures are stamped to the 3-hour slot so re-runs in the same slot are no-ops.
    const now = new Date();
    const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                                   Math.floor(now.getUTCHours() / 3) * 3));
    const { data: cams, error: cErr } = await supabase.from('webcam_cameras').select('*').eq('active', true);
    if (cErr) throw cErr;

    const results: any[] = [];
    for (const cam of cams ?? []) {
      const res: any = { camera: cam.code };
      try {
        const { data: existing } = await supabase.from('webcam_frames').select('id')
          .eq('camera_code', cam.code).eq('captured_at', slot.toISOString()).maybeSingle();
        if (existing && body.force !== true) { res.skipped = 'already captured this slot'; results.push(res); continue; }

        const r = await fetch(`https://www.lv.fo/tmp/${cam.code}.jpg?t=${Date.now()}`,
          { headers: { 'User-Agent': 'travel_slave webcam archive (approved by Landsverk)' } });
        if (!r.ok) throw new Error(`image ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());

        const path = `${cam.code}/${slot.toISOString().slice(0, 13)}.jpg`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw upErr;

        let metrics: any = {};
        try { metrics = hazeMetrics(buf); } catch (e) { res.metrics_error = String(e).slice(0, 200); }

        let lab: any = null, labErr: string | null = null;
        if (geminiKey) {
          try { lab = await label(geminiKey, cam, buf); } catch (e) { labErr = String(e).slice(0, 300); }
        } else labErr = 'no GEMINI_API_KEY';

        const row = {
          camera_code: cam.code, captured_at: slot.toISOString(), storage_path: path, bytes: buf.length,
          keep: slot.getUTCHours() === KEEP_HOUR_UTC, ...metrics,
          label: LABELS.includes(lab?.label) ? lab.label : null,
          hills_visible: typeof lab?.hills_visible === 'boolean' ? lab.hills_visible : null,
          cloud_on_hills: CLOUD.includes(lab?.cloud_on_hills) ? lab.cloud_on_hills : null,
          sea_visible: typeof lab?.sea_visible === 'boolean' ? lab.sea_visible : null,
          rain_or_wet_lens: typeof lab?.rain_or_wet_lens === 'boolean' ? lab.rain_or_wet_lens : null,
          label_confidence: typeof lab?.confidence === 'number' ? lab.confidence : null,
          label_note: typeof lab?.note === 'string' ? lab.note.slice(0, 500) : null,
          label_model: lab ? GEMINI_MODEL : null,
          label_error: labErr,
        };
        const { error: insErr } = await supabase.from('webcam_frames')
          .upsert(row, { onConflict: 'camera_code,captured_at' });
        if (insErr) throw insErr;
        Object.assign(res, { bytes: buf.length, label: row.label, cloud_on_hills: row.cloud_on_hills,
                             contrast_top: metrics.contrast_top, label_error: labErr });
      } catch (e: any) { res.error = String(e?.message ?? e).slice(0, 300); }
      results.push(res);
    }

    // Catch up on frames that missed a label (key missing, quota, billing),
    // a few per run, while their image is still in storage.
    let backfilled = 0;
    if (geminiKey) {
      const { data: pending } = await supabase.from('webcam_frames')
        .select('id,camera_code,storage_path').is('label', null).not('storage_path', 'is', null)
        .not('captured_at', 'eq', slot.toISOString()).order('captured_at', { ascending: false }).limit(8);
      for (const f of pending ?? []) {
        const cam = (cams ?? []).find((c: any) => c.code === f.camera_code);
        const { data: blob } = await supabase.storage.from(BUCKET).download(f.storage_path);
        if (!cam || !blob) continue;
        try {
          const lab = await label(geminiKey, cam, new Uint8Array(await blob.arrayBuffer()));
          await supabase.from('webcam_frames').update({
            label: LABELS.includes(lab?.label) ? lab.label : null,
            hills_visible: typeof lab?.hills_visible === 'boolean' ? lab.hills_visible : null,
            cloud_on_hills: CLOUD.includes(lab?.cloud_on_hills) ? lab.cloud_on_hills : null,
            sea_visible: typeof lab?.sea_visible === 'boolean' ? lab.sea_visible : null,
            rain_or_wet_lens: typeof lab?.rain_or_wet_lens === 'boolean' ? lab.rain_or_wet_lens : null,
            label_confidence: typeof lab?.confidence === 'number' ? lab.confidence : null,
            label_note: typeof lab?.note === 'string' ? lab.note.slice(0, 500) : null,
            label_model: GEMINI_MODEL, label_error: null,
          }).eq('id', f.id);
          backfilled++;
        } catch (e) {
          await supabase.from('webcam_frames').update({ label_error: String(e).slice(0, 300) }).eq('id', f.id);
          break; // same failure would repeat for the rest
        }
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

    return json({ ok: true, slot: slot.toISOString(), backfilled, pruned, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
