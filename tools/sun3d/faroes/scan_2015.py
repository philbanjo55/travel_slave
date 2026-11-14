#!/usr/bin/env python3
"""Whole-islands pass over the 2015 DSM (python3 scan_2015.py <work> --dsm <tif>):

  1. the coastline check: the DSM's own edge (nodata = sea) against the agency's island / skerry outlines;
  2. holes over LAND: nodata cells inside the coastline (not the slivers along it), as connected patches, with where they are;
  3. spikes and pits on land: cells more than SPIKE m off the 5 x 5 median, in patches of at most 32 cells (64 m2), away
     from the coast and from holes (a sea stack or a gorge is neither: they are bigger than that, or at the coast);
  4. 16 m block statistics of the whole file (mean of land, sea = 0; max; land share) for the wide grid.

Writes <work>/scan.json (counts, every hole and spike patch) and <work>/agg16.npz. Read only; about 10 minutes on 4 cores.
"""
import argparse, json, math, os, sys, time
from concurrent.futures import ProcessPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.dont_write_bytecode = True
import dsm2015 as D

WIN = 2048; PAD = 16; B = 8; SPIKE = 15.0
G = {}

def init(path, work, pace):
    from build_detail_faroes import Agency
    G['dsm'] = D.DSM(path, keep=600); G['lay'] = D.Layers(Agency(f"{work}/cache/us", pace), G['dsm'], work)

