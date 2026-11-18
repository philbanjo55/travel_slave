#!/usr/bin/env python3
"""3D sun view, park-wide buildings (Grand Teton, 14 Nov 2026): every house, barn, cabin and lodge the 2022 laser
survey saw, as walls and a roof the page draws in 3D (the Faroes houses' way, tools/sun3d/app_view.js `bld`), with
REAL eave and ridge heights and the ridge's direction from the survey's own points.

  build_buildings.py scan   <work dir> [--depth 8] [--canopy <canopy.npz>]   read the survey, keep the roof points
  build_buildings.py build  <work dir> [--refine-depth 10]                   footprints, heights, roofs, the files
  build_buildings.py look   <work dir> <lat> <lng> [half m]                  a map of one place, to check by eye

Source: USGS 3DEP lidar WY_GrandTetonNP_1_D22 (2022, public domain) as an Entwine EPT on AWS. Footprints from any
other source were tried and are not reachable from here (OpenStreetMap's Overpass and Microsoft's US footprints are
refused by this environment's proxy), so outside the survey (Wilson, Teton Pines, Emily's Pond, Jackson: south of
43.538 N) there are no buildings.

scan: the survey to octree depth --depth (8 = about one point every 2 m wherever anything came back) over the wide
grid's box; a point is kept when the survey calls it a building (class 6), or when it is unsorted (class 1) or
"vegetation" (3-5), came back alone (a crown lets the laser through and gives several returns, a roof does not) and
stands 2 m or more above the ground (the park-wide trees' ground grid, 7 m cells: tools/sun3d/lidar/build_canopy.py).

build:
  1. the kept points on a 2 m grid (they are ~2 m apart), joined into patches (8 neighbours, after closing 1-cell gaps);
  2. a patch is a building when it has 20 m2 or more, 2.2 m or more above the ground, and either most of its points
     are the survey's class 6, or its points sit on one or two planes (a gable) to within 0.5 m (a tree is ragged);
  3. its points again, deeper in the survey (--refine-depth, default 10: about 0.5 m apart) inside the patch;
  4. footprint: the patch's cells in the frame of its long walls (the direction that fits the most edge cells),
     closed and simplified to straight walls at right angles (a rectangle when that covers 85% of it, else an
     outline of up to 12 corners);
  5. roof: in that frame, a gable along either axis (z = ridge - slope x |distance from the ridge line|) or a flat
     roof, whichever fits better; eave = the gable at the footprint's edge, ridge = its top; a gable whose slope is
     under 8 degrees is flat; low lean-tos come out as their own patch only when the laser saw a step;
  6. tiles: the wide grid's 10 x 10 tiles (as the park-wide trees), one JSON file each:
       { "v": 1, "box": [north, south, west, east], "b": [ {p, g, e, r, a, hw, roof, c, n6, id}, ... ] }
     p = outline, metres east and south of the tile's north-west corner (x, z pairs, 0.1 m), g = the survey's ground
     (m, NAVD88), e / r = eave / ridge above that ground (m), a = the ridge's direction (degrees from east toward
     south, the page's x / z), hw = half the width across the ridge (m), roof = gable | flat, c = the outline's middle,
     n6 = share of class-6 points (how sure), id = a stable number.
Output: <work>/files/gtb_<row>_<col>.json, <work>/buildings.json (all, for checks), <work>/upload.txt,
<work>/tiles.json (rows for the table).
"""
import argparse, concurrent.futures as cf, io, json, math, os, sys, time, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
NORTH, SOUTH, WEST, EAST = 43.95, 43.45, -110.92, -110.24
TR = TC = 10
R = 6378137.0
PROJECT = 'WY_GrandTetonNP_1_D22'
BASE = 'https://usgs-lidar-public.s3.us-west-2.amazonaws.com/' + PROJECT + '/'


def get(u, tries=6):
    err = None
    for i in range(tries):
        try: return urllib.request.urlopen(BASE + u, timeout=120).read()
        except Exception as e: err = e; time.sleep(1 + 2 * i)
    raise err


def merc(lat, lng): return R * math.radians(lng), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
def unmerc(x, y): return np.degrees(np.arctan(np.sinh(y / R))), np.degrees(x / R)


