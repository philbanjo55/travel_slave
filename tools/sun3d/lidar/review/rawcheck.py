"""Independent check: the trees in the laser points themselves (0.5 m grid straight from the survey, ept_box.py) vs the
trees the page works from (the 1 m mask of the detail box), within 300 m of four stand pins."""
import sys, json, math, numpy as np
sys.dont_write_bytecode = True
import accuracy as acc
from scipy import ndimage as nd
from scipy.spatial import cKDTree
R0 = 20037508.34
PINS = {k: v for k, v in {'moulton': 'J20', 'cunningham': 'J03', 'oxbow': 'J14', 'snake': 'J17'}.items() if (len(sys.argv) < 2 or k in sys.argv[1].split(','))}
out = {}
for name, key in PINS.items():
    z = np.load(f'{acc.S}/trees_review/laser/{name}.npz'); top, gnd, cls = z['top'], z['gnd'], z['cls']; lat0, lng0, half, cell = z['meta']
    n = top.shape[0]; k = 1 / math.cos(math.radians(lat0))
    mx = lng0 * R0 / 180; my = math.log(math.tan((90 + lat0) * math.pi / 360)) * R0 / math.pi; x0, y1 = mx - half * k, my + half * k
    has_g = gnd < 1e8
    g = np.where(has_g, gnd, 0).astype(np.float64)
    idx = nd.distance_transform_edt(~has_g, return_distances=False, return_indices=True); gf = nd.uniform_filter(g[tuple(idx)], 3)
    chm = np.where(top > -1e8, top - gf, 0)
    tree = (chm >= 2) & ~np.isin(cls, [2, 6, 9]) & (top > -1e8)
    tree = nd.binary_opening(tree, np.ones((2, 2)))   # single stray returns (wires, birds) out; a 1 m crown stays
    H = np.where(tree, chm, 0).astype(np.float32)
    s = acc.bl.segment(H, cell=0.5)
    lng = (x0 + (s['c'] + .5) * cell * k) * 180 / R0; lat = np.degrees(np.arctan(np.sinh((y1 - (s['r'] + .5) * cell * k) * math.pi / R0)))
    J = acc.JOBS[key]; D = json.load(open(f'{acc.S}/trees_review/out_d/{key}_dots_dump.json')); c = D['cfg']; T = acc.truth(c['det'])
    ex, ez = acc.far_xy(c, J['v']['lat'], J['v']['lng']); rx, rz = acc.far_xy(c, lat, lng); tx, tz = acc.far_xy(c, T['lat'], T['lng'])
    dr = np.hypot(rx - ex, rz - ez); dt = np.hypot(tx - ex, tz - ez)
    kd = cKDTree(np.c_[tx, tz]); dist, ix = kd.query(np.c_[rx, rz], distance_upper_bound=2.0)
    kd2 = cKDTree(np.c_[rx, rz]); dist2, ix2 = kd2.query(np.c_[tx, tz], distance_upper_bound=2.0)
    res = {}
    for lo, hi in [(2, 4), (4, 8), (8, 60)]:
        kk = (dr < 280) & (s['h'] >= lo) & (s['h'] < hi); f = kk & np.isfinite(dist)
        e = dict(laser_trees=int(kk.sum()), in_mask_within_2m=int(f.sum()))
        if f.any(): e['pos_m_med'] = acc.q(dist[f]); e['height_mask_minus_laser_med'] = acc.q(T['h'][ix[f]] - s['h'][f]); e['cw_mask_minus_laser_med'] = acc.q(T['cw'][ix[f]] - s['cw'][f])
        res[f'{lo}-{hi}'] = e
    kk = (dt < 280) & (T['h'] >= 2); res['mask_trees'] = int(kk.sum()); res['mask_trees_without_laser_tree_2m'] = int((kk & ~np.isfinite(dist2)).sum())
    # what the mask drops: laser tree cells (>= 2 m) with no tree cell in the mask within 1 m
    # canopy cover: laser tree cells (0.5 m) within 280 m with a mask tree cell within 1 m, and the other way round
    rr, cc = np.nonzero(tree); la = np.degrees(np.arctan(np.sinh((y1 - (rr + .5) * cell * k) * math.pi / R0))); lo = (x0 + (cc + .5) * cell * k) * 180 / R0
    lx, lz = acc.far_xy(c, la, lo); near = np.hypot(lx - ex, lz - ez) < 280
    r = T['r']; nb = r['n']; mtree = T['lab'] > 0; mt1 = nd.binary_dilation(mtree, np.ones((3, 3)))
    mr = np.clip(((r['north'] - la) / (r['north'] - r['south']) * nb).astype(int), 0, nb - 1); mc = np.clip(((lo - r['west']) / (r['east'] - r['west']) * nb).astype(int), 0, nb - 1)
    res['laser_canopy_cells_in_mask_1m'] = round(float(mt1[mr[near], mc[near]].mean()), 3)
    lt1 = nd.binary_dilation(tree, np.ones((5, 5)))
    MR, MC = np.nonzero(mtree); mla = r['north'] - (MR + .5) * (r['north'] - r['south']) / nb; mlo = r['west'] + (MC + .5) * (r['east'] - r['west']) / nb
    mx_, mz_ = acc.far_xy(c, mla, mlo); nm = np.hypot(mx_ - ex, mz_ - ez) < 280
    LR = np.round((y1 - np.log(np.tan((90 + mla[nm]) * np.pi / 360)) * R0 / np.pi) / (cell * k) - .5).astype(int); LC = np.round((mlo[nm] * R0 / 180 - x0) / (cell * k) - .5).astype(int)
    ok = (LR >= 0) & (LR < n) & (LC >= 0) & (LC < n)
    res['mask_canopy_cells_with_laser_1m'] = round(float(lt1[LR[ok], LC[ok]].mean()), 3)
    out[name] = res; print(name, json.dumps(res), flush=True)
json.dump(out, open(f'{acc.S}/trees_review/rawcheck.json', 'w'), indent=1)
