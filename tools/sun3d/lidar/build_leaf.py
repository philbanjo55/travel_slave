#!/usr/bin/env python3
"""3D sun view, Grand Teton trees review (15 Nov 2026): which surveyed trees are bare in late December, and each tree's
own size, for the page's tree styles A (shapes) and B (cloud) (tools/sun3d/app_view.js, 'Trees as trees').

  build_leaf.py boxes <work> --rows <detail rows json> --files <dir with the *_mask_v4.png>    masks with the bare bit
  build_leaf.py tiles <work> --rows <detail rows json> --files <dir> --canopy <canopy work dir>  park-wide tiles, v2
  build_leaf.py sizes <work> --rows <detail rows json> --files <dir>                             crown width / height table
  build_leaf.py train <work> --rows <detail rows json> --files <dir>                             refit the tree model (prints it)
  build_leaf.py sql   <work> --out-sql <file>                                                      the (draft) migration

Needs: pip install numpy scipy pillow tifffile imagecodecs pyproj requests; the colour builder's caches
(tools/sun3d/teton_colour/build_teton_colour.py, <work>/cache): Sentinel-2 and NAIP are read through it.

Trees: the survey's canopy height in the laser boxes' masks (1 m; 8 + height / 0.2 m), cut into single trees: a top is
a cell highest (after a 0.7 m smoothing) within a radius growing with height (1 m at 4 m, 2.4 m at 20 m, 3.5 m from
32 m), a crown is grown from its top by watershed and never reaches farther than 0.8 x the tree's height. The page does
the same in JS (segTrees); this is the reference it is measured against.

Bare or evergreen (the survey is from summer, leaves on): per tree, from
  - the Sentinel-2 picture of 30 Dec 2025 (10 m green, B03): how much the canopy darkens the snow around it,
    e = (open snow nearby - seen) / (canopy cover x (open snow - 0.02)); an evergreen crown hides the snow;
  - the NAIP summer photo (0.6 m, July 2022, RGB + near infrared) over the crown: broadleaf crowns are much brighter in
    near infrared and in visible light than conifer crowns.
  A logistic model on those (e, NIR, visible, NDVI), fitted on trees whose kind is known: the planted cottonwoods of
  Mormon Row (T.A. Moulton box, bare) against the lodgepole / spruce-fir forest of the Jenny Lake and Taggart boxes
  (evergreen). Trees under 4 m (willow thickets, young conifers) count as bare from p > 0.3.
Mask v5: a tree cell's byte = 8 + 2 x round(height / 0.4 m) + 1 if bare (the page reads it with detail.leaf = true; an
older page reads 0.2 m higher or lower heights, nothing else).
Park-wide tiles v2 (gtl_* / gtll_*): as build_canopy.py's, with 128 = bare; lod 1: 128 bare + (cells - 1) x 32 +
height / step (1..31, to 62 m). The bare call there is a second model on 7 m cells (NAIP averaged to 7 m + the winter
picture), fitted on the box trees' calls of the cells inside the boxes.
"""
import argparse, json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'teton_colour'))
import build_detail as bd   # noqa: E402
import build_teton_colour as tc   # noqa: E402

MODEL = {"mu": [1.0237287959635801, 1.3082069183143494, 0.9366943252403247, 0.16857996372356365], "sd": [0.3340671842887291, 0.3749338165056496, 0.2723237060542778, 0.13148074127729487],
         "w": [-0.7036476307825519, 2.7803390039423164, 2.522551645974452, 0.24046951040600073], "b": -5.837981451936919, "which": ["e", "nir", "vis", "ndvi"]}
DARK = 0.02
KNOWN_BARE = ['t_a_moulton']; KNOWN_EVER = ['jenny_lake_2', 'taggart_bradley_lakes_2']


# ------------------------------------------------------------------ trees from the canopy grid
def disc(rad):
    k = int(math.ceil(rad)); y, x = np.mgrid[-k:k + 1, -k:k + 1]; return (x * x + y * y) <= rad * rad + 1e-6


def win_r(Hs, bare=None):
    """The search radius (m) for a top: a conifer's narrow crown, or (bare=True cells) a broadleaf's wide one."""
    r = np.clip(0.6 + 0.09 * Hs, 1.0, 3.5)
    return r if bare is None else np.where(bare, np.clip(1.0 + 0.18 * Hs, 1.5, 6.0), r)


