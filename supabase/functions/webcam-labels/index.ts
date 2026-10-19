import { createClient } from 'jsr:@supabase/supabase-js@2';

// Narrow door for the CLIP labeller in GitHub Actions (tools/webcam_clip).
// The repo is public, so the job never holds the service-role key; it holds
// WEBCAM_LABELLER_TOKEN, which can only list unlabelled frames and write
// clip_* labels.
//   GET  ?limit=N  -> frames needing a label, with 1 h signed image URLs
//   POST {results: [{id, clip_label, clip_scores, clip_model}]}

const BUCKET = 'webcams';
const LABELS = ['clear', 'haze', 'low_cloud', 'fog', 'dark', 'camera_problem'];

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const token = Deno.env.get('WEBCAM_LABELLER_TOKEN');
  if (!token || req.headers.get('x-labeller-token') !== token) return json({ ok: false, error: 'unauthorised' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    if (req.method === 'GET') {
      const limit = Math.min(500, Number(new URL(req.url).searchParams.get('limit') ?? 200));
      const { data: frames, error } = await supabase.from('webcam_frames')
        .select('id,camera_code,captured_at,storage_path,webcam_cameras(lat,lng,region)')
        .is('clip_label', null).not('storage_path', 'is', null)
        .order('captured_at', { ascending: false }).limit(limit);
      if (error) throw error;
      const out = [];
      for (const f of frames ?? []) {
        const cam: any = (f as any).webcam_cameras;
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600);
        if (!signed?.signedUrl) continue;
        // Night frames are labelled 'dark' by the labeller without CLIP.
        let sun_altitude: number | null = null;
        if (cam?.lat != null) {
          const { data: sp } = await supabase.rpc('sun_position',
            { p_ts: f.captured_at, p_lat: cam.lat, p_lng: cam.lng });
          const row = Array.isArray(sp) ? sp[0] : sp;
          sun_altitude = typeof row?.altitude === 'number' ? Math.round(row.altitude * 10) / 10 : null;
        }
        out.push({ id: f.id, camera_code: f.camera_code, captured_at: f.captured_at,
                   region: cam?.region ?? null, sun_altitude, url: signed.signedUrl });
      }
      return json({ ok: true, frames: out });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      let written = 0;
      for (const r of (body?.results ?? []).slice(0, 500)) {
        if (typeof r?.id !== 'string' || !LABELS.includes(r?.clip_label)) continue;
        const { error } = await supabase.from('webcam_frames').update({
          clip_label: r.clip_label,
          clip_scores: r.clip_scores ?? null,
          clip_model: typeof r.clip_model === 'string' ? r.clip_model.slice(0, 100) : null,
          sun_altitude: typeof r.sun_altitude === 'number' ? r.sun_altitude : null,
          clip_at: new Date().toISOString(),
        }).eq('id', r.id);
        if (!error) written++;
      }
      return json({ ok: true, written });
    }
    return json({ ok: false, error: 'method' }, 405);
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
