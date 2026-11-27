#!/usr/bin/env python3
"""3D sun view terrain for a trip: data check, wide file, fine boxes around the stand spots, SQL and upload list.

  build_trip_terrain.py build <work dir> --region <id> (--trip <trip uuid> | --pins pins.json) [options]
  build_trip_terrain.py plan  <work dir> --region <id> (--trip ... | --pins ...)          the boxes only, nothing built
  build_trip_terrain.py check <file.png> <north> <south> <west> <east> [--base m] [--trip ... | --pins ...] [--work dir]

What `build` does, in order:
  1. pins: the trip's stops (with their stored heights) and shots (stand spot + subject) from the database through a
     read-only SQL helper (--q, default $TRIP_Q: a script that takes one SELECT and prints JSON rows), or from a JSON
     file {"stops": [...], "shots": [...], "known": [...], "regions": [...]}; --trip saves that file as <work>/pins.json;
  2. source: ArcticDEM v4.1 when the whole area is north of 60 N (build_dem_arctic.py), else the public terrarium tiles
     (build_dem.py). --source overrides;
  3. the wide file: the region's existing file when --region is already in terrain_regions (fetched from the public
     bucket, or --wide-file), else a new 2048 x 2048 file over all the pins;
  4. DATA CHECK of the wide file (see `check` below). A FAIL stops here: nothing else is built (--force to go on);
  5. fine boxes: every stand spot gets --pad metres of ground around it; a subject closer than --close-km is kept in
     the same box; boxes are merged while they stay under --near-max-km a side; each is built at the source's own
     detail, checked like the wide file, and compared with the wide file (they must agree, the page blends them);
  6. output in <work>/files: the files, <work>/terrain_<region>.sql (rows for terrain_regions / terrain_near_regions,
     not applied) and <work>/upload.txt (what goes into Storage bucket `terrain`).

The data check (the lesson of the Faroes, where the terrarium tiles were 58 m high with the fjords filled in):
  - the stops' own stored heights (stops.elevation_m) against the file;
  - Copernicus GLO-30 (an independent world-wide model, fetched from its public bucket into <work>/cop): the land's
    typical difference, and the water along the coast, which must read about 0;
  - known heights from the trip's data (airports in metar_stations), and the highest point, printed for a look.
Every number is printed. Verdict PASS / WARN / FAIL; `check` exits 2 on FAIL.
Needs numpy and Pillow (build_dem.py), plus tifffile and imagecodecs north of 60 N (build_dem_arctic.py).
"""
import argparse, json, math, os, re, struct, subprocess, sys, unicodedata, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FILES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/'
COP_URL = 'https://copernicus-dem-30m.s3.amazonaws.com'
G_MESH = 768   # the page's mesh points per side (app_view.js G): the blend strip at a box edge is 4.2 far-mesh cells


# ---------- files ----------
def read_png(path, base=0.0, step=0.5):
    b = open(path, 'rb').read(); o = 8; idat = b''; n = 0
    while o < len(b):
        l, = struct.unpack('>I', b[o:o + 4]); t = b[o + 4:o + 8]
        if t == b'IHDR': n, = struct.unpack('>I', b[o + 8:o + 12])
        if t == b'IDAT': idat += b[o + 8:o + 8 + l]
        o += 12 + l
    raw = np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(n, 2 * n + 1)[:, 1:]
    res = raw[:, 0::2].astype(np.int64) * 256 + raw[:, 1::2]
    return base + (np.cumsum(np.cumsum(res, axis=0), axis=1) % 65536) * step

def at(h, box, lat, lng):
    """Bilinear heights of a file (row 0 = north) at points; nan outside the box."""
    n = h.shape[0]; north, south, west, east = box
    r = (north - np.asarray(lat, float)) / (north - south) * n - 0.5; c = (np.asarray(lng, float) - west) / (east - west) * n - 0.5
    ok = (r >= -0.5) & (c >= -0.5) & (r <= n - 0.5) & (c <= n - 0.5)
    r = np.clip(r, 0, n - 1.001); c = np.clip(c, 0, n - 1.001); r0 = r.astype(int); c0 = c.astype(int); fr = r - r0; fc = c - c0
    v = (h[r0, c0] * (1 - fc) + h[r0, c0 + 1] * fc) * (1 - fr) + (h[r0 + 1, c0] * (1 - fc) + h[r0 + 1, c0 + 1] * fc) * fr
    return np.where(ok, v, np.nan)

