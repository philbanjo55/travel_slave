#!/usr/bin/env python3
"""3D sun view, third terrain level ("detail") for the Faroe Islands: real foreground around every stand spot.

  build_detail_faroes.py plan  <work dir> (--trip <uuid> | --pins pins.json) [options]     the boxes only, nothing fetched
  build_detail_faroes.py build <work dir> (--trip <uuid> | --pins pins.json) [options]

There is no laser survey of the Faroes. What this uses instead:
  - heights: ArcticDEM v4.1, 2 m mosaic (Polar Geospatial Center, CC-BY-4.0), sea level taken off as in
    build_dem_arctic.py. It is a SURFACE model from satellite stereo pictures: houses are low bumps, walls are not walls;
  - the Faroese Environment Agency (Umhvørvisstovan), public ArcGIS server https://gis.us.fo/arcgis/rest/services:
      building outlines     bygningar/us_bygningar/FeatureServer/0 and /1 (sketched ones); no heights (see 4 below)
      coastline             lendiskort/us_lendiskort/MapServer/15 (islands and holms) + topo/topo_20/MapServer/142 (skerries)
      lakes                 topo/topo_20/MapServer/120 (and 119 reservoirs)
      streams               lendiskort/us_lendiskort/MapServer/106 (stream centre lines), topo/topo_20/MapServer/108 where 106 has none
      waterfalls (points)   topo/topo_20/MapServer/81 (names only: listed in coverage.json, drawn by nothing)
      towers, lighthouses   topo/topo_20/MapServer/85 (points)
      aerial photos         myndakort/myndakort_fotm/MapServer/export (one picture a box) and its layer 2 (which survey, which year)
    Plain requests, one at a time, at most two a second (--pace), every answer kept in <work>/cache/us.
    Credit wherever the data is shown: CREDIT below.

What `build` does:
  1. pins as build_trip_terrain.py (the trip's shots: stand spot + subject; --trip saves <work>/pins.json);
  2. boxes, all 1024 x 1024 cells: a 1,024 m box at 1 m cells where the stand spots and their subjects are within
     --close-fine m (600) and fit with 150 m around them; a 2,048 m box at 2 m cells (the heights' own detail) where a
     subject is 600 to --close m (1500) away, so that it is in the same box. Neighbouring groups share a box where
     that costs no detail. Subjects further off are left to the fine / wide grid. A box is pushed toward the far
     subjects (more ground in front of the camera than behind it) and kept inside the fine box the app uses for the shot;
  3. heights: ArcticDEM 2 m on the box's grid, then cleaned into GROUND: sea = outside the agency's coastline (flat 0),
     the mosaic's smear of cliff faces beyond the shore cut off (so a sea cliff stands upright at the mapped shore),
     voids filled, lakes flat at their own level, the bump under every building outline (plus 3 m around it) cut out
     and filled from the ground beside it, a light smoothing. DATA CHECK per box: the agency's own 50 m contour lines
     (topo/topo_20/MapServer/121) against the ground, and the ground against the wide file; build_trip_terrain.py's
     `check` (Copernicus) is printed too and decides only where no contour crosses the box. The contours are judged on
     ground under 30 degrees (on a sea cliff a few metres sideways read as tens of metres of height); plus the stops' stored
     heights over all boxes together. A box that FAILS is left out;
  4. buildings: the outlines as upright flat-roofed blocks on that ground. THERE IS NO HEIGHT DATA: the outlines' own Z is
     the building's foot (checked: it reads ground + 0.7 m whatever way the outline was collected), and the 2 m mosaic
     shows a house as a bump of under 1.5 m. So: the ArcticDEM bump where it is believable (2.5 to 15 m; rare), a church's
     roof height from the topo map's church layer (topo/topo_20/MapServer/75, roof_elevation), else by size: under
     20 m2 2.5 m, to 300 m2 5 m, larger 7 m, a church 8 m. Towers and lighthouses are mapped as points only
     (topo/topo_20/MapServer/85): each becomes a 4 m block, 6 m high (both assumed);
  5. water: sea, lakes, and the mapped stream lines at their mapped width (at least one cell);
  6. colour: one aerial photo per box, north up, on exactly the box's lat / lng grid (asked in EPSG:4326 with the
     picture's sides in the box's own lat / lng proportion, the answer's extent checked, then resized to 2048 x 2048),
     no-data patches (pure white) filled, older surveys' colours pulled toward the newest one's, saved as a JPEG of
     at most about 500 KB. The alignment is checked against the building outlines (see `align_check`);
  7. files in <work>/files: <id>_ground.png = ground + buildings in the page's format (16-bit prediction residuals,
     height = base_m + value * step_m, step 0.02), <id>_mask.png (8-bit: 0 ground, 2 building, 3 water; 8 and up = tree
     is never used here: there are no tree heights), <id>_photo.jpg; raw arrays in <work>/raw/<id>.npz; a top-down
     look-at picture per box in <work>/look; <work>/coverage.json (per shot: box, photo survey and year, buildings,
     water); <work>/detail.json (the rows); <work>/upload.txt; the draft migration (--migration; NOT applied).

Needs: numpy, pillow, scipy, tifffile, imagecodecs; curl. A first run fetches about 0.9 GB into <work>/cache (ArcticDEM
blocks, the agency's answers, the 50 m contour lines of the islands); a rerun fetches nothing.

Found on the first run (12 Nov 2026, the Faroes trip: 74 shots, 38 boxes planned, 36 built, 25.7 MB):
  - the ground of every box sits 2 to 6 m (middle 3.3 m) UNDER the agency's own 50 m contours on gentle ground. The wide
    file and the 4 m fine boxes are the same ArcticDEM heights less the same sea level, so they share it;
  - on sea cliffs the two surveys disagree by tens of metres (a few metres sideways). Two boxes failed outright even on
    their gentle ground: the Tindhólmur islet (41 m under) and the western Drangarnir headland;
  - the photo sits on the building outlines to the pixel in all 17 boxes that have enough buildings to tell.
"""
import argparse, hashlib, io, json, math, os, struct, subprocess, sys, time, urllib.parse, zlib
from concurrent.futures import ThreadPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(HERE))
from build_trip_terrain import load_pins, read_png, at, slug, check, FILES_URL   # noqa: E402

US = 'https://gis.us.fo/arcgis/rest/services/'
CREDIT = ('Data from the Faroese Environment Agency, Umhvørvisstovan: Myndakort, Bygningar, Lendiskort, Topo (webservice, November 2026). '
          'Heights: ArcticDEM v4.1, Polar Geospatial Center (CC-BY-4.0).')
STEP = 0.02          # metres per height value, as the Teton detail files
N = 1024             # cells a side
PHOTO = 2048         # photo pixels a side
G_MESH = 768         # the page's mesh points per side (pick_near below)
SEA_BELOW = 6.0      # outside the coastline, anything lower than this is sea (cliff feet a few metres off, rocks awash)


# ---------- files (copied from tools/sun3d/lidar/build_detail.py on branch claude/sun3d-lidar: the Teton detail writers) ----------
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

def write_heights(path, h, base, step):
    n = h.shape[0]; q = np.round((h - base) / step); assert q.min() >= 0 and q.max() <= 65535, "heights don't fit"
    p = np.zeros((n + 1, n + 1), dtype=np.int64); p[1:, 1:] = q.astype(np.int64)
    res = ((p[1:, 1:] - p[1:, :-1] - p[:-1, 1:] + p[:-1, :-1]) % 65536).astype('>u2')
    raw = b''.join(b'\x00' + res[i].tobytes() for i in range(n))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def write_mask(path, m):
    n = m.shape[0]; raw = b''.join(b'\x00' + m[i].astype(np.uint8).tobytes() for i in range(n))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def read_mask(path):
    b = open(path, 'rb').read(); o = 8; idat = b''; n = 0
    while o < len(b):
        l, = struct.unpack('>I', b[o:o + 4]); t = b[o + 4:o + 8]
        if t == b'IHDR': n, = struct.unpack('>I', b[o + 8:o + 12])
        if t == b'IDAT': idat += b[o + 8:o + 8 + l]
        o += 12 + l
    return np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(n, n + 1)[:, 1:]

# small grid tools (same source)
def fill(a, ok):
    """Cells that are not ok take the average of the ok cells around them, however far (coarser and coarser grids)."""
    a = np.where(ok, a, 0.0).astype(np.float64)
    if ok.all() or not ok.any(): return a
    h, w = a.shape; H2, W2 = (h + 1) // 2, (w + 1) // 2
    pa = np.zeros((H2 * 2, W2 * 2)); pa[:h, :w] = a; pk = np.zeros((H2 * 2, W2 * 2)); pk[:h, :w] = ok
    s = pa.reshape(H2, 2, W2, 2).sum((1, 3)); c = pk.reshape(H2, 2, W2, 2).sum((1, 3))
    low = fill(np.divide(s, c, out=np.zeros_like(s), where=c > 0), c > 0)
    return np.where(ok, a, box3(np.repeat(np.repeat(low, 2, 0), 2, 1)[:h, :w]))

def box3(a):
    p = np.pad(a, 1, mode='edge'); n, m = a.shape
    return sum(p[i:i + n, j:j + m] for i in range(3) for j in range(3)) / 9.0

def grow1(m):
    n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]; return n

def grow(m, k):
    for _ in range(int(k)): m = grow1(m)
    return m


# ---------- ArcticDEM (copied from tools/sun3d/build_dem_arctic.py, which runs as a script and cannot be imported) ----------
BUCKET = 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/arcticdem/mosaics/v4.1'
_a = 6378137.0; _f = 1 / 298.257223563; _e = math.sqrt(2 * _f - _f * _f)
def _t(lat):
    s = np.sin(np.radians(lat)); return np.tan(np.pi / 4 - np.radians(lat) / 2) / ((1 - _e * s) / (1 + _e * s)) ** (_e / 2)
_mc = math.cos(math.radians(70)) / math.sqrt(1 - (_e * math.sin(math.radians(70))) ** 2); _t70 = float(_t(70.0))
def fwd(lat, lng):
    """EPSG:3413 (polar stereographic north, true scale at 70 N, central meridian 45 W, WGS84)."""
    rho = _a * _mc * _t(lat) / _t70; th = np.radians(lng + 45)
    return rho * np.sin(th), -rho * np.cos(th)

def curl(url, rng=None, tries=3):
    cmd = ["curl", "-sS", "-f", "-m", "180", "--retry", str(tries)] + (["-r", rng] if rng else []) + [url]
    p = subprocess.run(cmd, capture_output=True)
    return p.stdout if p.returncode == 0 else None

