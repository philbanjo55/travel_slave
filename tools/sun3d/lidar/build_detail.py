#!/usr/bin/env python3
"""3D sun view, third terrain level ("detail"): real foreground around every stand spot from a public laser survey.

  build_detail.py plan  <work dir> (--trip <uuid> | --pins pins.json) [options]     the boxes only, nothing fetched
  build_detail.py build <work dir> (--trip <uuid> | --pins pins.json) [options]

Source: a USGS lidar survey as an Entwine EPT on AWS (--project, default WY_GrandTetonNP_1_D22: Grand Teton, 2022,
about 7 points per 0.5 m cell; classes 2 ground, 6 building, 9 water, 1 everything else incl. trees, 7 / 18 noise).
Needs: pip install "laspy[lazrs]" numpy pillow.

What `build` does:
  1. pins as build_trip_terrain.py (the trip's shots: stand spot + subject; --trip saves <work>/pins.json);
  2. one box per stand spot: stand spots within --merge m (150) share a box, a subject within --close m (600) of its
     stand spot is kept inside it, --pad m (250) of ground around them; 0.5 m cells while the grid stays at or under
     1024 x 1024 (the pad may shrink to 200 m for that), else 1 m cells;
  3. per box, the survey's points -> per cell the highest return, its class, the mean ground and the lowest water
     return. Then the cleaning:
       - noise classes (7, 18) are never read;
       - ground = mean ground return, smoothed over about 2 m (the returns' own few cm of scatter would show as
         speckle under a low sun); cells with none (under trees and roofs, open water) are filled from around;
       - anything under 2 m above the ground that is not a building is put on the ground (sagebrush, fences, people,
         most parked cars: the trip is in winter, snow covers the low stuff);
       - thin high things are removed: a high cell must belong to a patch at least 3 cells wide (2 at 1 m cells),
         which takes out wires, poles and birds;
       - water = cells whose only low return is water, plus the cells with no return at all that join them (water
         swallows the laser, so open water is mostly empty cells); its level is the water returns', smoothed;
       - buildings = the survey's building class plus raised solid patches (1.5 m up, 3.5 m both ways, laser pulses
         coming back once, not several times as from a tree top): many cabins are left unsorted in the survey;
         footprints are tidied (a wall edge that wobbles by a cell draws as a row of teeth);
       - a patch found that way is kept only when it is 25 m2 and 2.2 m high (else it is a van or a bus);
       - within 4 m of a stand spot a building is put on the ground (no wall or roof under the camera). Trees are
         left where they are: the page itself draws none within 12 m of the eye;
  4. files in <work>/files: <id>_lidar.png = the BARE surface (ground, water, buildings; no trees) in the page's format (16-bit prediction residuals,
     height = base_m + value * step_m; step_m is 0.02 here, NOT the 0.5 of the other two levels, and base_m is the
     box's lowest height less 5 m) and <id>_mask.png (8-bit greyscale, filter 0: 0 ground / snow, 2 building, 3 water,
     8 and up = tree, canopy top (value - 8) x 0.2 m above the ground); a look-at picture per box in <work>/look;
     <work>/pins_report.json = every stand spot's distance to the nearest tree and building;
  5. <work>/terrain_detail.sql (table terrain_detail_regions + the rows; NOT applied) and <work>/upload.txt.
A stand spot the survey does not cover is listed and left out; no other data is put in its place.
"""
import argparse, concurrent.futures as cf, io, json, math, os, struct, subprocess, sys, time, urllib.request, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(HERE))
from build_trip_terrain import load_pins, read_png, at, slug   # noqa: E402

EPT = 'https://usgs-lidar-public.s3.us-west-2.amazonaws.com/'
R = 6378137.0
BINS, BIN_M = 64, 0.6        # tree file: per cell 64 height slices of 0.6 m above the ground, one bit each
WIDE_HALF, WIDE_CELL, WIDE_DEPTH = 3000.0, 4.0, 8   # the wide water layer: 6 km box, 4 m cells, survey read down to octree depth 8 (a point every ~2.8 m)
TREE0, TREE_STEP = 8, 0.2   # mask byte of a tree cell = TREE0 + its canopy height above the ground / TREE_STEP
STEP = 0.02         # metres per height value in the detail files (0.5 m cells lit by a low sun show every centimetre)
G_MESH = 768        # the page's mesh points per side


# ---------- files ----------
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

def write_heights(path, h, base, step):
    n = h.shape[0]; q = np.round((h - base) / step); assert q.min() >= 0 and q.max() <= 65535, "heights don't fit"
    p = np.zeros((n + 1, n + 1), dtype=np.int64); p[1:, 1:] = q.astype(np.int64)
    res = ((p[1:, 1:] - p[1:, :-1] - p[:-1, 1:] + p[:-1, :-1]) % 65536).astype('>u2')
    raw = b''.join(b'\x00' + res[i].tobytes() for i in range(n))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def write_bytes(path, rows):
    """Any bytes as an 8-bit greyscale PNG (filter 0), one array row a line: the page unpacks it like the other files."""
    h, w = rows.shape; raw = b''.join(b'\x00' + rows[i].tobytes() for i in range(h))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def write_mask(path, m):
    n = m.shape[0]; raw = b''.join(b'\x00' + m[i].astype(np.uint8).tobytes() for i in range(n))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


# ---------- small grid tools (numpy only) ----------
def fill(a, ok):
    """Cells that are not ok take the average of the ok cells around them, however far (coarser and coarser grids)."""
    a = np.where(ok, a, 0.0).astype(np.float64)
    if ok.all() or not ok.any(): return a
    h, w = a.shape; H2, W2 = (h + 1) // 2, (w + 1) // 2
    pa = np.zeros((H2 * 2, W2 * 2)); pa[:h, :w] = a; pk = np.zeros((H2 * 2, W2 * 2)); pk[:h, :w] = ok
    s = pa.reshape(H2, 2, W2, 2).sum((1, 3)); c = pk.reshape(H2, 2, W2, 2).sum((1, 3))
    low = fill(np.divide(s, c, out=np.zeros_like(s), where=c > 0), c > 0)
    return np.where(ok, a, box3(np.repeat(np.repeat(low, 2, 0), 2, 1)[:h, :w]))   # smoothed at every size: no blocks