def metres(box):
    north, south, west, east = box
    return (east - west) * 111320 * math.cos(math.radians((north + south) / 2)), (north - south) * 111132


# ---------- Copernicus GLO-30 (tiled float32 TIFF, deflate, floating-point predictor) ----------
def read_cop(path):
    b = open(path, 'rb').read(); e = '<' if b[:2] == b'II' else '>'
    off, = struct.unpack(e + 'I', b[4:8]); cnt, = struct.unpack(e + 'H', b[off:off + 2]); tag = {}
    size = {1: 1, 3: 2, 4: 4, 12: 8, 16: 8}; fmt = {1: 'B', 3: 'H', 4: 'I', 12: 'd', 16: 'Q'}
    for i in range(cnt):
        t, ty, k, val = struct.unpack(e + 'HHI4s', b[off + 2 + i * 12: off + 14 + i * 12])
        if ty not in fmt: continue
        raw = val[:size[ty] * k] if size[ty] * k <= 4 else b[struct.unpack(e + 'I', val)[0]:][:size[ty] * k]
        tag[t] = struct.unpack(e + str(k) + fmt[ty], raw)
    W, H, tw, th = tag[256][0], tag[257][0], tag[322][0], tag[323][0]
    assert tag[259][0] in (8, 32946) and tag[258][0] == 32 and tag.get(317, (1,))[0] == 3, 'unexpected Copernicus file layout'
    out = np.zeros((H, W), dtype=np.float32); across = (W + tw - 1) // tw
    for k, (o, l) in enumerate(zip(tag[324], tag[325])):
        raw = np.cumsum(np.frombuffer(zlib.decompress(b[o:o + l]), dtype=np.uint8).reshape(th, tw * 4), axis=1, dtype=np.uint8).reshape(th, 4, tw)
        t = (raw[:, 0].astype(np.uint32) << 24 | raw[:, 1].astype(np.uint32) << 16 | raw[:, 2].astype(np.uint32) << 8 | raw[:, 3]).view(np.float32)
        r, c = (k // across) * th, (k % across) * tw
        out[r:r + th, c:c + tw] = t[:min(th, H - r), :min(tw, W - c)]
    return out

def cop_grid(work, lat, lng):
    """Copernicus heights (nearest point) on a lat x lng grid; None when a tile could not be fetched (not the same as open sea)."""
    os.makedirs(f"{work}/cop", exist_ok=True); out = np.zeros((len(lat), len(lng)), dtype=np.float32)
    for la in range(int(math.floor(lat.min())), int(math.floor(lat.max())) + 1):
        for lo in range(int(math.floor(lng.min())), int(math.floor(lng.max())) + 1):
            name = f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM"
            path = f"{work}/cop/{name}.tif"; gone = path + '.none'
            if not os.path.exists(path) and not os.path.exists(gone):
                p = subprocess.run(["curl", "-sS", "-m", "180", "--retry", "2", "-o", path + '.tmp', "-w", "%{http_code}", f"{COP_URL}/{name}/{name}.tif"], capture_output=True, text=True)
                if p.stdout.strip() == '200': os.replace(path + '.tmp', path)
                elif p.stdout.strip() in ('403', '404'): open(gone, 'w').close()     # no tile: open sea
                else: return None
                if os.path.exists(path + '.tmp'): os.remove(path + '.tmp')
            if not os.path.exists(path): continue
            t = read_cop(path); H, W = t.shape
            ri = np.where(np.floor(lat) == la)[0]; ci = np.where(np.floor(lng) == lo)[0]
            if not len(ri) or not len(ci): continue
            r = np.clip(np.rint((la + 1 - lat[ri]) * H).astype(int), 0, H - 1); c = np.clip(np.rint((lng[ci] - lo) * W).astype(int), 0, W - 1)
            out[np.ix_(ri, ci)] = t[np.ix_(r, c)]
    return out

def grow(mask, k):
    """A mask spread k cells in every direction."""
    m = mask.copy()
    for _ in range(k):
        n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]; m = n
    return m