class Hier:
    def __init__(self, cache):
        self.cache = cache; os.makedirs(cache, exist_ok=True)
        e = json.loads(self.cached('ept.json')); self.b = e['bounds']; self.size = self.b[3] - self.b[0]; self.h = {}
    def cached(self, u):
        p = os.path.join(self.cache, u.replace('/', '_'))
        if os.path.exists(p): return open(p, 'rb').read()
        d = get(u); open(p, 'wb').write(d); return d
    def page(self, key):
        if key not in self.h: self.h[key] = json.loads(self.cached(f'ept-hierarchy/{key}.json'))
        return self.h[key]
    def has(self, key):
        """Does this node hold points? Walks its ancestors' hierarchy pages from the root (each page fetched once)."""
        d, x, y, z = map(int, key.split('-')); page = '0-0-0-0'
        for dd in range(d + 1):
            a = f"{dd}-{x >> (d - dd)}-{y >> (d - dd)}-{z >> (d - dd)}"
            v = self.page(page).get(a)
            if v is None: return False
            if v == -1:   # its subtree, itself included, is in a page of its own
                page = a
                if dd == d: return self.page(a).get(a, 0) > 0
            elif dd == d: return v > 0
        return False
    def nodes(self, x0, x1, y0, y1, d0=0, d1=99):
        out = {}; b = self.b; size = self.size
        def load(key):
            if key not in self.h: self.h[key] = json.loads(self.cached(f'ept-hierarchy/{key}.json'))
            for kk, v in self.h[key].items():
                d, x, y, z = map(int, kk.split('-')); s = size / (1 << d)
                if b[0] + x * s > x1 or b[0] + (x + 1) * s < x0 or b[1] + y * s > y1 or b[1] + (y + 1) * s < y0 or d > d1: continue
                if v == -1:
                    if kk != key and d < d1: load(kk)
                elif v > 0 and d >= d0: out[kk] = v
        load('0-0-0-0'); return out


def read_node(key):
    import laspy
    las = laspy.read(io.BytesIO(get(f'ept-data/{key}.laz')))
    return (np.asarray(las.x), np.asarray(las.y), np.asarray(las.z).astype(np.float32), np.asarray(las.classification).astype(np.uint8),
            np.asarray(las.number_of_returns).astype(np.uint8))


class Ground:
    """The park-wide ground (build_canopy.py's grid, 7 m cells over the wide box), bilinear."""
    def __init__(self, path):
        d = np.load(path); self.g = d['ground'].astype(np.float32); self.n = self.g.shape[0]
    def at(self, lat, lng):
        n = self.n; r = ((NORTH - lat) / (NORTH - SOUTH) * n - 0.5).clip(0, n - 1.001); c = ((lng - WEST) / (EAST - WEST) * n - 0.5).clip(0, n - 1.001)
        r0 = r.astype(int); c0 = c.astype(int); fr = r - r0; fc = c - c0; g = self.g
        return (g[r0, c0] * (1 - fc) + g[r0, c0 + 1] * fc) * (1 - fr) + (g[r0 + 1, c0] * (1 - fc) + g[r0 + 1, c0 + 1] * fc) * fr


def scan(a):
    H = Hier(f"{a.work}/hier"); G = Ground(a.canopy)
    x0, y1 = merc(NORTH, WEST); x1, y0 = merc(SOUTH, EAST)
    keys = sorted(H.nodes(x0, x1, y0, y1, 0, a.depth), key=lambda s: int(s.split('-')[0]))
    print(len(keys), 'nodes to depth', a.depth, flush=True)
    out = {k: [] for k in ('lat', 'lng', 'z', 'c', 'one', 'hag')}; total = 0; kept = 0; t0 = time.time()
    def one(k):
        x, y, z, c, nr = read_node(k)
        m = (x >= x0) & (x < x1) & (y >= y0) & (y < y1) & (c != 7) & (c != 18) & (c != 2) & (c != 9)
        x, y, z, c, nr = x[m], y[m], z[m], c[m], nr[m]
        lat, lng = unmerc(x, y); hag = z - G.at(lat, lng)
        keep = hag > 1.8   # every raised return: roofs (class 6, or single returns), and the rest to tell a crown from a roof
        return len(m), lat[keep], lng[keep], z[keep], c[keep], nr[keep] == 1, hag[keep].astype(np.float32)
    with cf.ThreadPoolExecutor(a.threads) as ex:
        for i, (n, la, lo, z, c, one_, hag) in enumerate(ex.map(one, keys)):
            total += n; kept += len(la)
            for k, v in zip(('lat', 'lng', 'z', 'c', 'one', 'hag'), (la, lo, z, c, one_, hag)): out[k].append(v)
            if i % 500 == 0: print(f"  {i} / {len(keys)} nodes, {total:,} points read, {kept:,} kept, {time.time() - t0:.0f} s", flush=True)
    np.savez_compressed(f"{a.work}/scan.npz", **{k: np.concatenate(v) for k, v in out.items()})
    print(f"scan: {total:,} points read, {kept:,} kept, {time.time() - t0:.0f} s", flush=True)


