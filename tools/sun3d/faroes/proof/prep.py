#!/usr/bin/env python3
"""Proof picture, step 1: per view, the grids and baked sun maps the standalone renderer (view.html) draws.

  prep.py <views.json> <work dir> <near files dir> <wide file> <out dir>

Per view: data/<name>/meta.json + raw float32 / uint8 files:
  detail_h.f32   the detail box's GROUND (no buildings), blended into the 4 m grid along its edge (as the app page does)
  detail_s.f32   ground + building blocks        detail_k.u8  class mask        photo.jpg
  detail_l.u8    sun reaching each cell, 0..255 (shadows marched over buildings, then the 4 m grid, then the wide grid)
  mid_h.f32 / mid_l.u8     the Faroes 4 m fine box (what the app draws today), cropped around the view; its sun map
  wide_h.f32 / wide_l.u8   the wide Faroes grid, cropped
Sun position: the formulas of tools/sun3d/sun.js (NOAA), with the date and the clock offset as inputs (sun.js itself is
fixed to 30 Dec 2026 and US Mountain time); checked against sun.js by sun_check.js.

The whole proof (a stand-alone renderer, NOT the app's page):
  1. python3 ../build_detail_faroes.py build <work> --trip <uuid>                      the boxes
  2. copy three.js r128 beside view.html as three.min.js
  3. SUN3D=<repo>/tools/sun3d python3 prep.py views.json <work> <dir with the Faroes 4 m files> <faroes_adem32.png> data
  4. node shot.js          headless Chromium (playwright), software GL: out/<view>_before.png and _after.png
  5. python3 sheet.py      _faroes_round1.png and _faroes_round1_small.png
views.json: per view the detail box, the 4 m fine box, stand pin, subject pin, lens (mm on 4x5), date, local minutes,
clock offset from UTC, aim_up (metres above the subject's ground to aim at). BEFORE = the 4 m grid with the page's plain
'green' colours. AFTER = the detail box. The renderer's own doing, not in the data: wall colours (the roof's colour,
greyed), rock on faces steeper than about 55 degrees (a photo from above shows nothing of them), white water where a
mapped stream runs down a steep face, the far ground tinted with the photo's middle colour, the sky, the sea's reflection.
"""
import json, math, os, shutil, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True

views_path, work, near_dir, wide_path, out = sys.argv[1:6]
sys.path.insert(0, os.environ.get('SUN3D', ''))
from build_trip_terrain import read_png   # noqa: E402

R = math.pi / 180

def sun_pos(y, mo, d, mins, utc_off_h, lat, lng):
    """tools/sun3d/sun.js, with the date and the clock's offset from UTC as inputs. mins = local clock minutes."""
    import datetime
    days = (datetime.datetime(y, mo, d) - datetime.datetime(1970, 1, 1)).total_seconds() / 86400
    JD = days + 2440587.5 + (mins / 60 - utc_off_h) / 24
    T = (JD - 2451545) / 36525
    L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    C = math.sin(M * R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + math.sin(2 * M * R) * (0.019993 - 0.000101 * T) + math.sin(3 * M * R) * 0.000289
    om = 125.04 - 1934.136 * T
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(om * R)
    eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * math.cos(om * R)
    decl = math.asin(math.sin(eps * R) * math.sin(lam * R))
    yy = math.tan(eps * R / 2) ** 2
    eot = 4 / R * (yy * math.sin(2 * L0 * R) - 2 * e * math.sin(M * R) + 4 * e * yy * math.sin(M * R) * math.cos(2 * L0 * R) - 0.5 * yy * yy * math.sin(4 * L0 * R) - 1.25 * e * e * math.sin(2 * M * R))
    tst = (((mins - utc_off_h * 60) + eot + 4 * lng) % 1440 + 1440) % 1440
    ha = (tst / 4 - 180) * R
    cz = math.sin(lat * R) * math.sin(decl) + math.cos(lat * R) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1, min(1, cz)))
    alt = 90 - zen / R
    a = math.acos(max(-1, min(1, (math.sin(lat * R) * math.cos(zen) - math.sin(decl)) / (math.cos(lat * R) * math.sin(zen))))) / R
    az = (a + 180) % 360 if ha > 0 else (540 - a) % 360
    if alt > -0.575: alt += 1.02 / math.tan((alt + 10.3 / (alt + 5.11)) * R) / 60
    return alt, az


