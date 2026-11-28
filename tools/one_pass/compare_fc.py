"""Forecast for later days (28 Nov 2026): grade sim.py's op (later days on light only, as live today) against opfc
(later days on the forecast, run config fc_live) for the same noon re-plan, on what really happened.
Per (week, day): the rest-of-trip plan's points on the truth (tier weight x improvement over what was already shot,
same subject counted once), distinct places seen with the peaks out (truth >= 0.6), big ones (S / GOD), days with no
route, stops ending after dark. Paired difference opfc - op, with a by-week standard error.
usage: compare_fc.py <sim.jsonl> [--json out] [--label name]"""
import sys, json, math, statistics as stt, argparse, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import get

ap = argparse.ArgumentParser(); ap.add_argument('sim'); ap.add_argument('--json'); ap.add_argument('--label', default='')
a = ap.parse_args()
recs = [json.loads(l) for l in open(a.sim)]
by = {}
for r in recs: by[(r['R'], r['d'], r['arm'])] = r

src_rows, info_of, runs = {}, {}, {}
def src(R):
    if R not in src_rows:
        src_rows[R] = {x['night']: x for x in get('replay_run_days', run_id=f'eq.{R}', kind='eq.mrmc', select='night,visits', order='night')}
        runs[R] = get('replay_runs', id=f'eq.{R}', select='trip_id,start_date')[0]
    return src_rows[R]
def info(trip):
    if trip not in info_of:
        for pr in get('replay_runs', trip_id=f'eq.{trip}', config='cs.' + json.dumps({'sim_info': True}), select='id', order='id.desc', limit='8'):
            r0 = get('replay_run_days', run_id=f"eq.{pr['id']}", night='eq.0', select='stats')
            if r0 and (r0[0]['stats'] or {}).get('sim'): info_of[trip] = r0[0]['stats']['sim']; break
    return info_of.get(trip)

def grade(run_id, R, d):
    S = src(R); I = info(runs[R]['trip_id'])
    rows = get('replay_run_days', run_id=f'eq.{run_id}', kind='eq.mrmc', select='night,visits,stats', order='night')
    base = {}
    def rated(v): return v.get('value') is not None and v['stop_id'] in I and I[v['stop_id']]['w'] > 0
    for k in range(d + 1):
        for v in (S.get(k) or {}).get('visits') or []:
            if rated(v): g = I[v['stop_id']]['g']; base[g] = max(base.get(g, 0), round(250 * (v.get('truth') or 0)))
    pts = 0.0; seen = set(); big = set(); no_route = 0; fc_days = 0; unscored = 0
    for x in rows:
        st = x['stats'] or {}
        if st.get('error'): no_route += 1
        if any(v.get('n_fc') is not None for v in x['visits'] or []): fc_days += 1  # n_fc is null on light-only days
        for v in x['visits'] or []:
            if not rated(v): continue
            if v.get('truth') is None: unscored += 1; continue
            i = I[v['stop_id']]; t = round(250 * v['truth'])
            pts += i['w'] * max(0, t - base.get(i['g'], 0)) / 250; base[i['g']] = max(base.get(i['g'], 0), t)
            if v['truth'] >= 0.6:
                seen.add(i['u'])
                if i['w'] >= 5: big.add(i['u'])
    return {'pts': pts, 'seen': len(seen), 'big': len(big), 'no_route': no_route, 'fc_days': fc_days, 'days': len(rows), 'unscored': unscored}

pairs = []
for (R, d, arm), r in by.items():
    if arm != 'op': continue
    f = by.get((R, d, 'opfc'))
    if not f or not r.get('ok') or not f.get('ok'): continue
    g0, g1 = grade(r['run'], R, d), grade(f['run'], R, d)
    same = [x['visits'] for x in get('replay_run_days', run_id=f"eq.{r['run']}", kind='eq.mrmc', select='visits', order='night')] == \
           [x['visits'] for x in get('replay_run_days', run_id=f"eq.{f['run']}", kind='eq.mrmc', select='visits', order='night')]
    pairs.append({'R': R, 'd': d, 'op': g0, 'opfc': g1, 'same_plan': same})

def paired(key):
    diffs = {}
    for p in pairs: diffs.setdefault(p['R'], []).append(p['opfc'][key] - p['op'][key])
    flat = [x for v in diffs.values() for x in v]
    wk = [sum(v) / len(v) for v in diffs.values()]
    se = stt.stdev(wk) / math.sqrt(len(wk)) if len(wk) > 1 else float('nan')
    return {'mean_op': stt.mean(p['op'][key] for p in pairs), 'mean_fc': stt.mean(p['opfc'][key] for p in pairs),
            'diff': stt.mean(flat), 'se_week': se, 'better': sum(x > 1e-9 for x in flat), 'worse': sum(x < -1e-9 for x in flat)}

out = {'label': a.label, 'replans': len(pairs), 'weeks': len({p['R'] for p in pairs}),
       'same_plan': sum(p['same_plan'] for p in pairs),
       'fc_days_used': sum(p['opfc']['fc_days'] for p in pairs), 'days_planned': sum(p['opfc']['days'] for p in pairs),
       'unscored_visits': sum(p['op']['unscored'] + p['opfc']['unscored'] for p in pairs),
       'no_route': {'op': sum(p['op']['no_route'] for p in pairs), 'opfc': sum(p['opfc']['no_route'] for p in pairs)},
       'points': paired('pts'), 'places_seen': paired('seen'), 'big_seen': paired('big'),
       'errors': sum(1 for r in recs if not r.get('ok'))}
print(json.dumps(out, indent=1))
if a.json: json.dump({'summary': out, 'pairs': pairs}, open(a.json, 'w'), indent=1)