# ---------- footprints ----------
KZ = 111132.0
def kx(lat): return 111320 * math.cos(math.radians(lat))


def label(mask):
    from scipy import ndimage
    return ndimage.label(mask, structure=np.ones((3, 3), bool))


def close1(m):
    from scipy import ndimage
    return ndimage.binary_closing(np.pad(m, 2), structure=np.ones((3, 3), bool))[2:-2, 2:-2] | m


def best_angle(xs, zs):
    """The direction of the long walls: the angle (0-90) at which the points' bounding box is smallest."""
    best = (1e18, 0.0)
    for deg in np.arange(0, 90, 1.0):
        t = math.radians(deg); u = xs * math.cos(t) + zs * math.sin(t); v = -xs * math.sin(t) + zs * math.cos(t)
        area = (u.max() - u.min()) * (v.max() - v.min())
        if area < best[0]: best = (area, deg)
    d0 = best[1]
    for deg in np.arange(d0 - 1, d0 + 1.01, 0.1):   # finer
        t = math.radians(deg); u = xs * math.cos(t) + zs * math.sin(t); v = -xs * math.sin(t) + zs * math.cos(t)
        area = (u.max() - u.min()) * (v.max() - v.min())
        if area < best[0]: best = (area, deg)
    return best[1]


def outline(u, v, cell=1.0):
    """Points in the wall frame -> a closed outline with right-angled corners (list of (u, v)), and its area."""
    u0, v0 = u.min() - 1.5, v.min() - 1.5
    nu, nv = int((u.max() - u0) / cell) + 3, int((v.max() - v0) / cell) + 3
    m = np.zeros((nv, nu), bool); m[((v - v0) / cell).astype(int), ((u - u0) / cell).astype(int)] = True
    from scipy import ndimage
    m = ndimage.binary_closing(m, structure=np.ones((3, 3), bool), iterations=2)
    m = ndimage.binary_fill_holes(m)
    m = ndimage.binary_opening(m, structure=np.ones((2, 2), bool)) | (m & ndimage.binary_erosion(m))
    lab, k = ndimage.label(m)
    if k > 1:
        sizes = ndimage.sum(m, lab, range(1, k + 1)); m = lab == (1 + int(np.argmax(sizes)))
    area = float(m.sum()) * cell * cell
    rows = np.where(m.any(1))[0]; cols = np.where(m.any(0))[0]
    if not len(rows): return None, 0, None
    r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    rect = [(u0 + c0 * cell, v0 + r0 * cell), (u0 + c1 * cell, v0 + r0 * cell), (u0 + c1 * cell, v0 + r1 * cell), (u0 + c0 * cell, v0 + r1 * cell)]
    fill = area / ((r1 - r0) * (c1 - c0) * cell * cell)
    if fill >= 0.85: return rect, area, m
    # a right-angled outline: walk the boundary of the cell mask, then drop the steps shorter than 2 cells
    pts = trace(m[r0:r1, c0:c1])
    pts = [(u0 + (c0 + x) * cell, v0 + (r0 + y) * cell) for x, y in pts]
    pts = simplify_ortho(pts, 1.6 * cell)
    if len(pts) < 4 or len(pts) > 12 or not outline_ok(pts, area): return rect, area, m
    return pts, area, m


def outline_ok(pts, area):
    """A usable outline: does not cross itself and covers roughly the cells it came from (65-140 %)."""
    n = len(pts); s = 0.0
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]; s += x1 * y2 - x2 * y1
    if not (0.65 * area <= abs(s) / 2 <= 1.4 * area): return False
    def cr(a, b, c): return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1: continue
            a, b = pts[i], pts[(i + 1) % n]; c, d = pts[j], pts[(j + 1) % n]
            if cr(a, b, c) * cr(a, b, d) < 0 and cr(c, d, a) * cr(c, d, b) < 0: return False
    return True


def trace(m):
    """The outer boundary of a solid cell mask as corner points (x = column edge, y = row edge), clockwise."""
    h, w = m.shape; p = np.zeros((h + 2, w + 2), bool); p[1:-1, 1:-1] = m
    edges = {}
    for y in range(h + 2):
        for x in range(w + 2):
            if not p[y, x]: continue
            if not p[y - 1, x]: edges[(x - 1, y - 1)] = (x, y - 1)
            if not p[y, x + 1]: edges[(x, y - 1)] = (x, y)
            if not p[y + 1, x]: edges[(x, y)] = (x - 1, y)
            if not p[y, x - 1]: edges[(x - 1, y)] = (x - 1, y - 1)
    if not edges: return []
    start = min(edges); out = [start]; cur = edges[start]; seen = 0
    while cur != start and seen < 100000: out.append(cur); cur = edges.get(cur, start); seen += 1
    corners = [out[i] for i in range(len(out)) if (out[i - 1][0] == out[i][0]) != (out[i][0] == out[(i + 1) % len(out)][0])]
    return corners


