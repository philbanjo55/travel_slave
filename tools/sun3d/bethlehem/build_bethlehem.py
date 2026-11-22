#!/usr/bin/env python3
"""3D sun view for a one-stop day shoot: Bethlehem Steel Stacks (Bethlehem PA, 25 Nov 2026), the whole NEW_TRIP_SOP 4b stack.

  build_bethlehem.py despike <png>                    terrarium glitches out of a wide / fine file (in place)
  (more steps below, one subcommand each; see README.md in this folder)

Sources: wide + fine (near) files = terrarium tiles (tools/sun3d/build_trip_terrain.py --wide-km 29.5 --pad 3000),
range = USGS 3DEP 1 m DEM (project PA_Northcentral_2019_B19, UTM 18N), detail / houses / trees = USGS 3DEP lidar
PA_Northcentral_B5_2019 (Entwine EPT on AWS; in this survey everything above the ground is class 1, so buildings,
the furnaces and trees are told apart by the returns, the shape and the NAIP summer photo's near infrared),
colour = USDA NAIP (PA, imagery.nationalmap.gov). Teton / Faroes rows and files are never touched: ids and files 'bth*'.
"""
import argparse, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); SUN3D = os.path.dirname(HERE)
sys.dont_write_bytecode = True
sys.path.insert(0, SUN3D); sys.path.insert(0, os.path.join(SUN3D, 'lidar')); sys.path.insert(0, os.path.join(SUN3D, 'teton_colour'))
from build_trip_terrain import read_png, at   # noqa: E402

# the shoot
STOP = (40.614136, -75.370045); STAND = (40.614787, -75.367304); SUBJECT = (40.615177, -75.367175)
REGION = dict(id='bethlehem', north=40.89, south=40.34, west=-75.72, east=-75.01, n=2048, base=0.0, step=0.5, path='bethlehem_z12.png')
NEAR = dict(id='bth_bethlehem_steel_stacks', north=40.642, south=40.5875, west=-75.403, east=-75.3315, n=896, base=0.0, step=0.5, path='bth_bethlehem_steel_stacks_z14.png')
KZ = 111132.0
def KX(lat): return 111320 * math.cos(math.radians(lat))


def despike(a):
    """Single-cell / single-column glitches in terrarium files (Bethlehem wide: a 720 m spike at 40.48 N -75.551, a 0 m
    cell at 40.697 N -75.488): a cell (or a one-cell-wide line of them) standing more than 50 m above or below all six
    neighbours across the line is set to the median of its 5 x 5 neighbours. Quarries, the river cut and ridges are
    wide and keep their heights."""
    from build_detail import write_heights   # noqa
    h = read_png(a.png, 0.0, 0.5); n = h.shape[0]
    p = np.pad(h, 2, mode='edge'); sh = lambda i, j: p[2 + i:2 + i + n, 2 + j:2 + j + n]
    bad = np.zeros_like(h, bool)
    for side in ([(i, j) for i in (-1, 0, 1) for j in (-1, 1)], [(i, j) for i in (-1, 1) for j in (-1, 0, 1)]):
        nb = np.stack([sh(i, j) for i, j in side]); bad |= (h - nb.max(0) > 50) | (nb.min(0) - h > 50)
    stack = np.stack([p[i:i + n, j:j + n] for i in range(5) for j in range(5)]); med = np.median(stack, axis=0)
    # the tile-source seam SW of Allentown (a dashed wall along a stair-step line, 40.53-40.57 N, -75.68..-75.59): cells
    # more than 10 m off the 5 x 5 median where the median ground is gentle (natural ground that steep is a quarry or a ridge)
    gy, gx = np.gradient(med, a.cell); gentle = np.hypot(gx, gy) < 0.12
    seam = gentle & (np.abs(h - med) > 10.0)
    seam = seam | (np.pad(seam, 1)[2:, 1:-1] | np.pad(seam, 1)[:-2, 1:-1] | np.pad(seam, 1)[1:-1, 2:] | np.pad(seam, 1)[1:-1, :-2]) & gentle & (np.abs(h - med) > 4.0)
    # the seam is a wall a cell or two wide: its cells and their neighbours across it are filled from the good ground beside
    for _ in range(2): seam = seam | (np.pad(seam, 1)[2:, 1:-1] | np.pad(seam, 1)[:-2, 1:-1] | np.pad(seam, 1)[1:-1, 2:] | np.pad(seam, 1)[1:-1, :-2]) & gentle
    from build_detail import fill   # noqa
    print(f"{os.path.basename(a.png)}: {int(bad.sum())} spike cells (heights {h[bad].round().tolist()[:8]}) -> median, {int(seam.sum())} seam cells -> filled from beside")
    h = np.where(bad, med, h); h = np.where(seam, fill(h, ~seam), h)
    if a.cop_work:   # a wall 2-4 cells wide is left where the two tile sources meet: there, Copernicus GLO-30 moved to the file's level
        from build_trip_terrain import cop_grid   # noqa
        north, south, west, east = a.box; la = north - (np.arange(n) + .5) * (north - south) / n; lo = west + (np.arange(n) + .5) * (east - west) / n
        C = cop_grid(a.cop_work, la, lo).astype(np.float64)
        band = seam | bad
        for _ in range(4): band = band | np.pad(band, 1)[2:, 1:-1] | np.pad(band, 1)[:-2, 1:-1] | np.pad(band, 1)[1:-1, 2:] | np.pad(band, 1)[1:-1, :-2]
        big = np.zeros_like(band); big[np.ix_(la < a.seam_box[0], (lo < a.seam_box[1]))] = True; band &= big
        ring = band.copy()
        for _ in range(6): ring = ring | np.pad(ring, 1)[2:, 1:-1] | np.pad(ring, 1)[:-2, 1:-1] | np.pad(ring, 1)[1:-1, 2:] | np.pad(ring, 1)[1:-1, :-2]
        ring &= ~band
        off = fill(np.where(ring, h - C, 0.0), ring)    # the file's level against Copernicus, spread from the ring into the band
        h = np.where(band, C + off, h); print(f"  Copernicus over the seam: {int(band.sum())} cells, offset middle {np.median((h - C)[ring]):+.1f} m")
    write_heights(a.png, h, 0.0, 0.5)


PROJECT = 'PA_Northcentral_B5_2019'     # USGS 3DEP lidar over Bethlehem (QL2, ~2.6 points a m2; classes 1 unsorted, 2 ground, 9 water)
SIDE = 3008.0                            # the close-up box, metres a side: centred between the parking and the stand pin
MID = ((STOP[0] + STAND[0]) / 2, (STOP[1] + STAND[1]) / 2)
def detail_box():
    hy = SIDE / 2 / KZ; hx = SIDE / 2 / KX(MID[0])
    return tuple(round(v, 6) for v in (MID[0] + hy, MID[0] - hy, MID[1] - hx, MID[1] + hx))


def grid(a):
    """The survey's points on the close-up box at 1 m (n 3008): per cell the highest return and its class, the ground
    returns' sum and count, the lowest water return, the return count and how many came from pulses with several
    returns. Saved as <work>/grid1.npz; the 2 m files are made from it by 2 x 2 cells."""
    import build_detail as bd
    box = detail_box(); n = int(round(SIDE)); sv = bd.Survey(PROJECT, f"{a.work}/cache")
    print(f"close-up box {box}, {n} x {n} at 1 m", flush=True)
    g = bd.grid_box(sv, box, n, lambda s: print('  ' + s, flush=True), keep=False, maxd=99)
    np.savez_compressed(f"{a.work}/grid1.npz", box=np.array(box), top=g['top'], cls=g['cls'], gsum=g['gsum'].astype(np.float32), gcnt=g['gcnt'],
                        wmin=g['wmin'], cnt=g['cnt'], multi=g['multi'], total=g['total'])


