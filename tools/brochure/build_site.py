import re
# Build brochure v2: python3 build_site.py <brochure dir> <out site dir>
import json, os, re, sys, shutil, html, datetime
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], 'tools'))
from content import TETON_DAYS, FAROE_DAYS, BLURBS, HOTEL_NAMES
from content_v2 import TRIPS, EXCURSIONS, EXTRAS, DAY_TITLE

B = sys.argv[1]; OUT = sys.argv[2]; W2 = os.path.join(B, 'v2work')
shutil.rmtree(OUT + '/img', ignore_errors=True); os.makedirs(OUT + '/img', exist_ok=True); os.makedirs(OUT + '/fonts', exist_ok=True)
E = html.escape
TET = '5e247891-d800-4d07-b5e0-8ad748ae2754'; FAR = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'
stops = json.load(open(f'{B}/data/stops.json')); days = json.load(open(f'{B}/data/days.json'))

# ---------- photos ----------
PHIL = {
 'pf_snake': ('phil_scans/p6_snake_river.jpg', 'Snake River Overlook in winter'),
 'pf_barn': ('site_v2_build/img/p4_crop.jpg', 'T.A. Moulton Barn, Mormon Row, on a grey winter day'),
 'pf_oxbow': ('site_v2_build/img/p3_crop.jpg', 'Oxbow Bend frozen over, Mount Moran behind'),
 'pf_cabin': ('site_v2_build/img/p5_crop.jpg', 'Cunningham Cabin with the Tetons behind'),
}
CAPTION = {  # captions for Commons photos (what and where; the credit is added from the file's own metadata)
 'adams': "Ansel Adams, The Tetons and the Snake River, 1942",
 'jenny1': 'Frozen Jenny Lake under Teewinot Mountain', 'tagg1': 'Skiing at Taggart Lake', 'swan1': 'Heron Pond and Swan Lake trail in winter',
 'nye1': "One of the elk-antler arches on Jackson's town square", 'xc1': 'Skiing the closed Teton Park Road',
 'bour6': 'Bøur on Vágar, with Drangarnir and Tindhólmur offshore', 'drang1': 'Drangarnir and Tindhólmur off Vágar', 'drang2': 'The Drangarnir sea arch', 'kallur2': 'Kallur lighthouse on its ridge, Kalsoy', 'mula2': 'Gásadalur and Múlafossur',
 'kallur1': 'Kallur lighthouse, Kalsoy', 'mula1': 'Múlafossur below Gásadalur', 'lake1': 'Sørvágsvatn seen from Trælanípa',
 'gjogv1': 'Gjógv and its gorge harbour', 'saksun1': 'Saksun and its lagoon', 'ting1': 'Tinganes, the old quarter of Tórshavn',
 'klak1': 'Klaksvík seen from Klakkur',
}
meta = json.load(open(f'{W2}/big/meta.json'))
PHOTOS = {}
def short_artist(a, m=None):
    a = re.sub(r'\s+', ' ', a or '').strip()
    if a == 'Ansel Adams': return 'Ansel Adams / U.S. National Archives'
    if a in ('GrandTetonNPS', 'Grand Teton') and m:
        mm = re.search(r'NPS(?: Photo)?\s*/\s*([^\n]+)', m.get('desc', '')) or re.search(r'NPS(?: Photo)?\s*/\s*([^\n]+)', m.get('credit', ''))
        return 'NPS / ' + mm.group(1).strip()[:40] if mm else 'National Park Service'
    a = re.sub(r'^(Photo|Photograph)\s*(by|:)\s*', '', a, flags=re.I)
    return a[:80] or 'Unknown'
def lic_label(m):
    l = m['license']
    return 'Public domain' if l.lower().startswith(('public domain', 'pd')) else l