def box3(a):
    p = np.pad(a, 1, mode='edge'); n, m = a.shape
    return sum(p[i:i + n, j:j + m] for i in range(3) for j in range(3)) / 9.0

def shrink(m, k):
    """True where the whole k x k block starting at the cell is True."""
    out = m.copy()
    for i in range(k):
        for j in range(k):
            if i or j: s = np.zeros_like(m); s[:m.shape[0] - i, :m.shape[1] - j] = m[i:, j:]; out &= s
    return out

def spread(m, k):
    """The reverse of shrink: every True cell marks the k x k block it started."""
    out = m.copy()
    for i in range(k):
        for j in range(k):
            if i or j: out[i:, j:] |= m[:m.shape[0] - i, :m.shape[1] - j]
    return out

def flood(seed, allowed):
    """The allowed cells joined to a seed cell (4 neighbours)."""
    m = seed & allowed
    while True:
        k = int(m.sum())
        for _ in range(24): m = grow1(m) & allowed
        if int(m.sum()) == k: return m

def grow8(m):
    n = grow1(m); n[1:, 1:] |= m[:-1, :-1]; n[1:, :-1] |= m[:-1, 1:]; n[:-1, 1:] |= m[1:, :-1]; n[:-1, :-1] |= m[1:, 1:]; return n

def grow1(m):
    n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]; return n


# ---------- the survey ----------
class Survey:
    def __init__(self, project, cache):
        self.base = EPT + project + '/'; self.cache = cache; os.makedirs(cache, exist_ok=True)
        e = json.loads(self.get('ept.json')); self.bounds = e['bounds']; self.conf = e['boundsConforming']; self.size = self.bounds[3] - self.bounds[0]
        assert str(e['srs'].get('horizontal')) == '3857', 'expected a web-mercator survey'
        self.hier = {}

    def get(self, u, keep=True):
        path = os.path.join(self.cache, u.replace('/', '_'))
        if os.path.exists(path) and os.path.getsize(path): return open(path, 'rb').read()
        err = None
        for i in range(5):
            try:
                b = urllib.request.urlopen(self.base + u, timeout=90).read()
                if keep: open(path + '.tmp', 'wb').write(b); os.replace(path + '.tmp', path)
                return b
            except Exception as e: err = e; time.sleep(1 + 2 * i)
        raise err

    def nodes(self, x0, x1, y0, y1, maxd=99):
        """Every data node whose square touches the box: {key: points}. maxd = read no deeper (a thinned, even sample)."""
        b = self.bounds; size = self.size; out = {}
        def load(key):
            if key not in self.hier: self.hier[key] = json.loads(self.get(f'ept-hierarchy/{key}.json'))
            for kk, v in self.hier[key].items():
                d, x, y, z = map(int, kk.split('-')); s = size / (1 << d)
                if b[0] + x * s > x1 or b[0] + (x + 1) * s < x0 or b[1] + y * s > y1 or b[1] + (y + 1) * s < y0: continue
                if d > maxd: continue
                if v == -1:
                    if kk == key: continue
                    if d == maxd: out[kk] = -1      # a node with its own list of deeper ones: it exists, and nothing deeper is wanted
                    else: load(kk)
                elif v > 0: out[kk] = v
        load('0-0-0-0')
        return out

    def points(self, key, x0, x1, y0, y1):
        import laspy
        las = laspy.read(io.BytesIO(self.get(f'ept-data/{key}.laz')))
        x, y, z, c = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
        m = (x >= x0) & (x < x1) & (y >= y0) & (y < y1) & (c != 7) & (c != 18)      # no noise points
        return x[m], y[m], z[m].astype(np.float32), c[m].astype(np.uint8), np.asarray(las.number_of_returns)[m] > 1

def merc(lat, lng): return R * math.radians(lng), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def grid_box(sv, box, n, log, keep=False, maxd=99):
    """The survey's points on the box's n x n lat / lng grid (row 0 = north). keep = also every point that is not
    ground, water or building (cell + height): the trees' own returns."""
    north, south, west, east = box
    x0, y1 = merc(north, west); x1, y0 = merc(south, east)
    keys = sv.nodes(x0, x1, y0, y1, maxd); order = sorted(keys, key=lambda s: int(s.split('-')[0]))
    top = np.full((n, n), -1e9, np.float32); cls = np.zeros((n, n), np.uint8); gsum = np.zeros((n, n), np.float64); gcnt = np.zeros((n, n), np.int32)
    wmin = np.full((n, n), 1e9, np.float32); cnt = np.zeros((n, n), np.int32); multi = np.zeros((n, n), np.int32); total = 0; pr, pc, pz = [], [], []
    with cf.ThreadPoolExecutor(8) as ex:
        for x, y, z, c, many in ex.map(lambda k: sv.points(k, x0, x1, y0, y1), order):
            if not len(x): continue
            total += len(x)
            lat = np.degrees(np.arctan(np.sinh(y / R))); lng = np.degrees(x / R)
            ri = ((north - lat) / (north - south) * n).astype(np.int32).clip(0, n - 1); ci = ((lng - west) / (east - west) * n).astype(np.int32).clip(0, n - 1)
            np.add.at(cnt, (ri, ci), 1); np.add.at(multi, (ri[many], ci[many]), 1)
            o = np.argsort(z, kind='stable'); r2, c2, z2, k2 = ri[o], ci[o], z[o], c[o]
            hi = z2 > top[r2, c2]                       # ascending heights: the last write per cell is its highest point
            top[r2[hi], c2[hi]] = z2[hi]; cls[r2[hi], c2[hi]] = k2[hi]
            g = c == 2
            if g.any(): np.add.at(gsum, (ri[g], ci[g]), z[g]); np.add.at(gcnt, (ri[g], ci[g]), 1)
            w = c == 9
            if w.any(): np.minimum.at(wmin, (ri[w], ci[w]), z[w])
            if keep:
                u = (c != 2) & (c != 9) & (c != 6)
                pr.append(ri[u].astype(np.int16)); pc.append(ci[u].astype(np.int16)); pz.append(z[u])
    log(f"{len(order)} survey nodes, {total:,} points in the box ({total / (n * n):.1f} a cell), cells with none: {int((cnt == 0).sum()):,} of {n * n:,}")
    return dict(top=top, cls=cls, gsum=gsum, gcnt=gcnt, wmin=wmin, cnt=cnt, multi=multi, total=total,
                pts=(np.concatenate(pr), np.concatenate(pc), np.concatenate(pz)) if keep and pr else None)


