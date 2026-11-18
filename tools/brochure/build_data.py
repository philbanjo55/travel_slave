import json, sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from content import TETON_DAYS, FAROE_DAYS, BLURBS, HOTEL_NAMES, PHOTO_ALIAS, PHOTO_SKIP

D = sys.argv[1]; OUT = sys.argv[2]
trips = {t['id']: t for t in json.load(open(f'{D}/trips.json'))}
days = json.load(open(f'{D}/days.json'))
stops = json.load(open(f'{D}/stops.json'))
legs = json.load(open(f'{D}/legs.json'))
sel = json.load(open(f'{D}/sel.json'))

TET = '5e247891-d800-4d07-b5e0-8ad748ae2754'; FAR = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'
DISPLAY = {
 'JAC — Arrive + Rental': 'Land at Jackson Hole (JAC)', 'JAC — Depart': 'Fly home from Jackson Hole',
 'IAD — Depart': 'Fly from Washington Dulles', 'KEF — Connect (2h 35m)': 'Change planes in Iceland',
 'FAE — Arrive + Europcar': 'Land on Vágar', 'Cottages by the Sea — Check-in + rest': 'Check in: Cottages by the Sea',
 'Skinny Skis — Gear Pickup': 'Ski and snowshoe rental', 'Skinny Skis — Return': 'Gear back to the shop',
 'Antelope Flats — Snowshoe In': 'Snowshoe in to Mormon Row', 'Hotel Brandan — Check-in': 'Check in: Hotel Brandan',
 'Ferry Port — Klaksvík (board with car)': 'Ferry to Kalsoy', 'Ferry Port — Syðradalur (arrive, drive north)': 'Drive north on Kalsoy',
 'Ferry Port — Syðradalur (board, last boat)': 'Last ferry back to Klaksvík', 'FAE — Depart': 'Fly home via Iceland',
 'Teton Pines Nordic Center — Groomed Ski': 'Teton Pines Nordic Center', 'Drangarnir — Guided': 'Drangarnir boat landing (morning)',
 'Drangarnir - Golden Hour Landing': 'Drangarnir boat landing (golden hour)', 'Bøur — Evening': 'Bøur (evening)',
 'Velbastaður — Wide barn before town': 'Velbastaður: barn before town', 'Velbastaður — Mountain curve shot': 'Velbastaður: the mountain road',
 'Velbastaður — Pinterest barn': 'Velbastaður: the famous barn', '⚓ Tindhólmur — Landing on the Islet': 'Tindhólmur: landing on the islet',
 'Eiðiskollur Summit — above Risin og Kellingin': 'Eiðiskollur, above Risin and Kellingin', 'Múli — abandoned hamlet': 'Múli, the abandoned hamlet',
 'Mikladalur — Kópakonan + the waterfall': 'Mikladalur: the Seal Woman and the waterfall', 'Saksunardalur — Red Barns': 'Saksunardalur barns',
}
TIME_OVERRIDE = {'Ferry Port — Klaksvík (board with car)': '6:40 AM', 'Ferry Port — Syðradalur (board, last boat)': '10:35 PM', 'KEF — Connect (2h 35m)': '6:25 AM', 'FAE — Depart': '2:05 PM', 'JAC — Depart': '4:19 PM'}

photos = {}
for p in sel:
    if (p['name'], p['position']) in PHOTO_SKIP: continue
    photos.setdefault(p['name'], []).append({'u': p['storage_url'], 'w': p['w'], 'h': p['h']})
def photos_for(name):
    if name in PHOTO_ALIAS:
        src, i = PHOTO_ALIAS[name]; ps = photos.get(src, [])
        return ps[i:i+1] + ps[:1] if len(ps) > i else ps[:2]
    return photos.get(name, [])[:2]

km = {}
for l in legs:
    v = l['dt_km'] or l['sl_km']
    if v: km[(l['trip_id'], l['day_number'])] = km.get((l['trip_id'], l['day_number']), 0) + float(v)

def clean(name):
    n = re.sub(r'^[🐦⚓]️?\s*', '', name)
    return n.replace('Drangarnir - Golden', 'Drangarnir: Golden').replace(' — ', ': ')

def hotel_of(name):
    for k, v in HOTEL_NAMES.items():
        if k in name: return v
    return None

missing = []
out = {}
for tid, key, dmeta in ((TET, 'tetons', TETON_DAYS), (FAR, 'faroes', FAROE_DAYS)):
    t = trips[tid]
    tdays = []
    for d in sorted([d for d in days if d['trip_id'] == tid], key=lambda d: d['day_number']):
        n = d['day_number']
        title, region, intro = dmeta[n]
        ds = sorted([s for s in stops if s['trip_id'] == tid and s['day_number'] == n], key=lambda s: s['position'])
        items = []; hotel = None; out_door = None; hotel_ll = None
        for s in ds:
            nm = s['name']
            if nm.startswith('Sleep') or 'Check-in' in nm or nm.startswith('Hotel Brandan — Check-in'):
                h = hotel_of(nm)
                if h: hotel = h; hotel_ll = [s['lat'], s['lng']]
            b = BLURBS.get(f"{nm}|{n}") or BLURBS.get(nm)
            if (('Depart' in nm and 'IAD' not in nm and 'JAC' not in nm and 'FAE' not in nm and 'Ferry' not in nm)
                    or 'Check Out' in nm or 'Check-out' in nm or nm.startswith('Cottages by the Sea — Sørvágur')):
                if s['time_label'] and out_door is None: out_door = s['time_label']
                continue
            if nm.startswith('Sleep'): continue
            if b is None:
                if s['shot_type'] == 'logistics': continue  # meals, groceries, recover
                missing.append(nm); b = ('shoot', '', [])
            kind, blurb, badges = b
            if kind == 'skip': continue
            items.append({
                'name': DISPLAY.get(nm) or clean(nm), 'emoji': s['emoji'] or '📍', 'time': TIME_OVERRIDE.get(nm, s['time_label']),
                'min': s['duration_minutes'], 'lat': s['lat'], 'lng': s['lng'], 'kind': kind,
                'blurb': blurb, 'badges': badges, 'photos': photos_for(nm) if kind == 'shoot' else [],
            })
        if n == 0: hotel = 'Overnight flight'
        if not items: out_door = None
        tdays.append({'n': n, 'date': d['date'], 'title': title, 'region': region, 'intro': intro,
                      'hotel': hotel, 'hotelLL': hotel_ll if hotel != 'Overnight flight' else None, 'out': out_door, 'km': round(km.get((tid, n), 0))})
        tdays[-1]['stops'] = items
    out[key] = {'title': t['title'], 'tz': t['timezone'], 'start': t['start_date'], 'end': t['end_date'], 'days': tdays}

with open(OUT, 'w') as f:
    f.write('// Built from the trip planner database (read only). Public-safe fields only.\n')
    f.write('window.TRIPS = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n')
print('missing blurbs:', missing)
for k, v in out.items():
    print(k, len(v['days']), 'days', sum(len(d['stops']) for d in v['days']), 'items',
          sum(1 for d in v['days'] for s in d['stops'] if s['kind'] == 'shoot'), 'shoots', sum(d['km'] for d in v['days']), 'km')
    for d in v['days']: print('  ', d['n'], d['date'], d['out'], d['hotel'], d['km'], [s['name'] for s in d['stops']])
