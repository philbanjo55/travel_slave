#!/usr/bin/env python3
"""Build one elevation file for the 3D sun view from the public terrarium tiles.

  build_dem.py <work dir> <out.png> <north> <south> <west> <east> [zoom=12] [base_m=1500] [n=2048]

Tiles are fetched with curl into <work dir>/tiles (kept, so a rerun is free) and resampled onto a
regular n x n lat/lng grid, row 0 at the north edge. Heights below 0 (sea floor in the source) become 0.
Output: a 16-bit greyscale PNG whose "pixels" are prediction residuals (left + up - upleft) of
round((h - base_m) * 2), filter 0, so the page decodes it exactly with DecompressionStream, no canvas.
Then: upload to bucket `terrain` and add the row to public.terrain_regions (width_m / depth_m are printed).
"""
import math, os, struct, subprocess, sys, zlib
import numpy as np
from PIL import Image

work, out = sys.argv[1], sys.argv[2]
NORTH, SOUTH, WEST, EAST = map(float, sys.argv[3:7])
Z = int(sys.argv[7]) if len(sys.argv) > 7 else 12
BASE = float(sys.argv[8]) if len(sys.argv) > 8 else 1500.0
N = int(sys.argv[9]) if len(sys.argv) > 9 else 2048

def tx(lng): return (lng + 180) / 360 * 2 ** Z
def ty(lat): return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** Z
X0, X1, Y0, Y1 = int(tx(WEST)) , int(tx(EAST)) + 1, int(ty(NORTH)), int(ty(SOUTH)) + 1   # one spare tile east and south for the blend
os.makedirs(f"{work}/tiles", exist_ok=True)
want = [(x, y) for x in range(X0, X1 + 1) for y in range(Y0, Y1 + 1)]
todo = [(x, y) for x, y in want if not os.path.exists(f"{work}/tiles/{Z}_{x}_{y}.png") or os.path.getsize(f"{work}/tiles/{Z}_{x}_{y}.png") == 0]
print(f"tiles: {len(want)} needed, {len(todo)} to fetch", flush=True)
for i in range(0, len(todo), 8):
    ps = [subprocess.Popen(["curl", "-sS", "-m", "60", "--retry", "3", "-o", f"{work}/tiles/{Z}_{x}_{y}.png",
                            f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"]) for x, y in todo[i:i + 8]]
    for p in ps: p.wait()

mos = np.zeros(((Y1 - Y0 + 1) * 256, (X1 - X0 + 1) * 256), dtype=np.float64)
for x, y in want:
    a = np.asarray(Image.open(f"{work}/tiles/{Z}_{x}_{y}.png").convert("RGB"), dtype=np.float64)
    mos[(y - Y0) * 256:(y - Y0 + 1) * 256, (x - X0) * 256:(x - X0 + 1) * 256] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
lat = NORTH - (np.arange(N) + 0.5) * (NORTH - SOUTH) / N
lng = WEST + (np.arange(N) + 0.5) * (EAST - WEST) / N
px = ((lng + 180) / 360 * 2 ** Z - X0) * 256 - 0.5
py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * 2 ** Z - Y0) * 256 - 0.5
x0 = np.floor(px).astype(int); fx = px - x0; y0 = np.floor(py).astype(int); fy = py - y0
A = mos[np.ix_(y0, x0)]; B = mos[np.ix_(y0, x0 + 1)]; C = mos[np.ix_(y0 + 1, x0)]; D = mos[np.ix_(y0 + 1, x0 + 1)]
h = np.maximum((A * (1 - fx) + B * fx) * (1 - fy)[:, None] + (C * (1 - fx) + D * fx) * fy[:, None], 0.0)
mid = math.radians((NORTH + SOUTH) / 2)
width = (EAST - WEST) * 111320 * math.cos(mid); depth = (NORTH - SOUTH) * 111132
iy, ix = np.unravel_index(np.argmax(h), h.shape)
print(f"heights {h.min():.0f}..{h.max():.0f} m, highest at {lat[iy]:.4f},{lng[ix]:.4f}; sea share {np.mean(h < 0.6):.2f}")
print(f"width_m {width:.0f} depth_m {depth:.0f} (one point every {width / N:.0f} x {depth / N:.0f} m)")
q = np.round((h - BASE) * 2)
assert q.min() >= 0 and q.max() <= 65535, "heights don't fit: lower base_m"
q = q.astype(np.int64)
p = np.zeros((N + 1, N + 1), dtype=np.int64); p[1:, 1:] = q
res = ((p[1:, 1:] - p[1:, :-1] - p[:-1, 1:] + p[:-1, :-1]) % 65536).astype('>u2')
raw = b''.join(b'\x00' + res[i].tobytes() for i in range(N))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
open(out, 'wb').write(png)
print("wrote", out, len(png), "bytes")
