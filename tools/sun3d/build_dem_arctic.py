#!/usr/bin/env python3
"""Build one elevation file for the 3D sun view from ArcticDEM v4.1 mosaics (north of 60 N only).

  build_dem_arctic.py <work dir> <out.png> <north> <south> <west> <east> [n=2048] [res=auto|2|4|10|32]

Why not the terrarium tiles (build_dem.py) in the Faroes: there the land is ~58 m too high (heights above the
ellipsoid, not sea level), fjords and sounds are filled with blocks at 0-130 m (so the sea draws as land), and
sea stacks and small islands are missing. ArcticDEM v4.1 (Polar Geospatial Center, CC-BY-4.0, public bucket
pgc-opendata-dems.s3.us-west-2.amazonaws.com) has them, with open water filled at the local sea level.

What this does: finds the mosaic tiles under the box (EPSG:3413), reads only the needed blocks with HTTP range
requests (curl; blocks are kept in <work dir>/adem so a rerun is free), fits the sea level as a plane from the
32 m product (the water fill follows the geoid, ~57-59 m in the Faroes), subtracts it, and sets everything
under 2 m to 0 = sea. Output: the same file format as build_dem.py, base 0, half-metre steps.
res: source pixel size in metres; auto picks 32 m for a wide grid, 10 m for a middle one, else the 2 m mosaic
(its 4 m overview when the grid is 3.5 m or coarser). Needs: numpy, tifffile, imagecodecs (pip install).
"""
import math, os, struct, subprocess, sys, zlib
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import tifffile

work, out = sys.argv[1], sys.argv[2]
NORTH, SOUTH, WEST, EAST = map(float, sys.argv[3:7])
N = int(sys.argv[7]) if len(sys.argv) > 7 else 2048
RES = sys.argv[8] if len(sys.argv) > 8 else 'auto'
BUCKET = 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/arcticdem/mosaics/v4.1'
SEA_BELOW = 2.0
cache = f"{work}/adem"; os.makedirs(cache, exist_ok=True)

# EPSG:3413 (polar stereographic north, true scale at 70 N, central meridian 45 W, WGS84)
_a = 6378137.0; _f = 1 / 298.257223563; _e = math.sqrt(2 * _f - _f * _f)
def _t(lat):
    s = np.sin(np.radians(lat)); return np.tan(np.pi / 4 - np.radians(lat) / 2) / ((1 - _e * s) / (1 + _e * s)) ** (_e / 2)
_mc = math.cos(math.radians(70)) / math.sqrt(1 - (_e * math.sin(math.radians(70))) ** 2); _t70 = float(_t(70.0))
def fwd(lat, lng):
    rho = _a * _mc * _t(lat) / _t70; th = np.radians(lng + 45)
    return rho * np.sin(th), -rho * np.cos(th)

def curl(url, rng=None):
    cmd = ["curl", "-sS", "-f", "-m", "120", "--retry", "3"] + (["-r", rng] if rng else []) + [url]
    p = subprocess.run(cmd, capture_output=True)
    return p.stdout if p.returncode == 0 else None

class Remote:
    """A read-only file over HTTP range requests, in 256 KB blocks kept on disk."""
    B = 262144
    def __init__(self, key):
        self.url = f"{BUCKET}/{key}"; self.dir = f"{cache}/{key.replace('/', '_')}"; self.pos = 0; self.mem = {}
        os.makedirs(self.dir, exist_ok=True)
        head = subprocess.run(["curl", "-sS", "-f", "-m", "60", "-I", self.url], capture_output=True)
        self.size = next((int(l.split(b':')[1]) for l in head.stdout.splitlines() if l.lower().startswith(b'content-length')), 0) if head.returncode == 0 else 0
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
    def fetch(self, blocks):   # several blocks at once
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

def window(key, level_px, x0, x1, y0, y1):
    """Heights of one mosaic file inside the 3413 box, on that file's own pixel grid: (array, left x, top y, pixel) or None."""
    r = Remote(key)
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
    print(f"  {key.split('/')[-1]}: {ps:g} m, {len(idx)} blocks, {arr.shape[1]} x {arr.shape[0]}", flush=True)
    return arr, fx + c0 * ps, fy - r0 * ps, ps