def make(pid):
    if pid in PHOTOS: return PHOTOS[pid]
    if pid in PHIL:
        src, cap = PHIL[pid]; src = os.path.join(B, src); credit = None
    else:
        m = meta.get(pid)
        src = f'{W2}/big/{pid}.jpg'
        if not m or not m.get('free') or not os.path.exists(src) or open(src, 'rb').read(3) != b'\xff\xd8\xff':
            PHOTOS[pid] = None; return None
        cap = CAPTION.get(pid, m['key'][5:]); credit = m
    im = Image.open(src).convert('RGB'); w, h = im.size
    out = {}
    for tag, L in (('', 1600), ('-800', 800)):
        k = min(1, L / max(w, h)); im2 = im.resize((round(w * k), round(h * k)), Image.LANCZOS) if k < 1 else im
        fn = f'img/{pid}{tag}.jpg'; im2.save(f'{OUT}/{fn}', quality=80, optimize=True, progressive=True)
        out[tag or 'big'] = (fn, im2.size)
    PHOTOS[pid] = {'id': pid, 'big': out['big'], 'small': out['-800'], 'cap': cap, 'credit': credit}
    return PHOTOS[pid]

def credit_short(p):
    if not p['credit']: return 'Photo: Philm+Frame'
    m = p['credit']; return f"Photo: {E(short_artist(m['artist'], m))}, {E(lic_label(m))}"

def img_tag(p, sizes, cls='', eager=False, alt=None):
    (b, (bw, bh)), (s, (sw, sh)) = p['big'], p['small']
    return (f'<img class="{cls}" src="{b}" srcset="{s} {sw}w, {b} {bw}w" sizes="{sizes}" width="{bw}" height="{bh}" '
            f'alt="{E(alt or p["cap"])}" {"fetchpriority=high" if eager else "loading=lazy"} decoding="async">')

def figure(p, sizes, cls=''):
    return (f'<figure class="{cls}">{img_tag(p, sizes)}<figcaption>{E(p["cap"])} '
            f'<span class="by">{credit_short(p)}</span></figcaption></figure>')

# ---------- plan ----------
DISPLAY_SKIP = ('Sleep', 'Check Out', 'Check-out')
def clean(n):
    n = re.sub(r'^[^\wÁ-ž]+', '', n).strip()
    return n.replace('Drangarnir - Golden', 'Drangarnir: Golden').replace(' — ', ': ')
