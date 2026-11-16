"""Review page for "find my spot from a photo": one card per photo (photo + our sky line, our render from the solved
spot, the spot against the stand pins, heading / lens, confidence, and for the hand-solved scans the error).

  review.py <work dir> [results dir name, default out] [rows file, default meta/rows2.json]
  work dir holds meta/ (rows2.json, photos.json, shots.json), landmarks/, <results>/, scans/
Writes <work>/review.html and <work>/review/*.jpg (the page uses them as relative files).
"""
import base64, html, json, math, os, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from terrain import Terrain, horizon, kx, KZ  # noqa: E402
import camera as C  # noqa: E402
from render import render  # noqa: E402

WD = sys.argv[1]; OUT = os.path.join(WD, 'review'); os.makedirs(OUT, exist_ok=True)
RES = sys.argv[2] if len(sys.argv) > 2 else 'out'
ROWS = sys.argv[3] if len(sys.argv) > 3 else 'meta/rows2.json'
SCANS = {
    'scan_p1': ('T.A. Moulton Barn (scan 1, 6x9 film)', (43.661016, -110.664522, 223.1, 6.2, -1.1, 48.04)),
    'scan_p2': ('Cunningham Cabin (scan 2, 6x9 film)', (43.778605, -110.558027, 269.5, 4.9, -0.1, 45.36)),
    'scan_p3': ('Oxbow Bend (scan 3, 6x9 film)', (43.866258, -110.548177, 259.5, 4.8, 0.1, 47.65)),
    'scan_p4': ('T.A. Moulton Barn (scan 4, 6x9 film)', (43.66085, -110.664683, 236.5, 8.1, -1.4, 47.95)),
    'scan_p5': ('Cunningham Cabin (scan 5, 6x9 film)', (43.778734, -110.558053, 240.9, 6.5, -0.5, 45.47)),
    'scan_p6': ('Snake River Overlook (scan 6, 6x9 film)', (43.753805, -110.624049, 263.79, 3.24, 0.38, 47.57)),
}
IDEA_STOP = '8200fc29-f054-481f-bdae-5a1031a1d703'   # T.A. Moulton Barn on the Grand Teton trip
SCAN_STOP = {'scan_p1': '8200fc29-f054-481f-bdae-5a1031a1d703', 'scan_p4': '8200fc29-f054-481f-bdae-5a1031a1d703',
             'scan_p2': '4f448e32-2862-4915-8c5d-c40b5e06a5bd', 'scan_p5': '4f448e32-2862-4915-8c5d-c40b5e06a5bd',
             'scan_p3': '7534a06d-a3c5-40db-b379-503a7d4b92c8', 'scan_p6': 'a0c6552c-cf12-40aa-96bf-73157aaa914c'}

photos = {r['id']: r for r in json.load(open(os.path.join(WD, 'meta/photos.json')))}
shots = json.load(open(os.path.join(WD, 'meta/shots.json')))
exif = {e['id']: e for e in json.load(open(os.path.join(WD, 'meta/exif.json')))} if os.path.exists(os.path.join(WD, 'meta/exif.json')) else {}
TER = {}


def terrain(region):
    if region not in TER: TER[region] = Terrain(os.path.join(WD, ROWS), os.path.join(WD, 'terrain'), region)
    return TER[region]


def dist(a, b):
    return math.hypot((a[0] - b[0]) * KZ, (a[1] - b[1]) * kx(a[0]))


def bearing(a, b):
    return math.degrees(math.atan2((b[1] - a[1]) * kx(a[0]), (b[0] - a[0]) * KZ)) % 360


def jpg(img, name, w):
    h = int(img.shape[0] * w / img.shape[1]); im = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(OUT, name), im, [cv2.IMWRITE_JPEG_QUALITY, 78]); return 'review/' + name


