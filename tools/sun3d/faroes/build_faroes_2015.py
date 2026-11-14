#!/usr/bin/env python3
"""Faroes 3D terrain from the agency's 2015 surface model (DSM), every level (14 Nov 2026).

  python3 build_faroes_2015.py <step> <work> --dsm FO_DSM_2015_FOTM_2M.tif [--pins pins.json]

steps (each reads what the ones before it wrote; run them in this order, or `all`):
  clean   whole islands, 2048-cell windows: blunders (floating patches cut off by 30 m jumps all round, 30 m off the ground
          round them, not backed by the 2009 10 m contours) and land holes (nodata inside the coastline) filled from the
          2009 contours (never ArcticDEM); water holes (no contour above 2 m, low rim: lagoons, harbour basins) flat; every
          building footprint filled from the ground round it. Writes <work>/clean/agg16.npz (16 m blocks of the BARE
          ground: mean with sea = 0, max) and <work>/clean/report.json (every hole, water hole and blunder, with where).
  wide    the region's wide file (terrain_regions 'faroes', 2048 x 2048, same box as today) from those blocks: area
          mean, every isolated top (summits, stacks) kept at its block's top.
  plan    the boxes (plan_2015.py): range (2 m, 4,096 m), near (the 11 existing + a new one for Klakkur), detail (1 m, 1,504 m).
  range / near / detail   each box: its native window cleaned with the 2 m contours, resampled; detail also gets its mask,
          aerial photo (same grading as round 2) and the shot coverage.
  houses  every building of the islands with heights measured in the DSM, in tiles (terrain_house_tiles format).
  sql     the draft migration and upload list.
"""
import argparse, json, math, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE)); sys.dont_write_bytecode = True
import dsm2015 as D
import plan_2015 as P

REGION = dict(id='faroes', north=62.42, south=61.78, west=-7.72, east=-6.25, n=2048, width_m=76572, depth_m=71124, base_m=0, step_m=0.5)
WIN = 2048; PAD = 64

G = {}
def init(a):
    from build_detail_faroes import Agency
    if 'dsm' in G: return
    G['dsm'] = D.DSM(a.dsm, keep=900); G['ag'] = Agency(f"{a.work}/cache/us", a.pace)
    G['lay'] = D.Layers(G['ag'], G['dsm'], a.work); G['con'] = D.Contours(Agency(f"{a.work}/cache/c", a.pace), f"{a.work}/cache")

# ---------- clean: whole islands ----------
def clean_one(job):
    a = G['a']; init(a); dsm = G['dsm']; r0, c0 = job
    win = (c0 - PAD, r0 - PAD, WIN + 2 * PAD, WIN + 2 * PAD)
    raw = dsm.read(*win)
    B = 8; n = WIN // B; core = (slice(PAD, PAD + WIN), slice(PAD, PAD + WIN))
    if np.isnan(raw[core]).all():
        return dict(r0=r0, c0=c0, mean=np.zeros((n, n), np.float32), mx=np.full((n, n), -1.0, np.float32), land=np.zeros((n, n), np.uint8), stats=None)
    C = D.clean(dsm, win, G['lay'], G['con'], two=False)
    st = C['stats']
    # keep only the patches whose middle is in this window's core (each once)
    X, Y = C['X'], C['Y']; xs0, xs1, ys1, ys0 = X[PAD], X[PAD + WIN - 1], Y[PAD], Y[PAD + WIN - 1]
    def mine(p):
        x, y = dsm.xy(p['lat'], p['lng']); return xs0 - 1 <= x <= xs1 + 1 and ys0 - 1 <= y <= ys1 + 1
    for k in ('blunders', 'holes', 'water_holes'): st[k] = [p for p in st[k] if mine(p)]
    b = C['bare'][core]; sea = C['sea'][core]
    mean = b.reshape(n, B, n, B).mean((1, 3)).astype(np.float32)
    mx = np.where(sea, -1.0, b).reshape(n, B, n, B).max((1, 3)).astype(np.float32)
    land = (~sea).reshape(n, B, n, B).sum((1, 3)).astype(np.uint8)
    return dict(r0=r0, c0=c0, mean=mean, mx=mx, land=land, stats={k: v for k, v in st.items()})

