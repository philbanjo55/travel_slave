#!/usr/bin/env python3
"""3D sun view: put a creek the laser survey has no WATER class for into an existing v4 close-up box, and draw its road
bridge (23 Nov 2026, gtd15_jenny_lake_2: Cottonwood Creek and the Highlands road bridge, shot 'highlands bridge').

  build_detail_water.py build <work> --row row.json --files <dir with the box's files> --cache <survey cache> [options]
  build_detail_water.py sql   <work> --migration <file>        the migration + <work>/upload.txt (NOT applied)
Jenny Lake 2 (23 Nov 2026):
  build W --row W/row_in.json --files W/orig --cache <survey cache> --stand 43.709423,-110.730954 --suffix _v4w
  -> gtd_jenny_lake_2_mask_v4w.png, gtd_jenny_lake_2w_mask_v6.png, gtd_jenny_lake_2_water_v4w.png, gtd_jenny_lake_2_bld.json

Why: build_detail.py finds water from the survey's water class (9) and the empty cells joined to it. The 2022 Grand
Teton survey has NO class 9 point on Cottonwood Creek, so the creek's cells (empty: water swallows the laser) were filled
with ground from around and the box drew the creek as snow; its wide water layer has no creek either.

What `build` does, starting from the box as it is (its files are read, not rebuilt; heights, colour and tree files are
left byte-identical):
  1. the survey at the box's own depth (--max-depth 10, as the v4 boxes were built: ~4 points a m2) on the box's 1 m grid:
     points per cell, and every bridge-deck point (class 17);
  2. water = the cells with no return at all, in patches (8-connected) of at least --min-m2 that lie at the local low
     (at least 0.08 m below a ring of ground round them) and that the USDA NAIP photo confirms (half the patch within
     --photo-m (40 m) of photo water: NDWI over 0.2 and near-infrared under 0.35). The photo only says yes or no: its
     outline is NOT used. NAIP (19 Jul 2022) and the survey (24 Sep 2022, from the points' GPS time) disagree here by up
     to ~20 m (the photo's road crosses the creek ~17 m north of the laser's bridge deck, and its creek wanders off the
     channel the survey's heights show), and the box's heights, trees and stand pins are the survey's;
  3. the gaps in the channel closed: under a bridge deck, and under overhanging crowns (the laser comes back from the
     tree, not the water): closing over --close-m, a cell taken only where the bare heights are no higher than the
     water within 4 m + 0.3 m; small islands (<= 30 m2) filled; then one cell of bank edge where it is as low as the water;
  4. moving / still: a patch that runs over 200 m and is thin (a creek) = moving, else still (ponds) (the page draws
     still water frozen under snow, moving water open);
  5. the masks: mask v4 and mask v6 get class 3 on every water cell (whatever they held: a tree cell over the channel is
     water now, so no tree stands in the creek); bridge-deck cells that are not water lose any tree (no trunk through a deck);
  6. the wide water layer (6 km, 4 m) keeps its own cells and gains the creek: inside the box from the box's water (a 4 m
     cell is water when 30 % of its 1 m cells are; the box's ponds as still), outside it from the survey's depth-8 sample
     (ribbons of empty 4 m cells followed out from the box's creek, see wide_creek; at Jenny Lake 2 only ~0.5 ha: the
     sample has few empty cells along the creek outside the box); class 1 moving;
  7. bridges: each cluster of class-17 points (>= 200 points) as a deck in the box's buildings file (the page's
     buildings_path JSON: outline in metres east / south of the box's north-west corner, absolute foot f (walls start at
     f - 1), eave e = ridge r = the deck top, roof flat), the laser's deck outline along its main axis, lengthened at each
     end until the bare road reaches the deck top (at most 3 m), --deck-t m thick (0.6), open below; plus a low railing
     on each long side (posts every 2.5 m and a top rail, --rail-h m over the deck): the laser shows something 0.3-1 m up
     along both edges of the Highlands deck.
Output: <work>/files (new files only), <work>/look (pictures), <work>/row.json (the new column values + numbers).
Needs: pip install "laspy[lazrs]" numpy scipy pillow tifffile requests pyproj (the NAIP reader of build_dem_detail.py).
"""
import argparse, concurrent.futures as cf, hashlib, io, json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path[:0] = [HERE, os.path.dirname(HERE), os.path.join(os.path.dirname(HERE), 'teton_colour')]
from build_detail import Survey, merc, R, write_bytes, write_mask     # noqa: E402  (the survey reader, the page's file formats)
from build_trip_terrain import read_png                              # noqa: E402
import build_dem_detail as bdd                                       # noqa: E402  (NAIP reader)

