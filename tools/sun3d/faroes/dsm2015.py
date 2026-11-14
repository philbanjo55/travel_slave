#!/usr/bin/env python3
"""The Faroese Environment Agency's 2015 surface model (DSM) as the Faroes' height source for the 3D sun view.

Shared pieces for build_faroes_2015.py (which writes the files): reading the 9 GB GeoTIFF a tile at a time, the agency's
coastline / lakes / building outlines / 2009 contour lines, the land-hole fill, the bare ground (houses taken out),
and resampling onto the app's lat / lng grids without shaving thin tops (sea stacks, pinnacles, summits).

Source: FO_DSM_2015_FOTM_2M.tif (Umhvørvisstovan, DSM 2015, 2 m, float32, ETRS89 / Faroe TM = EPSG:5316, pixel is area,
nodata 3.4e38 = sea), from cdn.foroyakort.fo/geodata/raster/ (downloaded by hand: the site turns plain scripted requests
away). Give its path with --dsm or FO_DSM. Credit: Data from the Faroese Environment Agency, Umhvørvisstovan (DSM 2015).
"""
import json, math, os, sys
from collections import OrderedDict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))

DSM_CREDIT = 'Data from the Faroese Environment Agency, Umhvørvisstovan (DSM 2015)'
KZ = 111132.0