class Remote:
    """A read-only file over HTTP range requests, in 256 KB blocks kept on disk."""
    B = 262144
    def __init__(self, key, cache):
        self.url = f"{BUCKET}/{key}"; self.dir = f"{cache}/{key.replace('/', '_')}"; self.pos = 0; self.mem = {}
        os.makedirs(self.dir, exist_ok=True); sz = f"{self.dir}/size"
        if os.path.exists(sz): self.size = int(open(sz).read())
        else:
            head = subprocess.run(["curl", "-sS", "-f", "-m", "60", "-I", self.url], capture_output=True)
            self.size = next((int(l.split(b':')[1]) for l in head.stdout.splitlines() if l.lower().startswith(b'content-length')), 0) if head.returncode == 0 else 0
            if self.size: open(sz, 'w').write(str(self.size))
    def block(self, i):
        if i in self.mem: return self.mem[i]
        path = f"{self.dir}/{i}"
        if os.path.exists(path) and os.path.getsize(path): d = open(path, 'rb').read()
        else:
            d = curl(self.url, f"{i * self.B}-{min(self.size, (i + 1) * self.B) - 1}")
            if d is None: raise IOError(f"range read failed: {self.url}")
            open(path + '.tmp', 'wb').write(d); os.replace(path + '.tmp', path)
        if len(self.mem) > 64: self.mem.clear()
        self.mem[i] = d; return d
    def fetch(self, blocks):
        todo = [i for i in sorted(set(blocks)) if not os.path.exists(f"{self.dir}/{i}")]
        with ThreadPoolExecutor(8) as ex: list(ex.map(self.block, todo))
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos)); o = self.pos; parts = []
        while n > 0:
            i, k = divmod(o, self.B); d = self.block(i)[k:k + n]
            if not d: break
            parts.append(d); o += len(d); n -= len(d)
        self.pos = o; return b''.join(parts)
    def seek(self, o, whence=0): self.pos = o if whence == 0 else self.pos + o if whence == 1 else self.size + o; return self.pos
    def tell(self): return self.pos
    def close(self): pass
    closed = False