def step_clean(a):
    from concurrent.futures import ProcessPoolExecutor
    init(a); dsm = G['dsm']; G['lay'].coast(); G['lay'].buildings(); G['lay'].lakes(); G['con'].ten()   # fetched once before the workers start
    out = f"{a.work}/clean"; os.makedirs(out, exist_ok=True)
    jobs = [(r, c) for r in range(0, dsm.H, WIN) for c in range(0, dsm.W, WIN)]
    B = 8; nb_r, nb_c = -(-dsm.H // B), -(-dsm.W // B); n = WIN // B
    MEAN = np.zeros((nb_r + n, nb_c + n), np.float32); MX = np.full_like(MEAN, -1.0); LAND = np.zeros_like(MEAN, dtype=np.uint8)
    rep = dict(blunders=[], holes=[], water_holes=[]); tot = {}
    t0 = time.time()
    with ProcessPoolExecutor(a.jobs, initializer=_set_a, initargs=(a,)) as ex:
        for k, o in enumerate(ex.map(clean_one, jobs)):
            br, bc = o['r0'] // B, o['c0'] // B
            MEAN[br:br + n, bc:bc + n] = o['mean']; MX[br:br + n, bc:bc + n] = o['mx']; LAND[br:br + n, bc:bc + n] = o['land']
            if o['stats']:
                for key in rep: rep[key] += o['stats'][key]
                for key, v in o['stats'].items():
                    if isinstance(v, int): tot[key] = tot.get(key, 0) + v
            if k % 40 == 0: print(f"clean {k}/{len(jobs)} {time.time() - t0:.0f} s", flush=True)
    np.savez_compressed(f"{out}/agg16.npz", mean=MEAN[:nb_r, :nb_c], mx=MX[:nb_r, :nb_c], land=LAND[:nb_r, :nb_c], X0=dsm.X0, Y0=dsm.Y0, B=B * dsm.PX)
    for key in rep: rep[key].sort(key=lambda p: -p['cells'])
    rep['totals'] = tot
    json.dump(rep, open(f"{out}/report.json", 'w'), indent=0)
    print(json.dumps(tot)); print({k: (len(v), sum(p['cells'] for p in v)) for k, v in rep.items() if k != 'totals'})

def _set_a(a):
    G.clear(); G['a'] = a   # a worker opens its own file (a handle shared over fork would mix up reads)

# ---------- wide ----------
def step_wide(a):
    from scipy import ndimage
    from build_detail_faroes import write_heights
    init(a); dsm = G['dsm']; A = np.load(f"{a.work}/clean/agg16.npz"); mean, mx = A['mean'], A['mx']
    R = REGION; n = R['n']; H, W = mean.shape
    X = A['X0'] + (np.arange(W) + 0.5) * float(A['B']); Y = A['Y0'] - (np.arange(H) + 0.5) * float(A['B'])
    S = np.zeros(n * n); C = np.zeros(n * n); M = np.full(n * n, -1.0)
    for r0 in range(0, H, 256):
        XX, YY = np.meshgrid(X, Y[r0:r0 + 256]); la, lo = dsm.ll(XX, YY)
        ti = np.floor((R['north'] - la) / (R['north'] - R['south']) * n).astype(int); tj = np.floor((lo - R['west']) / (R['east'] - R['west']) * n).astype(int)
        ok = (ti >= 0) & (tj >= 0) & (ti < n) & (tj < n); k = (ti * n + tj)[ok]
        np.add.at(S, k, mean[r0:r0 + 256][ok]); np.add.at(C, k, 1); np.maximum.at(M, k, mx[r0:r0 + 256][ok])
    S, C, M = S.reshape(n, n), C.reshape(n, n), M.reshape(n, n)
    g = np.where(C > 0, S / np.maximum(C, 1), 0.0)
    if (C == 0).any(): print(f"wide: {(C == 0).sum()} cells with no block (left at 0)")
    # every isolated top (a summit, a stack): a cell whose highest block stands at least 0.3 m over the highest block of
    # each of its 8 neighbours keeps that height. (Ties allowed along a cliff top raised the whole edge into a comb.)
    fp = np.ones((3, 3), bool); fp[1, 1] = False
    top = (M > ndimage.maximum_filter(M, footprint=fp, mode='nearest') + 0.3) & (M > g + 3.0)
    g = np.where(top, M, g); g = np.maximum(g, 0.0)
    os.makedirs(f"{a.work}/files", exist_ok=True); path = f"{a.work}/files/faroes_dsm15_wide.png"
    write_heights(path, g, R['base_m'], R['step_m'])
    np.save(f"{a.work}/clean/wide.npy", g.astype(np.float32))
    print(f"wide: {path} {os.path.getsize(path) / 1e6:.2f} MB, heights {g.min():.1f}..{g.max():.1f} m, isolated tops kept {int(top.sum())}")


# ---------- plan ----------
NEARS_KEEP = 'near_before.json'   # the existing fine boxes (select * from terrain_near_regions where parent = 'faroes')

def load_shots(a):
    rows = json.load(open(a.pins or f"{a.work}/shots_all.json")); shots = {}
    for r in rows:
        s = shots.setdefault(r['vid'], dict(vid=r['vid'], stop=r['stop'], stops=[], shot=r['shot'], subject=r['subj'], v=(r['vlat'], r['vlng']), s=(r['slat'], r['slng'])))
        if r['stop'] not in s['stops']: s['stops'].append(r['stop'])
    out = list(shots.values())
    for s in out: s['d'] = math.hypot((s['s'][0] - s['v'][0]) * P.KZ, (s['s'][1] - s['v'][1]) * P.kx(s['v'][0]))
    return out

def name_of(shots, used, prefix):
    from build_trip_terrain import slug
    cnt = {}
    for s in shots:
        for st in s['stops']: cnt[st] = cnt.get(st, 0) + 1
    base = f"{prefix}_{slug(max(cnt, key=lambda k: (cnt[k], -len(k))))}"; bid = base; k = 2
    while bid in used: bid = f"{base}_{k}"; k += 1
    used.add(bid); return bid

def rnd(b): return {k: round(v, 6) for k, v in b.items()}

def step_plan(a):
    shots = load_shots(a); R = REGION
    nears = [dict(r) for r in json.load(open(f"{a.work}/{NEARS_KEEP}")) if r['parent'] == 'faroes']
    for s in shots: s['near'] = P.pick_near(nears, R, s['v'], s['s'])
    # a new fine box where none serves the stand pin (Klakkur): 6 km, the stand pin a third of the way in toward the subject
    for s in shots:
        if s['near']: continue
        la = s['v'][0] + (s['s'][0] - s['v'][0]) * 0.35; lo = s['v'][1] + (s['s'][1] - s['v'][1]) * 0.35
        from build_trip_terrain import slug
        b = rnd(P.box_at(la, lo, 6000)); b.update(id=f"fo_{slug(s['stop'])}", parent='faroes', new=True); nears.append(b)
        for t in shots: t['near'] = P.pick_near(nears, R, t['v'], t['s'])
    used = set()
    rg = P.place(shots, 4096, need=lambda s: [(s['s'], 1060)], want=lambda s: [(s['v'], 250)], aim=lambda s: P.aim_point(s['v'], s['s'])[0])
    ranges = []
    for la, lo, ss in rg:
        b = rnd(P.box_at(la, lo, 4096)); b.update(id=name_of(ss, used, 'for15'), parent='faroes', n=2048, cell_m=2.0, shots=[x['vid'] for x in ss]); ranges.append(b)
    dg = P.place(shots, 1504, need=lambda s: [(s['v'], 170)], want=lambda s: [(s['s'], 60)], aim=lambda s: ((s['v'][0] + s['s'][0]) / 2, (s['v'][1] + s['s'][1]) / 2), inside=lambda s: s['near'])
    dets = []
    for la, lo, ss in dg:
        b = P.box_at(la, lo, 1504); nb = ss[0]['near']
        if nb:   # exactly inside the shot's fine box (the page draws the detail inside it)
            sh = (min(0, nb['north'] - b['north'] - 1e-6) + max(0, nb['south'] - b['south'] + 1e-6)); b['north'] += sh; b['south'] += sh
            sh = (min(0, nb['east'] - b['east'] - 1e-6) + max(0, nb['west'] - b['west'] + 1e-6)); b['east'] += sh; b['west'] += sh
        b = rnd(b); b.update(id=name_of(ss, used, 'fod15'), parent='faroes', n=1504, cell_m=1.0, near=nb and nb['id'], shots=[x['vid'] for x in ss]); dets.append(b)
    # the checks, as the phone will choose
    cov = []
    for s in shots:
        nr = P.pick_near(nears, R, s['v'], s['s']); dt = P.pick_detail(dets, R, nr, s['v'], s['s']); rgb = P.pick_range(ranges, R, s['v'], s['s'])
        e = dict(vid=s['vid'], stops=s['stops'], shot=s['shot'], subject=s['subject'], stand=s['v'], subject_pin=s['s'], subject_m=round(s['d']), near=nr and nr['id'], detail=dt and dt['id'], range=rgb and rgb['id'],
                 stand_in_detail_m=dt and round(P.margin(dt, s['v'])), subject_in_detail=bool(dt and P.inb(dt, s['s'])), subject_in_near_m=nr and round(P.margin(nr, s['s'])),
                 subject_in_range_m=rgb and round(P.margin(rgb, s['s'])), stand_in_range_m=rgb and round(P.margin(rgb, s['v'])))
        e['sharp_stand'] = bool(dt) ; e['sharp_subject'] = bool((dt and e['subject_in_detail']) or (rgb and e['subject_in_range_m'] >= 1000))
        cov.append(e)
    json.dump(dict(nears=nears, ranges=ranges, details=dets, coverage=cov), open(f"{a.work}/plan.json", 'w'), indent=1, ensure_ascii=False)
    print(f"plan: {len(ranges)} range boxes, {len(nears)} near boxes ({sum(1 for n in nears if n.get('new'))} new), {len(dets)} detail boxes, {len(shots)} shots")
    for e in cov:
        flags = [] if e['detail'] else ['NO DETAIL']
        if not e['range']: flags.append('NO RANGE')
        if e['range'] and e['stand_in_range_m'] < 0: flags.append(f"stand {-e['stand_in_range_m']} m outside its range box")
        if not e['subject_in_detail'] and e['subject_m'] < 1300: flags.append('subject outside its detail box')
        if flags: print(f"  {e['stops'][0][:40]} / {e['shot']} ({e['subject_m']} m): {'; '.join(flags)}")

# ---------- range / near / detail boxes ----------
STEP = 0.02

def level_one(job):
    kind, b = job; a = G['a']; init(a); dsm, lay, con = G['dsm'], G['lay'], G['con']
    from build_detail_faroes import write_heights
    from build_trip_terrain import read_png
    box = (b['north'], b['south'], b['west'], b['east']); n = b['n']; t0 = time.time()
    win = D.window_for(dsm, box, pad=150.0)
    C = D.clean(dsm, win, lay, con, two=True)
    hgt = D.to_grid(dsm, win, C['smooth'], box, n, order=3 if kind == 'detail' else 1, sea=C['sea'], tops=C['bare'])
    sea = D.mask_grid(dsm, win, C['sea'] | C['water'], box, n)
    # A narrow apron on the sea side of every shore (3 cells in the 1 m boxes, 2 elsewhere): the page's meshes sample the
    # heights at their own points (2-30 m apart), and a shore that drops from a cliff to 0 within one cell turned into a
    # comb of thin walls with ragged feet. The apron (the land's heights blurred one apron width out over the sea, never
    # higher than they were) gives the cliff a foot the mesh can follow; the mask still says sea there.
    from scipy import ndimage
    k = 3 if kind == 'detail' else 2
    blur = ndimage.gaussian_filter(np.where(sea, 0.0, hgt), k)
    apron = sea & ndimage.binary_dilation(~sea, iterations=2 * k)
    hgt = np.where(apron, np.maximum(hgt, blur), hgt).astype(np.float32)
    base = math.floor(float(hgt.min())) - 2
    F = f"{a.work}/files"; os.makedirs(F, exist_ok=True); os.makedirs(f"{a.work}/raw", exist_ok=True)
    name = {'range': f"{b['id']}.png", 'near': f"{b['id']}_dsm15.png", 'detail': f"{b['id']}_ground.png"}[kind]
    write_heights(f"{F}/{name}", hgt, base, STEP)
    assert np.abs(read_png(f"{F}/{name}", base, STEP) - hgt).max() <= STEP / 2 + 1e-3
    np.savez_compressed(f"{a.work}/raw/{b['id']}.npz", h=hgt.astype(np.float32), sea=sea, box=np.array(box))
    st = C['stats']; kxl = P.kx((box[0] + box[1]) / 2)
    row = dict(b, base_m=base, step_m=STEP, path=name, bytes=os.path.getsize(f"{F}/{name}"), width_m=round((box[3] - box[2]) * kxl, 1), depth_m=round((box[0] - box[1]) * P.KZ, 1),
               hmin=round(float(hgt.min()), 1), hmax=round(float(hgt.max()), 1), sea_share=round(float(sea.mean()), 3),
               cleaned=dict(holes=st['holes'], water_holes=st['water_holes'], blunders=st['blunders'], hole_cells=st['hole_cells'], blunder_cells=st['blunder_cells'], water_cells=st['water_cells'], buildings_filled=st['buildings']), secs=round(time.time() - t0))
    if kind == 'detail': row.update(detail_extras(b, box, n, sea))
    print(f"{kind} {b['id']}: {n} cells, {row['hmin']}..{row['hmax']} m, {row['bytes'] / 1e6:.2f} MB; land holes {st['hole_cells']} cells, blunders {st['blunder_cells']}, water holes {st['water_cells']}; {row['secs']} s", flush=True)
    return kind, row

def detail_extras(b, box, n, sea):
    """The detail box's mask (0 ground, 3 sea / lake / lagoon, 4 stream) and aerial photo, as round 2 made them."""
    from scipy import ndimage
    from build_detail_faroes import raster, write_mask, read_mask, photo, save_jpeg, attr, grow
    from PIL import Image
    a = G['a']; ag = G['ag']; F = f"{a.work}/files"; cell = 1.0
    lakes = ag.features('topo/topo_20/MapServer/120', box) + ag.features('topo/topo_20/MapServer/119', box)
    lake = np.zeros((n, n), bool)
    for f in lakes:
        if not f.get('geometry', {}).get('rings'): continue
        m = raster(n, box, [f['geometry']['rings']], 'poly') > 0.5
        if m.sum() >= 20: lake |= m
    s1 = ag.features('lendiskort/us_lendiskort/MapServer/106', box); s2 = [f for f in ag.features('topo/topo_20/MapServer/108', box) if f.get('geometry', {}).get('paths')]
    wpx = lambda w: max(1.0, (w or 1.0) / cell)
    s1 = [f for f in s1 if f.get('geometry', {}).get('paths')]
    r1 = raster(n, box, [f['geometry']['paths'] for f in s1], 'line', [wpx(1.5)] * len(s1)) > 0.5 if s1 else np.zeros((n, n), bool)
    r2 = raster(n, box, [f['geometry']['paths'] for f in s2], 'line', [wpx(attr(f, 'WID')) for f in s2]) > 0.5 if s2 else np.zeros((n, n), bool)
    r2n = r2 & ~grow(r1, round(14 / cell)) if r1.any() else r2
    lab, k = ndimage.label(r2n, structure=np.ones((3, 3)))
    if k:
        sz = ndimage.sum(r2n, lab, range(1, k + 1)); r2n = np.isin(lab, [i + 1 for i in range(k) if sz[i] * cell >= 30])
    stream = (r1 | r2n) & ~sea & ~lake
    mask = np.zeros((n, n), np.uint8); mask[stream] = 4; mask[sea | lake] = 3
    mp = f"{F}/{b['id']}_mask.png"; write_mask(mp, mask); assert (read_mask(mp) == mask).all()
    PX = 2048
    seaP = np.asarray(Image.fromarray((sea | lake).astype(np.uint8) * 255).resize((PX, PX), Image.NEAREST)) > 127
    rgb0, rgb, top, nod, pst = photo(b['id'], box, 1504.0, seaP, ag, PX)
    jp = f"{F}/{b['id']}_photo.jpg"; jsize, jq, jbytes = save_jpeg(jp, rgb)
    os.makedirs(f"{a.work}/look", exist_ok=True)
    Image.fromarray(rgb).resize((1024, 1024)).save(f"{a.work}/look/{b['id']}_photo.jpg", quality=80)
    return dict(mask_path=os.path.basename(mp), mask_bytes=os.path.getsize(mp), color_path=os.path.basename(jp), color_bytes=jbytes, color_px=jsize,
                photo_surveys=[f"{s_['file']} {s_['year']} {s_['aircraft']}" for s_ in pst['surveys'] if s_['share'] > 0.01], stream_cells=int(stream.sum()), lake_cells=int(lake.sum()))

def near_photo(b):
    """A new fine box's aerial photo (the existing ones keep theirs: same box, same picture)."""
    from build_detail_faroes import photo, save_jpeg
    from PIL import Image
    a = G['a']; ag = G['ag']; F = f"{a.work}/files"; PX = 2048
    raw = np.load(f"{a.work}/raw/{b['id']}.npz"); seaP = np.asarray(Image.fromarray(raw['sea'].astype(np.uint8) * 255).resize((PX, PX), Image.NEAREST)) > 127
    side = max((b['east'] - b['west']) * P.kx((b['north'] + b['south']) / 2), (b['north'] - b['south']) * P.KZ)
    _, rgb, _, _, pst = photo(b['id'], (b['north'], b['south'], b['west'], b['east']), side, seaP, ag, PX)
    jp = f"{F}/{b['id']}_photo.jpg"; jsize, jq, jbytes = save_jpeg(jp, rgb, 600_000)
    return dict(color_path=os.path.basename(jp), color_bytes=jbytes)

def step_boxes(a, kinds):
    from concurrent.futures import ProcessPoolExecutor
    pl = json.load(open(f"{a.work}/plan.json"))
    jobs = []
    for kind in kinds:
        items = pl['ranges'] if kind == 'range' else pl['details'] if kind == 'detail' else pl['nears']
        for b in items:
            if a.only and b['id'] not in a.only.split(','): continue
            if not a.only and os.path.exists(f"{a.work}/levels.json") and b['id'] in json.load(open(f"{a.work}/levels.json")).get(kind, {}): continue   # built already
            if kind == 'near':
                side = max((b['east'] - b['west']) * P.kx((b['north'] + b['south']) / 2), (b['north'] - b['south']) * P.KZ)
                b = dict(b, n=int(min(2048, math.ceil(side / 2.0 / 64) * 64)))
            jobs.append((kind, b))
    path = f"{a.work}/levels.json"; prev = json.load(open(path)) if os.path.exists(path) else {}
    with ProcessPoolExecutor(a.jobs, initializer=_set_a, initargs=(a,)) as ex:
        for kind, row in ex.map(level_one, jobs):
            prev.setdefault(kind, {})[row['id']] = row
            json.dump(prev, open(path, 'w'), indent=1, ensure_ascii=False)
    if 'near' in kinds:
        _set_a(a); init(a)
        for b in pl['nears']:
            if b.get('new') and b['id'] in prev.get('near', {}): prev['near'][b['id']].update(near_photo(b))
        json.dump(prev, open(path, 'w'), indent=1, ensure_ascii=False)

def step_range(a): step_boxes(a, ['range'])
def step_near(a): step_boxes(a, ['near'])
def step_detail(a): step_boxes(a, ['detail'])

# ---------- houses: every building of the islands, heights measured in the DSM ----------
HT = 16   # tiles a side over the region (4.8 x 4.4 km): the app takes those within 8 km of the stand pin

def tile_box(tr, tc):
    R = REGION; dlat, dlng = (R['north'] - R['south']) / HT, (R['east'] - R['west']) / HT
    return (round(R['north'] - tr * dlat, 6), round(R['north'] - (tr + 1) * dlat, 6), round(R['west'] + tc * dlng, 6), round(R['west'] + (tc + 1) * dlng, 6))

def fit_roof(u, v, h, hs):
    """Heights above the ground h at cells (u along the long side, v across, from the outline's centre); hs = half the
    short side. Gable (ridge along the long side or across it) or flat, whichever fits the DSM best (median miss)."""
    flat = float(np.percentile(h, 60)); best = dict(roof='flat', e=flat, r=flat, axis=0, res=float(np.median(np.abs(h - flat))), pitch=0.0)
    for axis, across in ((0, np.abs(v)), (1, np.abs(u))):
        if len(h) < 3 or np.ptp(across) < 1.0: continue
        A = np.c_[np.ones_like(across), -across]
        try: coef, *_ = np.linalg.lstsq(A, h, rcond=None)
        except Exception: continue
        top, slope = coef
        if slope <= 0: continue
        res = float(np.median(np.abs(h - A @ coef)))
        half = hs if axis == 0 else max(np.abs(u).max(), hs)
        pitch = math.degrees(math.atan(slope))
        if res < best['res'] - 0.05 and 8 <= pitch <= 60:
            best = dict(roof='gable', e=float(top - slope * half), r=float(top), axis=axis, res=res, pitch=pitch, half=float(half))
    return best

def houses_tile(job):
    """One tile's buildings: the DSM read once, every footprint drawn, the ground under them filled from round them,
    each building's cells fitted."""
    from scipy import ndimage
    from PIL import Image, ImageDraw
    from build_detail_faroes import fill, min_rect
    (tr, tc), idx = job; a = G['a']; init(a); dsm, lay = G['dsm'], G['lay']; blds = lay.buildings()
    tn, ts, tw, te = tile_box(tr, tc); kxt = P.kx((tn + ts) / 2)
    mine = [blds[i] for i in idx]
    if not mine: return (tr, tc), []
    bb = np.array([b['bb'] for b in mine]); x0, x1, y0, y1 = bb[:, 0].min(), bb[:, 1].max(), bb[:, 2].min(), bb[:, 3].max()
    win = dsm.cells(x0, x1, y0, y1, 16.0); c0, r0, w, h = win; raw = dsm.read(*win)
    # every building in the window (also the neighbours from other tiles) out of the ground
    allb = lay.in_box('blds', x0 - 16, x1 + 16, y0 - 16, y1 + 16)
    foot_any = D.draw_polys(dsm, win, [b['rings'] for b in allb])
    ground = fill(np.nan_to_num(raw).astype(np.float64), ~ndimage.binary_dilation(foot_any, iterations=1) & ~np.isnan(raw))
    lab = Image.new('I', (w, h), 0); dr = ImageDraw.Draw(lab)
    X, Y = dsm.centre(*win)
    for k, b in enumerate(mine):
        for r in b['rings']:
            dr.polygon([((x - (dsm.X0 + c0 * dsm.PX)) / dsm.PX, ((dsm.Y0 - r0 * dsm.PX) - y) / dsm.PX) for x, y in r], fill=k + 1)
    L = np.asarray(lab)
    objs = ndimage.find_objects(L, max_label=len(mine))
    out = []
    for k, b in enumerate(mine):
        ring = max(b['rings'], key=len); pts = ring[:-1] if len(ring) > 1 and np.allclose(ring[0], ring[-1]) else ring
        if len(pts) < 3: continue
        c, ax, hl, hs, rect = min_rect([tuple(p) for p in pts])
        area = abs(float(np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1]))) / 2
        sl = objs[k] if k < len(objs) else None
        hh = None; meas = 'dsm'
        if sl is not None:
            m = L[sl] == k + 1; ry, rx = np.nonzero(m); ry = ry + sl[0].start; rx = rx + sl[1].start
            v = raw[ry, rx]; ok = ~np.isnan(v)
            if ok.sum() >= 1:
                hh = (v - ground[ry, rx])[ok]; px = X[rx][ok] - c[0]; py = Y[ry][ok] - c[1]
                u = px * ax[0] + py * ax[1]; vv = -px * ax[1] + py * ax[0]
        cx_c = int(np.clip((c[0] - X[0]) / dsm.PX, 0, w - 1)); cy_c = int(np.clip((Y[0] - c[1]) / dsm.PX, 0, h - 1))
        g0 = float(ground[cy_c, cx_c])
        # The 2015 file smooths buildings nearly away: over 31,761 outlines the fitted ridge is 2.5 m (median), churches
        # read 2-5 m over their yards (Vesturkirkjan, a 46 m-high spire, reads 5 m). So the round 2 guesses stay the
        # heights (house eave 2.6 / ridge 4.4 m, shed 1.9 / 2.6, hall over 300 m2 4 / 6, church 4.8 / 8, no roof steeper
        # than 40 degrees), and the DSM's own fit is used only where it is clearly HIGHER than the guess (h: dsm): a big
        # shed, a block of flats. Roof form and ridge direction come from the outline (gable along its long side when
        # the outline is a rectangle-ish shape at least 2.4 m wide).
        church = 'kirkj' in str(b['a'].get('name') or '').lower()
        if church: ge, gr = 4.8, 8.0
        elif area < 20: ge, gr = 1.9, 2.6
        elif area <= 300: ge, gr = 2.6, 4.4
        else: ge, gr = 4.0, 6.0
        gform = 'gable' if area / max(rect, 1e-6) >= 0.6 and hs >= 1.2 else 'flat'
        if not church: gr = min(gr, ge + hs * math.tan(math.radians(40)))
        if gform == 'flat': ge = gr = ge + 0.4 * (gr - ge)
        roof = dict(roof=gform, e=ge, r=gr, axis=0, pitch=0.0, half=hs); meas = 'assumed'
        if hh is not None and len(hh) >= 6 and 2 * hs >= 7.0 and np.percentile(hh, 90) >= 2.0:
            fit = fit_roof(u, vv, hh, hs)
            fit['e'] = max(1.8, min(fit['e'], 60.0)); fit['r'] = max(fit['e'], min(fit['r'], 70.0))
            if fit['r'] > gr + 0.5: roof, meas = fit, 'dsm'
        ang = ax if roof.get('axis', 0) == 0 else np.array([-ax[1], ax[0]])
        a_deg = math.degrees(math.atan2(-ang[1], ang[0])) % 180          # ridge direction in the page's frame (x east, z south)
        hw = roof.get('half', hs) if roof['roof'] == 'gable' else hs
        la, lo = dsm.ll(pts[:, 0], pts[:, 1]); cla, clo = dsm.ll(c[0], c[1])
        p = [round(float(q), 1) for xy in zip((lo - tw) * kxt, (tn - la) * P.KZ) for q in xy]
        rec = dict(p=p, g=round(g0, 1), e=round(roof['e'], 1), r=round(roof['r'], 1), a=round(a_deg, 1), hw=round(float(hw), 1), roof=roof['roof'],
                   c=[round(float((clo - tw) * kxt), 1), round(float((tn - cla) * P.KZ), 1)], h=meas)
        at = b['a']; rec['_info'] = dict(name=at.get('name'), building_id=at.get('building_id'), type=at.get('building_type'), purpose=at.get('primary_purpose'), year=at.get('construction_year'),
                                         area=round(area), lat=round(float(cla), 6), lng=round(float(clo), 6), pitch=round(roof.get('pitch', 0.0), 1), res=round(roof.get('res', 0.0), 2), cells=int(len(hh)) if hh is not None else 0, sketched=b['sketched'])
        out.append(rec)
    return (tr, tc), out