def simplify_ortho(pts, tol):
    """Drop small steps: while some edge is shorter than tol, remove it by moving its neighbours (keeps right angles)."""
    pts = [list(p) for p in pts]
    for _ in range(200):
        n = len(pts)
        if n <= 4: break
        L = [math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]) for i in range(n)]
        i = int(np.argmin(L))
        if L[i] >= tol: break
        a, b = pts[i], pts[(i + 1) % n]; pa, nb = pts[i - 1], pts[(i + 2) % n]
        horiz = abs(a[1] - b[1]) < 1e-6
        # the short edge collapses onto its middle: its two neighbours (the walls at its ends, which run across it)
        # slide along it to meet there. A horizontal short edge is closed by moving the neighbours' x, a vertical one
        # by their y (14 Nov 2026: this was the other way round, which bent the outline: 2,146 of 9,895 Teton
        # buildings came out as slivers or crossed shapes, among them the Chapel of the Transfiguration).
        if horiz: mid = (a[0] + b[0]) / 2; pa[0] = mid; nb[0] = mid
        else: mid = (a[1] + b[1]) / 2; pa[1] = mid; nb[1] = mid
        for j in sorted([i, (i + 1) % n], reverse=True): pts.pop(j)
        # drop corners that became straight
        k = 0
        while k < len(pts) and len(pts) > 4:
            p0, p1, p2 = pts[k - 1], pts[k], pts[(k + 1) % len(pts)]
            if (abs(p0[0] - p1[0]) < 1e-6 and abs(p1[0] - p2[0]) < 1e-6) or (abs(p0[1] - p1[1]) < 1e-6 and abs(p1[1] - p2[1]) < 1e-6): pts.pop(k)
            else: k += 1
    return [tuple(p) for p in pts]


def fit_roof(u, v, h, ub, vb):
    """Heights above ground h at (u, v) in the wall frame; ub / vb = footprint extents. Returns the best roof."""
    best = None
    flat_r = float(np.percentile(h, 60)); res = float(np.median(np.abs(h - flat_r)))
    best = dict(roof='flat', e=flat_r, r=flat_r, axis=0, res=res, pitch=0.0)
    for axis in (0, 1):   # ridge along u (axis 0) or along v (axis 1)
        across = v if axis == 0 else u; lo, hi = (vb if axis == 0 else ub)
        for c in np.linspace(lo + 0.3 * (hi - lo), hi - 0.3 * (hi - lo), 9):
            d = np.abs(across - c); A = np.c_[np.ones_like(d), -d]
            try: coef, *_ = np.linalg.lstsq(A, h, rcond=None)
            except Exception: continue
            top, slope = coef
            if slope <= 0: continue
            r = float(np.median(np.abs(h - A @ coef)))
            if r < best['res'] - 0.05:
                hw = max(c - lo, hi - c); e = top - slope * hw
                best = dict(roof='gable', e=float(e), r=float(top), axis=axis, res=r, pitch=math.degrees(math.atan(slope)), c=float(c), hw=float(hw))
    if best['roof'] == 'gable' and (best['pitch'] < 8 or best['e'] < 1.5):
        best = dict(roof='flat', e=flat_r, r=flat_r, axis=0, res=res, pitch=0.0)
    return best