def window(key, level_px, x0, x1, y0, y1, cache):
    """Heights of one mosaic file inside the 3413 box, on that file's own pixel grid: (array, left x, top y, pixel) or None."""
    import tifffile
    r = Remote(key, cache)
    if not r.size: return None
    tif = tifffile.TiffFile(r); p0 = tif.pages[0]
    ps0 = p0.tags['ModelPixelScaleTag'].value[0]; tp = p0.tags['ModelTiepointTag'].value; fx, fy = tp[3], tp[4]
    page = min(tif.pages, key=lambda p: abs(ps0 * p0.shape[1] / p.shape[1] - level_px)); ps = ps0 * p0.shape[1] / page.shape[1]
    H, W = page.shape; tw, th = page.tilewidth, page.tilelength
    c0, c1 = max(0, int((x0 - fx) / ps) - 2), min(W, int((x1 - fx) / ps) + 3); r0, r1 = max(0, int((fy - y1) / ps) - 2), min(H, int((fy - y0) / ps) + 3)
    if c1 <= c0 or r1 <= r0: return None
    arr = np.full((r1 - r0, c1 - c0), -9999, dtype=np.float32); across = (W + tw - 1) // tw
    idx = [tr * across + tc for tr in range(r0 // th, (r1 - 1) // th + 1) for tc in range(c0 // tw, (c1 - 1) // tw + 1)]
    idx = [i for i in idx if page.databytecounts[i] > 0]
    r.fetch(b for i in idx for b in range(page.dataoffsets[i] // r.B, (page.dataoffsets[i] + page.databytecounts[i] - 1) // r.B + 1))
    for i in idx:
        r.seek(page.dataoffsets[i]); seg, _, _ = page.decode(r.read(page.databytecounts[i]), i)
        t = np.squeeze(seg); ty, tx = (i // across) * th, (i % across) * tw
        a0, a1, b0, b1 = max(r0, ty), min(r1, ty + t.shape[0]), max(c0, tx), min(c1, tx + t.shape[1])
        if a1 > a0 and b1 > b0: arr[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = t[a0 - ty:a1 - ty, b0 - tx:b1 - tx]
    return arr, fx + c0 * ps, fy - r0 * ps, ps

def tiles(x0, x1, y0, y1, sub):
    size = 50000 if sub else 100000; names = []
    for iy in range(int(math.floor((y0 + 4e6) / size)), int(math.floor((y1 + 4e6) / size)) + 1):
        for ix in range(int(math.floor((x0 + 4e6) / size)), int(math.floor((x1 + 4e6) / size)) + 1):
            names.append(f"{iy // 2 + 1:02d}_{ix // 2 + 1:02d}_{iy % 2 + 1}_{ix % 2 + 1}" if sub else f"{iy + 1:02d}_{ix + 1:02d}")
    return names

def sample(wins, x, y):
    """Bilinear heights at 3413 points from the windows; -9999 where no file has data."""
    h = np.full(x.shape, -9999, dtype=np.float64)
    for arr, fx, fy, ps in wins:
        c = (x - fx) / ps - 0.5; r = (fy - y) / ps - 0.5
        ok = (c >= 0) & (r >= 0) & (c < arr.shape[1] - 1) & (r < arr.shape[0] - 1) & (h < -9000)
        c0 = np.floor(c[ok]).astype(int); r0 = np.floor(r[ok]).astype(int); fc = c[ok] - c0; fr = r[ok] - r0
        A, B, C, D = arr[r0, c0], arr[r0, c0 + 1], arr[r0 + 1, c0], arr[r0 + 1, c0 + 1]
        v = (A * (1 - fc) + B * fc) * (1 - fr) + (C * (1 - fc) + D * fc) * fr
        v[(A < -9000) | (B < -9000) | (C < -9000) | (D < -9000)] = -9999
        h[ok] = v
    return h

def sea_plane(cache, lat0, lat1, lng0, lng1):
    """The sea level in the source as a plane (the water fill follows the geoid): fitted once over the trip's area + 60 km
    from the 32 m product's mostly-water blocks, as build_dem_arctic.py does per file. Kept in <cache>/sea_plane.json."""
    path = f"{cache}/sea_plane.json"; key = [round(v, 3) for v in (lat0, lat1, lng0, lng1)]
    if os.path.exists(path):
        d = json.load(open(path))
        if d['key'] == key: return d
    la, lo = np.meshgrid(np.linspace(lat0, lat1, 9), np.linspace(lng0, lng1, 9)); X, Y = fwd(la, lo); pts = []
    for name in tiles(X.min() - 60000, X.max() + 60000, Y.min() - 60000, Y.max() + 60000, False):
        w = window(f"32m/{name}/{name}_32m_v4.1_dem.tif", 32, -1e9, 1e9, -1e9, 1e9, cache)
        if not w: continue
        arr, fx, fy, ps = w; K = 64
        for i in range(0, arr.shape[0] - K + 1, K):
            for j in range(0, arr.shape[1] - K + 1, K):
                b = arr[i:i + K, j:j + K]; b = b[b > -9000]
                if b.size < K * K // 2: continue
                u, c = np.unique(np.round(b, 1), return_counts=True); k = int(np.argmax(c))
                if c[k] > 0.3 * K * K: pts.append((fx + (j + K / 2) * ps, fy - (i + K / 2) * ps, float(u[k])))
    assert len(pts) >= 3, "no open water near the area to take the sea level from"
    P = np.array(pts); cx, cy = P[:, 0].mean(), P[:, 1].mean()
    G = np.c_[np.ones(len(P)), (P[:, 0] - cx) / 1e5, (P[:, 1] - cy) / 1e5]; coef, *_ = np.linalg.lstsq(G, P[:, 2], rcond=None)
    d = dict(key=key, cx=float(cx), cy=float(cy), coef=[float(v) for v in coef], blocks=len(P), worst=float(np.abs(P[:, 2] - G @ coef).max()))
    json.dump(d, open(path, 'w')); return d


# ---------- the agency's server ----------
class Agency:
    def __init__(self, cache, pace):
        self.cache = cache; self.pace = pace; self.last = 0.0; self.asked = 0; os.makedirs(cache, exist_ok=True)

    def get(self, path, params=None, binary=False, keep=True):
        url = (path if path.startswith('http') else US + path) + ('?' + urllib.parse.urlencode(params) if params else '')
        f = f"{self.cache}/{hashlib.sha1(url.encode()).hexdigest()[:20]}{'.bin' if binary else '.json'}"
        if keep and os.path.exists(f) and os.path.getsize(f): return open(f, 'rb').read() if binary else json.load(open(f))
        err = None
        for i in range(4):
            wait = self.last + self.pace - time.time()
            if wait > 0: time.sleep(wait)
            self.last = time.time(); self.asked += 1
            p = subprocess.run(["curl", "-sS", "-f", "-m", "180", url], capture_output=True)   # a plain request: curl's own headers
            if p.returncode == 0 and p.stdout:
                try:
                    if not binary:
                        d = json.loads(p.stdout)
                        if 'error' in d: raise IOError(str(d['error'])[:200])
                    if keep: open(f + '.tmp', 'wb').write(p.stdout); os.replace(f + '.tmp', f)
                    return p.stdout if binary else d
                except Exception as e: err = e
            else: err = IOError(p.stderr.decode()[:200])
            time.sleep(2 + 3 * i)
        raise IOError(f"{url[:160]}: {err}")

    def features(self, layer, box=None, where='1=1', fields='*', z=False, pad=0.0):
        """Every feature of a layer (inside the box), in lat / lng."""
        out, off = [], 0
        while True:
            q = {'where': where, 'outFields': fields, 'outSR': 4326, 'f': 'json', 'geometryPrecision': 7, 'resultOffset': off, 'orderByFields': 'OBJECTID'}
            if z: q['returnZ'] = 'true'
            if box: q.update(geometry=f"{box[2] - pad},{box[1] - pad},{box[3] + pad},{box[0] + pad}", geometryType='esriGeometryEnvelope', inSR=4326, spatialRel='esriSpatialRelIntersects')
            d = self.get(f"{layer}/query", q); fs = d.get('features', []); out += fs
            if not d.get('exceededTransferLimit') or not fs: return out
            off += len(fs)


def contour_check(ag, ground, box, land, cell):
    """The agency's own 50 m contour lines (topo map, from the 2009 air photos) against the box's ground: an independent
    referee on the spot. Copernicus (the world-wide model `check` uses) is 20 to 60 m off on the steep sea slopes here.
    The lines run round whole islands, so each is fetched once (by its id) and kept."""
    L = 'topo/topo_20/MapServer/121'
    q = dict(where='i50=1', geometry=f"{box[2]},{box[1]},{box[3]},{box[0]}", geometryType='esriGeometryEnvelope', inSR=4326, spatialRel='esriSpatialRelIntersects', returnIdsOnly='true', f='json')
    ids = ag.get(f"{L}/query", q).get('objectIds') or []
    la, lo, el = [], [], []
    for i in ids[:40]:
        d = ag.get(f"{L}/query", dict(objectIds=i, outFields='elevation', outSR=4326, geometryPrecision=6, f='json'))
        for f in d.get('features', []):
            for path in f['geometry'].get('paths', []):
                a = np.array(path)[:, :2]; m = (a[:, 1] > box[1]) & (a[:, 1] < box[0]) & (a[:, 0] > box[2]) & (a[:, 0] < box[3])
                la += list(a[m, 1]); lo += list(a[m, 0]); el += [f['attributes']['elevation']] * int(m.sum())
    if len(la) < 300: return None
    la, lo, el = np.array(la), np.array(lo), np.array(el, float); n = ground.shape[0]
    r = ((box[0] - la) / (box[0] - box[1]) * n).astype(int).clip(0, n - 1); c = ((lo - box[2]) / (box[3] - box[2]) * n).astype(int).clip(0, n - 1)
    gy, gx = np.gradient(ground, cell); slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    ok = land[r, c]; df_all = (at(ground, box, la, lo) - el)[ok]; gentle = slope[r, c][ok] < 30
    if len(df_all) < 300: return None
    # On a sea cliff the lines lie metres apart, so a few metres sideways between the two surveys reads as tens of
    # metres of height: the verdict goes by the ground under 30 degrees, the cliffs are reported beside it.
    df = df_all[gentle] if gentle.sum() >= 300 else df_all
    med = float(np.median(df)); w10 = float(np.mean(np.abs(df) <= 10)); w15 = float(np.mean(np.abs(df) <= 15))
    el_g = el[ok][gentle] if gentle.sum() >= 300 else el[ok]
    by_level = {int(v): [round(float(np.median(df[el_g == v])), 1), int((el_g == v).sum())] for v in sorted(set(el_g)) if (el_g == v).sum() >= 40}
    verdict = 'PASS' if abs(med) <= 6 and w10 >= 0.85 else 'WARN' if abs(med) <= 10 and w15 >= 0.6 else 'FAIL'
    return dict(points=int(len(df)), judged_on='ground under 30 degrees' if gentle.sum() >= 300 else 'all of it (hardly any gentle ground)', lines=len(ids), levels=sorted(set(int(v) for v in el)), middle_m=round(med, 1), within_10m=round(w10, 2), within_15m=round(w15, 2),
                steep_share=round(float(1 - gentle.mean()), 2), steep_middle_m=round(float(np.median(df_all[~gentle])), 1) if (~gentle).sum() else None, steep_within_15m=round(float(np.mean(np.abs(df_all[~gentle]) <= 15)), 2) if (~gentle).sum() else None, by_level=by_level, verdict=verdict)


def raster(n, box, shapes, kind, width=None, ss=1):
    """Polygons (lists of rings) or lines (lists of paths) drawn on the box's n x n lat / lng grid. ss = draw ss times
    finer and give back the covered share of each cell (0..1)."""
    from PIL import Image, ImageDraw
    north, south, west, east = box; m = n * ss
    im = Image.new('L', (m, m), 0); dr = ImageDraw.Draw(im)
    X = lambda x: (x - west) / (east - west) * m; Y = lambda y: (north - y) / (north - south) * m
    for k, sh in enumerate(shapes):
        if kind == 'poly':
            def area(r): return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))
            rings = sorted(sh, key=lambda r: -abs(area(r)))
            # ArcGIS: outer rings run clockwise (negative area in x right / y up), holes the other way
            for r in rings:
                if len(r) < 3: continue
                xs = [p[0] for p in r]; ys = [p[1] for p in r]
                if max(xs) < west or min(xs) > east or max(ys) < south or min(ys) > north: continue
                dr.polygon([(X(p[0]), Y(p[1])) for p in r], fill=255 if area(r) <= 0 else 0)
        else:
            w = max(1, int(round((width[k] if width is not None else 1) * ss)))
            for r in sh:
                if len(r) >= 2: dr.line([(X(p[0]), Y(p[1])) for p in r], fill=255, width=w)
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a.reshape(n, ss, n, ss).mean((1, 3)) if ss > 1 else a


def raster_small(n, box, rings, ss):
    """One polygon's covered share per cell (drawn ss times finer in a window around it): n x n, float."""
    from PIL import Image, ImageDraw
    north, south, west, east = box; out = np.zeros((n, n), np.float32)
    xs = [(p[0] - west) / (east - west) * n for r in rings for p in r]; ys = [(north - p[1]) / (north - south) * n for r in rings for p in r]
    c0, c1 = max(0, int(math.floor(min(xs))) - 1), min(n, int(math.ceil(max(xs))) + 1); r0, r1 = max(0, int(math.floor(min(ys))) - 1), min(n, int(math.ceil(max(ys))) + 1)
    if c1 <= c0 or r1 <= r0: return out
    im = Image.new('L', ((c1 - c0) * ss, (r1 - r0) * ss), 0); dr = ImageDraw.Draw(im)
    def area(r): return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))
    for r in sorted(rings, key=lambda r: -abs(area(r))):
        if len(r) >= 3: dr.polygon([(((p[0] - west) / (east - west) * n - c0) * ss, ((north - p[1]) / (north - south) * n - r0) * ss) for p in r], fill=255 if area(r) <= 0 else 0)
    out[r0:r1, c0:c1] = (np.asarray(im, dtype=np.float32) / 255.0).reshape(r1 - r0, ss, c1 - c0, ss).mean((1, 3))
    return out


# ---------- the boxes ----------
def pick_near(nears, region, stand, subject):
    """The app's choice of fine box for a shot (src/services/terrain.ts pickNear; copied from lidar/build_detail.py)."""
    edge = 4.2 * max(region['width_m'], region['depth_m']) / (G_MESH - 1) + 30; kx = 111320 * math.cos(math.radians(stand[0])); kz = 111132
    best = None; bb = False; ba = 1e99
    for r in nears:
        if r['parent'] != region['id'] or not (r['south'] <= stand[0] <= r['north'] and r['west'] <= stand[1] <= r['east']): continue
        if min((r['north'] - stand[0]) * kz, (stand[0] - r['south']) * kz, (stand[1] - r['west']) * kx, (r['east'] - stand[1]) * kx) < edge: continue
        both = r['south'] <= subject[0] <= r['north'] and r['west'] <= subject[1] <= r['east']; area = (r['north'] - r['south']) * (r['east'] - r['west'])
        if (both and not bb) or (both == bb and area < ba): best, bb, ba = r, both, area
    return best

def plan(pins, a):
    """Stand spots grouped into boxes. A group is 1 m class when its stand spots and the subjects within --close-fine m
    of them fit a 1,024 m box with 150 m around them, else 2 m class (2,048 m box, 250 m around; subjects up to --close m).
    Groups are joined, nearest first, while the joint group stays 1 m class, or when one of them is 2 m class anyway and
    the joint group still fits its 2,048 m box."""
    shots = pins.get('shots', []); assert shots, 'no shots (stand spot + subject) for this trip'
    region = next(r for r in pins['regions'] if r['id'] == a.region); nears = pins.get('nears', [])
    kz = 111132; lat0 = float(np.mean([s['vlat'] for s in shots])); kx0 = 111320 * math.cos(math.radians(lat0))
    XY = lambda p: (p[1] * kx0, p[0] * kz)
    st = {}
    for s in shots:
        key = (round(s['vlat'], 5), round(s['vlng'], 5))
        e = st.setdefault(key, {'stands': [(s['vlat'], s['vlng'])], 'stops': [], 'subs': []})
        if s['stop'] not in e['stops']: e['stops'].append(s['stop'])
        d = math.hypot((s['slng'] - s['vlng']) * kx0, (s['slat'] - s['vlat']) * kz)
        if (s['slat'], s['slng'], d) not in e['subs']: e['subs'].append((s['slat'], s['slng'], d))
    def fine_of(c):
        ids = []
        for s in shots:
            if (s['vlat'], s['vlng']) not in c['stands']: continue
            nr = pick_near(nears, region, (s['vlat'], s['vlng']), (s['slat'], s['slng']))
            if nr and nr['id'] not in [q['id'] for q in ids]: ids.append(nr)
        return ids
    def shape(c):
        """(cell, near subjects, far subjects, extent box in metres) of a group."""
        ids = fine_of(c); small = len(ids) == 1 and min(ids[0]['width_m'], ids[0]['depth_m']) < 2 * N   # its fine box cannot hold a 2,048 m box
        for limit, cell, pad in ((a.close_fine, 1.0, 150.0), (a.close, 2.0, 250.0)):
            near = [q for q in c['subs'] if q[2] <= limit]
            while True:
                pts = [XY(p) for p in c['stands']] + [XY(q) for q in near]
                x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts); y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
                if max(x1 - x0, y1 - y0) + 2 * pad <= N * cell or not near: break
                if cell == 1.0: break
                near = sorted(near, key=lambda q: q[2])[:-1]          # 2 m class: the furthest subject is left to the wide grid
            fits = max(x1 - x0, y1 - y0) + 2 * pad <= N * cell
            mid = [q for q in c['subs'] if a.close_fine < q[2] <= a.close]
            if cell == 1.0 and fits and (not mid or small): break    # everything close (or no room for more): a 1 m box
            if cell == 2.0: break
        return cell, near, [q for q in c['subs'] if q not in near], (x0, x1, y0, y1), fits
    cl = list(st.values())
    while True:
        best = None
        for i in range(len(cl)):
            for j in range(i + 1, len(cl)):
                u = {'stands': cl[i]['stands'] + cl[j]['stands'], 'stops': cl[i]['stops'] + [s for s in cl[j]['stops'] if s not in cl[i]['stops']], 'subs': cl[i]['subs'] + [q for q in cl[j]['subs'] if q not in cl[i]['subs']]}
                cu, nu, _, eu, fu = shape(u); ci, ni, _, _, _ = shape(cl[i]); cj, nj, _, _, _ = shape(cl[j])
                if not fu or len(nu) < len(set(ni) | set(nj)): continue           # must fit, and lose no subject either had inside
                if cu == 2.0 and ci == 1.0 and cj == 1.0: continue                # two 1 m groups are not traded for one 2 m box
                size = max(eu[1] - eu[0], eu[3] - eu[2])
                if best is None or size < best[0]: best = (size, i, j, u)
        if not best: break
        _, i, j, u = best; cl[i] = u; del cl[j]
    out, used = [], set(); stop_pin = {s['name']: (s['lat'], s['lng']) for s in pins.get('stops', [])}
    for c in sorted(cl, key=lambda c: (-c['stands'][0][0], c['stands'][0][1])):
        cell, near, far, (x0, x1, y0, y1), fits = shape(c); stands = c['stands']; notes = []
        if not fits: notes.append('the stand spots do not fit one box')
        side = N * cell; pad = 150.0 if cell == 1.0 else 250.0; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        clat = float(np.mean([p[0] for p in stands])); kx = 111320 * math.cos(math.radians(clat))
        if far:   # push the box toward the far subjects: more ground in front of the camera than behind it
            sx, sy = XY((clat, float(np.mean([p[1] for p in stands]))))
            ux = float(np.mean([(XY(p)[0] - sx) / max(1.0, math.hypot(XY(p)[0] - sx, XY(p)[1] - sy)) for p in far]))
            uy = float(np.mean([(XY(p)[1] - sy) / max(1.0, math.hypot(XY(p)[0] - sx, XY(p)[1] - sy)) for p in far]))
            roomx = max(0.0, (side - (x1 - x0)) / 2 - pad); roomy = max(0.0, (side - (y1 - y0)) / 2 - pad)
            cx += max(-roomx, min(roomx, ux * side)); cy += max(-roomy, min(roomy, uy * side))
        clat2 = cy / kz; clng2 = cx / kx0
        ids = fine_of(c)   # the fine box the app uses for each of these shots: the page draws the detail inside it
        if len(ids) == 1:
            nr = ids[0]; hx = side / 2 / kx; hy = side / 2 / kz
            c2 = min(max(clat2, nr['south'] + hy), nr['north'] - hy); l2 = min(max(clng2, nr['west'] + hx), nr['east'] - hx)
            if abs(c2 - clat2) > 1e-9 or abs(l2 - clng2) > 1e-9: notes.append(f"moved to stay inside fine box {nr['id']}")
            clat2, clng2 = c2, l2
        box = tuple(round(v, 6) for v in (clat2 + side / 2 / kz, clat2 - side / 2 / kz, clng2 - side / 2 / kx, clng2 + side / 2 / kx))
        inside = lambda p, mg=0.0: box[1] + mg / kz <= p[0] <= box[0] - mg / kz and box[2] + mg / kx <= p[1] <= box[3] - mg / kx
        for p in stands:
            if not inside(p, 60): notes.append(f"stand spot {p} is within 60 m of the edge or outside")
        for q in near:
            if not inside(q, 20): notes.append(f"subject {q[:2]} ended up outside")
        outside = [nr['id'] for nr in ids if not (box[0] <= nr['north'] and box[1] >= nr['south'] and box[2] >= nr['west'] and box[3] <= nr['east'])]
        if not ids: notes.append('no fine box holds the stand spot: the detail sits straight in the wide grid')
        elif outside: notes.append(f"pokes out of fine box {', '.join(outside)}")
        stops = c['stops']   # named after the stop with the most shots from here (then the one whose own pin is nearest)
        mlat, mlng = float(np.mean([p[0] for p in stands])), float(np.mean([p[1] for p in stands]))
        count = lambda st_: sum(1 for s in shots if s['stop'] == st_ and (s['vlat'], s['vlng']) in stands)
        name = min(stops, key=lambda s: (-count(s), math.hypot((stop_pin.get(s, (mlat, mlng))[1] - mlng) * kx, (stop_pin.get(s, (mlat, mlng))[0] - mlat) * kz)))
        bid = f"{a.prefix}_{slug(name)}"; k = 2
        while bid in used: bid = f"{a.prefix}_{slug(name)}_{k}"; k += 1
        used.add(bid)
        out.append(dict(id=bid, box=box, n=N, cell=cell, side=side, stops=stops, stands=stands, near=[q[:2] for q in near], far=[q[:2] for q in far], notes=notes, fine=[q['id'] for q in ids], kx=kx))
    return out


# ---------- one box ----------
def heights(box, n, cache, plane):
    north, south, west, east = box
    lat = north - (np.arange(n) + 0.5) * (north - south) / n; lng = west + (np.arange(n) + 0.5) * (east - west) / n
    LA, LN = np.meshgrid(lat, lng, indexing='ij'); X, Y = fwd(LA, LN)
    x0, x1, y0, y1 = X.min() - 8, X.max() + 8, Y.min() - 8, Y.max() + 8
    wins = [w for w in (window(f"2m/{t[:5]}/{t}_2m_v4.1_dem.tif", 2, x0, x1, y0, y1, cache) for t in tiles(x0, x1, y0, y1, True)) if w]
    assert wins, 'no ArcticDEM tile under this box'
    raw = sample(wins, X, Y)
    sea = plane['coef'][0] + plane['coef'][1] * (X - plane['cx']) / 1e5 + plane['coef'][2] * (Y - plane['cy']) / 1e5
    return np.where(raw < -9000, np.nan, raw - sea), LA, LN

def attr(f, *names):
    for k in names:
        if f['attributes'].get(k) not in (None, ''): return f['attributes'][k]
    return None

def build_box(b, ag, land_shapes, cache, plane, say):
    from scipy import ndimage
    box, n, cell = b['box'], b['n'], b['cell']; north, south, west, east = box
    raw, LA, LN = heights(box, n, cache, plane); void = np.isnan(raw)
    # --- the coast: land = inside the agency's island / holm / skerry outlines
    land_poly = raster(n, box, land_shapes, 'poly') > 0.5
    rawf = fill(np.nan_to_num(raw), ~void)
    high_out = ~land_poly & (rawf >= SEA_BELOW)
    lab, k = ndimage.label(high_out); keep = np.zeros_like(high_out)
    if k:
        # High ground outside the coastline is, nearly always, the mosaic's own smear of a cliff face out over the water
        # (a ramp from the cliff top to the sea, 20 to 50 m wide): it touches the coastline and is cut off there, which
        # leaves an upright cliff at the mapped shore. A piece that stands clear of the coastline (a stack or a rock the
        # maps leave out) stays land when it is 30 m2 and up.
        touch = grow(land_poly, max(2, round(8 / cell)))
        sizes = ndimage.sum(high_out, lab, range(1, k + 1)); hits = ndimage.sum(touch & high_out, lab, range(1, k + 1))
        keep = np.isin(lab, [i + 1 for i in range(k) if hits[i] == 0 and sizes[i] * cell * cell >= 30])
    sea = ~land_poly & ~keep
    land = ~sea
    # --- lakes (and reservoirs): flat at their own level
    lakes = ag.features('topo/topo_20/MapServer/120', box) + ag.features('topo/topo_20/MapServer/119', box)
    lake = np.zeros((n, n), bool); lake_info = []
    for f in lakes:
        m = (raster(n, box, [f['geometry']['rings']], 'poly') > 0.5) & land
        if m.sum() * cell * cell < 20: continue
        v = rawf[m & ~void]
        if not len(v): continue
        lvl = float(np.percentile(v, 25)); lake |= m
        lake_info.append(dict(name=attr(f, 'NAM', 'name') if attr(f, 'NAM', 'name') not in ('UNK', 'N_A') else None, level_m=round(lvl, 1), m2=float(m.sum() * cell * cell), spread_m=round(float(np.percentile(v, 90) - np.percentile(v, 10)), 1)))
        rawf = np.where(m, lvl, rawf)
    # --- buildings: outlines (with their own Z), the bump under each cut out of the ground
    blds = [dict(f, sketched=False) for f in ag.features('bygningar/us_bygningar/FeatureServer/0', box, z=True)] + \
           [dict(f, sketched=True) for f in ag.features('bygningar/us_bygningar/FeatureServer/1', box, z=True)]
    blds = [f for f in blds if f.get('geometry', {}).get('rings') and f['attributes'].get('status') in (None, 1)]
    foot = [raster_small(n, box, [[p[:2] for p in r] for r in f['geometry']['rings']], 4) >= 0.4 for f in blds]
    churches = [dict(id=attr(f, 'building_id'), roof=attr(f, 'roof_elevation'), name=attr(f, 'name')) for f in ag.features('topo/topo_20/MapServer/75', box)]
    anyb = np.zeros((n, n), bool)
    for m in foot: anyb |= m
    cut = grow(anyb, max(1, round(3 / cell))) & land & ~lake
    ground = fill(rawf, ~cut & ~void | lake)
    # light smoothing of the land (the mosaic's own noise would show as speckle under a low sun); not across the coast
    sm = ground.copy()
    for _ in range(2 if cell <= 1 else 1): sm = box3(sm)
    ground = np.where(land & ~lake, sm, ground)
    ground = np.where(sea, 0.0, np.where(land & ~lake, np.maximum(ground, 0.3), ground))
    # Round 2: buildings are NOT in the heights file. Each is a record of its own (outline in box metres, foot, eave and
    # ridge heights, roof form), drawn by the page as an extruded outline with a pitched roof. The heights are assumed
    # (the outlines carry none), so buildings stay out of every sun check: the heights file is ground and water only.
    bvec = []; bcells = []; binfo = []; kxl = b['kx']; kz = 111132
    XZ = lambda lo, la: ((lo - west) * kxl, (north - la) * kz)        # metres east / south of the box's north-west corner
    def at_stand(pts):
        for s_ in b['stands']:
            sx, sz = XZ(s_[1], s_[0])
            if min(math.hypot(px_ - sx, pz_ - sz) for px_, pz_ in pts) < 4.0 or inside(pts, sx, sz): return True
        return False
    for f, m in zip(blds, foot):
        m = m & land; area_c = float(m.sum() * cell * cell)
        if area_c < (4 if cell <= 1 else 8): continue
        ring = max(f['geometry']['rings'], key=len); pts = [XZ(q[0], q[1]) for q in ring]
        if len(pts) > 1 and pts[0] == pts[-1]: pts = pts[:-1]
        if len(pts) < 3: continue
        area = abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2
        c, axis, hl, hs, rect = min_rect(pts); gm = ground[grow1(m)]
        name = attr(f, 'name') or ''; church = 'kirkj' in name.lower()
        roof_map = next((c_['roof'] for c_ in churches if c_['id'] is not None and c_['id'] == attr(f, 'building_id')), None)
        if church:
            rh, src = (float(roof_map), 'map') if roof_map is not None and 4.0 <= roof_map <= 30.0 else (8.0, 'assumed'); eh = 0.6 * rh; kind = 'church'
        elif area < 20: eh, rh, src, kind = 1.9, 2.6, 'assumed', 'shed'
        elif area <= 300: eh, rh, src, kind = 2.6, 4.4, 'assumed', 'house'
        else: eh, rh, src, kind = 4.0, 6.0, 'assumed', 'large'
        if not church: rh = min(rh, eh + hs * math.tan(math.radians(40)))          # no roof steeper than 40 degrees
        form = 'gable' if area / max(rect, 1e-6) >= 0.6 and hs >= 1.2 else 'flat'
        if form == 'flat' and not church: rh = eh = eh + 0.4 * (rh - eh)
        base = float(np.percentile(gm, 75))                                         # the floor sits at the uphill side's ground
        rec = dict(p=[round(v, 1) for q in pts for v in q], f=round(float(gm.min()) - 0.2, 2), e=round(base + eh, 2), r=round(base + rh, 2), a=round(math.degrees(math.atan2(axis[1], axis[0])) % 180, 1),
                   c=[round(float(c[0]), 1), round(float(c[1]), 1)], hw=round(hs, 2), roof=form, k=kind, h=src)
        if at_stand(pts): rec['skip'] = 1                                           # never a wall or a roof under the camera
        ii, jj = np.nonzero(m); bvec.append(rec); bcells.append((ii, jj))
        binfo.append(dict(id=attr(f, 'building_id'), name=name or None, lat=round(float(LA[ii, jj].mean()), 6), lng=round(float(LN[ii, jj].mean()), 6), m2=round(area), kind=kind, roof=form, eave_m=round(eh, 1), ridge_m=round(rh, 1),
                          height_from=src, sketched=f['sketched'], church=church, year=attr(f, 'construction_year'), skip=bool(rec.get('skip'))))
    # --- towers and lighthouses: mapped as points only (topo/topo_20/MapServer/85). A 4 m square, 6 m high: both assumed.
    for f in ag.features('topo/topo_20/MapServer/85', box):
        if not f.get('geometry') or 'x' not in f['geometry']: continue
        lo, la = f['geometry']['x'], f['geometry']['y']; x, z = XZ(lo, la)
        if not (2 < x < n * cell - 2 and 2 < z < n * cell - 2) or not land[int(z / cell), int(x / cell)]: continue
        if any(math.hypot(r_['c'][0] - x, r_['c'][1] - z) < 8 for r_ in bvec): continue
        g0 = float(ground[int(z / cell), int(x / cell)]); pts = [(x - 2, z - 2), (x + 2, z - 2), (x + 2, z + 2), (x - 2, z + 2)]
        rec = dict(p=[round(v, 1) for q in pts for v in q], f=round(g0 - 0.5, 2), e=round(g0 + 6, 2), r=round(g0 + 6, 2), a=0.0, c=[round(x, 1), round(z, 1)], hw=2.0, roof='flat', k='tower', h='assumed')
        if at_stand(pts): rec['skip'] = 1
        ii, jj = np.nonzero(np.hypot((LN - lo) * kxl, (LA - la) * kz) <= max(2.0, cell)); bvec.append(rec); bcells.append((ii, jj))
        binfo.append(dict(id=None, name=attr(f, 'NAM', 'name'), lat=round(la, 6), lng=round(lo, 6), m2=16, kind='tower', roof='flat', eave_m=6.0, ridge_m=6.0, height_from='assumed', sketched=False, church=False, year=None, skip=bool(rec.get('skip')), tower=True))
    # --- streams: the mapped centre lines at their mapped width
    s1 = ag.features('lendiskort/us_lendiskort/MapServer/106', box); s2 = ag.features('topo/topo_20/MapServer/108', box)
    wpx = lambda w: max(1.0, (w or 1.0) / cell)
    r1 = raster(n, box, [f['geometry']['paths'] for f in s1 if f.get('geometry', {}).get('paths')], 'line', [wpx(1.5)] * len(s1)) > 0.5 if s1 else np.zeros((n, n), bool)
    s2 = [f for f in s2 if f.get('geometry', {}).get('paths')]
    r2 = raster(n, box, [f['geometry']['paths'] for f in s2], 'line', [wpx(attr(f, 'WID')) for f in s2]) > 0.5 if s2 else np.zeros((n, n), bool)
    r2_new = r2 & ~grow(r1, round(14 / cell)) if r1.any() else r2
    lab2, k2 = ndimage.label(r2_new, structure=np.ones((3, 3)))
    if k2:   # a topo line is added only as a real stretch (30 m and up), not as crumbs beside an agency line
        sizes = ndimage.sum(r2_new, lab2, range(1, k2 + 1)); r2_new = np.isin(lab2, [i + 1 for i in range(k2) if sizes[i] * cell >= 30])
    stream = (r1 | r2_new) & land & ~lake
    falls = [dict(name=attr(f, 'name', 'NAM'), lat=round(f['geometry']['y'], 6), lng=round(f['geometry']['x'], 6)) for f in ag.features('topo/topo_20/MapServer/81', box) if f.get('geometry')]
    # --- the heights file is the ground (water flat); the mask: 0 ground, 3 sea or lake, 4 stream (a fall where it runs steep)
    mask = np.zeros((n, n), np.uint8); mask[stream] = 4; mask[sea | lake] = 3
    gy, gx = np.gradient(ground, cell); slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    info = dict(void=float(void.mean()), sea=float(sea.mean()), land_outside_coast_m2=float(keep.sum() * cell * cell), cliff_foot_flattened_m2=float((high_out & ~keep).sum() * cell * cell),
                lakes=lake_info, lake_m2=float(lake.sum() * cell * cell), stream_cells=int(stream.sum()), stream_m=float(stream.sum() * cell / max(1.0, wpx(1.5))),
                stream_lines=dict(agency=len(s1), topo=len(s2), topo_added_cells=int((r2_new & land & ~lake).sum())), stream_steep_m=float((stream & (slope > 45)).sum() * cell),
                waterfalls=falls, buildings=binfo, height_min=float(ground.min()), height_max=float(ground.max()))
    return dict(raw=raw, ground=ground, mask=mask, sea=sea, lake=lake, stream=stream, slope=slope, LA=LA, LN=LN, blds=blds, bvec=bvec, bcells=bcells), info


def inside(pts, x, z):
    c = False
    for i in range(len(pts)):
        (x0, z0), (x1, z1) = pts[i], pts[(i + 1) % len(pts)]
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) / (z1 - z0) * (x1 - x0): c = not c
    return c

