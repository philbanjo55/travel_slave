import { createClient } from 'jsr:@supabase/supabase-js@2';

// SOLVER ACTIONS: the TEST app's one door for writes and webcam images.
// POST {action, ...}
//   mark_shot    {stop_id, status: 'got' | 'nailed' | null}   tick on a stop
//   frames       {lat?, lng?, n?}  latest frame of the n cameras nearest the
//                point, within MAX_CAMERA_KM (all active cameras without a
//                point), as signed URLs;
//                {trip_id}: cameras within MAX_CAMERA_KM of any of the
//                trip's stops (the Planner's strip);
//                {camera, at?}: that camera's frame at or before `at`.
//                Daylight, fresh frames only (sun > 3 deg, not stale): at night
//                or when a camera freezes, the tile shows the last good frame
//                and its real age (taken_at: the camera's own time when known,
//                else when it was fetched). camera.live_url is the camera's
//                newest picture for the Live button (templated archives: the
//                newest file at least LIVE_LAG_MIN old, its camera-local time
//                in camera.live_time)
//   label_frame  {frame_id, label: clear|cloud_on_hills|fog|cant_tell|null}
//   stop_settings {stop_id}  the stop's planner settings and its shots
//   set_settings {stop_id, tier?, light_wanted?, fog_wanted?, star_vantage_id?}
//                Phil's own settings from the stop screen (source -> 'phil';
//                {stop_id} alone confirms Claude's suggestion as it is)
//   confirm_all  {trip_id}  keep every suggested setting on the trip as Phil's
//   subject_grid {trip_id}  each rated stop's best chance on every trip day
//                (solver_subject_grid: forecast inside the score build, else light only)
//   plan         {trip_id, trip_date, preview?}  plan a trip day now: light-only
//                past the forecast; preview: this week's forecast as that day;
//                {trip_id, trip_dates: [up to 3]} plans those days together
//   apply_preview {run_id, rank}  what applying a plan would change
//   apply        {run_id, rank}  test-bed trip only until Phil signs off the
//                solver; the real trip gets the preview
// Plans and settings are read straight from the tables (read-only policies).

const TEST_BED = '7e57bed0-0000-4000-8000-000000000001';
const TIERS = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F'];
const LIGHTS = ['front', 'side', 'back', 'soft'];
const SETTING_COLS = 'stop_id, tier, light_wanted, fog_wanted, star_vantage_id, shot_status, source';
const SIGNED_URL_S = 3600;
// A camera further than this says nothing about a stop (a Teton stop got
// Faroe cameras 6,400 km away).
const MAX_CAMERA_KM = 50;
// Templated archives (TetonCam) upload each 15-min file a few minutes late.
const LIVE_LAG_MIN = 10;
const TEMPLATE_STEP_MIN = 15;

