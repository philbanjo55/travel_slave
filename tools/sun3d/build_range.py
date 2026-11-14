#!/usr/bin/env python3
"""3D sun view, the "range" level (Grand Teton, 14 Nov 2026): the mountains the stops look at, sharp.

  build_range.py plan  <work dir> --jobs <shots.json>            which boxes the shots need (nothing fetched)
  build_range.py build <work dir> --jobs <shots.json> [--wide <grand_teton_z12.png>] [--only id,id]
  build_range.py check <work dir> [--wide ...]                    the data check only (summits, stops, wide grid)

Why: the wide grid (terrarium zoom 12, one point every ~27 m, drawn by a mesh of 768 points over 55 km = one every
~71 m) is what the peaks 10-25 km from the stand pins come from, so they read soft at 135-300 mm (one screen pixel is
~8 m at 15 km at 135 mm, ~4 m at 300 mm). This level is a 2048 x 2048 grid at 5 m (10.24 km a side) around the part
of the range a shot looks at, drawn by the page between the wide grid and the fine (near) boxes.

Source: USGS 3DEP 1 m DEM (bare earth, NAVD88 metres) from the National Map's staged products,
prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/WY_GrandTetonNP_D22 (2022 lidar), then
WY_GrandTetonElkRefuge_2014 where the 2022 one has no tile, then the 1/3 arc-second DEM (~10 m, n44w111) where
neither has data (west of the crest on the Idaho side). The tiles are cloud-optimised GeoTIFFs in UTM 12N with
overviews; we read only the 2 m overview's 512 x 512 blocks under a box with HTTP range requests (kept in
<work>/tnm so a rerun is free) and sample them bilinearly at the 5 m points. Bare earth is the right top surface for
the peaks (above tree line it is rock and snow); trees are never in it (they are drawn apart and never feed the sun
times). Needs: numpy, tifffile, imagecodecs, pyproj.

Boxes sit on a lattice (centres every 5.12 km, half a box), so shots looking at the same part of the range share one. A shot's
box: the lattice centre nearest to its subject moved 1.5 km toward the stand pin (the range face, canyons and the
lake-front moraines lie east of the summits), kept only when the wide grid has mountain (over 2,600 m) within 3 km of
that point. The app picks among the boxes in the table the same way (src/services/terrain.ts rangeFor).

File format: as the other levels (16-bit prediction residuals in a PNG, height = base_m + value * step_m), step 0.05 m.
Output: <work>/files/<id>.png, <work>/look/<id>.png, <work>/range.json, <work>/upload.txt, <work>/terrain_range.sql.
"""
import argparse, json, math, os, struct, subprocess, sys, zlib
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import tifffile
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
from build_trip_terrain import read_png, at   # noqa: E402

TNM = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation'
PROJECTS = ['WY_GrandTetonNP_D22', 'WY_GrandTetonElkRefuge_2014']
N, CELL = 2048, 5.0                       # points a side, metres a point
LAT0, LNG0, DLAT, DLNG = 43.60, -110.90, 0.04608, 0.0637   # lattice: centres every ~5.12 km (half a box)
TOWARD, MOUNTAIN_M, MOUNTAIN_KM = 1500.0, 2600.0, 3.0
STEP = 0.05
WIDE = dict(north=43.95, south=43.45, west=-110.92, east=-110.24, base=1500.0, step=0.5)
# summits (NAVD88, from the USGS / NGS benchmarks as published) and the 2 m search radius each is checked within
SUMMITS = [('Grand Teton', 43.74108, -110.80239, 4199), ('Middle Teton', 43.73028, -110.81361, 3903),
           ('Mount Owen', 43.74794, -110.79806, 3940), ('Mount Moran', 43.83500, -110.77639, 3842),
           ('Teewinot Mountain', 43.74639, -110.77694, 3757), ('South Teton', 43.71972, -110.81694, 3814)]   # (Nez Perce and Buck left out: the spots I had for them were too far off to find their tops)
KX = lambda lat: 111320 * math.cos(math.radians(lat)); KZ = 111132.0
to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:26912', always_xy=True)


