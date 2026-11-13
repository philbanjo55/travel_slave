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
  canopy  = top - ground, kept as a tree only where it is at least 3 m (snow covers the sagebrush and the willows in
            winter), where at least two such returns came back (a single return is a bird, a wire, a pole) and where at
            least a quarter of the high returns came from pulses that went on to give more returns (a crown lets the
            laser through, a roof or a vehicle does not). Outside the survey (Wilson, the east of the grid) there is
            nothing: the layer is empty there, not guessed.
Tile file: 8-bit greyscale PNG, filter 0, row 0 = north: 0 = no tree, v = canopy height v x 0.5 m (1 .. 255 = 0.5 .. 127 m).
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
STEP_M = 0.5                 # metres per value in the tile files
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
    vc, vz, vm = [], [], []
    t0 = time.time(); total = 0
    def read(k):
        x, y, z, c, many = sv.points(k, x0, x1, y0, y1)
        lat = np.degrees(np.arctan(np.sinh(y / bd.R))); lng = np.degrees(x / bd.R)
        r = ((NORTH - lat) / (NORTH - SOUTH) * N).astype(np.int64).clip(0, N - 1); cc = ((lng - WEST) / (EAST - WEST) * M).astype(np.int64).clip(0, M - 1)
        return r * M + cc, z, c, many
    with cf.ThreadPoolExecutor(4) as ex:
        for i, (idx, z, c, many) in enumerate(ex.map(read, keys)):
            if not len(idx): continue
            total += len(idx); anyp[idx] = True
            g = c == 2
            if g.any(): np.add.at(gsum, idx[g], z[g]); np.add.at(gcnt, idx[g], 1)
            v = (c != 2) & (c != 6) & (c != 9)
            if v.any():
                np.maximum.at(top, idx[v], z[v])
                vc.append(idx[v].astype(np.int32)); vz.append(z[v].astype(np.float32)); vm.append(many[v])
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
    gf = gf.reshape(-1)
    for c_, z_, m_ in zip(vc, vz, vm):
        high = z_ - gf[c_] >= 2.0
        np.add.at(hv, c_[high], 1); np.add.at(hm, c_[high & m_], 1)
    del vc, vz, vm
    h = np.where(top > -1e8, top - gf, 0)
    tree = (h >= MIN_H) & (hv >= MIN_PTS) & (hm >= np.ceil(MIN_MULTI * hv)) & anyp
    can = np.where(tree, h, 0).astype(np.float32).reshape(N, M)
    np.savez_compressed(os.path.join(a.work, 'canopy.npz'), can=can, n=n, has=anyp.reshape(N, M),
                        raw=np.where(anyp & (top > -1e8), h, 0).astype(np.float16).reshape(N, M), hv=hv.reshape(N, M), hm=hm.reshape(N, M))
    print('tree cells', int(tree.sum()), 'of', int(anyp.sum()), 'surveyed; cell', round((NORTH - SOUTH) / N * 111132, 2), 'x', round((EAST - WEST) / M * 111320 * math.cos(math.radians(43.7)), 2), 'm', flush=True)


def read_bytes_png(path):
    b = open(path, 'rb').read(); o = 8; idat = b''; w = h = 0
    while o < len(b):
        l, = struct.unpack('>I', b[o:o + 4]); t = b[o + 4:o + 8]
        if t == b'IHDR': w, h = struct.unpack('>II', b[o + 8:o + 16])
        if t == b'IDAT': idat += b[o + 8:o + 8 + l]
        o += 12 + l
    return np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(h, w + 1)[:, 1:]


def check(a):
    """The coarse layer against the 0.5 m laser boxes (their class mask: 8 + canopy / 0.2 m = tree)."""
    z = np.load(os.path.join(a.work, 'canopy.npz')); can = z['can']; n = int(z['n']); N, M = can.shape
    rows = [r for r in json.load(open(a.details)) if r.get('parent') == 'grand_teton']
    tot = dict(both=0, coarse_only=0, fine_only=0, neither=0, herr=[], cells=0)
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
               height_err_median=round(float(np.median(e)), 2), height_err_mean_abs=round(float(np.mean(np.abs(e))), 2), height_err_p90_abs=round(float(np.percentile(np.abs(e), 90)), 2))
    print(json.dumps(out))
    json.dump(dict(total=out, boxes=per), open(os.path.join(a.work, 'check.json'), 'w'), indent=1)


def tiles(a):
    z = np.load(os.path.join(a.work, 'canopy.npz')); can = z['can']; n = int(z['n'])
    os.makedirs(a.out, exist_ok=True)
    v = np.clip(np.round(can / STEP_M), 0, 255).astype(np.uint8)
    rows = []; up = []
    for tr in range(TR):
        for tc in range(TC):
            t = v[tr * n:(tr + 1) * n, tc * n:(tc + 1) * n]
            cnt = int((t > 0).sum())
            if cnt == 0: continue
            name = f'gtc_{tr}_{tc}.png'; path = os.path.join(a.out, name)
            bd.write_bytes(path, t)
            b = os.path.getsize(path); north, south, west, east = tile_box(tr, tc)
            rows.append(dict(id=f'gtc_{tr}_{tc}', parent='grand_teton', north=north, south=south, west=west, east=east, n=n, step_m=STEP_M, path=name, bytes=b, trees=cnt))
            up.append(f'{path}\t{name}\t{b}')
    open(os.path.join(a.out, 'upload.txt'), 'w').write('# local path\tpublished name (bucket terrain)\tbytes\n' + '\n'.join(up) + '\n')
    json.dump(rows, open(os.path.join(a.work, 'tiles.json'), 'w'), indent=1)
    vals = ',\n'.join(f"  ('{r['id']}', 'grand_teton', {r['north']}, {r['south']}, {r['west']}, {r['east']}, {r['n']}, {r['step_m']}, '{r['path']}', {r['bytes']}, {r['trees']})" for r in rows)
    open(os.path.join(a.work, 'rows.sql'), 'w').write(vals + '\n')
    print(len(rows), 'tiles,', round(sum(r['bytes'] for r in rows) / 1e6, 2), 'MB,', sum(r['trees'] for r in rows), 'tree cells')


def main():
    p = argparse.ArgumentParser(); p.add_argument('cmd'); p.add_argument('work')
    p.add_argument('--depth', type=int, default=7); p.add_argument('--tile-n', type=int, default=800)
    p.add_argument('--cache', default=None); p.add_argument('--details'); p.add_argument('--files'); p.add_argument('--out')
    a = p.parse_args(); os.makedirs(a.work, exist_ok=True)
    a.cache = a.cache or os.path.join(a.work, 'cache'); a.out = a.out or os.path.join(a.work, 'files')
    {'grid': grid, 'check': check, 'tiles': tiles}[a.cmd](a)


if __name__ == '__main__':
    main()