def segment(H, cell=1.0, min_h=2.0, bare=None):
    tree = H > 0
    Hs = np.where(tree, nd.gaussian_filter(H, 0.7 / cell), 0)
    tops = np.zeros(H.shape, bool); R = win_r(Hs, bare) / cell
    for rad in np.arange(1.0, 6.01, 0.5) / cell:
        mx = nd.maximum_filter(Hs, footprint=disc(rad), mode='constant')
        tops |= (np.abs(R - rad) <= 0.25 / cell + 1e-6) & (Hs >= mx) & (Hs >= min_h) & tree
    lab, nt = nd.label(tops, structure=np.ones((3, 3)))
    if nt == 0: return None
    idx = nd.maximum_position(Hs, lab, range(1, nt + 1))
    markers = np.zeros(H.shape, np.int32)
    for i, (r, c) in enumerate(idx): markers[r, c] = i + 1
    markers[~tree] = -1
    cost = np.where(tree, 255 - np.clip(np.round(H / 0.2), 0, 254), 255).astype(np.uint8)
    ws = nd.watershed_ift(cost, markers, structure=np.ones((3, 3), int)); ws[~tree] = 0; ws[ws < 0] = 0
    tr = np.array(idx); th = H[tr[:, 0], tr[:, 1]]
    rr, cc = np.nonzero(ws > 0); lbl = ws[rr, cc] - 1
    far = np.hypot(rr - tr[lbl, 0], cc - tr[lbl, 1]) * cell > np.maximum(2.0, 0.8 * th[lbl]); ws[rr[far], cc[far]] = 0
    area = np.bincount(ws.ravel(), minlength=nt + 1)[1:] * cell * cell
    return dict(r=tr[:, 0], c=tr[:, 1], h=np.asarray(nd.maximum(H, ws, range(1, nt + 1)), np.float32), area=area, cw=2 * np.sqrt(area / math.pi), lab=ws)


def read_mask(path):
    m = np.array(Image.open(path)); return m, np.where(m >= 8, (m.astype(np.float32) - 8) * 0.2, 0).astype(np.float32)


def box_mask_path(files, r):
    p = os.path.join(files, r['mask_path'])
    if not os.path.exists(p): sys.exit('no mask ' + p)
    return p


def short(bid): return bid.replace('gtd15_', '').replace('gtd_', '')


