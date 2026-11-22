#!/usr/bin/env python3
"""3D sun view, a close-up ("detail") box for a stand spot OUTSIDE every laser point-cloud survey (22 Nov 2026).

  build_dem_detail.py build <work dir> --id <slug> --lat <stand lat> --lng <stand lng> [options]
  build_dem_detail.py check <work dir> [--near-file f --near-box n,s,w,e --near-base b --near-step s]   decode and compare
  build_dem_detail.py sql   <work dir> --migration <file>        the migration + files/upload.txt (NOT applied)
Emily's Pond Levee (22 Nov 2026): build <work> --id emilys_pond_levee --lat 43.513979 --lng -110.828615

The other Teton close-up boxes (terrain_detail_regions_v4, tools/sun3d/lidar/build_detail.py) come from the 2022 park
point cloud, which ends at lat 43.538. A spot south of it (Emily's Pond Levee, Wilson) has no point cloud, so no trees
and no buildings: this builder makes ground + water only, in the same files the page reads for a v4 box:

  <id>_lidar_v4.png   heights, 1504 x 1504 at 1 m, 16-bit prediction residuals, height = base_m + value * 0.02 m
                      (write_heights of build_detail.py), base_m = the box's lowest height less 5 m, rounded down
  <id>_mask_v4.png    class mask, 8-bit: 0 ground / snow, 3 water (no 2 buildings, no 8+ trees here)
  <id>_water_v4.png   the water of the 6 km around (1500 x 1500 at 4 m, centred on the box): 0 none, 1 moving, 2 still
  <id>_colour_v4.jpg  aerial photo (USDA NAIP, The National Map ImageServer) turned to late December with
                      tools/sun3d/teton_colour/build_teton_colour.py winterize, its fine-box branch (conifers kept dark,
                      broadleaf as bare twigs: no survey trees are drawn here), the mask's water painted the laser boxes'
                      dark water colour (the page draws water itself; this is its colour at a blend edge)

Heights, best first, cell by cell:
  1. a USGS 3DEP 1 m bare-earth DEM project (--projects, staged GeoTIFFs on prd-tnm.s3; read at full resolution with
     range requests, cached in <work>/tnm). These are hydro-flattened: open water is a perfectly smooth surface, so
     water there is found from the heights (near-zero curvature and slope, connected, at the local low);
  2. else the 3DEP 1/3 arc-second DEM (~10 m, n44w111 for the Tetons), cubic-sampled to 1 m. At 10 m a river's
     braids and banks are smeared, so water there comes from the photo: NAIP's near-infrared (water swallows it) checked against the heights (only at
     the local low) and the shape (connected patches, no slivers). Water cells then get a smooth, flat level.
The 22 Nov 2026 check: neither WY_GrandTetonElkRefuge_2014 (1 m tiles and its OPR original) nor WY_GrandTetonNP_D22
has a single cell within 3 km of Emily's Pond Levee (the 2014 survey's data stops at 43.548 west of -110.76), so that
box is 10 m heights + photo water. The builder says which source each part came from (note column).

Moving vs still (the wide layer; the box's water takes the class of the wide cell under it, as the page reads it): a
water patch joined to the main river (the longest patch, over 2 km) or a long thin one whose level falls over 1.2 m a
km = moving; any other = still (ponds, cut-off sloughs). Photo water on a steep face, or a patch on sloping ground,
is dropped, unless it is a long ribbon (a river): seen 22 Nov 2026 north-east of Emily's, where the 10 m DEM puts the
river's bank bluff tens of metres off the photo, so that stretch of the Snake (outside the 1.5 km box) is left out.

Needs: pip install tifffile imagecodecs numpy scipy pillow pyproj requests. Output in <work>/files, look-at pictures
in <work>/look (_box: heights + water + the stand spot, _wide: the 6 km layer, _photo_check: the summer photo with the
water found over it, _colour), <work>/row.json; nothing is uploaded or written to the database.
"""
import argparse, json, logging, math, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import requests, tifffile
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, 'lidar')); sys.path.insert(0, os.path.join(HERE, 'teton_colour'))
from build_range import window, sample, to_utm, TNM                      # noqa: E402  (range-read GeoTIFF windows, bilinear sampling)
from build_detail import write_heights, write_mask, write_bytes, STEP     # noqa: E402  (the page's file formats)
from build_trip_terrain import read_png                                   # noqa: E402
import build_teton_colour as btc                                          # noqa: E402

logging.getLogger('tifffile').setLevel(logging.ERROR)   # the staged DEMs' GDAL_NODATA (-3.4e38) warns on every page
KZ = 111132.0
KX = lambda lat: 111320 * math.cos(math.radians(lat))
NAIP = btc.NAIP
WIDE_HALF, WIDE_CELL = 3000.0, 4.0


def log(*a): print(*a, flush=True)


