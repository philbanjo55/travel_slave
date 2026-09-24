// One-time loader: copies the Faroes window of the Copernicus GLO-30 DEM
// (public AWS open data) into public.dem_blocks. See migration
// 20260924211202_terrain_from_local_dem.sql for the grid definition.
import { fromUrl } from 'npm:geotiff@2.1.3';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Retired after the load; the deployed function now returns 410. Set a fresh
// random token here before redeploying to reload the DEM.
const TOKEN = 'set-a-random-token-before-redeploying';
const ROWS = 3960, COLS = 2790, BLOCK = 90;

const tileUrl = (t: string) => {
  const n = `Copernicus_DSM_COG_10_${t}_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${n}/${n}.tif`;
};

// Grid rows 0..1619 come from the N62 tiles (tile rows 1980..3599), rows
// 1620..3959 from the N61 tiles (tile rows 0..2339). Grid cols 0..1349 come
// from W008 (tile cols 450..1799), cols 1350..2789 from W007 (tile cols 0..1439).
function sources(r0: number, r1: number) {
  const out: { lat: string; gr0: number; gr1: number; tr0: number }[] = [];
  if (r0 < 1620) out.push({ lat: 'N62_00', gr0: r0, gr1: Math.min(r1, 1620), tr0: 1980 + r0 });
  if (r1 > 1620) {
    const a = Math.max(r0, 1620);
    out.push({ lat: 'N61_00', gr0: a, gr1: r1, tr0: a - 1620 });
  }
  return out;
}
const COLSRC = [
  { lng: 'W008_00', gc0: 0,    tc0: 450, n: 1350 },
  { lng: 'W007_00', gc0: 1350, tc0: 0,   n: 1440 },
];

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.token !== TOKEN) return new Response('forbidden', { status: 403 });
    const r0 = Math.max(0, body.row_start | 0);
    const r1 = Math.min(ROWS, r0 + (body.row_count | 0));
    if (r1 <= r0) return new Response('empty range', { status: 400 });

    const grid = Array.from({ length: r1 - r0 }, () => new Int16Array(COLS));
    for (const s of sources(r0, r1)) {
      const h = s.gr1 - s.gr0;
      for (const c of COLSRC) {
        const tif = await fromUrl(tileUrl(`${s.lat}_${c.lng}`));
        const img = await tif.getImage();
        const data = await img.readRasters({
          window: [c.tc0, s.tr0, c.tc0 + c.n, s.tr0 + h], interleave: true,
        }) as Float32Array;
        for (let i = 0; i < h; i++) {
          const row = grid[s.gr0 - r0 + i];
          for (let j = 0; j < c.n; j++) {
            const v = Math.round(data[i * c.n + j]);
            row[c.gc0 + j] = v < 0 ? 0 : v > 32767 ? 32767 : v;
          }
        }
      }
    }

    const records: { r: number; b: number; cells: number[] }[] = [];
    const sums: number[] = [];
    grid.forEach((row, i) => {
      let sum = 0;
      for (const v of row) sum += v;
      sums.push(sum);
      for (let b = 0; b * BLOCK < COLS; b++) {
        records.push({ r: r0 + i, b, cells: Array.from(row.subarray(b * BLOCK, (b + 1) * BLOCK)) });
      }
    });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    for (let i = 0; i < records.length; i += 1000) {
      const { error } = await supabase.from('dem_blocks')
        .upsert(records.slice(i, i + 1000), { onConflict: 'r,b' });
      if (error) throw error;
    }
    return new Response(JSON.stringify({ ok: true, row_start: r0, row_end: r1, blocks: records.length, sums }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