class DSM:
    """The DSM, a 128 x 128 tile at a time (decoded on demand, the last few thousand kept). Row 0 = north."""
    def __init__(self, path=None, keep=6000):
        import tifffile
        self.path = path or os.environ.get('FO_DSM')
        assert self.path and os.path.exists(self.path), 'give the 2015 DSM GeoTIFF with --dsm or FO_DSM'
        self.tf = tifffile.TiffFile(self.path); p = self.p = self.tf.pages[0]
        self.H, self.W = p.shape; self.TW, self.TL = p.tilewidth, p.tilelength; self.NTX = -(-self.W // self.TW); self.NTY = -(-self.H // self.TL)
        sx, sy, _ = p.tags['ModelPixelScaleTag'].value; tp = p.tags['ModelTiepointTag'].value
        assert abs(sx - 2.0) < 1e-9 and abs(sy - 2.0) < 1e-9 and tp[0] == 0 and tp[1] == 0, 'expected the 2 m file, pixel is area'
        self.X0, self.Y0, self.PX = tp[3], tp[4], sx
        self.fh = self.tf.filehandle; self.cache = OrderedDict(); self.keep = keep
        from pyproj import Transformer
        self._fwd = Transformer.from_crs(4326, 5316, always_xy=True); self._inv = Transformer.from_crs(5316, 4326, always_xy=True)

    def xy(self, lat, lng):
        """lat / lng -> Faroe TM x (east), y (north)."""
        return self._fwd.transform(lng, lat)

    def ll(self, x, y):
        lng, lat = self._inv.transform(x, y); return lat, lng

    def tile(self, r, c):
        k = (r, c)
        if k in self.cache: self.cache.move_to_end(k); return self.cache[k]
        if not (0 <= r < self.NTY and 0 <= c < self.NTX): a = np.full((self.TL, self.TW), np.nan, np.float32)
        else:
            i = r * self.NTX + c; off, n = self.p.dataoffsets[i], self.p.databytecounts[i]
            if n == 0: a = np.full((self.TL, self.TW), np.nan, np.float32)
            else:
                self.fh.seek(off); data, *_ = self.p.decode(self.fh.read(n), i)
                a = np.asarray(data).reshape(self.TL, self.TW).astype(np.float32); a[~(a < 1e30)] = np.nan
        self.cache[k] = a
        if len(self.cache) > self.keep: self.cache.popitem(last=False)
        return a

    def read(self, c0, r0, w, h):
        """Native cells [r0, r0 + h) x [c0, c0 + w); NaN = sea (nodata) or outside the file."""
        out = np.full((h, w), np.nan, np.float32); TL, TW = self.TL, self.TW
        for tr in range(r0 // TL, (r0 + h - 1) // TL + 1):
            for tc in range(c0 // TW, (c0 + w - 1) // TW + 1):
                R0, C0 = tr * TL, tc * TW
                ys, ye = max(r0, R0), min(r0 + h, R0 + TL); xs, xe = max(c0, C0), min(c0 + w, C0 + TW)
                if ys < ye and xs < xe: out[ys - r0:ye - r0, xs - c0:xe - c0] = self.tile(tr, tc)[ys - R0:ye - R0, xs - C0:xe - C0]
        return out

    def cells(self, x0, x1, y0, y1, pad=0.0):
        """The native window covering a TM box (+ pad m): (c0, r0, w, h)."""
        c0 = int(math.floor((x0 - pad - self.X0) / self.PX)); c1 = int(math.ceil((x1 + pad - self.X0) / self.PX))
        r0 = int(math.floor((self.Y0 - (y1 + pad)) / self.PX)); r1 = int(math.ceil((self.Y0 - (y0 - pad)) / self.PX))
        return c0, r0, c1 - c0, r1 - r0

    def centre(self, c0, r0, w, h):
        """TM coordinates of the cell centres of a native window: X (w,), Y (h,)."""
        return self.X0 + (c0 + np.arange(w) + 0.5) * self.PX, self.Y0 - (r0 + np.arange(h) + 0.5) * self.PX


# ---------- polygons and lines on a native window ----------
def rings_to_tm(dsm, rings):
    out = []
    for r in rings:
        a = np.asarray(r, float)[:, :2]; x, y = dsm._fwd.transform(a[:, 0], a[:, 1]); out.append(np.c_[x, y])
    return out

def draw_polys(dsm, win, polys, ss=1, value=255):
    """Polygons (each a list of rings in TM, ArcGIS orientation: outer clockwise) on a native window -> bool (or share with ss > 1)."""
    from PIL import Image, ImageDraw
    c0, r0, w, h = win; im = Image.new('L', (w * ss, h * ss), 0); dr = ImageDraw.Draw(im)
    def area(r): return float(np.sum(r[:, 0] * np.roll(r[:, 1], -1) - np.roll(r[:, 0], -1) * r[:, 1]))
    x_lo, x_hi = dsm.X0 + c0 * dsm.PX, dsm.X0 + (c0 + w) * dsm.PX; y_hi, y_lo = dsm.Y0 - r0 * dsm.PX, dsm.Y0 - (r0 + h) * dsm.PX
    for rings in polys:
        for r in sorted(rings, key=lambda r: -abs(area(r))):
            if len(r) < 3 or r[:, 0].max() < x_lo or r[:, 0].min() > x_hi or r[:, 1].max() < y_lo or r[:, 1].min() > y_hi: continue
            pts = [((x - x_lo) / dsm.PX * ss, (y_hi - y) / dsm.PX * ss) for x, y in r]
            dr.polygon(pts, fill=value if area(r) <= 0 else 0)
    a = np.asarray(im, np.float32) / 255.0
    return a.reshape(h, ss, w, ss).mean((1, 3)) if ss > 1 else a > 0.5


# ---------- the agency's layers, whole islands, cached ----------
class Layers:
    """Coastline (islands + skerries), lakes, building outlines; everything kept in TM once fetched."""
    def __init__(self, ag, dsm, work):
        self.ag, self.dsm, self.work = ag, dsm, work; self._coast = self._lakes = self._blds = None

    def coast(self):
        if self._coast is None:
            f1 = self.ag.features('lendiskort/us_lendiskort/MapServer/15', fields='name,feature_type')
            f2 = self.ag.features('topo/topo_20/MapServer/142', fields='OBJECTID')
            self._coast = [rings_to_tm(self.dsm, f['geometry']['rings']) for f in f1 + f2 if f.get('geometry', {}).get('rings')]
            self._coast_bb = np.array([[min(r[:, 0].min() for r in p), max(r[:, 0].max() for r in p), min(r[:, 1].min() for r in p), max(r[:, 1].max() for r in p)] for p in self._coast])
        return self._coast

    def lakes(self):
        if self._lakes is None:
            fs = self.ag.features('topo/topo_20/MapServer/120') + self.ag.features('topo/topo_20/MapServer/119')
            self._lakes = [dict(rings=rings_to_tm(self.dsm, f['geometry']['rings']), name=f['attributes'].get('NAM') or f['attributes'].get('name')) for f in fs if f.get('geometry', {}).get('rings')]
            for l in self._lakes: l['bb'] = [min(r[:, 0].min() for r in l['rings']), max(r[:, 0].max() for r in l['rings']), min(r[:, 1].min() for r in l['rings']), max(r[:, 1].max() for r in l['rings'])]
        return self._lakes

    def buildings(self):
        """Every building outline (layer 0, and the sketched ones of layer 1), with its attributes, in TM."""
        if self._blds is None:
            out = []
            for lay, sk in ((0, False), (1, True)):
                for f in self.ag.features(f'bygningar/us_bygningar/FeatureServer/{lay}', fields='OBJECTID,building_id,name,status,building_type,primary_purpose,construction_year,building_area', z=True):
                    if not f.get('geometry', {}).get('rings') or f['attributes'].get('status') not in (None, 1): continue
                    rings = rings_to_tm(self.dsm, [[p[:2] for p in r] for r in f['geometry']['rings']])
                    zs = [p[2] for r in f['geometry']['rings'] for p in r if len(p) > 2 and p[2] is not None]
                    out.append(dict(rings=rings, sketched=sk, a=f['attributes'], foot_z=float(np.median(zs)) if zs else None,
                                    bb=[min(r[:, 0].min() for r in rings), max(r[:, 0].max() for r in rings), min(r[:, 1].min() for r in rings), max(r[:, 1].max() for r in rings)]))
            self._blds = out; self._bbb = np.array([b['bb'] for b in out])
        return self._blds

    def in_box(self, kind, x0, x1, y0, y1):
        if kind == 'coast': items, bb = self.coast(), self._coast_bb
        elif kind == 'lakes': items = self.lakes(); bb = np.array([l['bb'] for l in items])
        else: items, bb = self.buildings(), self._bbb
        m = (bb[:, 1] >= x0) & (bb[:, 0] <= x1) & (bb[:, 3] >= y0) & (bb[:, 2] <= y1)
        return [items[i] for i in np.nonzero(m)[0]]


# ---------- the agency's 2009 contour lines (a check, and the filler of land holes; never ArcticDEM) ----------
CONTOURS = 'https://gis.us.fo/arcgis/rest/services/haeddarkurvar/us_haeddarkurvar_2009_2m/MapServer'

class Contours:
    """Layer 0 = 10 m lines (all of them, fetched once and kept as <cache>/contours10.npz), layer 4 = 2 m lines (fetched per
    box). Points along every line in TM metres with their elevation; looked up by 500 m buckets."""
    def __init__(self, ag, cache):
        self.ag, self.cache = ag, cache; self._10 = None; self._2 = {}

    def _fetch_all(self, layer):
        ids = self.ag.get(f"{CONTOURS}/{layer}/query", dict(where='1=1', returnIdsOnly='true', f='json'))['objectIds']; ids.sort()
        X, Y, Z = [], [], []
        for i in range(0, len(ids), 400):
            d = self.ag.get(f"{CONTOURS}/{layer}/query", dict(where=f"OBJECTID>={ids[i]} AND OBJECTID<={ids[min(i + 399, len(ids) - 1)]}", outFields='elevation', outSR=5316, f='json', geometryPrecision=1))
            for f in d.get('features', []):
                for p in f['geometry'].get('paths', []):
                    a = np.asarray(p, float)[:, :2]; a = densify(a, 4.0); X.append(a[:, 0]); Y.append(a[:, 1]); Z.append(np.full(len(a), f['attributes']['elevation'], np.float32))
        return np.concatenate(X), np.concatenate(Y), np.concatenate(Z)

    def ten(self):
        if self._10 is None:
            p = f"{self.cache}/contours10.npz"
            if not os.path.exists(p):
                X, Y, Z = self._fetch_all(0); np.savez_compressed(p, x=X.astype(np.float64), y=Y.astype(np.float64), z=Z)
            d = np.load(p); self._10 = Bucket(d['x'], d['y'], d['z'])
        return self._10

    def two(self, x0, x1, y0, y1):
        """The 2 m lines crossing a TM box (whole lines, cut to the box + 50 m), as points every 2 m."""
        key = tuple(int(round(v)) for v in (x0, x1, y0, y1))
        if key in self._2: return self._2[key]
        X, Y, Z = [], [], []
        env = dict(geometry=f"{x0},{y0},{x1},{y1}", geometryType='esriGeometryEnvelope', inSR=5316, spatialRel='esriSpatialRelIntersects')
        ids = sorted(self.ag.get(f"{CONTOURS}/4/query", dict(where='1=1', returnIdsOnly='true', f='json', **env)).get('objectIds') or [])
        def get(batch):   # the server fails on some batches (a very long line): halve until it answers; one line it cannot give is left out
            try: return self.ag.get(f"{CONTOURS}/4/query", dict(objectIds=','.join(str(v) for v in batch), outFields='elevation', outSR=5316, f='json', geometryPrecision=1)).get('features', [])
            except IOError:
                if len(batch) == 1: self.skipped = getattr(self, 'skipped', []) + batch; return []
                return get(batch[:len(batch) // 2]) + get(batch[len(batch) // 2:])
        for i in range(0, len(ids), 50):
            for f in get(ids[i:i + 50]):
                for p in f['geometry'].get('paths', []):
                    a = densify(np.asarray(p, float)[:, :2], 2.0); m = (a[:, 0] > x0 - 50) & (a[:, 0] < x1 + 50) & (a[:, 1] > y0 - 50) & (a[:, 1] < y1 + 50)
                    if m.any(): X.append(a[m, 0]); Y.append(a[m, 1]); Z.append(np.full(int(m.sum()), f['attributes']['elevation'], np.float32))
        out = (np.concatenate(X), np.concatenate(Y), np.concatenate(Z)) if X else (np.zeros(0), np.zeros(0), np.zeros(0, np.float32))
        self._2[key] = out; return out

def densify(a, step):
    if len(a) < 2: return a
    seg = np.hypot(*np.diff(a, axis=0).T); k = np.maximum(1, np.ceil(seg / step).astype(int))
    out = [a[:1]]
    for i in range(len(seg)):
        t = (np.arange(1, k[i] + 1) / k[i])[:, None]; out.append(a[i] + (a[i + 1] - a[i]) * t)
    return np.concatenate(out)

class Bucket:
    def __init__(self, x, y, z, size=500.0):
        self.x, self.y, self.z, self.s = x, y, z, size
        k = (np.floor(x / size).astype(np.int64) * 100003 + np.floor(y / size).astype(np.int64)); o = np.argsort(k, kind='stable')
        self.k, self.o = k[o], o
    def box(self, x0, x1, y0, y1):
        out = []
        for i in range(int(math.floor(x0 / self.s)), int(math.floor(x1 / self.s)) + 1):
            for j in range(int(math.floor(y0 / self.s)), int(math.floor(y1 / self.s)) + 1):
                key = i * 100003 + j; a, b = np.searchsorted(self.k, [key, key + 1]); out.append(self.o[a:b])
        idx = np.concatenate(out) if out else np.zeros(0, int)
        m = (self.x[idx] >= x0) & (self.x[idx] <= x1) & (self.y[idx] >= y0) & (self.y[idx] <= y1); idx = idx[m]
        return self.x[idx], self.y[idx], self.z[idx]


# ---------- cleaning a native window: blunders, land holes, lakes, buildings ----------
JUMP = 30.0        # metres between two neighbouring 2 m cells: no real Faroes slope does that (sea cliffs are smoothed over cells)
BLOB = 5000        # cells (2 ha): a piece of surface cut off by such jumps all round and at most this big may be a blunder
MAXH = 885.0       # Slættaratindur, the highest point of the islands, is 880 m: anything above is a blunder
DIFF = 30.0        # ... when it stands this far above / below the ground round it, and the 2009 contours do not back it

def _fill_pts(px, py, pz, qx, qy):
    """Heights at (qx, qy) from scattered points: linear between them, nearest beyond them."""
    from scipy.interpolate import griddata
    if len(px) < 3: return np.full(len(qx), float(np.median(pz)) if len(pz) else 0.0)
    P = np.c_[px, py]
    try: v = griddata(P, pz, np.c_[qx, qy], method='linear')
    except Exception: v = np.full(len(qx), np.nan)
    bad = np.isnan(v)
    if bad.any(): v[bad] = griddata(P, pz, np.c_[qx[bad], qy[bad]], method='nearest')
    return v

def clean(dsm, win, lay, con, two=True, log=None):
    """One native window, cleaned. Returns dict(h = heights with blunders / land holes filled, sea = nodata that is sea,
    water = filled holes that are water (lagoons, harbour basins), lake = the agency's lakes (flat), bfoot = building
    footprints, bare = h with every footprint filled from the ground round it, stats). Sea cells hold 0 in h and bare.
    con = Contours: blunders are judged on the 10 m lines; land holes are filled from the 2 m lines (two=True) or the 10 m ones."""
    from scipy import ndimage
    a = dsm.read(*win); X, Y = dsm.centre(*win); c0, r0, w, h = win
    st = dict(blunders=[], holes=[], water_holes=[])
    nod = np.isnan(a)
    coast = lay.in_box('coast', X[0], X[-1], Y[-1], Y[0]); land = draw_polys(dsm, win, coast) if coast else np.zeros_like(nod)
    ten = con.ten()
    # 1. blunders: pieces of surface joined to the rest only across jumps of more than JUMP m between neighbouring cells
    #    (connected parts of the grid graph whose edges are the steps of at most JUMP), small, far off the ground round
    #    them (or above the islands' top), and not backed by the 2009 10 m contours
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    v = np.where(nod, np.nan, a); idx = np.arange(v.size).reshape(v.shape)
    ex = ~nod[:, 1:] & ~nod[:, :-1] & (np.abs(v[:, 1:] - v[:, :-1]) <= JUMP); ey = ~nod[1:] & ~nod[:-1] & (np.abs(v[1:] - v[:-1]) <= JUMP)
    I = np.r_[idx[:, :-1][ex], idx[:-1][ey]]; Jx = np.r_[idx[:, 1:][ex], idx[1:][ey]]
    g = coo_matrix((np.ones(len(I), np.int8), (I, Jx)), shape=(v.size, v.size))
    k, labv = connected_components(g, directed=False); lab = labv.reshape(v.shape) + 1; lab[nod] = 0
    bad = np.zeros_like(nod)
    sizes = np.bincount(lab.ravel(), minlength=k + 1); sizes[0] = 0
    small = np.nonzero((sizes > 0) & (sizes <= BLOB))[0]
    high = np.unique(lab[(v > MAXH) & ~nod])
    cand = np.union1d(small, high[high > 0])
    if len(cand):
        objs = ndimage.find_objects(np.where(np.isin(lab, cand), lab, 0))
        for i in cand:
            if i - 1 >= len(objs) or objs[i - 1] is None: continue
            sl = objs[i - 1]; ys, xs = slice(max(0, sl[0].start - 6), sl[0].stop + 6), slice(max(0, sl[1].start - 6), sl[1].stop + 6)
            m = lab[ys, xs] == i
            ring = ndimage.binary_dilation(m, iterations=3) & ~m & ~nod[ys, xs]
            hm = float(np.median(a[ys, xs][m]))
            # nothing round it but sea (a stack, or a blob hanging off a cliff edge): judged against sea level
            hr = float(np.median(a[ys, xs][ring])) if ring.sum() >= 8 else 0.0
            d = hm - hr
            if abs(d) <= DIFF and np.nanmax(a[ys, xs][m]) < MAXH: continue
            yy, xx = np.nonzero(m); cx, cy = X[xs][xx], Y[ys][yy]
            px, py, pz = ten.box(cx.min() - 12, cx.max() + 12, cy.min() - 12, cy.max() + 12)
            backed = len(pz) and ((d > 0 and pz.max() >= hr + 0.5 * d) or (d < 0 and pz.min() <= hr + 0.5 * d))
            if backed and np.nanmax(a[ys, xs][m]) < MAXH: continue   # the 2009 survey has it too: real (higher than the islands' top never is)
            if sizes[i] > BLOB and np.nanmax(a[ys, xs][m]) >= MAXH:  # a big piece with a few cells over the top: only those cells
                m = m & (a[ys, xs] >= MAXH)
            bad[ys, xs] |= m
            la, lo = dsm.ll(float(cx.mean()), float(cy.mean()))
            st['blunders'].append(dict(lat=round(la, 6), lng=round(lo, 6), cells=int(m.sum()), off_m=round(d, 1), at_m=round(hm, 1), ground_m=round(hr, 1)))
    # 2. land holes (nodata inside the coastline, not the slivers along it) and the blunders: filled from the 2009 contours
    inner = ndimage.distance_transform_edt(land) > 3.0
    hole0 = (nod & land)
    lab, k = ndimage.label(hole0, structure=np.ones((3, 3)))
    holes = np.zeros_like(nod)
    if k:
        deep = ndimage.maximum(inner, lab, range(1, k + 1)); holes = np.isin(lab, np.nonzero(deep)[0] + 1)
    fillm = holes | bad
    out = np.where(nod, np.nan, a).astype(np.float32)
    water = np.zeros_like(nod)
    if fillm.any():
        lab, k = ndimage.label(fillm, structure=np.ones((3, 3))); objs = ndimage.find_objects(lab)
        srcb = Bucket(*con.two(X[0], X[-1], Y[-1], Y[0]), size=200.0) if two else ten
        for i in range(k):
            sl = objs[i]; ys, xs = slice(max(0, sl[0].start - 4), sl[0].stop + 4), slice(max(0, sl[1].start - 4), sl[1].stop + 4)
            m = lab[ys, xs] == i + 1; rim = ndimage.binary_dilation(m, iterations=3) & ~m & ~nod[ys, xs] & ~bad[ys, xs]
            yy, xx = np.nonzero(m); qx, qy = X[xs][xx], Y[ys][yy]
            px, py, pz = srcb.box(qx.min() - 20, qx.max() + 20, qy.min() - 20, qy.max() + 20)
            if len(px):   # the lines inside the hole (a line point within 2 m of good data is left to the data)
                ci = np.clip(((px - X[xs][0]) / dsm.PX).round().astype(int), 0, m.shape[1] - 1); ri = np.clip(((Y[ys][0] - py) / dsm.PX).round().astype(int), 0, m.shape[0] - 1)
                keep = ndimage.binary_dilation(m, iterations=1)[ri, ci]; px, py, pz = px[keep], py[keep], pz[keep]
            ry, rx = np.nonzero(rim); rz = a[ys, xs][ry, rx]
            is_bl = bool(bad[ys, xs][m].any()); la, lo = dsm.ll(float(qx.mean()), float(qy.mean()))
            vx = np.r_[px, X[xs][rx]]; vy = np.r_[py, Y[ys][ry]]; vz = np.r_[pz, rz]
            fz = _fill_pts(vx, vy, vz, qx, qy) if len(vz) else np.zeros(len(qx))
            if not is_bl and float(np.median(fz)) <= 2.0 and (not len(rz) or np.median(rz) < 4.0) and m.sum() > 20:
                lvl = float(np.percentile(rz, 10)) if len(rz) else 0.0      # filled, it lies at sea level with a low rim: water (lagoon, harbour basin)
                sub = out[ys, xs]; sub[m] = lvl; water[ys, xs] |= m
                st['water_holes'].append(dict(lat=round(la, 6), lng=round(lo, 6), cells=int(m.sum()), level_m=round(lvl, 1)))
                continue
            sub = out[ys, xs]; sub[m] = fz; out[ys, xs] = sub
            if not is_bl: st['holes'].append(dict(lat=round(la, 6), lng=round(lo, 6), cells=int(m.sum()), contour_pts=int(len(pz)), filled_m=[round(float(fz.min()), 1), round(float(fz.max()), 1)]))
    sea = nod & ~fillm
    out[sea] = 0.0
    # 3. lakes: flat at their own level (photogrammetry over water is noise)
    lake = np.zeros_like(nod)
    for l in lay.in_box('lakes', X[0], X[-1], Y[-1], Y[0]):
        m = draw_polys(dsm, win, [l['rings']]) & ~sea
        if m.sum() < 5: continue
        lvl = float(np.percentile(out[m], 25)); out[m] = lvl; lake |= m
    # 4. buildings: every footprint (+ one cell) filled from the ground round it
    blds = lay.in_box('blds', X[0], X[-1], Y[-1], Y[0])
    bfoot = draw_polys(dsm, win, [b['rings'] for b in blds]) if blds else np.zeros_like(nod)
    cut = ndimage.binary_dilation(bfoot, iterations=1) & ~sea & ~lake
    bare = out.copy()
    if cut.any():
        from build_detail_faroes import fill
        bare = fill(np.nan_to_num(out).astype(np.float64), ~cut & ~sea).astype(np.float32)
        bare[sea] = 0.0
    # 5. a light smoothing of the land (sigma one cell, 2 m; never across the coast): the 2015 file carries bands of a
    #    2-3 cell zig-zag (+-0.1 to 0.3 m) from its own resampling, which a low sun turns into stripes. Tops are put back
    #    by to_grid's peak push, which reads the unsmoothed heights.
    from scipy.ndimage import gaussian_filter
    land_ok = (~sea).astype(np.float32)
    num = gaussian_filter(np.where(sea, 0.0, bare).astype(np.float32), 1.0); den = gaussian_filter(land_ok, 1.0)
    smooth = np.where(sea, 0.0, num / np.maximum(den, 1e-3)).astype(np.float32)
    st.update(nodata_cells=int(nod.sum()), sea_cells=int(sea.sum()), hole_cells=int(holes.sum()), blunder_cells=int(bad.sum()), water_cells=int(water.sum()),
              building_cells=int(bfoot.sum()), buildings=len(blds))
    return dict(h=out, bare=bare, smooth=smooth, sea=sea, water=water, lake=lake, bfoot=bfoot, land=land, X=X, Y=Y, stats=st, blds=blds)


# ---------- onto the app's lat / lng grids ----------
def grid_ll(box, n):
    north, south, west, east = box
    lat = north - (np.arange(n) + 0.5) * (north - south) / n; lng = west + (np.arange(n) + 0.5) * (east - west) / n
    return lat, lng

def window_for(dsm, box, pad=60.0):
    north, south, west, east = box
    xs, ys = [], []
    for la in (north, south, (north + south) / 2):
        for lo in (west, east, (west + east) / 2):
            x, y = dsm.xy(la, lo); xs.append(x); ys.append(y)
    return dsm.cells(min(xs), max(xs), min(ys), max(ys), pad)

def peaks(h, sea):
    """Every real top of the native heights: the highest cell within 6 m all round (7 x 7 cells), standing 5 m over the
    lowest point within 8 m: summits, sea stacks, pinnacles. Pushed into the grid cell that holds it so no resampling
    shaves it. (A 3 x 3 rule also caught the file's own zig-zag on steep slopes and stood single spikes on them.)"""
    from scipy import ndimage
    mx = ndimage.maximum_filter(h, size=7, mode='nearest'); mn = ndimage.minimum_filter(h, size=9, mode='nearest')
    m = (h >= mx) & (h - mn > 5.0) & (h > 2.0) & ~sea
    r, c = np.nonzero(m); return r, c, h[r, c]

def to_grid(dsm, win, h, box, n, order=1, sea=None, push=True, rows=None, tops=None):
    """Heights of a cleaned native window on a lat / lng grid (row 0 = north). order 1 = bilinear (2 m and coarser
    targets), 3 = cubic clamped to the four cells round each point (1 m targets: smooth, never above or below its
    neighbours, so no ringing at a cliff). push = every native top into its cell (a stack keeps its height)."""
    from scipy import ndimage
    c0, r0, w, hh = win
    lat, lng = grid_ll(box, n); out = np.empty((n, n), np.float32)
    step = rows or 256
    for i in range(0, n, step):
        LA, LN = np.meshgrid(lat[i:i + step], lng, indexing='ij'); x, y = dsm.xy(LA, LN)
        cc = (x - dsm.X0) / dsm.PX - 0.5 - c0; rr = (dsm.Y0 - y) / dsm.PX - 0.5 - r0
        v = ndimage.map_coordinates(h, [rr.ravel(), cc.ravel()], order=order, mode='nearest', prefilter=order > 1).reshape(rr.shape)
        if order > 1:
            ri = np.clip(np.floor(rr).astype(int), 0, hh - 2); ci = np.clip(np.floor(cc).astype(int), 0, w - 2)
            q = np.stack([h[ri, ci], h[ri + 1, ci], h[ri, ci + 1], h[ri + 1, ci + 1]])
            v = np.clip(v, q.min(0), q.max(0))
        out[i:i + step] = v
    if push:
        r, c, z = peaks(tops if tops is not None else h, sea if sea is not None else np.zeros(h.shape, bool))
        if tops is not None:   # only the tops the smoothing would shave by more than half a metre (not every bump of a slope)
            k = (z - h[r, c]) > 0.5; r, c, z = r[k], c[k], z[k]
        X = dsm.X0 + (c0 + c + 0.5) * dsm.PX; Y = dsm.Y0 - (r0 + r + 0.5) * dsm.PX; la, lo = dsm.ll(X, Y)
        north, south, west, east = box
        ti = np.floor((north - la) / (north - south) * n).astype(int); tj = np.floor((lo - west) / (east - west) * n).astype(int)
        ok = (ti >= 0) & (tj >= 0) & (ti < n) & (tj < n)
        np.maximum.at(out, (ti[ok], tj[ok]), z[ok].astype(np.float32))
    return out

def mask_grid(dsm, win, m, box, n):
    """A native mask on a lat / lng grid (nearest cell)."""
    c0, r0, w, hh = win
    lat, lng = grid_ll(box, n); out = np.zeros((n, n), bool)
    for i in range(0, n, 256):
        LA, LN = np.meshgrid(lat[i:i + 256], lng, indexing='ij'); x, y = dsm.xy(LA, LN)
        cc = np.clip(np.floor((x - dsm.X0) / dsm.PX - c0).astype(int), 0, w - 1); rr = np.clip(np.floor((dsm.Y0 - y) / dsm.PX - r0).astype(int), 0, hh - 1)
        out[i:i + 256] = m[rr, cc]
    return out
