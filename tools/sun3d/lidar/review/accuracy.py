"""Near-field accuracy: the trees drawn (page dumps) against the survey's trees (build_leaf segmentation of the 1 m
mask), per stand pin, by distance band. python3 accuracy.py <dump dir> <tag dots> <tag shapes> [keys]"""
import sys, json, math, os, numpy as np
sys.dont_write_bytecode = True
sys.path.insert(0, '/home/user/travel_slave/.claude/worktrees/agent-ae8bb19d221de2d66/tools/sun3d/lidar')
import build_leaf as bl
from scipy.spatial import cKDTree
S = '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad'
UP = S + '/sharp/upload2'; LF = S + '/trees_review/leaf'
ROWS = {r['id']: r for r in json.load(open(UP + '/detail_rows.json'))}
LEAFR = {r['id']: r['leaf_mask_path'] for r in json.load(open(LF + '/leaf_rows.json'))}
JOBS = {j['key']: j for j in json.load(open(S + '/rv_jobs.json'))}
BANDS = [(0, 100), (100, 260), (260, 500)]
_truth = {}


def truth(bid):
    if bid in _truth: return _truth[bid]
    r = ROWS[bid]; m4, H4 = bl.read_mask(os.path.join(UP, r['mask_path']))
    m5 = np.array(bl.Image.open(os.path.join(LF, 'files', LEAFR[bid]))); bare = (m5 >= 8) & (((m5.astype(np.int32) - 8) & 1) == 1)
    s = bl.segment(H4, bare=bare); n = r['n']
    ids = np.arange(1, len(s['h']) + 1); tb = np.asarray(bl.nd.mean(bare.astype(np.float32), s['lab'], ids)) > 0.5
    lat = r['north'] - (s['r'] + .5) * (r['north'] - r['south']) / n; lng = r['west'] + (s['c'] + .5) * (r['east'] - r['west']) / n
    L = s['lab']; touch = np.zeros(len(s['h']) + 1, bool)
    for a_, b_ in ((0, 1), (1, 0), (1, 1), (1, -1)):   # a crown touching another one: its width is a share of a closed canopy
        A_ = L[max(a_, 0):L.shape[0] + min(a_, 0), max(b_, 0):L.shape[1] + min(b_, 0)]; B_ = L[max(-a_, 0):L.shape[0] + min(-a_, 0), max(-b_, 0):L.shape[1] + min(-b_, 0)]
        m_ = (A_ > 0) & (B_ > 0) & (A_ != B_); touch[A_[m_]] = True; touch[B_[m_]] = True
    _truth[bid] = dict(r=r, lat=lat, lng=lng, h=s['h'], cw=s['cw'], bare=tb, lab=s['lab'], alone=~touch[1:])
    return _truth[bid]


def far_xy(c, lat, lng):
    kx = c['W'] / (c['east'] - c['west']); kz = c['D'] / (c['north'] - c['south'])
    return (np.asarray(lng) - c['west']) * kx, (c['north'] - np.asarray(lat)) * kz


def bearing(dx, dz): return np.degrees(np.arctan2(dx, -dz))


def angdiff(a, b): return (a - b + 180) % 360 - 180


def q(a, p=50): return float(np.percentile(a, p)) if len(a) else float('nan')