def wide_water(sv, clat, clng, terrain, log):
    """Where the water is in the 6 km around a stand spot, for the river and the lakes beyond the detail box.
    Read from a thinned sample of the survey (octree depth 8: a point every ~2.8 m wherever anything came back), on 4 m
    cells. Water = cells whose only returns are the survey's water class, plus the cells with no return at all that
    join them (water swallows the laser). An empty cell only counts where the wide terrain file is flat and within
    12 m of the water level beside it: outside the survey, and on a hole in it, everything is empty too.
    Still or moving: the water level's slope over ~100 m. Under 1.2 m a km = still (a lake, a pond, a slow backwater),
    more = moving (a river). Returns classes (0 none, 1 moving, 2 still), the level, and numbers to print."""
    n = int(round(2 * WIDE_HALF / WIDE_CELL)); kx = 111320 * math.cos(math.radians(clat)); kz = 111132
    box = tuple(round(v, 6) for v in (clat + WIDE_HALF / kz, clat - WIDE_HALF / kz, clng - WIDE_HALF / kx, clng + WIDE_HALF / kx)); north, south, west, east = box
    x0, y1 = merc(north, west); x1, y0 = merc(south, east)
    keys = sv.nodes(x0, x1, y0, y1, WIDE_DEPTH); order = sorted(keys, key=lambda s: int(s.split('-')[0]))
    cnt = np.zeros((n, n), np.int32); gcnt = np.zeros((n, n), np.int32); wsum = np.zeros((n, n), np.float64); wcnt = np.zeros((n, n), np.int32); total = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for x, y, z, c, _ in ex.map(lambda k: sv.points(k, x0, x1, y0, y1), order):
            if not len(x): continue
            total += len(x)
            lat = np.degrees(np.arctan(np.sinh(y / R))); lng = np.degrees(x / R)
            ri = ((north - lat) / (north - south) * n).astype(np.int32).clip(0, n - 1); ci = ((lng - west) / (east - west) * n).astype(np.int32).clip(0, n - 1)
            np.add.at(cnt, (ri, ci), 1)
            w = c == 9; g = ~w
            np.add.at(gcnt, (ri[g], ci[g]), 1); np.add.at(wsum, (ri[w], ci[w]), z[w]); np.add.at(wcnt, (ri[w], ci[w]), 1)
    has = cnt > 0; seed = (wcnt > 0) & (gcnt == 0)
    out = dict(box=box, n=n, cls=np.zeros((n, n), np.uint8), level=np.zeros((n, n)), water_m2=0.0, still_m2=0.0, nodata=float((~has).mean()), points=total, nodes=len(order))
    if not seed.any(): log(f"wide water: {len(order)} nodes, {total:,} points; no water returns in the 6 km box"); return out
    level = fill(wsum / np.maximum(wcnt, 1), seed)
    for _ in range(8): level = box3(level)
    la = north - (np.arange(n) + .5) * (north - south) / n; lo = west + (np.arange(n) + .5) * (east - west) / n
    th, tbox = terrain; terr = at(th, tbox, la[:, None] + 0 * lo[None, :], lo[None, :] + 0 * la[:, None])
    gy, gx = np.gradient(np.nan_to_num(terr, nan=0.0), WIDE_CELL)
    fits = np.isfinite(terr) & (np.abs(terr - level) < 12.0) & (np.hypot(gx, gy) < 0.08)
    water = flood(seed, seed | (~has & fits))
    for _ in range(10): water |= grow1(water) & ~has     # the river's own edge: empty cells within 40 m of that water, whatever the coarse terrain file says of the bank
    water = spread(shrink(water, 2), 2) | (grow1(spread(shrink(water, 2), 2)) & water)   # no slivers one cell wide
    if not water.any(): log("wide water: water returns, but no patch 8 m wide"); return out
    # still or moving: the level's slope, taken on 32 m blocks of water cells
    k = 8; m = n // k
    bs = np.where(water, level, 0.0)[:m * k, :m * k].reshape(m, k, m, k).sum((1, 3)); bc = water[:m * k, :m * k].reshape(m, k, m, k).sum((1, 3))
    bl = np.divide(bs, bc, out=np.zeros_like(bs), where=bc > 0); bw = bc > 0; slope = np.zeros((m, m)); seen = np.zeros((m, m), bool)
    for step in (3, 2, 1):   # against the water block ~100 m off each way (same water: under 2 m apart in level), nearer ones only where there is none
        prev = seen.copy()
        for dr, dc in ((step, 0), (-step, 0), (0, step), (0, -step)):
            o = np.zeros((m, m)); ow = np.zeros((m, m), bool)
            src = (slice(max(0, dr), m + min(0, dr)), slice(max(0, dc), m + min(0, dc))); dst = (slice(max(0, -dr), m + min(0, -dr)), slice(max(0, -dc), m + min(0, -dc)))
            o[dst] = bl[src]; ow[dst] = bw[src]
            use = bw & ow & (np.abs(o - bl) < 2.0) & ~prev
            slope = np.where(use, np.maximum(slope, np.abs(o - bl) / (step * k * WIDE_CELL)), slope); seen |= use
    mv = bw & (slope > 0.0012)
    mv = bw & (box3(mv.astype(float)) * 9 >= np.maximum(1, box3(bw.astype(float)) * 9) * 0.5)        # the local majority of water blocks
    up = np.zeros((n, n), bool); up[:m * k, :m * k] = np.repeat(np.repeat(mv, k, 0), k, 1)
    moving = water & up
    cls = np.zeros((n, n), np.uint8); cls[water] = 2; cls[moving] = 1
    a2 = WIDE_CELL * WIDE_CELL
    out.update(cls=cls, level=level, water_m2=float(water.sum() * a2), still_m2=float((water & ~moving).sum() * a2), nodata=float((~has & ~water).mean()),
               returns=int(seed.sum()), levels=(float(np.percentile(level[water], 2)), float(np.percentile(level[water], 98))))
    log(f"wide water (6 km box, 4 m cells): {len(order)} nodes, {total:,} points; water {water.sum() * a2 / 1e4:.1f} ha ({(water & ~moving).sum() * a2 / 1e4:.1f} still, {moving.sum() * a2 / 1e4:.1f} moving), "
        f"levels {out['levels'][0]:.1f}..{out['levels'][1]:.1f} m, {int(seed.sum()):,} cells with water returns; no data (no return, not water): {out['nodata']:.1%} of the box")
    return out