def min_rect(pts):
    """The smallest rectangle round an outline: (centre, unit vector along its long side, half long side, half short side, area)."""
    from scipy.spatial import ConvexHull
    P = np.asarray(pts, float)
    try: H = P[ConvexHull(P).vertices]
    except Exception: H = P
    best = None
    for i in range(len(H)):
        e = H[(i + 1) % len(H)] - H[i]; L = float(np.hypot(*e))
        if L < 1e-6: continue
        u = e / L; v = np.array([-u[1], u[0]]); a = H @ u; b_ = H @ v; area = (a.max() - a.min()) * (b_.max() - b_.min())
        if best is None or area < best[0]: best = (area, u, v, a.min(), a.max(), b_.min(), b_.max())
    area, u, v, a0, a1, b0, b1 = best; c = u * (a0 + a1) / 2 + v * (b0 + b1) / 2
    return (c, u, (a1 - a0) / 2, (b1 - b0) / 2, area) if a1 - a0 >= b1 - b0 else (c, v, (b1 - b0) / 2, (a1 - a0) / 2, area)


# One calm tone for every photo: each survey's land colours are pulled most of the way to the same middle colour and
# its colour swings damped, so a 2009 plane photo (brown) and a 2023 drone photo (acid green) end up close, and no
# box is louder than another. Y = brightness, Cb = blue - Y, Cr = red - Y.
TONE = (108.0, -24.0, -7.0); SEA_TONE = (40.0, 66.0, 88.0)

