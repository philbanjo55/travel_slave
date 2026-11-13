#!/usr/bin/env python3
"""3D sun view, park-wide trees (Grand Teton): a coarse canopy layer over the whole wide grid, from the 2022 laser survey.

  build_canopy.py grid  <work dir> [--depth 7] [--tile-n 800] [--cache <dir>]   read the survey, make the canopy grid
  build_canopy.py check <work dir> --details <terrain_detail_regions.json> --files <dir with the detail masks>
  build_canopy.py tiles <work dir> [--out <dir>]                                 the tile files, upload.txt, SQL rows

Source: USGS 3DEP lidar WY_GrandTetonNP_1_D22 (Grand Teton NP, flown 2022; public domain, USGS), the Entwine EPT on AWS,
read only to octree depth --depth (7 = one point per ~4 m voxel wherever anything came back; ~195 M points, ~1.9 GB of
LAZ for the whole wide grid). Needs: pip install "laspy[lazrs]" numpy pillow.

The grid: the wide Teton grid's box (43.45-43.95 N, 110.92-110.24 W) cut into 10 x 10 tiles of 0.05 deg x 0.068 deg
(about 5.6 x 5.5 km), each --tile-n cells a side (800 = ~7 m cells). Per cell:
  ground  = the mean of the survey's ground returns (class 2), holes (under thick crowns, roofs, water) filled from around;
  top     = the highest return that is not ground, building (6), water (9) or noise (7, 18);
  canopy  = top - ground, kept as a tree only where it is at least --min-h m (4: snow and bare twigs hide the sagebrush
            and most of the willow thickets in winter; the grid step keeps everything from 3 m), where at least two such returns came back (a single return is a bird, a wire, a pole) and where at
            least a quarter of the high returns came from pulses that went on to give more returns (a crown lets the
            laser through, a roof or a vehicle does not). Outside the survey (Wilson, the east of the grid) there is
            nothing: the layer is empty there, not guessed.
Tile file: 8-bit greyscale PNG, filter 0, row 0 = north: 0 = no tree, v = canopy height v x STEP_M (2 m) over the ground.
A tile with no tree cell is not written. The page reads a tile a line at a time (tools/sun3d/app_view.js, wide trees).
"""
import argparse, concurrent.futures as cf, json, math, os, struct, sys, time, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import build_detail as bd   # noqa: E402  (Survey, merc, fill, chunk)

NORTH, SOUTH, WEST, EAST = 43.95, 43.45, -110.92, -110.24
TR = TC = 10                 # tiles each way
STEP_M = 2.0                 # metres per value in the tile files (2 m: drawn heights are jittered 10 % anyway; a quarter less to send than 0.5 m)
MIN_H, MIN_PTS, MIN_MULTI = 3.0, 2, 0.25
PROJECT = 'WY_GrandTetonNP_1_D22'


def tile_box(tr, tc):
    dlat, dlng = (NORTH - SOUTH) / TR, (EAST - WEST) / TC
    return (round(NORTH - tr * dlat, 6), round(NORTH - (tr + 1) * dlat, 6), round(WEST + tc * dlng, 6), round(WEST + (tc + 1) * dlng, 6))