NAMES = {
 'Drangarnir — Guided': 'Drangarnir boat landing (morning)', 'Drangarnir - Golden Hour Landing': 'Drangarnir boat landing (golden hour)',
 '⚓ Tindhólmur — Landing on the Islet': 'Tindhólmur landing (not booked yet)', 'Antelope Flats — Snowshoe In': 'Snowshoe in to Mormon Row',
 'Teton Pines Nordic Center — Groomed Ski': 'Teton Pines Nordic Center', 'Skinny Skis — Gear Pickup': 'Pick up skis and snowshoes',
 'JAC — Arrive + Rental': 'Land at Jackson Hole', 'JAC — Depart': 'Fly home from Jackson Hole', 'IAD — Depart': 'Fly from Washington Dulles',
 'FAE — Arrive + Europcar': 'Land on Vágar', 'FAE — Depart': 'Fly home via Iceland', 'Ferry Port — Klaksvík (board with car)': 'Ferry to Kalsoy',
 'Ferry Port — Syðradalur (board, last boat)': 'Last ferry back', 'Trælanípa · Sørvágsvatn · Bøsdalafossur · Geituskorardrangur': 'Trælanípa and the lake above the ocean',
 'Eiðiskollur Summit — above Risin og Kellingin': 'Eiðiskollur, above Risin and Kellingin', 'Mikladalur — Kópakonan + the waterfall': 'Mikladalur and the Seal Woman',
 'Fjallavatn · Víkar · Reipsáfossur': 'Walk to Reipsáfossur', 'Sandoy — Drangarnir + Søltuvík': 'Sandoy: Søltuvík and its sea stack',
 'Viðareiði — Villingardalsfjall + Malinsfjall': 'Climb above Viðareiði', 'Múli — abandoned hamlet': 'Múli, the abandoned hamlet',
 'Velbastaður — Pinterest barn': 'Velbastaður barns', 'Swan Lake–Heron Pond Loop': 'Swan Lake and Heron Pond loop',
 'Taggart & Bradley Lakes': 'Taggart and Bradley Lakes (snowshoe)', 'Jenny Lake': 'Ski to Jenny Lake', "Emily's Pond Levee": "Ski at Emily's Pond",
 'Shane Cabins + Gros Ventre River': 'Shane Cabins and the Gros Ventre', 'John Moulton Barn + Pink House': 'John Moulton Barn',
 'Hvíthamar + Skeggjanøv': 'Hvíthamar', '🐦 Ambadalur + Búgvin': 'Cliff walk toward Búgvin', 'Saksunardalur — Red Barns': None,
 'Velbastaður — Wide barn before town': None, 'Velbastaður — Mountain curve shot': None, 'Bøur — West Viewpoint': 'Bøur at sunset',
 'Bøur — Panoramic Viewpoint': None, 'Ferry Port — Syðradalur (arrive, drive north)': None, 'Ferry Port — Klaksvík (arrive)': None,
 'Hotel Brandan — Check-in': None, 'Cottages by the Sea — Check-in + rest': None, 'KEF — Connect (2h 35m)': 'Change planes in Iceland',
 'Skinny Skis — Return': None, 'Drive to Vágar Airport': None, 'Tjørnuvík — Recover': None, 'Bøur — Evening': 'Bøur in the evening',
 'Bøur Viewpoint': 'Evening viewpoint on Vágar',
}
TIME_FIX = {'Ferry Port — Klaksvík (board with car)': '6:40 AM', 'KEF — Connect (2h 35m)': '6:25 AM', 'FAE — Depart': '2:05 PM', 'JAC — Depart': '4:19 PM'}
# headline order: these first if present on the day
PRIORITY = ['Jenny Lake', 'Taggart & Bradley Lakes', 'T.A. Moulton Barn', 'Snake River Overlook', 'Oxbow Bend', 'Swan Lake–Heron Pond Loop',
            'Kallur', 'Drangarnir — Guided', 'Drangarnir - Golden Hour Landing', 'Trælanípa · Sørvágsvatn · Bøsdalafossur · Geituskorardrangur',
            '🐦 Múlafossur', '🐦 Mýlingur Sea Cliffs', 'Saksun', 'Tjørnuvík', 'Tinganes', 'Kirkjubøur', '🐦 Gjógv Gorge', 'Klakkur',
            '⚓ Tindhólmur — Landing on the Islet', 'Dunnesdrangar', 'Fossá', 'JAC — Arrive + Rental', 'FAE — Arrive + Europcar', 'JAC — Depart', 'FAE — Depart']
MEAL_STOPS = {'Lunch — Gjáargarður': 'Lunch: the guesthouse café in Gjógv (coffee and liquorice ice cream)'}
PENCIL_DAYS = {('faroes', 5), ('faroes', 6), ('faroes', 8)}

def hotel_of(n):
    for k, v in HOTEL_NAMES.items():
        if k in n: return v
def dlabel(iso, long=False):
    d = datetime.date.fromisoformat(iso)
    return d.strftime('%a %-d %b' if not long else '%A %-d %B')

