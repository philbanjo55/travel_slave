"""The page's crown widths (A dumps) against the laser's own 0.5 m crowns (ept_box), four pins, trees >= 4 m within 280 m."""
import json, math, sys, numpy as np
sys.dont_write_bytecode = True
import accuracy as acc
from scipy import ndimage as nd
from scipy.spatial import cKDTree
R0 = 20037508.34
D = sys.argv[1] if len(sys.argv) > 1 else 'out_A'; TAG = sys.argv[2] if len(sys.argv) > 2 else 'A'
out = {}
for name, key in {'moulton': 'J20', 'cunningham': 'J03', 'oxbow': 'J14', 'snake': 'J17'}.items():
    z = np.load(f'{acc.S}/trees_review/laser/{name}.npz'); top, gnd, cls = z['top'], z['gnd'], z['cls']; lat0, lng0, half, cell = z['meta']
    k = 1 / math.cos(math.radians(lat0)); mx = lng0 * R0 / 180; my = math.log(math.tan((90 + lat0) * math.pi / 360)) * R0 / math.pi; x0, y1 = mx - half * k, my + half * k
    has_g = gnd < 1e8; g = np.where(has_g, gnd, 0).astype(np.float64)
    idx = nd.distance_transform_edt(~has_g, return_distances=False, return_indices=True); gf = nd.uniform_filter(g[tuple(idx)], 3)
    chm = np.where(top > -1e8, top - gf, 0); tree = (chm >= 2) & ~np.isin(cls, [2, 6, 9]) & (top > -1e8); tree = nd.binary_opening(tree, np.ones((2, 2)))
    H = np.where(tree, chm, 0).astype(np.float32); s = acc.bl.segment(H, cell=0.5)
    L = s['lab']; touch = np.zeros(len(s['h']) + 1, bool)
    for a_, b_ in ((0, 1), (1, 0), (1, 1), (1, -1)):
        A_ = L[max(a_, 0):L.shape[0] + min(a_, 0), max(b_, 0):L.shape[1] + min(b_, 0)]; B_ = L[max(-a_, 0):L.shape[0] + min(-a_, 0), max(-b_, 0):L.shape[1] + min(-b_, 0)]
        m_ = (A_ > 0) & (B_ > 0) & (A_ != B_); touch[A_[m_]] = True; touch[B_[m_]] = True
    alone = ~touch[1:]
    lng = (x0 + (s['c'] + .5) * cell * k) * 180 / R0; lat = np.degrees(np.arctan(np.sinh((y1 - (s['r'] + .5) * cell * k) * math.pi / R0)))
    A = json.load(open(f'{acc.S}/trees_review/{D}/{key}_{TAG}_dump.json')); c = A['cfg']; tr = A['near']['trees']
    X = np.array(tr['X']); Z = np.array(tr['Z']); CW = np.array(tr['CW']); Hh = np.array(tr['H']); Bb = np.array(tr['bare'])
    W = np.where(Bb > 0, np.maximum(1.2, np.minimum(1.4 * Hh, np.maximum(0.2 * Hh, CW))), np.maximum(0.8, np.minimum(1.2 * Hh, np.maximum(0.15 * Hh, CW))))
    if True: W = np.where(Bb > 0, np.maximum(1.2, np.minimum(1.4 * Hh, np.maximum(0.2 * Hh, np.maximum(0.65 * CW, CW - 1.2)))), np.maximum(0.8, np.minimum(1.2 * Hh, np.maximum(0.15 * Hh, np.maximum(0.65 * CW, CW - 1.2)))))
    rx, rz = acc.far_xy(c, lat, lng); ex, ez = acc.far_xy(c, c['eye']['lat'], c['eye']['lng'])
    kd = cKDTree(np.c_[X, Z]); d, ix = kd.query(np.c_[rx, rz], distance_upper_bound=1.5)
    f = np.isfinite(d) & (np.hypot(rx - ex, rz - ez) < 280) & (s['h'] >= 4); fa = f & alone
    r = dict(matched=int(f.sum()), cw_page_minus_laser=float(np.median(CW[ix[f]] - s['cw'][f])), drawn_over_laser=float(np.median(W[ix[f]] / s['cw'][f])),
             lone=int(fa.sum()), lone_cw_page_minus_laser=float(np.median(CW[ix[fa]] - s['cw'][fa])) if fa.any() else None,
             lone_drawn_over_laser=float(np.median(W[ix[fa]] / s['cw'][fa])) if fa.any() else None, height_page_minus_laser=float(np.median(Hh[ix[f]] - s['h'][f])))
    out[name] = r; print(name, json.dumps({k_: (round(v, 2) if isinstance(v, float) else v) for k_, v in r.items()}))
json.dump(out, open(f'{acc.S}/trees_review/crowncheck_{TAG}.json', 'w'), indent=1)