def photo(pid, box, side_m, sea, ag, P=PHOTO):
    """The aerial photo on a box's lat / lng grid, P x P: as served, and graded (one tone, no-data filled, sea one colour);
    plus the surveys under it. sea = P x P, True where the agency's coastline says sea."""
    from PIL import Image
    from scipy import ndimage
    north, south, west, east = box
    w = 4096; h = int(round(w * (north - south) / (east - west)))
    if h > 4096: h = 4096; w = int(round(h * (east - west) / (north - south)))
    q = dict(bbox=f"{west},{south},{east},{north}", bboxSR=4326, imageSR=4326, size=f"{w},{h}", format='png24', f='json')
    key = f"{ag.cache}/photo_{pid}_{hashlib.sha1(json.dumps([box, w, h]).encode()).hexdigest()[:10]}.png"
    if not os.path.exists(key):
        d = ag.get('myndakort/myndakort_fotm/MapServer/export', q, keep=False); e = d['extent']
        tol = (east - west) / w * 0.75   # the server may snap the box by part of a pixel; more than that is not this box
        assert abs(e['xmin'] - west) < tol and abs(e['xmax'] - east) < tol and abs(e['ymin'] - south) < tol and abs(e['ymax'] - north) < tol, f"the photo came back for another box: {e}"
        img = ag.get(d['href'], binary=True, keep=False); open(key + '.tmp', 'wb').write(img); os.replace(key + '.tmp', key)
        json.dump(dict(asked=q, extent=e, width=d['width'], height=d['height'], scale=d.get('scale')), open(key + '.json', 'w'))
    meta = json.load(open(key + '.json'))
    rgb0 = np.asarray(Image.open(key).convert('RGB').resize((P, P), Image.LANCZOS)).astype(np.float32)
    land = ~sea
    # the surveys: the map service's own footprints, newest (highest z order) on top
    fps = [f for f in ag.features('myndakort/myndakort_fotm/MapServer/2', box) if f['attributes'].get('Category') == 1 and f.get('geometry', {}).get('rings')]
    fps.sort(key=lambda f: f['attributes'].get('ZOrder') or 0)
    top = np.full((P, P), -1, np.int16); surveys = []
    for i, f in enumerate(fps):
        m = raster(P, box, [f['geometry']['rings']], 'poly') > 0.5
        top[m] = i; a_ = f['attributes']
        surveys.append(dict(name=a_.get('ProductName') or a_.get('Name'), file=a_.get('Name'), year=a_.get('raster_capture_year'), cm=a_.get('raster_resolution'), aircraft='drone' if a_.get('aircraft') == 6 else 'plane' if a_.get('aircraft') in (1, 2, 3) else str(a_.get('aircraft')), zorder=a_.get('ZOrder')))
    for i, s_ in enumerate(surveys): s_['share'] = round(float((top == i).mean()), 4); s_['land_share'] = round(float(((top == i) & land).sum() / max(1, land.sum())), 4)
    # no data: pure white patches
    white = (rgb0.min(2) >= 250)
    lab, k = ndimage.label(white); nod = np.zeros((P, P), bool)
    if k:
        sizes = ndimage.sum(white, lab, range(1, k + 1)); nod = np.isin(lab, [i + 1 for i in range(k) if sizes[i] >= 1500])
    nod |= top < 0
    nod = ndimage.binary_dilation(nod, iterations=2) & (white | (top < 0) | ndimage.binary_dilation(nod, iterations=1))
    # the grade, survey by survey
    Y = 0.299 * rgb0[..., 0] + 0.587 * rgb0[..., 1] + 0.114 * rgb0[..., 2]; Cb = rgb0[..., 2] - Y; Cr = rgb0[..., 0] - Y
    Y2, Cb2, Cr2 = Y.copy(), Cb.copy(), Cr.copy(); ok = land & ~nod; done = np.zeros((P, P), bool); fix = []
    def pull(m, sel, label):
        mY, sY, mb, mr = float(Y[sel].mean()), float(Y[sel].std()), float(Cb[sel].mean()), float(Cr[sel].mean()); g = min(1.12, max(0.8, 36.0 / max(sY, 1.0)))
        Y2[m] = (Y[m] - mY) * g + mY + 0.6 * (TONE[0] - mY); Cb2[m] = (Cb[m] - mb) * 0.7 + mb + 0.75 * (TONE[1] - mb); Cr2[m] = (Cr[m] - mr) * 0.7 + mr + 0.75 * (TONE[2] - mr)
        fix.append(f"{label}: middle colour ({mY + mr:.0f}, {(mY - 0.299 * (mY + mr) - 0.114 * (mY + mb)) / 0.587:.0f}, {mY + mb:.0f}) pulled to the common tone")
    if ok.sum() > 2000:
        for i in range(len(surveys)):
            m = top == i; sel = m & ok
            if sel.sum() > max(4000, 0.005 * ok.sum()): pull(m, sel, f"{surveys[i]['file']} ({surveys[i]['year']})"); done |= m
        if (~done & ok).sum() > 0: pull(~done, ok, 'the rest')
    R = Y2 + Cr2; B = Y2 + Cb2; G = (Y2 - 0.299 * R - 0.114 * B) / 0.587; rgb = np.clip(np.stack([R, G, B], -1), 0, 255)
    if nod.any():      # no data on land takes the nearest photo colour
        idx = ndimage.distance_transform_edt(nod | sea, return_distances=False, return_indices=True); rgb = np.where((nod & land)[..., None], rgb[idx[0], idx[1]], rgb)
    wsea = ndimage.gaussian_filter(sea.astype(np.float32), 1.2)[..., None]         # the sea: one colour everywhere, a soft edge at the shore
    rgb = rgb * (1 - wsea) + np.array(SEA_TONE, np.float32)[None, None, :] * wsea
    tint = [int(round(float(v))) for v in np.median(rgb[ok][::7], 0)] if ok.sum() > 2000 else [100, 118, 84]
    stats = dict(asked_px=[meta['width'], meta['height']], m_per_px=round(side_m / P, 3), surveys=surveys, nodata_share=round(float(nod.mean()), 4), nodata_land_share=round(float((nod & land).sum() / max(1, land.sum())), 4), fixes=fix, tint=tint)
    return rgb0.astype(np.uint8), np.clip(rgb, 0, 255).astype(np.uint8), top, nod, stats