# ---------------------------------------------------------------- boxes
def square(clat, clng, half):
    kx = KX(clat)
    return dict(north=round(clat + half / KZ, 6), south=round(clat - half / KZ, 6), west=round(clng - half / kx, 6), east=round(clng + half / kx, 6))


def centres(b, n):
    """Cell-centre lat / lng of an n x n grid over a box (row 0 = north)."""
    lat = b['north'] - (np.arange(n) + .5) * (b['north'] - b['south']) / n
    lng = b['west'] + (np.arange(n) + .5) * (b['east'] - b['west']) / n
    return np.meshgrid(lat, lng, indexing='ij')


# ---------------------------------------------------------------- heights
def list_keys(project, cache):
    p = os.path.join(cache, f'keys_{project}.txt')
    if os.path.exists(p): return open(p).read().split()
    keys, token = [], None
    while True:
        q = f"https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts/Elevation/1m/Projects/{project}/TIFF/&max-keys=1000" + (f"&continuation-token={requests.utils.quote(token)}" if token else '')
        t = requests.get(q, timeout=120).text
        keys += re.findall(r'<Key>([^<]+\.tif)</Key>', t)
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', t)
        if not m: break
        token = m.group(1)
    os.makedirs(cache, exist_ok=True); open(p, 'w').write('\n'.join(keys))
    return keys