def clean(g, box, n, cell, stands, ww=None, no_bld=False):
    """Surface heights, the class mask and the trees' own returns from the gridded points. ww = the wide water layer."""
    north, south, west, east = box
    top, cls, cnt = g['top'].astype(np.float64), g['cls'], g['cnt']; has = cnt > 0
    gnd_ok = g['gcnt'] > 0; wat_ok = (g['wmin'] < 1e8) & ~gnd_ok
    # water: laser light is swallowed by water, so open water is mostly cells with no return at all. Water = the cells
    # whose only low return is water, plus the empty cells joined to them (an empty cell under a tree is not joined).
    # The wide layer adds what this box alone cannot know: an empty patch that is water there (its water returns lie
    # outside the box) starts the same search here.
    seed = wat_ok & (~has | (cls == 9)); wide_here = np.zeros((n, n), bool); wide_lvl = None
    if ww is not None and ww['cls'].any():
        wb = ww['box']; wn = ww['n']
        wr = (((wb[0] - (north - (np.arange(n) + .5) * (north - south) / n)) / (wb[0] - wb[1])) * wn).astype(int).clip(0, wn - 1)
        wc = ((((west + (np.arange(n) + .5) * (east - west) / n) - wb[2]) / (wb[3] - wb[2])) * wn).astype(int).clip(0, wn - 1)
        wide_here = ww['cls'][np.ix_(wr, wc)] > 0; wide_lvl = ww['level'][np.ix_(wr, wc)]
        seed |= ~has & wide_here
    water = flood(seed, ~has | (wat_ok & (cls == 9)))
    added = int((water & ~flood(wat_ok & (~has | (cls == 9)), ~has | (wat_ok & (cls == 9)))).sum()) if wide_here.any() else 0
    level = fill(g['wmin'], wat_ok) if wat_ok.any() else (wide_lvl if wide_lvl is not None else np.zeros((n, n)))
    for _ in range(12): level = box3(level)
    base = fill(g['gsum'] / np.maximum(g['gcnt'], 1), gnd_ok) if gnd_ok.any() else level
    for _ in range(6): base = np.where(gnd_ok, base, box3(base))        # the filled patches, smoothed
    base = box3(box3(base))                                              # and the returns' own scatter
    base = np.where(water, level, base); base_ok = gnd_ok | water
    hag = np.where(has, top - base, 0.0)
    k = 3 if cell < 0.75 else 2
    # buildings: the survey's own class, plus (many cabins and barns are left unsorted in it) raised solid patches. Solid =
    # the laser pulses come back once (a roof), not several times (a tree top lets part of each pulse through). Measured:
    # roofs 0-15% of points from pulses with several returns, tree tops 75-90%.
    cand = has & (cls != 2) & (cls != 9) & (hag >= 1.5) & ~water
    share = box3(box3(g['multi'] / np.maximum(cnt, 1)))
    kb = int(round(3.5 / cell)); kr = int(round(2.0 / cell))
    roof = spread(shrink(cand, kb), kb) & (share < 0.35)                 # part of a raised block 3.5 m both ways (no car, no bush)
    roof = spread(shrink(roof, kr), kr)                                  # and solid over 2 m both ways
    for _ in range(4): roof = grow1(roof) & cand & (share < 0.6)
    surveyed = has & (cls == 6) & ~water
    bld0 = surveyed | roof
    # a patch found this way with none of the survey's own building cells in it is a building only when it is at least
    # 25 m2 and 2.2 m high: smaller or lower ones are vans, buses and trailers. They go to the ground.
    parked = np.zeros_like(bld0); todo = bld0 & ~surveyed; seen = np.zeros_like(bld0)
    for r0, c0 in zip(*np.nonzero(todo)):
        if seen[r0, c0]: continue
        seen[r0, c0] = True; stack = [(r0, c0)]; cells = []; own = False
        while stack:
            r, c = stack.pop(); cells.append((r, c)); own |= bool(surveyed[r, c])
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    rr_, cc_ = r + a, c + b
                    if 0 <= rr_ < n and 0 <= cc_ < n and bld0[rr_, cc_] and not seen[rr_, cc_]: seen[rr_, cc_] = True; stack.append((rr_, cc_))
        if not own:
            rs, cs = zip(*cells)
            if len(cells) * cell * cell < 25.0 or np.percentile(hag[rs, cs], 90) < 2.2: parked[rs, cs] = True
    bld0 &= ~parked; found = bld0 & ~surveyed
    # straight walls: a footprint's edge wobbles by a cell from row to row, and a height grid draws that as a row of
    # teeth. Close and open the footprint (3 x 3); cells it gains take the roof height beside them, cells it loses go to the ground
    bld = ~grow8(~grow8(bld0)); bld = grow8(~grow8(~bld)) & bld
    q = np.pad(np.where(bld0, top, -1e9), 1, mode='constant', constant_values=-1e9)
    beside = np.max([q[i:i + n, j:j + n] for i in range(3) for j in range(3)], axis=0)
    top = np.where(bld & ~bld0, beside, top); shaved = (bld0 & ~bld) | parked
    high = has & (cls != 2) & (cls != 6) & (cls != 9) & (hag >= 2.0) & ~bld & ~shaved & ~water
    core = spread(shrink(high, k), k); tree = core.copy()
    for _ in range(2): tree = grow1(tree) & high                         # a patch gets its own rim back, a wire that touches it does not
    thin = int(high.sum() - tree.sum())
    # the pins: how far each stand spot is from the nearest tree and building (as surveyed, before anything is cleared)
    rr = (north - (np.arange(n) + 0.5) * (north - south) / n)[:, None]; cc = (west + (np.arange(n) + 0.5) * (east - west) / n)[None, :]
    kx = 111320 * math.cos(math.radians((north + south) / 2)); kz = 111132; pins = []
    for la, lo in stands:
        d = np.hypot((cc - lo) * kx, (rr - la) * kz)
        over = tree & (d <= 1.0)
        pins.append(dict(lat=la, lng=lo, tree_m=float(d[tree].min()) if tree.any() else None, building_m=float(d[bld].min()) if bld.any() else None,
                         canopy_m=float(hag[over].max()) if over.any() else 0.0))
        bld &= d > 4.0                                                    # never a wall or a roof under the camera
    # the surface is the bare ground with the buildings on it. Trees are NOT in it: the mask carries each tree cell's
    # canopy height, the page draws them as points you can see between and keeps them out of the sun-time checks
    if no_bld:   # the park-wide buildings (build_buildings.py) draw them as walls and roofs: here they are ground, and no tree
        tree &= ~grow8(grow8(bld)); bld[:] = False
    surf = np.where(bld, top, base)
    mask = np.zeros((n, n), np.uint8); mask[water] = 3
    mask[tree] = (TREE0 + np.clip(np.round(hag / TREE_STEP), 1, 255 - TREE0)).astype(np.uint8)[tree]; mask[bld] = 2
    # the trees' own returns: per tree cell, which 0.6 m slices above the ground a return came from (one bit each). The
    # page puts its points there, so a spruce is a cone and a cottonwood a spread crown, at their real heights.
    vox = np.zeros((n, n), np.uint64); nv = 0
    if g.get('pts') is not None:
        pr, pc, pz = g['pts']; pr = pr.astype(np.int64); pc = pc.astype(np.int64)
        h = pz - base[pr, pc]; ok = tree[pr, pc] & (h >= 1.0) & (h <= hag[pr, pc] + 0.3)
        b = np.clip((h[ok] / BIN_M).astype(np.int64), 0, BINS - 1)
        np.bitwise_or.at(vox, (pr[ok], pc[ok]), np.left_shift(np.uint64(1), b.astype(np.uint64)))
        tb = np.clip((hag / BIN_M).astype(np.int64), 0, BINS - 1)                    # every tree cell has at least its top
        vox = np.where(tree, vox | np.left_shift(np.uint64(1), tb.astype(np.uint64)), np.uint64(0))
        nv = int(sum(int(((vox >> np.uint64(i)) & np.uint64(1)).sum()) for i in range(BINS)))
    return surf, mask, base, dict(thin=thin, tallest=float(np.max(np.where(tree | bld, hag, 0.0))), filled=int((~base_ok).sum()), found=int((found & bld).sum()),
                                  parked=int(parked.sum()), pins=pins, vox=vox, voxels=nv, water_added=added)