def grid(a):
    n = a.tile_n; N = n * TR; M = n * TC
    sv = bd.Survey(PROJECT, a.cache)
    x0, y1 = bd.merc(NORTH, WEST); x1, y0 = bd.merc(SOUTH, EAST)
    keys = sorted([k for k, v in sv.nodes(x0, x1, y0, y1, a.depth).items() if v > 0], key=lambda s: int(s.split('-')[0]))
    print(len(keys), 'nodes to depth', a.depth, flush=True)
    top = np.full(N * M, -1e9, np.float32); gsum = np.zeros(N * M, np.float32); gcnt = np.zeros(N * M, np.uint16)
    hv = np.zeros(N * M, np.uint16); hm = np.zeros(N * M, np.uint16); anyp = np.zeros(N * M, bool)
    # high points need the ground: kept per point (cell, z, multi) and counted once the ground is known
    vr, vcol, vz, vm = [], [], [], []
    t0 = time.time(); total = 0
    def read(k):
        x, y, z, c, many = sv.points(k, x0, x1, y0, y1)
        lat = np.degrees(np.arctan(np.sinh(y / bd.R))); lng = np.degrees(x / bd.R)
        rf = ((NORTH - lat) / (NORTH - SOUTH) * N).clip(0, N - 1e-3); cf_ = ((lng - WEST) / (EAST - WEST) * M).clip(0, M - 1e-3)
        return rf.astype(np.int64) * M + cf_.astype(np.int64), z, c, many, rf.astype(np.float32), cf_.astype(np.float32)
    with cf.ThreadPoolExecutor(4) as ex:
        for i, (idx, z, c, many, rf, cf_) in enumerate(ex.map(read, keys)):
            if not len(idx): continue
            total += len(idx); anyp[idx] = True
            g = c == 2
            if g.any(): np.add.at(gsum, idx[g], z[g]); np.add.at(gcnt, idx[g], 1)
            v = (c != 2) & (c != 6) & (c != 9)
            if v.any():
                np.maximum.at(top, idx[v], z[v])
                vr.append(rf[v]); vcol.append(cf_[v]); vz.append(z[v].astype(np.float32)); vm.append(many[v])
            if i % 500 == 0: print(i, total, round(time.time() - t0), 's', flush=True)
    print('points', total, round(time.time() - t0), 's', flush=True)
    has_g = gcnt > 0
    ground = np.where(has_g, gsum / np.maximum(gcnt, 1), 0).astype(np.float32).reshape(N, M)
    # holes in the ground: filled from around, a tile-sized piece at a time (the whole grid at once is a lot of memory)
    gf = np.empty_like(ground); hg = has_g.reshape(N, M); P = 64
    for r0 in range(0, N, n):
        for c0 in range(0, M, n):
            ra, rb, ca, cb = max(0, r0 - P), min(N, r0 + n + P), max(0, c0 - P), min(M, c0 + n + P)
            blk = bd.fill(ground[ra:rb, ca:cb].astype(np.float64), hg[ra:rb, ca:cb])
            gf[r0:r0 + n, c0:c0 + n] = blk[r0 - ra:r0 - ra + n, c0 - ca:c0 - ca + n]
    # Each return's height over the ground AT ITS OWN SPOT (the ground grid between cell centres): the cell's mean
    # ground would put the top of a 7 m cell on a 45 deg slope 3.5 m 'up' (every steep slope and cliff a forest).
    def gat(rf, cf_):
        r = np.clip(rf - 0.5, 0, N - 1.001); c = np.clip(cf_ - 0.5, 0, M - 1.001); r0 = r.astype(np.int64); c0 = c.astype(np.int64); fr = r - r0; fc = c - c0
        return (gf[r0, c0] * (1 - fc) + gf[r0, c0 + 1] * fc) * (1 - fr) + (gf[r0 + 1, c0] * (1 - fc) + gf[r0 + 1, c0 + 1] * fc) * fr
    hag = np.full(N * M, -1e9, np.float32)
    for r_, c_, z_, m_ in zip(vr, vcol, vz, vm):
        a_ = (z_ - gat(r_, c_)).astype(np.float32); i_ = r_.astype(np.int64) * M + c_.astype(np.int64)
        np.maximum.at(hag, i_, a_)
        high = a_ >= 2.0
        np.add.at(hv, i_[high], 1); np.add.at(hm, i_[high & m_], 1)
    del vr, vcol, vz, vm
    gf = gf.reshape(-1)
    h = np.where(hag > -1e8, hag, 0)
    tree = (h >= MIN_H) & (hv >= MIN_PTS) & (hm >= np.ceil(MIN_MULTI * hv)) & anyp
    can = np.where(tree, h, 0).astype(np.float32).reshape(N, M)
    np.savez_compressed(os.path.join(a.work, 'canopy.npz'), can=can, n=n, has=anyp.reshape(N, M),
                        raw=np.where(anyp & (hag > -1e8), h, 0).astype(np.float16).reshape(N, M), hv=hv.reshape(N, M), hm=hm.reshape(N, M),
                        ground=gf.reshape(N, M).astype(np.float32))
    print('tree cells', int(tree.sum()), 'of', int(anyp.sum()), 'surveyed; cell', round((NORTH - SOUTH) / N * 111132, 2), 'x', round((EAST - WEST) / M * 111320 * math.cos(math.radians(43.7)), 2), 'm', flush=True)