def heights(work, b, n, projects, fine=True):
    """n x n heights over box b and the source of each cell: 1 = a 1 m lidar DEM project, 3 = the 1/3 arc-second DEM."""
    LA, LO = centres(b, n); E, N = to_utm.transform(LO, LA)
    h = np.full(LA.shape, np.nan); src = np.zeros(LA.shape, np.uint8); cache = f"{work}/tnm"; pad = 20
    if fine:
        for proj in projects:
            keys = list_keys(proj, cache)
            for x in range(int((E.min() - pad) // 10000), int((E.max() + pad) // 10000) + 1):
                for y in range(int((N.min() - pad) // 10000) + 1, int((N.max() + pad) // 10000) + 2):
                    k = next((k for k in keys if re.search(rf'_x{x}y{y}_', k) and ('_1M_12_' in k or '_one_meter_' in k)), None)   # UTM zone 12 tiles only
                    if not k: continue
                    w = window('https://prd-tnm.s3.amazonaws.com/' + k, cache, 1.0, E.min() - pad, E.max() + pad, N.min() - pad, N.max() + pad, k.split('/')[-1])
                    if w is None: continue
                    before = np.isnan(h); sample(w, E, N, h); src[before & ~np.isnan(h)] = 1
    if np.isnan(h).any():   # the 1/3 arc-second DEM: cubic (a 10 m grid drawn at 1 m with bilinear shows its facets under a low sun)
        la, lo = math.floor(float(LA.min())), math.ceil(float(-LO.max()))
        url = f"{TNM}/13/TIFF/current/n{la + 1:02d}w{lo:03d}/USGS_13_n{la + 1:02d}w{lo:03d}.tif"
        arr, fx, fy, ps = window(url, cache, 0.0, LO.min() - .002, LO.max() + .002, LA.min() - .002, LA.max() + .002, url.split('/')[-1])
        a = np.where(np.isnan(arr), np.nanmean(arr), arr).astype(np.float64)
        v = ndimage.map_coordinates(a, [(fy - LA) / ps - 0.5, (LO - fx) / ps - 0.5], order=3, mode='nearest')
        miss = np.isnan(h); h[miss] = v[miss]; src[miss] = 3
    return h, src, LA, LO


# ---------------------------------------------------------------- the aerial photo
def naip(work, tag, b, w, h, tile=4000):
    """NAIP r g b nir (0-1) over box b, w x h, north up on its lat / lng grid, cached in <work>/cache/naip. ONE request
    per picture (the server allows 4000 x 4000): pictures asked for in pieces come back with a different tone per piece
    (seen 22 Nov 2026: ~10 levels of 255 between two pieces of the same place), which would draw as seams."""
    d = os.path.join(work, 'cache', 'naip'); os.makedirs(d, exist_ok=True)
    out = np.zeros((h, w, 4), np.float32)
    dla, dlo = (b['north'] - b['south']) / h, (b['east'] - b['west']) / w
    jobs = [(r0, min(h, r0 + tile), c0, min(w, c0 + tile)) for r0 in range(0, h, tile) for c0 in range(0, w, tile)]

    def one(j):
        r0, r1, c0, c1 = j; p = os.path.join(d, f'{tag}_{w}x{h}_{r0}_{c0}.tif')
        if not os.path.exists(p):
            q = dict(bbox=f"{b['west'] + c0 * dlo},{b['north'] - r1 * dla},{b['west'] + c1 * dlo},{b['north'] - r0 * dla}", bboxSR=4326, imageSR=4326,
                     size=f'{c1 - c0},{r1 - r0}', format='tiff', pixelType='U8', bandIds='0,1,2,3', interpolation='RSP_BilinearInterpolation', f='image')
            for k in range(6):
                try:
                    r = requests.get(NAIP, params=q, timeout=900)
                    if r.status_code < 500 and r.content[:2] in (b'II', b'MM'): break
                except requests.RequestException: pass
                time.sleep(10 + 20 * k)
            else: raise RuntimeError('NAIP: no picture for ' + p)
            open(p + '.tmp', 'wb').write(r.content); os.replace(p + '.tmp', p)
        a = tifffile.imread(p)
        assert a.shape == (r1 - r0, c1 - c0, 4), (p, a.shape)
        out[r0:r1, c0:c1] = a.astype(np.float32) / 255
    with ThreadPoolExecutor(3) as ex: list(ex.map(one, jobs))
    return out


# ---------------------------------------------------------------- water
NDWI_MIN, NIR_MAX = 0.30, 0.40   # photo water: green over near-infrared (water swallows the infrared), and dark in it
LOW_M = 0.6                      # a water patch lies no higher than the ground around it (median, metres)
SLOPE_MAX, SLOPE_PATCH = 0.35, 0.12   # not on a steep face (cell), and a patch on level ground (its median slope)


def photo_water(nb, h, cell):
    """Candidate water from the photo: the normalised green / near-infrared difference and the infrared alone, not on a
    steep face (slope over ~10 m under SLOPE_MAX; the braids and bars of a river in a 10 m DEM reach ~0.2)."""
    g, nir = nb[..., 1], nb[..., 3]
    ndwi = (g - nir) / np.maximum(g + nir, 1e-3)
    gy, gx = np.gradient(ndimage.uniform_filter(h, max(1, int(round(10 / cell)))), cell)
    return (ndwi > NDWI_MIN) & (nir < NIR_MAX) & (np.hypot(gx, gy) < SLOPE_MAX), ndwi


def flat_water(h, src, cell):
    """Hydro-flattened water in a 1 m lidar DEM: near-zero curvature and slope over 5 x 5 cells (a flattened surface is
    exactly smooth; lidar ground has a few cm of texture). Only where the heights came from a lidar project."""
    if not (src == 1).any(): return np.zeros(h.shape, bool)
    lap = np.abs(ndimage.laplace(h)); gy, gx = np.gradient(h, cell)
    smooth = ndimage.uniform_filter(lap, 5) < 0.004
    flat = ndimage.uniform_filter(np.hypot(gx, gy), 5) < 0.01
    return smooth & flat & (src == 1)


def components(cand, h, cell, min_m2, ring_m=12.0):
    """Keep the candidate patches that are big enough and lie at the local low: the patch's median height is no more than
    LOW_M above the median of a ring of ground around it (a tree shadow on a hillside or a dark roof fails it), and on
    level ground (median slope over ~10 m under SLOPE_PATCH: a dark bluff above the river fails it). A long ribbon of
    water (20,000 m2, area under 6 % of its length squared) is kept whatever the heights say: a 10 m DEM made from an
    older survey can put a river at the foot of a bluff partly on the bluff."""
    gy, gx = np.gradient(ndimage.uniform_filter(h, max(1, int(round(10 / cell)))), cell); slope = np.hypot(gx, gy)
    lab, k = ndimage.label(cand, structure=np.ones((3, 3)))
    if not k: return np.zeros(cand.shape, bool), []
    sl = ndimage.find_objects(lab); keep = np.zeros(k + 1, bool); info = []
    rk = max(1, int(round(ring_m / cell))); disk = np.hypot(*np.mgrid[-rk:rk + 1, -rk:rk + 1]) <= rk
    for i, s in enumerate(sl, 1):
        area = (lab[s] == i).sum() * cell * cell
        if area < min_m2: continue
        s2 = tuple(slice(max(0, a.start - rk), a.stop + rk) for a in s)
        me = lab[s2] == i; ring = ndimage.binary_dilation(me, disk) & ~cand[s2]
        if ring.sum() < 4: continue
        d = float(np.median(h[s2][me]) - np.median(h[s2][ring])); sm = float(np.median(slope[s2][me]))
        ext = math.hypot((s[0].stop - s[0].start) * cell, (s[1].stop - s[1].start) * cell)
        river = area >= 20000 and area / (ext * ext) < 0.06   # a long ribbon of water: a river, whatever a coarse DEM says of its banks
        if river or (d <= LOW_M and sm < SLOPE_PATCH):
            keep[i] = True
            info.append(dict(id=i, m2=area, above_ring=round(d, 2), slope=round(sm, 3), extent_m=round(ext), river=river))
    return keep[lab], info


def tidy(water, cell):
    """No slivers one cell wide, small gaps between braids and bars closed, small holes filled (<= 30 m2)."""
    k = max(1, int(round(2.0 / cell)))
    st = np.ones((2 * k + 1, 2 * k + 1), bool) if cell < 2 else np.ones((3, 3), bool)
    w = ndimage.binary_opening(water, st) | (water & ndimage.binary_dilation(ndimage.binary_opening(water, st)))
    holes = ndimage.binary_fill_holes(w) & ~w
    lab, k = ndimage.label(holes)
    if k:
        sizes = ndimage.sum(holes, lab, range(1, k + 1)) * cell * cell
        w |= np.isin(lab, 1 + np.nonzero(sizes <= 30)[0])
    return w


def moving_still(water, h, cell):
    """1 moving / 2 still. Moving = joined (within 3 cells) to the main river (the longest water patch, when it is over
    2 km across), or a long thin patch (over 400 m, area under 6 % of its length squared: a creek or side channel)
    whose surface falls over 1.2 m a km (10th to 90th percentile of its inner cells, over its length). Any other patch
    is still (ponds, cut-off sloughs). Inner cells only: a 10 m DEM smears the banks into a pond's edge."""
    joined = ndimage.binary_dilation(water, iterations=3)
    lab, k = ndimage.label(joined, structure=np.ones((3, 3))); lab = np.where(water, lab, 0)
    cls = np.zeros(water.shape, np.uint8)
    if not k: return cls, []
    sl = ndimage.find_objects(lab); ext = []
    for i, s in enumerate(sl, 1):
        if s is None: ext.append(0.0); continue
        ext.append(math.hypot((s[0].stop - s[0].start) * cell, (s[1].stop - s[1].start) * cell))
    main = int(np.argmax(ext)) + 1 if max(ext) >= 2000 else None
    out = []
    for i, s in enumerate(sl, 1):
        if s is None: continue
        me = lab[s] == i; inner = ndimage.binary_erosion(me); e = max(ext[i - 1], cell)
        v = h[s][inner if inner.sum() >= 8 else me]; m2 = float(me.sum() * cell * cell)
        fall = float(np.percentile(v, 90) - np.percentile(v, 10)) / (e / 1000)
        thin = m2 / (e * e) < 0.06
        mv = i == main or (e >= 400 and thin and fall > 1.2)
        cls[s][me] = 1 if mv else 2
        out.append(dict(m2=m2, extent_m=round(e), fall_m_km=round(fall, 2), thin=bool(thin), moving=bool(mv), main=i == main))
    return cls, out


def water_level(h, water, cell, win_m=40.0):
    """A smooth water surface: the heights of the water cells averaged over ~win_m (only water cells count), so the
    channel reads as one flat sheet sloping gently downstream; the ground within 3 m is kept a little above it."""
    k = max(3, int(round(win_m / cell)) | 1)
    num = ndimage.uniform_filter(np.where(water, h, 0.0), k); den = ndimage.uniform_filter(water.astype(float), k)
    lev = np.where(den > 1e-6, num / np.maximum(den, 1e-6), h)
    # again without the water cells standing well above that (a coarse DEM smears the banks into the channel's edge)
    ok = water & (h <= lev + 0.3)
    num = ndimage.uniform_filter(np.where(ok, h, 0.0), k); den = ndimage.uniform_filter(ok.astype(float), k)
    lev = np.where(den > 1e-6, num / np.maximum(den, 1e-6), lev)
    out = np.where(water, lev, h)
    # banks: ground cells within 3 m of water may not lie below the water next to them
    near = ndimage.binary_dilation(water, iterations=max(1, int(round(3 / cell)))) & ~water
    nl = ndimage.grey_dilation(np.where(water, out, -1e9), size=(2 * max(1, int(round(3 / cell))) + 1,) * 2)
    out = np.where(near & (out < nl + 0.05), nl + 0.05, out)
    return out


# ---------------------------------------------------------------- colour (the laser boxes' method, build_teton_colour.py)
def colour(work, bx, n, nb, mask):
    """NAIP turned to late December with the box's mask (winterize), as the v4 laser boxes. The winter truth (Sentinel-2,
    30 Dec 2025 / 11 Jan 2026) and the light of that picture (illum) are read over a 16 km square around the box only,
    from the 1/3 arc-second heights, not the whole Teton grid (same method, smaller read)."""
    clat, clng = (bx['north'] + bx['south']) / 2, (bx['east'] + bx['west']) / 2
    sub = square(clat, clng, 8000.0); m = 600
    sub.update(id='sub', n=m)
    h, _, _, _ = heights(work, sub, m, [], fine=False)
    kx = (sub['east'] - sub['west']) * KX(clat) / m; kz = (sub['north'] - sub['south']) * KZ / m
    keep = btc.REGION; btc.REGION = sub
    try:
        win = btc.Winter(work)
        E = np.zeros((m, m)); lng, lat = btc.latlng_grid(sub, m, m); _, _, _, used = win.sample(lng, lat)
        for k, sc in enumerate(win.sc):
            if (used == k).any(): E[used == k] = btc.illum(h, kx, kz, sc['az'], sc['el'])[used == k]
        E = np.clip(E, 0.22, 1.6)
        fs, nd = btc.winter_at(win, E, dict(bx, id='box'), n, n)
    finally:
        btc.REGION = keep
    # No point cloud = no trees drawn by the page here, so the photo keeps its conifers (dark) and bare broadleaf twigs:
    # the fine-box branch of winterize (kind None), not the laser-box branch (which paints tree cells as snow because the
    # page draws the survey's trees over them). The mask's water is then painted the laser boxes' water colour.
    seen, st = btc.winterize(nb, fs, nd, None)
    seen[mask == 3] = np.array([0.03, 0.05, 0.06]) ** 0.62
    return seen, st


# ---------------------------------------------------------------- look-at picture
def look(path, h, mask, cell, stand_rc, wide=None):
    gy, gx = np.gradient(h, cell); sh = np.clip(0.72 + 0.9 * (-gx - gy) / np.sqrt(1 + gx * gx + gy * gy), 0.2, 1.2)
    img = np.array([228, 230, 226], float)[None, None] * sh[..., None]
    if wide is not None: img[wide == 1] = (30, 90, 200); img[wide == 2] = (110, 175, 235)
    else: img[mask == 3] = (30, 90, 200)
    img = np.clip(img, 0, 255).astype(np.uint8)
    r, c = stand_rc; k = max(4, h.shape[0] // 150)
    img[max(0, r - k):r + k + 1, max(0, c - 1):c + 2] = (230, 20, 20); img[max(0, r - 1):r + 2, max(0, c - k):c + k + 1] = (230, 20, 20)
    Image.fromarray(img).save(path)


def resample(cls, src_box, dst_box, n):
    """Classes of one lat / lng grid read (nearest) at another's cell centres."""
    LA, LO = centres(dst_box, n); m = cls.shape[0]
    r = np.floor((src_box['north'] - LA) / (src_box['north'] - src_box['south']) * m).astype(int)
    c = np.floor((LO - src_box['west']) / (src_box['east'] - src_box['west']) * m).astype(int)
    ok = (r >= 0) & (c >= 0) & (r < m) & (c < m)
    out = np.zeros((n, n), cls.dtype); out[ok] = cls[r[ok], c[ok]]
    return out


def nearest(m, r, c):
    if not m.any(): return float('nan')
    rr, cc = np.nonzero(m); return float(np.min(np.hypot(rr - r, cc - c)))


# ---------------------------------------------------------------- main
def build(a):
    W = a.work; F = f"{W}/files"; os.makedirs(F, exist_ok=True); os.makedirs(f"{W}/look", exist_ok=True)
    projects = [p for p in a.projects.split(',') if p]
    n, cell = a.side, a.cell
    bx = square(a.lat, a.lng, n * cell / 2); wb = square(a.lat, a.lng, WIDE_HALF); wn = int(round(2 * WIDE_HALF / WIDE_CELL))
    log(f"box {bx} ({n} x {n} at {cell:g} m); wide water {wb} ({wn} x {wn} at {WIDE_CELL:g} m)")
    # 1. heights
    h, src, _, _ = heights(W, bx, n, projects)
    hw, srcw, _, _ = heights(W, wb, wn, projects)
    share = {k: float((src == v).mean()) for k, v in (('lidar_1m', 1), ('dem_10m', 3))}
    log(f"heights {h.min():.1f}..{h.max():.1f} m, from {share}; 6 km: lidar {float((srcw == 1).mean()):.1%}")
    # 2. water: the 6 km layer first (4 m), then the box (1 m), which keeps only patches the wide layer also has
    nbw = naip(W, 'wide', wb, wn, wn); nbb = naip(W, 'box', bx, n, n)
    cw, _ = photo_water(nbw, hw, WIDE_CELL); cw = (cw & (srcw != 1)) | flat_water(hw, srcw, WIDE_CELL)
    ww, _ = components(cw, hw, WIDE_CELL, a.min_wide_m2)
    ww = tidy(ww, WIDE_CELL)
    wcls, patches = moving_still(ww, hw, WIDE_CELL)
    cb, _ = photo_water(nbb, h, cell); cb = (cb & (src != 1)) | flat_water(h, src, cell)
    on_box = resample(wcls, wb, bx, n)
    bw, _ = components(cb, h, cell, a.min_box_m2)
    lab, k = ndimage.label(bw, structure=np.ones((3, 3)))
    agree = np.zeros(k + 1, bool)
    if k: agree[np.unique(lab[(lab > 0) & ndimage.binary_dilation(on_box > 0, iterations=8)])] = True; agree[0] = False
    bw = tidy(agree[lab], cell)
    mask = np.zeros((n, n), np.uint8); mask[bw] = 3
    # 3. the water surface, then the files
    hf = water_level(h, bw, cell)
    base = math.floor(float(hf.min())) - 5
    sid, stem = f"gtd15_{a.id}", f"gtd_{a.id}"
    hp, mp, wp, cp = (f"{F}/{stem}_{k}_v4.{e}" for k, e in (('lidar', 'png'), ('mask', 'png'), ('water', 'png'), ('colour', 'jpg')))
    write_heights(hp, hf, base, STEP); write_mask(mp, mask); write_bytes(wp, wcls)
    seen, cst = (None, {}) if a.no_colour else colour(W, bx, n, nbb, mask)
    if seen is not None: btc.save_jpeg(cp, seen, 82)
    # 4. checks: every file decoded back
    back = read_png(hp, base, STEP); assert back.shape == (n, n) and np.abs(back - hf).max() <= STEP / 2 + 1e-6
    assert np.array_equal(np.array(Image.open(mp)), mask) and np.array_equal(np.array(Image.open(wp)), wcls)
    if seen is not None: assert Image.open(cp).size == (n, n)
    kx = KX((bx['north'] + bx['south']) / 2)
    sr, sc = int((bx['north'] - a.lat) / (bx['north'] - bx['south']) * n), int((a.lng - bx['west']) / (bx['east'] - bx['west']) * n)
    wr, wc = int((wb['north'] - a.lat) / (wb['north'] - wb['south']) * wn), int((a.lng - wb['west']) / (wb['east'] - wb['west']) * wn)
    look(f"{W}/look/{stem}_box.png", hf, mask, cell, (sr, sc))
    look(f"{W}/look/{stem}_wide.png", hw, None, WIDE_CELL, (wr, wc), wide=wcls)
    ph = (nbb[..., :3] * 255).astype(np.float64); edge = (mask == 3) & ~ndimage.binary_erosion(mask == 3, iterations=2)
    ph[mask == 3] = ph[mask == 3] * 0.55 + np.array([20, 80, 230]) * 0.45; ph[edge] = (255, 255, 0)
    Image.fromarray(ph.astype(np.uint8)).save(f"{W}/look/{stem}_photo_check.png")   # the summer photo, the water found over it
    if seen is not None: Image.open(cp).save(f"{W}/look/{stem}_colour.png")
    a2, aw = cell * cell, WIDE_CELL * WIDE_CELL
    srcs = ' and '.join(x for x, v in (('USGS 3DEP 1 m lidar DEM', share['lidar_1m']), ('USGS 3DEP 1/3 arc-second DEM (~10 m, cubic to 1 m)', share['dem_10m'])) if v > 0)
    # no semicolons in the note: the Supabase connector stalls on a ';' inside a string literal of an upsert (CLAUDE.md)
    note = f"{srcs}, 1.5 km at 1 m. No point cloud here (no trees, no buildings). Water from USDA NAIP near-infrared checked against the heights, flattened."
    row = dict(id=sid, parent=a.parent, north=bx['north'], south=bx['south'], west=bx['west'], east=bx['east'], n=n,
               width_m=round((bx['east'] - bx['west']) * kx, 1), depth_m=round((bx['north'] - bx['south']) * KZ, 1), base_m=base, step_m=STEP, cell_m=float(cell),
               path=os.path.basename(hp), bytes=os.path.getsize(hp), mask_path=os.path.basename(mp), mask_bytes=os.path.getsize(mp),
               trees_path=None, trees_bytes=None, trees_bins=None, trees_bin_m=None,
               water_path=os.path.basename(wp), water_bytes=os.path.getsize(wp), water_n=wn, water_north=wb['north'], water_south=wb['south'], water_west=wb['west'], water_east=wb['east'],
               color_path=os.path.basename(cp) if seen is not None else None, color_bytes=os.path.getsize(cp) if seen is not None else None, bare=True, note=note)
    rep = dict(row=row, sources=share,
               stand=dict(lat=a.lat, lng=a.lng, height_m=round(float(hf[sr, sc]), 2), dem_10m=round(float(h[sr, sc]), 2), nearest_water_m=round(nearest(mask == 3, sr, sc) * cell, 1)),
               box_water=dict(m2=float((mask == 3).sum() * a2), moving_m2=float(((mask == 3) & (on_box == 1)).sum() * a2), still_m2=float(((mask == 3) & (on_box == 2)).sum() * a2),
                              other_m2=float(((mask == 3) & (on_box == 0)).sum() * a2)),
               wide_water=dict(m2=float((wcls > 0).sum() * aw), moving_m2=float((wcls == 1).sum() * aw), still_m2=float((wcls == 2).sum() * aw), patches=sorted(patches, key=lambda p: -p['m2'])[:12]),
               colour=cst)
    json.dump(rep, open(f"{W}/row.json", 'w'), indent=1)
    log(json.dumps({k: v for k, v in rep.items() if k != 'row'}, indent=1))
    for p in (hp, mp, wp, cp):
        if os.path.exists(p): log(f"  {os.path.basename(p)}: {os.path.getsize(p):,} bytes")


SQL_COLS = ['id', 'parent', 'north', 'south', 'west', 'east', 'n', 'width_m', 'depth_m', 'base_m', 'step_m', 'cell_m', 'path', 'bytes', 'mask_path', 'mask_bytes',
            'trees_path', 'trees_bytes', 'trees_bins', 'trees_bin_m', 'water_path', 'water_bytes', 'water_n', 'water_north', 'water_south', 'water_west', 'water_east',
            'color_path', 'color_bytes', 'bare', 'note']


def sql(a):
    rep = json.load(open(f"{a.work}/row.json")); r = rep['row']
    q = lambda v: 'null' if v is None else ('true' if v is True else 'false' if v is False else repr(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")
    keys = [k for k in ('path', 'mask_path', 'water_path', 'color_path') if r.get(k)]
    total = sum(r[k.replace('path', 'bytes')] for k in keys)
    bw, ww = rep['box_water'], rep['wide_water']
    body = f"""-- 3D sun view: a 1.5 km close-up box with water at {a.title} ({a.date}; NOT applied).
-- Before applying: upload these {len(keys)} files ({total:,} bytes) to the public bucket `terrain`: {', '.join(r[k] for k in keys)}.
-- Built by tools/sun3d/build_dem_detail.py for the stand spot {rep['stand']['lat']}, {rep['stand']['lng']}, which lies outside every
-- laser point cloud (the 2022 park survey ends at lat 43.538; the 2014 Grand Teton / Elk Refuge survey has no data within 3 km):
--   heights: {r['note'].split(', 1.5 km')[0]};
--   mask: 0 ground / 3 water only (no trees, no buildings); water from the NAIP photo's near-infrared, kept only where it lies
--   at the local low and in patches; water cells flattened to a smooth level. Box water {bw['m2']:,.0f} m2 ({bw['moving_m2']:,.0f} moving, {bw['still_m2']:,.0f} still).
--   water_path: the 6 km around at 4 m, 1 moving (the Snake River and what joins it) / 2 still (ponds): {ww['m2'] / 1e4:.1f} ha ({ww['still_m2'] / 1e4:.1f} ha still).
--   color_path: NAIP turned to late December with tools/sun3d/teton_colour/build_teton_colour.py winterize (its fine-box branch:
--   conifers stay dark, no survey trees are drawn here), the mask's water painted the laser boxes' water colour.
-- Same table and formats as the laser boxes (terrain_detail_regions_v4, 20261114010000_terrain_sharp_teton.sql); leaf_mask_path stays null.
insert into public.terrain_detail_regions_v4 ({', '.join(SQL_COLS)}) values
  ({', '.join(q(r.get(c)) for c in SQL_COLS)})
on conflict (id) do update set {', '.join(f'{c} = excluded.{c}' for c in SQL_COLS if c != 'id')};
"""
    open(a.migration, 'w').write(body); log('wrote', a.migration)
    import hashlib
    with open(f"{a.work}/files/upload.txt", 'w') as f:
        f.write('# name\tbytes\tsha256 (upload each to the public bucket terrain under its name)\n')
        for k in keys:
            p = f"{a.work}/files/{r[k]}"; f.write(f"{r[k]}\t{os.path.getsize(p)}\t{hashlib.sha256(open(p, 'rb').read()).hexdigest()}\n")
    log('wrote', f"{a.work}/files/upload.txt")


def check(a):
    """Decode the built files back and compare: heights against the source DEM read afresh (bilinear, raw) at a 5 x 5
    lattice of ground points, against the parent's fine (near) box file if given (--near-file + its base / step / box), the
    stand spot and the highest ground within 30 m of it, water areas, and the water's own flatness."""
    rep = json.load(open(f"{a.work}/row.json")); r = rep['row']; F = f"{a.work}/files"; n = r['n']
    h = read_png(f"{F}/{r['path']}", r['base_m'], r['step_m']); mask = np.array(Image.open(f"{F}/{r['mask_path']}"))
    wcls = np.array(Image.open(f"{F}/{r['water_path']}")); col = Image.open(f"{F}/{r['color_path']}") if r.get('color_path') else None
    log(f"decoded: heights {h.shape} {h.min():.2f}..{h.max():.2f} m; mask classes {dict(zip(*[x.tolist() for x in np.unique(mask, return_counts=True)]))}; "
        f"water layer {wcls.shape} classes {dict(zip(*[x.tolist() for x in np.unique(wcls, return_counts=True)]))}; colour {col.size if col else None} {col.mode if col else ''}")
    bx = dict(north=r['north'], south=r['south'], west=r['west'], east=r['east'])
    LA, LO = centres(bx, n)
    la, lo = math.floor(float(LA.min())), math.ceil(float(-LO.max()))
    url = f"{TNM}/13/TIFF/current/n{la + 1:02d}w{lo:03d}/USGS_13_n{la + 1:02d}w{lo:03d}.tif"
    win = window(url, f"{a.work}/tnm", 0.0, LO.min() - .002, LO.max() + .002, LA.min() - .002, LA.max() + .002, 'check')
    idx = np.linspace(100, n - 101, 5).astype(int); rows = []
    for i in idx:
        for j in idx:
            rr, cc = i, j
            if mask[rr, cc] == 3: continue
            v = np.full(1, np.nan); sample(win, np.array([LO[rr, cc]]), np.array([LA[rr, cc]]), v)
            rows.append((rr, cc, float(h[rr, cc]), float(v[0])))
    d = np.array([x[2] - x[3] for x in rows])
    log(f"heights vs the 1/3 arc-second DEM (bilinear, {len(rows)} ground points): middle {np.median(d):+.2f} m, largest {np.max(np.abs(d)):.2f} m")
    for rr, cc, a1, b1 in rows[:6]: log(f"  ({LA[rr, cc]:.5f}, {LO[rr, cc]:.5f}): file {a1:.2f}, DEM {b1:.2f}")
    if a.near_file:
        nb_ = [float(x) for x in a.near_box.split(',')]
        hn = read_png(a.near_file, a.near_base, a.near_step)
        from build_trip_terrain import at
        v = at(hn, nb_, LA[::50, ::50], LO[::50, ::50]); dd = h[::50, ::50] - v
        log(f"heights vs the fine box file (terrarium z14): middle {np.nanmedian(dd):+.2f} m, 9 in 10 within {np.nanpercentile(np.abs(dd), 90):.2f} m")
    s = rep['stand']; sr, sc = int((r['north'] - s['lat']) / (r['north'] - r['south']) * n), int((s['lng'] - r['west']) / (r['east'] - r['west']) * n)
    k = 30; top = h[sr - k:sr + k + 1, sc - k:sc + k + 1]
    log(f"stand spot {s['lat']}, {s['lng']}: {h[sr, sc]:.2f} m; highest ground within 30 m {top.max():.2f} m; nearest water {s['nearest_water_m']} m")
    w = mask == 3; gy, gx = np.gradient(h, r['cell_m']); sl = np.hypot(gx, gy)
    lab, kk = ndimage.label(w, structure=np.ones((3, 3)))
    log(f"box water {w.sum():,} m2 in {kk} patches (largest {int(np.bincount(lab.ravel())[1:].max()) if kk else 0:,} m2); slope on water cells: median {np.median(sl[w]):.4f}, 99th pct {np.percentile(sl[w], 99):.3f}; "
        f"water level {h[w].min():.2f}..{h[w].max():.2f} m")
    aw = WIDE_CELL * WIDE_CELL
    log(f"6 km water: {(wcls > 0).sum() * aw / 1e4:.1f} ha, moving {(wcls == 1).sum() * aw / 1e4:.1f} ha ({(wcls == 1).sum() / max(1, (wcls > 0).sum()):.0%}), still {(wcls == 2).sum() * aw / 1e4:.1f} ha")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('cmd', choices=['build', 'sql', 'check']); ap.add_argument('work')
    ap.add_argument('--near-file'); ap.add_argument('--near-box', help='north,south,west,east'); ap.add_argument('--near-base', type=float, default=0.0); ap.add_argument('--near-step', type=float, default=0.5)
    ap.add_argument('--id'); ap.add_argument('--lat', type=float); ap.add_argument('--lng', type=float); ap.add_argument('--parent', default='grand_teton')
    ap.add_argument('--projects', default='WY_GrandTetonNP_D22,WY_GrandTetonElkRefuge_2014', help='USGS 1 m DEM projects to try first (comma separated)')
    ap.add_argument('--side', type=int, default=1504); ap.add_argument('--cell', type=float, default=1.0)
    ap.add_argument('--min-wide-m2', type=float, default=400.0); ap.add_argument('--min-box-m2', type=float, default=150.0)
    ap.add_argument('--no-colour', action='store_true')
    ap.add_argument('--migration'); ap.add_argument('--title', default='a stand spot'); ap.add_argument('--date', default=time.strftime('%d %b %Y'))
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    {'build': build, 'sql': sql, 'check': check}[a.cmd](a)


if __name__ == '__main__': main()