def look(path, surf, mask, cell):
    from PIL import Image
    gy, gx = np.gradient(surf, cell); sh = np.clip(0.75 + 0.6 * (-gx - gy) / np.sqrt(1 + gx * gx + gy * gy), 0.25, 1.15)
    pal = np.array([(235, 238, 242), (40, 80, 50), (150, 105, 70), (50, 90, 130)], np.float64)
    kind = np.where(mask >= TREE0, 1, mask)
    Image.fromarray(np.clip(pal[kind] * np.where(kind == 1, 0.6 + (mask.astype(np.float64) - TREE0) * TREE_STEP / 40, sh)[:, :, None], 0, 255).astype(np.uint8)).save(path)


# ---------- the boxes ----------
def pick_near(nears, region, stand, subject):
    """The app's choice of fine box for a shot (src/services/terrain.ts pickNear)."""
    edge = 4.2 * max(region['width_m'], region['depth_m']) / (G_MESH - 1) + 30; kx = 111320 * math.cos(math.radians(stand[0])); kz = 111132
    best = None; bb = False; ba = 1e99
    for r in nears:
        if r['parent'] != region['id'] or not (r['south'] <= stand[0] <= r['north'] and r['west'] <= stand[1] <= r['east']): continue
        if min((r['north'] - stand[0]) * kz, (stand[0] - r['south']) * kz, (stand[1] - r['west']) * kx, (r['east'] - stand[1]) * kx) < edge: continue
        both = r['south'] <= subject[0] <= r['north'] and r['west'] <= subject[1] <= r['east']; area = (r['north'] - r['south']) * (r['east'] - r['west'])
        if (both and not bb) or (both == bb and area < ba): best, bb, ba = r, both, area
    return best

