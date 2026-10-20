import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER ACTIONS: the TEST app's one door for writes and webcam images.
// POST {action, ...}
//   mark_shot    {stop_id, status: 'got' | 'nailed' | null}   tick on a stop
//   frames       {lat?, lng?, n?}  latest frame of the n cameras nearest the
//                point (all active cameras without a point), as signed URLs;
//                {camera, at?}: that camera's frame at or before `at`
//   label_frame  {frame_id, label: clear|cloud_on_hills|fog|cant_tell|null}
//   plan         {trip_id, trip_date, preview?}  plan a trip day now: light-only
//                past the forecast; preview: this week's forecast as that day
//   apply_preview {run_id, rank}  what applying a plan would change
//   apply        {run_id, rank}  test-bed trip only until Phil signs off the
//                solver; the real trip gets the preview
// Plans and settings are read straight from the tables (read-only policies).

const TEST_BED = '7e57bed0-0000-4000-8000-000000000001';
const SIGNED_URL_S = 3600;

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const url = Deno.env.get('SUPABASE_URL')!;
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    switch (body.action) {
      case 'mark_shot': {
        if (!body.stop_id) return json({ error: 'stop_id required' }, 400);
        const { data, error } = await db.rpc('solver_mark_shot', {
          p_stop_id: body.stop_id, p_status: body.status ?? null,
          p_at: body.status ? new Date().toISOString() : null,
        });
        if (error) throw error;
        return json({ ok: true, setting: data });
      }

      case 'frames': {
        const { data: cams, error } = await db.from('webcam_cameras')
          .select('code, name, island, lat, lng, image_url, source').eq('active', true);
        if (error) throw error;
        const here = body.lat != null && body.lng != null ? { lat: Number(body.lat), lng: Number(body.lng) } : null;
        const ranked = (cams ?? []).filter(c => c.lat != null && (!body.camera || c.code === body.camera))
          .map(c => ({ ...c, distance_km: here ? Math.round(km(here, c) * 10) / 10 : null }))
          .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
          .slice(0, here ? Math.min(Number(body.n ?? 2), 8) : 8);
        const out = await Promise.all(ranked.map(async c => {
          const { data: f } = await db.from('webcam_frames')
            .select('id, captured_at, storage_path, label, hills_visible, cloud_on_hills, sun_on_land, label_note, label_model, label_error, phil_label, edge_top')
            .eq('camera_code', c.code).not('storage_path', 'is', null)
            .lte('captured_at', body.at ?? new Date().toISOString())
            .order('captured_at', { ascending: false }).limit(1).maybeSingle();
          let signed: string | null = null;
          if (f?.storage_path) {
            const { data: s } = await db.storage.from('webcams').createSignedUrl(f.storage_path, SIGNED_URL_S);
            signed = s?.signedUrl ?? null;
          }
          return { camera: c, frame: f ? { ...f, url: signed, label_error: f.label_error ? 'not labelled yet' : null } : null };
        }));
        return json({ ok: true, cameras: out });
      }

      case 'label_frame': {
        const allowed = ['clear', 'cloud_on_hills', 'fog', 'cant_tell'];
        if (!body.frame_id || (body.label != null && !allowed.includes(body.label))) return json({ error: 'frame_id and a valid label required' }, 400);
        const { error } = await db.from('webcam_frames')
          .update({ phil_label: body.label ?? null, phil_labeled_at: body.label ? new Date().toISOString() : null })
          .eq('id', body.frame_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'plan': {
        if (!body.trip_id || !body.trip_date) return json({ error: 'trip_id and trip_date required' }, 400);
        const planBody: any = { trip_id: body.trip_id, trip_date: body.trip_date, k: 4 };
        if (body.preview) planBody.date = new Date().toISOString().slice(0, 10);
        const r = await fetch(`${url}/functions/v1/solver-plan`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(planBody),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) return json({ ok: false, error: j?.error ?? `planner ${r.status}`, detail: j }, 200);
        return json({ ok: true, run_id: j.run_id });
      }

      case 'apply_preview':
      case 'apply': {
        if (!body.run_id || body.rank == null) return json({ error: 'run_id and rank required' }, 400);
        const { data: run } = await db.from('solver_runs').select('trip_id').eq('id', body.run_id).maybeSingle();
        if (!run) return json({ error: 'run not found' }, 404);
        const write = body.action === 'apply' && run.trip_id === TEST_BED;
        const { data, error } = await db.rpc('solver_apply_plan', { p_run_id: body.run_id, p_rank: body.rank, p_apply: write });
        if (error) return json({ ok: false, error: error.message });
        return json({ ok: true, preview_only: !write, result: data });
      }

      default:
        return json({ error: `unknown action ${body.action}` }, 400);
    }
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