def step_houses(a):
    from concurrent.futures import ProcessPoolExecutor
    init(a); dsm, lay = G['dsm'], G['lay']; blds = lay.buildings(); R = REGION
    jobs = {}
    for i, b in enumerate(blds):
        cx, cy = (b['bb'][0] + b['bb'][1]) / 2, (b['bb'][2] + b['bb'][3]) / 2; la, lo = dsm.ll(cx, cy)
        tr, tc = int((R['north'] - la) / (R['north'] - R['south']) * HT), int((lo - R['west']) / (R['east'] - R['west']) * HT)
        if 0 <= tr < HT and 0 <= tc < HT: jobs.setdefault((tr, tc), []).append(i)
    print(f"houses: {sum(len(v) for v in jobs.values())} buildings in {len(jobs)} tiles (of {len(blds)} outlines)", flush=True)
    res = {}
    with ProcessPoolExecutor(a.jobs, initializer=_set_a, initargs=(a,)) as ex:
        for key, out in ex.map(houses_tile, sorted(jobs.items(), key=lambda kv: -len(kv[1]))): res[key] = out
    json.dump({f"{k[0]}_{k[1]}": v for k, v in res.items()}, open(f"{a.work}/houses_raw.json", 'w'))
    allb = [r for v in res.values() for r in v]
    print(f"houses: {len(allb)} measured; from the DSM {sum(1 for r in allb if r['h'] == 'dsm')}, assumed {sum(1 for r in allb if r['h'] == 'assumed')}; gable {sum(1 for r in allb if r['roof'] == 'gable')}")