def plan(pins, a):
    shots = pins.get('shots', []); assert shots, 'no shots (stand spot + subject) for this trip'
    regions = pins.get('regions', []); nears = pins.get('nears', [])
    lat0 = float(np.mean([s['vlat'] for s in shots])); kx = 111320 * math.cos(math.radians(lat0)); kz = 111132
    st = {}
    for s in shots:
        key = (round(s['vlat'], 5), round(s['vlng'], 5))
        e = st.setdefault(key, {'lat': s['vlat'], 'lng': s['vlng'], 'stops': [], 'extra': [], 'subjects': []})
        if s['stop'] not in e['stops']: e['stops'].append(s['stop'])
        e['subjects'].append((s['slat'], s['slng']))
        if math.hypot((s['slng'] - s['vlng']) * kx, (s['slat'] - s['vlat']) * kz) <= a.close: e['extra'].append((s['slat'], s['slng']))
    st = list(st.values()); grp = list(range(len(st)))
    def find(i):
        while grp[i] != i: i = grp[i]
        return i
    for i in range(len(st)):
        for j in range(i + 1, len(st)):
            if math.hypot((st[i]['lng'] - st[j]['lng']) * kx, (st[i]['lat'] - st[j]['lat']) * kz) <= a.merge: grp[find(j)] = find(i)
    out, used = [], set(); stop_pin = {s['name']: (s['lat'], s['lng']) for s in pins.get('stops', [])}
    for root in sorted(set(find(i) for i in range(len(st)))):
        mem = [st[i] for i in range(len(st)) if find(i) == root]
        pts = [(m['lat'], m['lng']) for m in mem] + [p for m in mem for p in m['extra']]
        la0, la1 = min(p[0] for p in pts), max(p[0] for p in pts); lo0, lo1 = min(p[1] for p in pts), max(p[1] for p in pts)
        clat, clng = (la0 + la1) / 2, (lo0 + lo1) / 2; kxl = 111320 * math.cos(math.radians(clat))
        ext = max((la1 - la0) * kz, (lo1 - lo0) * kxl)
        if a.side: cell = a.cell; side = max(a.side, ext + 2 * 100)
        elif ext + 2 * min(a.pad, 200) <= 512: cell = 0.5; side = min(512.0, ext + 2 * a.pad)
        else: cell = 1.0; side = min(1024.0, ext + 2 * a.pad)
        n = int(math.ceil(side / cell / 8) * 8); side = n * cell
        box = (clat + side / 2 / kz, clat - side / 2 / kz, clng - side / 2 / kxl, clng + side / 2 / kxl)
        if a.side and regions:   # a big box is moved (not shrunk) to sit inside the fine box its shots use, clear of the strip where that blends out
            reg0 = next((r for r in regions if r['south'] <= clat <= r['north'] and r['west'] <= clng <= r['east']), None)
            nr = pick_near(nears, reg0, (mem[0]['lat'], mem[0]['lng']), mem[0]['subjects'][0]) if reg0 else None
            if nr:
                m = (4.2 * max(nr['width_m'], nr['depth_m']) / (G_MESH - 1) + 20)
                n_, s_, w_, e_ = nr['north'] - m / kz, nr['south'] + m / kz, nr['west'] + m / kxl, nr['east'] - m / kxl
                dlat = min(0, n_ - box[0]) + max(0, s_ - box[1]); dlng = min(0, e_ - box[3]) + max(0, w_ - box[2])
                box = (box[0] + dlat, box[1] + dlat, box[2] + dlng, box[3] + dlng)
                if box[0] > n_ + 1e-9 or box[1] < s_ - 1e-9 or box[2] < w_ - 1e-9 or box[3] > e_ + 1e-9: notes_fit = True
        box = tuple(round(v, 6) for v in box)
        stops = [s for m in mem for s in m['stops']]; stops = sorted(set(stops), key=stops.index)
        name = min(stops, key=lambda s: math.hypot((stop_pin.get(s, (clat, clng))[1] - clng) * kxl, (stop_pin.get(s, (clat, clng))[0] - clat) * kz))
        bid = f"{a.prefix}_{slug(name)}"; k = 2
        while bid in used: bid = f"{a.prefix}_{slug(name)}_{k}"; k += 1
        used.add(bid)
        region = next((r for r in regions if r['south'] <= clat <= r['north'] and r['west'] <= clng <= r['east']), None)
        notes = []
        for m in mem:   # the page draws the detail inside the shot's fine box: it has to sit inside it
            for sub in m['subjects']:
                nr = pick_near(nears, region, (m['lat'], m['lng']), sub) if region else None
                if nr and not (box[0] <= nr['north'] and box[1] >= nr['south'] and box[2] >= nr['west'] and box[3] <= nr['east']) and nr['id'] not in notes: notes.append(nr['id'])
        out.append(dict(id=bid, box=box, n=n, cell=cell, side=side, stops=stops, stands=[(m['lat'], m['lng']) for m in mem], region=region['id'] if region else None, outside=notes))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('cmd', choices=['plan', 'build']); ap.add_argument('work')
    ap.add_argument('--trip'); ap.add_argument('--pins'); ap.add_argument('--q')
    ap.add_argument('--project', default='WY_GrandTetonNP_1_D22'); ap.add_argument('--prefix', default='gtd')
    ap.add_argument('--pad', type=float, default=250.0); ap.add_argument('--merge', type=float, default=150.0); ap.add_argument('--close', type=float, default=600.0)
    ap.add_argument('--only', help='comma list of box ids'); ap.add_argument('--suffix', default='', help='added to every file name, e.g. _v3'); ap.add_argument('--out', default='files', help='folder under the work dir')
    ap.add_argument('--side', type=float, default=0, help='every box this many metres a side (moved inside its fine box)'); ap.add_argument('--cell', type=float, default=1.0)
    ap.add_argument('--max-depth', type=int, default=99, help='read the survey no deeper (10 = about 0.5 m apart: enough for 1 m cells)')
    ap.add_argument('--no-buildings', action='store_true', help='buildings on the ground (the park-wide building files draw them)')
    ap.add_argument('--wide-file', help="the region's wide file, to print how the survey's ground sits against it"); ap.add_argument('--migration', default='terrain_detail.sql')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    if not a.pins and not a.trip and os.path.exists(f"{a.work}/pins.json"): a.pins = f"{a.work}/pins.json"
    pins = load_pins(a)
    if a.trip and not a.pins:   # the fine boxes too: a detail box has to sit inside the one its shot uses
        q = a.q or os.environ.get('TRIP_Q')
        pins['nears'] = json.loads(subprocess.run([q, "select id, parent, north, south, west, east, n, width_m, depth_m from terrain_near_regions"], capture_output=True, text=True, check=True).stdout)
        json.dump(pins, open(f"{a.work}/pins.json", 'w'), indent=1)
    boxes = plan(pins, a)
    if a.only: boxes = [b for b in boxes if b['id'] in a.only.split(',')]
    print(f"{len(boxes)} detail boxes:")
    for b in boxes:
        print(f"  {b['id']}: {b['box'][0]}..{b['box'][1]}, {b['box'][2]}..{b['box'][3]}, {b['side']:.0f} m, n {b['n']} ({b['cell']} m cells), region {b['region']}: {', '.join(b['stops'])}"
              + (f"  [WARN] pokes out of fine box {', '.join(b['outside'])}: the page will leave the detail out there" if b['outside'] else ''))
    if a.cmd == 'plan': return

    F = f"{a.work}/{a.out}"; os.makedirs(F, exist_ok=True); os.makedirs(f"{a.work}/look", exist_ok=True)
    sv = Survey(a.project, f"{a.work}/cache"); cb = sv.conf
    regions = {r['id']: r for r in pins.get('regions', [])}; wide = {}
    rows, uploads, missing, table, pinrep, more = [], [], [], [], [], {}
    for b in boxes:
        t0 = time.time(); bid, box, n, cell = b['id'], b['box'], b['n'], b['cell']
        print(f"\n{bid} ({', '.join(b['stops'])})", flush=True)
        if not b['region']: print("  no wide region holds it: left out"); missing.append((bid, b['stops'], 'no wide region')); continue
        x0, y1 = merc(box[0], box[2]); x1, y0 = merc(box[1], box[3])
        if x1 < cb[0] or x0 > cb[3] or y1 < cb[1] or y0 > cb[4]:
            print("  outside the survey: left out"); missing.append((bid, b['stops'], 'outside the survey area')); continue
        say = lambda s: print('  ' + s, flush=True); r = regions.get(b['region']); ww = None
        if a.wide_file and r:   # the water of the 6 km around first: the box's own water search starts from it too
            if r['id'] not in wide: wide[r['id']] = read_png(a.wide_file, r['base_m'], r['step_m'])
            ww = wide_water(sv, (box[0] + box[1]) / 2, (box[2] + box[3]) / 2, (wide[r['id']], (r['north'], r['south'], r['west'], r['east'])), say)
        g = grid_box(sv, box, n, say, keep=True, maxd=a.max_depth)
        got = float((g['cnt'] > 0).mean())
        if got < 0.5:
            print(f"  the survey has points in only {got:.0%} of the box: left out"); missing.append((bid, b['stops'], f"survey covers {got:.0%} of the box")); continue
        surf, mask, base, st = clean(g, box, n, cell, b['stands'], ww, a.no_buildings)
        base_m = math.floor(float(surf.min())) - 5
        hp, mp, tp, wp = (f"{F}/{bid}_{k}{a.suffix}.png" for k in ('lidar', 'mask', 'trees', 'water'))
        write_heights(hp, surf, base_m, STEP); write_mask(mp, mask); look(f"{a.work}/look/{bid}.png", surf, mask, cell)
        extra = dict(trees_path=None, trees_bytes=None, water_path=None, water_bytes=None, water_n=None, water_north=None, water_south=None, water_west=None, water_east=None, voxels=st['voxels'], water_wide_m2=0.0, water_still_m2=0.0, nodata=None)
        if st['voxels']:
            write_bytes(tp, st['vox'].astype('<u8').view(np.uint8).reshape(n, n * 8)); extra.update(trees_path=os.path.basename(tp), trees_bytes=os.path.getsize(tp)); uploads.append(tp)
        if ww is not None:
            extra.update(water_wide_m2=ww['water_m2'], water_still_m2=ww['still_m2'], nodata=ww['nodata'])
            if ww['cls'].any():
                write_bytes(wp, ww['cls']); wb = ww['box']
                extra.update(water_path=os.path.basename(wp), water_bytes=os.path.getsize(wp), water_n=ww['n'], water_north=wb[0], water_south=wb[1], water_west=wb[2], water_east=wb[3]); uploads.append(wp)
        assert np.abs(read_png(hp, base_m, STEP) - surf).max() <= STEP / 2 + 1e-6
        nt, nb, nw = int((mask >= TREE0).sum()), int((mask == 2).sum()), int((mask == 3).sum()); a2 = cell * cell
        print(f"  cells {n} x {n} at {cell} m; buildings {nb:,} cells ({nb * a2:,.0f} m2, {st['found']:,} cells found as solid raised patches, {st['parked']:,} cells of vans and the like put on the ground), trees {nt:,} ({nt * a2 / 1e4:.2f} ha), water {nw:,} ({nw * a2 / 1e4:.2f} ha); thin high cells removed {st['thin']:,}; "
              f"ground filled in {st['filled']:,} cells; tallest thing {st['tallest']:.1f} m; heights {surf.min():.1f}..{surf.max():.1f} m")
        note = ''
        if a.wide_file and r:
            k = 60; la = box[0] - (np.arange(k) + .5) * (box[0] - box[1]) / k; lo = box[2] + (np.arange(k) + .5) * (box[3] - box[2]) / k
            LA = la[:, None] + 0 * lo[None, :]; LO = lo[None, :] + 0 * la[:, None]
            df = at(base, box, LA, LO) - at(wide[r['id']], (r['north'], r['south'], r['west'], r['east']), LA, LO)

            note = f"; ground against the wide grid: middle {np.median(df):+.1f} m, 9 in 10 within {np.percentile(np.abs(df), 90):.1f} m"
            if st['water_added']: note += f"; {st['water_added']:,} water cells found through the wide layer"
        hs, ms = os.path.getsize(hp), os.path.getsize(mp)
        print(f"  trees: {st['voxels']:,} filled 0.6 m slices in {nt:,} cells, file {(extra['trees_bytes'] or 0) / 1e3:.0f} KB; wide water file {(extra['water_bytes'] or 0) / 1e3:.1f} KB")
        print(f"  files: heights {hs / 1e3:.0f} KB, mask {ms / 1e3:.1f} KB{note}; {time.time() - t0:.0f} s", flush=True)
        kxl = 111320 * math.cos(math.radians((box[0] + box[1]) / 2))
        rows.append((bid, b['region'], box, n, (box[3] - box[2]) * kxl, (box[0] - box[1]) * 111132, base_m, cell, os.path.basename(hp), hs, os.path.basename(mp), ms))
        more[bid] = extra
        uploads += [hp, mp]; table.append((bid, n, cell, hs, ms, nb, nt, nw, g['total'], extra))
        for pin in st['pins']:
            who = sorted({f"{sh['stop']} / {sh['subject']}" for sh in pins.get('shots', []) if abs(sh['vlat'] - pin['lat']) < 1.5e-5 and abs(sh['vlng'] - pin['lng']) < 1.5e-5})
            pinrep.append(dict(box=bid, shots=who, **pin))

    sql = f"""-- 3D sun view, third terrain level (detail): real foreground around the stand spots from a public laser survey
-- (USGS 3DEP lidar, {a.project}, public domain). Written by tools/sun3d/lidar/build_detail.py.
-- terrain_regions = the wide grid per area, terrain_near_regions = fine boxes (about 6 m), terrain_detail_regions =
-- small boxes (about 500 m across, 0.5 or 1 m cells) around a stand spot. Each row has two files in bucket `terrain`:
-- the heights = the bare ground with the buildings on it (the page's 16-bit format, height = base_m + value * step_m,
-- step_m 0.02 here) and a class mask (8-bit: 0 ground / snow, 2 building, 3 water, 8 and up = tree, its canopy top
-- (value - 8) x 0.2 m above the ground). The page (tools/sun3d/app_view.js, cfg.detail) draws the box inside the
-- shot's fine box (or the wide grid), buildings as blocks and trees as points; sun times use ground and buildings only.
-- Two more files a row (round 3): trees_path = the trees' own laser returns (8-bit PNG, n x 8 bytes a line: per cell
-- 64 bits, bit k = a return in the slice k x trees_bin_m above the ground) and water_path = where the water is in the
-- 6 km around the box (8-bit PNG, water_n x water_n over water_north..water_east: 0 none, 1 moving, 2 still).
-- A table of its own for the same reason as terrain_near_regions: older app builds read the other two tables whole.
--
-- Before applying: upload the files listed in upload.txt to bucket `terrain`.
create table if not exists public.terrain_detail_regions (
  id text primary key,
  parent text not null references public.terrain_regions(id),   -- the wide region this box sits inside
  north double precision not null, south double precision not null,
  west double precision not null, east double precision not null,
  n integer not null,                 -- the grid is n x n points, row 0 at the north edge
  width_m double precision not null, depth_m double precision not null,
  base_m double precision not null default 0,     -- height = base_m + value * step_m
  step_m double precision not null default 0.02,
  cell_m double precision,            -- metres a point
  path text not null,                 -- heights, object path in bucket terrain
  bytes integer,
  mask_path text,                     -- class mask, object path in bucket terrain
  mask_bytes integer,
  trees_path text, trees_bytes integer, trees_bins integer, trees_bin_m double precision,
  water_path text, water_bytes integer, water_n integer,
  water_north double precision, water_south double precision, water_west double precision, water_east double precision,
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_detail_regions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_detail_regions' and policyname = 'app_read') then
    create policy app_read on public.terrain_detail_regions for select using (true);
  end if;
end $$;
"""
    if rows:
        sq = lambda v: 'null' if v is None else (f"'{v}'" if isinstance(v, str) else str(v))
        sql += "\ninsert into public.terrain_detail_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes, trees_path, trees_bytes, trees_bins, trees_bin_m, water_path, water_bytes, water_n, water_north, water_south, water_west, water_east, note) values\n" + ",\n".join(
            f"  ('{bid}', '{reg}', {box[0]}, {box[1]}, {box[2]}, {box[3]}, {n}, {w:.1f}, {d:.1f}, {base_m}, {STEP}, {cell}, '{hp}', {hs}, '{mp}', {ms}, "
            f"{sq(more[bid]['trees_path'])}, {sq(more[bid]['trees_bytes'])}, {BINS if more[bid]['trees_path'] else 'null'}, {BIN_M if more[bid]['trees_path'] else 'null'}, "
            + ", ".join(sq(more[bid][k]) for k in ('water_path', 'water_bytes', 'water_n', 'water_north', 'water_south', 'water_west', 'water_east'))
            + f", 'USGS 3DEP lidar {a.project}, ground + buildings per {cell} m cell, tree canopy heights in the mask.')"
            for bid, reg, box, n, w, d, base_m, cell, hp, hs, mp, ms in rows) + "\non conflict (id) do nothing;\n"
    if missing: sql += "\n-- Not covered by the survey, no detail there: " + "; ".join(f"{', '.join(stops)} ({why})" for _, stops, why in missing) + "\n"
    open(f"{a.work}/{a.migration}", 'w').write(sql); open(f"{a.work}/upload.txt", 'w').write("\n".join(uploads) + "\n")
    json.dump([dict(id=bid, parent=reg, north=box[0], south=box[1], west=box[2], east=box[3], n=n, width_m=w, depth_m=d, base_m=base_m, step_m=STEP, cell_m=cell, path=hp, bytes=hs, mask_path=mp, mask_bytes=ms,
                    trees_bins=BINS if more[bid]['trees_path'] else None, trees_bin_m=BIN_M if more[bid]['trees_path'] else None, **more[bid])
               for bid, reg, box, n, w, d, base_m, cell, hp, hs, mp, ms in rows], open(f"{a.work}/detail.json", 'w'), indent=1)   # the rows again, for tests
    print("\nbox | grid | cell | heights KB | mask KB | trees KB | wide water KB | building cells | tree cells | tree slices | water in the box m2 | water in the 6 km ha (still) | no data in the 6 km")
    for bid, n, cell, hs, ms, nb, nt, nw, tot, ex in table:
        print(f"{bid} | {n} x {n} | {cell} m | {hs / 1e3:.0f} | {ms / 1e3:.1f} | {(ex['trees_bytes'] or 0) / 1e3:.0f} | {(ex['water_bytes'] or 0) / 1e3:.1f} | {nb:,} | {nt:,} | {ex['voxels']:,} | {nw * cell * cell:,.0f} | "
              f"{ex['water_wide_m2'] / 1e4:.1f} ({ex['water_still_m2'] / 1e4:.1f}) | {'' if ex['nodata'] is None else format(ex['nodata'], '.1%')}")
    print(f"\nwrote {a.work}/{a.migration} ({len(rows)} boxes) and {a.work}/upload.txt ({len(uploads)} files, {sum(os.path.getsize(p) for p in uploads) / 1e6:.1f} MB)")
    json.dump(pinrep, open(f"{a.work}/pins_report.json", 'w'), indent=1)
    f1 = lambda v: 'none in the box' if v is None else f"{v:.0f} m"
    print("\nstand spots (stop / shot): nearest tree, nearest building; * = canopy over the pin or a building within 5 m (the pin wants moving)")
    for q in pinrep:
        bad = q['canopy_m'] > 0 or (q['building_m'] is not None and q['building_m'] <= 5)
        print(f"  {'*' if bad else ' '} {'; '.join(q['shots'])} ({q['lat']}, {q['lng']}): tree {f1(q['tree_m'])}, building {f1(q['building_m'])}" + (f", canopy {q['canopy_m']:.0f} m over the pin" if q['canopy_m'] > 0 else ''))
    if missing: print("LEFT OUT: " + "; ".join(f"{bid}: {', '.join(stops)} ({why})" for bid, stops, why in missing))
    print("Nothing was uploaded or applied.")

if __name__ == '__main__': main()
