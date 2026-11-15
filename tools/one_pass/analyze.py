"""Grade the one-pass test (tests 2-3) from sim.py's output: per (week, day) the plan shown after a noon re-plan,
one-pass (op / opdrop) vs two-step (stale), scored on the truth from noon on; rule checks on every rest plan.
usage: analyze.py <source config> <sim.jsonl> [--json out]"""
import sys, json, math, datetime as dt, statistics as stt, argparse
from zoneinfo import ZoneInfo
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import get

ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('sim'); ap.add_argument('--json'); ap.add_argument('--runs', default='')
a = ap.parse_args()
recs = [json.loads(l) for l in open(a.sim)]
by = {}
for r in recs: by[(r['R'], r['d'], r['arm'])] = r

def ts(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))

# --- sun: civil dusk (sun at -6 deg) at a point, NOAA formulas
def sun_alt(lat, lng, t):
    jd = t.timestamp() / 86400 + 2440587.5; T = (jd - 2451545) / 36525
    L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360; M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    C = math.sin(math.radians(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + math.sin(math.radians(2 * M)) * (0.019993 - 0.000101 * T) + math.sin(math.radians(3 * M)) * 0.000289
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(math.radians(125.04 - 1934.136 * T))
    eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * math.cos(math.radians(125.04 - 1934.136 * T))
    dec = math.degrees(math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(lam))))
    y = math.tan(math.radians(eps / 2)) ** 2
    eqt = 4 * math.degrees(y * math.sin(2 * math.radians(L0)) - 2 * e * math.sin(math.radians(M)) + 4 * e * y * math.sin(math.radians(M)) * math.cos(2 * math.radians(L0)) - 0.5 * y * y * math.sin(4 * math.radians(L0)) - 1.25 * e * e * math.sin(2 * math.radians(M)))
    mins = t.hour * 60 + t.minute + t.second / 60
    ha = (mins + eqt + 4 * lng) / 4 - 180
    z = math.degrees(math.acos(max(-1, min(1, math.sin(math.radians(lat)) * math.sin(math.radians(dec)) + math.cos(math.radians(lat)) * math.cos(math.radians(dec)) * math.cos(math.radians(ha))))))
    return 90 - z

def sun_alt_t(lat, lng, ms):
    # solver-replay's own sunAlt (index.ts), so the dark check matches the planner's rule exactly
    rad = math.pi / 180; d = ms / 86400000 - 10957.5
    g = (357.529 + 0.98560028 * d) * rad; q = 280.459 + 0.98564736 * d
    L = (q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) * rad; e = (23.439 - 0.00000036 * d) * rad
    ra = math.atan2(math.cos(e) * math.sin(L), math.cos(L)); dec = math.asin(math.sin(e) * math.sin(L))
    ha = ((18.697374558 + 24.06570982441908 * d) * 15 + lng) * rad - ra
    return math.asin(math.sin(lat * rad) * math.sin(dec) + math.cos(lat * rad) * math.cos(dec) * math.cos(ha)) / rad

def civil_dusk(date, lat, lng, tz):
    # solver-replay civilDusk: from local noon in 5-min steps, the first with the sun below -6 deg
    t = dt.datetime.fromisoformat(date + 'T12:00:00').replace(tzinfo=ZoneInfo(tz)).timestamp() * 1000
    for _ in range(144):
        if sun_alt_t(lat, lng, t) < -6: break
        t += 5 * 60000
    return dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)