def build(a):
    S = np.load(f"{a.work}/scan.npz"); lat, lng, z, c, one, hag = (S[k] for k in ('lat', 'lng', 'z', 'c', 'one', 'hag'))
    print(f"{len(lat):,} raised points", flush=True)
    # 1. roof-like points (class 6, or a pulse that came back once) on a 2 m grid (depth 8 = ~2 m apart), in strips of the
    #    wide box, joined into patches (8 neighbours after closing 1-cell gaps). Every raised point in a patch's cells
    #    counts for its share of pulses that gave several returns: a crown lets the laser through, a roof does not
    #    (measured at 0.5 m in the detail boxes: roofs 0-15 %, tree tops 75-90 %).
    lat0 = (NORTH + SOUTH) / 2; KX0 = kx(lat0)
    X = (lng - WEST) * KX0; Z = (NORTH - lat) * KZ
    D = int((NORTH - SOUTH) * KZ) + 2
    STRIP = 4000; GRID = 2.0; found = []
    order = np.argsort(Z); X, Z, z, c, one, hag, lat, lng = X[order], Z[order], z[order], c[order], one[order], hag[order], lat[order], lng[order]
    roofy = (c == 6) | one
    for s0 in range(0, D, STRIP - 200):
        s1 = min(D, s0 + STRIP); i0, i1 = np.searchsorted(Z, s0), np.searchsorted(Z, s1)
        if i1 - i0 < 10: continue
        xs, zs, rf = X[i0:i1], Z[i0:i1] - s0, roofy[i0:i1]
        cmin = int(xs.min()) - 4; cols = int((xs.max() - cmin) / GRID) + 4
        ri, ci = (zs / GRID).astype(int), ((xs - cmin) / GRID).astype(int)
        m = np.zeros((int((s1 - s0) / GRID) + 2, cols), bool); m[ri[rf], ci[rf]] = True
        m = close1(m); lab, k = label(m)
        idx = lab[ri, ci]
        o = np.argsort(idx, kind='stable'); idx_s = idx[o]; starts = np.searchsorted(idx_s, np.arange(1, k + 2))
        for j in range(k):
            sel = o[starts[j]:starts[j + 1]] + i0
            if len(sel) < 4: continue
            zc = Z[sel].mean()
            if not (s0 + (100 if s0 else 0) <= zc < s1 - (100 if s1 < D else 0)): continue   # each patch once: in the strip that holds its middle
            found.append(sel)
    print(f"{len(found):,} patches", flush=True)
    G = Ground(a.canopy) if a.canopy else None
    blds = []; n_try = 0; why = {}
    def no(w): why[w] = why.get(w, 0) + 1
    for sel_all in found:
        multi = float(1 - one[sel_all].mean())
        sel = sel_all[roofy[sel_all]]
        if len(sel) < 5:   # a small roof seen by only a few points at depth 8 (a cabin): judged again on the deeper points
            if a.refine_depth > a.depth and len(sel) >= 2 and multi <= a.max_multi and np.percentile(hag[sel], 90) >= 2.2:
                blds.append(dict(sel=sel, ang=0.0, n6=float((c[sel] == 6).mean()), multi=multi, roof=None, h8=hag[sel], small=True)); no('few points: deeper look')
            else: no('few points')
            continue
        xs, zs = X[sel], Z[sel]; h = hag[sel]; cc = c[sel]
        n6 = float((cc == 6).mean())
        ang = best_angle(xs, zs); t = math.radians(ang)
        u = xs * math.cos(t) + zs * math.sin(t); v = -xs * math.sin(t) + zs * math.cos(t)
        area_box = (u.max() - u.min() + 2) * (v.max() - v.min() + 2)
        if area_box < 20: no('small'); continue
        if np.percentile(h, 90) < 2.2: no('low'); continue
        if area_box > 25000: no('huge'); continue
        n_try += 1
        if n6 < 0.5:   # the survey did not sort it: a roof only if solid (one return a pulse) and smooth (planes)
            if multi > a.max_multi: no('lets the laser through (a tree)'); continue
            if area_box < 25: no('small unsorted (a vehicle?)'); continue
        roof = fit_roof(u, v, h, (u.min(), u.max()), (v.min(), v.max()))
        if n6 < 0.5 and roof['res'] > 0.4: no('ragged (a tree?)'); continue
        blds.append(dict(sel=sel, ang=ang, n6=n6, multi=multi, roof=roof, h8=h))
    print(f"{len(blds):,} buildings from {n_try:,} candidates; left out: {why}", flush=True)
    # 2. deeper points inside each building (refine), then the final outline and roof
    if a.refine_depth > a.depth and a.pins:   # the deeper look only within --refine-km of a stand pin (what a view draws large); farther off the depth-8 shapes stay and the small doubtful ones go
        P = json.load(open(a.pins)); pins = [((p['v']['lng'] - WEST) * KX0, (NORTH - p['v']['lat']) * KZ) for p in P] if isinstance(P, list) else [((s['vlng'] - WEST) * KX0, (NORTH - s['vlat']) * KZ) for s in P['shots']]
        PX, PZ = np.array([q[0] for q in pins]), np.array([q[1] for q in pins]); R2 = (a.refine_km * 1000) ** 2
        near = [b for b in blds if (((PX - X[b['sel']].mean()) ** 2 + (PZ - Z[b['sel']].mean()) ** 2) <= R2).any()]
        print(f"refine: {len(near):,} of {len(blds):,} within {a.refine_km} km of a stand pin", flush=True)
        ids = {id(b) for b in near}; blds = near + [b for b in blds if not b.get('small') and id(b) not in ids]
        refine(a, near, X, Z, lat, lng, KX0, G)
    elif a.refine_depth > a.depth: refine(a, blds, X, Z, lat, lng, KX0, G)
    work = []   # per building: its roof-like points (park metres x / z, height over the ground), cell size, wall angle, how sure
    for i, b in enumerate(blds):
        if b.get('drop'): continue
        if b.get('rx') is not None and len(b['rx']) >= 8:
            # the deeper points: roof-like ones (the building class, or one return a pulse) on 1 m cells, and the share of
            # pulses with several returns among every raised point in those cells (a crown over the house counts against it)
            rf = b['r6'] | b['rone']
            if rf.sum() < 6: continue
            xa, za = b['rx'], b['rz']; key_all = (np.floor(xa).astype(np.int64) << 32) + np.floor(za).astype(np.int64)
            cells_r = np.unique(key_all[rf]); inc = np.isin(key_all, cells_r)
            multi = float(1 - b['rone'][inc].mean()); n6 = float(b['r6'][rf].mean()); b['n6'] = max(b['n6'], n6); b['multi'] = multi
            if n6 < 0.5 and multi > a.max_multi: continue
            work.append(dict(i=i, x=xa[rf].astype(np.float32), z=za[rf].astype(np.float32), h=b['rh'][rf].astype(np.float32), cell=1.0, ang=None, n6=b['n6'], multi=multi))
        elif b.get('small'): continue
        else: work.append(dict(i=i, x=X[b['sel']].astype(np.float32), z=Z[b['sel']].astype(np.float32), h=hag[b['sel']].astype(np.float32), cell=2.0, ang=b['ang'], n6=b['n6'], multi=b['multi']))
    import pickle
    pickle.dump(dict(work=work, KX0=KX0), open(f"{a.work}/final_in.pkl", 'wb'))
    final(a, work, KX0, G)