# ------------------------------------------------------------------ the winter picture (Sentinel-2 B03, 10 m)
class Green:
    def __init__(s, work):
        g = tc.latlng_grid(tc.REGION, 64, 64); e, n = tc.TO_UTM.transform(g[0], g[1]); m = 400
        s.c0, s.r0 = int((e.min() - m - tc.X0) // 10), int((tc.Y0 - n.max() - m) // 10)
        c1, r1 = int((e.max() + m - tc.X0) // 10) + 1, int((tc.Y0 - n.min() + m) // 10) + 1
        cache = os.path.join(work, 'cache', 's2'); b = None
        for sid, url, saz, sel in tc.SCENES:   # 30 Dec 2025, 11 Jan 2026 where it has nothing
            x = tc.cog_window(cache, url + 'B03.tif', 0, s.r0, r1, s.c0, c1)[..., 0].astype(np.float32) * 1e-4
            b = x if b is None else np.where(b > 0, b, x)
        s.B = b

    def e_on(s, lat, lng, tree):
        """e per cell of a lat / lng grid (2-D arrays) where `tree` (same shape, 0..1) is the canopy there."""
        e_, n_ = tc.TO_UTM.transform(lng, lat)
        ri = np.round((tc.Y0 - n_) / 10 - 0.5 - s.r0).astype(np.int64); ci = np.round((e_ - tc.X0) / 10 - 0.5 - s.c0).astype(np.int64)
        ri0, ci0 = ri.min(), ci.min(); hh, ww = ri.max() - ri0 + 1, ci.max() - ci0 + 1
        pid = (ri - ri0) * ww + (ci - ci0)
        cnt = np.bincount(pid.ravel(), minlength=hh * ww); tcn = np.bincount(pid.ravel(), weights=tree.ravel().astype(np.float64), minlength=hh * ww)
        cov = nd.gaussian_filter((tcn / np.maximum(cnt, 1)).reshape(hh, ww), 0.6)   # the sensor's blur
        obs = np.zeros((hh, ww), np.float32)   # (a tile at the grid's edge reaches past the picture: nothing there)
        a0, b0, a1, b1 = max(ri0, 0), max(ci0, 0), min(ri0 + hh, s.B.shape[0]), min(ci0 + ww, s.B.shape[1])
        if a1 > a0 and b1 > b0: obs[a0 - ri0:a1 - ri0, b0 - ci0:b1 - ci0] = s.B[a0:a1, b0:b1]
        nodata = obs <= 0
        open_ = (cov < 0.03) & ~nodata; k = 21
        num = nd.uniform_filter(np.where(open_, obs, 0), k); den = nd.uniform_filter(open_.astype(np.float32), k)
        ref = np.where(den > 0.05, num / np.maximum(den, 1e-6), np.nan)
        if np.isnan(ref).any(): ref = ref[tuple(nd.distance_transform_edt(np.isnan(ref), return_distances=False, return_indices=True))]
        e = np.where(nodata, 1.0, (ref - obs) / (np.maximum(cov, 0.08) * np.maximum(ref - DARK, 0.05)))   # no picture: taken as evergreen-dark (the summer photo decides)
        return np.clip(e, -0.5, 2.0)[ri - ri0, ci - ci0]


def grid_latlng(r, n):
    lat = r['north'] - (np.arange(n) + .5) / n * (r['north'] - r['south']); lng = r['west'] + (np.arange(n) + .5) / n * (r['east'] - r['west'])
    LO, LA = np.meshgrid(lng, lat); return LA, LO


def feats_box(work, green, r, H, s):
    n = r['n']; A = tc.naip(work, dict(id=r['id'].replace('gtd15_', 'gtd_'), north=r['north'], south=r['south'], west=r['west'], east=r['east']), n, n) * 255
    lab = s['lab']; ids = np.arange(1, len(s['h']) + 1)
    f = [np.asarray(nd.mean(A[..., i], lab, ids)) for i in range(4)]
    LA, LO = grid_latlng(r, n); E = green.e_on(LA, LO, (H > 0).astype(np.float32))
    e = np.asarray(nd.mean(E, lab, ids))
    return np.stack([np.clip(e, -0.5, 2.0), f[3] / 100, (f[0] + f[1] + f[2]) / 300, (f[3] - f[0]) / np.maximum(f[3] + f[0], 1)], 1)


def fit(X, y, l2=1e-3, it=3000, balance=False):
    mu, sd = X.mean(0), X.std(0) + 1e-6; Z = (X - mu) / sd; w = np.zeros(Z.shape[1]); b = 0.0
    sw = np.where(y > .5, .5 / max(y.mean(), 1e-6), .5 / max(1 - y.mean(), 1e-6)) if balance else np.ones(len(y))   # each class weighs the same
    for _ in range(it):
        p = 1 / (1 + np.exp(-(Z @ w + b))); g = (p - y) * sw; w -= 0.5 * (Z.T @ g / len(y) + l2 * w); b -= 0.5 * g.mean()
    return dict(mu=mu.tolist(), sd=sd.tolist(), w=w.tolist(), b=float(b))


def prob(m, X): return 1 / (1 + np.exp(-(((X - np.array(m['mu'])) / np.array(m['sd'])) @ np.array(m['w']) + m['b'])))


def bare_of(p, h): return np.where(h < 4, p > 0.3, p > 0.5)


def each_box(a):
    rows = [r for r in json.load(open(a.rows)) if r.get('parent') == 'grand_teton' and r.get('mask_path')]
    green = Green(a.work)
    for r in rows:
        m, H = read_mask(box_mask_path(a.files, r)); s = segment(H)
        yield r, m, H, s, feats_box(a.work, green, r, H, s)


def train(a):
    Xs, ys = [], []
    for r, m, H, s, X in each_box(a):
        k = s['h'] >= 4; b = short(r['id'])
        if b in KNOWN_BARE: Xs.append(X[k]); ys.append(np.ones(int(k.sum())))
        if b in KNOWN_EVER:
            X2 = X[k]; i = np.random.default_rng(0).choice(len(X2), min(len(X2), 1500), replace=False); Xs.append(X2[i]); ys.append(np.zeros(len(i)))
    X = np.concatenate(Xs); y = np.concatenate(ys); mm = fit(X, y); p = prob(mm, X)
    print(json.dumps(mm)); print('bare called bare', round(float((p[y == 1] > .5).mean()), 3), 'evergreen called evergreen', round(float((p[y == 0] <= .5).mean()), 3))


def boxes(a):
    os.makedirs(a.out, exist_ok=True); out = []
    for r, m, H, s, X in each_box(a):
        p = prob(MODEL, X); bare = bare_of(p, s['h'])
        cb = np.zeros(len(bare) + 1, bool); cb[1:] = bare; cell_bare = cb[s['lab']]
        # the trees again, a broadleaf's crown searched wider; a tree is bare when most of its crown cells are
        s2 = segment(H, bare=cell_bare); ids = np.arange(1, len(s2['h']) + 1)
        bare2 = np.asarray(nd.mean(cell_bare.astype(np.float32), s2['lab'], ids)) > 0.5
        k = np.clip(np.round(H / 0.4), 1, 123).astype(np.int32)
        m5 = np.where(m >= 8, 8 + 2 * k + cell_bare.astype(np.int32), m).astype(np.uint8)
        name = r['mask_path'].replace('_mask_v4.png', '_mask_v5.png'); path = os.path.join(a.out, name); bd.write_mask(path, m5)
        st = dict(id=r['id'], leaf_mask_path=name, leaf_mask_bytes=os.path.getsize(path), trees=int(len(bare2)), trees_4m=int((s2['h'] >= 4).sum()),
                  bare_4m=round(float(bare2[s2['h'] >= 4].mean()), 3), bare_cells=round(float(cell_bare[H > 0].mean()), 3))
        out.append(st); print(json.dumps(st), flush=True)
        np.savez_compressed(os.path.join(a.work, f'trees_{short(r["id"])}.npz'), r=s2['r'], c=s2['c'], h=s2['h'], cw=s2['cw'], area=s2['area'], bare=bare2)
        np.savez_compressed(os.path.join(a.work, f'cells_{short(r["id"])}.npz'), bare=np.packbits(cell_bare))
    json.dump(out, open(os.path.join(a.work, 'leaf_rows.json'), 'w'), indent=1)


def sizes(a):
    """Crown width over height of the box trees, evergreen / bare, by height band (sets the page's WIDE_EVER / WIDE_BARE)."""
    allh, allw, allb = [], [], []
    for p in sorted(os.listdir(a.work)):
        if p.startswith('trees_') and p.endswith('.npz'):
            z = np.load(os.path.join(a.work, p)); allh.append(z['h']); allw.append(z['cw']); allb.append(z['bare'])
    h, w, b = np.concatenate(allh), np.concatenate(allw), np.concatenate(allb)
    print('band m | evergreen n, cw/h median (q25-q75), cw median m | bare n, cw/h median (q25-q75), cw median m')
    for lo, hi in ((2, 4), (4, 8), (8, 15), (15, 25), (25, 60), (8, 60)):
        k = (h >= lo) & (h < hi); row = [f'{lo}-{hi}']
        for kind in (False, True):
            q = k & (b == kind); x = w[q] / h[q]
            row.append(f"{int(q.sum())} {np.median(x):.2f} ({np.percentile(x, 25):.2f}-{np.percentile(x, 75):.2f}) {np.median(w[q]):.1f}" if q.sum() else '0')
        print(' | '.join(row))


def tiles(a):
    """Park-wide tiles with the bare bit. The 7 m model: features of each canopy cell (NAIP averaged to 7 m and the
    winter picture's e on the 7 m canopy), labels = the box trees' call for the 7 m cells inside the boxes (majority of
    the tree cells), fitted leaving nothing out; the fit's agreement per box (box left out) is printed."""
    sys.path.insert(0, HERE); import build_canopy as bc   # noqa
    ca = argparse.Namespace(work=a.canopy, min_h=4.0, min_multi=0.5, max_elev=3300, max_slope=55)
    can, n = bc.load_can(ca); N, M = can.shape; green = Green(a.work)
    NF = 8; feats = np.zeros((N, M, NF), np.float16); have = np.zeros((N, M), bool)
    sm = lambda x: nd.uniform_filter(x, 5, mode='nearest')   # the stand around (35 m): less of the ground between crowns
    for tr in range(bc.TR):
        for tc_ in range(bc.TC):
            t = can[tr * n:(tr + 1) * n, tc_ * n:(tc_ + 1) * n]
            if not (t > 0).any(): continue
            north, south, west, east = bc.tile_box(tr, tc_); box = dict(id=f'gtc_{tr}_{tc_}', north=north, south=south, west=west, east=east, n=n)
            A = tc.naip(a.work, box, n, n) * 255
            LA, LO = grid_latlng(box, n); E = green.e_on(LA, LO, (t > 0).astype(np.float32))
            sl = (slice(tr * n, (tr + 1) * n), slice(tc_ * n, (tc_ + 1) * n))
            Ec, nir, vis = np.clip(E, -0.5, 2.0), A[..., 3] / 100, A[..., :3].mean(-1) / 100
            feats[sl] = np.stack([Ec, nir, vis, (A[..., 3] - A[..., 0]) / np.maximum(A[..., 3] + A[..., 0], 1), np.log(np.maximum(t, 2)), sm(Ec), sm(nir), sm(vis)], -1); have[sl] = True
            print('features', box['id'], flush=True)
    # labels from the boxes
    rows = [r for r in json.load(open(a.rows)) if r.get('parent') == 'grand_teton' and r.get('mask_path')]
    X, y, g = [], [], []
    for bi, r in enumerate(rows):
        f = os.path.join(a.work, f'cells_{short(r["id"])}.npz')
        if not os.path.exists(f): continue
        m, H = read_mask(box_mask_path(a.files, r)); nn = r['n']
        cell = np.unpackbits(np.load(os.path.join(a.work, f'cells_{short(r["id"])}.npz'))['bare'])[:nn * nn].reshape(nn, nn).astype(float)
        LA, LO = grid_latlng(r, nn)
        R_ = ((bc.NORTH - LA) / (bc.NORTH - bc.SOUTH) * N).astype(np.int64); C_ = ((LO - bc.WEST) / (bc.EAST - bc.WEST) * M).astype(np.int64)
        idx = (R_ * M + C_)[H > 0]; vb = cell[H > 0]
        tot = np.bincount(idx, minlength=N * M); bb = np.bincount(idx, weights=vb, minlength=N * M)
        sel = np.nonzero((tot >= 8) & (can.ravel() > 0))[0]
        X.append(feats.reshape(-1, NF)[sel].astype(np.float32)); y.append((bb[sel] / tot[sel] > 0.5).astype(float)); g.append(np.full(len(sel), bi))
    X, y, g = np.concatenate(X), np.concatenate(y), np.concatenate(g)
    np.savez_compressed(os.path.join(a.work, 'train7.npz'), X=X, y=y, g=g)
    print('7 m cells with a box call', len(y), 'bare share', round(float(y.mean()), 3))
    # each class weighs the same in the fit; the cut is the one that makes the left-out boxes' bare share come out right overall
    P_out = np.zeros(len(y))
    for bi in np.unique(g):   # leave one box out
        tr_ = g != bi; mm = fit(X[tr_], y[tr_], balance=True); P_out[~tr_] = prob(mm, X[~tr_])
    cut = float(np.quantile(P_out, 1 - y.mean()))
    for bi in np.unique(g):
        k = g == bi; p = P_out[k] > cut
        print(f'  {short(rows[bi]["id"]):30s} cells {int(k.sum()):6d} bare {float(y[k].mean()):.2f} called bare {float(p.mean()):.2f} agree {float((p == (y[k] > .5)).mean()):.3f}')
    yb = y > .5; pb = P_out > cut
    print('leave-one-box-out: agree', round(float((pb == yb).mean()), 3), '; bare found', round(float(pb[yb].mean()), 3), '; evergreen kept', round(float((~pb[~yb]).mean()), 3), '; cut', round(cut, 3))
    mm = fit(X, y, balance=True); mm['cut'] = cut; json.dump(mm, open(os.path.join(a.work, 'model7.json'), 'w'))
    P = np.zeros((N, M), np.float32); P[have] = prob(mm, feats[have].astype(np.float32))
    bare = (P > cut) & (can > 0)
    print('park: tree cells', int((can > 0).sum()), 'called bare', round(float(bare[can > 0].mean()), 3))
    os.makedirs(a.out, exist_ok=True)
    v = np.clip(np.round(can / bc.STEP_M), 0, 127).astype(np.uint8); v[(can > 0) & (v == 0)] = 1; v = v | np.where(bare, 128, 0).astype(np.uint8)
    tr4 = can > 0; cnt4 = tr4.reshape(N // 2, 2, M // 2, 2).sum((1, 3)); hmax = can.reshape(N // 2, 2, M // 2, 2).max((1, 3))
    b4 = bare.reshape(N // 2, 2, M // 2, 2).sum((1, 3)) * 2 > cnt4
    v1 = np.where(cnt4 > 0, (cnt4 - 1) * 32 + np.clip(np.round(hmax / bc.STEP_M), 1, 31) + np.where(b4, 128, 0), 0).astype(np.uint8)
    rows_out = []; up = []
    for tr in range(bc.TR):
        for tc_ in range(bc.TC):
            t = v[tr * n:(tr + 1) * n, tc_ * n:(tc_ + 1) * n]; cnt = int((t > 0).sum())
            if cnt == 0: continue
            north, south, west, east = bc.tile_box(tr, tc_)
            for lod, arr, nn2, pre in ((0, t, n, 'gtl'), (1, v1[tr * n // 2:(tr + 1) * n // 2, tc_ * n // 2:(tc_ + 1) * n // 2], n // 2, 'gtll')):
                name = f'{pre}_{tr}_{tc_}.png'; path = os.path.join(a.out, name); bd.write_bytes(path, arr); b = os.path.getsize(path)
                rows_out.append(dict(id=f'{"gtc" if lod == 0 else "gtcc"}_{tr}_{tc_}', leaf_path=name, leaf_bytes=b)); up.append(f'{path}\t{name}\t{b}')
    open(os.path.join(a.out, 'upload_leaf.txt'), 'w').write('# local path\tpublished name (bucket terrain)\tbytes\n' + '\n'.join(up) + '\n')
    json.dump(rows_out, open(os.path.join(a.work, 'leaf_tiles.json'), 'w'), indent=1)
    print(len(rows_out), 'files,', round(sum(r['leaf_bytes'] for r in rows_out) / 1e6, 2), 'MB')


def sql(a):
    """The migration (draft: apply only after the files in upload_leaf.txt / the masks are in bucket terrain)."""
    boxes = json.load(open(os.path.join(a.work, 'leaf_rows.json'))); tiles = json.load(open(os.path.join(a.work, 'leaf_tiles.json')))
    q = lambda v: "'" + str(v).replace("'", "''") + "'"
    out = ["""-- 3D sun view, Grand Teton trees review (15 Nov 2026; tools/sun3d/lidar/build_leaf.py). DRAFT: not applied.
-- Which surveyed trees are bare in late December, for the page's tree styles A (shapes) / B (soft dots)
-- (tools/sun3d/app_view.js 'Trees as trees'; the app reads them only when services/terrain.ts TREE_STYLE is not 'dots').
--   terrain_detail_regions_v4.leaf_mask_path: the box's mask again, a tree cell = 8 + 2 x round(height / 0.4 m) + 1 if bare;
--   terrain_tree_tiles.leaf_path: the park-wide tile again, 128 = bare (lod 1: 128 bare + (trees - 1) x 32 + height / step_m).
-- New columns only: older app builds keep reading mask_path / path (and never see the bare bit).
-- Before applying: upload the files (bucket terrain): the 16 *_mask_v5.png and the gtl_* / gtll_* tiles.
alter table public.terrain_detail_regions_v4 add column if not exists leaf_mask_path text, add column if not exists leaf_mask_bytes integer;
alter table public.terrain_tree_tiles add column if not exists leaf_path text, add column if not exists leaf_bytes integer;
"""]
    out.append('update public.terrain_detail_regions_v4 t set leaf_mask_path = v.p, leaf_mask_bytes = v.b from (values\n' + ',\n'.join(f"  ({q(b['id'])}, {q(b['leaf_mask_path'])}, {b['leaf_mask_bytes']})" for b in boxes) + '\n) v(id, p, b) where t.id = v.id;\n')
    out.append('update public.terrain_tree_tiles t set leaf_path = v.p, leaf_bytes = v.b from (values\n' + ',\n'.join(f"  ({q(t['id'])}, {q(t['leaf_path'])}, {t['leaf_bytes']})" for t in tiles) + '\n) v(id, p, b) where t.id = v.id;\n')
    open(a.out_sql, 'w').write('\n'.join(out)); print('wrote', a.out_sql)


def main():
    p = argparse.ArgumentParser(); p.add_argument('cmd'); p.add_argument('work')
    p.add_argument('--rows'); p.add_argument('--files'); p.add_argument('--out'); p.add_argument('--canopy'); p.add_argument('--out-sql', dest='out_sql')
    a = p.parse_args(); os.makedirs(a.work, exist_ok=True); a.out = a.out or os.path.join(a.work, 'files')
    {'boxes': boxes, 'tiles': tiles, 'sizes': sizes, 'train': train, 'sql': sql}[a.cmd](a)


if __name__ == '__main__':
    main()