runs = get('replay_runs', id=f'in.({a.runs})', select='id,trip_id,start_date,nights,trip_dates,config', order='start_date') if a.runs else \
    get('replay_runs', config='cs.' + json.dumps({'name': a.src}), select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')
Rmap = {r['id']: r for r in runs}
trip = runs[0]['trip_id']; tz = get('trips', id=f'eq.{trip}', select='timezone')[0]['timezone']
info = None
for pr in get('replay_runs', trip_id=f'eq.{trip}', config='cs.' + json.dumps({'sim_info': True}), select='id', order='id.desc', limit='5'):
    r0 = get('replay_run_days', run_id=f"eq.{pr['id']}", night='eq.0', select='stats')
    if r0 and (r0[0]['stats'] or {}).get('sim'): info = r0[0]['stats']['sim']; break
stops = {s['id']: s for s in get('stops', trip_id=f'eq.{trip}', select='id,lat,lng')}
pl = [stops[k] for k in info if k in stops and stops[k]['lat'] is not None]
mid = (sum(s['lat'] for s in pl) / len(pl), sum(s['lng'] for s in pl) / len(pl))
tog_all = {}
for k, x in info.items():
    if x['tog'] and x['free']: tog_all.setdefault(x['tog'], set()).add(k)
dusk_cache = {}
def dusk(date):
    if date not in dusk_cache: dusk_cache[date] = civil_dusk(date, mid[0], mid[1], tz)
    return dusk_cache[date]

rows_cache = {}
def rows_of(run_id):
    if run_id not in rows_cache:
        rows_cache[run_id] = get('replay_run_days', run_id=f'eq.{run_id}', kind='eq.mrmc', select='night,replay_date,visits,stats', order='night')
    return rows_cache[run_id]

def rated(v): return v.get('value') is not None and v['stop_id'] in info and info[v['stop_id']]['w'] > 0

def score(H, today, rest):
    tod_u = {info[v['stop_id']]['u'] for v in today if rated(v)}
    rest_ids = {id(v) for v in rest}
    rep = 0.0
    base = {}
    for v in H:
        if rated(v): g = info[v['stop_id']]['g']; base[g] = max(base.get(g, 0), round(250 * (v.get('truth') or 0)))
    pts = 0.0
    for v in sorted(today + rest, key=lambda v: v['start']):
        if not rated(v): continue
        x = info[v['stop_id']]; t = round(250 * (v.get('truth') or 0))
        g_ = x['w'] * max(0, t - base.get(x['g'], 0)) / 250
        pts += g_; base[x['g']] = max(base.get(x['g'], 0), t)
        if id(v) in rest_ids and x['u'] in tod_u: rep += g_
    allv = [v for v in H + today + rest if rated(v)]
    units = {info[v['stop_id']]['u'] for v in allv}
    good = {info[v['stop_id']]['u'] for v in allv if (v.get('truth') or 0) >= 0.6}
    big = {info[v['stop_id']]['u'] for v in allv if (v.get('truth') or 0) >= 0.6 and info[v['stop_id']]['w'] >= 5}
    return pts, len(units), len(good), len(big), rep, pts - rep

checks = {k: 0 for k in ['days', 'no_route', 'together_split', 'once_twice', 'dark', 'booking_diff', 'drop_required', 'drop_replaced',
                          'drop_missed', 'drop_optional', 'drop_optional_replaced', 'stale_drop_required', 'stale_drop_replaced',
                          'op_repeat_today', 'stale_repeat_today', 'op_repeat_once', 'stale_repeat_once', 'opdrop_repeat_today']}
def rule_checks(tag, rows, rest, today, H2, srows, R, d, arm2):
    pre = '' if tag == 'op' else 'stale_'
    for x in rows:
        checks[pre + 'days'] = checks.get(pre + 'days', 0) + 1
        if (x['stats'] or {}).get('error'): checks[pre + 'no_route'] = checks.get(pre + 'no_route', 0) + 1; viol.append((R, d, tag + '/' + arm2, 'no route', x['replay_date']))
        vs = x['visits'] or []
        done_before = {v['stop_id'] for v in H2 + today} | {v['stop_id'] for y in rows if y['replay_date'] < x['replay_date'] for v in (y['visits'] or [])}
        for key, ids in tog_all.items():
            here = {v['stop_id'] for v in vs if v['stop_id'] in ids}
            k = len(here)
            # allowed by T (tickfix): the missing half is a once-only stop already done; the other half is a repeat
            if 0 < k < len(ids) and all(info[i]['once'] and i in done_before for i in ids - here):
                checks[pre + 'together_repeat_half'] = checks.get(pre + 'together_repeat_half', 0) + 1; continue
            if 0 < k < len(ids):
                checks[pre + 'together_split'] = checks.get(pre + 'together_split', 0) + 1
                viol.append((R, d, tag + '/' + arm2, 'split ' + key, x['replay_date'], sorted(info[v['stop_id']]['name'] for v in vs if v['stop_id'] in ids)))
        dk = dusk(x['replay_date'])
        for v in vs:
            if rated(v) and info[v['stop_id']]['free'] and not v.get('booked') and ts(v['end']) > dk:
                checks[pre + 'dark'] = checks.get(pre + 'dark', 0) + 1; viol.append((R, d, tag + '/' + arm2, 'after dark ' + v['name'], v['end']))
        if srows is not None:
            bk = sorted(v['stop_id'] for v in vs if v.get('booked'))
            sx = next((y for y in srows if y['replay_date'] == x['replay_date']), None)
            if sx is not None and bk != sorted(v['stop_id'] for v in (sx['visits'] or []) if v.get('booked')):
                checks['booking_diff'] += 1; viol.append((R, d, arm2, 'bookings differ', x['replay_date']))
    before_once = {info[v['stop_id']]['u'] for v in H2 + today if rated(v) and info[v['stop_id']]['once']}
    rest_once = {}
    for v in rest:
        if rated(v) and info[v['stop_id']]['once']: rest_once.setdefault(info[v['stop_id']]['u'], set()).add(v['date'])
    bad = [u for u, ds in rest_once.items() if u in before_once or len(ds) > 1]
    if bad: checks[pre + 'once_twice'] = checks.get(pre + 'once_twice', 0) + len(bad); viol.append((R, d, tag + '/' + arm2, 'once-only twice', bad))

missed = []; pairs = {'plain': [], 'drop': []}; cpu = {'op': [], 'stale': [], 'opdrop': []}
viol = []
for (R, d, arm), r in sorted(by.items()):
    if arm != 'stale' or not r.get('run') or not r.get('ok') or R not in Rmap: continue
    RR = Rmap[R]; bench = {x['night']: x for x in get('replay_run_days', run_id=f'eq.{R}', kind='eq.mrmc', select='night,visits', order='night')} if (R, 'bench') not in rows_cache else rows_cache[(R, 'bench')]
    rows_cache[(R, 'bench')] = bench
    date_d = (dt.date.fromisoformat(RR['start_date']) + dt.timedelta(days=d)).isoformat()
    noon = ts(r['noon'])
    H = [v for k in range(d) for v in (bench[k]['visits'] or [])]
    tod = bench[d]['visits'] or []
    H2 = H + [v for v in tod if ts(v['start']) < noon]
    after = [v for v in tod if ts(v['start']) >= noon]
    def rest_of(run_id):
        rs = [x for x in rows_of(run_id) if x['replay_date'] > date_d]
        return rs, [v for x in rs for v in (x['visits'] or [])]
    srows, srest = rest_of(r['run'])
    out = {}
    for arm2 in ('op', 'opdrop'):
        o = by.get((R, d, arm2))
        if not o or not o.get('run') or not o.get('ok'): continue
        orows, orest = rest_of(o['run'])
        drop = set(o.get('drop') or [])
        today = [v for v in after if v['stop_id'] not in drop]
        A = score(H2, today, orest); B = score(H2, today, srest)
        pairs['plain' if arm2 == 'op' else 'drop'].append({'R': R, 'd': d, 'op': A, 'two': B})
        # rule checks on the one-pass rest plan
        tod_units = {info[v['stop_id']]['u'] for v in today if rated(v)}
        hist_units = {info[v['stop_id']]['u'] for v in H2 if rated(v)}
        rule_checks('op', orows, orest, today, H2, srows, R, d, arm2)
        if arm2 == 'op': rule_checks('stale', srows, srest, today, H2, None, R, d, arm2)
        rest_units = {info[v['stop_id']]['u'] for v in orest if rated(v)}
        rep = tod_units & rest_units
        if arm2 == 'op':
            checks['op_repeat_today'] += len(rep)
            checks['op_repeat_once'] += len([u for u in rep if any(info[k]['once'] for k in info if info[k]['u'] == u)])
            srest_units = {info[v['stop_id']]['u'] for v in srest if rated(v)}
            srep = tod_units & srest_units
            checks['stale_repeat_today'] += len(srep)
            checks['stale_repeat_once'] += len([u for u in srep if any(info[k]['once'] for k in info if info[k]['u'] == u)])
        else:
            checks['opdrop_repeat_today'] += len(rep)
            du = {info[k]['u'] for k in drop if k in info}
            for u in du:
                if u in hist_units or u in tod_units:
                    checks['drop_optional'] += 1; checks['drop_optional_replaced'] += u in rest_units
                else:
                    checks['drop_required'] += 1
                    if u in rest_units: checks['drop_replaced'] += 1
                    else: checks['drop_missed'] += 1; missed.append({'R': R, 'd': d, 'run': o['run'], 'unit': u, 'names': sorted({info[k]['name'] for k in drop})})
                    checks['stale_drop_required'] += 1
                    checks['stale_drop_replaced'] += u in {info[v['stop_id']]['u'] for v in srest if rated(v)}
        for x in orows:
            t = (x['stats'] or {}).get('t') or {}
            if t: cpu[arm2].append(t.get('done', 0) - t.get('loaded', 0) - t.get('wait', 0))
    for x in srows:
        t = (x['stats'] or {}).get('t') or {}
        if t: cpu['stale'].append(t.get('done', 0) - t.get('loaded', 0) - t.get('wait', 0))

def paired(lst, i):
    # per week: the mean over its days of (one-pass - two-step), then mean and SE over weeks
    wk = {}
    for p in lst: wk.setdefault(p['R'], []).append(p['op'][i] - p['two'][i])
    m = [stt.mean(v) for v in wk.values()]
    allp = [p['op'][i] - p['two'][i] for p in lst]
    return {'weeks': len(m), 'days': len(allp), 'mean_per_day': round(stt.mean(m), 3) if m else None,
            'se': round(stt.stdev(m) / math.sqrt(len(m)), 3) if len(m) > 1 else None,
            'better': sum(1 for x in allp if x > 1e-9), 'worse': sum(1 for x in allp if x < -1e-9),
            'op_mean': round(stt.mean(p['op'][i] for p in lst), 3), 'two_mean': round(stt.mean(p['two'][i] for p in lst), 3)}

res = {'checks': checks, 'missed': missed, 'violations': viol[:60]}
for case in ('plain', 'drop'):
    if pairs[case]:
        res[case] = {name: paired(pairs[case], i) for i, name in enumerate(['points', 'places', 'places_good', 'sgod_good', 'points_repeat_today', 'points_other'])}
res['cpu_ms'] = {k: {'n': len(v), 'median': stt.median(v) if v else None, 'p95': sorted(v)[int(0.95 * (len(v) - 1))] if v else None, 'max': max(v) if v else None} for k, v in cpu.items()}
print(json.dumps(res, indent=1, default=str))
if a.json: json.dump(res, open(a.json, 'w'), indent=1, default=str)