trip_days = {}; mapdata = {}
for tid, key, dm in ((TET, 'tetons', TETON_DAYS), (FAR, 'faroes', FAROE_DAYS)):
    out = []; pts = []; hotels = {}
    for d in sorted([d for d in days if d['trip_id'] == tid], key=lambda d: d['day_number']):
        n = d['day_number']; title, region, intro = dm[n]; title = DAY_TITLE.get((key, n), title)
        ds = sorted([s for s in stops if s['trip_id'] == tid and s['day_number'] == n], key=lambda s: s['position'])
        hotel = 'Overnight flight' if n == 0 else None; items = []; meals = []
        for s in ds:
            nm = s['name']
            for ln in (s.get('info') or '').split('\n'):
                m = re.match(r'\W*Dinner:\s*([^,]+),\s*(\d{1,2}:\d{2}\s*[AP]M)', ln.strip())
                if m: meals.append(f'Dinner: {m.group(1).strip()}, {m.group(2)}')
            if nm in MEAL_STOPS: meals.append(MEAL_STOPS[nm])
            h = hotel_of(nm) if (nm.startswith('Sleep') or 'Check-in' in nm) else None
            if h:
                hotel = h; hotels.setdefault(h, (s['lat'], s['lng']))
            if nm.startswith(DISPLAY_SKIP) or nm.startswith('Idea:'): continue
            b = BLURBS.get(f'{nm}|{n}') or BLURBS.get(nm)
            if (b is None and s['shot_type'] == 'logistics') or (b and b[0] == 'skip'): continue
            label = NAMES.get(nm, clean(nm)) if nm in NAMES else clean(nm)
            if label is None: continue
            if any(i['label'] == label for i in items): continue
            items.append({'nm': nm, 'label': label, 'time': TIME_FIX.get(nm, s['time_label']), 'shoot': (b or ('shoot',))[0] == 'shoot',
                          'lat': s['lat'], 'lng': s['lng']})
            if (b or ('shoot',))[0] == 'shoot' and s['lat']:
                pts.append({'lat': s['lat'], 'lng': s['lng'], 'name': label, 'day': n, 'date': dlabel(d['date'])})
        rank = {nm: i for i, nm in enumerate(PRIORITY)}
        head = sorted(items, key=lambda i: (rank.get(i['nm'], 99), items.index(i)))[:4]
        head = sorted(head, key=lambda i: items.index(i))
        out.append({'n': n, 'date': d['date'], 'title': title, 'region': region, 'intro': intro, 'hotel': hotel,
                    'head': head, 'more': len(items) - len(head), 'pencil': (key, n) in PENCIL_DAYS, 'meals': meals})
    trip_days[key] = out
    mapdata[key] = {'stops': pts, 'hotels': [{'name': k, 'lat': v[0], 'lng': v[1]} for k, v in hotels.items()]}

# ---------- HTML ----------
def pick(ph, avoid=()):
    for c in ([ph] if isinstance(ph, str) else ph):
        if c in avoid: continue
        p = make(c)
        if p: return p
    return None
FLIP = {'n': 0}
def excursion_html(key, x, i):
    p = pick(x['photo'], (TRIPS[key]['hero'],)); x['_photo'] = p['id'] if p else None
    if i == 0: FLIP['n'] = 0
    flip = ''
    if p:
        flip = ' x-flip' if FLIP['n'] % 2 else ''; FLIP['n'] += 1
    note = f'<p class="x-note">{E(x["note"])}</p>' if x.get('note') else ''
    body = ''.join(f'<p>{E(t)}</p>' for t in x['text'])
    fig = figure(p, '(min-width: 900px) 58vw, 100vw', 'x-fig') if p else ''
    return (f'<article class="x{flip}{"" if p else " x-textonly"}" id="{key}-x-{x["id"]}">{fig}<div class="x-text">'
            f'<p class="x-when">{E(x["when"])}</p><h3>{E(x["title"])}</h3>{body}{note}'
            f'<a class="x-plan" href="#{key}-day-{x["day"]}" data-day="{key}-day-{x["day"]}">See the day in the plan</a></div></article>')

def extras_html(key):
    xs = EXTRAS.get(key) or []
    if not xs: return ''
    cards = []
    for x in xs:
        p = make(x['photo'])
        if not p: continue
        cards.append(f'<article class="extra">{figure(p, "(min-width: 700px) 40vw, 100vw", "extra-fig")}'
                     f'<div><p class="x-when">{E(x["when"])}</p><h3>{E(x["title"])}</h3><p>{E(x["text"])}</p></div></article>')
    return f'<div class="extras"><h3 class="extras-h">Also on the list</h3><div class="extras-grid">{"".join(cards)}</div></div>'

def day_html(key, d):
    lis = ''.join(f'<li><span class="t">{E(i["time"] or "")}</span><span>{E(i["label"])}</span></li>' for i in d['head'])
    more = f'<li class="more"><span class="t"></span><span>and {d["more"]} more stop{"s" if d["more"] > 1 else ""}</span></li>' if d['more'] > 0 else ''
    stops = f'<ul class="stops">{lis}{more}</ul>' if d['head'] else ''
    pencil = '<span class="tag">Pencilled in</span>' if d['pencil'] else ''
    hotel = f'<p class="night">{"Night: " if d["hotel"] and d["hotel"] != "Overnight flight" else ""}{E(d["hotel"] or "Flying home")}</p>'
    meal = ''.join(f'<p class="meal">{E(m)}</p>' for m in d.get('meals') or [])
    return (f'<details class="day" id="{key}-day-{d["n"]}"><summary><span class="d-date">{E(dlabel(d["date"]))}</span>'
            f'<span class="d-main"><span class="d-title">{E(d["title"])}</span><span class="d-region">{E(d["region"])}</span></span>{pencil}'
            f'<span class="chev" aria-hidden="true"></span></summary><div class="d-body"><p class="d-intro">{E(d["intro"])}</p>{stops}{meal}{hotel}</div></details>')

