"""Find my spot: one photo job, from Claude's look to the answer the app shows.

Worker (GitHub Actions, .github/workflows/photo-spot.yml):
  job.py --job <id> [--api <photo-spot function URL>] --cache <terrain dir> [--hcache <dir>]
    claims the job from edge function photo-spot with the run's OIDC token (audience 'photo-spot'), solves it,
    and sends back the result + the photo with our sky line drawn on it. The repo is public: no secrets here.
Local test:
  job.py --photo p.jpg --look look.json --stop LAT,LNG --region grand_teton --rows rows.json --cache <dir>
         [--out result.json] [--overlay out.jpg]
    look.json = the look as photo-spot stores it ({kind, size: [w, h], landmarks: [{name, type, x, y, x0, x1, conf,
    lat, lng, gtype}]}, pixels in a picture `size` wide).

The answer (result): spot (lat, lng, eye), aim (yaw / pitch / roll), photo width hfov and its 4x5 equivalent
fp_mm = 60 / tan(hfov / 2), a confidence word with spreads, and a plan for each of Phil's 4x5 lenses (75 / 90 / 135 /
300): same spot and crop, or move along the line to the named foreground thing (closer for a wider lens, back for a
longer one) so it stays the same size, with the turn that keeps it at the same place in the frame.
"""
import argparse, base64, json, math, os, subprocess, sys, tempfile, time, urllib.request
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import solve as SV  # noqa: E402
from terrain import Terrain, horizon, kx, KZ  # noqa: E402
import camera as C  # noqa: E402

API = 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/photo-spot'
WORK_W = 1440                       # the solver was tuned on 1440-wide pictures
LENSES = [300, 135, 90, 75]         # Phil's 4x5 lenses (film 120 x 96 mm), longest first as on the screen
HALF_W = 60.0                       # half the 4x5 film width, mm
COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']


# ------------------------------------------------------------------ helpers
def bearing(lat0, lng0, lat1, lng1):
    e = (lng1 - lng0) * kx(lat0); n = (lat1 - lat0) * KZ
    return math.degrees(math.atan2(e, n)) % 360, math.hypot(e, n)


def offset(lat, lng, az_deg, m):
    a = math.radians(az_deg)
    return lat + m * math.cos(a) / KZ, lng + m * math.sin(a) / kx(lat)


def short_name(name):
    w = [x for x in name.replace('.', ' ').split() if x]
    if not w: return name
    if w[0].lower() in ('mount', 'mt'): return w[1] if len(w) > 1 else w[0]
    return w[0]


