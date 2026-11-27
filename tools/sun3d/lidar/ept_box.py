#!/usr/bin/env python3
"""Reads the points of a public USGS lidar survey (Entwine EPT on AWS) inside a small box and makes a surface grid:
the highest return per cell (trees, roofs), the ground, and the survey's class per cell.
  python3 ept_box.py <project> <lat> <lng> <half size m> <cell m> <out prefix> [max depth]"""
import sys, json, math, io, urllib.request, concurrent.futures as cf
import numpy as np, laspy
proj, lat, lng, half, cell, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
maxd = int(sys.argv[7]) if len(sys.argv) > 7 else 99
B = f'https://usgs-lidar-public.s3.us-west-2.amazonaws.com/{proj}/'
def get(u):
    for i in range(4):
        try: return urllib.request.urlopen(B + u, timeout=60).read()
        except Exception as e: err = e
    raise err
ept = json.loads(get('ept.json'))
bx = ept['bounds']; size = bx[3] - bx[0]
k = 1 / math.cos(math.radians(lat))                       # web-mercator metres per ground metre here
mx = lng * 20037508.34 / 180; my = math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi
x0, x1, y0, y1 = mx - half * k, mx + half * k, my - half * k, my + half * k
print('cube', round(size), 'm; spacing at depth 10:', round(size / ept['span'] / 1024, 2), 'm (mercator); scale', round(k, 3), flush=True)
hier = {}
def load(key):
    h = json.loads(get(f'ept-hierarchy/{key}.json'))
    for kk, v in h.items():
        d, x, y, z = map(int, kk.split('-')); s = size / (1 << d)
        if bx[0] + x * s > x1 or bx[0] + (x + 1) * s < x0 or bx[1] + y * s > y1 or bx[1] + (y + 1) * s < y0: continue
        if v == -1:
            if kk != key: load(kk)
        elif d <= maxd: hier[kk] = v
load('0-0-0-0')
keys = sorted(hier, key=lambda s: int(s.split('-')[0]))
print(len(keys), 'nodes,', sum(hier.values()), 'points in them; deepest', keys[-1].split('-')[0], flush=True)
n = int(round(2 * half / cell)); top = np.full((n, n), -1e9, np.float32); gnd = np.full((n, n), 1e9, np.float32); cls = np.zeros((n, n), np.uint8); cnt = 0
def fetch(key):
    las = laspy.read(io.BytesIO(get(f'ept-data/{key}.laz')))
    x, y, z, c = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
    m = (x >= x0) & (x < x1) & (y >= y0) & (y < y1) & (c != 7) & (c != 18)      # no noise points
    return x[m], y[m], z[m], c[m]
with cf.ThreadPoolExecutor(8) as ex:
    for x, y, z, c in ex.map(fetch, keys):
        if not len(x): continue
        cnt += len(x)
        ci = ((x - x0) / (cell * k)).astype(np.int32).clip(0, n - 1); ri = ((y1 - y) / (cell * k)).astype(np.int32).clip(0, n - 1)
        order = np.argsort(z); ci, ri, z, c = ci[order], ri[order], z[order], c[order]
        cur = top[ri, ci]; hi = z > cur          # ascending z: the last write per cell is its highest point
        top[ri[hi], ci[hi]] = z[hi]; cls[ri[hi], ci[hi]] = c[hi]
        g = c == 2
        if g.any(): np.minimum.at(gnd, (ri[g], ci[g]), z[g])
print(cnt, 'points in the box;', round(cnt / (n * n), 2), 'per cell; empty cells', int((top < -1e8).sum()), flush=True)
np.savez_compressed(out + '.npz', top=top, gnd=gnd, cls=cls, meta=np.array([lat, lng, half, cell]))
# quick look: height above ground, and the classes
from PIL import Image
g2 = np.where(gnd > 1e8, np.nan, gnd); t2 = np.where(top < -1e8, np.nan, top)
hag = np.nan_to_num(t2 - np.nanmin(np.where(np.isnan(g2), np.inf, g2)), nan=0)
rel = np.nan_to_num(t2 - g2, nan=0).clip(0, 25)
Image.fromarray((rel / 25 * 255).astype(np.uint8)).resize((n * 2, n * 2), Image.NEAREST).save(out + '_height_above_ground.png')
pal = np.zeros((256, 3), np.uint8); pal[:] = (90, 90, 90); pal[1] = (150, 150, 150); pal[2] = (235, 235, 235); pal[3] = (120, 170, 90); pal[4] = (70, 140, 60); pal[5] = (30, 100, 40); pal[6] = (170, 90, 50); pal[9] = (60, 110, 200); pal[17] = (120, 120, 60)
Image.fromarray(pal[cls]).resize((n * 2, n * 2), Image.NEAREST).save(out + '_classes.png')
u, c2 = np.unique(cls, return_counts=True); print('classes (2 ground, 3-5 plants, 6 building, 9 water, 1 unsorted):', dict(zip(u.tolist(), c2.tolist())))
print('tallest thing above ground:', round(float(rel.max()), 1), 'm')