def read_bytes_png(path):
    b = open(path, 'rb').read(); o = 8; idat = b''; w = h = 0
    while o < len(b):
        l, = struct.unpack('>I', b[o:o + 4]); t = b[o + 4:o + 8]
        if t == b'IHDR': w, h = struct.unpack('>II', b[o + 8:o + 16])
        if t == b'IDAT': idat += b[o + 8:o + 8 + l]
        o += 12 + l
    return np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(h, w + 1)[:, 1:]


def load_can(a):
    """The grid's trees with the final rules: at least --min-h m, at least --min-multi of the high returns from pulses
    that went on (a crown lets the laser through; rock faces and roofs mostly do not), no tree above --max-elev m
    (the Teton tree line is ~3,050-3,200 m) or on ground steeper than --max-slope degrees (cliffs: the survey's ground
    class is thin there, so a rock face stands 'over' a ground filled in from below)."""
    z = np.load(os.path.join(a.work, 'canopy.npz')); can = z['can']; g = z['ground']; hv = z['hv'].astype(np.float32); hm = z['hm'].astype(np.float32)
    dz = (NORTH - SOUTH) / can.shape[0] * 111132; dx = (EAST - WEST) / can.shape[1] * 111320 * math.cos(math.radians((NORTH + SOUTH) / 2))
    gy, gx = np.gradient(g, dz, dx); slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    ok = (can >= a.min_h) & (hm >= a.min_multi * hv) & (g <= a.max_elev) & (slope <= a.max_slope)
    return np.where(ok, can, 0), int(z['n'])


def check(a):
    """The coarse layer against the 0.5 m laser boxes (their class mask: 8 + canopy / 0.2 m = tree). Heights as the tile
    files hold them (STEP_M steps)."""
    can, n = load_can(a); N, M = can.shape; MIN_H = a.min_h
    can = np.where(can > 0, np.maximum(1, np.round(can / STEP_M)) * STEP_M, 0)
    rows = [r for r in json.load(open(a.details)) if r.get('parent') == 'grand_teton']
    tot = dict(both=0, coarse_only=0, fine_only=0, neither=0, herr=[], cells=0); why = {'tree edge (under 15% of the cell)': 0, 'building': 0, 'water': 0, 'nothing': 0}
    per = []
    for r in rows:
        mp = r.get('mask_path')
        if not mp: continue
        path = os.path.join(a.files, mp)
        if not os.path.exists(path):
            alt = path.replace('_mask.png', '_mask_v3.png')
            if os.path.exists(alt): path = alt
            else: print('no mask file', mp); continue
        m = read_bytes_png(path); fn = m.shape[0]
        # coarse cells fully inside the box
        r0 = int(math.ceil((NORTH - r['north']) / (NORTH - SOUTH) * N)); r1 = int(math.floor((NORTH - r['south']) / (NORTH - SOUTH) * N))
        c0 = int(math.ceil((r['west'] - WEST) / (EAST - WEST) * M)); c1 = int(math.floor((r['east'] - WEST) / (EAST - WEST) * M))
        st = dict(both=0, coarse_only=0, fine_only=0, neither=0, herr=[])
        for R_ in range(r0, r1):
            la0 = NORTH - R_ * (NORTH - SOUTH) / N; la1 = NORTH - (R_ + 1) * (NORTH - SOUTH) / N
            fr0 = int(round((r['north'] - la0) / (r['north'] - r['south']) * fn)); fr1 = int(round((r['north'] - la1) / (r['north'] - r['south']) * fn))
            for C_ in range(c0, c1):
                lo0 = WEST + C_ * (EAST - WEST) / M; lo1 = WEST + (C_ + 1) * (EAST - WEST) / M
                fc0 = int(round((lo0 - r['west']) / (r['east'] - r['west']) * fn)); fc1 = int(round((lo1 - r['west']) / (r['east'] - r['west']) * fn))
                blk = m[max(0, fr0):min(fn, fr1), max(0, fc0):min(fn, fc1)]
                if not blk.size: continue
                t = blk >= 8; fh = (blk[t].astype(float) - 8) * 0.2
                fine = t.mean() >= 0.15 and fh.max() >= MIN_H if t.any() else False
                ch = float(can[R_, C_]); coarse = ch > 0
                k = 'both' if fine and coarse else 'coarse_only' if coarse else 'fine_only' if fine else 'neither'
                st[k] += 1
                if k == 'coarse_only':
                    why['tree edge (under 15% of the cell)' if t.any() and not (blk == 2).any() else 'building' if (blk == 2).any() else 'water' if (blk == 3).mean() > .3 else 'nothing'] += 1
                if fine and coarse: st['herr'].append(ch - float(np.percentile(fh, 95)))
        cells = st['both'] + st['coarse_only'] + st['fine_only'] + st['neither']
        e = np.array(st['herr']) if st['herr'] else np.zeros(1)
        per.append((r['id'], cells, st['both'], st['coarse_only'], st['fine_only'], round(float(np.median(e)), 2), round(float(np.mean(np.abs(e))), 2)))
        for k in ('both', 'coarse_only', 'fine_only', 'neither'): tot[k] += st[k]
        tot['herr'] += st['herr']; tot['cells'] += cells
    print('box, cells, tree both, coarse only, fine only, height error median (coarse - fine p95), mean abs')
    for p in per: print(*p)
    e = np.array(tot['herr'])
    agree = (tot['both'] + tot['neither']) / max(1, tot['cells'])
    trees_f = tot['both'] + tot['fine_only']; trees_c = tot['both'] + tot['coarse_only']
    out = dict(cells=tot['cells'], agree=round(agree, 4), both=tot['both'], coarse_only=tot['coarse_only'], fine_only=tot['fine_only'], neither=tot['neither'],
               fine_trees_found=round(tot['both'] / max(1, trees_f), 4), coarse_trees_real=round(tot['both'] / max(1, trees_c), 4),
               coarse_only_why=why, height_err_median=round(float(np.median(e)), 2), height_err_mean_abs=round(float(np.mean(np.abs(e))), 2), height_err_p90_abs=round(float(np.percentile(np.abs(e), 90)), 2))
    print(json.dumps(out))
    json.dump(dict(total=out, boxes=per), open(os.path.join(a.work, 'check.json'), 'w'), indent=1)