# ---------- the data check ----------
def check(h, box, pins, work, label, wide=None):
    """Prints the numbers and returns 'PASS' / 'WARN' / 'FAIL'. wide = (heights, box) of the wide file to agree with."""
    north, south, west, east = box; w, d = metres(box); worst = ['PASS']; did = 0
    def say(level, text):
        print(f"  [{level:4}] {text}")
        if level == 'FAIL' or (level == 'WARN' and worst[0] == 'PASS'): worst[0] = level
    print(f"DATA CHECK {label}: {north}..{south}, {west}..{east}, {h.shape[0]} x {h.shape[0]} points ({w / h.shape[0]:.1f} x {d / h.shape[0]:.1f} m), heights {h.min():.0f}..{h.max():.0f} m")
    iy, ix = np.unravel_index(np.argmax(h), h.shape)
    print(f"  [info] highest point {h.max():.0f} m at {north - (iy + .5) * (north - south) / h.shape[0]:.4f},{west + (ix + .5) * (east - west) / h.shape[0]:.4f} (compare with a map)")

    # 1. the stops' own stored heights
    st = [s for s in pins.get('stops', []) if s.get('elevation_m') is not None]
    if st:
        la = np.array([s.get('elevation_lat') or s['lat'] for s in st], float); lo = np.array([s.get('elevation_lng') or s['lng'] for s in st], float)
        v = at(h, box, la, lo); ok = ~np.isnan(v); df = v[ok] - np.array([s['elevation_m'] for s in st], float)[ok]
        if len(df) >= 5:
            did += 1; med = float(np.median(df)); near = float(np.mean(np.abs(df) <= 25))
            say('FAIL' if abs(med) > 10 or near < 0.7 else 'WARN' if abs(med) > 5 or near < 0.85 else 'PASS',
                f"stops' stored heights, {len(df)} in the box: file minus stored: middle {med:+.1f} m, {near:.0%} within 25 m, worst {df[np.argmax(np.abs(df))]:+.0f} m")
        else: print(f"  [info] only {len(df)} stops with a stored height in the box: not enough to judge")
    else: print("  [info] no stops with a stored height")

    # 2. Copernicus GLO-30 on a ~100 m grid: land level, and the water along the coast
    m = int(max(64, min(900, round(max(w, d) / 100))))
    la = north - (np.arange(m) + .5) * (north - south) / m; lo = west + (np.arange(m) + .5) * (east - west) / m
    C = cop_grid(work, la, lo)
    if C is None: say('WARN', "Copernicus could not be fetched: no independent land / sea check")
    else:
        S = at(h, box, la[:, None] + 0 * lo[None, :], lo[None, :] + 0 * la[:, None]); cell = max(w, d) / m
        land = C > 5
        if land.sum() >= 200:
            did += 1; df = (S - C)[land]; med = float(np.median(df))
            say('FAIL' if abs(med) > 10 else 'WARN' if abs(med) > 5 else 'PASS',
                f"land against Copernicus, {int(land.sum())} points: file minus Copernicus: middle {med:+.1f} m, 10% below {np.percentile(df, 10):+.0f} m, 10% above {np.percentile(df, 90):+.0f} m")
        else: print("  [info] hardly any land in the box by Copernicus")
        dry = C > 0.5; coast = ~grow(dry, max(1, round(200 / cell))) & grow(dry, max(2, round(2000 / cell)))
        if coast.sum() >= 200:
            did += 1; v = S[coast]; flat = float(np.mean(np.abs(v) <= 2))
            say('FAIL' if flat < 0.90 else 'WARN' if flat < 0.97 else 'PASS',
                f"sea along the coast (200 m to 2 km offshore), {int(coast.sum())} points: {flat:.0%} read within 2 m of 0, 1 in 20 reads above {np.percentile(v, 95):.0f} m, highest {v.max():.0f} m")
        else: print("  [info] no sea coast in the box")

    # 3. known heights from the trip's data
    for k in pins.get('known', []):
        v = float(at(h, box, np.array([k['lat']]), np.array([k['lng']]))[0])
        if not math.isnan(v) and k.get('elev_m') is not None:
            df = v - float(k['elev_m'])
            say('FAIL' if abs(df) > 20 else 'WARN' if abs(df) > 8 else 'PASS', f"{k.get('name', 'known point')} ({k['elev_m']:.0f} m): file reads {v:.0f} m ({df:+.0f} m)")

    # 4. a fine box must sit on the wide file's heights: the page blends the two along the box edge
    if wide is not None:
        k = 200; la = north - (np.arange(k) + .5) * (north - south) / k; lo = west + (np.arange(k) + .5) * (east - west) / k
        LA = la[:, None] + 0 * lo[None, :]; LO = lo[None, :] + 0 * la[:, None]
        df = at(h, box, LA, LO) - at(wide[0], wide[1], LA, LO); df = df[~np.isnan(df)]
        if len(df):
            did += 1; med = float(np.median(df))
            say('FAIL' if abs(med) > 5 else 'WARN' if abs(med) > 2 else 'PASS', f"against the wide file: middle {med:+.1f} m, 9 in 10 within {np.percentile(np.abs(df), 90):.0f} m")
    if not did: say('FAIL', "nothing to check this file against (no stored stop heights, no Copernicus)")
    print(f"  => {worst[0]}")
    return worst[0]