function liveUrl(c: { image_url: string; tz: string | null }, now: Date): { url: string; time: string | null } {
  if (!c.image_url.includes('{')) return { url: c.image_url, time: null };
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: c.tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const step = TEMPLATE_STEP_MIN * 60_000;
  const t = new Date(Math.floor((now.getTime() - LIVE_LAG_MIN * 60_000) / step) * step);
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(t)) p[x.type] = x.value;
  return {
    url: c.image_url.replace('{YYYY}', p.year).replace('{MM}', p.month).replace('{DD}', p.day).replace('{HHmm}', p.hour + p.minute),
    time: `${p.hour}:${p.minute}`,
  };
}

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
          .select('code, name, island, lat, lng, image_url, source, tz').eq('active', true);
        if (error) throw error;
        const now = new Date();
        const here = body.lat != null && body.lng != null ? { lat: Number(body.lat), lng: Number(body.lng) } : null;
        let tripStops: { lat: number; lng: number }[] | null = null;
        if (body.trip_id) {
          const { data: st, error: sErr } = await db.from('stops').select('lat, lng')
            .eq('trip_id', body.trip_id).not('lat', 'is', null);
          if (sErr) throw sErr;
          tripStops = st ?? [];
        }
        const dist = (c: any) => here ? km(here, c)
          : tripStops ? Math.min(Infinity, ...tripStops.map(s => km(s, c))) : null;
        const ranked = (cams ?? []).filter(c => c.lat != null && (!body.camera || c.code === body.camera))
          .map(c => { const d = dist(c); const l = liveUrl(c, now);
            return { ...c, live_url: l.url, live_time: l.time, distance_km: d == null ? null : Math.round(d * 10) / 10 }; })
          .filter(c => c.distance_km == null || c.distance_km <= MAX_CAMERA_KM)
          .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
          .slice(0, here ? Math.min(Number(body.n ?? 2), 8) : 12);
        const out = await Promise.all(ranked.map(async c => {
          const { data: f } = await db.from('webcam_frames')
            .select('id, captured_at, fetched_at, camera_time, storage_path, label, hills_visible, cloud_on_hills, sun_on_land, label_note, label_model, label_error, phil_label, edge_top')
            .eq('camera_code', c.code).not('storage_path', 'is', null).gt('sun_altitude', 3).eq('stale', false)
            .lte('captured_at', body.at ?? new Date().toISOString())
            .order('captured_at', { ascending: false }).limit(1).maybeSingle();
          let signed: string | null = null;
          if (f?.storage_path) {
            const { data: s } = await db.storage.from('webcams').createSignedUrl(f.storage_path, SIGNED_URL_S);
            signed = s?.signedUrl ?? null;
          }
          return { camera: c, frame: f ? { ...f, url: signed, taken_at: f.camera_time ?? f.fetched_at ?? f.captured_at,
                                           label_error: f.label_error ? 'not labelled yet' : null } : null };
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

      case 'stop_settings': {
        if (!body.stop_id) return json({ error: 'stop_id required' }, 400);
        const [{ data: setting, error: sErr }, { data: pairs, error: pErr }] = await Promise.all([
          db.from('solver_stop_settings').select(SETTING_COLS).eq('stop_id', body.stop_id).maybeSingle(),
          db.from('stop_sun_pairs').select('vantage_id, position, scout_vantages(shot_name, name)')
            .eq('stop_id', body.stop_id).order('position'),
        ]);
        if (sErr) throw sErr;
        if (pErr) throw pErr;
        const shots = (pairs ?? []).map((p: any) => ({
          vantage_id: p.vantage_id, position: p.position,
          name: p.scout_vantages?.shot_name ?? p.scout_vantages?.name ?? 'shot',
        }));
        return json({ ok: true, setting, shots });
      }

      case 'set_settings': {
        if (!body.stop_id) return json({ error: 'stop_id required' }, 400);
        const patch: Record<string, any> = { source: 'phil' };
        if ('tier' in body) {
          if (body.tier != null && !TIERS.includes(body.tier)) return json({ error: `tier must be one of ${TIERS.join(', ')}` }, 400);
          patch.tier = body.tier;
        }
        if ('light_wanted' in body) {
          if (!Array.isArray(body.light_wanted) || body.light_wanted.some((l: any) => !LIGHTS.includes(l))) {
            return json({ error: `light_wanted must be a list of ${LIGHTS.join(', ')}` }, 400);
          }
          patch.light_wanted = [...new Set(body.light_wanted)];
        }
        if ('fog_wanted' in body) patch.fog_wanted = !!body.fog_wanted;
        if ('star_vantage_id' in body) patch.star_vantage_id = body.star_vantage_id ?? null;
        const { data: have } = await db.from('solver_stop_settings').select('stop_id').eq('stop_id', body.stop_id).maybeSingle();
        const q = have
          ? db.from('solver_stop_settings').update(patch).eq('stop_id', body.stop_id)
          : db.from('solver_stop_settings').insert({ stop_id: body.stop_id, time_locked: false, ...patch });
        const { data, error } = await q.select(SETTING_COLS).single();
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, setting: data });
      }

      case 'confirm_all': {
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const { data: st, error: sErr } = await db.from('stops').select('id').eq('trip_id', body.trip_id);
        if (sErr) throw sErr;
        const { data, error } = await db.from('solver_stop_settings').update({ source: 'phil' })
          .in('stop_id', (st ?? []).map(x => x.id)).eq('source', 'suggested').select('stop_id');
        if (error) throw error;
        return json({ ok: true, confirmed: data?.length ?? 0 });
      }

      case 'subject_grid': {
        if (!body.trip_id) return json({ error: 'trip_id required' }, 400);
        const { data, error } = await db.rpc('solver_subject_grid', { p_trip: body.trip_id });
        if (error) throw error;
        return json({ ok: true, grid: data ?? [] });
      }

      case 'plan': {
        const dates: string[] | null = Array.isArray(body.trip_dates) ? body.trip_dates.slice(0, 3) : null;
        if (!body.trip_id || (!body.trip_date && !dates?.length)) return json({ error: 'trip_id and trip_date (or trip_dates) required' }, 400);
        const planBody: any = dates?.length
          ? { trip_id: body.trip_id, days: dates.map(d => ({ trip_date: d })), k: 4 }
          : { trip_id: body.trip_id, trip_date: body.trip_date, k: 4 };
        if (body.preview && !dates) planBody.date = new Date().toISOString().slice(0, 10);
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