def tiles(a):
    """Two files a tile: lod 0 = every cell (~7 m), for the few km round a stand spot; lod 1 = 2 x 2 cells in one
    (~14 m), for farther off, where a drawn tree stands for many cells anyway: value = (tree cells of the four - 1) x 64
    + the tallest one's height / STEP_M (1..63). About a third of the bytes to send to the phone."""
    can, n = load_can(a); N, M = can.shape
    os.makedirs(a.out, exist_ok=True)
    v = np.clip(np.round(can / STEP_M), 0, 255).astype(np.uint8); v[(can > 0) & (v == 0)] = 1   # a tree never rounds to 'none'
    tr_ = can > 0; cnt4 = tr_.reshape(N // 2, 2, M // 2, 2).sum((1, 3)); hmax = can.reshape(N // 2, 2, M // 2, 2).max((1, 3))
    v1 = np.where(cnt4 > 0, (cnt4 - 1) * 64 + np.clip(np.round(hmax / STEP_M), 1, 63), 0).astype(np.uint8)
    rows = []; up = []
    for tr in range(TR):
        for tc in range(TC):
            t = v[tr * n:(tr + 1) * n, tc * n:(tc + 1) * n]
            cnt = int((t > 0).sum())
            if cnt == 0: continue
            north, south, west, east = tile_box(tr, tc)
            for lod, arr, nn, pre in ((0, t, n, 'gtc'), (1, v1[tr * n // 2:(tr + 1) * n // 2, tc * n // 2:(tc + 1) * n // 2], n // 2, 'gtcc')):
                name = f'{pre}_{tr}_{tc}.png'; path = os.path.join(a.out, name)
                bd.write_bytes(path, arr)
                b = os.path.getsize(path)
                rows.append(dict(id=f'{pre}_{tr}_{tc}', parent='grand_teton', north=north, south=south, west=west, east=east, n=nn, lod=lod, step_m=STEP_M, path=name, bytes=b, trees=cnt))
                up.append(f'{path}\t{name}\t{b}')
    open(os.path.join(a.out, 'upload.txt'), 'w').write('# local path\tpublished name (bucket terrain)\tbytes\n' + '\n'.join(up) + '\n')
    json.dump(rows, open(os.path.join(a.work, 'tiles.json'), 'w'), indent=1)
    vals = ',\n'.join(f"  ('{r['id']}', 'grand_teton', {r['north']}, {r['south']}, {r['west']}, {r['east']}, {r['n']}, {r['lod']}, {r['step_m']}, {round((NORTH - SOUTH) / TR / r['n'] * 111132, 2)}, '{r['path']}', {r['bytes']}, {r['trees']})" for r in rows)
    open(os.path.join(a.work, 'rows.sql'), 'w').write(vals + '\n')
    if a.sql: open(a.sql, 'w').write(SQL_HEAD + vals + SQL_TAIL)
    for lod in (0, 1): print('lod', lod, sum(1 for r in rows if r['lod'] == lod), 'files,', round(sum(r['bytes'] for r in rows if r['lod'] == lod) / 1e6, 2), 'MB')
    print(len(rows) // 2, 'tiles with trees,', sum(r['trees'] for r in rows if r['lod'] == 0), 'tree cells')


SQL_HEAD = """-- 3D sun view, park-wide trees (Grand Teton): a coarse canopy layer from the 2022 laser survey (USGS 3DEP lidar,
-- WY_GrandTetonNP_1_D22, public domain), written by tools/sun3d/lidar/build_canopy.py. The wide Teton grid is cut into
-- 10 x 10 tiles of 0.05 deg x 0.068 deg (~5.6 x 5.5 km); a tile with no tree is not listed. Each tile has two rows,
-- each one file in bucket `terrain` (8-bit greyscale PNG, row 0 = north, 0 = no tree):
--   lod 0: n = 800 (~7 m cells), value = the canopy's top over the ground / step_m (used within 3 km of a stand spot);
--   lod 1: n = 400 (~14 m, 2 x 2 cells in one), value = (tree cells of the four - 1) x 64 + tallest height / step_m
--          (used farther off: a third of the bytes).
-- The page (tools/sun3d/app_view.js, park-wide trees) draws one tree a cell close by and clumps farther off, beyond
-- the laser detail box, within 12 km of the stand spot; never in the sun times.
-- Outside the survey (Wilson, the east of the grid) there are no rows: no trees are drawn there.
-- A table of its own: older app builds read the other terrain tables whole and never see these rows.
-- Idempotent: the table is made if missing and the rows are written over.
--
-- Before applying: upload the files listed in upload.txt to bucket `terrain`.
create table if not exists public.terrain_tree_tiles (
  id text primary key,
  parent text not null references public.terrain_regions(id),   -- the wide region the tile sits in
  north double precision not null, south double precision not null,
  west double precision not null, east double precision not null,
  n integer not null,                 -- n x n cells, row 0 at the north edge
  lod integer not null default 0,     -- 0 every cell; 1 two by two cells in one (see above)
  step_m double precision not null default 2,     -- canopy height = value (lod 1: value & 63) x step_m (0 = no tree)
  cell_m double precision,            -- metres a cell (north-south)
  path text not null,                 -- object path in bucket terrain
  bytes integer,
  trees integer,                      -- cells with a tree
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_tree_tiles add column if not exists lod integer not null default 0;
alter table public.terrain_tree_tiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_tree_tiles' and policyname = 'app_read') then
    create policy app_read on public.terrain_tree_tiles for select using (true);
  end if;
end $$;

insert into public.terrain_tree_tiles (id, parent, north, south, west, east, n, lod, step_m, cell_m, path, bytes, trees) values
"""
SQL_TAIL = """
on conflict (id) do update set parent = excluded.parent, north = excluded.north, south = excluded.south, west = excluded.west,
  east = excluded.east, n = excluded.n, lod = excluded.lod, step_m = excluded.step_m, cell_m = excluded.cell_m, path = excluded.path,
  bytes = excluded.bytes, trees = excluded.trees;
"""


def main():
    p = argparse.ArgumentParser(); p.add_argument('cmd'); p.add_argument('work')
    p.add_argument('--depth', type=int, default=7); p.add_argument('--tile-n', type=int, default=800); p.add_argument('--min-h', type=float, default=4.0)
    p.add_argument('--min-multi', type=float, default=0.5); p.add_argument('--max-elev', type=float, default=3300); p.add_argument('--max-slope', type=float, default=55)
    p.add_argument('--cache', default=None); p.add_argument('--details'); p.add_argument('--files'); p.add_argument('--out'); p.add_argument('--sql')
    a = p.parse_args(); os.makedirs(a.work, exist_ok=True)
    a.cache = a.cache or os.path.join(a.work, 'cache'); a.out = a.out or os.path.join(a.work, 'files')
    {'grid': grid, 'check': check, 'tiles': tiles}[a.cmd](a)


if __name__ == '__main__':
    main()
