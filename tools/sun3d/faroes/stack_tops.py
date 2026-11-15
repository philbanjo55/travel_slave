#!/usr/bin/env python3
"""Sea-stack tops for the Faroes 3D files (14 Nov 2026). The 2015 DSM is a 2 m grid (resampled from ~2.35 m), so a thin
stack loses its top: against the agency's 2009 contours (closed rings) and published heights Stóri Drangur reads 66.4 m
(top contour 72), Risin 67.4 (contour 68, published 71), Kellingin 56.6 (contour 62, published 68), Tindhólmur 255.2
(published 262). This raises each stack's own top, in every file of the build that holds it:

  python3 stack_tops.py <work> [--migration <path>]

For each stack: the highest cell within `rad` m of its top, the cells above half that height connected to it (its own
footprint: the shore and the lower cliffs are untouched), each raised by (target - top) x w^1.5, w = (h - half) /
(top - half), so the base stays where it is and the top reaches the target. Lítli Drangur is left at 28 m (no survey line
or published figure). The arch through Stóri Drangur cannot be drawn: every level is a height field (one height a cell).

Reads <work>/levels.json and files/faroes_dsm15_wide.png; writes the changed files under new names (<name>_st.png),
<work>/stack_tops.json (rows, before / after tops) and the draft migration (repointing only those rows). Sun times use
these heights (they are ground, not buildings).
"""
import argparse, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE)); sys.dont_write_bytecode = True
from build_trip_terrain import read_png
from build_detail_faroes import write_heights

# name, top lat, lng (the 2015 file's own highest cell), search radius m, target m, source of the target
STACKS = [('Stóri Drangur', 62.07519, -7.41431, 30, 72.0, '2009 contour ring 72 m (published ~70)'),
          ('Risin', 62.32369, -7.10191, 25, 71.0, 'published 71 m (2009 contour 68)'),
          ('Kellingin', 62.32205, -7.10245, 25, 68.0, 'published 68 m (2009 contour 62)'),
          ('Tindhólmur', 62.07668, -7.42933, 80, 262.0, 'published 262 m')]
WIDE = dict(id='faroes', north=62.42, south=61.78, west=-7.72, east=-6.25, n=2048, base_m=0.0, step_m=0.5, path='faroes_dsm15_wide.png')

def raise_tops(h, box, n, cell_m):
    from scipy import ndimage
    north, south, west, east = box; out = h.copy(); notes = []
    for name, la, lo, rad, target, src in STACKS:
        r = (north - la) / (north - south) * n; c = (lo - west) / (east - west) * n
        if not (0 <= r < n and 0 <= c < n): continue
        pr = max(1, int(math.ceil(rad / ((north - south) * 111132 / n)))); pc = max(1, int(math.ceil(rad / ((east - west) * 111320 * math.cos(math.radians(la)) / n))))
        r0, r1, c0, c1 = max(0, int(r) - pr), min(n, int(r) + pr + 1), max(0, int(c) - pc), min(n, int(c) + pc + 1)
        w = out[r0:r1, c0:c1]; i = np.unravel_index(np.argmax(w), w.shape); tr, tc = r0 + i[0], c0 + i[1]; top = float(out[tr, tc])
        if top >= target - 0.05 or top < 5: notes.append(dict(stack=name, top=round(top, 2), skipped=True)); continue
        half = top / 2.0
        lab, k = ndimage.label(out > half); comp = lab == lab[tr, tc]
        if comp.sum() * cell_m * cell_m > 400000: notes.append(dict(stack=name, top=round(top, 2), skipped='footprint too big')); continue
        wgt = np.clip((out - half) / (top - half), 0, 1) ** 1.5
        out = np.where(comp, out + (target - top) * wgt, out).astype(np.float32)
        notes.append(dict(stack=name, before=round(top, 2), after=round(float(out[tr, tc]), 2), target=target, source=src, cells=int(comp.sum()), footprint_m2=round(float(comp.sum() * cell_m * cell_m))))
    return out, notes

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('work'); ap.add_argument('--migration')
    a = ap.parse_args(); F = f"{a.work}/files"
    lv = json.load(open(f"{a.work}/levels.json"))
    jobs = [('wide', dict(WIDE))] + [(k, r) for k in ('range', 'near', 'detail') for r in lv.get(k, {}).values()]
    changed = []
    for kind, r in jobs:
        box = (r['north'], r['south'], r['west'], r['east'])
        if not any(box[1] < la < box[0] and box[2] < lo < box[3] for _, la, lo, *_ in STACKS): continue
        h = read_png(f"{F}/{r['path']}", r['base_m'], r['step_m']); n = h.shape[0]
        cell = (box[0] - box[1]) * 111132 / n
        out, notes = raise_tops(h, box, n, cell)
        done = [x for x in notes if not x.get('skipped')]
        if not done: continue
        new = r['path'][:-4] + '_st.png'
        assert out.max() <= r['base_m'] + 65535 * r['step_m']
        write_heights(f"{F}/{new}", out, r['base_m'], r['step_m'])
        back = read_png(f"{F}/{new}", r['base_m'], r['step_m']); assert np.abs(back - np.round((out - r['base_m']) / r['step_m']) * r['step_m'] - r['base_m']).max() < 1e-3
        changed.append(dict(kind=kind, id=r['id'], old=r['path'], path=new, bytes=os.path.getsize(f"{F}/{new}"), cell_m=round(cell, 2), stacks=notes))
        print(f"{kind} {r['id']}: {new} " + '; '.join(f"{x['stack']} {x.get('before')} -> {x.get('after')}" if not x.get('skipped') else f"{x['stack']} left ({x['skipped']}, {x['top']})" for x in notes))
    json.dump(changed, open(f"{a.work}/stack_tops.json", 'w'), indent=1, ensure_ascii=False)
    tab = {'wide': 'terrain_regions', 'range': 'terrain_range_regions', 'near': 'terrain_near_regions', 'detail': 'terrain_detail_regions_v4'}
    sql = ["-- DRAFT, NOT APPLIED. Faroes 3D: sea-stack tops (14 Nov 2026), after 20261114050000_terrain_faroes_2015.",
           "-- The 2 m DSM shaves thin tops; tools/sun3d/faroes/stack_tops.py raises each stack's own top (cells above half its height,",
           "-- connected to the top; shore and lower cliffs untouched) to: " + ', '.join(f"{s[0]} {s[4]:g} m ({s[5]})" for s in STACKS) + ".",
           "-- Lítli Drangur stays at 28 m. The arch through Stóri Drangur cannot be drawn (height field).",
           f"-- Before applying: upload the {len(changed)} files of stack_tops_upload.txt to the public bucket `terrain` (new names).", ""]
    for c in changed:
        sql.append(f"update public.{tab[c['kind']]} set path = '{c['path']}', bytes = {c['bytes']} where id = '{c['id']}' and path = '{c['old']}';")
    mig = a.migration or f"{a.work}/terrain_faroes_stack_tops.sql"
    open(mig, 'w').write("\n".join(sql) + "\n")
    open(f"{a.work}/stack_tops_upload.txt", 'w').write("\n".join(f"{c['path']}\t{F}/{c['path']}\t{c['bytes']}" for c in changed) + "\n")
    print(f"{len(changed)} files, {sum(c['bytes'] for c in changed) / 1e6:.1f} MB; migration {mig}")

if __name__ == '__main__': main()