# ---------- pins ----------
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
def load_pins(a):
    if a.pins: return json.load(open(a.pins))
    if not a.trip: return {}
    assert UUID.match(a.trip), 'the trip must be a uuid'
    q = a.q or os.environ.get('TRIP_Q'); assert q, 'give --q <read-only SQL helper> (or $TRIP_Q), or --pins <file>'
    def run(sql):
        out = json.loads(subprocess.run([q, sql], capture_output=True, text=True, check=True).stdout)
        assert isinstance(out, list), f"the SQL helper answered: {out}"
        return out
    pins = {
        'trip': a.trip,
        'stops': run(f"select s.name, s.lat, s.lng, s.elevation_m, s.elevation_lat, s.elevation_lng from stops s join days d on d.id = s.day_id where d.trip_id = '{a.trip}' and s.lat is not null and s.lng is not null"),
        'shots': run(f"select s.name as stop, sv.lat as vlat, sv.lng as vlng, ss.name as subject, ss.lat as slat, ss.lng as slng from stops s join days d on d.id = s.day_id join stop_sun_pairs p on p.stop_id = s.id join scout_vantages sv on sv.id = p.vantage_id join scout_subjects ss on ss.id = sv.subject_id where d.trip_id = '{a.trip}' and sv.lat is not null and ss.lat is not null order by s.name, sv.lat, sv.lng"),
        'known': run("select icao || ' airport' as name, lat, lng, elev_m from metar_stations where elev_m is not null"),
        'regions': run("select id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground from terrain_regions"),
    }
    if getattr(a, 'work', None): os.makedirs(a.work, exist_ok=True); json.dump(pins, open(f"{a.work}/pins.json", 'w'), indent=1)
    return pins


# ---------- fine boxes ----------
def slug(s):
    s = re.sub(r"['’]", '', re.sub(r'[–—-]', ' ', s)).lower()
    for a, b in (('ð', 'd'), ('ø', 'o'), ('æ', 'ae'), ('þ', 'th'), ('ß', 'ss'), ('ł', 'l')): s = s.replace(a, b)
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return '_'.join(re.findall(r'[a-z0-9]+', s)[:3]) or 'box'