def align_check(rgb, b, arr):
    """How well the photo sits on the building outlines: the photo's edge strength along the outlines, for the outlines
    as they are and shifted up to 6 m each way. Aligned = the best shift is (0, 0) or a pixel off."""
    from scipy import ndimage
    P = rgb.shape[0]; box = b['box']
    rings = [[[p[:2] for p in r] for r in f['geometry']['rings']] for f in arr['blds']]
    if len(rings) < 5: return None
    line = raster(P, box, rings, 'line', [1.0] * len(rings)) > 0.5
    g = rgb.astype(np.float32).mean(2); g = ndimage.gaussian_filter(g, 1.0)
    e = np.hypot(ndimage.sobel(g, 0), ndimage.sobel(g, 1))
    px = b['side'] / P; k = int(round(6 / px)); best = None; zero = None; ii, jj = np.nonzero(line)
    ok = (ii >= k) & (ii < P - k) & (jj >= k) & (jj < P - k); ii, jj = ii[ok], jj[ok]
    if len(ii) < 300: return None
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            v = float(e[ii + dy, jj + dx].mean())
            if (dy, dx) == (0, 0): zero = v
            if best is None or v > best[0]: best = (v, dy, dx)
    return dict(outline_px=int(len(ii)), best_shift_m=[round(best[2] * px, 2), round(-best[1] * px, 2)], edge_at_best=round(best[0], 1), edge_at_zero=round(zero, 1), edge_far=round(float(e[ii + k, jj + k].mean()), 1))


def save_jpeg(path, rgb, limit=500_000):
    from PIL import Image
    im = Image.fromarray(rgb)
    for size in (rgb.shape[0], 1536):
        j = im if size == rgb.shape[0] else im.resize((size, size), Image.LANCZOS)
        for q in (84, 78, 72, 66, 60, 54):
            buf = io.BytesIO(); j.save(buf, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=2)
            if buf.tell() <= limit: open(path, 'wb').write(buf.getvalue()); return size, q, buf.tell()
    open(path, 'wb').write(buf.getvalue()); return size, q, buf.tell()