def parts(u, v, h, cell, sure):
    """One building's roof-like points in its wall frame -> its parts [(outline, area, roof)]: one, or (a barn with a tall
    middle and low sheds either side, a house with a lower wing) the whole footprint with the low roof plus the tall part
    with its own, when the heights fall in two levels at least 1.5 m apart and the tall part is 20-85 % of the whole."""
    pts, area, _ = outline(u, v, cell)
    if pts is None or area < 20: return []
    pu = np.array([p[0] for p in pts]); pv = np.array([p[1] for p in pts])
    roof = fit_roof(u, v, h, (pu.min(), pu.max()), (pv.min(), pv.max()))
    out = [(pts, area, roof)]
    if cell <= 1.0 and len(h) >= 40:
        lo_h, hi_h = np.percentile(h, 25), np.percentile(h, 95); t = (lo_h + hi_h) / 2
        hi = h > t
        if hi.sum() >= 15 and (~hi).sum() >= 15 and np.median(h[hi]) - np.median(h[~hi]) >= 1.5:
            p2, a2, _ = outline(u[hi], v[hi], cell)
            if p2 is not None and 0.2 * area <= a2 <= 0.85 * area and a2 >= 15:
                qu = np.array([p[0] for p in p2]); qv = np.array([p[1] for p in p2])
                r_hi = fit_roof(u[hi], v[hi], h[hi], (qu.min(), qu.max()), (qv.min(), qv.max()))
                r_lo = fit_roof(u[~hi], v[~hi], h[~hi], (pu.min(), pu.max()), (pv.min(), pv.max()))
                if r_hi['r'] > r_lo['r'] + 1.0: out = [(pts, area, r_lo), (p2, a2, r_hi)]
    return out