def run(ddir, tdots, tshape, keys):
    out = {}
    for k in keys:
        fd, fs = f'{ddir}/{k}_{tdots}_dump.json', f'{ddir}/{k}_{tshape}_dump.json'
        if not (os.path.exists(fd) and os.path.exists(fs)): continue
        D = json.load(open(fd)); A = json.load(open(fs)); c = D['cfg']; bid = c['det']
        if not bid: continue
        T = truth(bid); ex, ez = far_xy(c, c['eye']['lat'], c['eye']['lng'])
        tx, tz = far_xy(c, T['lat'], T['lng']); td = np.hypot(tx - ex, tz - ez); tb = bearing(tx - ex, tz - ez)
        r = T['r']; n = r['n']; res = dict(box=bid)
        # ---- today: the dots (within 260 m), each dot to the crown its cell belongs to
        P = np.array(D['near']['P']).reshape(-1, 3); SD = np.array(D['near']['A']).reshape(-1, 4)
        lat = c['north'] - P[:, 2] / (c['D'] / (c['north'] - c['south'])); lng = c['west'] + P[:, 0] / (c['W'] / (c['east'] - c['west']))
        rr = np.clip(((r['north'] - lat) / (r['north'] - r['south']) * n).astype(int), 0, n - 1); cc = np.clip(((lng - r['west']) / (r['east'] - r['west']) * n).astype(int), 0, n - 1)
        L = T['lab'][rr, cc]; nT = len(T['h'])
        cnt = np.bincount(L, minlength=nT + 1)[1:]
        hmax = np.zeros(nT + 1); np.maximum.at(hmax, L, SD[:, 3]); hmax = hmax[1:]
        # drawn crown width: 2 x the 90th-percentile distance of its dots from the surveyed top + one dot's size
        dxy = np.hypot(P[:, 0] - tx[np.maximum(L - 1, 0)], P[:, 2] - tz[np.maximum(L - 1, 0)])
        wq = np.zeros(nT); sz = np.zeros(nT); cxs = np.zeros(nT); czs = np.zeros(nT)
        order = np.argsort(L); Ls = L[order]; starts = np.searchsorted(Ls, np.arange(1, nT + 2))
        for t in range(nT):
            a, b = starts[t], starts[t + 1]
            if b > a:
                ii = order[a:b]; wq[t] = 2 * np.percentile(dxy[ii], 90) + np.median(SD[ii, 2]); sz[t] = np.median(SD[ii, 2]); cxs[t] = P[ii, 0].mean(); czs[t] = P[ii, 2].mean()
        loose = int((L == 0).sum())
        dres = {}
        for lo, hi in BANDS:
            kk = (td >= lo) & (td < hi) & (T['h'] >= 2)
            if not kk.any(): continue
            f = kk & (cnt > 0)
            e = dict(trees=int(kk.sum()), found=int(f.sum()))
            if f.any():
                e['height_err_med'] = q(hmax[f] - T['h'][f]); e['height_err_abs_med'] = q(np.abs(hmax[f] - T['h'][f]))
                e['width_drawn_over_survey_med'] = q(wq[f] / np.maximum(T['cw'][f], 0.5)); e['dot_size_m_med'] = q(sz[f])
                e['pos_err_m_med'] = q(np.hypot(cxs[f] - tx[f], czs[f] - tz[f])); e['pos_err_m_p90'] = q(np.hypot(cxs[f] - tx[f], czs[f] - tz[f]), 90)
                fa = f & T['alone']
                if fa.any(): e['alone'] = int(fa.sum()); e['alone_width_drawn_over_survey_med'] = q(wq[fa] / np.maximum(T['cw'][fa], 0.5))
                e['ang_err_deg_med'] = q(np.abs(angdiff(bearing(cxs[f] - ex, czs[f] - ez), tb[f]))); e['ang_err_deg_p90'] = q(np.abs(angdiff(bearing(cxs[f] - ex, czs[f] - ez), tb[f])), 90)
            dres[f'{lo}-{hi}'] = e
        dres['dots'] = len(P); dres['dots_outside_any_crown'] = loose
        # today beyond 260 m: the park-wide sprites (thinned), nearest sprite to each surveyed tree within 5 m
        if 'wide' in D:
            WP = np.array(D['wide']['P']).reshape(-1, 3); WA = np.array(D['wide']['A']).reshape(-1, 4)
            if len(WP):
                kd = cKDTree(np.c_[WP[:, 0], WP[:, 2]]); dist, ix = kd.query(np.c_[tx, tz], distance_upper_bound=5)
                for lo, hi in [(260, 500)]:
                    kk = (td >= lo) & (td < hi) & (T['h'] >= 4); f = kk & np.isfinite(dist)
                    e = dres.setdefault(f'{lo}-{hi}', {}); e['wide_trees'] = int(kk.sum()); e['wide_sprite_within_5m'] = int(f.sum())
                    if f.any():
                        e['wide_height_err_med'] = q(WA[ix[f], 0] - T['h'][f]); e['wide_width_over_survey_med'] = q(WA[ix[f], 1] / np.maximum(T['cw'][f], .5))
                        e['wide_ang_err_deg_med'] = q(np.abs(angdiff(bearing(WP[ix[f], 0] - ex, WP[ix[f], 2] - ez), tb[f])))
        res['today'] = dres
        # ---- A / B: the page's own trees, one to one with the survey's (nearest within 1.5 m)
        tr = A['near']['trees']; X = np.array(tr['X']); Z = np.array(tr['Z']); Hh = np.array(tr['H']); CW = np.array(tr['CW']); Bb = np.array(tr['bare'])
        CC = np.maximum(0.65 * CW, CW - 1.2); W = np.where(Bb > 0, np.maximum(1.2, np.minimum(1.4 * Hh, np.maximum(0.2 * Hh, CC))), np.maximum(0.8, np.minimum(1.2 * Hh, np.maximum(0.15 * Hh, CC))))
        kd = cKDTree(np.c_[X, Z]); dist, ix = kd.query(np.c_[tx, tz], distance_upper_bound=1.5)
        used = np.zeros(len(X), bool); used[ix[np.isfinite(dist)]] = True
        dA = np.hypot(X - ex, Z - ez); ares = {}
        for lo, hi in BANDS:
            kk = (td >= lo) & (td < hi) & (T['h'] >= 2); f = kk & np.isfinite(dist)
            if not kk.any(): continue
            e = dict(trees=int(kk.sum()), found=int(f.sum()), extra=int(((dA >= lo) & (dA < hi) & ~used).sum()))
            if f.any():
                j = ix[f]
                e['pos_err_m_med'] = q(dist[f]); e['pos_err_m_p90'] = q(dist[f], 90)
                e['height_err_med'] = q(Hh[j] - T['h'][f]); e['height_err_abs_med'] = q(np.abs(Hh[j] - T['h'][f])); e['height_err_abs_p90'] = q(np.abs(Hh[j] - T['h'][f]), 90)
                e['cw_err_m_med'] = q(CW[j] - T['cw'][f]); e['cw_abs_err_m_med'] = q(np.abs(CW[j] - T['cw'][f]))
                e['width_drawn_over_survey_med'] = q(W[j] / np.maximum(T['cw'][f], .5)); e['width_clamped_share'] = float(np.mean(np.abs(W[j] - CC[j]) > 0.05))
                e['ang_err_deg_med'] = q(np.abs(angdiff(bearing(X[j] - ex, Z[j] - ez), tb[f]))); e['ang_err_deg_p90'] = q(np.abs(angdiff(bearing(X[j] - ex, Z[j] - ez), tb[f])), 90)
                e['bare_agree'] = float(np.mean((Bb[j] > 0) == T['bare'][f]))
                fa = T['alone'][f]
                if fa.any(): e['alone'] = int(fa.sum()); e['alone_width_drawn_over_survey_med'] = q(W[j][fa] / np.maximum(T['cw'][f][fa], .5)); e['alone_cw_err_m_med'] = q(CW[j][fa] - T['cw'][f][fa])
            ares[f'{lo}-{hi}'] = e
        res['AB'] = ares; res['AB_trees_drawn'] = int(len(X))
        out[k] = res; print(k, bid, json.dumps(res['today'].get('0-100', {})), '|', json.dumps(ares.get('0-100', {})), flush=True)
    return out


if __name__ == '__main__':
    ddir, td_, ts_ = sys.argv[1:4]; keys = sys.argv[4].split(',') if len(sys.argv) > 4 else sorted(JOBS)
    o = run(ddir, td_, ts_, keys); json.dump(o, open(os.path.join(ddir, 'accuracy.json'), 'w'), indent=1)