def credits_html(key, ids):
    rows = []
    for pid in ids:
        p = PHOTOS.get(pid)
        if not p: continue
        if not p['credit']:
            rows.append(f'<li><span class="c-what">{E(p["cap"])}</span> Photo: Philm+Frame, on film.</li>'); continue
        m = p['credit']; lic = lic_label(m)
        licl = f'<a href="{E(m["license_url"])}" rel="license noopener">{E(lic)}</a>' if m.get('license_url') else E(lic)
        rows.append(f'<li><span class="c-what">{E(p["cap"])}</span> {E(short_artist(m["artist"], m))}. {licl}. '
                    f'<a href="{E(m["page"])}" rel="noopener">{E(m["key"][5:])}</a> on Wikimedia Commons.</li>')
    return f'<section class="credits" aria-labelledby="{key}-credits-h"><h2 id="{key}-credits-h">Photo credits</h2><ul>{"".join(rows)}</ul></section>'

def trip_html(key):
    t = TRIPS[key]; hero = make(t['hero'])
    xs = ''.join(excursion_html(key, x, i) for i, x in enumerate(EXCURSIONS[key]))
    used = [t['hero']] + [x['_photo'] for x in EXCURSIONS[key] if x.get('_photo')] + [x['photo'] for x in EXTRAS.get(key, [])]
    facts = ''.join(f'<li><b>{E(a)}</b><span>{E(b)}</span></li>' for a, b in t['facts'])
    dhtml = ''.join(day_html(key, d) for d in trip_days[key])
    nk, nl = t['next']
    heroimg = img_tag(hero, '100vw', 'hero-img', eager=True).replace('<img ', f'<img style="object-position:{t["hero_pos"]}" ') if hero else ''
    return f'''
<section class="trip" id="{key}" data-trip="{key}" aria-labelledby="{key}-title">
  <header class="hero">
    {heroimg}
    <div class="hero-shade"></div>
    <div class="hero-text wrap">
      <p class="kicker">{E(t["kicker"])}</p>
      <h1 id="{key}-title">{E(t["title"])}</h1>
      <p class="dates">{E(t["dates"])}</p>
      <p class="countdown" data-start="{t["start"]}" data-end="{t["end"]}"></p>
    </div>
    <p class="hero-cap">{E(hero["cap"]) if hero else ""} · {credit_short(hero) if hero else ""}</p>
  </header>
  <div class="wrap intro">
    <p class="lede">{E(t["intro"])}</p>
    <ul class="facts">{facts}</ul>
  </div>
  <section class="big wrap-wide" aria-labelledby="{key}-big-h">
    <h2 class="sec-h wrap" id="{key}-big-h">The big days</h2>
    {xs}
    {extras_html(key)}
  </section>
  <section class="plan wrap" aria-labelledby="{key}-plan-h" id="{key}-plan">
    <h2 class="sec-h" id="{key}-plan-h">The plan right now</h2>
    <p class="plan-note">This is the current plan. We plan around the weather, so days get swapped and stops move, sometimes the night before.</p>
    <div class="plan-tools"><button type="button" class="toggle-all" data-trip="{key}">Open every day</button></div>
    <div class="days">{dhtml}</div>
    <div class="map-wrap"><h3 class="map-h">Where it all is</h3><div class="map" id="map-{key}" role="region" aria-label="Map of the planned stops"></div>
      <p class="map-key"><span class="k k-x"></span>Big days <span class="k k-s"></span>Other stops <span class="k k-h"></span>Where we sleep</p></div>
  </section>
  <div class="wrap">{credits_html(key, list(dict.fromkeys(used)))}
    <p class="next"><a href="#{nk}" data-go="{nk}">{E(nl)} &rarr;</a></p></div>
</section>'''