def tiles(x0, x1, y0, y1, sub):
    """Mosaic tile names under the box: 100 km supertiles row_col, or their 50 km quarters row_col_i_j for the 2 m product."""
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

lat = NORTH - (np.arange(N) + 0.5) * (NORTH - SOUTH) / N
lng = WEST + (np.arange(N) + 0.5) * (EAST - WEST) / N
LA, LN = np.meshgrid(lat, lng, indexing='ij'); X, Y = fwd(LA, LN)
mid = math.radians((NORTH + SOUTH) / 2)
width = (EAST - WEST) * 111320 * math.cos(mid); depth = (NORTH - SOUTH) * 111132
step = min(width, depth) / N
if RES == 'auto': RES = '32' if step >= 24 else '10' if step >= 7 else '4' if step >= 3.5 else '2'
px = float(RES); product = '32m' if px >= 32 else '10m' if px >= 10 else '2m'
x0, x1, y0, y1 = X.min() - 3 * px, X.max() + 3 * px, Y.min() - 3 * px, Y.max() + 3 * px
print(f"grid {N} x {N}, one point every {width / N:.1f} x {depth / N:.1f} m; source ArcticDEM v4.1 {product} at {px:g} m", flush=True)

# Sea level: the water fill follows the geoid. Fit a plane to the 32 m product's mostly-water blocks around the box.
pts = []
for name in tiles(x0 - 60000, x1 + 60000, y0 - 60000, y1 + 60000, False):
    w = window(f"32m/{name}/{name}_32m_v4.1_dem.tif", 32, -1e9, 1e9, -1e9, 1e9)
    if not w: continue
    arr, fx, fy, ps = w; K = 64
    for i in range(0, arr.shape[0] - K + 1, K):
        for j in range(0, arr.shape[1] - K + 1, K):
            b = arr[i:i + K, j:j + K]; b = b[b > -9000]
            if b.size < K * K // 2: continue
            u, c = np.unique(np.round(b, 1), return_counts=True); k = int(np.argmax(c))
            if c[k] > 0.3 * K * K: pts.append((fx + (j + K / 2) * ps, fy - (i + K / 2) * ps, float(u[k])))
assert len(pts) >= 3, "no open water near the box to take the sea level from"
P = np.array(pts); cx, cy = P[:, 0].mean(), P[:, 1].mean()
G = np.c_[np.ones(len(P)), (P[:, 0] - cx) / 1e5, (P[:, 1] - cy) / 1e5]; coef, *_ = np.linalg.lstsq(G, P[:, 2], rcond=None)
resid = P[:, 2] - G @ coef
sea = coef[0] + coef[1] * (X - cx) / 1e5 + coef[2] * (Y - cy) / 1e5
print(f"sea level in the source: {sea.min():.2f}..{sea.max():.2f} m over the box (plane from {len(P)} water blocks, worst miss {np.abs(resid).max():.2f} m)", flush=True)

wins = [w for w in (window(f"{product}/{n[:5]}/{n}_{product}_v4.1_dem.tif", px, x0, x1, y0, y1) for n in tiles(x0, x1, y0, y1, product == '2m')) if w]
assert wins, "no ArcticDEM tile under this box"
raw = sample(wins, X, Y)
h = raw - sea
void = raw < -9000
h[void | (h < SEA_BELOW)] = 0.0
iy, ix = np.unravel_index(np.argmax(h), h.shape)
print(f"heights 0..{h.max():.0f} m, highest at {lat[iy]:.4f},{lng[ix]:.4f}; sea share {np.mean(h < 0.6):.2f}; no data {np.mean(void):.4f}")
print(f"width_m {width:.0f} depth_m {depth:.0f}")
q = np.round(h * 2)
assert q.min() >= 0 and q.max() <= 65535
q = q.astype(np.int64)
p = np.zeros((N + 1, N + 1), dtype=np.int64); p[1:, 1:] = q
res = ((p[1:, 1:] - p[1:, :-1] - p[:-1, 1:] + p[:-1, :-1]) % 65536).astype('>u2')
rawb = b''.join(b'\x00' + res[i].tobytes() for i in range(N))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rawb, 9)) + chunk(b'IEND', b'')
open(out, 'wb').write(png)
print("wrote", out, len(png), "bytes")
