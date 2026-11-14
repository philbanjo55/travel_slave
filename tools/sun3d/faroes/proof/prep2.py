#!/usr/bin/env python3
"""Proof picture, round 2: per view, what view2.html draws (ground-only detail box, buildings as vectors, photos on the
detail box AND on the 4 m fine box, four nested grids).

  prep2.py <views.json> <round 2 work dir> <dir with the Faroes 4 m files> <wide file> <out dir>

Per view, data2/<name>/: meta.json and
  detail_h.f32   the detail box's ground, eased into the 4 m grid along its edge      detail_k.u8  mask (0 ground, 3 sea / lake, 4 stream)
  detail_l.u8    DRAWN sun map: shadows of ground AND of the buildings (so the picture has house shadows). The sun
                 checks would use the ground alone: the heights file has no buildings in it.
  photo.jpg      the detail box's photo            bld.json   its buildings (as shipped)
  mid_h / mid_l  the 4 m fine box cropped around the view (1024 cells)        nf_h / nf_l   the whole fine box at 8 m
  near.jpg       the fine box's photo (drapes both)                             wide_h / wide_l  the wide grid, cropped
The grids, the sun and the marching are prep.py's (round 1), loaded from it.
"""
import json, math, os, shutil, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
views_path, work, near_dir, wide_path, out = sys.argv[1:6]
src = open(f"{HERE}/prep.py").read().split("def main():")[0].replace("views_path, work, near_dir, wide_path, out = sys.argv[1:6]", "")
exec(src)   # sun_pos, Grid, sun_map, edge_blend, read_png, R

def main():
    from PIL import Image, ImageDraw
    views = json.load(open(views_path)); pins = json.load(open(f"{work}/pins.json")); det = {r['id']: r for r in json.load(open(f"{work}/detail.json"))}
    nph = {r['id']: r for r in json.load(open(f"{work}/near_photos.json"))}
    reg = next(r for r in pins['regions'] if r['id'] == 'faroes'); wide_all = Grid(read_png(wide_path, reg['base_m'], reg['step_m']), (reg['north'], reg['south'], reg['west'], reg['east']))
    nears = {r['id']: r for r in pins['nears']}
    for v in views:
        name = v['name']; O = f"{out}/{name}"; os.makedirs(O, exist_ok=True); r = det[v['box']]
        if os.path.exists(f"{O}/meta.json") and json.load(open(f"{O}/meta.json")).get('key') == json.dumps(v, sort_keys=True) and not os.environ.get('REDO'): print(f"{name}: kept"); continue
        z = np.load(f"{work}/raw/{v['box']}.npz"); box = (r['north'], r['south'], r['west'], r['east']); cell = r['cell_m']; n = r['n']
        slat, slng = v['stand']; tlat, tlng = v['subject']; alt, az = sun_pos(*v['date'], v['mins'], v['utc_off'], slat, slng)
        nr = nears[v['near']]; nbox = (nr['north'], nr['south'], nr['west'], nr['east']); near_all = Grid(read_png(f"{near_dir}/{nr['path']}", nr['base_m'], nr['step_m']), nbox)
        clat, clng = (box[0] + box[1]) / 2, (box[2] + box[3]) / 2
        mid = near_all.crop(clat, clng, 1024); wide = wide_all.crop(slat, slng, 1024)
        k = 2 if near_all.n > 1024 or near_all.m > 1024 else 1
        nf = Grid(near_all.h[:near_all.n // k * k, :near_all.m // k * k].reshape(near_all.n // k, k, near_all.m // k, k).mean((1, 3)), nbox)
        nf = Grid(edge_blend(nf, wide_all, slat, 200.0)[0], nbox)
        ground = Grid(z['ground'], box); gh, t = edge_blend(ground, mid, slat, 40.0); ground = Grid(gh, box)
        # the picture's shadows: the buildings as blocks at mid-roof height (drawn only; no sun check reads this)
        bld = json.load(open(f"{work}/files/{r['buildings_path']}")) if r.get('buildings_path') else {'b': []}
        im = Image.new('F', (n, n), 0.0); dr = ImageDraw.Draw(im)
        for b in bld['b']:
            if b.get('skip'): continue
            dr.polygon([(b['p'][i] / cell, b['p'][i + 1] / cell) for i in range(0, len(b['p']), 2)], fill=(b['e'] + b['r']) / 2)
        top = np.asarray(im); surf = Grid(np.maximum(gh, np.where(t > 0.99, top, 0)), box)
        print(f"{name}: box {v['box']} ({cell} m cells), {sum(1 for b in bld['b'] if not b.get('skip'))} buildings, sun alt {alt:.1f} az {az:.1f} at {v['mins'] // 60:02d}:{v['mins'] % 60:02d} on {v['date']}", flush=True)
        dl = sun_map(surf, [surf, near_all, wide_all], alt, az, slat, lift=0.4)
        ml = sun_map(mid, [mid, near_all, wide_all], alt, az, slat, lift=2.0)
        nl = sun_map(nf, [nf, wide_all], alt, az, slat, lift=3.0)
        wl = sun_map(wide, [wide, wide_all], alt, az, slat, lift=3.0)
        gh.tofile(f"{O}/detail_h.f32"); z['mask'].astype(np.uint8).tofile(f"{O}/detail_k.u8"); (dl * 255).astype(np.uint8).tofile(f"{O}/detail_l.u8")
        mid.h.tofile(f"{O}/mid_h.f32"); (ml * 255).astype(np.uint8).tofile(f"{O}/mid_l.u8"); nf.h.astype(np.float32).tofile(f"{O}/nf_h.f32"); (nl * 255).astype(np.uint8).tofile(f"{O}/nf_l.u8")
        wide.h.tofile(f"{O}/wide_h.f32"); (wl * 255).astype(np.uint8).tofile(f"{O}/wide_l.u8")
        shutil.copy(f"{work}/files/{r['color_path']}", f"{O}/photo.jpg"); shutil.copy(f"{work}/files/{nph[nr['id']]['color_path']}", f"{O}/near.jpg")
        json.dump(bld, open(f"{O}/bld.json", 'w'))
        def gh_at(la, lo):
            for g in (ground, mid, nf, wide):
                x = float(g.sample(np.array([la]), np.array([lo]))[0])
                if not math.isnan(x): return x
            return 0.0
        meta = dict(key=json.dumps(v, sort_keys=True), name=name, title=v['title'], box=v['box'], cell=cell, stand=[slat, slng], subject=[tlat, tlng], sun=dict(alt=alt, az=az), date=v['date'], mins=v['mins'],
                    lens=v['lens'], aim_up=v.get('aim_up', 0.0), eye=gh_at(slat, slng), subject_h=gh_at(tlat, tlng), tint=[c / 255 for c in r['tint']], rock=[c / 255 for c in r['rock']], near_tint=[c / 255 for c in nph[nr['id']]['tint']],
                    detail=dict(n=n, box=box, width_m=r['width_m'], depth_m=r['depth_m']), mid=dict(n=int(mid.n), m=int(mid.m), box=mid.box), nf=dict(n=int(nf.n), m=int(nf.m), box=nbox),
                    wide=dict(n=int(wide.n), m=int(wide.m), box=wide.box), kx=111320 * math.cos(slat * R), kz=111132)
        json.dump(meta, open(f"{O}/meta.json", 'w'), indent=1)
        print(f"   eye ground {meta['eye']:.1f} m; subject ground {meta['subject_h']:.1f} m", flush=True)

if __name__ == '__main__': main()