def curl(url, rng=None):
    cmd = ["curl", "-sS", "-f", "-m", "180", "--retry", "4", "--retry-delay", "2"] + (["-r", rng] if rng else []) + [url]
    p = subprocess.run(cmd, capture_output=True)
    return p.stdout if p.returncode == 0 else None


class Remote:
    """A read-only file over HTTP range requests, in 1 MB blocks kept on disk."""
    B = 1 << 20
    def __init__(self, url, cache):
        self.url = url; self.dir = os.path.join(cache, url.split('/')[-1]); self.pos = 0; self.mem = {}
        os.makedirs(self.dir, exist_ok=True)
        sz = os.path.join(self.dir, 'size')
        if os.path.exists(sz): self.size = int(open(sz).read())
        else:
            h = subprocess.run(["curl", "-sS", "-f", "-m", "60", "-I", url], capture_output=True)
            self.size = next((int(l.split(b':')[1]) for l in h.stdout.splitlines() if l.lower().startswith(b'content-length')), 0) if h.returncode == 0 else 0
            if self.size: open(sz, 'w').write(str(self.size))
    def block(self, i):
        if i in self.mem: return self.mem[i]
        path = f"{self.dir}/{i}"
        if os.path.exists(path) and os.path.getsize(path): d = open(path, 'rb').read()
        else:
            import time
            for k in range(8):
                d = curl(self.url, f"{i * self.B}-{min(self.size, (i + 1) * self.B) - 1}")
                if d is not None: break
                time.sleep(2 + 3 * k)
            if d is None: raise IOError(f"range read failed: {self.url}")
            open(path + '.tmp', 'wb').write(d); os.replace(path + '.tmp', path)
        if len(self.mem) > 48: self.mem.clear()
        self.mem[i] = d; return d
    def fetch(self, blocks):
        todo = [i for i in sorted(set(blocks)) if not os.path.exists(f"{self.dir}/{i}")]
        with ThreadPoolExecutor(6) as ex: list(ex.map(self.block, todo))
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


