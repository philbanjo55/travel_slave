#!/usr/bin/env python3
"""Where the Faroes boxes go (the 2015 DSM build). Copies of the app's picks (src/services/terrain.ts) so every shot is
checked the way the phone will choose:

  range boxes  (terrain_range_regions)     2048 x 2048 cells at 2 m (4,096 m): every shot's subject at least 1 km inside
               (pickRange's rule), centred as near pickRange's aim point as that allows, and holding the stand pin too
               wherever stand and subject are close enough for one box;
  near boxes   (terrain_near_regions)      the existing 11 fine boxes keep their place (their aerial photos stay valid),
               heights rebuilt from the DSM at up to 2048 cells (2 to 4.4 m); a shot that none of them serves
               (pickNear: stand pin at least the blend strip inside) gets a new one;
  detail boxes (terrain_detail_regions_v4) 1504 x 1504 cells at 1 m: the stand pin at least 150 m inside, the subject
               inside when it is within reach, the whole box inside the shot's near box (pickDetail's rule).
"""
import math
import numpy as np

KZ = 111132.0
def kx(lat): return 111320.0 * math.cos(math.radians(lat))
G_MESH = 768

def inb(r, p): return r['south'] <= p[0] <= r['north'] and r['west'] <= p[1] <= r['east']
def margin(r, p):
    k = kx(p[0]); return min((r['north'] - p[0]) * KZ, (p[0] - r['south']) * KZ, (p[1] - r['west']) * k, (r['east'] - p[1]) * k)

def pick_near(nears, region, stand, subject):
    edge = 4.2 * max(region['width_m'], region['depth_m']) / (G_MESH - 1) + 30
    best = None; bb = False; ba = 1e99
    for r in nears:
        if r['parent'] != region['id'] or not inb(r, stand) or margin(r, stand) < edge: continue
        both = inb(r, subject); area = (r['north'] - r['south']) * (r['east'] - r['west'])
        if (both and not bb) or (both == bb and area < ba): best, bb, ba = r, both, area
    return best

def pick_detail(details, region, near, stand, subject):
    best = None; bb = False; bi = 0
    for r in details:
        if r['parent'] != region['id'] or not inb(r, stand): continue
        if near and not (r['north'] <= near['north'] and r['south'] >= near['south'] and r['west'] >= near['west'] and r['east'] <= near['east']): continue
        ins = margin(r, stand)
        if ins < 100: continue
        both = inb(r, subject)
        if best is None or (both and not bb) or (both == bb and ins > bi): best, bb, bi = r, both, ins
    return best

def aim_point(stand, subject):
    k = kx(subject[0]); dx = (stand[1] - subject[1]) * k; dz = (stand[0] - subject[0]) * KZ; d = math.hypot(dx, dz) or 1; t = min(1500, d / 2)
    return (subject[0] + dz / d * t / KZ, subject[1] + dx / d * t / k), d

def pick_range(ranges, region, stand, subject):
    P, d = aim_point(stand, subject); k = kx(subject[0])
    mine = [r for r in ranges if r['parent'] == region['id']]
    best = None; bd = 1e99
    for r in mine:
        if not inb(r, subject) or margin(r, subject) < 1000: continue
        e = math.hypot(((r['north'] + r['south']) / 2 - P[0]) * KZ, ((r['west'] + r['east']) / 2 - P[1]) * k)
        if e < bd: best, bd = r, e
    if best: return best
    dx = (stand[1] - subject[1]) * k; dz = (stand[0] - subject[0]) * KZ; dd = math.hypot(dx, dz) or 1
    for s in range(1000, 30001, 250):
        q = (stand[0] - dz / dd * s / KZ, stand[1] - dx / dd * s / k)
        for r in mine:
            if inb(r, q) and margin(r, q) >= 500: return r
    return None

def box_at(clat, clng, side):
    h = side / 2; return dict(north=clat + h / KZ, south=clat - h / KZ, west=clng - h / kx(clat), east=clng + h / kx(clat))

def place(shots, side, need, want=None, aim=None, inside=None):
    """Greedy cover. For each shot, the centres (metres east / north of a reference) that keep its `need` points inside
    with their margins (and `want` points too where that is possible) form a rectangle; shots are joined while their
    rectangles overlap. inside(shot) -> a box the result must stay inside, or None. Returns [(centre lat, lng, shots)]."""
    lat0 = float(np.mean([s['v'][0] for s in shots])); k0 = kx(lat0)
    XY = lambda p: (p[1] * k0, p[0] * KZ)
    h = side / 2
    rects = []
    for s in shots:
        lo = [-1e18, -1e18]; hi = [1e18, 1e18]
        for p, m in need(s):
            x, y = XY(p); lo = [max(lo[0], x - (h - m)), max(lo[1], y - (h - m))]; hi = [min(hi[0], x + (h - m)), min(hi[1], y + (h - m))]
        for p, m in (want(s) if want else []):
            x, y = XY(p); l2 = [max(lo[0], x - (h - m)), max(lo[1], y - (h - m))]; h2 = [min(hi[0], x + (h - m)), min(hi[1], y + (h - m))]
            if l2[0] <= h2[0] and l2[1] <= h2[1]: lo, hi = l2, h2
        nb = inside(s) if inside else None
        if nb:
            l2 = [max(lo[0], nb['west'] * k0 + h), max(lo[1], nb['south'] * KZ + h)]; h2 = [min(hi[0], nb['east'] * k0 - h), min(hi[1], nb['north'] * KZ - h)]
            if l2[0] <= h2[0] and l2[1] <= h2[1]: lo, hi = l2, h2
            else: s.setdefault('notes', []).append('box cannot sit inside its near box')
        if lo[0] > hi[0] or lo[1] > hi[1]: s.setdefault('notes', []).append('needs cannot all fit one box'); mid = [(lo[0] + hi[0]) / 2] * 2; lo = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; hi = list(lo)
        rects.append(dict(lo=lo, hi=hi, shots=[s], key=None if not inside else id(nb) if nb else None))
    # join, the pair whose overlap is biggest first, while the overlap is not empty (and the same near box)
    while True:
        best = None
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a, b = rects[i], rects[j]
                if a['key'] != b['key']: continue
                lo = [max(a['lo'][0], b['lo'][0]), max(a['lo'][1], b['lo'][1])]; hi = [min(a['hi'][0], b['hi'][0]), min(a['hi'][1], b['hi'][1])]
                if lo[0] > hi[0] or lo[1] > hi[1]: continue
                ar = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1)
                if best is None or ar > best[0]: best = (ar, i, j, lo, hi)
        if not best: break
        _, i, j, lo, hi = best; rects[i] = dict(lo=lo, hi=hi, shots=rects[i]['shots'] + rects[j]['shots'], key=rects[i]['key']); del rects[j]
    out = []
    for r in rects:
        # the centre: inside the rectangle, as near as possible to the mean aim point
        tx, ty = np.mean([XY(aim(s)) for s in r['shots']], 0) if aim else ((r['lo'][0] + r['hi'][0]) / 2, (r['lo'][1] + r['hi'][1]) / 2)
        cx = min(max(tx, r['lo'][0]), r['hi'][0]); cy = min(max(ty, r['lo'][1]), r['hi'][1])
        out.append((cy / KZ, cx / k0, r['shots']))
    return out