def one(job):
    from scipy import ndimage
    r0, c0 = job; dsm, lay = G['dsm'], G['lay']
    win = (c0 - PAD, r0 - PAD, WIN + 2 * PAD, WIN + 2 * PAD)
    a = dsm.read(*win); X, Y = dsm.centre(*win)
    out = dict(r0=r0, c0=c0)
    core = (slice(PAD, PAD + WIN), slice(PAD, PAD + WIN))
    nod = np.isnan(a)
    if nod[core].all():
        coast = lay.in_box('coast', X[0], X[-1], Y[-1], Y[0])
        land = D.draw_polys(dsm, win, coast) if coast else np.zeros_like(nod)
        out.update(land_cells=int(land[core].sum()), valid=0, valid_outside=0, nodata_inside=int(land[core].sum()), holes=[], spikes=[])
    else:
        coast = lay.in_box('coast', X[0], X[-1], Y[-1], Y[0])
        land = D.draw_polys(dsm, win, coast) if coast else np.zeros_like(nod)
        inner = ndimage.distance_transform_edt(land) > 3.0          # more than 6 m inside the mapped shore
        hole0 = nod & land
        lab, k = ndimage.label(hole0, structure=np.ones((3, 3)))
        holes = []
        if k:
            deep = ndimage.maximum(inner, lab, range(1, k + 1)); size = ndimage.sum(hole0, lab, range(1, k + 1))
            com = ndimage.center_of_mass(hole0, lab, range(1, k + 1))
            for i in range(k):
                if not deep[i]: continue
                rr, cc = com[i]
                if not (PAD <= rr < PAD + WIN and PAD <= cc < PAD + WIN): continue   # each patch once: in the window that holds its middle
                lat, lng = dsm.ll(X[0] + cc * dsm.PX, Y[0] - rr * dsm.PX)
                holes.append(dict(lat=round(lat, 6), lng=round(lng, 6), cells=int(size[i]), m2=int(size[i] * 4)))
        # spikes / pits on land
        spikes = []
        okv = ~nod & land
        if okv.sum() > 100:
            f = np.where(nod, np.nan, a)
            # median of the valid cells around (NaN taken as the cell's own value, so the coast does not pull it)
            fill = np.where(nod, ndimage.grey_dilation(np.nan_to_num(a, nan=-1e4), size=3), a); fill[fill < -1e3] = 0
            med = ndimage.median_filter(fill, size=5)
            d = a - med
            near_hole = ndimage.binary_dilation(nod, iterations=3)
            cand = okv & ~near_hole & (np.abs(d) > SPIKE)
            lab, k = ndimage.label(cand, structure=np.ones((3, 3)))
            if k:
                size = ndimage.sum(cand, lab, range(1, k + 1)); dmax = ndimage.maximum(np.abs(np.nan_to_num(d)), lab, range(1, k + 1))
                sgn = ndimage.mean(np.sign(np.nan_to_num(d)), lab, range(1, k + 1)); com = ndimage.center_of_mass(cand, lab, range(1, k + 1))
                for i in range(k):
                    if size[i] > 32: continue
                    rr, cc = com[i]
                    if not (PAD <= rr < PAD + WIN and PAD <= cc < PAD + WIN): continue
                    lat, lng = dsm.ll(X[0] + cc * dsm.PX, Y[0] - rr * dsm.PX)
                    spikes.append(dict(lat=round(lat, 6), lng=round(lng, 6), cells=int(size[i]), off_m=round(float(dmax[i]), 1), kind='spike' if sgn[i] > 0 else 'pit'))
        out.update(land_cells=int(land[core].sum()), valid=int((~nod)[core].sum()), valid_outside=int((~nod & ~land)[core].sum()),
                   valid_outside_far=int((~nod & ~ndimage.binary_dilation(land, iterations=3))[core].sum()),
                   nodata_inside=int((nod & land)[core].sum()), nodata_inner=int((nod & inner)[core].sum()), holes=holes, spikes=spikes)
    # 16 m blocks of the core
    c = a[core]; v = ~np.isnan(c); z = np.where(v, c, 0.0)
    n = WIN // B
    out['sum'] = z.reshape(n, B, n, B).sum((1, 3)).astype(np.float32)
    out['cnt'] = v.reshape(n, B, n, B).sum((1, 3)).astype(np.uint8)
    out['max'] = np.where(v, c, -1.0).reshape(n, B, n, B).max((1, 3)).astype(np.float32)
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('work'); ap.add_argument('--dsm', default=os.environ.get('FO_DSM')); ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--pace', type=float, default=0.6)
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    init(a.dsm, a.work, a.pace); dsm = G['dsm']; G['lay'].coast()   # fetch the coast once before the workers start
    jobs = [(r, c) for r in range(0, dsm.H, WIN) for c in range(0, dsm.W, WIN)]
    nb_r, nb_c = -(-dsm.H // B), -(-dsm.W // B)
    S = np.zeros((nb_r + WIN // B, nb_c + WIN // B), np.float32); N = np.zeros_like(S, dtype=np.uint8); M = np.full_like(S, -1.0)
    tot = dict(land_cells=0, valid=0, valid_outside=0, valid_outside_far=0, nodata_inside=0, nodata_inner=0); holes, spikes = [], []
    t0 = time.time()
    with ProcessPoolExecutor(a.jobs, initializer=init, initargs=(a.dsm, a.work, a.pace)) as ex:
        for k, o in enumerate(ex.map(one, jobs)):
            br, bc = o['r0'] // B, o['c0'] // B; n = WIN // B
            S[br:br + n, bc:bc + n] = o['sum']; N[br:br + n, bc:bc + n] = o['cnt']; M[br:br + n, bc:bc + n] = o['max']
            for key in tot: tot[key] += o.get(key, 0)
            holes += o['holes']; spikes += o['spikes']
            if k % 50 == 0: print(f"{k}/{len(jobs)} {time.time() - t0:.0f} s", flush=True)
    S, N, M = S[:nb_r, :nb_c], N[:nb_r, :nb_c], M[:nb_r, :nb_c]
    np.savez_compressed(f"{a.work}/agg16.npz", sum=S, cnt=N, max=M, X0=dsm.X0, Y0=dsm.Y0, B=B * dsm.PX)
    holes.sort(key=lambda h: -h['cells']); spikes.sort(key=lambda h: -h['off_m'])
    json.dump(dict(totals=tot, holes=holes, spikes=spikes), open(f"{a.work}/scan.json", 'w'), indent=0)
    print(json.dumps(tot)); print(f"{len(holes)} land holes, {sum(h['cells'] for h in holes)} cells; {len(spikes)} spike / pit patches")

if __name__ == '__main__': main()