class Grid:
    def __init__(self, h, box):
        self.h = np.ascontiguousarray(h, dtype=np.float32); self.box = box; self.n, self.m = h.shape
    def sample(self, lat, lng):
        """Bilinear; nan outside."""
        north, south, west, east = self.box
        r = (north - lat) / (north - south) * self.n - 0.5; c = (lng - west) / (east - west) * self.m - 0.5
        ok = (r >= 0) & (c >= 0) & (r <= self.n - 1) & (c <= self.m - 1)
        r = np.clip(r, 0, self.n - 1.001); c = np.clip(c, 0, self.m - 1.001); r0 = r.astype(np.int32); c0 = c.astype(np.int32); fr = (r - r0).astype(np.float32); fc = (c - c0).astype(np.float32)
        h = self.h
        v = (h[r0, c0] * (1 - fc) + h[r0, c0 + 1] * fc) * (1 - fr) + (h[r0 + 1, c0] * (1 - fc) + h[r0 + 1, c0 + 1] * fc) * fr
        return np.where(ok, v, np.nan)
    def crop(self, clat, clng, k):
        """A k x k window of cells around a point (clamped to the grid)."""
        north, south, west, east = self.box
        r = int((north - clat) / (north - south) * self.n); c = int((clng - west) / (east - west) * self.m)
        k1 = min(k, self.n); k2 = min(k, self.m)
        r0 = min(max(0, r - k1 // 2), self.n - k1); c0 = min(max(0, c - k2 // 2), self.m - k2)
        dl = (north - south) / self.n; dg = (east - west) / self.m
        return Grid(self.h[r0:r0 + k1, c0:c0 + k2], (north - r0 * dl, north - (r0 + k1) * dl, west + c0 * dg, west + (c0 + k2) * dg))
    def cells(self):
        north, south, west, east = self.box
        la = north - (np.arange(self.n) + 0.5) * (north - south) / self.n; lo = west + (np.arange(self.m) + 0.5) * (east - west) / self.m
        return np.meshgrid(la, lo, indexing='ij')


def sun_map(target, layers, alt, az, lat0, lift=0.5, reach=30000.0):
    """Share of the sun each cell of `target` gets (0..1): rays marched toward the sun over the layers (finest first;
    a point is read from the first layer that holds it). The page's own rule: soft edge = clearance / (2% of the distance)."""
    kx = 111320 * math.cos(lat0 * R); kz = 111132
    LA, LO = target.cells(); la = LA.ravel().astype(np.float64); lo = LO.ravel().astype(np.float64); h0 = target.h.ravel().astype(np.float64)
    if alt <= 0: return np.zeros(target.h.shape, np.float32)
    dx = math.sin(az * R); dy = math.cos(az * R); tan = math.tan(alt * R)
    vis = np.ones(la.shape, np.float32); live = np.arange(la.size)
    hmax = max(float(np.nanmax(g.h)) for g in layers) + 5
    north, south, west, east = target.box
    L = 0.6 * (north - south) * kz / target.n; dist = 0.0
    while dist < reach and live.size:
        dist += L
        pla = la[live] + dy * dist / kz; plo = lo[live] + dx * dist / kx; hh = h0[live] + lift + tan * dist - dist * dist / (2 * 6371000 * 7 / 6) * 0   # (earth curve left out: 30 km of reach at most)
        gr = np.full(live.size, np.nan, np.float32)
        for g in layers:
            need = np.isnan(gr)
            if not need.any(): break
            gr[need] = g.sample(pla[need], plo[need])
        cl = hh - gr
        v = np.where(np.isnan(cl), 1.0, np.clip(cl / (dist * 0.02 + 0.3), 0, 1)).astype(np.float32)
        vis[live] = np.minimum(vis[live], v)
        keep = (vis[live] > 0) & (hh < hmax) & ~np.isnan(gr)
        live = live[keep]
        L *= 1.05
    return vis.reshape(target.h.shape)


def edge_blend(fine, coarse, lat0, band):
    """The fine grid's heights eased into the coarse grid's over the outer `band` metres (the page does the same)."""
    LA, LO = fine.cells(); c = coarse.sample(LA, LO); north, south, west, east = fine.box
    kx = 111320 * math.cos(lat0 * R); kz = 111132
    d = np.minimum(np.minimum((north - LA) * kz, (LA - south) * kz), np.minimum((LO - west) * kx, (east - LO) * kx))
    t = np.clip(d / band, 0, 1); t = t * t * (3 - 2 * t)
    return np.where(np.isnan(c), fine.h, c * (1 - t) + fine.h * t).astype(np.float32), t.astype(np.float32)


def main():
    views = json.load(open(views_path)); pins = json.load(open(f"{work}/pins.json"))
    reg = next(r for r in pins['regions'] if r['id'] == 'faroes'); wide_all = Grid(read_png(wide_path, reg['base_m'], reg['step_m']), (reg['north'], reg['south'], reg['west'], reg['east']))
    nears = {r['id']: r for r in pins['nears']}
    for v in views:
        name = v['name']; O = f"{out}/{name}"; os.makedirs(O, exist_ok=True)
        z = np.load(f"{work}/raw/{v['box']}.npz"); box = tuple(float(x) for x in z['box']); r = dict(cell_m=float(z['cell']), color_path=f"{v['box']}_photo.jpg")
        if os.path.exists(f"{O}/meta.json") and json.load(open(f"{O}/meta.json")).get('key') == json.dumps(v, sort_keys=True) and not os.environ.get('REDO'): print(f"{name}: kept"); continue
        slat, slng = v['stand']; tlat, tlng = v['subject']
        alt, az = sun_pos(*v['date'], v['mins'], v['utc_off'], slat, slng)
        nr = nears[v['near']]; near_all = Grid(read_png(f"{near_dir}/{nr['path']}", nr['base_m'], nr['step_m']), (nr['north'], nr['south'], nr['west'], nr['east']))
        clat, clng = (box[0] + box[1]) / 2, (box[2] + box[3]) / 2
        mid = near_all.crop(clat, clng, 1024); wide = wide_all.crop(slat, slng, 1024)
        mid_h, _ = edge_blend(mid, wide, slat, 150.0) if v.get('blend_mid', True) else (mid.h, None); mid = Grid(mid_h, mid.box)
        ground = Grid(z['ground'], box); gh, t = edge_blend(ground, mid, slat, 40.0); ground = Grid(gh, box)
        bh = z['building_h'] * (t > 0.99); kind = z['mask'].copy(); kind[(kind == 2) & (bh <= 0)] = 0
        kind[z['stream'] & (kind == 3)] = 4          # for this renderer only: streams apart from sea and lakes (the file has one water class)
        from PIL import Image
        ph = np.asarray(Image.open(f"{work}/files/{r['color_path']}").convert('RGB').resize((ground.n, ground.n))).astype(np.float32) / 255
        landpix = (kind == 0)
        tint = [float(x) for x in np.median(ph[landpix], 0)] if landpix.sum() > 1000 else [0.3, 0.37, 0.18]
        surf = Grid(gh + bh, box)
        print(f"{name}: box {v['box']} ({r['cell_m']} m cells), sun alt {alt:.1f} az {az:.1f} at {v['mins'] // 60:02d}:{v['mins'] % 60:02d} local on {v['date']}", flush=True)
        dl = sun_map(surf, [surf, near_all, wide_all], alt, az, slat, lift=0.4)
        ml = sun_map(mid, [mid, near_all, wide_all], alt, az, slat, lift=2.0)
        wl = sun_map(wide, [wide, wide_all], alt, az, slat, lift=3.0)
        gh.tofile(f"{O}/detail_h.f32"); surf.h.tofile(f"{O}/detail_s.f32"); kind.astype(np.uint8).tofile(f"{O}/detail_k.u8"); t.tofile(f"{O}/detail_t.f32")
        (dl * 255).astype(np.uint8).tofile(f"{O}/detail_l.u8"); mid.h.tofile(f"{O}/mid_h.f32"); (ml * 255).astype(np.uint8).tofile(f"{O}/mid_l.u8")
        wide.h.tofile(f"{O}/wide_h.f32"); (wl * 255).astype(np.uint8).tofile(f"{O}/wide_l.u8")
        shutil.copy(f"{work}/files/{r['color_path']}", f"{O}/photo.jpg")
        eye_after = float(ground.sample(np.array([slat]), np.array([slng]))[0]); eye_before = float(mid.sample(np.array([slat]), np.array([slng]))[0])
        def gh_at(la, lo):
            for g in (ground, mid, wide):
                x = float(g.sample(np.array([la]), np.array([lo]))[0])
                if not math.isnan(x): return x
            return 0.0
        meta = dict(key=json.dumps(v, sort_keys=True), name=name, title=v['title'], box=v['box'], cell=r['cell_m'], stand=[slat, slng], subject=[tlat, tlng], sun=dict(alt=alt, az=az), date=v['date'], mins=v['mins'],
                    tint=tint, lens=v['lens'], aim_up=v.get('aim_up', 0.0), eye_after=eye_after, eye_before=eye_before, subject_h=gh_at(tlat, tlng),
                    detail=dict(n=int(ground.n), box=box), mid=dict(n=int(mid.n), m=int(mid.m), box=mid.box, cell=4), wide=dict(n=int(wide.n), m=int(wide.m), box=wide.box),
                    kx=111320 * math.cos(slat * R), kz=111132)
        json.dump(meta, open(f"{O}/meta.json", 'w'), indent=1)
        print(f"   eye ground: detail {eye_after:.1f} m, 4 m grid {eye_before:.1f} m; subject ground {meta['subject_h']:.1f} m; sunlit share of the box {dl.mean():.0%}", flush=True)

if __name__ == '__main__': main()
