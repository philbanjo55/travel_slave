import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decode } from 'npm:fast-png@6.2.0';

// REGION ELEVATION GRID for terrain horizons outside the Faroes.
// POST {region, south, north, west, east, step?, zoom?, row_from?, rows?}
// samples the public AWS terrarium tiles (Mapzen / AWS Open Data; elevation
// = R*256 + G + B/256 - 32768 m) on a regular lat/lng grid into
// dem_region_rows, `rows` grid rows per call (edge CPU limit: each call
// decodes one band of tiles). The first call writes dem_regions; the call
// that finishes the last row stamps loaded_at, after which
// terrain_profile_compute uses the grid (run dem_region_recompute(region)).

const TILE = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

Deno.serve(async (req) => {
  const json = (b: any, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const t0 = Date.now();
    const b = await req.json().catch(() => ({}));
    const { region, south, north, west, east } = b;
    if (!region || [south, north, west, east].some((v: any) => typeof v !== 'number')) {
      return json({ error: 'region, south, north, west, east required' }, 400);
    }
    const step = Number(b.step ?? 0.0015);
    const zoom = Number(b.zoom ?? 11);
    const nrows = Math.round((north - south) / step) + 1;
    const ncols = Math.round((east - west) / step) + 1;
    const rowFrom = Number(b.row_from ?? 0);
    const rowTo = Math.min(nrows, rowFrom + Number(b.rows ?? 60));

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (rowFrom === 0) {
      const { error } = await db.from('dem_regions').upsert({
        region, south, north, west, east, step, nrows, ncols, loaded_at: null,
        source: `AWS terrarium z${zoom} (Mapzen / AWS Open Data)`,
      });
      if (error) throw error;
    }

    const n = 2 ** zoom;
    const tiles = new Map<string, { w: number; ch: number; data: Uint8Array | Uint16Array } | null>();
    const tile = async (x: number, y: number) => {
      const key = `${x}/${y}`;
      if (!tiles.has(key)) {
        const r = await fetch(TILE(zoom, x, y), { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) { tiles.set(key, null); await r.body?.cancel(); }
        else {
          const png = decode(new Uint8Array(await r.arrayBuffer()));
          tiles.set(key, { w: png.width, ch: png.channels, data: png.data as Uint8Array });
        }
      }
      return tiles.get(key)!;
    };

    const rows: { region: string; r: number; cells: number[] }[] = [];
    for (let r = rowFrom; r < rowTo; r++) {
      const lat = north - r * step;
      const yf = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n * 256;
      const ty = Math.floor(yf / 256), py = Math.min(255, Math.floor(yf - ty * 256));
      const cells: number[] = new Array(ncols);
      for (let c = 0; c < ncols; c++) {
        const lng = west + c * step;
        const xf = (lng + 180) / 360 * n * 256;
        const tx = Math.floor(xf / 256), px = Math.min(255, Math.floor(xf - tx * 256));
        const t = await tile(tx, ty);
        if (!t) { cells[c] = 0; continue; }
        const i = (py * t.w + px) * t.ch;
        const e = t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
        cells[c] = Math.max(-32768, Math.min(32767, Math.round(e)));
      }
      rows.push({ region, r, cells });
    }
    for (let i = 0; i < rows.length; i += 20) {
      const { error } = await db.from('dem_region_rows').upsert(rows.slice(i, i + 20));
      if (error) throw error;
    }
    const done = rowTo >= nrows;
    if (done) {
      const { error } = await db.from('dem_regions').update({ loaded_at: new Date().toISOString() }).eq('region', region);
      if (error) throw error;
    }
    return json({ ok: true, region, nrows, ncols, rows_written: rows.length, next_row: done ? null : rowTo,
                  tiles: tiles.size, ms: Date.now() - t0 });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