KZ = 111132.0
KX = lambda lat: 111320 * math.cos(math.radians(lat))
NDWI_MIN, NIR_MAX = 0.20, 0.35


def log(*a): print(*a, flush=True)


def rc_of(b, n, lat, lng):
    return int((b['north'] - lat) / (b['north'] - b['south']) * n), int((lng - b['west']) / (b['east'] - b['west']) * n)


# ---------------------------------------------------------------- the survey
def survey_grid(sv, b, n, maxd, log):
    """Points per cell on the box's n x n lat / lng grid (row 0 = north), and the bridge-deck points (class 17)."""
    x0, y1 = merc(b['north'], b['west']); x1, y0 = merc(b['south'], b['east'])
    keys = sv.nodes(x0, x1, y0, y1, maxd); order = sorted(keys, key=lambda s: int(s.split("-")[0]))
    cnt = np.zeros((n, n), np.int32); isum = np.zeros((n, n), np.float64); deck = []; total = 0
    import laspy

    def one(key):
        las = laspy.read(io.BytesIO(sv.get(f'ept-data/{key}.laz')))
        x, y = np.asarray(las.x), np.asarray(las.y); c = np.asarray(las.classification)
        m = (x >= x0) & (x < x1) & (y >= y0) & (y < y1) & (c != 7) & (c != 18)
        return x[m], y[m], np.asarray(las.z)[m], c[m], np.asarray(las.intensity)[m]
    with cf.ThreadPoolExecutor(8) as ex:
        for x, y, z, c, it in ex.map(one, order):
            if not len(x): continue
            total += len(x)
            lat = np.degrees(np.arctan(np.sinh(y / R))); lng = np.degrees(x / R)
            ri = ((b['north'] - lat) / (b['north'] - b['south']) * n).astype(np.int32).clip(0, n - 1)
            ci = ((lng - b['west']) / (b['east'] - b['west']) * n).astype(np.int32).clip(0, n - 1)
            np.add.at(cnt, (ri, ci), 1); np.add.at(isum, (ri, ci), it)
            d = c == 17
            if d.any(): deck.append(np.stack([lat[d], lng[d], z[d]], 1))
    log(f"survey: {len(order)} nodes (depth <= {maxd}), {total:,} points, {int((cnt == 0).sum()):,} empty cells of {n * n:,}")
    return cnt, isum, (np.concatenate(deck) if deck else np.zeros((0, 3)))


# ---------------------------------------------------------------- water
def ring_low(h, me, s, ring_m, cell):
    rk = max(1, int(round(ring_m / cell))); disk = np.hypot(*np.mgrid[-rk:rk + 1, -rk:rk + 1]) <= rk
    s2 = tuple(slice(max(0, a.start - rk), a.stop + rk) for a in s)
    m = np.zeros(h[s2].shape, bool); off = (s[0].start - s2[0].start, s[1].start - s2[1].start)
    m[off[0]:off[0] + me.shape[0], off[1]:off[1] + me.shape[1]] = me
    ring = ndimage.binary_dilation(m, disk) & ~m
    return float(np.median(h[s2][m]) - np.median(h[s2][ring])) if ring.any() else 0.0