def final(a, work, KX0, G):
    tiles = {}; n2 = 0
    for w in work:
        i, xs, zs, h, cell = w['i'], w['x'].astype(np.float64), w['z'].astype(np.float64), w['h'].astype(np.float64), w['cell']
        ang = w['ang'] if w['ang'] is not None else best_angle(xs, zs)
        t = math.radians(ang); u = xs * math.cos(t) + zs * math.sin(t); v = -xs * math.sin(t) + zs * math.cos(t)
        ps = parts(u, v, h, cell, w['n6'])
        if not ps: continue
        if w['n6'] < 0.5 and ps[0][2]['res'] > 0.45 and len(ps) == 1: continue
        if max(p[2]['r'] for p in ps) < 2.2: continue
        if len(ps) == 2: n2 += 1
        for k, (pts, area, roof) in enumerate(ps):
            pu = np.array([p[0] for p in pts]); pv = np.array([p[1] for p in pts])
            # back to the park's metres, then the tile's (a building's parts go to the tile of its whole footprint)
            PX = pu * math.cos(t) - pv * math.sin(t); PZ = pu * math.sin(t) + pv * math.cos(t)
            if k == 0:
                cx, cz = float(PX.mean()), float(PZ.mean())
                clat, clng = NORTH - cz / KZ, WEST + cx / KX0
                tr, tc = int((NORTH - clat) / (NORTH - SOUTH) * TR), int((clng - WEST) / (EAST - WEST) * TC)
                if not (0 <= tr < TR and 0 <= tc < TC): break
                tn, ts, tw, te = tile_box(tr, tc); kxt = kx((tn + ts) / 2)
                g = float(G.at(np.array([clat]), np.array([clng]))[0]) if G else 0.0
            plat = NORTH - PZ / KZ; plng = WEST + PX / KX0
            ox = (plng - tw) * kxt; oz = (tn - plat) * KZ
            if roof['roof'] == 'gable':
                ridge_deg = ang + (0 if roof['axis'] == 0 else 90)   # the ridge runs along u (axis 0) or v
                if roof['axis'] == 0: rc_u, rc_v = (pu.min() + pu.max()) / 2, roof['c']
                else: rc_u, rc_v = roof['c'], (pv.min() + pv.max()) / 2
                rx = rc_u * math.cos(t) - rc_v * math.sin(t); rz = rc_u * math.sin(t) + rc_v * math.cos(t)
                rlat, rlng = NORTH - rz / KZ, WEST + rx / KX0; cxy = [(rlng - tw) * kxt, (tn - rlat) * KZ]
            else: ridge_deg = ang; cxy = [float(ox.mean()), float(oz.mean())]
            rec = dict(p=[round(float(q), 1) for xy in zip(ox, oz) for q in xy], g=round(g, 1), e=round(max(1.8, roof['e']), 1), r=round(max(roof['r'], roof['e']), 1),
                       a=round(ridge_deg % 180, 1), hw=round(roof.get('hw', 0.0), 1), roof=roof['roof'], c=[round(cxy[0], 1), round(cxy[1], 1)], n6=round(w['n6'], 2), id=i * 4 + k,
                       part=k, lat=round(float(plat.mean()), 6), lng=round(float(plng.mean()), 6), area=round(area, 1), pitch=round(roof['pitch'], 1), res=round(roof['res'], 2), multi=round(w['multi'], 2))
            tiles.setdefault((tr, tc), []).append(rec)
    print(f"{n2:,} buildings drawn in two parts (a tall middle or wing)", flush=True)
    F = f"{a.work}/files"; os.makedirs(F, exist_ok=True); rows = []; allb = []
    for (tr, tc), L in sorted(tiles.items()):
        tn, ts, tw, te = tile_box(tr, tc)
        out = dict(v=1, box=[tn, ts, tw, te], b=[{k: r[k] for k in ('p', 'g', 'e', 'r', 'a', 'hw', 'roof', 'c', 'n6', 'id', 'part')} for r in L])
        path = f"{F}/gtb_{tr}_{tc}.json"; open(path, 'w').write(json.dumps(out, separators=(',', ':')))
        rows.append(dict(id=f"gtb_{tr}_{tc}", parent='grand_teton', north=tn, south=ts, west=tw, east=te, path=os.path.basename(path), bytes=os.path.getsize(path), count=len(L)))
        allb += L
    json.dump(rows, open(f"{a.work}/tiles.json", 'w'), indent=1)
    json.dump(allb, open(f"{a.work}/buildings.json", 'w'))
    print(f"{len(allb):,} buildings in {len(rows)} tiles, {sum(r['bytes'] for r in rows) / 1e3:.0f} KB; gable {sum(1 for b in allb if b['roof'] == 'gable'):,}", flush=True)


def tile_box(tr, tc):
    dlat, dlng = (NORTH - SOUTH) / TR, (EAST - WEST) / TC
    return (round(NORTH - tr * dlat, 6), round(NORTH - (tr + 1) * dlat, 6), round(WEST + tc * dlng, 6), round(WEST + (tc + 1) * dlng, 6))


