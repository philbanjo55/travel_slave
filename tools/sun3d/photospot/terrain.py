"""Our own 3D terrain, read the way the app reads it: the wide file of a region, its sharp range boxes, its fine near
boxes, plus the park-wide / village buildings (drawn as solid blocks with their roofs, so a barn can be part of the
sky line). Heights come from the public `terrain` bucket (16-bit PNG, coded as in tools/sun3d/build_trip_terrain.py).

rows.json (made by fetch_rows.sh): {"regions": [...], "range": [...], "near": [...], "houses": [...]}
"""
import json, math, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from build_trip_terrain import read_png  # noqa: E402

FILES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/'
KZ = 111132.0                  # metres per degree of latitude
R7 = 6371000 * 7 / 6           # earth radius with standard refraction (the app's sun-time rule uses the same)


def kx(lat):
    return 111320.0 * math.cos(math.radians(lat))


class Grid:
    """one height file: row 0 = north edge, bilinear inside, nan outside (or where the file has nan)"""

    def __init__(self, h, north, south, west, east, name=''):
        self.h = np.asarray(h, np.float32); self.n = self.h.shape[0]; self.m = self.h.shape[1]
        self.north, self.south, self.west, self.east, self.name = north, south, west, east, name
        self.cell = (north - south) * KZ / self.n

    def at(self, lat, lng):
        r = (self.north - lat) / (self.north - self.south) * self.n - 0.5
        c = (lng - self.west) / (self.east - self.west) * self.m - 0.5
        ok = (r >= 0) & (r <= self.n - 1.001) & (c >= 0) & (c <= self.m - 1.001)
        out = np.full(np.shape(lat), np.nan, np.float32)
        if not np.any(ok): return out
        r = r[ok]; c = c[ok]; r0 = r.astype(np.int32); c0 = c.astype(np.int32); fr = (r - r0).astype(np.float32); fc = (c - c0).astype(np.float32)
        h = self.h
        out[ok] = (h[r0, c0] * (1 - fc) + h[r0, c0 + 1] * fc) * (1 - fr) + (h[r0 + 1, c0] * (1 - fc) + h[r0 + 1, c0 + 1] * fc) * fr
        return out

    def overlaps(self, n, s, w, e):
        return self.north > s and self.south < n and self.east > w and self.west < e


def stack_at(grids, lat, lng):
    """heights from a stack of grids, finest first (the first grid that has a value wins)"""
    lat = np.asarray(lat, np.float64); lng = np.asarray(lng, np.float64)
    out = np.full(lat.shape, np.nan, np.float32)
    for g in grids:
        todo = np.isnan(out)
        if not todo.any(): break
        # cheap box test first
        inb = todo & (lat < g.north) & (lat > g.south) & (lng > g.west) & (lng < g.east)
        if inb.any(): out[inb] = g.at(lat[inb], lng[inb])
    return out