def find_water(empty, photo, h, cell, min_m2, log, close_m=6.0, photo_m=40.0):
    """Empty-cell patches confirmed by the photo and at the local low, then the channel's gaps closed (see the top)."""
    lab, k = ndimage.label(empty, np.ones((3, 3)))
    keep = np.zeros(k + 1, bool); info = []
    rk = int(round(photo_m / cell)); near_photo = ndimage.maximum_filter(photo.astype(np.uint8), size=2 * rk + 1) > 0   # (square: fast)
    for i, s in enumerate(ndimage.find_objects(lab), 1):
        me = lab[s] == i; m2 = float(me.sum() * cell * cell)
        if m2 < min_m2: continue
        share = float(near_photo[s][me].mean()); d = ring_low(h, me, s, 8.0, cell)
        ext = math.hypot((s[0].stop - s[0].start) * cell, (s[1].stop - s[1].start) * cell)
        ok = share >= 0.5 and d <= -0.08
        if ok: keep[i] = True
        if ok or m2 >= 100: info.append(dict(m2=round(m2), extent_m=round(ext), photo=round(share, 2), above_ring=round(d, 2), kept=bool(ok), at=[int(s[0].start), int(s[1].start)]))
    w = keep[lab]
    log(f"water seeds: {int(keep.sum())} patches kept of {k} empty patches, {int(w.sum()):,} m2")
    # gaps: under the bridge deck and under crowns. A cell is added by the closing only when its bare height is no higher
    # than the water around it (the highest water within 4 m) + 0.3 m: a closing never climbs a bank.
    r = max(1, int(round(close_m / 2 / cell))); disk = np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r
    wl = ndimage.maximum_filter(np.where(w, h, -1e9), size=2 * int(round(4 / cell)) + 1)
    closed = ndimage.binary_closing(w, disk, iterations=2)
    w = w | (closed & (h <= wl + 0.3))
    holes = ndimage.binary_fill_holes(w) & ~w; hl, hk = ndimage.label(holes)
    if hk:
        sz = ndimage.sum(holes, hl, range(1, hk + 1)) * cell * cell; w |= np.isin(hl, 1 + np.nonzero(sz <= 30)[0])
    # one cell of bank edge, where it lies as low as the water beside it (mixed cells at the water's edge)
    wl = ndimage.maximum_filter(np.where(w, h, -1e9), size=3)
    w |= ndimage.binary_dilation(w) & (h <= wl + 0.1)
    return w, info


def moving_still(w, cell):
    lab, k = ndimage.label(w, np.ones((3, 3))); cls = np.zeros(w.shape, np.uint8); out = []
    for i, s in enumerate(ndimage.find_objects(lab), 1):
        me = lab[s] == i; m2 = float(me.sum() * cell * cell); e = math.hypot((s[0].stop - s[0].start) * cell, (s[1].stop - s[1].start) * cell)
        mv = e >= 200 and m2 / (e * e) < 0.06
        cls[s][me] = 1 if mv else 2; out.append(dict(m2=round(m2), extent_m=round(e), moving=bool(mv)))
    return cls, sorted(out, key=lambda p: -p['m2'])


