"""Find where a landscape photo was taken from, and how it was framed, against our own terrain.

  solve.py <photo> --rows rows.json --cache <terrain dir> --region grand_teton --stop LAT,LNG [--landmarks lm.json]
           [--radius 3000] [--out result.json] [--no-names]

Steps (no hand tuning per photo):
  1. the photo's sky line: the best sky / land boundary per column plus every other clear colour step (skyline.py);
  2. landmarks from the vision step (named peaks, buildings, a broad 'span'), looked up in gazetteer.json and snapped
     to the terrain's high point / the largest building outline;
  3. coarse search: every spot on a grid within --radius of the stop, eye 1.7 m above the ground; for each, the sky
     line of the terrain all round (0.25 deg) is compared with the photo's colour steps over lens widths 12-100 deg and
     every heading: a vote counts the columns where some step lies on the terrain's sky line (pitch from the vote);
     named landmarks must land near their pixel;
  4. refine the best few: the model sky line is drawn, each column takes the photo's step nearest to it (window
     shrinking 40 -> 5 px), and spot (east, north, eye height) is moved by a pattern search with heading / tilt /
     roll / lens fitted at every spot; buildings within 400 m are part of the model sky line;
  5. confidence: the spot is slid along the line of sight and across it, the fit redone, and the distance over which
     the fit stays within 0.5 px (or 15 %) of the best is reported in metres.
"""
import argparse, json, math, os, sys, time
import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from terrain import Terrain, horizon, stack_at, kx, KZ, R7, tree_grid  # noqa: E402
import camera as C  # noqa: E402
import skyline as SK  # noqa: E402
import contours as CT  # noqa: E402

EYE = 1.7
HFOVS = np.geomspace(12, 100, 15)
HCACHE = None   # folder for per-stop horizon tables (set by --hcache)
MU_REG = 1.0    # weight of the region match (what the model says is tree / building / near ground / far land / sky)
MU_SEARCH = 0.5  # the same inside the spot search (lighter: it steers, the sky line still leads)


# ---------------------------------------------------------------- landmarks
def load_landmarks(lm_file, T, region, grids):
    if not lm_file: return [], {}
    J = json.load(open(lm_file)); gz = json.load(open(os.path.join(HERE, 'gazetteer.json')))[region]
    out = []
    for L in J.get('landmarks', []):
        g = gz.get(L['name'])
        if g is None and L.get('lat') is not None and L.get('lng') is not None:   # a trip subject named by the look (job.py)
            gt = L.get('gtype') or 'point'
            g = dict(lat=L['lat'], lng=L['lng'], type=gt, snap={'peak': 250, 'building': 150}.get(gt, 0))
        if L.get('type') == 'span' or g is None:
            out.append(dict(L, known=g is not None, lat=g and g['lat'], lng=g and g['lng'], h=None)); continue
        lat, lng = g['lat'], g['lng']; h = None
        if g['type'] == 'peak' and g.get('snap', 0) > 0:
            r = g['snap']; n = 41; k = kx(lat)
            dN, dE = np.meshgrid(np.linspace(-r, r, n), np.linspace(-r, r, n), indexing='ij')
            m = dN ** 2 + dE ** 2 <= r * r
            la = lat + dN[m] / KZ; lo = lng + dE[m] / k; hh = stack_at(grids, la, lo)
            j = int(np.nanargmax(hh)); lat, lng, h = float(la[j]), float(lo[j]), float(hh[j])
        elif g['type'] == 'building':
            B = T.houses_near(lat, lng, g.get('snap', 150))
            if B:
                def area(b):
                    p = np.array([(la_ * KZ, lo_ * kx(lat)) for la_, lo_ in b['pts']]); x, y = p[:, 0], p[:, 1]
                    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
                b = max(B, key=area); lat, lng = b['c']
                g0 = float(stack_at(grids, np.array([lat]), np.array([lng]))[0])
                h = g0 + 0.5 * max(1.8, b['e'])
                # the building's other parts (lean-tos, wings: separate outlines within 25 m) belong to it too
                near_ = [bb for bb in B if math.hypot((bb['c'][0] - lat) * KZ, (bb['c'][1] - lng) * kx(lat)) < 25]
                corners = [(la_, lo_, h) for bb in near_ for la_, lo_ in bb['pts']]
                out.append(dict(L, known=True, lat=lat, lng=lng, h=h, gtype='building', corners=corners)); continue
        if h is None: h = float(stack_at(grids, np.array([lat]), np.array([lng]))[0]) + (2.0 if g['type'] != 'peak' else 0)
        out.append(dict(L, known=True, lat=lat, lng=lng, h=h, gtype=g['type']))
    return out, J


def lm_dirs(lms, lat, lng, eyeh):
    """azimuth / elevation of each named landmark from a spot"""
    k = kx(lat); res = []
    for L in lms:
        if L['type'] == 'span' or not L.get('known') or L.get('h') is None: res.append(None); continue
        e = (L['lng'] - lng) * k; n = (L['lat'] - lat) * KZ; d = math.hypot(e, n)
        res.append((math.degrees(math.atan2(e, n)) % 360, math.degrees(math.atan2(L['h'] - d * d / (2 * R7) - eyeh, max(d, 1))), d))
    return res


def lm_corner_dirs(L, lat, lng, eyeh):
    """azimuth / elevation of a building's outline corners from a spot"""
    k = kx(lat); out = []
    for la_, lo_, h in L['corners']:
        e = (lo_ - lng) * k; n = (la_ - lat) * KZ; d = math.hypot(e, n)
        out.append((math.degrees(math.atan2(e, n)) % 360, math.degrees(math.atan2(h - eyeh, max(d, 1)))))
    return out