class Terrain:
    def __init__(self, rows_file, cache_dir, region):
        R = json.load(open(rows_file)); self.cache = cache_dir; self.region = region
        os.makedirs(cache_dir, exist_ok=True)
        self.wide_row = [r for r in R['regions'] if r['id'] == region][0]
        self.range_rows = [r for r in R['range'] if r['parent'] == region]
        self.near_rows = [r for r in R['near'] if r['parent'] == region]
        self.house_rows = [r for r in R.get('houses', []) if r['parent'] == region]
        self.detail_rows = [r for r in R.get('detail', []) if r['parent'] == region]
        self.tree_rows = [r for r in R.get('trees', []) if r['parent'] == region]
        self._g = {}

    def file(self, path):
        f = os.path.join(self.cache, path)
        if not os.path.exists(f) or os.path.getsize(f) == 0:
            subprocess.run(['curl', '-sSf', '-o', f, FILES_URL + path], check=True)
        return f

    def grid(self, r):
        if r['id'] not in self._g:
            h = read_png(self.file(r['path']), r['base_m'], r['step_m']).astype(np.float32)
            self._g[r['id']] = Grid(h, r['north'], r['south'], r['west'], r['east'], r['id'])
        return self._g[r['id']]

    def wide(self):
        return self.grid(self.wide_row)

    def stack(self, lat, lng, km):
        """fine-first grids that touch a box of +-km around a spot: range boxes, then near boxes, then the wide file"""
        n, s = lat + km * 1000 / KZ, lat - km * 1000 / KZ; w, e = lng - km * 1000 / kx(lat), lng + km * 1000 / kx(lat)
        out = []
        for rows in (self.range_rows, self.near_rows):
            sel = [r for r in rows if r['north'] > s and r['south'] < n and r['east'] > w and r['west'] < e]
            sel.sort(key=lambda r: (r['north'] - r['south']) / r['n'])
            out += [self.grid(r) for r in sel]
        return out + [self.wide()]

    def ground(self, lat, lng, grids=None):
        g = grids or self.stack(lat, lng, 0.5)
        return float(stack_at(g, np.array([lat]), np.array([lng]))[0])

    def merged(self, lat, lng, half_km, cell_m, grids=None):
        """one grid of +-half_km at cell_m, sampled from the fine stack (fast coarse searches)"""
        grids = grids or self.stack(lat, lng, half_km)
        n = int(round(2 * half_km * 1000 / cell_m))
        north, south = lat + half_km * 1000 / KZ, lat - half_km * 1000 / KZ
        west, east = lng - half_km * 1000 / kx(lat), lng + half_km * 1000 / kx(lat)
        rr, cc = np.mgrid[0:n, 0:n]
        la = north - (rr + 0.5) / n * (north - south); lo = west + (cc + 0.5) / n * (east - west)
        h = stack_at(grids, la.ravel(), lo.ravel()).reshape(n, n)
        return Grid(h, north, south, west, east, 'merged')

    # ---------- buildings ----------
    def houses_near(self, lat, lng, rad_m):
        """buildings (outline lat/lng, eave, ridge, roof) whose centre is within rad_m"""
        out = []; k = kx(lat)
        for t in self.house_rows:
            if not (t['north'] > lat - rad_m / KZ and t['south'] < lat + rad_m / KZ and t['east'] > lng - rad_m / k and t['west'] < lng + rad_m / k):
                continue
            J = json.load(open(self.file(t['path'])))
            tn, ts, tw = J['box'][0], J['box'][1], J['box'][2]; kxt = kx((tn + ts) / 2)
            for b in J['b']:
                if not b.get('p') or len(b['p']) < 6: continue
                pts = [(tn - b['p'][i + 1] / KZ, tw + b['p'][i] / kxt) for i in range(0, len(b['p']) - 1, 2)]
                cl = sum(p[0] for p in pts) / len(pts); co = sum(p[1] for p in pts) / len(pts)
                if math.hypot((cl - lat) * KZ, (co - lng) * k) > rad_m: continue
                c = (tn - b['c'][1] / KZ, tw + b['c'][0] / kxt) if b.get('c') else (cl, co)
                out.append(dict(pts=pts, c=c, e=b.get('e', 3), r=b.get('r') or b.get('e', 3), a=b.get('a', 0), hw=b.get('hw', 0), roof=b.get('roof', 'flat'), id=b.get('id')))
        return out

    def house_grid(self, lat, lng, rad_m, cell_m=1.0, grids=None):
        """buildings as a height grid (ground + roof); nan where there is no building, so the stack falls through"""
        H = self.houses_near(lat, lng, rad_m)
        n = int(2 * rad_m / cell_m); k = kx(lat)
        north, south = lat + rad_m / KZ, lat - rad_m / KZ; west, east = lng - rad_m / k, lng + rad_m / k
        h = np.full((n, n), np.nan, np.float32)
        grids = grids or self.stack(lat, lng, rad_m / 1000 + 0.5)
        try:
            import cv2
        except ImportError:
            cv2 = None
        for b in H:
            P = np.array([[(lo - west) / (east - west) * n, (north - la) / (north - south) * n] for la, lo in b['pts']], np.float32)
            x0, y0 = np.floor(P.min(0)).astype(int); x1, y1 = np.ceil(P.max(0)).astype(int)
            if x1 < 0 or y1 < 0 or x0 >= n or y0 >= n: continue
            x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, n - 1), min(y1, n - 1)
            m = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
            cv2.fillPoly(m, [np.round(P - [x0, y0]).astype(np.int32)], 1)
            yy, xx = np.nonzero(m)
            if not len(yy): continue
            g0 = float(stack_at(grids, np.array([b['c'][0]]), np.array([b['c'][1]]))[0])
            e = g0 + max(1.8, b['e']); r = g0 + max(b['e'], b['r'])
            if b['roof'] == 'gable' and b['r'] > b['e'] + 0.3:
                ar = math.radians(b['a']); nx, nz = -math.sin(ar), math.cos(ar); hw = max(b['hw'], 0.5)
                # cell centre in metres from the building centre (x east, z south)
                X = ((xx + x0 + 0.5) / n * (east - west) + west - b['c'][1]) * k
                Z = -((north - (yy + y0 + 0.5) / n * (north - south)) - b['c'][0]) * KZ
                top = e + (r - e) * np.maximum(0, 1 - np.abs(X * nx + Z * nz) / hw)
            else:
                top = np.full(len(yy), r, np.float32)
            h[yy + y0, xx + x0] = np.fmax(h[yy + y0, xx + x0], top)
        return Grid(h, north, south, west, east, 'houses'), len(H)