def refine(a, blds, X, Z, lat, lng, KX0, G):
    """Every building's points again from the deeper octree levels (to --refine-depth), inside its box + 1 m."""
    H = Hier(f"{a.work}/hier"); boxes = []
    for b in blds:
        xs, zs = X[b['sel']], Z[b['sel']]
        b['bx'] = (xs.min() - 2.5, xs.max() + 2.5, zs.min() - 2.5, zs.max() + 2.5)
    # the deeper nodes that touch any building, each read once: each building's node keys by their index (x, y from its
    # box, z from its heights), kept when the survey's hierarchy has them (only the pages on their way are fetched)
    bb, size = H.b, H.size; want = {}; seen = {}
    for i, b in enumerate(blds):
        bx0, bx1, bz0, bz1 = b['bx']
        la1, la0 = NORTH - bz0 / KZ, NORTH - bz1 / KZ; lo0, lo1 = WEST + bx0 / KX0, WEST + bx1 / KX0
        mx0, my1 = merc(la1, lo0); mx1, my0 = merc(la0, lo1)
        g = float(G.at(np.array([(la0 + la1) / 2]), np.array([(lo0 + lo1) / 2]))[0]); zlo, zhi = g - 5, g + 40
        for d in range(9, a.refine_depth + 1):
            sz = size / (1 << d)
            for xi in range(int((mx0 - bb[0]) // sz), int((mx1 - bb[0]) // sz) + 1):
                for yi in range(int((my0 - bb[1]) // sz), int((my1 - bb[1]) // sz) + 1):
                    for zi in range(int((zlo - bb[2]) // sz), int((zhi - bb[2]) // sz) + 1):
                        k = f"{d}-{xi}-{yi}-{zi}"
                        if k not in seen: seen[k] = H.has(k)
                        if seen[k]: want.setdefault(k, []).append(i)
        if i % 2000 == 0: print(f"  node lookup {i} / {len(blds)}: {len(want):,} nodes, {len(H.h):,} hierarchy pages", flush=True)
    print(f"refine: {len(want):,} deeper nodes for {len(blds):,} buildings", flush=True)
    pts = {i: [] for i in range(len(blds))}; t0 = time.time()
    def one(k):
        x, y, zz, cc, nr = read_node(k)
        m = (cc != 7) & (cc != 18) & (cc != 2) & (cc != 9)
        x, y, zz, cc, nr = x[m], y[m], zz[m], cc[m], nr[m]
        la, lo = unmerc(x, y); px = (lo - WEST) * KX0; pz = (NORTH - la) * KZ
        res = []
        for i in want[k]:
            x0, x1, z0, z1 = blds[i]['bx']; s = (px >= x0) & (px < x1) & (pz >= z0) & (pz < z1)
            if s.any():
                hg = zz[s] - G.at(la[s], lo[s]); keep = hg > 1.8
                res.append((i, px[s][keep], pz[s][keep], hg[keep], (nr[s] == 1)[keep], (cc[s] == 6)[keep]))
        return res
    done = 0
    with cf.ThreadPoolExecutor(a.threads) as ex:
        for res in ex.map(one, list(want)):
            for i, *rest in res: pts[i].append(rest)
            done += 1
            if done % 500 == 0: print(f"  {done} / {len(want)} nodes, {time.time() - t0:.0f} s", flush=True)
    for i, b in enumerate(blds):
        if pts[i]:   # the deeper points (every raised one, with: came back alone, the survey's building class)
            b['rx'], b['rz'], b['rh'], b['rone'], b['r6'] = (np.concatenate([p[k] for p in pts[i]]) for k in range(5))
    print(f"refine done, {time.time() - t0:.0f} s", flush=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('cmd', choices=['scan', 'build', 'final']); ap.add_argument('work')
    ap.add_argument('--depth', type=int, default=8); ap.add_argument('--refine-depth', type=int, default=10)
    ap.add_argument('--canopy', help="build_canopy.py's canopy.npz (its ground grid)"); ap.add_argument('--threads', type=int, default=6)
    ap.add_argument('--pins', help='shots json (rv_jobs.json list with v, or pins.json with shots): refine only near these stand pins'); ap.add_argument('--refine-km', type=float, default=5.0)
    ap.add_argument('--max-multi', type=float, default=0.35, help='an unsorted patch is a roof only when at most this share of its pulses gave several returns')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    if a.cmd == 'final':   # the last stage again from build's saved points (footprints, roofs, files): seconds, not half an hour
        import pickle; d = pickle.load(open(f"{a.work}/final_in.pkl", 'rb')); final(a, d['work'], d['KX0'], Ground(a.canopy) if a.canopy else None); return
    {'scan': scan, 'build': build}[a.cmd](a)


if __name__ == '__main__':
    main()