RANGE_PROJECTS = ['PA_Northcentral_2019_B19', 'PA_17County_D24', 'PA_AllentownOrthoLidar_D24']   # 3DEP 1 m DEM, first one with a tile wins
RANGE_ID = 'bthr_south_mountain'
# the range box: 10.24 km at 5 m, its middle 2.5 km south and 2.5 km west of the stand pin, so it holds the site (2.6 km
# from its edges: services/terrain.ts pickRange wants the subject 1 km inside) and South Mountain toward the late-autumn
# sunset (azimuth ~236 deg at 4:30 PM on 25 Nov), out to ~7.6 km both ways
RANGE_MID = (STAND[0] - 2500 / KZ, STAND[1] - 2500 / KX(STAND[0]))
# published heights to check it on (NAVD88): the Lehigh River's pool at the Bethlehem dam and South Mountain's top above
# Bethlehem (the radio towers on the ridge, Lehigh University's Mountaintop campus ~ 40.6045, -75.3785, ~ 230 m)
def tnm_keys(project, cache):
    p = f"{cache}/keys_{project}.txt"
    if os.path.exists(p): return open(p).read().split()
    import subprocess, re
    keys, token = [], None
    while True:
        u = f"https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts/Elevation/1m/Projects/{project}/TIFF/&max-keys=1000" + (f"&continuation-token={__import__('urllib.parse').parse.quote(token)}" if token else '')
        x = subprocess.run(["curl", "-sS", "-f", "-m", "120", u], capture_output=True, text=True, check=True).stdout
        keys += re.findall(r"<Key>([^<]+\.tif)</Key>", x); m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", x)
        if not m: break
        token = m.group(1)
    open(p, 'w').write("\n".join(keys)); return keys