# ---------------------------------------------------------------- the wide layer
def wide_creek(sv, wb, wn, box_cls_wide, log, work, photo_m=40.0):
    """The creek outside the box, from the survey's depth-8 sample (a point every ~2.8 m) on the 4 m wide grid: patches of
    empty cells followed out from the box's creek, one gap of up to 40 m at a time (riffles, crowns, a bridge), each a
    ribbon (mean width = area / extent 16 m or less, 2 cells or more). The chain as a whole must lie within photo_m of
    NAIP photo water for half its cells (the photo's own outline is off by up to ~20 m here, so it only confirms), else
    nothing is added."""
    x0, y1 = merc(wb['north'], wb['west']); x1, y0 = merc(wb['south'], wb['east'])
    keys = sv.nodes(x0, x1, y0, y1, 8); order = sorted(keys, key=lambda s: int(s.split("-")[0]))
    cnt = np.zeros((wn, wn), np.int32)

    def one(key):
        x, y, z, c, _ = sv.points(key, x0, x1, y0, y1); return x, y
    with cf.ThreadPoolExecutor(8) as ex:
        for x, y in ex.map(one, order):
            if not len(x): continue
            lat = np.degrees(np.arctan(np.sinh(y / R))); lng = np.degrees(x / R)
            ri = ((wb['north'] - lat) / (wb['north'] - wb['south']) * wn).astype(np.int32).clip(0, wn - 1)
            ci = ((lng - wb['west']) / (wb['east'] - wb['west']) * wn).astype(np.int32).clip(0, wn - 1)
            np.add.at(cnt, (ri, ci), 1)
    nb = bdd.naip(work, 'wide', wb, wn, wn)
    g, nir = nb[..., 1], nb[..., 3]; ndwi = (g - nir) / np.maximum(g + nir, 1e-3)
    rk = max(1, int(round(photo_m / 4.0))); near_photo = ndimage.maximum_filter(((ndwi > NDWI_MIN) & (nir < NIR_MAX)).astype(np.uint8), size=2 * rk + 1) > 0
    empty = cnt == 0
    joined = ndimage.binary_closing(empty, np.ones((3, 3))) | empty   # a creek 8-15 m wide is 2-4 cells: a point now and then from a riffle or a rock
    lab, k = ndimage.label(joined, np.ones((3, 3))); ok = np.zeros(k + 1, bool)
    for i, s in enumerate(ndimage.find_objects(lab), 1):
        me = lab[s] == i; m = me.sum(); e = math.hypot(s[0].stop - s[0].start, s[1].stop - s[1].start) * 4.0
        ok[i] = m >= 2 and (m * 16) / max(e, 1) <= 16.0   # a ribbon: its mean width (area / extent) 16 m or less
    have = ndimage.binary_dilation(box_cls_wide > 0, iterations=1); got = np.zeros_like(empty)
    for it in range(80):   # follow the creek out, a gap of up to 10 cells (40 m) at a time
        touch = np.unique(lab[ndimage.binary_dilation(have | got, np.ones((3, 3)), iterations=10) & (lab > 0)])
        touch = touch[ok[touch]]; new = np.isin(lab, touch) & ~got
        if not new.any(): break
        got |= new
    np.savez_compressed(f"{work}/cache/wide_diag.npz", cnt=cnt, near_photo=near_photo, ok=ok[lab], got=got)
    share = float(near_photo[got].mean()) if got.any() else 0.0
    log(f"wide creek: {len(order)} depth-8 nodes; empty 4 m cells {int(empty.sum()):,}; followed out from the box: {int(got.sum()):,} cells ({got.sum() * 16 / 1e4:.1f} ha) in {it} steps, "
        f"{share:.0%} of them within {photo_m:.0f} m of NAIP photo water")
    if share < 0.5: log("  under half confirmed by the photo: left out"); return np.zeros_like(got)
    return got


