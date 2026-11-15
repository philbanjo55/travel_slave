"""Test 1, identity: the deployed solver-replay (v101, OLD port) and the branch (v102, NEW port) with the switch off,
on the same fresh copies of bench runs (full nights, and week drafts), and on recorded Re-plan now requests (dry).
usage: identity.py <old port> <new port> <out.json>"""
import sys, json, threading
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import get, make_run, run_to_end, step

OLD, NEW, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
res = {'bench': [], 'draft': [], 'now': []}

def strip(row):
    s = dict(row.get('stats') or {})
    for k in ('t', 'ms'): s.pop(k, None)
    if isinstance(s.get('mc'), dict): s['mc'] = {k: v for k, v in s['mc'].items() if k != 'ms'}
    if isinstance(s.get('mr'), dict): s['mr'] = {k: v for k, v in s['mr'].items() if k not in ('ms',)}
    if isinstance(s.get('polish'), dict): pass
    return {'visits': row.get('visits'), 'predicted': row.get('predicted'), 'realized': row.get('realized'),
            'drive': row.get('drive_minutes'), 'stats': s}

def deep_ms(x):
    if isinstance(x, dict): return {k: deep_ms(v) for k, v in x.items() if k not in ('ms', 't')}
    if isinstance(x, list): return [deep_ms(v) for v in x]
    return x

def pair(R, tag, extra, start_off=0):
    out = {}
    def go(port, which):
        cfg = {**R['config'], **extra, 'name': f'op_id2_{tag}_{which}', 'rescue_ms': 100000}
        dates = R['trip_dates'][start_off:]
        import datetime as dt
        sd = (dt.date.fromisoformat(R['start_date']) + dt.timedelta(days=start_off)).isoformat()
        rid = make_run(R['trip_id'], sd, dates, cfg)
        r = run_to_end(rid, port, len(dates), log=print)
        rows = get('replay_run_days', run_id=f'eq.{rid}', select='night,visits,predicted,realized,drive_minutes,stats', order='night')
        out[which] = (rid, r, [deep_ms(strip(x)) for x in rows])
    ts = [threading.Thread(target=go, args=(OLD, 'old')), threading.Thread(target=go, args=(NEW, 'new'))]
    for t in ts: t.start()
    for t in ts: t.join()
    o, n = out['old'][2], out['new'][2]
    same = [a == b for a, b in zip(o, n)]
    diff = [i for i, s in enumerate(same) if not s]
    return {'R': R['id'], 'old_run': out['old'][0], 'new_run': out['new'][0], 'nights': len(o), 'nights_new': len(n),
            'identical': sum(same), 'diff_nights': diff, 'ok_old': out['old'][1], 'ok_new': out['new'][1]}

tet = get('replay_runs', config='cs.' + json.dumps({'name': 'BAm56r'}), select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')
fo = get('replay_runs', config='cs.' + json.dumps({'name': 'foV_B'}), select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')

# B. week drafts (switch off), old vs new
for R in [tet[5], fo[8]]:
    res['draft'].append(pair(R, 'draft', {'draft': True, 'fc_days': 0}, start_off=1)); print('draft', res['draft'][-1], flush=True)
    json.dump(res, open(OUT, 'w'), indent=1)
# A. full bench nights (evening plan + morning re-plan), old vs new
for R in [tet[45], fo[20]]:
    res['bench'].append(pair(R, 'bench', {})); print('bench', res['bench'][-1], flush=True)
    json.dump(res, open(OUT, 'w'), indent=1)
print('identity done', flush=True)