def plan_boxes(pins, a, step, band):
    """Stand spots (with close subjects) grouped into boxes: [(id, (north, south, west, east), n, [stop names])]."""
    shots = pins.get('shots', []); assert shots, 'no shots (stand spot + subject) for this trip'
    lat0 = float(np.mean([s['vlat'] for s in shots])); kx = 111320 * math.cos(math.radians(lat0)); kz = 111132
    tight = min(a.pad, band + 400)   # grouping goes by the least ground a stand spot needs (the blend strip plus 400 m); the full --pad is added after, where it fits
    cl = {}
    for s in shots:   # one need per stand spot: its ground, plus any subject close enough to share the box
        key = (round(s['vlat'], 5), round(s['vlng'], 5)); x, z = s['vlng'] * kx, s['vlat'] * kz
        b = cl.setdefault(key, {'box': [x - tight, x + tight, z - tight, z + tight], 'stops': [], 'pts': [(x, z, s['stop'])]})['box']
        if s['stop'] not in cl[key]['stops']: cl[key]['stops'].append(s['stop'])
        sx, sz = s['slng'] * kx, s['slat'] * kz
        if math.hypot(sx - x, sz - z) <= a.close_km * 1000:
            q = min(a.pad, 700); b[0] = min(b[0], sx - q); b[1] = max(b[1], sx + q); b[2] = min(b[2], sz - q); b[3] = max(b[3], sz + q)
    cl = list(cl.values()); side = lambda b: max(b[1] - b[0], b[3] - b[2]); join = lambda p, q: [min(p[0], q[0]), max(p[1], q[1]), min(p[2], q[2]), max(p[3], q[3])]
    while True:   # merge the pair whose shared box is smallest, while it stays under the size limit
        best = None
        for i in range(len(cl)):
            for j in range(i + 1, len(cl)):
                u = join(cl[i]['box'], cl[j]['box'])
                if side(u) <= a.near_max_km * 1000 and (best is None or side(u) < best[0]): best = (side(u), i, j, u)
        if not best: break
        _, i, j, u = best; cl[i] = {'box': u, 'stops': cl[i]['stops'] + [s for s in cl[j]['stops'] if s not in cl[i]['stops']], 'pts': cl[i]['pts'] + cl[j]['pts']}; del cl[j]
    out, used = [], set()
    for c in sorted(cl, key=lambda c: c['box'][0]):
        b = c['box']; want = list(b)
        for x, z, _ in c['pts']: want = join(want, [x - a.pad, x + a.pad, z - a.pad, z + a.pad])
        for lo, hi in ((0, 1), (2, 3)):   # grow toward the full pad, as far as the size limit lets it
            room = max(0.0, a.near_max_km * 1000 - (b[hi] - b[lo])); ask = (b[lo] - want[lo]) + (want[hi] - b[hi]); k = min(1.0, room / ask) if ask > 0 else 0.0
            b[lo] -= (b[lo] - want[lo]) * k; b[hi] += (want[hi] - b[hi]) * k
        for lo, hi, other in ((0, 1, b[3] - b[2]), (2, 3, b[1] - b[0])):   # the grid is square: widen a thin box to 0.7 of its long side, more ground for the same file
            short = 0.7 * other - (b[hi] - b[lo])
            if short > 0: b[lo] -= short / 2; b[hi] += short / 2
        r = lambda v, up: (math.ceil(v * 2000) if up else math.floor(v * 2000)) / 2000   # outward to 0.0005 deg
        box = (r(b[3] / kz, True), r(b[2] / kz, False), r(b[0] / kx, False), r(b[1] / kx, True))
        n = int(min(2048, max(512, math.ceil(max(metres(box)) / step / 128) * 128)))
        cx, cz = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
        name = min(c['pts'], key=lambda t: math.hypot(t[0] - cx, t[1] - cz))[2]   # named after the stop nearest its middle
        bid = f"{a.prefix}_{slug(name)}"; k = 2
        while bid in used: bid = f"{a.prefix}_{slug(name)}_{k}"; k += 1
        used.add(bid); out.append((bid, box, n, c['stops']))
    return out