# ---------------------------------------------------------------- bridges
def bridges(deck, b, n, h, cell, deck_t, rail_h, log):
    """Class-17 point clusters -> deck slabs + railings for the buildings file (metres east / south of the NW corner)."""
    if not len(deck): return [], []
    clat = (b['north'] + b['south']) / 2; kx = KX(clat)
    E = (deck[:, 1] - b['west']) * kx; S = (b['north'] - deck[:, 0]) * KZ
    W_m, D_m = (b['east'] - b['west']) * kx, (b['north'] - b['south']) * KZ
    occ = np.zeros((n, n), bool); occ[(S / D_m * n).astype(int).clip(0, n - 1), (E / W_m * n).astype(int).clip(0, n - 1)] = True
    lab, k = ndimage.label(ndimage.binary_dilation(occ, iterations=2))
    pl = lab[(S / D_m * n).astype(int).clip(0, n - 1), (E / W_m * n).astype(int).clip(0, n - 1)]
    out, info = [], []
    hat = lambda e, s: float(h[min(n - 1, max(0, int(s / D_m * n))), min(n - 1, max(0, int(e / W_m * n)))])
    for i in range(1, k + 1):
        m = pl == i
        if m.sum() < 200: continue
        X = np.stack([E[m], S[m]], 1); X0 = X.mean(0); _, _, vt = np.linalg.svd(X - X0, full_matrices=False)
        ax, ac = vt[0], np.array([-vt[0][1], vt[0][0]])
        al = (X - X0) @ ax; ac_ = (X - X0) @ ac
        a0, a1 = np.percentile(al, [0.5, 99.5]); c0, c1 = np.percentile(ac_, [0.5, 99.5])
        top = float(np.median(deck[m, 2]))
        # lengthen each end until the bare road is within 0.2 m of the deck top (the abutment / approach), at most 3 m
        ext = []
        for sgn, a in ((-1, a0), (1, a1)):
            d = 0.0
            while d < 3.0:
                p = X0 + (a + sgn * d) * ax
                if hat(p[0], p[1]) >= top - 0.2: break
                d += 0.5
            ext.append(d)
        a0 -= ext[0]; a1 += ext[1]
        corner = lambda a, c: X0 + a * ax + c * ac
        P = [corner(a0, c0), corner(a1, c0), corner(a1, c1), corner(a0, c1)]
        flat = lambda pts: [round(float(v), 2) for p in pts for v in p]
        out.append(dict(p=flat(P), f=round(top - deck_t + 1.0, 2), e=round(top, 2), r=round(top, 2), roof='flat', rc=[150, 142, 132], wc=[96, 86, 76]))
        # railing: a top rail and posts along each long side, 0.2 m inside the edge
        rt = top + rail_h; L = a1 - a0
        for c in (c0 + 0.2, c1 - 0.2):
            rail = [corner(a0, c - 0.08), corner(a1, c - 0.08), corner(a1, c + 0.08), corner(a0, c + 0.08)]
            out.append(dict(p=flat(rail), f=round(rt - 0.15 + 1.0, 2), e=round(rt, 2), r=round(rt, 2), roof='flat', rc=[112, 100, 88], wc=[92, 80, 68]))
            for j in range(int(L // 2.5) + 1):
                a = a0 + 0.3 + j * (L - 0.6) / max(1, int(L // 2.5))
                post = [corner(a - 0.08, c - 0.08), corner(a + 0.08, c - 0.08), corner(a + 0.08, c + 0.08), corner(a - 0.08, c + 0.08)]
                out.append(dict(p=flat(post), f=round(top + 1.0, 2), e=round(rt - 0.15, 2), r=round(rt - 0.15, 2), roof='flat', rc=[92, 80, 68], wc=[92, 80, 68]))
        mid = X0
        info.append(dict(points=int(m.sum()), top_m=round(top, 2), length_laser_m=round(float(np.percentile(al, 99.5) - np.percentile(al, 0.5)), 1),
                         length_drawn_m=round(float(a1 - a0), 1), ends_added_m=ext, width_m=round(float(c1 - c0), 1),
                         bearing_deg=round((math.degrees(math.atan2(ax[0], -ax[1])) + 360) % 180, 1),
                         centre=[round(b['north'] - mid[1] / KZ, 6), round(b['west'] + mid[0] / kx, 6)],
                         bare_under_min_m=round(min(hat(*(X0 + t * ax)) for t in np.linspace(a0 + 1, a1 - 1, 9)), 2)))
        log(f"bridge: {info[-1]}")
    return out, info


def deck_cells(objs, b, n):
    """Cells under the decks (the first object of each bridge: the slab, roof 'flat' with rc of the deck)."""
    kx = KX((b['north'] + b['south']) / 2); W_m, D_m = (b['east'] - b['west']) * kx, (b['north'] - b['south']) * KZ
    m = np.zeros((n, n), bool); rr, cc = np.mgrid[0:n, 0:n]; xs = (cc + .5) * W_m / n; zs = (rr + .5) * D_m / n
    def inside(p, x, z):   # even-odd rule, as the page's houses() does
        k = np.zeros(x.shape, bool)
        for i in range(len(p)):
            a, b_ = p[i], p[i - 1]
            cross = (a[1] > z) != (b_[1] > z)
            xi = (b_[0] - a[0]) * (z - a[1]) / np.where(b_[1] != a[1], b_[1] - a[1], 1e-9) + a[0]
            k ^= cross & (x < xi)
        return k
    for o in objs:
        if o['rc'] != [150, 142, 132]: continue
        p = np.array(o['p']).reshape(-1, 2); r0, r1 = int(p[:, 1].min() / D_m * n) - 1, int(p[:, 1].max() / D_m * n) + 2; c0, c1 = int(p[:, 0].min() / W_m * n) - 1, int(p[:, 0].max() / W_m * n) + 2
        m[r0:r1, c0:c1] |= inside(p, xs[r0:r1, c0:c1], zs[r0:r1, c0:c1])
    return m


# ---------------------------------------------------------------- pictures
def look(path, h, mask, stand, crop=None):
    gy, gx = np.gradient(h); sh = np.clip(0.72 + 0.9 * (-gx - gy) / np.sqrt(1 + gx * gx + gy * gy), 0.2, 1.2)
    img = np.array([228, 230, 226], float)[None, None] * sh[..., None]
    img[mask >= 8] = img[mask >= 8] * 0.55 + np.array([40, 90, 40]) * 0.45
    img[mask == 3] = (30, 90, 200)
    img = np.clip(img, 0, 255).astype(np.uint8)
    if stand: r, c = stand; img[r - 4:r + 5, c] = img[r, c - 4:c + 5] = (230, 20, 20)
    if crop: img = img[crop[0]:crop[1], crop[2]:crop[3]]
    Image.fromarray(img).save(path)


def build(a):
    W = a.work; F = f"{W}/files"; os.makedirs(F, exist_ok=True); os.makedirs(f"{W}/look", exist_ok=True)
    row = json.load(open(a.row)); b = dict(north=row['north'], south=row['south'], west=row['west'], east=row['east']); n = row['n']; cell = row['cell_m']
    src = lambda k: os.path.join(a.files, row[k])
    h = read_png(src('path'), row['base_m'], row['step_m'])
    m4 = np.array(Image.open(src('mask_path'))); m6 = np.array(Image.open(src('leaf_mask_path'))) if row.get('leaf_mask_path') else None
    wl = np.array(Image.open(src('water_path'))); wn = row['water_n']
    wb = dict(north=row['water_north'], south=row['water_south'], west=row['water_west'], east=row['water_east'])
    assert m4.shape == (n, n) and wl.shape == (wn, wn)
    sv = Survey(a.project, a.cache)
    cnt, _, deck = survey_grid(sv, b, n, a.max_depth, log)
    nb = bdd.naip(W, 'box', b, n, n)
    g, nir = nb[..., 1], nb[..., 3]; ndwi = (g - nir) / np.maximum(g + nir, 1e-3); photo = (ndwi > NDWI_MIN) & (nir < NIR_MAX)
    w, patches = find_water(cnt == 0, photo, h, cell, a.min_m2, log, a.close_m, a.photo_m)
    cls, parts = moving_still(w, cell)
    log(f"box water {int(w.sum()):,} m2 ({int((cls == 1).sum()):,} moving, {int((cls == 2).sum()):,} still); parts {parts[:6]}")
    # bridges first: their decks clear trees off the cells under them
    objs, binfo = bridges(deck, b, n, h, cell, a.deck_t, a.rail_h, log)
    dk = deck_cells(objs, b, n) if objs else np.zeros((n, n), bool)
    def remask(m):
        o = m.copy(); o[w] = 3; o[dk & (o >= 8)] = 0; return o
    n4 = remask(m4); n6 = remask(m6) if m6 is not None else None
    # trees left within 1 m of the water whose canopy top is IN the channel are gone with it; report what changed
    changed = dict(tree_cells_to_water=int(((m4 >= 8) & w).sum()), ground_cells_to_water=int(((m4 == 0) & w).sum()), tree_cells_off_deck=int((dk & (m4 >= 8) & ~w).sum()))
    # the wide layer: inside the box from the box's water, outside from the depth-8 sample
    LA = wb['north'] - (np.arange(wn) + .5) * (wb['north'] - wb['south']) / wn; LO = wb['west'] + (np.arange(wn) + .5) * (wb['east'] - wb['west']) / wn
    r = ((b['north'] - LA[:, None]) / (b['north'] - b['south']) * n); c = ((LO[None, :] - b['west']) / (b['east'] - b['west']) * n)
    inbox = (r >= 0) & (r < n) & (c >= 0) & (c < n)
    share = ndimage.uniform_filter(w.astype(float), 4)   # share of water in the 4 x 4 cells round each point
    ri = np.clip(r, 0, n - 1).astype(int); ci = np.clip(c, 0, n - 1).astype(int)
    box_w = inbox & (share[ri, ci] >= 0.3); box_c = np.where(box_w, cls[ri, ci], 0)
    box_c = np.where(box_w & (box_c == 0), 1, box_c)
    nl = wl.copy()
    if not a.box_only:
        creek = wide_creek(sv, wb, wn, box_c, log, W, a.photo_m)
        nl[creek & ~inbox & (nl == 0)] = 1
    nl[box_w & (nl == 0)] = box_c[box_w & (nl == 0)]
    # files
    stem = row['id'].replace('gtd15_', 'gtd_')
    # mask v6 must keep its name ending: the app reads the format from it (src/services/terrain.ts detailLeaf: *_mask_v6.png
    # = v6; any other name is read as v5 and draws most trees bare), so the new stem goes before it
    p4, p6, pw, pb = (f"{F}/{stem}_mask{a.suffix}.png", f"{F}/{stem}{a.suffix.replace('_v4', '')}_mask_v6.png", f"{F}/{stem}_water{a.suffix}.png", f"{F}/{stem}_bld.json")
    write_mask(p4, n4)
    if n6 is not None: write_mask(p6, n6)
    write_bytes(pw, nl)
    if objs: open(pb, 'w').write(json.dumps(dict(v=1, note='Road bridge deck(s) from the laser bridge class (17): deck slab open below, low railing', b=objs), separators=(',', ':')))
    for p, ref in ((p4, n4), (pw, nl)) + (((p6, n6),) if n6 is not None else ()):
        assert np.array_equal(np.array(Image.open(p)), ref), p
    # pictures: the whole box, and 300 m round the stand spot
    st = rc_of(b, n, *a.stand) if a.stand else None
    look(f"{W}/look/{stem}_water_box.png", h, n6 if n6 is not None else n4, st)
    if st:
        k = 150; cr = (st[0] - k, st[0] + k, st[1] - k, st[1] + k)
        look(f"{W}/look/{stem}_water_stand.png", h, n6 if n6 is not None else n4, st, cr)
        img = (np.clip(nb[..., :3], 0, 1) * 255).astype(np.float64)
        e = w & ~ndimage.binary_erosion(w); img[w] = img[w] * 0.5 + np.array([20, 80, 230]) * 0.5; img[e] = (255, 255, 0); img[dk] = (255, 140, 0)
        Image.fromarray(img[cr[0]:cr[1], cr[2]:cr[3]].astype(np.uint8)).resize((900, 900), Image.NEAREST).save(f"{W}/look/{stem}_water_photo.png")
    wi = np.full((wn, wn, 3), 235, np.uint8); wi[nl == 1] = (30, 90, 200); wi[nl == 2] = (120, 180, 240); wi[(nl > 0) & (wl == 0)] = (230, 40, 40)
    Image.fromarray(wi).save(f"{W}/look/{stem}_water_wide.png")
    # numbers
    near = lambda m, rr, cc: float(np.min(np.hypot(*(np.array(np.nonzero(m)) - np.array([[rr], [cc]]))))) if m.any() else None
    newrow = dict(mask_path=os.path.basename(p4), mask_bytes=os.path.getsize(p4), water_path=os.path.basename(pw), water_bytes=os.path.getsize(pw),
                  leaf_mask_path=os.path.basename(p6) if n6 is not None else row.get('leaf_mask_path'), leaf_mask_bytes=os.path.getsize(p6) if n6 is not None else row.get('leaf_mask_bytes'),
                  buildings_path=os.path.basename(pb) if objs else None, buildings_bytes=os.path.getsize(pb) if objs else None)
    rep = dict(id=row['id'], new=newrow, box_water=dict(m2=int(w.sum() * cell * cell), moving_m2=int((cls == 1).sum()), still_m2=int((cls == 2).sum()), parts=parts[:8]),
               seeds=sorted(patches, key=lambda p: -p['m2'])[:20], mask_changes=changed, bridges=binfo,
               wide=dict(before_ha=round(float((wl > 0).sum()) * 16 / 1e4, 1), after_ha=round(float((nl > 0).sum()) * 16 / 1e4, 1), added_ha=round(float(((nl > 0) & (wl == 0)).sum()) * 16 / 1e4, 1)),
               stand=dict(latlng=a.stand, nearest_water_m=near(w, *st) if st else None, height_m=round(float(h[st]), 2) if st else None))
    json.dump(rep, open(f"{W}/row.json", 'w'), indent=1)
    log(json.dumps({k: v for k, v in rep.items() if k not in ('seeds',)}, indent=1))


def sql(a):
    rep = json.load(open(f"{a.work}/row.json")); nr = rep['new']; F = f"{a.work}/files"
    cols = ['mask_path', 'mask_bytes', 'leaf_mask_path', 'leaf_mask_bytes', 'water_path', 'water_bytes', 'buildings_path', 'buildings_bytes']
    q = lambda v: 'null' if v is None else repr(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
    files = [nr[k] for k in ('mask_path', 'leaf_mask_path', 'water_path', 'buildings_path') if nr.get(k) and os.path.exists(f"{F}/{nr[k]}")]
    total = sum(os.path.getsize(f"{F}/{f}") for f in files); bw = rep['box_water']; br = rep['bridges']
    bl = '; '.join(f"deck {x['length_drawn_m']} x {x['width_m']} m (laser {x['length_laser_m']} m), top {x['top_m']} m, bearing {x['bearing_deg']}" for x in br).replace(';', ',')
    body = f"""-- 3D sun view: Cottonwood Creek as water and the Highlands road bridge in the close-up box {rep['id']} ({a.date}, NOT applied).
-- Before applying: upload these {len(files)} files ({total:,} bytes) to the public bucket `terrain`: {', '.join(files)}.
-- Why: the 2022 park survey has no water-class point on Cottonwood Creek, so tools/sun3d/lidar/build_detail.py found no water
-- in this box (the creek drew as snow) and the box had no bridge. Shot 'highlands bridge' stands on the east bank at
-- {rep['stand']['latlng'][0]}, {rep['stand']['latlng'][1]} looking ~308 deg at the bridge.
-- Built by tools/sun3d/lidar/build_detail_water.py from the box's own files (heights, colour and tree files unchanged):
--   water = the survey's empty cells (water swallows the laser), in patches confirmed by the NAIP photo's near-infrared and
--   lying at the local low, gaps under the bridge and under crowns closed: {bw['m2']:,} m2 in the box ({bw['moving_m2']:,} moving, {bw['still_m2']:,} still),
--   class 3 in mask v4 and mask v6 (tree cells over the channel are water now), the wide layer + {rep['wide']['added_ha']} ha of creek (moving).
--   buildings_path: {bl or 'none'}, a deck slab open below with a low railing (laser bridge class 17).
-- The NAIP photo (19 Jul 2022) sits up to ~20 m off the survey (24 Sep 2022) here, so it only confirms the water, it does not
-- outline it; the box's colour file (NAIP-based) is unchanged.
-- Older app builds read the same columns: they get the water too (the bridge needs the buildings file reader, in every
-- build since the Faroes colour page, 13 Nov 2026). Undo: set the four pairs back to the old names / bytes
-- (gtd_jenny_lake_2_mask_v4.png 714815, gtd_jenny_lake_2_mask_v6.png 596866, gtd_jenny_lake_2_water_v4.png 5390, buildings null).
update public.terrain_detail_regions_v4 set {', '.join(f'{c} = {q(nr.get(c))}' for c in cols)}
where id = {q(rep['id'])};
"""
    assert 'drop' not in body.lower() and 'delete from' not in body.lower()
    open(a.migration, 'w').write(body); log('wrote', a.migration)
    with open(f"{a.work}/upload.txt", 'w') as f:
        for x in files:
            p = f"{F}/{x}"; f.write(f"{x}\t{os.path.getsize(p)}\t{hashlib.sha256(open(p, 'rb').read()).hexdigest()}\n")
    log(open(f"{a.work}/upload.txt").read())


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('cmd', choices=['build', 'sql']); ap.add_argument('work')
    ap.add_argument('--row', help="the box's row (terrain_detail_regions_v4) as JSON"); ap.add_argument('--files', help="folder holding the box's current files")
    ap.add_argument('--cache', help='survey cache folder (EPT nodes)'); ap.add_argument('--project', default='WY_GrandTetonNP_1_D22')
    ap.add_argument('--max-depth', type=int, default=10); ap.add_argument('--min-m2', type=float, default=20.0); ap.add_argument('--close-m', type=float, default=6.0); ap.add_argument('--photo-m', type=float, default=40.0)
    ap.add_argument('--deck-t', type=float, default=0.6); ap.add_argument('--rail-h', type=float, default=0.7)
    ap.add_argument('--stand', type=lambda s: tuple(float(v) for v in s.split(',')), help='lat,lng (pictures and the nearest water)')
    ap.add_argument('--suffix', default='_v4w'); ap.add_argument('--box-only', action='store_true', help='the wide layer gains only the box part of the creek')
    ap.add_argument('--migration'); ap.add_argument('--date', default='23 Nov 2026')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    {'build': build, 'sql': sql}[a.cmd](a)


if __name__ == '__main__': main()