def step_housefiles(a):
    """The tiles as the app reads them (terrain_house_tiles), with each roof's colour from the aerial photos where one covers it."""
    from PIL import Image
    res = json.load(open(f"{a.work}/houses_raw.json")); lv = json.load(open(f"{a.work}/levels.json")); pl = json.load(open(f"{a.work}/plan.json"))
    photos = []   # (box, path): detail photos first (finer), then the fine boxes'
    for r in lv.get('detail', {}).values():
        if r.get('color_path'): photos.append(((r['north'], r['south'], r['west'], r['east']), f"{a.work}/files/{r['color_path']}"))
    for r in pl['nears']:
        lr = lv.get('near', {}).get(r['id'], {})
        cp = lr.get('color_path') or r.get('color_path')
        if cp:
            pth = f"{a.work}/files/{cp}" if os.path.exists(f"{a.work}/files/{cp}") else f"{a.work}/before_files/{cp}"
            if os.path.exists(pth): photos.append(((r['north'], r['south'], r['west'], r['east']), pth))
    imgs = {}
    def colour(la, lo, rad_m):
        for box, pth in photos:
            if not (box[1] < la < box[0] and box[2] < lo < box[3]): continue
            if pth not in imgs: imgs[pth] = np.asarray(Image.open(pth).convert('RGB')).astype(np.float32)
            im = imgs[pth]; n = im.shape[0]; r = int((box[0] - la) / (box[0] - box[1]) * n); c = int((lo - box[2]) / (box[3] - box[2]) * n)
            px = max(1, int(rad_m / ((box[0] - box[1]) * P.KZ / n)))
            w = im[max(0, r - px):r + px + 1, max(0, c - px):c + px + 1].reshape(-1, 3)
            if len(w): return np.median(w, 0)
        return None
    F = f"{a.work}/files"; rows = []; tot = 0; coloured = 0
    for key, L in sorted(res.items()):
        tr, tc = map(int, key.split('_')); tn, ts, tw, te = tile_box(tr, tc); b_out = []
        for k, r in enumerate(L):
            info = r.pop('_info'); rec = dict(r, id=(tr * HT + tc) * 40000 * 4 + k * 4)
            col = colour(info['lat'], info['lng'], max(1.0, math.sqrt(max(info['area'], 4)) / 3))
            if col is not None:
                g = float(col @ np.array([0.299, 0.587, 0.114])); roof = g + (col - g) * 0.7; wall = (g + (col - g) * 0.35) * 0.72 + 14
                rec['rc'] = [int(round(float(v))) for v in np.clip(roof, 0, 255)]; rec['wc'] = [int(round(float(v))) for v in np.clip(wall, 0, 255)]; coloured += 1
            b_out.append(rec)
        if not b_out: continue
        path = f"{F}/fob15_{tr}_{tc}.json"
        open(path, 'w').write(json.dumps(dict(v=1, box=[tn, ts, tw, te], heights='measured in the 2015 DSM (h: dsm) or assumed (h: assumed)', sun_checks=False, b=b_out), separators=(',', ':')))
        rows.append(dict(id=f"fob15_{tr}_{tc}", parent='faroes', north=tn, south=ts, west=tw, east=te, path=os.path.basename(path), bytes=os.path.getsize(path), count=len(b_out))); tot += len(b_out)
    json.dump(rows, open(f"{a.work}/house_rows.json", 'w'), indent=1)
    print(f"house tiles: {len(rows)} files, {tot} buildings ({coloured} with a photo colour), {sum(r['bytes'] for r in rows) / 1e6:.2f} MB")

