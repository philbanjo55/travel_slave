"""Test 1, more Re-plan now steps: every saved practice day of Teton Live / Faroes Live, a dry Re-plan now at local
noon on that day's camera-look build, deployed copy vs branch (switch off). Writes nothing.
usage: identity_now.py <old port> <new port> <out.json> <run ids>"""
import sys, os, json, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import get, step
OLD, NEW, OUT, RUNS = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]

def deep(x):
    if isinstance(x, dict): return {k: deep(v) for k, v in x.items() if k not in ('ms', 't')}
    if isinstance(x, list): return [deep(v) for v in x]
    return x
out = []
for t in get('replay_live_today', run_id=f'in.({RUNS})', select='run_id,replay_date', order='run_id,replay_date'):
    x = get('replay_runs', id=f"eq.{t['run_id']}", select='trip_id,start_date')[0]
    tz = get('trips', id=f"eq.{x['trip_id']}", select='timezone')[0]['timezone']
    days = get('replay_days', trip_id=f"eq.{x['trip_id']}", replay_date=f"eq.{t['replay_date']}", select='id')
    b = get('replay_builds', replay_day_id=f"eq.{days[0]['id']}", kind='in.(earlyf,early)', select='id', order='created_at.desc', limit='1')
    if not b: continue
    night = (dt.date.fromisoformat(t['replay_date']) - dt.date.fromisoformat(x['start_date'])).days
    at = dt.datetime.fromisoformat(t['replay_date'] + 'T12:00:00').replace(tzinfo=ZoneInfo(tz)).astimezone(dt.timezone.utc).isoformat()
    body = {'run_id': t['run_id'], 'kind': 'mrmc', 'now': True, 'dry': True, 'night': night, 'build_id': b[0]['id'], 'at': at}
    co, bo, so = step(OLD, body); cn, bn, sn = step(NEW, body)
    rec = {'run': t['run_id'], 'date': t['replay_date'], 'identical': deep(bo) == deep(bn) and co == cn, 'ok': bo.get('ok'),
           'err': None if bo.get('ok') else str(bo)[:150], 'old_s': round(so, 1), 'new_s': round(sn, 1),
           'changed': (bn.get('now') or {}).get('changed'), 'kept': (bn.get('now') or {}).get('kept')}
    out.append(rec); print(rec, flush=True)
json.dump(out, open(OUT, 'w'), indent=1)
print('identical', sum(r['identical'] for r in out), 'of', len(out), '; ok', sum(1 for r in out if r['ok']))