def sky_line(T, lat, lng, eyeh, q, W, H, houses=None):
    G = T.stack(lat, lng, 30); G = ([houses] if houses is not None else []) + G
    paz = np.arange(q[0] - q[3] - 5, q[0] + q[3] + 5, 0.03); pel = horizon(G, lat, lng, eyeh, paz % 360, dmin=6, nd=1000)
    xs = np.arange(0, W, max(2, W // 400)); ys = C.sky_curve(paz, pel, q, W, H, xs)
    return np.stack([xs, ys], 1)


def verdict(r, lm):
    if lm.get('skip'): return 'not placed', 'skipped by the look: ' + lm['skip']
    if not r or not r.get('ok'): return 'not placed', (r or {}).get('why', 'no result')
    a, rms, lmc = r['agree'], r['rms_px'], r.get('lm_cost', 0)
    if a < 0.25: return 'not placed', f'sky line agrees in only {a * 100:.0f}% of columns'
    if lmc > 12: return 'not placed', 'named landmarks do not land where the look put them'
    rival = [x for x in r.get('alts', []) if x['dist_m'] > 150 and x.get('score', -9) >= r['score'] - 0.05]
    if rival: return 'direction only', f'another spot {rival[0]["dist_m"]:.0f} m away fits nearly as well'
    c = r.get('conf') or {}
    if not c: return 'weak', 'no confidence check'
    span = max(c['along']['hi'] - c['along']['lo'], c['across']['hi'] - c['across']['lo'])
    open_ = c['along']['open'] or c['across']['open']
    if a >= 0.3 and not open_ and span <= 200: return 'placed', ''
    if a >= 0.3: return 'direction only', f'fits, but the spot can slide {span:.0f} m{" or more" if open_ else ""}'
    return 'weak', f'sky line agrees in {a * 100:.0f}% of columns'


def map_svg(r, pins, stop, truth=None):
    """top-down sketch, metres round the solved spot"""
    s0 = (r['lat'], r['lng']); k = kx(s0[0])
    pts = [(p['lat'], p['lng']) for p in pins] + [stop] + ([truth[:2]] if truth else [])
    ext = max([60] + [dist(s0, p) * 1.2 for p in pts if dist(s0, p) < 1500])
    c = r.get('conf') or {}
    if c: ext = max(ext, min(1600, max(abs(c['along']['lo']), abs(c['along']['hi'])) * 1.1))
    S = 130 / ext

    def xy(p):
        return 150 + (p[1] - s0[1]) * k * S, 150 - (p[0] - s0[0]) * KZ * S
    o = ['<svg viewBox="0 0 300 300" class="map" role="img" aria-label="map sketch">', '<rect x="0" y="0" width="300" height="300" class="mapbg"/>']
    a = math.radians(r['yaw'])
    if c:
        for key, ang, cls in (('along', a, 'unc'), ('across', a + math.pi / 2, 'unc2')):
            lo, hi = c[key]['lo'], c[key]['hi']
            x1, y1 = 150 + math.sin(ang) * lo * S, 150 - math.cos(ang) * lo * S; x2, y2 = 150 + math.sin(ang) * hi * S, 150 - math.cos(ang) * hi * S
            o.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" class="{cls}"/>')
    # heading and the lens's two edges
    for da, cls in ((0, 'hd'), (-r['hfov'] / 2, 'fov'), (r['hfov'] / 2, 'fov')):
        b = math.radians(r['yaw'] + da); L = 120 if da == 0 else 95
        o.append(f'<line x1="150" y1="150" x2="{150 + math.sin(b) * L:.1f}" y2="{150 - math.cos(b) * L:.1f}" class="{cls}"/>')
    for p in pins:
        x, y = xy((p['lat'], p['lng'])); o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" class="pin"><title>{html.escape(p["name"] or "")}</title></circle>')
    x, y = xy(stop); o.append(f'<rect x="{x - 4:.1f}" y="{y - 4:.1f}" width="8" height="8" class="stop"><title>stop pin</title></rect>')
    if truth:
        x, y = xy(truth[:2]); o.append(f'<path d="M{x - 5:.1f},{y - 5:.1f} L{x + 5:.1f},{y + 5:.1f} M{x - 5:.1f},{y + 5:.1f} L{x + 5:.1f},{y - 5:.1f}" class="truth"/>')
    o.append('<circle cx="150" cy="150" r="5" class="me"/>')
    # scale bar
    nice = [10, 20, 50, 100, 200, 500, 1000, 2000]; L = min(nice, key=lambda v: abs(v * S - 70))
    o.append(f'<line x1="14" y1="286" x2="{14 + L * S:.1f}" y2="286" class="scale"/><text x="14" y="280" class="mt">{L} m</text>')
    o.append('<text x="292" y="16" text-anchor="end" class="mt">N ↑</text></svg>')
    return ''.join(o)


def card(name, r, lm, meta):
    T = terrain(r['region']) if r and r.get('ok') else None
    photo = r['photo'] if r else meta['photo']
    img = cv2.imread(photo)
    W, H = img.shape[1], img.shape[0]
    truth = SCANS.get(name, (None, None))[1]
    ov = img.copy(); th = max(2, W // 400)
    rend_src = None; err = None
    if T is not None:
        q = [r['yaw'], r['pitch'], r['roll'], r['hfov']]
        hg, nh = T.house_grid(r['lat'], r['lng'], 400, 1.0)
        line = sky_line(T, r['lat'], r['lng'], r['eye_abs'], q, W, H, hg if nh else None)
        for x, y in r.get('pts', []): cv2.circle(ov, (int(x), int(y)), th + 1, (0, 230, 255), -1)
        if truth:
            g = T.ground(truth[0], truth[1]); tl = sky_line(T, truth[0], truth[1], g + 1.7, list(truth[2:]), W, H, hg if nh else None)
            cv2.polylines(ov, [tl.astype(np.int32)], False, (255, 220, 0), th)
        cv2.polylines(ov, [line.astype(np.int32)], False, (40, 40, 255), th + 1)
        G = T.stack(r['lat'], r['lng'], 30)
        rd = render(G, r['lat'], r['lng'], r['eye_abs'], q, W, H, out_w=300, house=hg if nh else None)
        rend_src = jpg(rd[:, :, ::-1].copy(), name + '_rd.jpg', 300)
        if truth:
            from math import hypot
            k = kx(truth[0]); dn = (r['lat'] - truth[0]) * KZ; de = (r['lng'] - truth[1]) * k; a = math.radians(truth[2])
            err = dict(pos=hypot(de, dn), along=de * math.sin(a) + dn * math.cos(a), across=de * math.cos(a) - dn * math.sin(a),
                       yaw=((r['yaw'] - truth[2] + 180) % 360) - 180, pitch=r['pitch'] - truth[3], roll=r['roll'] - truth[4], hfov=r['hfov'] - truth[5])
    ov_src = jpg(ov, name + '_ov.jpg', 560)
    v, why = verdict(r, lm)
    stop_id = meta.get('stop_id'); pins = []
    seen = set()
    for s in shots:
        if s['stop_id'] == stop_id and s['vid'] not in seen and s['lat'] is not None:
            seen.add(s['vid']); pins.append(dict(lat=s['lat'], lng=s['lng'], name=(s['shot_name'] or s['vname'] or '')))
    rows = []
    if r and r.get('ok'):
        sp = (r['lat'], r['lng'])
        near = min(pins, key=lambda p: dist(sp, (p['lat'], p['lng']))) if pins else None
        f35 = 18 / math.tan(math.radians(r['hfov'] / 2))
        rows.append(('Solved spot', f'{r["lat"]:.6f}, {r["lng"]:.6f} · eye {r["eye_above_ground"]:.1f} m above ground'))
        if near:
            dn = dist(sp, (near['lat'], near['lng']))
            rows.append(('Nearest stand pin', f'{dn:.0f} m {_compass(bearing((near["lat"], near["lng"]), sp))} of “{html.escape(near["name"])}”'))
        rows.append(('From the stop pin', f'{dist(sp, meta["stop"]):.0f} m'))
        rows.append(('Heading · tilt · roll', f'{r["yaw"]:.1f}° · {r["pitch"]:+.1f}° · {r["roll"]:+.1f}°'))
        rows.append(('Lens', f'{r["hfov"]:.1f}° across = {f35:.0f} mm on 35 mm film'))
        rows.append(('Sky line fit', f'{r["agree"] * 100:.0f}% of columns within 4 px, {r["rms_px"]:.1f} px off on those'))
        c = r.get('conf')
        if c:
            def ext(k_):
                lo, hi = c[k_]['lo'], c[k_]['hi']
                if lo == 0 and hi == 0: return 'under 15 m'
                s_ = f'{lo:+.0f} to {hi:+.0f} m'
                return s_ + (' (or more)' if c[k_]['open'] else '')
            rows.append(('Could slide', f'along the view {ext("along")}, sideways {ext("across")}'))
        alts = [a_ for a_ in r.get('alts', []) if a_['dist_m'] > 150 and a_['agree'] >= r['agree'] - 0.08]
        if alts:
            a_ = alts[0]; rows.append(('Other answer', f'{a_["dist_m"]:.0f} m away fits nearly as well ({a_["agree"] * 100:.0f}%)'))
        if r.get('landmarks'):
            rows.append(('Named landmarks', '; '.join(f'{html.escape(L["name"])}: {abs(L["px"] - L["x"]):.0f} px off' if np.isfinite(L['px']) else f'{html.escape(L["name"])}: out of view' for L in r['landmarks'])))
        if lm.get('idea') and pins:
            rows.append(('From the stop\'s stand pins', '<br>'.join(
                f'{dist((p["lat"], p["lng"]), sp):.0f} m {_compass(bearing((p["lat"], p["lng"]), sp))} ({bearing((p["lat"], p["lng"]), sp):.0f}°) of “{html.escape(p["name"])}”'
                for p in sorted(pins, key=lambda p: dist((p["lat"], p["lng"]), sp)))))
        rows.append(('Time', f'{r["times"]["total"]:.0f} s'))
    if err:
        rows.insert(0, ('Error vs hand solve', f'<b>{err["pos"]:.0f} m</b> ({err["along"]:+.0f} along the view, {err["across"]:+.0f} sideways) · heading {err["yaw"]:+.2f}° · tilt {err["pitch"]:+.2f}° · lens {err["hfov"]:+.2f}°'))
    ex = exif.get(meta.get('photo_id'), {})
    tags = []
    if lm.get('kind') and lm['kind'] != 'ground': tags.append(lm['kind'])
    if ex.get('focal'): tags.append(f'EXIF {ex.get("make")} {ex["focal"]:.0f} mm')
    if ex.get('gps'): tags.append('EXIF GPS')
    names = ', '.join(L['name'] for L in lm.get('landmarks', []) if L['type'] != 'span') or 'none'
    body = ''.join(f'<tr><th>{k_}</th><td>{v_}</td></tr>' for k_, v_ in rows)
    m = map_svg(r, pins, meta['stop'], truth) if r and r.get('ok') else ''
    vcls = {'placed': 'ok', 'direction only': 'mid', 'weak': 'mid', 'not placed': 'bad'}[v]
    return f'''<article class="card" id="{name}">
<header><h2>{html.escape(name)} · {html.escape(meta.get("stop_name", ""))}</h2><span class="badge {vcls}">{v}</span></header>
<p class="sub">{html.escape(why) + " · " if why else ""}Look: {html.escape(names)}{" · " + html.escape(lm.get("note", "")) if lm.get("note") else ""}{" · " + " · ".join(map(html.escape, tags)) if tags else ""}</p>
<div class="pics"><figure><img src="{ov_src}" alt="photo with our sky line" loading="lazy"><figcaption>red: our terrain's sky line from the solved spot{"; yellow: from the hand solve" if truth else ""}; dots: photo edges used</figcaption></figure>
{f'<figure><img src="{rend_src}" alt="our render" loading="lazy" class="rd"><figcaption>our terrain from the solved spot</figcaption></figure>' if rend_src else ''}
{f'<figure>{m}<figcaption>● solved spot, ○ stand pins, ■ stop pin{", × hand solve" if truth else ""}; bar = how far the spot could slide</figcaption></figure>' if m else ''}</div>
<table>{body}</table></article>'''


def scan_err(n, r):
    t = SCANS[n][1]; k = kx(t[0]); dn = (r['lat'] - t[0]) * KZ; de = (r['lng'] - t[1]) * k; a = math.radians(t[2])
    return dict(pos=math.hypot(de, dn), along=de * math.sin(a) + dn * math.cos(a), across=de * math.cos(a) - dn * math.sin(a),
                yaw=((r['yaw'] - t[2] + 180) % 360) - 180, pitch=r['pitch'] - t[3], hfov=r['hfov'] - t[5])


def make_summary(cards, nonames):
    rows = []
    for n in SCANS:
        rf = os.path.join(WD, RES, n + '.json')
        if not os.path.exists(rf): continue
        r = json.load(open(rf))
        if not r.get('ok'): rows.append(f'<tr><td>{n[5:]}</td><td colspan="7">failed</td></tr>'); continue
        e = scan_err(n, r); nn = nonames.get(n)
        en = scan_err(n, nn) if nn and nn.get('ok') else None
        ntxt = f"{en['pos']:.0f} m, heading {en['yaw']:+.1f}°" if en else '-'
        rows.append(f'<tr><td>{n[5:]} · {html.escape(SCANS[n][0].split(" (")[0])}</td><td><b>{e["pos"]:.0f} m</b></td><td>{e["along"]:+.0f} / {e["across"]:+.0f}</td>'
                    f'<td>{e["yaw"]:+.2f}° / {e["pitch"]:+.2f}°</td><td>{e["hfov"]:+.2f}°</td><td>{r["rms_px"]:.1f} px ({r["agree"] * 100:.0f}%)</td><td>{r["times"]["total"]:.0f} s</td>'
                    f'<td>{ntxt}</td></tr>')
    cnt = {}
    for n, _, v in cards:
        g = 'Grand Teton' if n.startswith('T') else 'Faroes' if n.startswith('F') else None
        if g: cnt.setdefault(g, {}); cnt[g][v] = cnt[g].get(v, 0) + 1
    vs = ['placed', 'direction only', 'weak', 'not placed']
    crow = ''.join(f'<tr><td>{g}</td>' + ''.join(f'<td>{c.get(v, 0)}</td>' for v in vs) + f'<td>{sum(c.values())}</td></tr>' for g, c in cnt.items())
    return f'''<section class="sum card"><h2>What this is</h2>
<p>For each photo: one quick look names what can be seen (peaks, barns, churches, with rough pixel spots; written down before solving),
then code finds the spot and framing: it compares the photo's sky line (found automatically) with the sky line of our own 3D terrain
from every spot within 3 km of the stop, every heading and lens width, then fine-tunes the best few. No hand tuning per photo.
<b>Placed</b> = the sky line fits and the spot cannot slide more than ~400 m; <b>direction only</b> = it fits, but with only far mountains
in view the spot can slide along the line of sight (lens and distance trade off); <b>weak</b> / <b>not placed</b> = poor fit, no sky line, or a close-up.</p>
<h3>Phase 1 · film scans vs the hand solves</h3>
<table><tr><th>Scan</th><th>Spot error</th><th>along / sideways (m)</th><th>heading / tilt</th><th>lens</th><th>sky fit</th><th>time</th><th>no names</th></tr>{''.join(rows)}</table>
<h3>Phase 2 · reference photos</h3>
<table><tr><th></th>{''.join(f'<th>{v}</th>' for v in vs)}<th>photos</th></tr>{crow}</table>
<p class="sub">Faroes: one photo per stop (41 of 174). Times are on a shared 4-core test machine, 3 photos at once.</p></section>'''


def _compass(b):
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][int((b + 22.5) // 45) % 8]


def main():
    cards = []; stats = dict(scans=[], ref={})
    names = sorted(f[:-5] for f in os.listdir(os.path.join(WD, 'landmarks')) if f.endswith('.json'))
    order = [n for n in names if n.startswith('idea')] + [n for n in names if n.startswith('scan_')] + [n for n in names if n.startswith('T')] + [n for n in names if n.startswith('F')]
    nonames = {}
    for n in order:
        lm = json.load(open(os.path.join(WD, 'landmarks', n + '.json')))
        rf = os.path.join(WD, RES, n + '.json'); r = json.load(open(rf)) if os.path.exists(rf) else None
        if lm.get('idea'):
            st = [p for p in photos.values() if p['stop_id'] == IDEA_STOP]
            meta = dict(photo=r['photo'] if r else '', stop_id=IDEA_STOP, stop_name=lm.get('stop', ''), stop=(st[0]['lat'], st[0]['lng']))
        elif n.startswith('scan_'):
            meta = dict(photo=os.path.join(WD, 'scans', n[5:] + '.png'), stop_id=SCAN_STOP[n], stop_name=SCANS[n][0])
            st = [p for p in photos.values() if p['stop_id'] == SCAN_STOP[n]]
            meta['stop'] = (st[0]['lat'], st[0]['lng']) if st else SCANS[n][1][:2]
            rn = os.path.join(WD, RES + '_nonames', n + '.json')
            if os.path.exists(rn): nonames[n] = json.load(open(rn))
        else:
            p = photos[lm['photo_id']]
            meta = dict(photo=os.path.join(WD, 'photos', p['id'] + '.jpg'), stop_id=p['stop_id'], stop_name=p['name'], stop=(p['lat'], p['lng']), photo_id=p['id'])
        if r is None and not lm.get('skip'):
            continue
        try:
            cards.append((n, card(n, r, lm, meta), verdict(r, lm)[0]))
        except Exception as e:  # noqa: BLE001
            cards.append((n, f'<article class="card"><h2>{n}</h2><p>card failed: {html.escape(repr(e))}</p></article>', 'not placed'))
        print(n, cards[-1][2], flush=True)
    json.dump(dict(verdicts={n: v for n, _, v in cards}), open(os.path.join(OUT, 'verdicts.json'), 'w'))
    summary = make_summary(cards, nonames)
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Photo Spot Finder</title><style>
:root{{--bg:#f6f6f4;--card:#fff;--fg:#1d1d1b;--mut:#666;--line:#ddd;--ok:#2f8a57;--mid:#b07a12;--bad:#b23b3b;--map:#eef1ee}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#111;--card:#1b1b1b;--fg:#eee;--mut:#9a9a9a;--line:#333;--ok:#5aaa7a;--mid:#d6a640;--bad:#e06a6a;--map:#222}}}}
:root[data-theme="dark"]{{--bg:#111;--card:#1b1b1b;--fg:#eee;--mut:#9a9a9a;--line:#333;--ok:#5aaa7a;--mid:#d6a640;--bad:#e06a6a;--map:#222}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Roboto,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:16px}} h1{{font-size:22px;margin:8px 0}} h2{{font-size:16px;margin:0}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:14px 0}}
.card header{{display:flex;justify-content:space-between;gap:8px;align-items:center}}
.badge{{font-size:12px;padding:2px 8px;border-radius:99px;color:#fff;white-space:nowrap}} .ok{{background:var(--ok)}} .mid{{background:var(--mid)}} .bad{{background:var(--bad)}}
.sub{{color:var(--mut);font-size:13px;margin:4px 0 8px}}
.pics{{display:flex;flex-wrap:wrap;gap:10px}} figure{{margin:0;flex:1 1 240px;max-width:560px}} figure img{{width:100%;height:auto;border-radius:6px;display:block}}
figure .rd{{max-width:300px}} figcaption{{font-size:12px;color:var(--mut)}}
.map{{width:100%;max-width:300px;display:block}} .mapbg{{fill:var(--map)}} .pin{{fill:none;stroke:var(--fg);stroke-width:1.5}} .stop{{fill:var(--mid)}}
.me{{fill:var(--bad)}} .truth{{stroke:var(--ok);stroke-width:3}} .hd{{stroke:var(--bad);stroke-width:2}} .fov{{stroke:var(--bad);stroke-width:1;stroke-dasharray:3 3;opacity:.7}}
.unc{{stroke:var(--mid);stroke-width:7;opacity:.45;stroke-linecap:round}} .unc2{{stroke:var(--mid);stroke-width:4;opacity:.35;stroke-linecap:round}}
.scale{{stroke:var(--fg);stroke-width:2}} .mt{{fill:var(--mut);font-size:11px}}
table{{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}} th{{text-align:left;color:var(--mut);font-weight:500;padding:3px 8px 3px 0;vertical-align:top;width:150px}} td{{padding:3px 0}}
.sec{{font-size:18px;margin:26px 0 4px}} .sum table td, .sum table th{{border-bottom:1px solid var(--line);padding:4px 6px}} .sum{{overflow-x:auto}}
@media (max-width:560px){{th{{width:110px}}}}
</style></head><body><main>
<h1>Find my spot from a photo — prototype check</h1>
{''.join(['<h2 class="sec">Shot ideas</h2>'] + [c for n, c, _ in cards if n.startswith('idea')]) if any(n.startswith('idea') for n, _, _ in cards) else ''}
{summary}
<h2 class="sec">1 · Your six film scans (answers known from the hand solves)</h2>
{''.join(c for n, c, _ in cards if n.startswith('scan_'))}
<h2 class="sec">2 · Grand Teton reference photos</h2>
{''.join(c for n, c, _ in cards if n.startswith('T'))}
<h2 class="sec">3 · Faroes reference photos (one per stop)</h2>
{''.join(c for n, c, _ in cards if n.startswith('F'))}
</main></body></html>'''
    open(os.path.join(WD, 'review.html'), 'w').write(page)


if __name__ == '__main__':
    main()