def _png8(path):
    from PIL import Image
    return np.asarray(Image.open(path).convert('L'))


def tree_grid(T, lat, lng, rad_m, cell_m=1.0, grids=None, clear_m=8.0):
    """tree tops (ground + crown height) as a height grid, nan where there is no tree, so the stack falls through.
    1 m laser boxes (mask v6: 8 + 3 x round(h / 0.6) + class) where a stop has one, else the park-wide 7 m canopy
    tiles (value x step_m over the ground). Trees within clear_m of the spot are left out (the camera is not in a tree).
    Returns (Grid, number of tree cells); None when the region has no trees."""
    if not T.detail_rows and not T.tree_rows: return None, 0
    n = int(2 * rad_m / cell_m); k = kx(lat)
    north, south = lat + rad_m / KZ, lat - rad_m / KZ; west, east = lng - rad_m / k, lng + rad_m / k
    rr, cc = np.mgrid[0:n, 0:n]
    la = (north - (rr + 0.5) / n * (north - south)).ravel(); lo = (west + (cc + 0.5) / n * (east - west)).ravel()
    top = np.full(la.shape, np.nan, np.float32); done = np.zeros(la.shape, bool)
    grids = grids or T.stack(lat, lng, rad_m / 1000 + 0.5)
    for r in T.detail_rows:
        if not (r['north'] > south and r['south'] < north and r['east'] > west and r['west'] < east): continue
        m = _png8(T.file(r['leaf_mask_path'])); nm = m.shape[0]
        ri = ((r['north'] - la) / (r['north'] - r['south']) * nm).astype(np.int64); ci = ((lo - r['west']) / (r['east'] - r['west']) * nm).astype(np.int64)
        ins = (ri >= 0) & (ri < nm) & (ci >= 0) & (ci < nm) & ~done
        if not ins.any(): continue
        v = m[ri[ins], ci[ins]].astype(np.int32)
        h = np.where(v >= 8, ((v - 8) // 3) * 0.6, 0.0)
        g = Grid(read_png(T.file(r['path']), r['base_m'], r['step_m']).astype(np.float32), r['north'], r['south'], r['west'], r['east'])
        idx = np.nonzero(ins)[0]; tr = h > 2.0
        top[idx[tr]] = g.at(la[idx[tr]], lo[idx[tr]]) + h[tr]
        done[idx] = True
    todo = ~done
    for r in T.tree_rows:
        if not todo.any(): break
        if not (r['north'] > south and r['south'] < north and r['east'] > west and r['west'] < east): continue
        m = _png8(T.file(r['path'])); nm = m.shape[0]
        ri = ((r['north'] - la) / (r['north'] - r['south']) * nm).astype(np.int64); ci = ((lo - r['west']) / (r['east'] - r['west']) * m.shape[1]).astype(np.int64)
        ins = (ri >= 0) & (ri < nm) & (ci >= 0) & (ci < m.shape[1]) & todo
        if not ins.any(): continue
        idx = np.nonzero(ins)[0]; h = m[ri[ins], ci[ins]].astype(np.float32) * r['step_m']; tr = h > 2.0
        top[idx[tr]] = stack_at(grids, la[idx[tr]], lo[idx[tr]]) + h[tr]
        todo[idx] = False
    d = np.hypot((la - lat) * KZ, (lo - lng) * k); top[d < clear_m] = np.nan
    return Grid(top.reshape(n, n), north, south, west, east, 'trees'), int(np.isfinite(top).sum())


def horizon(grids, lat, lng, eyeh, azs, dmin=15.0, dmax=60000.0, nd=900, chunk=256, with_dist=False):
    """elevation angle (deg) of the sky line per azimuth (deg), seen from eye height eyeh (absolute metres).
    Earth curve with refraction (R7). grids fine-first."""
    azs = np.asarray(azs, np.float64); d = np.geomspace(dmin, dmax, nd)
    k = kx(lat); drop = d * d / (2 * R7)
    out = np.empty(len(azs), np.float32); dist = np.empty(len(azs), np.float32)
    for s in range(0, len(azs), chunk):
        a = np.radians(azs[s:s + chunk])[:, None]
        la = lat + d[None] * np.cos(a) / KZ; lo = lng + d[None] * np.sin(a) / k
        h = stack_at(grids, la.ravel(), lo.ravel()).reshape(la.shape)
        el = np.arctan2(h - drop[None] - eyeh, d[None])
        el = np.where(np.isnan(el), -1.0, el)
        j = np.argmax(el, 1); out[s:s + chunk] = np.degrees(el[np.arange(len(j)), j]); dist[s:s + chunk] = d[j]
    return (out, dist) if with_dist else out