def rel_x(az, yaw, fp, W):
    """image x of a direction for heading yaw (pitch and roll 0); nan when it is outside +-80 deg of the heading"""
    a = ((np.asarray(az) - yaw + 180) % 360) - 180
    return np.where(np.abs(a) < 80, W / 2 + fp * np.tan(np.radians(np.clip(a, -80, 80))), np.nan)


# ---------------------------------------------------------------- coarse search
def coarse(T, sky, lms, stop, radius, step, use_names=True, log=print, region_grids=None, extras=True, houses=None, cache_key=None):
    W, H = sky['size']
    lat0, lng0 = stop; k0 = kx(lat0)
    # positions on a grid within the radius
    n = int(radius // step)
    P = [(i * step, j * step) for i in range(-n, n + 1) for j in range(-n, n + 1) if (i * step) ** 2 + (j * step) ** 2 <= radius ** 2]
    # a named building is close to the camera: also try spots on rings round it (8 - 400 m), where it shows at its size
    if use_names and radius > 0:
        for L in lms:
            if L.get('gtype') == 'building' and L.get('known'):
                bE = (L['lng'] - lng0) * k0; bN = (L['lat'] - lat0) * KZ
                for rr_ in (8, 12, 18, 26, 36, 50, 70, 95, 130, 180, 250, 340):
                    for a_ in range(0, 360, 10 if rr_ < 100 else 6):
                        e_, n_ = bE + rr_ * math.sin(math.radians(a_)), bN + rr_ * math.cos(math.radians(a_))
                        if e_ * e_ + n_ * n_ <= radius * radius: P.append((e_, n_))
    fine = region_grids or T.stack(lat0, lng0, radius / 1000 + 25)
    merged = T.merged(lat0, lng0, radius / 1000 + 4, 10.0, fine)
    cg = ([houses] if houses is not None else []) + [merged, T.wide()]
    paz = np.arange(0, 360, 0.25)
    # columns used: ~120 across the frame; candidates per column
    xs_all = sky['x']; nc = len(xs_all); pick = np.linspace(0, nc - 1, min(120, nc)).round().astype(int)
    cx = xs_all[pick]; cy = sky['cand_y'][pick]; cw = sky['cand_w'][pick]
    # the DP sky line counts as a candidate too (weight 1) when it is not already one
    dpy = sky['y'][pick]
    cy = np.concatenate([dpy[:, None], cy], 1); cw = np.concatenate([np.where(sky['good'][pick], 1.0, 0.3)[:, None], 0.6 * cw], 1)
    for i in range(len(pick)):   # drop candidates within 6 px of the DP line (no double counting)
        close = np.abs(cy[i, 1:] - cy[i, 0]) < 6 * W / 1440
        cy[i, 1:][close] = np.nan; cw[i, 1:][close] = 0
    cw = np.where(np.isnan(cy), 0, cw); cy = np.nan_to_num(cy, nan=-1e4)
    o_ = np.argsort(cw, 1); cy = np.take_along_axis(cy, o_, 1); cw = np.take_along_axis(cw, o_, 1)   # weakest first: the strongest is written last
    if not extras:   # the photo's single best sky line only (fast: used for the full-circle search)
        cy = cy[:, :1]; cw = cw[:, :1]
    colw = cw.max(1)
    named = [L for L in lms if L['type'] != 'span' and L.get('known')] if use_names else []
    spans = [L for L in lms if L['type'] == 'span' and L.get('known')] if use_names else []
    results = []
    t0 = time.time()
    # horizon tables per spot, kept on disk per stop (the next photo filed under the same stop reuses them)
    store = {}; cfile = None
    if HCACHE and cache_key:
        cfile = os.path.join(HCACHE, cache_key + '.npz')
        if os.path.exists(cfile):
            z = np.load(cfile); store = {(int(a), int(b)): (z['prof'][i], float(z['eye'][i])) for i, (a, b) in enumerate(z['key'])}
    n_new = 0
    for pi, (dE, dN) in enumerate(P):
        lat = lat0 + dN / KZ; lng = lng0 + dE / k0
        key = (int(round(dE * 10)), int(round(dN * 10)))
        if key in store:
            prof, eyeh = store[key]
            if not np.isfinite(eyeh): continue
            prof = prof.astype(np.float32)
        else:
            g = float(stack_at(cg[-2:], np.array([lat]), np.array([lng]))[0])
            if not np.isfinite(g):
                store[key] = (np.zeros(len(paz), np.float16), float('nan')); continue
            eyeh = g + EYE
            prof = horizon(cg, lat, lng, eyeh, paz, dmin=20, nd=200)
            store[key] = (prof.astype(np.float16), eyeh); n_new += 1
        prof_ext = np.concatenate([prof, prof[:1]])
        dirs = lm_dirs(named, lat, lng, eyeh) if named else []
        sdirs = lm_dirs([dict(L, type='peak', h=0) for L in spans], lat, lng, eyeh) if spans else []
        best = None
        for hf in (HFOVS if (dirs or extras) else HFOVS[::2]):
            fp = C.fpx(hf, W); dx = cx - W / 2
            rel = np.degrees(np.arctan2(dx, fp)); cosf = fp / np.hypot(fp, dx)
            el = np.degrees(np.arctan2(-(cy - H / 2), np.hypot(fp, dx)[:, None]))       # (cols, K) at pitch 0
            # headings to test
            if dirs:
                L = named[0]; a, e_, d = dirs[0]
                y0 = a - math.degrees(math.atan2(L['x'] - W / 2, fp))
                sig = max(2.0, 0.06 * hf)
                yaws = y0 + np.arange(-sig, sig + 1e-9, 0.25)
            else:
                yaws = np.arange(0, 360, 0.5)
            # pitch bins in PIXELS (so a narrow lens is not favoured by chance): 4 px at 1440 wide
            BIN = 4.0 * W / 1440 * hf / W
            NB = int(30 / BIN) + 3
            votes = np.zeros((len(yaws), NB), np.float32)
            CH = 90 if cy.shape[1] > 1 else len(yaws)
            for y0_ in range(0, len(yaws), CH):
                ys_ = yaws[y0_:y0_ + CH]
                az = (ys_[:, None] + rel[None]) % 360                                    # (Y, cols)
                fi = az / 0.25; i0 = np.floor(fi).astype(int); fr = fi - i0
                mel = prof_ext[i0] * (1 - fr) + prof_ext[i0 + 1] * fr                    # model elevation
                off = (mel[:, :, None] - el[None]) / cosf[None, :, None]                 # implied pitch (Y, cols, K)
                b = np.round(off / BIN).astype(int) + NB // 2
                Yi = np.broadcast_to(np.arange(len(ys_))[:, None, None], b.shape)
                wv = np.broadcast_to(cw[None], b.shape)
                if b.shape[2] == 1:     # one step per column: no double counting, a plain histogram
                    for sh, f_ in ((-1, 0.6), (0, 1.0), (1, 0.6)):
                        bb = b + sh; ok = (bb >= 0) & (bb < NB) & (wv > 0)
                        votes[y0_:y0_ + CH] += np.bincount((Yi * NB + bb)[ok], weights=(wv * f_)[ok], minlength=len(ys_) * NB).reshape(len(ys_), NB)
                    continue
                # one vote per column and pitch bin (the strongest step there; candidates are sorted weakest first and
                # numpy keeps the last write); the neighbouring bins get 0.6 of it
                hit = np.zeros((len(ys_), len(cx), NB), np.float32)
                Ci = np.broadcast_to(np.arange(len(cx))[None, :, None], b.shape)
                for sh, f_ in ((-1, 0.6), (1, 0.6), (0, 1.0)):
                    bb = b + sh; ok = (bb >= 0) & (bb < NB) & (wv > 0)
                    cur = hit[Yi[ok], Ci[ok], bb[ok]]
                    hit[Yi[ok], Ci[ok], bb[ok]] = np.maximum(cur, wv[ok] * f_)
                votes[y0_:y0_ + CH] = hit.sum(1)
            votes /= colw.sum()
            # landmark agreement (x from the heading and the lens; pitch 0 approx)
            if dirs or sdirs:
                pen = np.zeros(len(yaws))
                pen_b = np.zeros(NB)
                for L, dd in zip(named, dirs):
                    near_ = L.get('gtype') == 'building'
                    # a building is close: on a 150 m grid its place in the picture is only rough, so it is a soft hint here
                    sx = (0.25 if near_ else 0.05) * W; cap = 9 if near_ else 25
                    xp = rel_x(dd[0], yaws, fp, W)
                    pen += np.where(np.isfinite(xp), np.minimum(((xp - L['x']) / sx) ** 2, cap), cap)
                    if not near_ and L.get('y') is not None:     # a named peak's height in the picture fixes the tilt
                        pb = (np.arange(NB) - NB // 2) * BIN
                        yp = H / 2 - fp * np.tan(np.radians(np.clip(dd[1] - pb, -80, 80)))
                        pen_b += np.minimum(((yp - L['y']) / (0.06 * H)) ** 2, 25)
                    if L.get('corners') and L.get('x0') is not None:
                        cd = lm_corner_dirs(L, lat, lng, eyeh)
                        cx_ = np.array([rel_x(a_, yaws, fp, W) for a_, _ in cd])          # (corners, Y)
                        bad = ~np.all(np.isfinite(cx_), 0)
                        x0_ = np.nanmin(np.where(np.isfinite(cx_), cx_, np.inf), 0); x1_ = np.nanmax(np.where(np.isfinite(cx_), cx_, -np.inf), 0)
                        pe = np.minimum(((x0_ - L['x0']) / sx) ** 2, cap) + np.minimum(((x1_ - L['x1']) / sx) ** 2, cap)
                        pen += np.where(bad, cap, pe)
                sx = 0.05 * W
                for L, dd in zip(spans, sdirs):
                    xp = rel_x(dd[0], yaws, fp, W)
                    out_ = np.maximum(0, np.maximum(L['x0'] - xp, xp - L['x1'])) / sx
                    pen += np.where(np.isfinite(xp), np.minimum(out_ ** 2, 25), 25)
                votes = votes * np.exp(-0.5 * pen)[:, None] * np.exp(-0.5 * pen_b)[None, :]
            j = int(np.argmax(votes)); yi, bi = divmod(j, NB)
            v = votes[yi, bi]
            if best is None or v > best[0]:
                # landmark pitch check: elevation of the first named peak
                best = (float(v), float(yaws[yi] % 360), float((bi - NB // 2) * BIN), float(hf))
        if best:
            results.append(dict(dE=dE, dN=dN, lat=lat, lng=lng, score=best[0], yaw=best[1], pitch=best[2], roll=0.0, hfov=best[3]))
        if pi % 400 == 0: log(f'  coarse {pi}/{len(P)} {time.time() - t0:.0f}s')
    if cfile and n_new:
        ks = list(store.keys()); os.makedirs(HCACHE, exist_ok=True)
        np.savez(cfile + '.tmp.npz', key=np.array(ks, np.int64), prof=np.stack([store[k_][0] for k_ in ks]), eye=np.array([store[k_][1] for k_ in ks]))
        os.replace(cfile + '.tmp.npz', cfile)
    results.sort(key=lambda r: -r['score'])
    return results


def distinct(res, n, min_m):
    out = []
    for r in res:
        if all(math.hypot(r['dE'] - o['dE'], r['dN'] - o['dN']) >= min_m or abs(((r['yaw'] - o['yaw'] + 180) % 360) - 180) > 10 for o in out):
            out.append(r)
        if len(out) == n: break
    return out


# ---------------------------------------------------------------- refinement
class Refiner:
    ND, DAZ = 600, 0.04          # horizon samples per ray, azimuth step (deg) while refining

    def __init__(self, T, sky, lms, stop, fine, houses=None, use_trees=True, photo=None, rtrees=None):
        self.T, self.sky, self.lms, self.stop, self.fine = T, sky, lms, stop, fine
        self.ps = photo; self.rtrees = rtrees
        self.use_trees = use_trees; self.trees = None
        self.W, self.H = sky['size']; self.houses = houses
        self.k0 = kx(stop[0])
        nc = len(sky['x']); step = max(1, nc // 240)
        self.cols = np.arange(0, nc, step)
        cy = np.concatenate([sky['y'][self.cols, None], sky['cand_y'][self.cols]], 1)
        cw = np.concatenate([np.ones((len(self.cols), 1)), sky['cand_w'][self.cols]], 1)
        self.cx = sky['x'][self.cols]; self.cy = cy; self.cw = np.where(np.isnan(cy), 0, cw)
        self.named = [L for L in lms if L['type'] != 'span' and L.get('known')]
        self.cache = {}

    def grids(self):
        return ([self.houses] if self.houses is not None else []) + self.fine

    def spot(self, dE, dN):
        return self.stop[0] + dN / KZ, self.stop[1] + dE / self.k0

    def set_trees(self, dE, dN):
        """tree tops within 700 m of a spot (laser boxes at 1 m, else the 7 m canopy layer); a second model sky line"""
        self.trees = None
        if not self.use_trees: return
        lat, lng = self.spot(dE, dN)
        g, nt = tree_grid(self.T, lat, lng, 700, 1.0, self.fine, clear_m=0)
        if nt: self.trees = g; self.tree_c = (dE, dN)
        self.cache.clear()

    def profile(self, dE, dN, dh, q):
        key = (round(dE, 2), round(dN, 2), round(dh, 2))
        if key in self.cache: return self.cache[key]
        lat, lng = self.spot(dE, dN); G = self.grids()
        g = float(stack_at(self.fine, np.array([lat]), np.array([lng]))[0]); eyeh = g + dh
        half = q[3] / 2 * 1.45 + 6 + abs(q[2])
        paz = np.arange(q[0] - half, q[0] + half, self.DAZ)
        pel = horizon(G, lat, lng, eyeh, paz % 360, dmin=6, nd=self.ND)
        pelt = None
        if self.trees is not None:   # trees from 8 m out (the camera is not in a tree); taller of trees and ground
            pt = horizon([self.trees], lat, lng, eyeh, paz % 360, dmin=8, dmax=700, nd=260)
            pelt = np.maximum(pel, pt)
            if np.allclose(pelt, pel): pelt = None
        r = (paz, pel, eyeh, lat, lng, pelt)
        if len(self.cache) > 400: self.cache.clear()
        self.cache[key] = r; return r

    def snap(self, paz, pel, q, win, pelt=None):
        """each column takes the photo's colour step nearest to the model sky line (within win px); with trees, the
        nearer of the bare sky line and the one with tree tops (bare winter crowns may or may not show)"""
        ym = C.sky_curve(paz, pel, q, self.W, self.H, self.cx)
        d = np.abs(self.cy - ym[:, None])
        if pelt is not None:
            ymt = C.sky_curve(paz, pelt, q, self.W, self.H, self.cx)
            d = np.minimum(d, np.abs(self.cy - ymt[:, None]))
        d = np.where(self.cw > 0, d, 1e9)
        j = np.argmin(d, 1); dd = d[np.arange(len(j)), j]
        ok = (dd <= win) & (ym > 0) & (ym < self.H)
        return np.stack([self.cx[ok], self.cy[ok, :][np.arange(ok.sum()), j[ok]]], 1), ym

    def fit_q(self, paz, pel, pts, q0, eyeh, lat, lng, fscale, free_hfov=True, lm_w=1.0, pelt=None):
        """heading / tilt / roll / lens for fixed sky points at a fixed spot"""
        W, H = self.W, self.H
        dirs = lm_dirs(self.named, lat, lng, eyeh) if self.named else []

        def res(q):
            qq = q if free_hfov else np.r_[q, q0[3]]
            az, el = C.rays(pts[:, 0], pts[:, 1], qq, W, H); az = C.unwrap(az, qq[0])
            r = el - np.interp(az, paz, pel)
            if pelt is not None:
                r2 = el - np.interp(az, paz, pelt); r = np.where(np.abs(r2) < np.abs(r), r2, r)
            r = r * math.radians(1) * C.fpx(qq[3], W)
            if dirs and lm_w > 0:
                ex = []
                for L, dd in zip(self.named, dirs):
                    ex += [v * lm_w for v in lm_res(L, dd, qq, W, H, lat, lng, eyeh)]
                r = np.r_[r / fscale, np.array(ex)] * fscale
            return r
        x0 = np.array(q0 if free_hfov else q0[:3], float)
        hf0 = getattr(self, 'hf0', x0[3] if free_hfov else q0[3])
        lb = [x0[0] - 30, -45, -20] + ([hf0 / 1.35] if free_hfov else []); ub = [x0[0] + 30, 45, 20] + ([hf0 * 1.35] if free_hfov else [])
        x0 = np.clip(x0, np.array(lb) + 1e-6, np.array(ub) - 1e-6)
        r = least_squares(res, x0, loss='soft_l1', f_scale=fscale, bounds=(lb, ub), max_nfev=200)
        q = r.x if free_hfov else np.r_[r.x, q0[3]]
        rr = res(r.x)[:len(pts)]
        return q, rr

    def cost(self, rr, win):
        return float(np.mean(np.minimum(rr ** 2, win ** 2))) if len(rr) else 1e9

    def evaluate(self, s, q, pts, win, fscale):
        paz, pel, eyeh, lat, lng, pelt = self.profile(*s, q)
        q2, rr = self.fit_q(paz, pel, pts, q, eyeh, lat, lng, fscale, pelt=pelt)
        # landmark misfit enters the comparison between spots too (lightly)
        lmc = 0.0
        if self.named:
            dirs = lm_dirs(self.named, lat, lng, eyeh)
            for L, dd in zip(self.named, dirs):
                rr_ = lm_res(L, dd, q2, self.W, self.H, lat, lng, eyeh)
                lmc += sum(min(v * v, 25) for v in rr_[:1] + rr_[2:])
        n = max(len(pts), 1)
        return self.cost(rr, win) + lmc * (win ** 2) * 0.5 / n * 4, q2, rr

    def region(self, s, q):
        """how well the model's regions (sky, trees, buildings, ground by distance) explain the photo's brightness and
        texture (correlation ratio, 0-1); 0 without a photo"""
        if self.ps is None: return 0.0
        lat, lng = self.spot(s[0], s[1])
        g = float(stack_at(self.fine, np.array([lat]), np.array([lng]))[0]); eyeh = g + s[2]
        half = q[3] / 2 * 1.45 + 6 + abs(q[2]); caz = np.arange(q[0] - half, q[0] + half, 0.15)
        CM, CL = CT.class_columns(self.fine, lat, lng, eyeh, caz % 360, trees=self.rtrees, houses=self.houses)
        ci = CT.class_image(caz, CM, CL, q, self.W, self.H)
        # trees count fully once they fill a tenth of the frame (a few tree pixels say little)
        wt = min(1.0, float((ci == 1).mean()) / 0.1)
        return 0.7 * CT.eta2(ci, self.ps['L']) + 0.3 * CT.eta2(ci, self.ps['tex']) + 0.5 * wt * CT.tree_corr(ci, self.ps['L'])

    def chamfer(self, s, q, win, fscale):
        """how well the model from spot s explains the photo: the orientation is refitted to the photo steps near the
        model sky line, then every column where the model sky line is inside the frame costs its distance to the nearest
        photo step (capped at win); a spot judged on its own nearest steps, not on another spot's"""
        paz, pel, eyeh, lat, lng, pelt = self.profile(*s, q)
        pts, _ = self.snap(paz, pel, q, win * 1.5, pelt)
        if len(pts) < 8: return 1e9, q, np.array([])
        q2, rr = self.fit_q(paz, pel, pts, q, eyeh, lat, lng, fscale, pelt=pelt)
        ym = C.sky_curve(paz, pel, q2, self.W, self.H, self.cx)
        d = np.abs(self.cy - ym[:, None])
        if pelt is not None:
            d = np.minimum(d, np.abs(self.cy - C.sky_curve(paz, pelt, q2, self.W, self.H, self.cx)[:, None]))
        d = np.where(self.cw > 0, d, 1e9).min(1)
        inside = (ym > 0) & (ym < self.H)
        ni = inside.sum()
        if ni < 0.3 * len(ym): return 1e9, q2, rr
        cst = float(np.mean(np.minimum(d[inside], win) ** 2))
        lmc = 0.0
        if self.named:
            for L, dd in zip(self.named, lm_dirs(self.named, lat, lng, eyeh)):
                rr_ = lm_res(L, dd, q2, self.W, self.H, lat, lng, eyeh)
                lmc += sum(min(v * v, 25) for v in rr_[:1] + rr_[2:])
        return cst + lmc * (win ** 2) * 0.5 / ni * 4 - MU_SEARCH * self.region(s, q2) * win ** 2, q2, rr

    def quick(self, c):
        """heading / tilt / roll / lens only, at the coarse spot, bare terrain (the screen)"""
        W = self.W; s = (c['dE'], c['dN'], EYE); q = np.array([c['yaw'], c['pitch'], c['roll'], c['hfov']], float)
        self.hf0 = q[3]; tr = self.trees; self.trees = None
        try:
            paz, pel, eyeh, lat, lng, _ = self.profile(*s, q)
            for win in (40, 20, 10):
                win_px = win * W / 1440
                pts, _ = self.snap(paz, pel, q, win_px)
                if len(pts) < 8: return None
                q, rr = self.fit_q(paz, pel, pts, q, eyeh, lat, lng, max(1.5, win_px / 3))
            pts4, ym = self.snap(paz, pel, q, 4 * W / 1440)
            inside = (ym > 0) & (ym < self.H)
            sol = dict(q=q.tolist(), lat=lat, lng=lng, eyeh=eyeh, s=list(s))
            return dict(q=q.tolist(), agree=float(len(pts4) / max(1, inside.sum())), rms=float(np.sqrt(np.mean(np.minimum(rr ** 2, win_px ** 2)))),
                        lmc=lm_total(self, sol), reg=self.region(s, q))
        finally:
            self.trees = tr; self.cache.clear()

    def refine(self, c, log=print, eye_free=(1.0, 3.0), steps1=(128, 64, 32, 16, 8, 4)):
        W = self.W; s = np.array([c['dE'], c['dN'], EYE], float); q = np.array([c['yaw'], c['pitch'], c['roll'], c['hfov']], float)
        self.hf0 = q[3]
        self.set_trees(s[0], s[1])
        hist = []
        # A: heading / tilt / roll / lens only, at the coarse spot, with a shrinking window
        for win in (40, 24, 14):
            win_px = win * W / 1440; fscale = max(1.5, win_px / 3)
            paz, pel, eyeh, lat, lng, pelt = self.profile(*s, q)
            pts, _ = self.snap(paz, pel, q, win_px, pelt)
            if len(pts) < 8: return None
            q, rr = self.fit_q(paz, pel, pts, q, eyeh, lat, lng, fscale, pelt=pelt)
            hist.append(dict(win=win, n=len(pts), rms=float(np.sqrt(np.mean(np.minimum(rr ** 2, win_px ** 2))))))
        # B: the spot too (east, north, eye height), pattern search with the orientation refitted at every spot
        for win, steps in ((10, list(steps1)), (6, [8, 4, 2, 1])):
            win_px = win * W / 1440; fscale = max(1.5, win_px / 3)
            best, q, rr = self.chamfer(s, q, win_px, fscale)
            if best >= 1e9: break
            for st in steps:
                improved = True; it = 0
                while improved and it < 6:
                    improved = False; it += 1
                    for d in ((st, 0, 0), (-st, 0, 0), (0, st, 0), (0, -st, 0), (0, 0, min(0.5, st / 8)), (0, 0, -min(0.5, st / 8))):
                        s2 = s + np.array(d)
                        if not (eye_free[0] <= s2[2] <= eye_free[1]): continue
                        if math.hypot(s2[0] - c['dE'], s2[1] - c['dN']) > 1200: continue
                        c2, q2, rr2 = self.chamfer(s2, q, win_px, fscale)
                        if c2 < best - 1e-9:
                            best, s, q, rr = c2, s2, q2, rr2; improved = True
            hist.append(dict(win=win, n=len(rr), cost=best, rms=float(np.sqrt(np.mean(np.minimum(rr ** 2, win_px ** 2))))))
        # final agreement with the photo: columns whose model sky line has a photo step within 4 px
        paz, pel, eyeh, lat, lng, pelt = self.profile(*s, q)
        pts4, ym = self.snap(paz, pel, q, 4 * W / 1440, pelt)
        _, rr4 = self.fit_q(paz, pel, pts4, q, eyeh, lat, lng, 1.5, pelt=pelt) if len(pts4) >= 6 else (q, np.array([]))
        inside = (ym > 0) & (ym < self.H)
        return dict(s=s.tolist(), q=q.tolist(), lat=lat, lng=lng, eyeh=eyeh, hist=hist, reg=self.region(s, q),
                    agree=float(len(pts4) / max(1, inside.sum())), n_agree=int(len(pts4)),
                    rms=float(np.sqrt(np.mean(rr4 ** 2))) if len(rr4) else float('nan'), pts=pts4.tolist())

    def slide(self, sol, along_deg, offs, pts):
        """refit the orientation with the spot moved along a direction; rms per offset"""
        s0 = np.array(sol['s']); q0 = np.array(sol['q']); a = math.radians(along_deg)
        out = []
        for o in offs:
            s = s0 + np.array([o * math.sin(a), o * math.cos(a), 0])
            paz, pel, eyeh, lat, lng, pelt = self.profile(*s, q0)
            q2, rr = self.fit_q(paz, pel, pts, q0, eyeh, lat, lng, 1.5, pelt=pelt)
            tot = float(np.sum(np.minimum(rr ** 2, 100.0)))
            if self.named:   # landmark misfit in pixels counts like sky points (a building's size pins the distance)
                for L, dd in zip(self.named, lm_dirs(self.named, lat, lng, eyeh)):
                    tot += sum(min((v * 0.03 * self.W) ** 2, 400.0) for v in lm_res(L, dd, q2, self.W, self.H, lat, lng, eyeh))
            out.append(float(np.sqrt(tot / max(1, len(rr)))))
        return out


def lm_res(L, dd, q, W, H, lat, lng, eyeh):
    """landmark misfit in units of 3 % of the width: [x, y/2, building left, building right]"""
    sx = 0.03 * W
    x, y = C.project_dirs(np.array([dd[0]]), np.array([dd[1]]), q, W, H)
    r = [float(np.nan_to_num((x[0] - L['x']) / sx, nan=5.0)), float(np.nan_to_num((y[0] - L['y']) / sx, nan=5.0)) * 0.5 if L.get('y') is not None else 0.0]
    if L.get('corners') and L.get('x0') is not None:
        cd = lm_corner_dirs(L, lat, lng, eyeh)
        cx, cy = C.project_dirs(np.array([a for a, _ in cd]), np.array([e for _, e in cd]), q, W, H)
        if np.all(np.isfinite(cx)): r += [(cx.min() - L['x0']) / sx, (cx.max() - L['x1']) / sx]
        else: r += [5.0, 5.0]
    return r


def confidence(R, sol, delta=0.05):
    """slide the spot along the line of sight and across it; at each offset the orientation is refitted to the sky
    line and the spot scored as in the final choice (sky line agreement and misfit, region match, named landmarks).
    Every offset whose score comes within `delta` of the answer's counts as possible: the confidence is the span from
    the lowest to the highest such offset, in metres ("open" when it reaches the 400 m test edge)."""
    pts = np.array(sol['pts'])
    if len(pts) < 8: return None
    offs = [-400, -200, -100, -60, -30, -15, 0, 15, 30, 60, 100, 200, 400]
    W = R.W; res = {}
    s0 = np.array(sol['s']); q0 = np.array(sol['q'])
    for name, ang in (('along', sol['q'][0]), ('across', sol['q'][0] + 90)):
        a = math.radians(ang); sc = []
        for o in offs:
            s = s0 + np.array([o * math.sin(a), o * math.cos(a), 0])
            paz, pel, eyeh, lat, lng, pelt = R.profile(*s, q0)
            q2, _ = R.fit_q(paz, pel, pts, q0, eyeh, lat, lng, 1.5, pelt=pelt)
            p4, ym = R.snap(paz, pel, q2, 4 * W / 1440, pelt)
            p8, _ = R.snap(paz, pel, q2, 8 * W / 1440, pelt)
            if len(p8) >= 8: q2, rr = R.fit_q(paz, pel, p8, q2, eyeh, lat, lng, 1.5, pelt=pelt)
            else: rr = np.array([10.0])
            ins = max(1, int(((ym > 0) & (ym < R.H)).sum()))
            lmc = lm_total(R, dict(lat=lat, lng=lng, eyeh=eyeh, q=q2))
            sc.append(len(p4) / ins - 0.02 * min(float(np.sqrt(np.mean(np.minimum(rr ** 2, 100)))), 10) + MU_REG * R.region(s, q2)
                      - 0.01 * min(lmc, 50))
        thr = sc[offs.index(0)] - delta
        ok = [o for o, v in zip(offs, sc) if v >= thr]
        lo, hi = min(ok), max(ok)
        res[name] = dict(lo=lo, hi=hi, score=sc, offs=offs, open=(lo == offs[0] or hi == offs[-1]),
                         better_elsewhere=bool(max(sc) > sc[offs.index(0)] + 1e-9))
    return res


def prior(d_m):
    """the photo is filed under this stop: a spot far from it needs a clearly better fit"""
    return 0.03 * (d_m / 1000) ** 2


def solve(photo, rows, cache, region, stop, lm_file=None, radius=2500, step=None, use_names=True, log=print, n_refine=2,
          n_screen=14, use_trees=True, use_region=True):
    t0 = time.time()
    T = Terrain(rows, cache, region)
    sky = SK.extract(photo)
    W, H = sky['size']
    fine = T.stack(stop[0], stop[1], radius / 1000 + 30)
    lms, meta = load_landmarks(lm_file, T, region, fine) if use_names else ([], {})
    if step is None: step = 150
    named = [L for L in lms if L['type'] != 'span' and L.get('known')]
    hg, nh = T.house_grid(stop[0], stop[1], min(radius, 1500) + 300, 1.0, fine)
    hg = hg if nh else None
    ps = CT.photo_small(photo) if use_region else None
    rt = None
    if use_region and use_trees:
        rt, nt = tree_grid(T, stop[0], stop[1], min(radius, 1500) + 400, 3.0, fine, clear_m=0)
        rt = rt if nt else None
    t1 = time.time()
    key = f"{region}_{stop[0]:.6f}_{stop[1]:.6f}_r{int(radius)}_s{int(step)}"
    co = coarse(T, sky, lms, stop, radius, step, use_names=use_names, log=log, region_grids=fine, extras=bool(named), houses=hg,
                cache_key=key)
    for c in co: c['vote'] = c['score']; c['score'] = c['vote'] * math.exp(-0.5 * (math.hypot(c['dE'], c['dN']) / 1500) ** 2)
    co.sort(key=lambda r: -r['score'])
    t2 = time.time()
    # screen: the best few distinct coarse answers get a quick heading / tilt / roll / lens fit at their own spot
    R = Refiner(T, sky, lms, stop, fine, houses=hg, use_trees=use_trees, photo=ps, rtrees=rt)
    cands = distinct(co, n_screen, 200)
    home = [c for c in co if math.hypot(c['dE'], c['dN']) <= 250]
    if home:
        h0 = max(home, key=lambda c: c['vote'])
        if all(math.hypot(h0['dE'] - c['dE'], h0['dN'] - c['dN']) > 100 for c in cands): cands.append(h0)
    scr = []
    for c in cands:
        qk = R.quick(c)
        if qk is None: continue
        d = math.hypot(c['dE'], c['dN'])
        c['quick'] = qk['agree'] - 0.02 * min(qk['rms'], 10) - prior(d) - 0.01 * min(qk['lmc'], 50) + MU_REG * qk['reg']; c['reg'] = qk['reg']
        c['q_quick'] = qk['q']; scr.append(c)
    scr.sort(key=lambda c: -c['quick'])
    log('  screen: ' + ', '.join(f"{c['dE']:.0f},{c['dN']:.0f}:{c['quick']:.2f}" for c in scr[:8]))
    todo = scr[:n_refine]
    if home and h0 in scr and h0 not in todo: todo.append(h0)
    # the stop pin itself is always tried too (photos are filed under the stop they were taken at; a 150 m grid can miss
    # a spot where near trees and banks fix the answer)
    if scr and all(math.hypot(c['dE'], c['dN']) > 40 for c in todo):
        qb = scr[0]['q_quick']; c0 = dict(scr[0], dE=0.0, dN=0.0, yaw=qb[0], pitch=qb[1], roll=qb[2], hfov=qb[3])
        qk = R.quick(c0)
        if qk is not None:
            c0['quick'] = qk['agree'] - 0.02 * min(qk['rms'], 10) - 0.01 * min(qk['lmc'], 50) + MU_REG * qk['reg']
            c0['reg'] = qk['reg']; c0['q_quick'] = qk['q']; todo.append(c0)
    steps1 = (64, 32, 16, 8, 4)
    t3 = time.time()
    sols = []
    for c in todo:
        try:
            c2 = dict(c, yaw=c['q_quick'][0], pitch=c['q_quick'][1], roll=c['q_quick'][2], hfov=c['q_quick'][3])
            sol = R.refine(c2, log=log, steps1=steps1)
            if sol is None: log('  refine: too few sky points'); continue
            sol['coarse'] = c; sols.append(sol)
            log(f"  refine from {c['dE']:.0f},{c['dN']:.0f} quick {c['quick']:.2f}: agree {sol['agree']:.2f} rms {sol['rms']:.2f} region {sol['reg']:.2f} at {sol['s'][0]:.0f},{sol['s'][1]:.0f}")
        except Exception as e:  # noqa: BLE001
            log('  refine failed: ' + repr(e))
    if not sols:
        return dict(ok=False, why='no candidate could be refined', sky_good=float(sky['good'].mean()), times=dict(total=time.time() - t0))
    # when two answers fit the picture about as well, the one nearer the stop wins (the photo is filed under it)
    for s_ in sols:
        s_['dist_stop'] = math.hypot(*s_['s'][:2]); s_['lmc'] = lm_total(R, s_)
        s_['score'] = s_['agree'] - 0.02 * min(s_['rms'], 10) - prior(s_['dist_stop']) - 0.01 * min(s_['lmc'], 50) + MU_REG * s_['reg']
    sols.sort(key=lambda s_: -s_['score'])
    best = sols[0]
    t4 = time.time()
    R.set_trees(best['s'][0], best['s'][1])
    conf = confidence(R, best)
    t5 = time.time()
    lmchk = []
    if R.named:
        dirs = lm_dirs(R.named, best['lat'], best['lng'], best['eyeh'])
        for L, dd in zip(R.named, dirs):
            x, y = C.project_dirs(np.array([dd[0]]), np.array([dd[1]]), best['q'], W, H)
            lmchk.append(dict(name=L['name'], x=L['x'], y=L.get('y'), px=float(x[0]), py=float(y[0]), dist_m=dd[2]))
    out = dict(ok=True, photo=photo, size=[W, H], region=region, stop=list(stop), lat=best['lat'], lng=best['lng'],
               eye_above_ground=best['s'][2], eye_abs=best['eyeh'], yaw=best['q'][0] % 360, pitch=best['q'][1], roll=best['q'][2], hfov=best['q'][3],
               agree=best['agree'], n_agree=best['n_agree'], rms_px=best['rms'], hist=best['hist'], conf=conf, landmarks=lmchk,
               alts=[dict(lat=s['lat'], lng=s['lng'], agree=s['agree'], rms=s['rms'], yaw=s['q'][0] % 360, hfov=s['q'][3], score=s['score'],
                          reg=s['reg'], dist_m=math.hypot((s['lat'] - best['lat']) * KZ, (s['lng'] - best['lng']) * kx(best['lat']))) for s in sols[1:]],
               score=best['score'], lm_cost=best['lmc'], region_match=best['reg'], dist_stop=best['dist_stop'], trees=R.trees is not None,
               coarse_top=[dict(dE=c['dE'], dN=c['dN'], score=c['score'], yaw=c['yaw'], hfov=c['hfov']) for c in co[:5]],
               screen=[dict(dE=c['dE'], dN=c['dN'], quick=c['quick']) for c in scr],
               sky_good=float(sky['good'].mean()), used_names=use_names, n_landmarks=len([L for L in lms if L.get('known')]),
               times=dict(sky_and_load=t1 - t0, coarse=t2 - t1, screen=t3 - t2, refine=t4 - t3, confidence=t5 - t4, total=t5 - t0),
               pts=best['pts'])
    return out


def lm_total(R, sol):
    if not R.named: return 0.0
    dirs = lm_dirs(R.named, sol['lat'], sol['lng'], sol['eyeh'])
    return float(sum(sum(min(v * v, 25) for v in lm_res(L, dd, sol['q'], R.W, R.H, sol['lat'], sol['lng'], sol['eyeh'])) for L, dd in zip(R.named, dirs)))


def coarse_local(T, sky, lms, stop, c, use_names, fine, extras, houses=None):
    """25 m grid of +-200 m round one coarse answer (same vote)"""
    lat = stop[0] + c['dN'] / KZ; lng = stop[1] + c['dE'] / kx(stop[0])
    sub = coarse(T, sky, lms, (lat, lng), 200, 25, use_names=use_names, log=lambda *a: None, region_grids=fine, extras=extras, houses=houses)
    k0 = kx(stop[0])
    for r in sub:
        r['dE'] = (r['lng'] - stop[1]) * k0; r['dN'] = (r['lat'] - stop[0]) * KZ
    return sub[:3]


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('photo'); ap.add_argument('--rows', required=True); ap.add_argument('--cache', required=True)
    ap.add_argument('--region', required=True); ap.add_argument('--stop', required=True)
    ap.add_argument('--landmarks'); ap.add_argument('--radius', type=float, default=2500); ap.add_argument('--step', type=float)
    ap.add_argument('--no-names', action='store_true'); ap.add_argument('--out'); ap.add_argument('--no-trees', action='store_true')
    ap.add_argument('--hcache', help='folder for per-stop horizon tables')
    ap.add_argument('--no-region', action='store_true')
    a = ap.parse_args()
    stop = tuple(float(v) for v in a.stop.split(','))
    HCACHE = a.hcache
    r = solve(a.photo, a.rows, a.cache, a.region, stop, a.landmarks, a.radius, a.step, use_names=not a.no_names, use_trees=not a.no_trees, use_region=not a.no_region)
    s = json.dumps(r, indent=1, default=float)
    if a.out: open(a.out, 'w').write(s)
    print(json.dumps({k: r.get(k) for k in ('lat', 'lng', 'yaw', 'pitch', 'roll', 'hfov', 'agree', 'rms_px', 'times')}, default=float))