def range_box(a):
    import build_range as br
    from pyproj import Transformer
    os.makedirs(f"{a.work}/files", exist_ok=True); cache = f"{a.work}/tnm"; os.makedirs(cache, exist_ok=True)
    keys = {p: tnm_keys(p, cache) for p in RANGE_PROJECTS}
    def tiles_for(E0, E1, N0, N1, _keys):   # UTM 18N tiles x<E / 10 km>y<N / 10 km, north edge
        out = []
        for proj in RANGE_PROJECTS:
            for x in range(int(E0 // 10000), int(E1 // 10000) + 1):
                for y in range(int(N0 // 10000) + 1, int(N1 // 10000) + 2):
                    k = next((k for k in keys[proj] if k.endswith(f"USGS_1M_18_x{x}y{y}_{proj}.tif")), None)
                    if k: out.append((proj, f"https://prd-tnm.s3.amazonaws.com/{k}"))
        return out
    br.tiles_for = tiles_for; br.PROJECTS = RANGE_PROJECTS; br.to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:26918', always_xy=True)
    hz = br.N * br.CELL / 2 / KZ; hx = br.N * br.CELL / 2 / KX(RANGE_MID[0])
    box = tuple(round(v, 6) for v in (RANGE_MID[0] + hz, RANGE_MID[0] - hz, RANGE_MID[1] - hx, RANGE_MID[1] + hx))
    print(f"range box {RANGE_ID}: {box}, {br.N} x {br.N} at {br.CELL} m", flush=True)
    h, src, LA, LO = br.heights(a.work, box, br.N, None)
    miss = np.isnan(h)
    if miss.any():   # no 1 m tile there: the near / wide terrarium files
        for f, R in ((f"{a.work}/files/{NEAR['path']}", NEAR), (f"{a.work}/files/{REGION['path']}", REGION)):
            v = at(read_png(f, R['base'], R['step']), (R['north'], R['south'], R['west'], R['east']), LA, LO); fill_ = np.isnan(h) & ~np.isnan(v); h[fill_] = v[fill_]; src[fill_] = 4
    print(f"  from the 1 m DEM {np.mean(src == 1) + np.mean(src == 2):.1%} (project {RANGE_PROJECTS[0]} {np.mean(src == 1):.1%}), terrarium {np.mean(src == 4):.2%}; heights {np.nanmin(h):.1f}..{np.nanmax(h):.1f} m")
    base = math.floor(float(h.min())) - 2
    out = f"{a.work}/files/{RANGE_ID}.png"; br.write_heights(out, h, base, br.STEP)
    assert np.abs(read_png(out, base, br.STEP) - h).max() <= br.STEP / 2 + 1e-6
    np.save(f"{a.work}/range_h.npy", h.astype(np.float32))
    # data check: the stop's stored height, the near / wide files, the highest point
    w = read_png(f"{a.work}/files/{REGION['path']}", 0, 0.5); nr = read_png(f"{a.work}/files/{NEAR['path']}", 0, 0.5)
    k = 200; sl = (slice(None, None, br.N // k), slice(None, None, br.N // k))
    dw = h[sl] - at(w, (REGION['north'], REGION['south'], REGION['west'], REGION['east']), LA[sl], LO[sl])
    dn = h[sl] - at(nr, (NEAR['north'], NEAR['south'], NEAR['west'], NEAR['east']), LA[sl], LO[sl])
    print(f"  DATA CHECK: range minus wide file middle {np.nanmedian(dw):+.1f} m (9 in 10 within {np.nanpercentile(np.abs(dw), 90):.1f} m); minus near file {np.nanmedian(dn):+.1f} m (9 in 10 within {np.nanpercentile(np.abs(dn), 90):.1f} m)")
    print(f"  stop (stored 70 m): {float(at(h, box, [STOP[0]], [STOP[1]])[0]):.1f} m; stand pin {float(at(h, box, [STAND[0]], [STAND[1]])[0]):.1f} m")
    iy, ix = np.unravel_index(np.nanargmax(h), h.shape); print(f"  highest point {np.nanmax(h):.1f} m at {LA[iy, ix]:.5f}, {LO[iy, ix]:.5f}")
    json.dump(dict(id=RANGE_ID, parent=REGION['id'], north=box[0], south=box[1], west=box[2], east=box[3], n=br.N, base_m=base, step_m=br.STEP, cell_m=br.CELL,
                   path=os.path.basename(out), bytes=os.path.getsize(out)), open(f"{a.work}/range.json", 'w'), indent=1)
    from PIL import Image
    gy, gx = np.gradient(h, br.CELL); Image.fromarray(np.clip(128 + 300 * (-gx - gy) / np.sqrt(1 + gx * gx + gy * gy), 0, 255).astype(np.uint8)).resize((1024, 1024)).save(f"{a.work}/look_range.png")


NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
def naip(a, k=4, px=3008):
    """NAIP over the close-up box at 1 m (cached as <work>/naip1.npy)."""
    p = f"{a.work}/naip1.npy"
    if os.path.exists(p): return np.load(p)
    out = naip_box(a.work, 'det', detail_box(), px, k); np.save(p, out); return out


def naip_box(work, tag, box, px, k):
    """USDA NAIP (PA, 29 Apr 2022: bare trees, first leaves) RGB + near infrared over a lat / lng box, px x px, north up,
    0-1. Asked for in k x k pieces (one 3008 px request did not come back in 10 min); the server keeps its pixels square
    in degrees, so each piece is asked in its own lat / lng proportion and squeezed after."""
    import requests, tifffile, time
    from PIL import Image
    out = np.zeros((px, px, 4), np.uint8); s = px // k; d = f"{work}/cache/naip_{tag}"; os.makedirs(d, exist_ok=True)
    for i in range(k):
        for j in range(k):
            f = f"{d}/{i}_{j}.tif"
            n0 = box[0] - i * s * (box[0] - box[1]) / px; n1 = box[0] - (i + 1) * s * (box[0] - box[1]) / px
            w0 = box[2] + j * s * (box[3] - box[2]) / px; w1 = box[2] + (j + 1) * s * (box[3] - box[2]) / px
            if not os.path.exists(f):
                q = dict(bbox=f"{w0},{n1},{w1},{n0}", bboxSR=4326, imageSR=4326, size=f"{round(s * (w1 - w0) / (n0 - n1))},{s}",
                         format='tiff', pixelType='U8', bandIds='0,1,2,3', interpolation='RSP_BilinearInterpolation', f='image')
                for t in range(6):
                    try:
                        r = requests.get(NAIP, params=q, timeout=240)
                        if r.status_code == 200 and r.content[:2] in (b'II', b'MM'): open(f, 'wb').write(r.content); break
                    except Exception as e: print('  naip retry', e)
                    time.sleep(5 + 10 * t)
            im = tifffile.imread(f); assert im.shape[0] == s, im.shape
            out[i * s:(i + 1) * s, j * s:(j + 1) * s] = np.stack([np.asarray(Image.fromarray(im[..., b]).resize((s, s), Image.BILINEAR)) for b in range(4)], -1)
        print(f"  naip {tag}: row {i + 1} of {k}", flush=True)
    return out.astype(np.float32) / 255


def ndvi_of(nb): return (nb[..., 3] - nb[..., 0]) / np.maximum(nb[..., 3] + nb[..., 0], 1e-3)


def ground1(a):
    """Bare ground (as build_detail.clean makes it), height over it, the share of returns from pulses with several, at 1 m."""
    import build_detail as bd
    p = f"{a.work}/base1.npz"
    if os.path.exists(p): d = np.load(p); return d['base'], d['hag'], d['share']
    g = np.load(f"{a.work}/grid1.npz"); gnd = g['gcnt'] > 0
    base = bd.fill(g['gsum'] / np.maximum(g['gcnt'], 1), gnd)
    for _ in range(6): base = np.where(gnd, base, bd.box3(base))
    base = bd.box3(bd.box3(base)); has = g['cnt'] > 0
    hag = np.where(has, g['top'] - base, 0).astype(np.float32); share = (g['multi'] / np.maximum(g['cnt'], 1)).astype(np.float32)
    np.savez(p, base=base.astype(np.float32), hag=hag, share=share); return base, hag, share


# Structures: everything the survey saw standing that is not a tree. The survey sorted nothing above the ground (all class 1,
# bridges 17), so: a raised cell is solid when the laser pulses came back once (roofs, the furnace shells, the trestle's
# deck: 0-15 % of returns from several-return pulses; tree crowns 50-90 %) or, where it is lattice / pipework (several
# returns too), when the NAIP photo (29 Apr 2022, first leaves) reads no plant there: NDVI under 0 (measured here: solid
# roofs and the furnaces -0.26..-0.01, tree crowns 0.06..0.32). Bridges over the Lehigh are left out (drawn
# from the ground they would dam the river). Heights in levels: a building of one height is a block with its own roof
# (gable or flat, tools/sun3d/lidar/build_buildings.py parts); a structure of many heights (the furnaces, the casino) is
# a stack of blocks, one per height step (LEVELS), each the outline of the cells that reach that step.
LEVELS = [2.0, 4.0, 6.5, 9.5, 13.0, 17.0, 22.0, 28.0, 35.0, 43.0, 52.0, 62.0, 74.0, 90.0]
TILES = 3   # the house tiles: 3 x 3 over the close-up box (~1 km each)


def ring_poly(m, cell=1.0, maxc=80):
    """A cell mask -> right-angled outline (list of (x, y) in cells), or None. Up to maxc corners (the page triangulates any)."""
    import build_buildings as bb
    from scipy import ndimage
    m = ndimage.binary_fill_holes(m)
    lab, k = ndimage.label(m, structure=np.ones((3, 3), bool))
    if k > 1: m = lab == 1 + int(np.argmax(ndimage.sum(m, lab, range(1, k + 1))))
    rows = np.where(m.any(1))[0]; cols = np.where(m.any(0))[0]
    r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1; area = float(m.sum())
    if area / ((r1 - r0) * (c1 - c0)) >= 0.85: return [(c0, r0), (c1, r0), (c1, r1), (c0, r1)], area
    pts = bb.trace(m[r0:r1, c0:c1]); pts = [(c0 + x, r0 + y) for x, y in pts]
    pts = bb.simplify_ortho(pts, 1.6 / cell)
    if 4 <= len(pts) <= maxc and bb.outline_ok(pts, area): return pts, area
    return None, area


def rect_pieces(m, piece=12):
    """A footprint the outline cannot follow, as blocks of at most piece x piece cells (each its own rectangle)."""
    out = []
    H, W = m.shape
    for r in range(0, H, piece):
        for c in range(0, W, piece):
            s = m[r:r + piece, c:c + piece]
            if s.sum() < 3: continue
            rr = np.where(s.any(1))[0]; cc = np.where(s.any(0))[0]
            out.append(([(c + cc[0], r + rr[0]), (c + cc[-1] + 1, r + rr[0]), (c + cc[-1] + 1, r + rr[-1] + 1), (c + cc[0], r + rr[-1] + 1)], float(s.sum())))
    return out


def houses(a):
    import build_detail as bd, build_buildings as bb
    from scipy import ndimage
    g = np.load(f"{a.work}/grid1.npz"); box = tuple(g['box']); n = g['top'].shape[0]; cls = g['cls']; has = g['cnt'] > 0
    base, hag, share = ground1(a); nb = naip(a); ndvi = ndvi_of(nb)
    sh3 = bd.box3(bd.box3(share)); nd3 = bd.box3(ndvi)
    cand = has & (hag >= 2.0) & ~np.isin(cls, [2, 9, 17]) & ~(g['wmin'] < 1e8)
    solid = cand & ((sh3 < 0.35) | ((sh3 < 0.85) & (nd3 < 0.0)))
    for _ in range(3): solid |= bd.grow1(solid) & cand & ((sh3 < 0.9) & (nd3 < 0.03))   # lattice and pipework joined to a solid part
    solid = ndimage.binary_closing(solid, structure=np.ones((3, 3), bool)) & (cand | bd.grow1(solid))
    hs = ndimage.median_filter(np.where(solid, hag, 0), size=3); hs = np.where(solid, np.maximum(hs, np.minimum(hag, 2.0)), 0)
    lab, k = ndimage.label(solid, structure=np.ones((3, 3), bool)); objs = ndimage.find_objects(lab)
    print(f"{k:,} raised solid patches", flush=True)
    kx = KX((box[0] + box[1]) / 2); dlat = (box[0] - box[1]) / n; dlng = (box[3] - box[2]) / n
    T = TILES; tiles = {}; nb_ = dict(kept=0, cars=0, small=0, levels=0, blocks=0, simple=0, pieces=0)
    tbox = lambda tr, tc: (round(box[0] - tr * (box[0] - box[1]) / T, 6), round(box[0] - (tr + 1) * (box[0] - box[1]) / T, 6), round(box[2] + tc * (box[3] - box[2]) / T, 6), round(box[2] + (tc + 1) * (box[3] - box[2]) / T, 6))
    allb = []; struct = np.zeros((n, n), bool)
    for idx, sl in enumerate(objs, start=1):
        if sl is None: continue
        r0, c0 = sl[0].start, sl[1].start; m = lab[sl] == idx; h = hs[sl]; area = float(m.sum())
        if area < 3: continue
        hv = h[m]; p90 = float(np.percentile(hv, 90)); p10 = float(np.percentile(hv, 10)); top = float(hv.max())
        # the smallest box round it, to tell a lorry or a trailer (long, narrow, low) from a shed
        ys, xs = np.nonzero(m); ang = bb.best_angle(xs.astype(float), ys.astype(float)); t = math.radians(ang)
        u = xs * math.cos(t) + ys * math.sin(t); v = -xs * math.sin(t) + ys * math.cos(t); L, Wd = sorted([np.ptp(u) + 1, np.ptp(v) + 1], reverse=True)
        if (area < 25 and p90 < 2.6) or (area < 70 and p90 < 4.3 and Wd < 3.4): nb_['cars'] += 1; continue
        if area < 9 and p90 < 6: nb_['small'] += 1; continue
        nb_['kept'] += 1; struct[sl] |= m
        cc = (c0 + xs.mean() + 0.5, r0 + ys.mean() + 0.5); clat = box[0] - cc[1] * dlat; clng = box[2] + cc[0] * dlng
        tr, tc = min(T - 1, int((box[0] - clat) / (box[0] - box[1]) * T)), min(T - 1, int((clng - box[2]) / (box[3] - box[2]) * T))
        tn, ts, tw, te = tbox(tr, tc); kxt = KX((tn + ts) / 2)
        to_tile = lambda px, py: ((box[2] + (c0 + px) * dlng - tw) * kxt, (tn - (box[0] - (r0 + py) * dlat)) * KZ)
        rgb = nb[sl][..., :3][m]; rc = [int(v_) for v_ in np.clip(np.median(rgb, 0) * 255, 0, 255)]
        g0 = float(base[sl][m].mean())
        def put(pts, e, r, roof='flat', a_=0.0, hw=0.0, part=0, c=None):
            P = [to_tile(x, y) for x, y in pts]
            rec = dict(p=[round(q, 1) for xy in P for q in xy], g=round(g0, 1), e=round(max(1.8, e), 1), r=round(max(e, r), 1), a=round(a_ % 180, 1), hw=round(hw, 1), roof=roof,
                       c=[round(sum(p[0] for p in P) / len(P), 1), round(sum(p[1] for p in P) / len(P), 1)] if c is None else c, n6=0, id=idx * 4 + min(part, 3), part=part, rc=rc)
            tiles.setdefault((tr, tc), []).append(rec); allb.append(dict(rec, obj=idx, lat=round(clat, 6), lng=round(clng, 6), area=area, top=round(top, 1)))
        simple = (p90 - p10 <= 4.0 and top < 20 and area <= 6000)
        if simple:   # one height: a block with its fitted roof (gable / flat), as the park-wide buildings
            uu = (xs + 0.5) * math.cos(t) + (ys + 0.5) * math.sin(t); vv = -(xs + 0.5) * math.sin(t) + (ys + 0.5) * math.cos(t)
            ps = bb.parts(uu, vv, hv.astype(np.float64), 1.0, 0.0)
            if ps:
                nb_['simple'] += 1
                for kk, (pts, ar, roof) in enumerate(ps):
                    pu = np.array([p[0] for p in pts]); pv = np.array([p[1] for p in pts])
                    X = pu * math.cos(t) - pv * math.sin(t); Y = pu * math.sin(t) + pv * math.cos(t)
                    cxy = None
                    if roof['roof'] == 'gable':
                        if roof['axis'] == 0: ru, rv = (pu.min() + pu.max()) / 2, roof['c']
                        else: ru, rv = roof['c'], (pv.min() + pv.max()) / 2
                        cxy = [round(v_, 1) for v_ in to_tile(ru * math.cos(t) - rv * math.sin(t), ru * math.sin(t) + rv * math.cos(t))]
                    put(list(zip(X, Y)), roof['e'], roof['r'], roof['roof'], ang + (0 if roof['axis'] == 0 else 90), roof.get('hw', 0.0), kk, cxy)
                continue
        # many heights: one block per height step
        nb_['levels'] += 1; part = 0
        for li, t0 in enumerate(LEVELS):
            t1 = LEVELS[li + 1] if li + 1 < len(LEVELS) else 999.0
            sub = m & (h >= t0) if li else m
            if sub.sum() < 3: break
            sl2, k2 = ndimage.label(sub, structure=np.ones((3, 3), bool))
            for j in range(1, k2 + 1):
                s2 = sl2 == j
                if s2.sum() < 3: continue
                ztop = float(np.percentile(np.clip(h[s2], t0, t1), 75)) if li else float(np.percentile(np.clip(h[s2], 0, t1), 75))
                pts, ar = ring_poly(s2)
                pieces = [(pts, ar)] if pts else rect_pieces(s2)
                if not pts: nb_['pieces'] += 1
                for pp, _ in pieces: put(pp, ztop, ztop, part=part); nb_['blocks'] += 1
                part += 1
    F = f"{a.work}/files"; os.makedirs(F, exist_ok=True); rows = []
    for (tr, tc), Lb in sorted(tiles.items()):
        tn, ts, tw, te = tbox(tr, tc)
        out = dict(v=1, box=[tn, ts, tw, te], b=[{k_: r[k_] for k_ in ('p', 'g', 'e', 'r', 'a', 'hw', 'roof', 'c', 'n6', 'id', 'part', 'rc')} for r in Lb])
        path = f"{F}/bthb_{tr}_{tc}.json"; open(path, 'w').write(json.dumps(out, separators=(',', ':')))
        rows.append(dict(id=f"bthb_{tr}_{tc}", parent=REGION['id'], north=tn, south=ts, west=tw, east=te, path=os.path.basename(path), bytes=os.path.getsize(path), count=len(Lb)))
    json.dump(rows, open(f"{a.work}/house_tiles.json", 'w'), indent=1); json.dump(allb, open(f"{a.work}/buildings.json", 'w'))
    np.save(f"{a.work}/struct1.npy", struct)
    print(f"structures kept {nb_['kept']:,} (one-height blocks {nb_['simple']:,}, stacked {nb_['levels']:,}: {nb_['blocks']:,} blocks, {nb_['pieces']:,} footprints cut in pieces); "
          f"left out as vehicles {nb_['cars']:,}, too small {nb_['small']:,}; records {len(allb):,} in {len(rows)} tiles, {sum(r['bytes'] for r in rows) / 1e3:.0f} KB", flush=True)


# Late-autumn colour of the wide grid and the leaf-off call per tree: Copernicus Sentinel-2 L2A, 16 Nov 2023 16:02 UTC
# (11:02 AM EST, sun 30 deg up, az 168; tiles 18TVK cloud 0.0 %, 18TVL 3.7 %), the clearest pass between 10 Nov and
# 25 Dec in 2023-2025 (the 2025 passes were 34-100 % cloud); 30 Nov 2024 (18TVK 0.4 %) fills what 16 Nov saw as cloud.
S2R = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/'
S2_SCENES = [   # (folder, UTM top edge, sun az, sun el)
    (S2R + 'VL/2023/11/S2B_18TVL_20231116_0_L2A/', 4600020.0, 167.8, 29.3),
    (S2R + 'VK/2023/11/S2B_18TVK_20231116_0_L2A/', 4500000.0, 167.7, 30.1),
    (S2R + 'VK/2024/11/S2B_18TVK_20241130_0_L2A/', 4500000.0, 167.3, 27.0),
]
S2_X0 = 399960.0


class Autumn:
    """The Sentinel-2 pictures over a lat / lng box: colour (TCI), NDVI (B04 / B08, 10 m), which scene, at any points."""
    def __init__(s, work, box, level=0):
        import build_teton_colour as tc
        from pyproj import Transformer
        s.tc = tc; s.to = Transformer.from_crs('EPSG:4326', 'EPSG:32618', always_xy=True); s.level = level; px = 10.0 * (2 ** level)
        la = np.linspace(box[1], box[0], 40); lo = np.linspace(box[2], box[3], 40); LO, LA = np.meshgrid(lo, la); E, N = s.to.transform(LO, LA)
        s.sc = []
        for url, top, az, el in S2_SCENES:
            c0, c1 = int((E.min() - 200 - S2_X0) // px), int((E.max() + 200 - S2_X0) // px) + 1
            r0, r1 = int((top - N.max() - 200) // px), int((top - N.min() + 200) // px) + 1
            if r1 <= 0 or r0 >= 10980 // (2 ** level): continue
            r0, c0 = max(0, r0), max(0, c0)   # cog_window starts at row / column 0 at the most
            cache = f"{work}/cache/s2"
            tci = tc.cog_window(cache, url + 'TCI.tif', level, r0, r1, c0, c1)
            red = tc.cog_window(cache, url + 'B04.tif', level, r0, r1, c0, c1)[..., 0].astype(np.float32)
            nir = tc.cog_window(cache, url + 'B08.tif', level, r0, r1, c0, c1)[..., 0].astype(np.float32)
            scl = tc.cog_window(cache, url + 'SCL.tif', max(0, level - 1), r0 * (2 ** level) // 2 // (2 ** max(0, level - 1)), r1 * (2 ** level) // 2 // (2 ** max(0, level - 1)) + 1,
                                c0 * (2 ** level) // 2 // (2 ** max(0, level - 1)), c1 * (2 ** level) // 2 // (2 ** max(0, level - 1)) + 1)[..., 0]
            s.sc.append(dict(url=url, top=top, az=az, el=el, px=px, r0=r0, c0=c0, tci=tci, ndvi=(nir - red) / np.maximum(nir + red, 1.0), scl=scl,
                             spx=20.0 * (2 ** max(0, level - 1)), sr0=r0 * (2 ** level) // 2 // (2 ** max(0, level - 1)), sc0=c0 * (2 ** level) // 2 // (2 ** max(0, level - 1))))
            print(f"  sentinel-2 {url.split('/')[-2]}: {tci.shape[1]} x {tci.shape[0]} px at {px:g} m", flush=True)

    def sample(s, lng, lat):
        from scipy import ndimage
        E, N = s.to.transform(lng, lat); shape = np.shape(lng)
        col = np.zeros(shape + (3,), np.float32); nd = np.zeros(shape, np.float32); used = np.full(shape, -1, np.int8)
        for k, sc in enumerate(s.sc):
            r = (sc['top'] - N) / sc['px'] - 0.5 - sc['r0']; c = (E - S2_X0) / sc['px'] - 0.5 - sc['c0']
            H, W = sc['tci'].shape[:2]; inside = (r >= 0) & (c >= 0) & (r <= H - 1) & (c <= W - 1)
            raw = ndimage.map_coordinates(sc['tci'][..., 1], [np.round(r), np.round(c)], order=0, mode='nearest')
            cl = ndimage.map_coordinates(sc['scl'], [np.round((sc['top'] - N) / sc['spx'] - 0.5 - sc['sr0']), np.round((E - S2_X0) / sc['spx'] - 0.5 - sc['sc0'])], order=0, mode='nearest')
            ok = inside & (raw > 0) & ~np.isin(cl, [0, 1, 3, 8, 9, 10]) & (used < 0)
            for i in range(3): col[..., i] = np.where(ok, ndimage.map_coordinates(sc['tci'][..., i].astype(np.float32), [r, c], order=1, mode='nearest') / 255, col[..., i])
            nd = np.where(ok, ndimage.map_coordinates(sc['ndvi'], [r, c], order=1, mode='nearest'), nd); used[ok] = k
        return col, nd, used


def save_jpeg(path, rgb01, q=86):
    from PIL import Image
    Image.fromarray(np.clip(rgb01 * 255 + 0.5, 0, 255).astype(np.uint8)).save(path, quality=q, optimize=True); return os.path.getsize(path)


def colour(a):
    """Colour files: the wide grid from Sentinel-2 (16 Nov 2023, the light of 11 AM divided out with our own heights), the
    near box and the close-up box from NAIP (29 Apr 2022: bare trees, first leaves, the nearest to late November there is
    at 1 m; buildings' noon shadows are in the photo)."""
    import build_teton_colour as tc
    F = f"{a.work}/files"; os.makedirs(F, exist_ok=True); R = REGION; box = (R['north'], R['south'], R['west'], R['east']); n = 2048
    au = Autumn(a.work, box, level=1)
    la = R['north'] - (np.arange(n) + .5) * (R['north'] - R['south']) / n; lo = R['west'] + (np.arange(n) + .5) * (R['east'] - R['west']) / n
    LO, LA = np.meshgrid(lo, la); col, nd, used = au.sample(LO, LA)
    h = read_png(f"{F}/{R['path']}", R['base'], R['step']); kx = KX((R['north'] + R['south']) / 2) * (R['east'] - R['west']) / n; kz = KZ * (R['north'] - R['south']) / n
    E = np.ones((n, n))
    for k, sc in enumerate(au.sc):
        if (used == k).any(): E = np.where(used == k, tc.illum(h, kx, kz, sc['az'], sc['el']), E)
    E = np.clip(E, 0.3, 1.6); refl = col * 0.255
    seen = np.clip(refl / E[..., None] * 1.35, 0, 1) ** 0.62
    miss = used < 0
    if miss.any():   # cloud in every pass: the mean colour around
        import build_detail as bd
        for i in range(3): seen[..., i] = np.where(miss, bd.fill(seen[..., i], ~miss), seen[..., i])
    print(f"wide colour: 16 Nov 2023 {np.mean((used >= 0) & (used <= 1)):.1%}, 30 Nov 2024 {np.mean(used == 2):.1%}, none {miss.mean():.2%}")
    wb = save_jpeg(f"{F}/bethlehem_s2_nov.jpg", seen, 84)
    nb = naip_box(a.work, 'near', (NEAR['north'], NEAR['south'], NEAR['west'], NEAR['east']), 2048, 4)
    nbt = save_jpeg(f"{F}/bth_bethlehem_steel_stacks_colour.jpg", nb[..., :3], 84)
    from PIL import Image
    d = naip(a)[..., :3]; d2 = np.asarray(Image.fromarray((d * 255).astype(np.uint8)).resize((2048, 2048), Image.LANCZOS)).astype(np.float32) / 255
    dbt = save_jpeg(f"{F}/bthd_steel_stacks_colour.jpg", d2, 86)
    print(f"files: wide {wb:,} B, near {nbt:,} B, close-up {dbt:,} B")


DETAIL_ID = 'bthd15_steel_stacks'


def coarsen(g, f):
    """The 1 m survey grid as f x f cells in one (highest return and its class, sums, lowest water return)."""
    n = g['top'].shape[0] // f; sh = (n, f, n, f); out = {}
    top = g['top'][:n * f, :n * f].reshape(sh); out['top'] = top.max((1, 3))
    a = top.transpose(0, 2, 1, 3).reshape(n, n, f * f).argmax(-1)
    out['cls'] = np.take_along_axis(g['cls'][:n * f, :n * f].reshape(sh).transpose(0, 2, 1, 3).reshape(n, n, f * f), a[..., None], -1)[..., 0]
    for k in ('gsum', 'gcnt', 'cnt', 'multi'): out[k] = g[k][:n * f, :n * f].reshape(sh).sum((1, 3))
    out['wmin'] = g['wmin'][:n * f, :n * f].reshape(sh).min((1, 3)); out['total'] = int(g['total'])
    return out


def detail(a):
    """The close-up box (terrain_detail_regions_v4 format, bare = true): heights = the bare ground and the water (the
    buildings and structures are the house tiles), mask = 0 ground / 3 water / tree cells, mask v6 with the bare-in-late-
    November call per tree, the 6 km water layer. --cell 1 (n 3008) or 2 (n 1504)."""
    import build_detail as bd
    f = int(a.cell); box = detail_box(); g = dict(np.load(f"{a.work}/grid1.npz")); n1 = g['top'].shape[0]
    g = coarsen(g, f) if f > 1 else g; n = g['top'].shape[0]; cell = SIDE / n
    sv = bd.Survey(PROJECT, f"{a.work}/cache")
    wp = f"{a.work}/wide_water.npz"
    if os.path.exists(wp): ww = dict(np.load(wp, allow_pickle=True)); ww['box'] = tuple(ww['box']); ww['n'] = int(ww['n'])
    else:
        R = REGION; wide = read_png(f"{a.work}/files/{R['path']}", R['base'], R['step'])
        ww = bd.wide_water(sv, MID[0], MID[1], (wide, (R['north'], R['south'], R['west'], R['east'])), lambda s: print('  ' + s, flush=True))
        np.savez(wp, **{k: np.asarray(v) for k, v in ww.items() if k in ('box', 'n', 'cls', 'level', 'water_m2', 'still_m2', 'nodata')})
    # bridge decks (class 17) over water: no return from under them, so the river runs on under the bridge
    wb = ww['box']; wn = ww['n']
    rr = (((wb[0] - (box[0] - (np.arange(n) + .5) * (box[0] - box[1]) / n)) / (wb[0] - wb[1])) * wn).astype(int).clip(0, wn - 1)
    cc = ((((box[2] + (np.arange(n) + .5) * (box[3] - box[2]) / n) - wb[2]) / (wb[3] - wb[2])) * wn).astype(int).clip(0, wn - 1)
    wide_w = ww['cls'][np.ix_(rr, cc)] > 0
    br = (g['cls'] == 17) & wide_w; g['cnt'] = np.where(br, 0, g['cnt']); g['gcnt'] = np.where(br, 0, g['gcnt'])
    print(f"close-up box {DETAIL_ID}: {n} x {n} at {cell:g} m; bridge-deck cells over the river opened: {int(br.sum()):,}", flush=True)
    surf, mask, base, st = bd.clean(g, box, n, cell, [STAND, STOP], ww, no_bld=True)
    # no tree where a structure stands (the furnaces' lattice and pipes give several returns like a crown) or where the
    # photo reads no plant (towers, poles, lattice the structure finder left out)
    struct = np.load(f"{a.work}/struct1.npy"); nd = ndvi_of(naip(a))
    if f > 1: struct = struct[:n * f, :n * f].reshape(n, f, n, f).any((1, 3)); nd = nd[:n * f, :n * f].reshape(n, f, n, f).mean((1, 3))
    from scipy import ndimage
    near_s = ndimage.binary_dilation(struct, iterations=max(1, int(round(2 / cell))))
    tree = mask >= bd.TREE0; drop = tree & (near_s | (bd.box3(nd) < 0.0)); mask[drop] = 0; tree &= ~drop
    # bare or evergreen in late November: Sentinel-2 16 Nov 2023 NDVI (10 m) over the crown. Measured on the box: oak /
    # maple woods 0.2-0.45 (bare or brown leaves), conifers and holly 0.55+; between = a weak bare call (class 2)
    la = box[0] - (np.arange(n) + .5) * (box[0] - box[1]) / n; lo = box[2] + (np.arange(n) + .5) * (box[3] - box[2]) / n
    LO, LA = np.meshgrid(lo, la); au = Autumn(a.work, box, level=0); _, snd, used = au.sample(LO, LA)
    hgt = (mask.astype(np.float64) - bd.TREE0) * bd.TREE_STEP
    k6 = np.clip(np.round(hgt / 0.6), 1, 81).astype(np.int64); cls6 = np.where(snd >= 0.55, 0, np.where(snd >= 0.48, 2, 1))
    m6 = np.where(tree, 8 + 3 * k6 + cls6, mask).astype(np.uint8)
    F = f"{a.work}/files_{f}m"; os.makedirs(F, exist_ok=True)
    base_m = math.floor(float(surf.min())) - 5; suf = '' if f == 1 else f'_{f}m'
    hp, mp, m6p, wpth = (f"{F}/{DETAIL_ID}{suf}_{k}.png" for k in ('lidar', 'mask', 'mask_v6', 'water'))
    bd.write_heights(hp, surf, base_m, bd.STEP); bd.write_mask(mp, mask); bd.write_mask(m6p, m6); bd.write_bytes(wpth, ww['cls'])
    assert np.abs(read_png(hp, base_m, bd.STEP) - surf).max() <= bd.STEP / 2 + 1e-6
    bd.look(f"{a.work}/look_detail_{f}m.png", surf, mask, cell)
    nt, nw = int(tree.sum()), int((mask == 3).sum()); a2 = cell * cell
    print(f"  trees {nt:,} cells ({nt * a2 / 1e4:.1f} ha; evergreen {np.mean(cls6[tree] == 0):.0%}, weak bare {np.mean(cls6[tree] == 2):.0%}, bare {np.mean(cls6[tree] == 1):.0%}), "
          f"{int(drop.sum()):,} high cells by structures / no plant put on the ground; water {nw:,} cells ({nw * a2 / 1e4:.1f} ha); heights {surf.min():.1f}..{surf.max():.1f} m")
    k = 60; la_ = box[0] - (np.arange(k) + .5) * (box[0] - box[1]) / k; lo_ = box[2] + (np.arange(k) + .5) * (box[3] - box[2]) / k
    L1, L2 = np.meshgrid(la_, lo_, indexing='ij'); rh = np.load(f"{a.work}/range_h.npy"); rj = json.load(open(f"{a.work}/range.json"))
    df = at(base, box, L1, L2) - at(rh, (rj['north'], rj['south'], rj['west'], rj['east']), L1, L2)
    print(f"  DATA CHECK ground against the range (3DEP 1 m DEM at 5 m): middle {np.nanmedian(df):+.2f} m, 9 in 10 within {np.nanpercentile(np.abs(df), 90):.2f} m")
    for nm, p in (('stop (stored 70 m)', STOP), ('stand pin', STAND)): print(f"  {nm}: ground {float(at(base, box, [p[0]], [p[1]])[0]):.1f} m")
    lv = surf[mask == 3]; print(f"  water level in the box {np.percentile(lv, 5):.1f}..{np.percentile(lv, 95):.1f} m (the Lehigh's pool at Bethlehem ~ 61-62 m NAVD88)")
    row = dict(id=DETAIL_ID + suf, parent=REGION['id'], north=box[0], south=box[1], west=box[2], east=box[3], n=n, width_m=round((box[3] - box[2]) * KX(MID[0]), 1), depth_m=round((box[0] - box[1]) * KZ, 1),
               base_m=base_m, step_m=bd.STEP, cell_m=cell, path=os.path.basename(hp), bytes=os.path.getsize(hp), mask_path=os.path.basename(mp), mask_bytes=os.path.getsize(mp),
               leaf_mask_path=os.path.basename(m6p), leaf_mask_bytes=os.path.getsize(m6p), water_path=os.path.basename(wpth), water_bytes=os.path.getsize(wpth), water_n=wn,
               water_north=wb[0], water_south=wb[1], water_west=wb[2], water_east=wb[3], color_path='bthd_steel_stacks_colour.jpg', bare=True)
    json.dump(row, open(f"{a.work}/detail_{f}m.json", 'w'), indent=1); print('  ' + json.dumps({k_: row[k_] for k_ in ('n', 'bytes', 'mask_bytes', 'leaf_mask_bytes', 'water_bytes')}))


def trees(a):
    """Trees beyond the close-up box (terrain_tree_tiles, the park-wide format with the bare bit: leaf_path): the same
    survey over the near box (6 x 6 km) read to octree depth 9 (a point every ~4 m), 2 x 2 tiles of ~7 m cells. A cell is
    a tree where the highest return that is not ground, water or bridge stands 4 m or more over the ground, two or more
    such returns came back, a quarter or more of them from pulses that gave several returns (a crown, not a roof) and
    the NAIP photo reads a plant there (NDVI 0 or more). Bare in late November where Sentinel-2 (16 Nov 2023) reads NDVI
    under 0.55. Inside the close-up box the page draws the box's own trees; these tiles carry them too (the panel
    sends tiles by distance and the page skips what the detail box holds)."""
    import build_detail as bd
    import concurrent.futures as cf
    box = (NEAR['north'], NEAR['south'], NEAR['west'], NEAR['east']); T = 2; cellm = 7.0
    kx = KX((box[0] + box[1]) / 2); N = int(round((box[0] - box[1]) * KZ / cellm / T)) * T; M = int(round((box[3] - box[2]) * kx / cellm / T)) * T
    N = M = max(N, M)
    sv = bd.Survey(PROJECT, f"{a.work}/cache"); x0, y1 = bd.merc(box[0], box[2]); x1, y0 = bd.merc(box[1], box[3])
    keys = sorted([k for k, v in sv.nodes(x0, x1, y0, y1, 9).items() if v > 0], key=lambda s: int(s.split('-')[0]))
    print(f"trees: {len(keys)} survey nodes to depth 9 over the near box, grid {N} x {M}", flush=True)
    top = np.full(N * M, -1e9, np.float32); gsum = np.zeros(N * M); gcnt = np.zeros(N * M, np.int32); hv = [];
    def read(k):
        x, y, z, c, many = sv.points(k, x0, x1, y0, y1)
        lat = np.degrees(np.arctan(np.sinh(y / bd.R))); lng = np.degrees(x / bd.R)
        r = ((box[0] - lat) / (box[0] - box[1]) * N).astype(np.int64).clip(0, N - 1); cc = ((lng - box[2]) / (box[3] - box[2]) * M).astype(np.int64).clip(0, M - 1)
        return r * M + cc, z, c, many
    with cf.ThreadPoolExecutor(8) as ex:
        for idx, z, c, many in ex.map(read, keys):
            g = c == 2
            if g.any(): np.add.at(gsum, idx[g], z[g]); np.add.at(gcnt, idx[g], 1)
            v = ~np.isin(c, [2, 9, 17])
            if v.any(): np.maximum.at(top, idx[v], z[v]); hv.append((idx[v], z[v], many[v]))
    ok = gcnt > 0; ground = bd.fill((gsum / np.maximum(gcnt, 1)).reshape(N, M), ok.reshape(N, M)).ravel()
    hp = np.zeros(N * M, np.int32); hm = np.zeros(N * M, np.int32)
    for idx, z, many in hv:
        hi = z - ground[idx] >= 2.0; np.add.at(hp, idx[hi], 1); np.add.at(hm, idx[hi & many], 1)
    can = np.where(top > -1e8, top - ground, 0).reshape(N, M); hp = hp.reshape(N, M); hm = hm.reshape(N, M)
    tree = (can >= 4.0) & (hp >= 2) & (hm >= 0.25 * hp)
    la = box[0] - (np.arange(N) + .5) * (box[0] - box[1]) / N; lo = box[2] + (np.arange(M) + .5) * (box[3] - box[2]) / M; LO, LA = np.meshgrid(lo, la)
    nb = naip_box(a.work, 'near', box, 2048, 4); from scipy import ndimage
    nd = ndimage.map_coordinates(ndvi_of(nb), [(np.arange(N)[:, None] + .5) / N * 2048 - .5 + 0 * LO, (np.arange(M)[None, :] + .5) / M * 2048 - .5 + 0 * LA], order=1, mode='nearest')
    tree &= nd >= 0.0
    au = Autumn(a.work, box, 0); _, snd, used = au.sample(LO, LA); bare = tree & (snd < 0.55)
    F = f"{a.work}/files"; rows = []
    for tr in range(T):
        for tc in range(T):
            n = N // T; sl = (slice(tr * n, (tr + 1) * n), slice(tc * n, (tc + 1) * n))
            tn, ts = round(box[0] - tr * (box[0] - box[1]) / T, 6), round(box[0] - (tr + 1) * (box[0] - box[1]) / T, 6)
            tw, te = round(box[2] + tc * (box[3] - box[2]) / T, 6), round(box[2] + (tc + 1) * (box[3] - box[2]) / T, 6)
            h = np.where(tree[sl], np.clip(np.round(can[sl] / 2.0), 1, 127), 0).astype(np.uint8)
            if not h.any(): continue
            hl = (h + np.where(bare[sl] & (h > 0), 128, 0)).astype(np.uint8)
            p0, p1 = f"{F}/bthc_{tr}_{tc}.png", f"{F}/bthcl_{tr}_{tc}.png"; bd.write_mask(p0, h); bd.write_mask(p1, hl)
            rows.append(dict(id=f"bthc_{tr}_{tc}", parent=REGION['id'], north=tn, south=ts, west=tw, east=te, n=n, lod=0, step_m=2.0, cell_m=round((box[0] - box[1]) / N * KZ, 2),
                             path=os.path.basename(p0), bytes=os.path.getsize(p0), trees=int((h > 0).sum()), leaf_path=os.path.basename(p1), leaf_bytes=os.path.getsize(p1)))
    json.dump(rows, open(f"{a.work}/tree_tiles.json", 'w'), indent=1)
    print(f"tree cells {int(tree.sum()):,} of {N * M:,} ({np.mean(bare[tree]):.0%} bare in late November); {len(rows)} tiles, {sum(r['bytes'] + r['leaf_bytes'] for r in rows) / 1e3:.0f} KB")


MIGRATION = '20261122030000_terrain_bethlehem.sql'


def sql(a):
    """<work>/upload/: every file to upload (bucket `terrain`), upload.txt (name, bytes, sha256), the rows as JSON for the
    harness (region.json, near.json, range.json, house_tiles.json, tree_tiles.json, detail row) and the migration."""
    import hashlib, shutil
    W = a.work; U = f"{W}/upload"; os.makedirs(U, exist_ok=True)
    det = json.load(open(f"{W}/detail_{a.cell}m.json")); rng = json.load(open(f"{W}/range.json"))
    hts = json.load(open(f"{W}/house_tiles.json")); tts = json.load(open(f"{W}/tree_tiles.json"))
    src = {}
    for d in (f"{W}/files", f"{W}/files_{a.cell}m"):
        for f in os.listdir(d): src[f] = os.path.join(d, f)
    def w_m(b): return round((b['east'] - b['west']) * KX((b['north'] + b['south']) / 2), 1), round((b['north'] - b['south']) * KZ, 1)
    R = dict(REGION, base_m=REGION['base'], step_m=REGION['step'], ground='green', color_path='bethlehem_s2_nov.jpg')
    R['width_m'], R['depth_m'] = w_m(R)
    R['color_credit'] = ('Heights: USGS 3DEP (lidar 2019, 1 m DEM; terrarium tiles beyond). Ground colour: Copernicus Sentinel-2 (ESA), 16 Nov 2023. '
                         'Aerial photos: USDA NAIP via USGS, April 2022. Buildings and trees: USGS 3DEP lidar 2019.')
    Nn = dict(NEAR, base_m=NEAR['base'], step_m=NEAR['step'], color_path='bth_bethlehem_steel_stacks_colour.jpg'); Nn['width_m'], Nn['depth_m'] = w_m(Nn)
    rng['width_m'], rng['depth_m'] = w_m(rng)
    files = [R['path'], R['color_path'], Nn['path'], Nn['color_path'], rng['path'], det['path'], det['mask_path'], det['leaf_mask_path'], det['water_path'], det['color_path']] + [t['path'] for t in hts] + [t['path'] for t in tts] + [t['leaf_path'] for t in tts]
    lines = []
    for f in files:
        shutil.copy(src[f], f"{U}/{f}"); by = open(f"{U}/{f}", 'rb').read(); lines.append(f"{f}\t{len(by)}\t{hashlib.sha256(by).hexdigest()}")
    size = {f: os.path.getsize(f"{U}/{f}") for f in files}
    for o in (R, Nn, rng, det): o['bytes'] = size[o['path']]
    R['color_bytes'] = size[R['color_path']]; Nn['color_bytes'] = size[Nn['color_path']]
    for k in ('mask', 'leaf_mask', 'water', 'color'): det[f'{k}_bytes'] = size[det[f'{k}_path']]
    open(f"{U}/upload.txt", 'w').write("\n".join(lines) + "\n")
    for nm, o in (('region', R), ('near', Nn), ('range', rng), ('house_tiles', hts), ('tree_tiles', tts), ('detail', det)): json.dump(o, open(f"{U}/{nm}.json", 'w'), indent=1)
    q = lambda v: 'null' if v is None else ('true' if v is True else 'false' if v is False else f"'{v}'" if isinstance(v, str) else str(v))
    nh = sum(t['count'] for t in hts)
    sq = [f"""-- 3D sun view for the day shoot 'Bethlehem Steel Stacks' (trip 138477e5-0c0c-44b6-8958-25a31660eef7, Bethlehem PA, 25 Nov 2026), 22 Nov 2026. NOT applied.
-- Built by tools/sun3d/bethlehem/build_bethlehem.py (README.md there). The whole NEW_TRIP_SOP 4b stack, new rows only (ids bth*):
--   wide region 'bethlehem' (60 x 61 km): terrarium tiles zoom 12 (~29 m), a 720 m spike and a source seam SW of Allentown
--     fixed (despike + Copernicus GLO-30 over the seam). Colour: Sentinel-2 16 Nov 2023 (late-autumn, light of 11 AM divided out);
--   near box (6 km, ~7 m): terrarium zoom 14, colour USDA NAIP 29 Apr 2022 (bare trees, first leaves);
--   range '{rng['id']}' (10.24 km at 5 m): USGS 3DEP 1 m DEM PA_Northcentral_2019_B19 over the site and South Mountain (feeds sun times);
--   close-up box '{det['id']}' (3 km at {det['cell_m']:g} m, n {det['n']}): USGS 3DEP lidar PA_Northcentral_B5_2019, bare ground + water
--     (Lehigh River, the canal), mask v6 trees (bare / evergreen from Sentinel-2 16 Nov 2023 NDVI), NAIP colour;
--   {len(hts)} house tiles (bthb_*, {nh:,} blocks): every building and structure the survey saw in the box, found by the returns
--     (one return = solid) and the NAIP photo (no plant), the furnaces / casino as stacks of blocks by height step;
--   {len(tts)} tree tiles (bthc_*, 7 m cells over the near box, bare bit in leaf_path).
-- Before applying: upload the {len(files)} files listed in upload.txt (bucket terrain, same names; {sum(size.values()):,} bytes).
-- No 'Teton' or 'Faroes' row is touched.
insert into public.terrain_regions (id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground, note, color_path, color_bytes, color_credit) values
  ({q(R['id'])}, {R['north']}, {R['south']}, {R['west']}, {R['east']}, {R['n']}, {R['width_m']}, {R['depth_m']}, 0, 0.5, {q(R['path'])}, {R['bytes']}, 'green', 'Public terrarium tiles, zoom 12 (~29 m), glitches fixed. Late November, no snow.', {q(R['color_path'])}, {R['color_bytes']}, {q(R['color_credit'])})
on conflict (id) do nothing;
insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, note, color_path, color_bytes) values
  ({q(Nn['id'])}, 'bethlehem', {Nn['north']}, {Nn['south']}, {Nn['west']}, {Nn['east']}, {Nn['n']}, {Nn['width_m']}, {Nn['depth_m']}, 0, 0.5, {q(Nn['path'])}, {Nn['bytes']}, 'Public terrarium tiles, zoom 14, about 7 m a point.', {q(Nn['color_path'])}, {Nn['color_bytes']})
on conflict (id) do nothing;
insert into public.terrain_range_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, note) values
  ({q(rng['id'])}, 'bethlehem', {rng['north']}, {rng['south']}, {rng['west']}, {rng['east']}, {rng['n']}, {rng['width_m']}, {rng['depth_m']}, {rng['base_m']}, {rng['step_m']}, {rng['cell_m']}, {q(rng['path'])}, {rng['bytes']}, 'USGS 3DEP 1 m DEM (PA_Northcentral_2019_B19), bare earth at 5 m: the site and South Mountain toward the late-autumn sunset.')
on conflict (id) do nothing;
insert into public.terrain_detail_regions_v4 (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes, water_path, water_bytes, water_n, water_north, water_south, water_west, water_east, color_path, color_bytes, bare, leaf_mask_path, leaf_mask_bytes, note) values
  ({q(det['id'])}, 'bethlehem', {det['north']}, {det['south']}, {det['west']}, {det['east']}, {det['n']}, {det['width_m']}, {det['depth_m']}, {det['base_m']}, {det['step_m']}, {det['cell_m']}, {q(det['path'])}, {det['bytes']}, {q(det['mask_path'])}, {det['mask_bytes']}, {q(det['water_path'])}, {det['water_bytes']}, {det['water_n']}, {det['water_north']}, {det['water_south']}, {det['water_west']}, {det['water_east']}, {q(det['color_path'])}, {det['color_bytes']}, true, {q(det['leaf_mask_path'])}, {det['leaf_mask_bytes']}, 'USGS 3DEP lidar PA_Northcentral_B5_2019 (2019), 3 km at {det['cell_m']:g} m around the parking and the stand pin: bare ground and water, trees in the mask (bare or evergreen in late November). Buildings and the furnaces are the bthb_* house tiles.')
on conflict (id) do nothing;
insert into public.terrain_house_tiles (id, parent, north, south, west, east, path, bytes, count, note) values
""" + ",\n".join(f"  ({q(t['id'])}, 'bethlehem', {t['north']}, {t['south']}, {t['west']}, {t['east']}, {q(t['path'])}, {size[t['path']]}, {t['count']}, 'USGS 3DEP lidar 2019: buildings and structures (furnaces, trestle, casino) as blocks by height step, roof colour from NAIP.')" for t in hts) + "\non conflict (id) do nothing;\n"
          + "insert into public.terrain_tree_tiles (id, parent, north, south, west, east, n, lod, step_m, cell_m, path, bytes, trees, note, leaf_path, leaf_bytes) values\n"
          + ",\n".join(f"  ({q(t['id'])}, 'bethlehem', {t['north']}, {t['south']}, {t['west']}, {t['east']}, {t['n']}, 0, {t['step_m']}, {t['cell_m']}, {q(t['path'])}, {size[t['path']]}, {t['trees']}, 'USGS 3DEP lidar 2019, 7 m cells; bare in late November from Sentinel-2 16 Nov 2023.', {q(t['leaf_path'])}, {size[t['leaf_path']]})" for t in tts)
          + "\non conflict (id) do nothing;\n"]
    text = "".join(sq); assert ';' not in text.replace(";\n", "\n"), 'a semicolon inside a string literal'
    low = text.lower(); assert 'drop' not in low and 'delete from' not in low
    open(f"{U}/{MIGRATION}", 'w').write(text)
    print(f"{len(files)} files, {sum(size.values()) / 1e6:.1f} MB; wrote {U}/upload.txt and {U}/{MIGRATION}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); sub = ap.add_subparsers(dest='cmd', required=True)
    sq_ = sub.add_parser('sql'); sq_.add_argument('work'); sq_.add_argument('--cell', type=int, choices=[1, 2], default=2)
    dt = sub.add_parser('detail'); dt.add_argument('work'); dt.add_argument('--cell', type=int, choices=[1, 2], default=2)
    d = sub.add_parser('despike'); d.add_argument('png'); d.add_argument('--cell', type=float, default=29.3, help='metres a point')
    d.add_argument('--box', type=float, nargs=4, default=[REGION['north'], REGION['south'], REGION['west'], REGION['east']])
    d.add_argument('--cop-work', help="build_trip_terrain.py's work dir (its cop/ tiles): Copernicus over the source seam")
    d.add_argument('--seam-box', type=float, nargs=2, default=[40.60, -75.57], help='the seam lies south of this lat and west of this lng')
    for name in ('grid', 'range', 'naip', 'houses', 'colour', 'trees'): sub.add_parser(name).add_argument('work')
    a = ap.parse_args()
    {'despike': despike, 'grid': grid, 'range': range_box, 'naip': naip, 'houses': houses, 'colour': colour, 'detail': detail, 'trees': trees, 'sql': sql}[a.cmd](a)


if __name__ == '__main__': main()
