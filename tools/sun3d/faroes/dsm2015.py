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
        X, Y, Z = [], [], []; off = 0
        while True:
            d = self.ag.get(f"{CONTOURS}/4/query", dict(where='1=1', geometry=f"{x0},{y0},{x1},{y1}", geometryType='esriGeometryEnvelope', inSR=5316, spatialRel='esriSpatialRelIntersects',
                                                       outFields='elevation', outSR=5316, f='json', geometryPrecision=1, resultOffset=off, orderByFields='OBJECTID'))
            fs = d.get('features', [])
            for f in fs:
                for p in f['geometry'].get('paths', []):
                    a = densify(np.asarray(p, float)[:, :2], 2.0); m = (a[:, 0] > x0 - 50) & (a[:, 0] < x1 + 50) & (a[:, 1] > y0 - 50) & (a[:, 1] < y1 + 50)
                    if m.any(): X.append(a[m, 0]); Y.append(a[m, 1]); Z.append(np.full(int(m.sum()), f['attributes']['elevation'], np.float32))
            if not d.get('exceededTransferLimit') or not fs: break
            off += len(fs)
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