def look(path, rgb, arr, b, info):
    """Top-down: the photo, with the building outlines (red), the water mask (blue), the pins (yellow = stand, white = subject)."""
    from PIL import Image, ImageDraw
    P = rgb.shape[0]; box = b['box']; north, south, west, east = box; k = P // b['n']
    up = lambda m: np.repeat(np.repeat(m, k, 0), k, 1)
    im = rgb.astype(np.float32); w = up(arr['mask'] >= 3)
    im[w] = im[w] * 0.45 + np.array([30, 110, 255], np.float32) * 0.55
    im = Image.fromarray(im.astype(np.uint8)); dr = ImageDraw.Draw(im)
    X = lambda x: (x - west) / (east - west) * P; Y = lambda y: (north - y) / (north - south) * P
    for f in arr['blds']:
        for r in f['geometry']['rings']: dr.line([(X(p[0]), Y(p[1])) for p in r], fill=(255, 30, 30), width=2)
    for la, lo in b['near'] + [p for p in b['far'] if south < p[0] < north and west < p[1] < east]: dr.ellipse([X(lo) - 9, Y(la) - 9, X(lo) + 9, Y(la) + 9], outline=(255, 255, 255), width=4)
    for la, lo in b['stands']: dr.ellipse([X(lo) - 9, Y(la) - 9, X(lo) + 9, Y(la) + 9], outline=(255, 235, 0), width=4); dr.line([X(lo) - 14, Y(la), X(lo) + 14, Y(la)], fill=(255, 235, 0), width=2); dr.line([X(lo), Y(la) - 14, X(lo), Y(la) + 14], fill=(255, 235, 0), width=2)
    for f in info['waterfalls']: dr.rectangle([X(f['lng']) - 7, Y(f['lat']) - 7, X(f['lng']) + 7, Y(f['lat']) + 7], outline=(0, 255, 255), width=3)
    im.resize((1280, 1280), Image.LANCZOS).save(path, quality=86)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('cmd', choices=['plan', 'build']); ap.add_argument('work')
    ap.add_argument('--trip'); ap.add_argument('--pins'); ap.add_argument('--q')
    ap.add_argument('--region', default='faroes'); ap.add_argument('--prefix', default='fod')
    ap.add_argument('--close-fine', type=float, default=600.0, help='a subject this close to its stand spot is kept in a 1 m box'); ap.add_argument('--close', type=float, default=1500.0, help='... and up to this far in a 2 m box')
    ap.add_argument('--only', help='comma list of box ids'); ap.add_argument('--pace', type=float, default=0.6, help='seconds between requests to the agency (0.5 at the least)')
    ap.add_argument('--wide-file', help="the region's wide file (fetched from the public bucket when not given)")
    ap.add_argument('--migration', default='terrain_detail_faroes.sql'); ap.add_argument('--force', action='store_true', help='keep boxes that fail the data check'); ap.add_argument('--no-near', action='store_true', help='skip the fine boxes\' photos')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True); a.pace = max(0.5, a.pace)
    if not a.pins and not a.trip and os.path.exists(f"{a.work}/pins.json"): a.pins = f"{a.work}/pins.json"
    pins = load_pins(a)
    if a.trip and not a.pins:
        q = a.q or os.environ.get('TRIP_Q')
        pins['nears'] = json.loads(subprocess.run([q, "select id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path from terrain_near_regions"], capture_output=True, text=True, check=True).stdout)
        json.dump(pins, open(f"{a.work}/pins.json", 'w'), indent=1)
    boxes = plan(pins, a)
    if a.only: boxes = [b for b in boxes if b['id'] in a.only.split(',')]
    print(f"{len(boxes)} detail boxes ({sum(1 for b in boxes if b['cell'] == 1.0)} at 1 m cells / 1,024 m, {sum(1 for b in boxes if b['cell'] == 2.0)} at 2 m cells / 2,048 m):")
    for b in boxes:
        print(f"  {b['id']}: {b['box'][0]}..{b['box'][1]}, {b['box'][2]}..{b['box'][3]}, {b['side']:.0f} m ({b['cell']:g} m cells), fine box {', '.join(b['fine']) or 'NONE'}: {', '.join(b['stops'])}; {len(b['stands'])} stand spots, {len(b['near'])} subjects inside, {len(b['far'])} beyond"
              + ''.join(f"\n      [NOTE] {t}" for t in b['notes']))
    if a.cmd == 'plan': return

    F, RAW, LOOK, C = (f"{a.work}/{d}" for d in ('files', 'raw', 'look', 'cache'))
    for d in (F, RAW, LOOK, C): os.makedirs(d, exist_ok=True)
    ag = Agency(f"{C}/us", a.pace); adem = f"{C}/adem"; os.makedirs(adem, exist_ok=True)
    shots = pins['shots']; lats = [s['vlat'] for s in shots]; lngs = [s['vlng'] for s in shots]
    plane = sea_plane(adem, min(lats), max(lats), min(lngs), max(lngs))
    print(f"sea level in ArcticDEM: a plane from {plane['blocks']} water blocks, worst miss {plane['worst']:.2f} m")
    region = next(r for r in pins['regions'] if r['id'] == a.region); wbox = (region['north'], region['south'], region['west'], region['east'])
    wpath = a.wide_file or f"{C}/{region['path']}"
    if not os.path.exists(wpath): assert subprocess.run(["curl", "-sS", "-f", "-m", "180", "-o", wpath, FILES_URL + region['path']]).returncode == 0, 'could not fetch the wide file: give --wide-file'
    wide = read_png(wpath, region['base_m'], region['step_m'])
    # the coast, once for all boxes
    print("coastline: the agency's islands and holms + the topo map's islands and skerries ...", flush=True)
    land_shapes = [f['geometry']['rings'] for f in ag.features('lendiskort/us_lendiskort/MapServer/15', fields='name,feature_type') if f.get('geometry', {}).get('rings')]
    n_main = len(land_shapes)
    land_shapes += [f['geometry']['rings'] for f in ag.features('topo/topo_20/MapServer/142', fields='OBJECTID') if f.get('geometry', {}).get('rings')]
    print(f"  {n_main} islands / holms, {len(land_shapes) - n_main} topo islands and skerries")

    rows, uploads, left, cov_boxes, stopdiff = [], [], [], {}, []
    for b in boxes:
        t0 = time.time(); bid, box, n, cell = b['id'], b['box'], b['n'], b['cell']; say = lambda s: print('  ' + s, flush=True)
        print(f"\n{bid} ({', '.join(b['stops'])})", flush=True)
        arr, info = build_box(b, ag, land_shapes, adem, plane, say)
        # the data check: this box's ground against Copernicus and the wide file; the stops' stored heights are pooled below
        v = check(arr['ground'], box, {'stops': pins.get('stops', []), 'known': pins.get('known', [])}, C, f"detail box {bid} (ground)", wide=(wide, wbox))
        for s in pins.get('stops', []):
            if s.get('elevation_m') is None: continue
            la, lo = s.get('elevation_lat') or s['lat'], s.get('elevation_lng') or s['lng']
            if box[1] < la < box[0] and box[2] < lo < box[3]: stopdiff.append((s['name'], bid, float(at(arr['ground'], box, np.array([la]), np.array([lo]))[0]) - float(s['elevation_m'])))
        cc = contour_check(ag, arr['ground'], box, ~arr['sea'], cell)
        if cc:   # the agency's contours decide; the wide file must still agree (the page blends the two)
            k = 200; la_ = box[0] - (np.arange(k) + .5) * (box[0] - box[1]) / k; lo_ = box[2] + (np.arange(k) + .5) * (box[3] - box[2]) / k
            dfw = at(arr['ground'], box, la_[:, None] + 0 * lo_[None, :], lo_[None, :] + 0 * la_[:, None]) - at(wide, wbox, la_[:, None] + 0 * lo_[None, :], lo_[None, :] + 0 * la_[:, None]); dfw = dfw[~np.isnan(dfw)]
            vw = 'FAIL' if abs(np.median(dfw)) > 5 else 'WARN' if abs(np.median(dfw)) > 2 else 'PASS'
            say(f"[{cc['verdict']}] the agency's 50 m contours, {cc['judged_on']} ({cc['points']:,} points, {len(cc['levels'])} levels): ground minus contour: middle {cc['middle_m']:+.1f} m, {cc['within_10m']:.0%} within 10 m, {cc['within_15m']:.0%} within 15 m"
                + (f"; steeper ground ({cc['steep_share']:.0%} of the points): middle {cc['steep_middle_m']:+.1f} m, {cc['steep_within_15m']:.0%} within 15 m" if cc['steep_middle_m'] is not None else '')
                + (f"  (Copernicus said {v}: overruled, it is a 30 m radar model and wrong on steep sea slopes)" if v != cc['verdict'] else ''))
            v = max((cc['verdict'], vw), key=['PASS', 'WARN', 'FAIL'].index)
        else: say("no 50 m contour of the agency's crosses the box: the verdict is the Copernicus one")
        if v == 'FAIL' and not a.force: say('FAILED the data check: left out'); left.append((bid, b['stops'], 'failed the data check')); continue
        from PIL import Image
        up = lambda m_: np.repeat(np.repeat(m_, PHOTO // n, 0), PHOTO // n, 1)
        rgb0, rgb, top, nod, pst = photo(bid, box, b['side'], up(arr['sea']), ag)
        al = align_check(rgb0, b, arr)
        # colours the page needs beside the photo: each roof's own (the photo's middle colour over the outline, calmed),
        # its walls (a darker neutral of the same hue), and the rock of the box (the photo's steep ground, darkened)
        small = np.asarray(Image.fromarray(rgb).resize((n, n), Image.BILINEAR)).astype(np.float32)
        for rec, (ii, jj) in zip(arr['bvec'], arr['bcells']):
            c_ = np.median(small[ii, jj], 0) if len(ii) else np.array([120.0, 118, 112]); g_ = float(c_ @ np.array([0.299, 0.587, 0.114]))
            roof = g_ + (c_ - g_) * 0.7; wall = (g_ + (c_ - g_) * 0.35) * 0.72 + 14
            rec['rc'] = [int(round(float(v))) for v in np.clip(roof, 0, 255)]; rec['wc'] = [int(round(float(v))) for v in np.clip(wall, 0, 255)]
        steep = (arr['slope'] > 38) & (arr['slope'] < 60) & ~arr['sea']
        rock = np.percentile(small[steep], 35, axis=0) * 0.85 if steep.sum() > 400 else np.array(pst['tint'], float) * 0.6 + 20
        rock = [int(round(float(rock.mean() + (v - rock.mean()) * 0.6))) for v in rock]
        hp, mp, jp, bp = f"{F}/{bid}_ground.png", f"{F}/{bid}_mask.png", f"{F}/{bid}_photo.jpg", f"{F}/{bid}_bld.json"
        base_m = math.floor(float(arr['ground'].min())) - 5
        write_heights(hp, arr['ground'], base_m, STEP); write_mask(mp, arr['mask'])
        assert np.abs(read_png(hp, base_m, STEP) - arr['ground']).max() <= STEP / 2 + 1e-6 and (read_mask(mp) == arr['mask']).all()
        jsize, jq, jbytes = save_jpeg(jp, rgb)
        json.dump(dict(v=1, box=bid, units="metres from the box's north-west corner: x east, z south; f / e / r = foot, eave, ridge in the heights file's metres; a = ridge direction, degrees from east toward south; hw = half the short side",
                       heights='assumed', sun_checks=False, credit='Umhvørvisstovan: Bygningar (webservice, November 2026)', b=arr['bvec']), open(bp, 'w'), separators=(',', ':'), ensure_ascii=False)
        np.savez_compressed(f"{RAW}/{bid}.npz", box=np.array(box), cell=cell, raw=arr['raw'].astype(np.float32), ground=arr['ground'].astype(np.float32), mask=arr['mask'], sea=arr['sea'], lake=arr['lake'], stream=arr['stream'], photo_survey=top, photo_nodata=nod)
        Image.fromarray(rgb0).save(f"{RAW}/{bid}_photo_as_served.jpg", quality=90)
        look(f"{LOOK}/{bid}.jpg", rgb, arr, b, info)
        bl = info['buildings']; drawn = [x for x in bl if not x['skip']]
        src = {k: sum(1 for x in drawn if x['kind'] == k) for k in ('house', 'shed', 'large', 'church', 'tower')}
        say(f"ground {arr['ground'].min():.1f}..{arr['ground'].max():.1f} m; sea {info['sea']:.0%} of the box; no ArcticDEM data {info['void']:.2%}; kept as land outside the coastline {info['land_outside_coast_m2']:,.0f} m2, cliff foot beyond the line flattened {info['cliff_foot_flattened_m2']:,.0f} m2")
        say(f"buildings {len(drawn)} ({sum(x['m2'] for x in drawn):,} m2; {len(bl) - len(drawn)} at the stand spot marked skip): " + ', '.join(f"{k} {v_}" for k, v_ in src.items()) + f"; gable roofs {sum(1 for x in drawn if x['roof'] == 'gable')}, flat {sum(1 for x in drawn if x['roof'] == 'flat')}; heights from the map {sum(1 for x in drawn if x['height_from'] == 'map')}")
        say(f"water: lakes {len(info['lakes'])} ({info['lake_m2'] / 1e4:.2f} ha) {[l['name'] or 'unnamed' for l in info['lakes']][:4]}, stream lines agency {info['stream_lines']['agency']} / topo {info['stream_lines']['topo']} -> {info['stream_cells']:,} cells ({info['stream_steep_m']:.0f} m of them on ground steeper than 45 deg), waterfall points {[f_['name'] for f_ in info['waterfalls']]}")
        say(f"photo: {', '.join(str(s_['file']) + ' ' + str(s_['year']) + ' ' + format(s_['share'], '.0%') for s_ in pst['surveys'])}; no data {pst['nodata_share']:.1%} of the box ({pst['nodata_land_share']:.1%} of the land); tone after: {pst['tint']}, rock {rock}")
        say(f"photo on the outlines: {al if al else 'too few buildings to check'}")
        hs, ms, bs = os.path.getsize(hp), os.path.getsize(mp), os.path.getsize(bp)
        say(f"files: heights {hs / 1e3:.0f} KB, mask {ms / 1e3:.1f} KB, photo {jbytes / 1e3:.0f} KB ({jsize} px, quality {jq}), buildings {bs / 1e3:.1f} KB; check {v}; {time.time() - t0:.0f} s")
        rows.append(dict(id=bid, parent=a.region, north=box[0], south=box[1], west=box[2], east=box[3], n=n, width_m=round((box[3] - box[2]) * b['kx'], 1), depth_m=round((box[0] - box[1]) * 111132, 1),
                         base_m=base_m, step_m=STEP, cell_m=cell, path=os.path.basename(hp), bytes=hs, mask_path=os.path.basename(mp), mask_bytes=ms, color_path=os.path.basename(jp), color_bytes=jbytes, color_px=jsize,
                         buildings_path=os.path.basename(bp) if arr['bvec'] else None, buildings_bytes=bs if arr['bvec'] else None, tint=pst['tint'], rock=rock,
                         note=f"ArcticDEM v4.1 2 m ground (no buildings in it), water classes, aerial photo and {len(drawn)} building outlines (heights assumed) from Umhvørvisstovan."))
        uploads += [hp, mp, jp] + ([bp] if arr['bvec'] else [])
        cov_boxes[bid] = dict(box=box, cell_m=cell, stops=b['stops'], fine_box=b['fine'], notes=b['notes'], check=v, contours=cc, photo=pst, align=al, buildings=len(drawn), buildings_skipped=len(bl) - len(drawn), kinds=src,
                              churches=[x for x in bl if x['church']], lakes=info['lakes'], stream_cells=info['stream_cells'], stream_steep_m=info['stream_steep_m'], waterfalls=info['waterfalls'], sea_share=round(info['sea'], 3),
                              bytes=dict(heights=hs, mask=ms, photo=jbytes, buildings=bs if arr['bvec'] else 0), building_list=bl, top=None)
        cov_boxes[bid]['_top'] = top; cov_boxes[bid]['_arr'] = dict(mask=arr['mask'], ground=arr['ground'])

    # one photo per 4 m fine box too (colour beyond the detail box: far cliffs, stacks, the village across the fjord)
    nrows = []
    if not a.only and not a.no_near:
        for nr in [r for r in pins.get('nears', []) if r['parent'] == a.region]:
            nbox = (nr['north'], nr['south'], nr['west'], nr['east']); t0 = time.time(); P = 2048
            sea_n = ~(raster(P, nbox, land_shapes, 'poly') > 0.5)
            _, rgbn, topn, nodn, pn = photo(nr['id'], nbox, max(nr['width_m'], nr['depth_m']), sea_n, ag, P)
            jp = f"{F}/{nr['id']}_photo.jpg"; jsize, jq, jbytes = save_jpeg(jp, rgbn, 600_000)
            Image.fromarray(rgbn).resize((1024, 1024)).save(f"{LOOK}/{nr['id']}_photo.jpg", quality=85)
            print(f"\nfine box {nr['id']}: photo {jbytes / 1e3:.0f} KB ({jsize} px, quality {jq}, {max(nr['width_m'], nr['depth_m']) / jsize:.1f} m a pixel); surveys {len(pn['surveys'])} ({', '.join(sorted({str(s_['year']) + ' ' + s_['aircraft'] for s_ in pn['surveys'] if s_['land_share'] > 0.01}))}); no data on land {pn['nodata_land_share']:.1%}; tone {pn['tint']}; {time.time() - t0:.0f} s", flush=True)
            nrows.append(dict(id=nr['id'], color_path=os.path.basename(jp), color_bytes=jbytes, color_px=jsize, tint=pn['tint'], surveys=[s_ for s_ in pn['surveys'] if s_['land_share'] > 0.01], nodata_land_share=pn['nodata_land_share'])); uploads.append(jp)
        json.dump(nrows, open(f"{a.work}/near_photos.json", 'w'), indent=1, ensure_ascii=False)

    # per shot: which box, what is under the stand spot and the subject
    built = {r['id']: r for r in rows}; cov_shots = []; unserved = []
    for s in shots:
        cands = [b for b in boxes if b['id'] in built and b['box'][1] < s['vlat'] < b['box'][0] and b['box'][2] < s['vlng'] < b['box'][3]]
        cands.sort(key=lambda b: (not (b['box'][1] < s['slat'] < b['box'][0] and b['box'][2] < s['slng'] < b['box'][3]), b['side']))
        e = dict(stop=s['stop'], subject=s['subject'], stand=[s['vlat'], s['vlng']], subject_pin=[s['slat'], s['slng']], subject_m=round(math.hypot((s['slng'] - s['vlng']) * 111320 * math.cos(math.radians(s['vlat'])), (s['slat'] - s['vlat']) * 111132)))
        if not cands: e.update(box=None, why=next((w for bid, stops, w in left if s['stop'] in stops), 'no box')); unserved.append(e); cov_shots.append(e); continue
        b = cands[0]; cb = cov_boxes[b['id']]; box = b['box']; P = cb['_top'].shape[0]
        def under(la, lo):
            if not (box[1] < la < box[0] and box[2] < lo < box[3]): return None
            i = cb['_top'][min(P - 1, int((box[0] - la) / (box[0] - box[1]) * P)), min(P - 1, int((lo - box[2]) / (box[3] - box[2]) * P))]
            sv = cb['photo']['surveys'][i] if i >= 0 else None
            return None if sv is None else f"{sv['aircraft']} {sv['year']} ({sv['name']}, {sv['cm']} cm)"
        r_, c_ = (min(b['n'] - 1, int((box[0] - s['vlat']) / (box[0] - box[1]) * b['n'])), min(b['n'] - 1, int((s['vlng'] - box[2]) / (box[3] - box[2]) * b['n'])))
        e.update(box=b['id'], cell_m=b['cell'], subject_in_box=bool(box[1] < s['slat'] < box[0] and box[2] < s['slng'] < box[3]), photo_at_stand=under(s['vlat'], s['vlng']), photo_at_subject=under(s['slat'], s['slng']),
                 stand_ground_m=round(float(cb['_arr']['ground'][r_, c_]), 1), stand_on=['ground', '', 'building', 'water', 'stream'][int(cb['_arr']['mask'][r_, c_])],
                 buildings_in_box=cb['buildings'], lakes=[l['name'] or 'unnamed' for l in cb['lakes']], stream_cells=cb['stream_cells'], waterfalls=[f['name'] for f in cb['waterfalls']], sea=cb['sea_share'] > 0.001)
        cov_shots.append(e)
    for cb in cov_boxes.values(): cb.pop('_top'); cb.pop('_arr'); cb.pop('top')
    # the pooled check of the stops' stored heights
    pooled = None
    if len(stopdiff) >= 5:
        df = np.array([d for _, _, d in stopdiff]); pooled = dict(stops=len(df), middle_m=round(float(np.median(df)), 1), within_25m=round(float(np.mean(np.abs(df) <= 25)), 2), worst=[(nm, bid, round(d)) for nm, bid, d in sorted(stopdiff, key=lambda t: -abs(t[2]))[:5]])
        print(f"\nDATA CHECK, the stops' stored heights over all boxes: {pooled['stops']} stops, box ground minus stored: middle {pooled['middle_m']:+.1f} m, {pooled['within_25m']:.0%} within 25 m; worst {pooled['worst']}"
              f"\n  => {'FAIL' if abs(pooled['middle_m']) > 10 or pooled['within_25m'] < 0.7 else 'WARN' if abs(pooled['middle_m']) > 5 or pooled['within_25m'] < 0.85 else 'PASS'}")
    json.dump(dict(credit=CREDIT, boxes=cov_boxes, shots=cov_shots, left_out=[dict(box=bid, stops=stops, why=w) for bid, stops, w in left], stored_heights=pooled, agency_requests=ag.asked), open(f"{a.work}/coverage.json", 'w'), indent=1, ensure_ascii=False)
    json.dump(rows, open(f"{a.work}/detail.json", 'w'), indent=1, ensure_ascii=False)
    open(f"{a.work}/upload.txt", 'w').write("\n".join(uploads) + "\n")

    sq = lambda v: 'null' if v is None else ("'" + v.replace("'", "''") + "'" if isinstance(v, str) else str(v))
    sql = f"""-- DRAFT, NOT APPLIED. 3D sun view, third terrain level (detail) for the Faroe Islands: real foreground around the stand spots.
-- Written by tools/sun3d/faroes/build_detail_faroes.py (round 2). No laser survey exists there, so each box is:
--   path            heights = ArcticDEM v4.1 2 m cleaned into GROUND ONLY (sea flat at 0, lakes flat, sea cliffs cut at the
--                   mapped shore, the bumps under buildings removed); the page's 16-bit format, height = base_m + value * step_m.
--                   No buildings in it, so no building can change a sun time.
--   mask_path       8-bit class mask: 0 ground, 3 sea or lake, 4 stream (a fall where it runs over steep ground). No trees, no class 2.
--   color_path      an aerial photo of the box, a square JPEG, north up, on exactly the box's lat / lng grid (row 0 = north
--                   edge, linear in lat and lng like the heights), about 0.5 m a pixel (1 m in the 2 km boxes), one calm tone
--                   for all boxes, sea one colour. Not for faces steeper than about 55 degrees: draw rock there.
--   buildings_path  NEW: the building outlines as JSON: {{"heights": "assumed", "sun_checks": false, "b": [{{p: [x, z, ...] outline in
--                   metres from the box's north-west corner (x east, z south), f / e / r: foot, eave and ridge heights (the
--                   heights file's metres), a: ridge direction (degrees from east toward south), c: centre, hw: half the short
--                   side, roof: gable | flat, k: house | shed | large | church | tower, h: assumed | map, rc / wc: roof and wall
--                   colour, skip: 1 = at the stand spot, do not draw}}]}}. Heights are ASSUMED (the outlines carry none): draw
--                   them, let them throw a drawn shadow if wanted, but never count them in "in the sun" / first and last light.
-- And one photo per 4 m fine box (terrain_near_regions.color_path), for colour beyond the detail box.
-- Credit, wherever these are shown: {CREDIT}
--
-- Before applying: upload the files listed in upload.txt to bucket `terrain`.
alter table public.terrain_detail_regions add column if not exists color_path text, add column if not exists color_bytes integer,
  add column if not exists buildings_path text, add column if not exists buildings_bytes integer;
alter table public.terrain_near_regions add column if not exists color_path text, add column if not exists color_bytes integer;
"""
    if rows:
        cols = ('id', 'parent', 'north', 'south', 'west', 'east', 'n', 'width_m', 'depth_m', 'base_m', 'step_m', 'cell_m', 'path', 'bytes', 'mask_path', 'mask_bytes', 'color_path', 'color_bytes', 'buildings_path', 'buildings_bytes', 'note')
        sql += f"\ninsert into public.terrain_detail_regions ({', '.join(cols)}) values\n" + ",\n".join("  (" + ", ".join(sq(r[k]) for k in cols) + ")" for r in rows) + "\non conflict (id) do nothing;\n"
    if nrows: sql += "\n" + "\n".join(f"update public.terrain_near_regions set color_path = {sq(r['color_path'])}, color_bytes = {r['color_bytes']} where id = {sq(r['id'])};" for r in nrows) + "\n"
    if left: sql += "\n-- No detail box: " + "; ".join(f"{', '.join(stops)} ({why})" for _, stops, why in left) + "\n"
    open(a.migration if os.path.isabs(a.migration) else f"{a.work}/{a.migration}", 'w').write(sql)
    tot = sum(os.path.getsize(p) for p in uploads)
    print("\nbox | cells | heights KB | mask KB | photo KB | buildings KB | buildings | lakes | stream cells | photo surveys | photo vs outlines (best shift m)")
    for r in rows:
        cb = cov_boxes[r['id']]
        print(f"{r['id']} | {r['cell_m']:g} m | {r['bytes'] / 1e3:.0f} | {r['mask_bytes'] / 1e3:.1f} | {r['color_bytes'] / 1e3:.0f} | {(r['buildings_bytes'] or 0) / 1e3:.1f} | {cb['buildings']} | {len(cb['lakes'])} | {cb['stream_cells']:,} | "
              f"{', '.join(str(s_['year']) + ' ' + s_['aircraft'] for s_ in cb['photo']['surveys'] if s_['share'] > 0.01)} | {cb['align']['best_shift_m'] if cb['align'] else ''}")
    print(f"\n{len(rows)} boxes + {len(nrows)} fine-box photos, {len(uploads)} files, {tot / 1e6:.1f} MB (heights {sum(r['bytes'] for r in rows) / 1e6:.1f}, masks {sum(r['mask_bytes'] for r in rows) / 1e6:.2f}, photos {sum(r['color_bytes'] for r in rows) / 1e6:.1f}, "
          f"buildings {sum(r['buildings_bytes'] or 0 for r in rows) / 1e6:.2f}, fine-box photos {sum(r['color_bytes'] for r in nrows) / 1e6:.1f}); {ag.asked} requests to the agency this run")
    if unserved: print("SHOTS WITH NO BOX: " + "; ".join(f"{e['stop']} / {e['subject']} ({e['why']})" for e in unserved))
    if left: print("LEFT OUT: " + "; ".join(f"{bid}: {', '.join(stops)} ({why})" for bid, stops, why in left))
    print("Nothing was uploaded or applied.")

if __name__ == '__main__': main()