def window(url, cache, level_px, x0, x1, y0, y1, label):
    """Heights of one GeoTIFF inside a box in its own CRS, from the overview nearest level_px: (array, left, top, pixel) or None."""
    r = Remote(url, cache)
    if not r.size: return None
    tif = tifffile.TiffFile(r); p0 = tif.pages[0]
    ps0 = p0.tags['ModelPixelScaleTag'].value[0]; tp = p0.tags['ModelTiepointTag'].value; fx, fy = tp[3], tp[4]
    nod = p0.tags.get('GDAL_NODATA'); nod = float(nod.value) if nod else -999999.0
    page = min(tif.pages, key=lambda p: abs(ps0 * p0.shape[1] / p.shape[1] - level_px)); ps = ps0 * p0.shape[1] / page.shape[1]
    H, W = page.shape[:2]; tw, th = page.tilewidth, page.tilelength
    c0, c1 = max(0, int((x0 - fx) / ps) - 2), min(W, int((x1 - fx) / ps) + 3); r0, r1 = max(0, int((fy - y1) / ps) - 2), min(H, int((fy - y0) / ps) + 3)
    if c1 <= c0 or r1 <= r0: return None
    arr = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32); across = (W + tw - 1) // tw
    idx = [tr * across + tc for tr in range(r0 // th, (r1 - 1) // th + 1) for tc in range(c0 // tw, (c1 - 1) // tw + 1)]
    idx = [i for i in idx if page.databytecounts[i] > 0]
    r.fetch(b for i in idx for b in range(page.dataoffsets[i] // r.B, (page.dataoffsets[i] + page.databytecounts[i] - 1) // r.B + 1))
    for i in idx:
        r.seek(page.dataoffsets[i]); seg, _, _ = page.decode(r.read(page.databytecounts[i]), i)
        t = np.squeeze(seg).astype(np.float32); t[(t <= nod + 1) | (t < -1000)] = np.nan
        ty, tx = (i // across) * th, (i % across) * tw
        a0, a1, b0, b1 = max(r0, ty), min(r1, ty + t.shape[0]), max(c0, tx), min(c1, tx + t.shape[1])
        if a1 > a0 and b1 > b0: arr[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = t[a0 - ty:a1 - ty, b0 - tx:b1 - tx]
    print(f"    {label}: {ps:g} m, {len(idx)} blocks, {np.isfinite(arr).mean():.0%} with data", flush=True)
    return arr, fx + c0 * ps, fy - r0 * ps, ps


def sample(win, x, y, h):
    """Bilinear heights at points into h where h is still nan (a point needs all four neighbours)."""
    arr, fx, fy, ps = win
    c = (x - fx) / ps - 0.5; r = (fy - y) / ps - 0.5
    ok = np.isnan(h) & (c >= 0) & (r >= 0) & (c < arr.shape[1] - 1) & (r < arr.shape[0] - 1)
    c0 = np.floor(c[ok]).astype(int); r0 = np.floor(r[ok]).astype(int); fc = c[ok] - c0; fr = r[ok] - r0
    v = (arr[r0, c0] * (1 - fc) + arr[r0, c0 + 1] * fc) * (1 - fr) + (arr[r0 + 1, c0] * (1 - fc) + arr[r0 + 1, c0 + 1] * fc) * fr
    h[ok] = v


def tiles_for(E0, E1, N0, N1, keys):
    out = []
    for proj in PROJECTS:
        for x in range(int(E0 // 10000), int(E1 // 10000) + 1):
            for y in range(int(N0 // 10000) + 1, int(N1 // 10000) + 2):
                name = f"USGS_1M_12_x{x}y{y}_{proj}.tif"
                k = next((k for k in keys if k.endswith(name)), None)
                if k: out.append((proj, f"https://prd-tnm.s3.amazonaws.com/{k}"))
    return out


def heights(work, box, n, keys, wide=None):
    """n x n heights over a lat / lng box (row 0 = north, cell centres), and where each came from (1 2022, 2 2014, 3 10 m, 4 wide)."""
    north, south, west, east = box
    lat = north - (np.arange(n) + .5) * (north - south) / n; lng = west + (np.arange(n) + .5) * (east - west) / n
    LA, LO = np.meshgrid(lat, lng, indexing='ij'); E, Nn = to_utm.transform(LO, LA)
    h = np.full(LA.shape, np.nan, np.float64); src = np.zeros(LA.shape, np.uint8)
    cache = f"{work}/tnm"; os.makedirs(cache, exist_ok=True)
    pad = 20
    for k, (proj, url) in enumerate(tiles_for(E.min() - pad, E.max() + pad, Nn.min() - pad, Nn.max() + pad, keys)):
        w = window(url, cache, 2.0, E.min() - pad, E.max() + pad, Nn.min() - pad, Nn.max() + pad, url.split('/')[-1])
        if w is None: continue
        before = np.isnan(h); sample(w, E, Nn, h); src[before & ~np.isnan(h)] = 1 if proj == PROJECTS[0] else 2
    if np.isnan(h).any():   # the 1/3 arc-second DEM (geographic NAD83, ~10 m)
        url = f"{TNM}/13/TIFF/current/n44w111/USGS_13_n44w111.tif"
        w = window(url, cache, 0.0, LO.min() - .001, LO.max() + .001, LA.min() - .001, LA.max() + .001, '1/3 arc-second n44w111')
        if w is not None:
            before = np.isnan(h); sample(w, LO, LA, h); src[before & ~np.isnan(h)] = 3
    if np.isnan(h).any() and wide is not None:
        before = np.isnan(h); v = at(wide, (WIDE['north'], WIDE['south'], WIDE['west'], WIDE['east']), LA, LO); h[before] = v[before]; src[before & ~np.isnan(h)] = 4
    return h, src, LA, LO


def write_heights(path, h, base, step):
    n = h.shape[0]; q = np.round((h - base) / step); assert q.min() >= 0 and q.max() <= 65535, "heights don't fit"
    p = np.zeros((n + 1, n + 1), dtype=np.int64); p[1:, 1:] = q.astype(np.int64)
    res = ((p[1:, 1:] - p[1:, :-1] - p[:-1, 1:] + p[:-1, :-1]) % 65536).astype('>u2')
    raw = b''.join(b'\x00' + res[i].tobytes() for i in range(n))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', n, n, 16, 0, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def box_of(clat, clng):
    hz = N * CELL / 2 / KZ; hx = N * CELL / 2 / KX(clat)
    return (round(clat + hz, 6), round(clat - hz, 6), round(clng - hx, 6), round(clng + hx, 6))


def choose(shot, wide):
    """The lattice centre a shot wants, or None (no mountain where it looks)."""
    v, s = shot['v'], shot['s']; kx = KX(s['lat'])
    dx, dz = (v['lng'] - s['lng']) * kx, (v['lat'] - s['lat']) * KZ; d = math.hypot(dx, dz) or 1
    t = min(TOWARD, d * 0.5); plat, plng = s['lat'] + dz / d * t / KZ, s['lng'] + dx / d * t / kx
    if wide is not None:   # mountain near that point?
        k = 25; la = plat + (np.arange(k) - k // 2) * MOUNTAIN_KM * 2000 / k / KZ; lo = plng + (np.arange(k) - k // 2) * MOUNTAIN_KM * 2000 / k / kx
        LA, LO = np.meshgrid(la, lo, indexing='ij')
        if np.nanmax(at(wide, (WIDE['north'], WIDE['south'], WIDE['west'], WIDE['east']), LA, LO)) < MOUNTAIN_M: return None
    i, j = round((plat - LAT0) / DLAT), round((plng - LNG0) / DLNG)
    return (round(LAT0 + i * DLAT, 5), round(LNG0 + j * DLNG, 5))


def check(work, keys, wide, stops):
    lines = []; ok = True
    def say(t): lines.append(t); print(t, flush=True)
    for name, la, lo, want in SUMMITS:
        r = 450.0; box = (la + r / KZ, la - r / KZ, lo - r / KX(la), lo + r / KX(la))
        h, src, LA, LO = heights(work, box, 300, keys)
        got = float(np.nanmax(h)); im = np.nanargmax(h); off = math.hypot((LA.ravel()[im] - la) * KZ, (LO.ravel()[im] - lo) * KX(la)); d = got - want; ok &= abs(d) <= 8
        wv = float(np.nanmax(at(wide, (WIDE['north'], WIDE['south'], WIDE['west'], WIDE['east']), *np.meshgrid(np.linspace(box[0], box[1], 9), np.linspace(box[2], box[3], 9), indexing='ij')))) if wide is not None else float('nan')
        say(f"  {name}: {got:.1f} m (published {want}, {d:+.1f}; source {sorted(set(src.ravel().tolist()))}, top {off:.0f} m from the listed spot); wide grid {wv:.0f} m ({wv - want:+.0f})")
    if stops:
        ds = []
        for s in stops:
            if s.get('elevation_m') is None: continue
            la, lo = s.get('elevation_lat', s['lat']), s.get('elevation_lng', s['lng'])
            if not (43.53 < la < 43.93 and -110.92 < lo < -110.5): continue
            box = (la + 10 / KZ, la - 10 / KZ, lo - 10 / KX(la), lo + 10 / KX(la))
            h, src, _, _ = heights(work, box, 4, keys)
            if src.min() == 0 or src.max() > 2: continue
            ds.append(float(np.nanmean(h)) - s['elevation_m'])
        if ds:
            ds = np.array(ds); say(f"  stops' stored heights ({len(ds)} inside the 1 m data): middle {np.median(ds):+.1f} m, {np.mean(np.abs(ds) <= 25):.0%} within 25 m")
            ok &= np.mean(np.abs(ds) <= 25) >= 0.8
    say('  DATA CHECK ' + ('PASS' if ok else 'FAIL'))
    open(f"{work}/check.txt", 'w').write('\n'.join(lines) + '\n')
    return ok


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('cmd', choices=['plan', 'build', 'check']); ap.add_argument('work')
    ap.add_argument('--jobs'); ap.add_argument('--wide'); ap.add_argument('--stops'); ap.add_argument('--only'); ap.add_argument('--prefix', default='gtr')
    ap.add_argument('--keys', help='file with the bucket keys (else listed now)')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    wide = read_png(a.wide, WIDE['base'], WIDE['step']) if a.wide else None
    if a.keys: keys = open(a.keys).read().split()
    else:
        keys = []
        for p in PROJECTS:
            x = subprocess.run(['curl', '-sS', f"https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts/Elevation/1m/Projects/{p}/TIFF/&max-keys=1000"], capture_output=True, text=True).stdout
            keys += [k.split('</Key>')[0] for k in x.split('<Key>')[1:]]
    stops = json.load(open(a.stops))['stops'] if a.stops else []
    if a.cmd == 'check':
        sys.exit(0 if check(a.work, keys, wide, stops) else 1)
    jobs = json.load(open(a.jobs)); want = {}
    for j in jobs:
        c = choose(j, wide); key = j.get('key') or j.get('stop')
        print(f"  {key} {j.get('stop', '')}: {'no mountain where it looks' if c is None else c}")
        if c: want.setdefault(c, []).append(key)
    boxes = []
    for (clat, clng), who in sorted(want.items()):
        bid = f"{a.prefix}_{int(round((clat - LAT0) / DLAT)):02d}_{int(round((clng - LNG0) / DLNG)):02d}"
        boxes.append(dict(id=bid, clat=clat, clng=clng, box=box_of(clat, clng), shots=who))
    print(f"{len(boxes)} range boxes ({N} x {N} at {CELL:g} m):")
    for b in boxes: print(f"  {b['id']}: {b['box']} for {', '.join(b['shots'])}")
    if a.cmd == 'plan': return
    if not check(a.work, keys, wide, stops): sys.exit('data check failed: nothing built')
    if a.only: boxes = [b for b in boxes if b['id'] in a.only.split(',')]
    F = f"{a.work}/files"; os.makedirs(F, exist_ok=True); os.makedirs(f"{a.work}/look", exist_ok=True)
    rows = []
    for b in boxes:
        print(f"\n{b['id']}", flush=True)
        h, src, LA, LO = heights(a.work, b['box'], N, keys, wide)
        if np.isnan(h).any(): h = np.where(np.isnan(h), np.nanmin(h), h)
        base = math.floor(float(h.min())) - 5
        path = f"{F}/{b['id']}.png"; write_heights(path, h, base, STEP)
        assert np.abs(read_png(path, base, STEP) - h).max() <= STEP / 2 + 1e-6
        share = {k: float((src == v).mean()) for k, v in (('lidar_2022', 1), ('lidar_2014', 2), ('dem_10m', 3), ('wide', 4))}
        note = ''
        if wide is not None:
            wv = at(wide, (WIDE['north'], WIDE['south'], WIDE['west'], WIDE['east']), LA[::16, ::16], LO[::16, ::16]); df = h[::16, ::16] - wv
            note = f"; against the wide grid: middle {np.nanmedian(df):+.1f} m, 9 in 10 within {np.nanpercentile(np.abs(df), 90):.0f} m"
        from PIL import Image
        g = np.gradient(h, CELL); sh = np.clip(0.5 + (-g[1] + g[0]) * 0.35, 0, 1)   # a quick hill shade to look at
        Image.fromarray((sh * 255).astype(np.uint8)).resize((1024, 1024)).save(f"{a.work}/look/{b['id']}.png")
        kx = KX((b['box'][0] + b['box'][1]) / 2)
        r = dict(id=b['id'], parent='grand_teton', north=b['box'][0], south=b['box'][1], west=b['box'][2], east=b['box'][3], n=N,
                 width_m=round((b['box'][3] - b['box'][2]) * kx, 1), depth_m=round((b['box'][0] - b['box'][1]) * KZ, 1), base_m=base, step_m=STEP, cell_m=CELL,
                 path=os.path.basename(path), bytes=os.path.getsize(path), sources=share, shots=b['shots'])
        rows.append(r)
        print(f"  heights {h.min():.0f}..{h.max():.0f} m; from {', '.join(f'{k} {v:.0%}' for k, v in share.items() if v)}; file {r['bytes'] / 1e6:.2f} MB{note}", flush=True)
    json.dump(rows, open(f"{a.work}/range.json", 'w'), indent=1)
    print(f"\n{len(rows)} files, {sum(r['bytes'] for r in rows) / 1e6:.1f} MB")


if __name__ == '__main__':
    main()