def build_file(a, source, out, box, n, zoom):
    if source == 'arctic': cmd = [sys.executable, f"{HERE}/build_dem_arctic.py", a.work, out] + [str(v) for v in box] + [str(n)]
    else: cmd = [sys.executable, f"{HERE}/build_dem.py", a.work, out] + [str(v) for v in box] + [str(zoom), '0', str(n)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode: print(p.stdout[-2000:], p.stderr[-2000:]); raise SystemExit(f"building {out} failed")

def tile_px(zoom, lat): return 40075016.686 * math.cos(math.radians(lat)) / 256 / 2 ** zoom


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); sub = ap.add_subparsers(dest='cmd', required=True)
    def common(p):
        p.add_argument('--trip'); p.add_argument('--pins'); p.add_argument('--q')
    c = sub.add_parser('check'); c.add_argument('file'); c.add_argument('box', nargs=4, type=float, metavar=('NORTH', 'SOUTH', 'WEST', 'EAST'))
    c.add_argument('--base', type=float, default=0.0); c.add_argument('--work', default='.'); c.add_argument('--label'); common(c)
    for name in ('plan', 'build'):
        b = sub.add_parser(name); b.add_argument('work'); b.add_argument('--region', required=True); common(b)
        b.add_argument('--prefix', help='start of the fine boxes\' ids (default: the region id)')
        b.add_argument('--source', choices=['arctic', 'terrarium']); b.add_argument('--ground', choices=['snow', 'green'], default='green')
        b.add_argument('--near-zoom', type=int, default=14, help='terrarium zoom for the fine boxes (14 = about 7 m at 45 N)')
        b.add_argument('--near-max-km', type=float, default=8.0); b.add_argument('--pad', type=float, default=2000.0, help='metres of fine ground around every stand spot')
        b.add_argument('--close-km', type=float, default=6.0, help='a subject this close to its stand spot goes in the same box')
        b.add_argument('--wide-file'); b.add_argument('--force', action='store_true', help='go on after a failed data check')
    a = ap.parse_args(); pins = load_pins(a)

    if a.cmd == 'check':
        box = tuple(a.box); ok = check(read_png(a.file, a.base), box, pins, a.work, a.label or os.path.basename(a.file))
        raise SystemExit(2 if ok == 'FAIL' else 0)

    a.prefix = a.prefix or a.region; os.makedirs(f"{a.work}/files", exist_ok=True)
    shots = pins.get('shots', []); assert shots, 'no shots for this trip'
    lats = [s['vlat'] for s in shots] + [s['slat'] for s in shots]; lngs = [s['vlng'] for s in shots] + [s['slng'] for s in shots]
    region = next((r for r in pins.get('regions', []) if r['id'] == a.region), None)
    if region: wbox = (region['north'], region['south'], region['west'], region['east']); wn, wbase = region['n'], region['base_m']
    else:   # a new region: all the pins plus 6 km, to 0.01 deg
        mid = math.radians((max(lats) + min(lats)) / 2); py = 6000 / 111132; px = 6000 / (111320 * math.cos(mid))
        wbox = (math.ceil((max(lats) + py) * 100) / 100, math.floor((min(lats) - py) * 100) / 100, math.floor((min(lngs) - px) * 100) / 100, math.ceil((max(lngs) + px) * 100) / 100); wn, wbase = 2048, 0.0
    source = a.source or ('arctic' if wbox[1] >= 60 else 'terrarium'); ww, wd = metres(wbox)
    mlat = (wbox[0] + wbox[1]) / 2; wzoom = int(min(14, max(8, math.ceil(math.log2(40075016.686 * math.cos(math.radians(mlat)) / 256 / (min(ww, wd) / wn))))))
    step = 4.0 if source == 'arctic' else tile_px(a.near_zoom, mlat)
    print(f"region {a.region} ({'already listed' if region else 'new'}): {wbox[0]}..{wbox[1]}, {wbox[2]}..{wbox[3]}, {ww / 1000:.0f} x {wd / 1000:.0f} km; source: {'ArcticDEM v4.1' if source == 'arctic' else 'terrarium tiles'}; fine boxes at about {step:.1f} m a point")
    if max(ww, wd) > 90000: print(f"  [WARN] the area is {max(ww, wd) / 1000:.0f} km across: one wide file gets coarse ({max(ww, wd) / wn:.0f} m a point). Think about one region per part of the trip.")
    outside = sorted({s['stop'] for s in shots if not (wbox[1] <= s['vlat'] <= wbox[0] and wbox[2] <= s['vlng'] <= wbox[3])})
    if outside: print(f"  [WARN] stand spots outside the region, no 3D view there: {', '.join(outside)}")
    band = 4.2 * max(ww, wd) / (G_MESH - 1)
    boxes = plan_boxes({**pins, 'shots': [s for s in shots if wbox[1] <= s['vlat'] <= wbox[0] and wbox[2] <= s['vlng'] <= wbox[3]]}, a, step, band)
    print(f"{len(boxes)} fine boxes (the outer {band:.0f} m of each blends into the wide grid):")
    for bid, box, n, stops in boxes:
        w, d = metres(box); print(f"  {bid}: {box[0]}..{box[1]}, {box[2]}..{box[3]}, {w / 1000:.1f} x {d / 1000:.1f} km, n {n} ({w / n:.1f} x {d / n:.1f} m): {', '.join(stops)}")
    if a.cmd == 'plan': return

    # the wide file, and its check: the gate
    wsuffix = 'adem32' if source == 'arctic' else f"z{wzoom}"
    if region:
        wpath = a.wide_file or f"{a.work}/files/{region['path']}"
        if not os.path.exists(wpath):
            p = subprocess.run(["curl", "-sS", "-f", "-m", "180", "-o", wpath, FILES_URL + region['path']]); assert p.returncode == 0, f"could not fetch {region['path']}: give --wide-file"
    else:
        wpath = f"{a.work}/files/{a.region}_{wsuffix}.png"; print(f"building the wide file {os.path.basename(wpath)} ...", flush=True); build_file(a, source, wpath, wbox, wn, wzoom)
    wide = read_png(wpath, wbase)
    verdict = check(wide, wbox, pins, a.work, f"wide file {os.path.basename(wpath)}")
    if verdict == 'FAIL' and not a.force: raise SystemExit("The wide file FAILED the data check: nothing else was built. Try the other --source, or --force if you know why it is off.")

    rows, uploads, bad = [], [] if region else [wpath], []
    for bid, box, n, stops in boxes:
        path = f"{a.work}/files/{bid}_{'4m' if source == 'arctic' else 'z' + str(a.near_zoom)}.png"
        print(f"building {os.path.basename(path)} ...", flush=True); build_file(a, source, path, box, n, a.near_zoom)
        v = check(read_png(path, 0.0), box, pins, a.work, f"fine box {bid}", wide=(wide, wbox))
        if v == 'FAIL' and not a.force: bad.append(bid); os.replace(path, path + '.failed'); continue
        w, d = metres(box); rows.append((bid, box, n, w, d, os.path.basename(path), os.path.getsize(path))); uploads.append(path)

    src_note = 'ArcticDEM v4.1 (PGC, CC-BY-4.0), sea level taken off' if source == 'arctic' else 'Public terrarium tiles'
    sql = [f"-- 3D sun view terrain for region {a.region}" + (f", trip {pins['trip']}" if pins.get('trip') else '') + ". Written by tools/sun3d/build_trip_terrain.py.",
           "-- Upload the files in upload.txt to Storage bucket terrain FIRST, then apply this."]
    if not region:
        sql.append("insert into public.terrain_regions (id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground, note) values\n"
                   f"  ('{a.region}', {wbox[0]}, {wbox[1]}, {wbox[2]}, {wbox[3]}, {wn}, {ww:.0f}, {wd:.0f}, 0, 0.5, '{os.path.basename(wpath)}', {os.path.getsize(wpath)}, '{a.ground}', '{src_note}, about {max(ww, wd) / wn:.0f} m a point.')\non conflict (id) do nothing;")
    if rows:
        sql.append("insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, note) values\n" + ",\n".join(
            f"  ('{bid}', '{a.region}', {box[0]}, {box[1]}, {box[2]}, {box[3]}, {n}, {w:.0f}, {d:.0f}, 0, 0.5, '{name}', {size}, '{src_note}{'' if source == 'arctic' else ', zoom ' + str(a.near_zoom)}, about {max(w, d) / n:.0f} m a point.')"
            for bid, box, n, w, d, name, size in rows) + "\non conflict (id) do nothing;")
    open(f"{a.work}/terrain_{a.region}.sql", 'w').write("\n".join(sql) + "\n"); open(f"{a.work}/upload.txt", 'w').write("\n".join(uploads) + "\n")
    print(f"\nwrote {a.work}/terrain_{a.region}.sql ({len(rows)} fine boxes{'' if region else ' + the region'}) and {a.work}/upload.txt ({len(uploads)} files, {sum(os.path.getsize(p) for p in uploads) / 1e6:.1f} MB)")
    if bad: print(f"LEFT OUT, failed the data check: {', '.join(bad)}")
    print("Next: upload the files to bucket `terrain`, apply the SQL, open two stops in the TEST app's 3D view.")

if __name__ == '__main__': main()