def sky_line(T, lat, lng, eyeh, q, W, H, houses=None):
    G = T.stack(lat, lng, 30); G = ([houses] if houses is not None else []) + G
    paz = np.arange(q[0] - q[3] - 5, q[0] + q[3] + 5, 0.03); pel = horizon(G, lat, lng, eyeh, paz % 360, dmin=6, nd=1000)
    xs = np.arange(0, W, max(2, W // 400)); ys = C.sky_curve(paz, pel, q, W, H, xs)
    return np.stack([xs, ys], 1)


def verdict(r, look):
    """placed / direction only / weak / not placed, as the prototype's review page judged them"""
    if look.get('kind') and look['kind'] != 'ground': return 'not placed', {'drone': 'drone photo', 'close_up': 'close-up, no sky line', 'screenshot': 'not a photo', 'no_sky': 'sky line hidden'}.get(look['kind'], look['kind'])
    if not r or not r.get('ok'): return 'not placed', 'too little sky line'
    a = r['agree']
    if a < 0.25: return 'not placed', 'sky line does not match'
    peaks = {L['name'] for L in look.get('landmarks', []) if L.get('type') == 'peak'}
    W = (r.get('size') or [1440])[0]
    off = [L for L in r.get('landmarks', []) if L['name'] in peaks and not (np.isfinite(L['px']) and abs(L['px'] - L['x']) <= 0.08 * W)]
    if off: return 'not placed', f"{short_name(off[0]['name'])} does not fit"
    rival = [x for x in r.get('alts', []) if x['dist_m'] > 150 and x.get('score', -9) >= r['score'] - 0.05]
    if rival: return 'direction only', f"another spot {rival[0]['dist_m']:.0f} m away fits too"
    c = r.get('conf') or {}
    if not c: return 'weak', 'not checked'
    span = max(c['along']['hi'] - c['along']['lo'], c['across']['hi'] - c['across']['lo'])
    open_ = c['along']['open'] or c['across']['open']
    if a >= 0.3 and not open_ and span <= 200: return 'placed', ''
    if a >= 0.3: return 'direction only', f"spot could be {span:.0f} m off"
    return 'weak', 'sky line fits loosely'


def confidence(v, why, r):
    c = (r or {}).get('conf') or {}
    spread = None
    if c:
        spread = max(c['along']['hi'] - c['along']['lo'], c['across']['hi'] - c['across']['lo']) / 2
        spread = max(15, int(round(spread / 5.0)) * 5)
    if v == 'placed': return dict(word='High', spread_m=spread, aim_deg=1, line=f'± {spread} m · aim ± 1°')
    if v == 'direction only':
        import re
        m = re.search(r'(\d+) m', why or ''); n = int(m.group(1)) if m else spread
        return dict(word='Medium', spread_m=n, aim_deg=2, line='direction right' + (f', spot could be {n} m off' if n else ''))
    if v == 'weak': return dict(word='Low', spread_m=spread, aim_deg=None, line=why)
    return dict(word="Couldn't place it", spread_m=None, aim_deg=None, line=why)


def lens_rows(r, look_lms, T, grids):
    """a plan per lens; the photo's own 4x5 equivalent fp decides"""
    hfov = r['hfov']; fp = HALF_W / math.tan(math.radians(hfov) / 2)
    lat, lng, yaw, pitch = r['lat'], r['lng'], r['yaw'], r['pitch']
    W, H = r['size']
    # the named foreground thing: the nearest building / point the look named (its spot in the photo)
    fg = None
    for L in r.get('landmarks', []):
        src = next((x for x in look_lms if x['name'] == L['name']), None)
        if src is None or src.get('gtype') == 'peak' or src.get('type') in ('peak', 'span'): continue
        if L.get('dist_m') is None or L['dist_m'] > 1500: continue
        if fg is None or L['dist_m'] < fg['dist_m']: fg = dict(L, lat=src.get('lat'), lng=src.get('lng'))
    peaks = [L for L in r.get('landmarks', []) if any(x['name'] == L['name'] and (x.get('gtype') == 'peak' or x.get('type') == 'peak') for x in look_lms)]
    # the main far subject: the named peak standing highest in the picture (the Grand over its neighbours)
    inside = [L for L in peaks if np.isfinite(L.get('px', np.nan)) and np.isfinite(L.get('py', np.nan)) and 0 <= L['px'] <= W]
    far = min(inside or peaks, key=lambda L: L.get('py') if np.isfinite(L.get('py', np.nan)) else 1e9) if peaks else None
    far_word = short_name(far['name']) if far else 'mountains'
    rows = []
    for f in LENSES:
        k = f / fp
        row = dict(id=str(f), f=f, possible=True, lat=lat, lng=lng, heading=yaw % 360, pitch=pitch, move_m=0, crop_pct=0, turn_deg=0.0)
        if f <= fp and (k >= 0.8 or fg is None):
            n = int(round(100 * (1 - k)))
            row.update(plan='Stand here' + (f' · crop {n}%' if n >= 1 else ''), crop_pct=n, kind='crop')
        elif fg is None:
            row.update(plan='Photo is wider than this lens', kind='narrow', possible=True)
        else:
            D = fg['dist_m']
            az_fg = None
            if fg.get('lat') is not None:
                az_fg, _ = bearing(lat, lng, fg['lat'], fg['lng'])
            else:   # direction of the thing from its spot in the photo
                az_fg = float(C.rays(np.array([fg['px']]), np.array([fg.get('py') or H / 2]), [yaw, pitch, r['roll'], hfov], W, H)[0][0])
            # angle of the thing off the photo's centre, and where the new lens must put it (same place in the frame)
            a0 = math.degrees(math.atan((fg['x'] - W / 2) / C.fpx(hfov, W)))
            a1 = math.degrees(math.atan(math.tan(math.radians(a0)) * fp / f))
            turn = a0 - a1
            if f < fp:
                M = D * (1 - k); P = int(round(100 * (1 - k)))
                nlat, nlng = offset(lat, lng, az_fg, M)
                row.update(plan=f'{M:.0f} m closer · {far_word} {P}% smaller', kind='closer')
            else:
                M = D * (k - 1); P = int(round(100 * (k - 1)))
                nlat, nlng = offset(lat, lng, (az_fg + 180) % 360, M)
                ok = M <= 600
                if ok:   # the new spot must still see the thing over the ground between
                    g = T.ground(nlat, nlng, grids)
                    ok = np.isfinite(g)
                row.update(plan=f'{M:.0f} m back · {far_word} {P}% bigger' if ok else 'Too long for this view', kind='back', possible=bool(ok))
            row.update(lat=nlat, lng=nlng, move_m=round(M), heading=(yaw + turn) % 360, turn_deg=round(turn, 1))
            if abs(turn) >= 1 and row['possible']:
                row['plan'] += f" · turn {abs(turn):.0f}° {'right' if turn > 0 else 'left'}"
        rows.append(row)
    # best fit: same spot with the least crop, else the smallest change of lens
    crops = [x for x in rows if x['kind'] == 'crop' and x['possible']]
    best = max(crops, key=lambda x: x['f']) if crops else min((x for x in rows if x['possible']), key=lambda x: abs(1 - x['f'] / fp), default=None)
    for x in rows: x['best'] = x is best
    return fp, rows, fg, far


def shot_name(fg, far, lat, lng):
    if fg is not None and fg.get('lat') is not None:
        word = fg['name'].split()[-1].lower()
        az, _ = bearing(fg['lat'], fg['lng'], lat, lng)
        return f"{word} from the {COMPASS[int(((az + 22.5) % 360) // 45)]} (your photo)"
    if far is not None: return f"{short_name(far['name'])} (your photo)"
    return 'from your photo'


# ------------------------------------------------------------------ the look's peaks, checked against each other
CW = {'high': 3, 'medium': 2, 'low': 1}
RANK = {'placed': 3, 'direction only': 2, 'weak': 1, 'not placed': 0}


def peak_sets(lms, stop, W, H, T, grids):
    """Which named peaks agree with each other. From the stop (the photo was taken within ~2 km of it; the peaks are
    far), every group of peaks must fit one heading, lens width and tilt to within 3 % of the picture width in x and
    y. Returns (keep, extra): `keep` = the best agreeing group (most confidence weight, then the tightest fit) without
    unsure ('low') peaks unless two surer peaks agree with them; `extra` = unsure peaks left out of `keep` without
    being proven wrong (tried only when the first answer is not good)."""
    from itertools import combinations
    from scipy.optimize import least_squares
    pk = [L for L in lms if L.get('type') == 'peak' and L.get('lat') is not None and L.get('x') is not None and L.get('y') is not None]
    if len(pk) < 2: return pk, []
    eye = T.ground(stop[0], stop[1], grids) + 1.7
    tmp = [dict(L) for L in pk]
    import solve as _S
    # where each peak really is (its snapped top), seen from the stop
    for L in tmp: L.setdefault('known', True); L.setdefault('gtype', 'peak')
    dirs = []
    for L in tmp:
        lat, lng = L['lat'], L['lng']
        gz = json.load(open(os.path.join(HERE, 'gazetteer.json'))).get(T.region, {}).get(L['name'])
        snap = (gz or {}).get('snap', 250)
        k = kx(lat); n = 31
        dN, dE = np.meshgrid(np.linspace(-snap, snap, n), np.linspace(-snap, snap, n), indexing='ij')
        m = dN ** 2 + dE ** 2 <= snap * snap
        la = lat + dN[m] / KZ; lo = lng + dE[m] / k
        from terrain import stack_at
        hh = stack_at(grids, la, lo); j = int(np.nanargmax(hh))
        d = _S.lm_dirs([dict(L, lat=float(la[j]), lng=float(lo[j]), h=float(hh[j]))], stop[0], stop[1], eye)[0]
        dirs.append(d)
    tol = 0.03 * W
    best = None
    for n_ in range(len(pk), 1, -1):
        for sub in combinations(range(len(pk)), n_):
            az = np.array([dirs[i][0] for i in sub]); el = np.array([dirs[i][1] for i in sub])
            xs = np.array([pk[i]['x'] for i in sub]); ys = np.array([pk[i]['y'] for i in sub])
            def res(q):
                x, y = C.project_dirs(az, el, [q[0], q[1], 0.0, q[2]], W, H)
                return np.concatenate([np.nan_to_num(x - xs, nan=1e4), np.nan_to_num(y - ys, nan=1e4)])
            fit = None
            for hf in (12, 25, 45, 75):
                y0 = float(np.degrees(np.arctan2(np.mean(np.sin(np.radians(az))), np.mean(np.cos(np.radians(az))))))
                try: r = least_squares(res, [y0, 0.0, hf], bounds=([y0 - 90, -45, 3], [y0 + 90, 45, 110]))
                except Exception: continue  # noqa: E722
                if fit is None or r.cost < fit.cost: fit = r
            if fit is None: continue
            rr = res(fit.x).reshape(2, -1)
            if os.environ.get("PS_DEBUG"): print("   sub", [pk[i]["name"] for i in sub], "max", round(float(np.max(np.hypot(rr[0], rr[1]))), 1), "hfov", round(float(fit.x[2]), 1))
            if np.max(np.hypot(rr[0], rr[1])) > tol: continue
            w = sum(CW.get(pk[i].get('conf'), 2) for i in sub)
            sure = sum(1 for i in sub if pk[i].get('conf') != 'low')
            lows = [i for i in sub if pk[i].get('conf') == 'low']
            if lows and sure < 2: continue   # unsure peaks count only with two surer ones agreeing
            key = (w, -float(np.sqrt(np.mean(rr ** 2))))
            if best is None or key > best[0]: best = (key, set(sub))
        if best is not None and n_ <= 2: break
    sure_all = [i for i, L in enumerate(pk) if L.get('conf') != 'low']
    if best is None:   # nothing agrees: keep the surest single peak
        if not sure_all: return [], [L for L in pk]
        i0 = max(sure_all, key=lambda i: CW.get(pk[i].get('conf'), 2))
        keep = {i0}
    else:
        keep = best[1]
    extra = [pk[i] for i in range(len(pk)) if i not in keep and pk[i].get('conf') == 'low']
    return [pk[i] for i in sorted(keep)], extra


# ------------------------------------------------------------------ one photo
def run(photo, look, stop, region, rows_file, cache, hcache=None, overlay=None, log=print):
    t0 = time.time()
    im = cv2.imread(photo, cv2.IMREAD_COLOR)
    if im is None: raise ValueError('cannot read the photo')
    H0, W0 = im.shape[:2]
    cr = look.get('crop')
    if cr and cr.get('w'):   # a screenshot of a photo (17 Nov 2026): the photo alone, cut out where the look found it
        k = W0 / float(cr['w'])
        x0, x1 = max(0, int(round(cr['x0'] * k))), min(W0, int(round(cr['x1'] * k)))
        y0, y1 = max(0, int(round(cr['y0'] * k))), min(H0, int(round(cr['y1'] * k)))
        if x1 - x0 > 50 and y1 - y0 > 50:
            im = im[y0:y1, x0:x1].copy(); H0, W0 = im.shape[:2]
            log(f"  screenshot: photo cut out at {x0},{y0}-{x1},{y1}")
    if W0 > WORK_W:
        im = cv2.resize(im, (WORK_W, int(round(H0 * WORK_W / W0))), interpolation=cv2.INTER_AREA)
    W, H = im.shape[1], im.shape[0]
    work = tempfile.mkdtemp(prefix='ps_')
    pic = os.path.join(work, 'photo.png'); cv2.imwrite(pic, im)
    lw = (look.get('size') or [W])[0]; s = W / lw
    all_lms = []
    for L in look.get('landmarks', []):
        o = dict(L)
        for k in ('x', 'y', 'x0', 'x1'):
            if o.get(k) is not None: o[k] = float(o[k]) * s
        all_lms.append(o)
    if look.get('kind') not in (None, 'ground'):
        v, why = verdict(None, look)
        return dict(ok=False, verdict=v, why=why, confidence=confidence(v, why, None), times=dict(total=time.time() - t0))
    T = Terrain(rows_file, cache, region)
    keep, extra = peak_sets(all_lms, stop, W, H, T, T.stack(stop[0], stop[1], 30))
    others = [L for L in all_lms if L.get('type') != 'peak' or L.get('lat') is None or L.get('x') is None]
    dropped = [L['name'] for L in all_lms if L.get('type') == 'peak' and L not in keep and L not in extra]
    log(f"  peaks kept {[L['name'] for L in keep]}, unsure {[L['name'] for L in extra]}, disagreeing {dropped}")
    SV.HCACHE = hcache
    # 1: the peaks that agree with each other; 2: every peak it named; 3: only the peaks the look was sure of.
    # The first answer that is placed wins, else the best of them (a wrong name can pull the search far off).
    # A set with no peak at all is never tried when the look named peaks: with only a building the search can settle
    # on a wrong heading and still look sure (scan 2: 50 deg off).
    peaks_all = [L for L in all_lms if L not in others]
    tries, seen_ = [], set()
    for ps in (keep, peaks_all, [L for L in peaks_all if L.get('conf') == 'high']):
        if peaks_all and not ps: continue
        key_ = tuple(sorted(L['name'] for L in ps))
        if key_ in seen_: continue
        seen_.add(key_); tries.append(others + ps)
    best = None
    for i, lms in enumerate(tries):
        lmf = os.path.join(work, f'landmarks{i}.json'); json.dump(dict(kind=look.get('kind'), landmarks=lms), open(lmf, 'w'))
        r = SV.solve(pic, rows_file, cache, region, tuple(stop), lmf, log=log)
        v, why = verdict(r, dict(look, landmarks=lms))
        log(f"  try {i + 1}: {v} {why}")
        if best is None or RANK[v] > RANK[best[1]]: best = (r, v, why, lms)
        if v == 'placed': break
    r, v, why, lms = best
    conf = confidence(v, why, r)
    if not r.get('ok') or v == 'not placed':
        return dict(ok=False, verdict=v, why=why, confidence=conf, times=r.get('times'))
    grids = T.stack(r['lat'], r['lng'], 30)
    fp, rows, fg, far = lens_rows(r, lms, T, grids)
    main = None
    for L in ([far] if far else []) + ([fg] if fg else []):
        src = next((x for x in lms if x['name'] == L['name']), None)
        if src and src.get('lat') is not None: main = dict(name=src['name'], lat=src['lat'], lng=src['lng']); break
    out = dict(ok=True, verdict=v, why=why, confidence=conf, lat=r['lat'], lng=r['lng'], eye_above_ground=r['eye_above_ground'],
               yaw=r['yaw'], pitch=r['pitch'], roll=r['roll'], hfov=r['hfov'], fp_mm=round(fp), size=[W, H],
               dist_stop_m=round(r['dist_stop']), agree=r['agree'], rms_px=r['rms_px'], lenses=rows,
               foreground=dict(name=fg['name'], dist_m=round(fg['dist_m'])) if fg else None,
               main_landmark=main, shot_name=shot_name(fg, far, r['lat'], r['lng']),
               landmarks=[dict(name=L['name'], x=L['x'], px=L['px'], dist_m=round(L['dist_m'])) for L in r.get('landmarks', [])],
               times=r.get('times'))
    when = time.strftime('%d %b %Y')
    for x in rows:
        x['note'] = (f"Placed by Find spot from a photo ({when}): the photo spans {r['hfov']:.0f} deg, about {fp:.0f} mm on 4x5"
                     f" (confidence {conf['word'].lower()}). With the {x['f']} mm: {x['plan'].lower()}.")
    if overlay:
        hg, nh = T.house_grid(r['lat'], r['lng'], 400, 1.0)
        line = sky_line(T, r['lat'], r['lng'], r['eye_abs'], [r['yaw'], r['pitch'], r['roll'], r['hfov']], W, H, hg if nh else None)
        ov = im.copy(); th = max(2, W // 360)
        ok = np.isfinite(line[:, 1])
        cv2.polylines(ov, [line[ok].astype(np.int32)], False, (122, 170, 90), th + 1, cv2.LINE_AA)   # BGR of #5aaa7a
        w2 = min(1280, W); ov = cv2.resize(ov, (w2, int(round(H * w2 / W))), interpolation=cv2.INTER_AREA)
        cv2.imwrite(overlay, ov, [cv2.IMWRITE_JPEG_QUALITY, 85])
    out['times'] = dict(out.get('times') or {}, all=time.time() - t0)
    return out


# ------------------------------------------------------------------ worker
def oidc_token():
    # GitHub's token service can answer 5xx for a moment (17 Nov 2026: a solved job was lost to one 503): try 5 times
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&audience=photo-spot'
    last = None
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={'Authorization': 'bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
            return json.load(urllib.request.urlopen(req, timeout=30))['value']
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code < 500: raise
            time.sleep(3 * (i + 1))
    raise last


def call(api, body, tok):
    req = urllib.request.Request(api, data=json.dumps(body, default=float).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    for i in range(4):   # the function or the network can hiccup too: 5xx and dropped connections are tried again
        try:
            return json.load(urllib.request.urlopen(req, timeout=120))
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < 3: time.sleep(3 * (i + 1)); continue
            return dict(ok=False, error=f'{e.code}: {e.read()[:300].decode(errors="replace")}')
        except (urllib.error.URLError, TimeoutError) as e:
            if i < 3: time.sleep(3 * (i + 1)); continue
            return dict(ok=False, error=f'network: {e}')


def worker(a):
    tok = oidc_token()
    c = call(a.api, dict(action='claim', job_id=a.job, run_id=int(os.environ.get('GITHUB_RUN_ID', '0') or 0)), tok)
    if not c.get('ok'):
        err = str(c.get('error', ''))
        # Another run already did (or is doing) this job: a late duplicate, not a failure (16 Nov 2026, Phil: no false
        # "All jobs have failed" emails). The server answers 409 "job is done / error / solving..." then.
        if err.startswith('409') and 'job is ' in err:
            print('nothing to do: this job was already handled by another run (' + err[:120] + ')'); sys.exit(0)
        print('claim failed:', c); sys.exit(1)
    job = c['job']; work = tempfile.mkdtemp(prefix='job_')
    rows = os.path.join(work, 'rows.json'); json.dump(c['rows'], open(rows, 'w'))
    pic = os.path.join(work, 'photo.jpg'); urllib.request.urlretrieve(job['photo_url'], pic)
    ovf = os.path.join(work, 'overlay.jpg')
    try:
        res = run(pic, job['look'], (job['stop']['lat'], job['stop']['lng']), job['region'], rows, a.cache, a.hcache, ovf)
        ov = base64.b64encode(open(ovf, 'rb').read()).decode() if os.path.exists(ovf) else None
        print(json.dumps({k: res.get(k) for k in ('ok', 'verdict', 'why', 'lat', 'lng', 'yaw', 'hfov', 'fp_mm', 'times')}, default=float))
        f = call(a.api, dict(action='finish', job_id=a.job, result=json.loads(json.dumps(res, default=float)), overlay_jpeg_base64=ov), oidc_token())
    except Exception as e:  # noqa: BLE001
        import traceback; traceback.print_exc()
        f = call(a.api, dict(action='finish', job_id=a.job, error='the search failed: ' + str(e)[:200]), oidc_token())
    print('finish:', json.dumps(f)[:300])


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--job'); ap.add_argument('--api', default=API)
    ap.add_argument('--photo'); ap.add_argument('--look'); ap.add_argument('--stop'); ap.add_argument('--region')
    ap.add_argument('--rows'); ap.add_argument('--cache', required=True); ap.add_argument('--hcache')
    ap.add_argument('--out'); ap.add_argument('--overlay')
    a = ap.parse_args()
    if a.hcache: os.makedirs(a.hcache, exist_ok=True)
    if a.job:
        worker(a)
    else:
        look = json.load(open(a.look)); look = look.get('look', look)
        res = run(a.photo, look, tuple(float(v) for v in a.stop.split(',')), a.region, a.rows, a.cache, a.hcache, a.overlay)
        s = json.dumps(res, indent=1, default=float)
        if a.out: open(a.out, 'w').write(s)
        print(json.dumps({k: res.get(k) for k in ('ok', 'verdict', 'why', 'lat', 'lng', 'yaw', 'hfov', 'fp_mm', 'shot_name')}, default=float))