# excursion stop names to highlight on the map
XNAMES = {
 'tetons': ['Ski to Jenny Lake', 'Taggart and Bradley Lakes (snowshoe)', 'T.A. Moulton Barn', 'Snake River Overlook', 'Oxbow Bend', 'Swan Lake and Heron Pond loop'],
 'faroes': ['Múlafossur', 'Trælanípa and the lake above the ocean', 'Drangarnir boat landing (morning)', 'Drangarnir boat landing (golden hour)', 'Saksun',
            'Tjørnuvík', 'Tinganes', 'Kirkjubøur', 'Gjógv Gorge', 'Klakkur', 'Kallur'],
}
for k in mapdata:
    for s in mapdata[k]['stops']: s['x'] = s['name'] in XNAMES[k]

body = trip_html('tetons') + trip_html('faroes')
updated = datetime.date.today().strftime('%-d %B %Y')
page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Philm+Frame Trips</title>
<meta name="description" content="Two photography trips: Grand Teton in winter (29 Dec 2026 to 4 Jan 2027) and the Faroe Islands (13 to 28 May 2027). The big days, the current plan and a map.">
<meta property="og:title" content="Philm+Frame Trips: Grand Teton and the Faroe Islands">
<meta property="og:description" content="Winter in the Tetons, then two weeks in the Faroe Islands. The big days and the plan as it stands.">
<meta property="og:image" content="img/pf_snake.jpg">
<meta name="theme-color" content="#1c2733">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%231c2733'/%3E%3Cpath d='M8 48 L24 24 L30 32 L38 16 L56 48Z' fill='%23eef2f5'/%3E%3C/svg%3E">
<link rel="preload" href="fonts/newsreader.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">
<link rel="stylesheet" href="styles.css">
</head>
<body data-trip="tetons">
<a class="skip" href="#main">Skip to content</a>
<nav class="top" aria-label="Trips">
  <a class="brand" href="#tetons" data-go="tetons">Philm+Frame Trips</a>
  <div class="switch">
    <a href="#tetons" data-go="tetons">{E(TRIPS["tetons"]["nav"])}<small>{E(TRIPS["tetons"]["navsub"])}</small></a>
    <a href="#faroes" data-go="faroes">{E(TRIPS["faroes"]["nav"])}<small>{E(TRIPS["faroes"]["navsub"])}</small></a>
  </div>
</nav>
<main id="main">{body}
</main>
<footer class="foot wrap"><p>Two trips, one camera bag. Plans change with the weather; this page was last updated {updated}.</p>
<p>Map data &copy; OpenStreetMap contributors.</p></footer>
<script>window.MAPS = {json.dumps(mapdata, ensure_ascii=False)};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script src="app.js"></script>
</body>
</html>
'''
open(f'{OUT}/index.html', 'w').write(page)
missing = [k for k, v in PHOTOS.items() if v is None]
print('photos used:', [k for k, v in PHOTOS.items() if v]); print('MISSING photos:', missing)
for k, v in trip_days.items():
    for d in v: print(k, d['n'], d['date'], d['title'], '|', [i['label'] for i in d['head']], '+', d['more'], '|', d['hotel'])
SRC = os.path.join(W2, 'site_src')
for f in ('styles.css', 'app.js'): shutil.copy(os.path.join(SRC, f), os.path.join(OUT, f))
FD = os.path.join(W2, 'fonts/node_modules/@fontsource-variable')
shutil.copy(f'{FD}/newsreader/files/newsreader-latin-opsz-normal.woff2', f'{OUT}/fonts/newsreader.woff2')
shutil.copy(f'{FD}/newsreader/files/newsreader-latin-opsz-italic.woff2', f'{OUT}/fonts/newsreader-italic.woff2')
shutil.copy(f'{FD}/inter/files/inter-latin-wght-normal.woff2', f'{OUT}/fonts/inter.woff2')
for lic in ('newsreader', 'inter'):
    p = f'{FD}/{lic}/LICENSE'
    if os.path.exists(p): shutil.copy(p, f'{OUT}/fonts/LICENSE-{lic}.txt')
