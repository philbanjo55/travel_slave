"""Near features: the outlines where something nearer hides something farther (a tree band in front of the mountains,
the edge of a bench or river bank against the far valley). From a spot, each ray is walked outward; an outline is a
point that is seen while the next thing seen along that ray is much farther away (depth jump). The photo's colour
steps below the sky line are checked against those outlines: a right spot puts many outlines on photo steps, more than
chance (the step density of that column) would.
"""
import math
import numpy as np
import cv2
from terrain import stack_at, kx, KZ, R7
import camera as C


def photo_edges(path, work_w=720, K=16, min_e=0.18):
    """every clear colour step in each column (no sky test): edge_y (cols, K) full-res rows, nan padded; plus column x"""
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    H0, W0 = im.shape[:2]; s = work_w / W0
    im = cv2.resize(im, (work_w, max(8, int(round(H0 * s)))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(im[:, :, ::-1].astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    lab = cv2.GaussianBlur(lab, (0, 0), 1.0)
    h, w = lab.shape[:2]; k = 2
    Cs = np.concatenate([np.zeros((1, w, 3), np.float32), np.cumsum(lab, axis=0)], 0)
    ys = np.arange(h)
    a0 = np.clip(ys - k, 0, h); a1 = ys; b0 = np.clip(ys + 1, 0, h); b1 = np.clip(ys + 1 + k, 0, h)
    above = (Cs[a1] - Cs[a0]) / np.maximum(a1 - a0, 1)[:, None, None]; below = (Cs[b1] - Cs[b0]) / np.maximum(b1 - b0, 1)[:, None, None]
    d = above - below
    E = np.sqrt(d[:, :, 0] ** 2 + 0.5 * d[:, :, 1] ** 2 + 0.5 * d[:, :, 2] ** 2)
    En = E / (np.percentile(E, 90) + 1e-3)
    pk = (En[1:-1] >= En[:-2]) & (En[1:-1] > En[2:]) & (En[1:-1] > min_e)
    ey = np.full((w, K), np.nan, np.float32)
    for x in range(w):
        p = np.nonzero(pk[:, x])[0] + 1
        if len(p) > K: p = p[np.argsort(-En[p, x])[:K]]
        ey[x, :len(p)] = (np.sort(p) + 0.5) / s - 0.5
    X = (np.arange(w) + 0.5) / s - 0.5
    return dict(x=X, y=ey, size=(W0, H0))


def march(grids, lat, lng, eyeh, azs, trees=None, dmin=6.0, dmax=60000.0, nd=600, tree_min=8.0, ratio=1.6,
          near_min=40.0, kmax=6, chunk=256):
    """walk each ray once: bare sky line, sky line with trees, and up to kmax outlines (elevation deg, distance m)
    below the sky line where the next thing seen is at least `ratio` times farther. Trees (a tree-top grid, nan where
    none) count from tree_min out; outlines nearer than near_min are left out (too touchy to the exact spot)."""
    azs = np.asarray(azs, np.float64); d = np.geomspace(dmin, dmax, nd); k = kx(lat); drop = d * d / (2 * R7)
    A = len(azs)
    sky = np.empty(A, np.float32); skyt = np.empty(A, np.float32)
    cel = np.full((A, kmax), np.nan, np.float32); cdist = np.full((A, kmax), np.nan, np.float32)
    idx = np.arange(nd)
    for s in range(0, A, chunk):
        a = np.radians(azs[s:s + chunk])[:, None]
        la = lat + d[None] * np.cos(a) / KZ; lo = lng + d[None] * np.sin(a) / k
        h = stack_at(grids, la.ravel(), lo.ravel()).reshape(la.shape)
        el = np.arctan2(h - drop[None] - eyeh, d[None]); el = np.where(np.isnan(el), -1.0, el)
        sky[s:s + chunk] = np.degrees(el.max(1))
        if trees is not None:
            ht = trees.at(la.ravel(), lo.ravel()).reshape(la.shape)
            ht[:, d < tree_min] = np.nan
            et = np.arctan2(ht - drop[None] - eyeh, d[None]); el = np.fmax(el, np.where(np.isnan(et), -1.0, et))
        skyt[s:s + chunk] = np.degrees(el.max(1))
        cm = np.maximum.accumulate(el, 1)
        vis = el >= cm - 1e-9
        # next visible sample after i (nd when none)
        nv = np.where(vis, idx[None], nd)
        nxt = np.minimum.accumulate(nv[:, ::-1], 1)[:, ::-1]
        nxt = np.concatenate([nxt[:, 1:], np.full((nxt.shape[0], 1), nd)], 1)
        cand = vis & (nxt < nd) & (d[None] >= near_min)
        dn = d[np.minimum(nxt, nd - 1)]
        cand &= dn >= ratio * d[None]
        cand &= np.degrees(el) < np.degrees(cm[:, -1:]) - 0.02
        rr, ii = np.nonzero(cand)
        if len(rr):
            # keep the kmax with the biggest depth jump per ray
            jump = dn[rr, ii] / d[ii]
            o = np.lexsort((-jump, rr)); rr, ii = rr[o], ii[o]
            first = np.r_[0, np.nonzero(np.diff(rr))[0] + 1]
            rank = np.arange(len(rr)) - np.repeat(first, np.diff(np.r_[first, len(rr)]))
            m = rank < kmax
            cel[s + rr[m], rank[m]] = np.degrees(el[rr[m], ii[m]]); cdist[s + rr[m], rank[m]] = d[ii[m]]
    return sky, skyt, cel, cdist


def outline_score(paz, cel, q, edges, W, H, tol=3.0, step=4):
    """lift of outline points on photo steps over chance: sum(hit - p_chance) / number of frame columns sampled"""
    tol = tol * W / 1440
    sel = slice(0, len(paz), step)
    az = np.repeat(paz[sel], cel.shape[1]); el = cel[sel].ravel()
    ok = np.isfinite(el); az, el = az[ok], el[ok]
    if not len(az): return 0.0, 0
    x, y = C.project_dirs(az, el, q, W, H)
    ins = np.isfinite(x) & (x >= 0) & (x < W) & (y >= 0) & (y < H)
    x, y = x[ins], y[ins]
    if not len(x): return 0.0, 0
    ex = edges['x']; ci = np.clip(np.round((x - ex[0]) / (ex[1] - ex[0])).astype(int), 0, len(ex) - 1)
    E = edges['y'][ci]                                                   # (n, K)
    hit = np.nanmin(np.abs(E - y[:, None]), 1) <= tol
    hit = np.where(np.all(np.isnan(E), 1), False, hit)
    nE = np.isfinite(E).sum(1)
    pch = np.minimum(1.0, nE * 2 * tol / H)
    ncols = max(1, len(np.arange(len(paz))[sel]))
    return float((hit.astype(np.float32) - pch).sum() / ncols), int(len(x))


# ---------------------------------------------------------------- region classes (a cheap column render)
CLASSES = ('sky', 'tree', 'building', 'ground <150 m', 'ground 150 m-1 km', 'ground 1-5 km', 'ground > 5 km')


def class_columns(ground, lat, lng, eyeh, azs, trees=None, houses=None, dmin=4.0, dmax=60000.0, nd=500, tree_min=8.0, tree_max=800.0,
                  chunk=256):
    """per azimuth: the running highest elevation seen (rad, nondecreasing along the ray) and the class of each sample.
    A pixel at elevation e shows the first sample whose running max reaches e."""
    azs = np.asarray(azs, np.float64); d = np.geomspace(dmin, dmax, nd); k = kx(lat); drop = d * d / (2 * R7)
    A = len(azs); CM = np.empty((A, nd), np.float32); CL = np.empty((A, nd), np.int8)
    dcl = np.where(d < 150, 3, np.where(d < 1000, 4, np.where(d < 5000, 5, 6))).astype(np.int8)
    for s in range(0, A, chunk):
        a = np.radians(azs[s:s + chunk])[:, None]
        la = (lat + d[None] * np.cos(a) / KZ).ravel(); lo = (lng + d[None] * np.sin(a) / k).ravel()
        sh = (len(a), nd)
        h = stack_at(ground, la, lo).reshape(sh)
        cl = np.broadcast_to(dcl[None], sh).copy()
        if houses is not None:
            hh = houses.at(la, lo).reshape(sh); m = np.isfinite(hh) & ~(hh < h)
            h = np.where(m, hh, h); cl[m] = 2
        if trees is not None:
            ht = trees.at(la, lo).reshape(sh); ht[:, (d < tree_min) | (d > tree_max)] = np.nan   # far forest reads as hillside
            m = np.isfinite(ht) & ~(ht < h)
            h = np.where(m, ht, h); cl[m] = 1
        el = np.arctan2(h - drop[None] - eyeh, d[None]); el = np.where(np.isnan(el), -1.5, el)
        CM[s:s + chunk] = np.maximum.accumulate(el, 1); CL[s:s + chunk] = cl
    return CM, CL


def class_image(azs, CM, CL, q, W, H, gw=180):
    """class of each pixel on a gw-wide grid"""
    gh = int(round(gw * H / W))
    xs = (np.arange(gw) + 0.5) * W / gw; ys = (np.arange(gh) + 0.5) * H / gh
    X, Y = np.meshgrid(xs, ys)
    az, el = C.rays(X.ravel(), Y.ravel(), q, W, H); az = C.unwrap(az, q[0]); el = np.radians(el)
    ai = np.clip(np.round((az - azs[0]) / (azs[1] - azs[0])).astype(int), 0, len(azs) - 1)
    nd = CM.shape[1]
    # first sample whose running max reaches el (searchsorted per row via row offsets)
    flat = (CM + 10.0 * np.arange(len(azs))[:, None]).ravel()
    j = np.searchsorted(flat, el + 10.0 * ai) - ai * nd
    out = np.where(j >= nd, 0, CL[ai, np.clip(j, 0, nd - 1)])
    out = np.where((az < azs[0]) | (az > azs[-1]), -1, out)
    return out.reshape(gh, gw)


def photo_small(path, gw=180):
    im = cv2.imread(path, cv2.IMREAD_COLOR); H0, W0 = im.shape[:2]
    gh = int(round(gw * H0 / W0))
    sm = cv2.resize(im, (gw, gh), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(sm[:, :, ::-1].astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    g = cv2.cvtColor(cv2.resize(im, (gw * 4, gh * 4), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
    tex = cv2.resize(np.abs(cv2.Laplacian(g, cv2.CV_32F)), (gw, gh), interpolation=cv2.INTER_AREA)
    return dict(L=lab[:, :, 0], tex=tex / (np.percentile(tex, 90) + 1e-3), size=(W0, H0))


def eta2(cls, feat):
    """correlation ratio: share of the photo's variance explained by the model's classes"""
    m = cls >= 0
    if m.sum() < 50: return 0.0
    c = cls[m].astype(int); x = feat[m].astype(np.float64)
    n = np.bincount(c, minlength=8); s = np.bincount(c, x, minlength=8)
    mu = x.mean(); tot = ((x - mu) ** 2).sum()
    ok = n > 0
    return float((n[ok] * (s[ok] / n[ok] - mu) ** 2).sum() / max(tot, 1e-9))


def tree_corr(cls, L):
    """trees are darker than the open ground around them (snow, grass, sage): correlation between the model's tree
    pixels and the photo's darkness, over the model's land pixels; 0 when the model shows no trees there"""
    m = cls >= 1
    if m.sum() < 50: return 0.0
    t = (cls[m] == 1).astype(np.float64); x = -L[m].astype(np.float64)
    if t.sum() < 5 or t.sum() > len(t) - 5: return 0.0
    t -= t.mean(); x -= x.mean()
    return float((t * x).sum() / math.sqrt((t * t).sum() * (x * x).sum() + 1e-12))
