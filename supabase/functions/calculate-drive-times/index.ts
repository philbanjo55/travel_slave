import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const MAPS_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!;
const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY')!;

async function getDriveMinutes(originLat: number, originLng: number, destLat: number, destLng: number): Promise<number | null> {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=driving&key=${MAPS_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.routes?.length) return null;
  const duration = data.routes[0].legs[0].duration.value;
  return Math.round(duration / 60);
}

Deno.serve(async (req: Request) => {
  try {
    // Accept either the Supabase service key OR a custom Claude API key
    const authHeader = req.headers.get('Authorization') || '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const isAuthorized =
      authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) ||
      apiKeyHeader === CLAUDE_API_KEY ||
      authHeader.includes(CLAUDE_API_KEY);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { trip_id } = await req.json();
    if (!trip_id) return new Response(JSON.stringify({ error: 'trip_id required' }), { status: 400 });

    const { data: days, error: daysErr } = await supabase
      .from('days')
      .select('id, day_number')
      .eq('trip_id', trip_id)
      .order('day_number');

    if (daysErr) throw daysErr;

    let updated = 0, skipped = 0, failed = 0;

    for (const day of days) {
      const { data: stops } = await supabase
        .from('stops')
        .select('id, position, lat, lng, name')
        .eq('day_id', day.id)
        .order('position');

      if (!stops) continue;

      for (let i = 1; i < stops.length; i++) {
        const prev = stops[i - 1];
        const curr = stops[i];

        if (!prev.lat || !prev.lng || !curr.lat || !curr.lng) { skipped++; continue; }

        const name = curr.name || '';
        if (name.includes('→') || name.toLowerCase().includes('flight')) { skipped++; continue; }

        const minutes = await getDriveMinutes(prev.lat, prev.lng, curr.lat, curr.lng);
        if (minutes === null) { failed++; continue; }

        const { error } = await supabase.from('stops').update({ drive_override_minutes: minutes }).eq('id', curr.id);
        if (error) { failed++; } else { updated++; }

        await new Promise(r => setTimeout(r, 100));
      }
    }

    return new Response(JSON.stringify({ updated, skipped, failed }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