# ---------- sql: the draft migration and the upload list ----------
CREDIT_2015 = ('Heights, ground photos, buildings and water: Faroese Environment Agency, Umhvørvisstovan (DSM 2015; Myndakort, '
               'Bygningar, Topo; November 2026). House heights measured in the 2015 surface model.')

def step_sql(a):
    lv = json.load(open(f"{a.work}/levels.json")); pl = json.load(open(f"{a.work}/plan.json")); houses = json.load(open(f"{a.work}/house_rows.json"))
    F = f"{a.work}/files"; q = lambda v: 'null' if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else ('true' if v is True else 'false' if v is False else repr(v)))
    up = []
    wide = f"{F}/faroes_dsm15_wide.png"; up.append(wide)
    rng = [lv['range'][b['id']] for b in pl['ranges']]; nrs = [lv['near'][b['id']] for b in pl['nears']]; dts = [lv['detail'][b['id']] for b in pl['details']]
    for r in rng: up.append(f"{F}/{r['path']}")
    for r in nrs:
        up.append(f"{F}/{r['path']}")
        if r.get('new'): up.append(f"{F}/{r['color_path']}")
    for r in dts: up += [f"{F}/{r['path']}", f"{F}/{r['mask_path']}", f"{F}/{r['color_path']}"]
    for r in houses: up.append(f"{F}/{r['path']}")
    tot = sum(os.path.getsize(p) for p in up)
    rep = json.load(open(f"{a.work}/clean/report.json"))
    sql = f"""-- DRAFT, NOT APPLIED. Faroes 3D terrain rebuilt from the Faroese Environment Agency's 2015 surface model (DSM 2015,
-- 2 m, Umhvørvisstovan), every level (14 Nov 2026). Written by tools/sun3d/faroes/build_faroes_2015.py (branch claude/sun3d-faroes-2015).
-- Replaces ArcticDEM everywhere in the Faroes (it read ~3.3 m low against the agency's contours and had no Risin og Kellingin);
-- the 2015 file is within -0.4..+0.6 m of the agency's 2009 contours on gentle ground and has the sea stacks.
-- Cleaned first, whole islands: {len(rep['holes'])} land holes ({sum(p['cells'] for p in rep['holes']):,} cells of 2 m) filled from the agency's 2009 contour lines
-- (never ArcticDEM), {len(rep['water_holes'])} water holes inside the coastline (lagoons, harbour basins: {sum(p['cells'] for p in rep['water_holes']):,} cells) laid flat
-- at their rim's level, {len(rep['blunders'])} floating blunder pieces ({sum(p['cells'] for p in rep['blunders']):,} cells) taken out and filled the same way; every
-- building footprint filled from the ground round it (the houses are drawn from terrain_house_tiles, never twice).
--
-- Before applying: upload the {len(up)} files of upload.txt ({tot / 1e6:.1f} MB) to the public bucket `terrain` (new names: phones
-- keep files by id + byte size, so nothing old is overwritten). Old files can stay in the bucket.
--
-- 1. terrain_regions 'faroes' (the wide grid, same box and size): the 2015 ground, block means, summits and stacks at their tops.
update public.terrain_regions set path = 'faroes_dsm15_wide.png', bytes = {os.path.getsize(wide)}, base_m = 0, step_m = 0.5,
  note = 'Faroese Environment Agency DSM 2015 (2 m), bare ground (houses taken out), 2048 x 2048, isolated tops kept. Was ArcticDEM 32 m.',
  color_credit = {q(CREDIT_2015)}
  where id = 'faroes';

-- 2. terrain_range_regions: {len(rng)} sharp boxes at 2 m (2048 x 2048 cells, 4,096 m), every rated shot's subject at least
--    1 km inside one (pickRange), the stand pin too wherever the two fit one box. Bare ground. Feed the sun times.
insert into public.terrain_range_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, note) values
""" + ",\n".join(f"  ({q(r['id'])}, 'faroes', {r['north']}, {r['south']}, {r['west']}, {r['east']}, {r['n']}, {r['width_m']}, {r['depth_m']}, {r['base_m']}, {r['step_m']}, 2.0, {q(r['path'])}, {r['bytes']}, 'Umhvørvisstovan DSM 2015, 2 m, bare ground (houses filled from round them), land holes filled from the 2009 contours.')" for r in rng) + """
on conflict (id) do update set north = excluded.north, south = excluded.south, west = excluded.west, east = excluded.east, n = excluded.n, width_m = excluded.width_m,
  depth_m = excluded.depth_m, base_m = excluded.base_m, step_m = excluded.step_m, cell_m = excluded.cell_m, path = excluded.path, bytes = excluded.bytes, note = excluded.note;

-- 3. terrain_near_regions: the same fine boxes (their aerial photos stay), heights from the 2015 file at up to 2048 cells
--    (1.9 to 4.4 m); a new one for Klakkur (no fine box held its stand pin).
""" + "\n".join(
        (f"update public.terrain_near_regions set n = {r['n']}, base_m = {r['base_m']}, step_m = {r['step_m']}, path = {q(r['path'])}, bytes = {r['bytes']}, note = 'Umhvørvisstovan DSM 2015, bare ground, {max(r['width_m'], r['depth_m']) / r['n']:.1f} m cells.' where id = {q(r['id'])} and parent = 'faroes';"
         if not r.get('new') else
         f"insert into public.terrain_near_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, color_path, color_bytes, note) values ({q(r['id'])}, 'faroes', {r['north']}, {r['south']}, {r['west']}, {r['east']}, {r['n']}, {r['width_m']}, {r['depth_m']}, {r['base_m']}, {r['step_m']}, {q(r['path'])}, {r['bytes']}, {q(r['color_path'])}, {r['color_bytes']}, 'Umhvørvisstovan DSM 2015, bare ground; aerial photo Myndakort.')\n  on conflict (id) do update set path = excluded.path, bytes = excluded.bytes, n = excluded.n, base_m = excluded.base_m, step_m = excluded.step_m, color_path = excluded.color_path, color_bytes = excluded.color_bytes;")
        for r in nrs) + f"""

-- 4. Close-up boxes: the 36 round 2 boxes (ArcticDEM ground, guessed house heights in buildings_path) go; {len(dts)} new 1,504 m boxes
--    at 1 m (the 2 m file upsampled, cubic, never above or below its four cells) in terrain_detail_regions_v4, bare ground
--    (bare = true: the houses come from terrain_house_tiles), class mask (0 ground, 3 sea / lake / lagoon, 4 stream) and
--    aerial photo as round 2. Each sits inside its shot's fine box with the stand pin at least 150 m in.
delete from public.terrain_detail_regions where parent = 'faroes';
insert into public.terrain_detail_regions_v4 (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes, color_path, color_bytes, bare, note) values
""" + ",\n".join(f"  ({q(r['id'])}, 'faroes', {r['north']}, {r['south']}, {r['west']}, {r['east']}, {r['n']}, {r['width_m']}, {r['depth_m']}, {r['base_m']}, {r['step_m']}, 1.0, {q(r['path'])}, {r['bytes']}, {q(r['mask_path'])}, {r['mask_bytes']}, {q(r['color_path'])}, {r['color_bytes']}, true, 'Umhvørvisstovan DSM 2015 at 1 m (from 2 m), bare ground; water classes and aerial photo from Umhvørvisstovan.')" for r in dts) + """
on conflict (id) do update set north = excluded.north, south = excluded.south, west = excluded.west, east = excluded.east, n = excluded.n, width_m = excluded.width_m, depth_m = excluded.depth_m,
  base_m = excluded.base_m, step_m = excluded.step_m, cell_m = excluded.cell_m, path = excluded.path, bytes = excluded.bytes, mask_path = excluded.mask_path, mask_bytes = excluded.mask_bytes,
  color_path = excluded.color_path, color_bytes = excluded.color_bytes, bare = excluded.bare, note = excluded.note;

-- 5. terrain_house_tiles: every building outline of the agency (Bygningar) over the islands, with eave / ridge heights,
--    roof form and ridge direction MEASURED in the 2015 surface model (h: dsm; h: assumed where the 2015 file does not show
--    it: built since, or too small for 2 m cells), roof / wall colours from the aerial photos where a box has one (rc / wc).
--    Drawn within 8 km of the stand pin, never in the sun times.
insert into public.terrain_house_tiles (id, parent, north, south, west, east, path, bytes, count, note) values
""" + ",\n".join(f"  ({q(r['id'])}, 'faroes', {r['north']}, {r['south']}, {r['west']}, {r['east']}, {q(r['path'])}, {r['bytes']}, {r['count']}, 'Umhvørvisstovan Bygningar outlines, heights measured in the DSM 2015.')" for r in houses) + """
on conflict (id) do update set path = excluded.path, bytes = excluded.bytes, count = excluded.count, note = excluded.note;
"""
    mig = a.migration or f"{a.work}/terrain_faroes_2015.sql"
    open(mig, 'w').write(sql)
    open(f"{a.work}/upload.txt", 'w').write("\n".join(f"{os.path.basename(p)}\t{p}\t{os.path.getsize(p)}" for p in up) + "\n")
    print(f"sql: {mig}; {len(up)} files to upload, {tot / 1e6:.1f} MB (wide {os.path.getsize(wide) / 1e6:.2f}, range {sum(r['bytes'] for r in rng) / 1e6:.1f}, near {sum(r['bytes'] for r in nrs) / 1e6:.1f} + new photos, detail {sum(r['bytes'] + r['mask_bytes'] + r['color_bytes'] for r in dts) / 1e6:.1f}, houses {sum(r['bytes'] for r in houses) / 1e6:.2f})")

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('step'); ap.add_argument('work')
    ap.add_argument('--dsm', default=os.environ.get('FO_DSM')); ap.add_argument('--jobs', type=int, default=4); ap.add_argument('--pace', type=float, default=0.6)
    ap.add_argument('--pins'); ap.add_argument('--only'); ap.add_argument('--migration')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True); G['a'] = a
    steps = ['clean', 'wide', 'plan', 'range', 'near', 'detail', 'houses', 'housefiles', 'sql'] if a.step == 'all' else a.step.split(',')
    for s in steps: globals()['step_' + s](a)

if __name__ == '__main__': main()
