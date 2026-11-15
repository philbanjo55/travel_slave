"""Test 4b: a week draft that chains its own nights (run config chain_nights + chain) on a local copy, timed.
usage: chain_test.py <port> <bench config> <week index> <out.json>"""
import sys, json, time, datetime as dt
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import get, post, step

port, src, idx, out = int(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
R = get('replay_runs', config='cs.' + json.dumps({'name': src}), select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')[idx]
cfg = {**R['config'], 'name': 'op_chain_test', 'draft': True, 'fc_days': 0, 'kinds': ['mrmc'], 'chain': True, 'chain_nights': True,
       'req_budget_ms': 900, 'nonce': time.time()}
dates = R['trip_dates'][1:]
sd = (dt.date.fromisoformat(R['start_date']) + dt.timedelta(days=1)).isoformat()
run = post('replay_runs', {'trip_id': R['trip_id'], 'start_date': sd, 'trip_dates': dates, 'nights': len(dates), 'config': cfg, 'status': 'running', 'night': 0})[0]
post('replay_run_state', {'run_id': run['id'], 'kind': 'mrmc', 'night': 0, 'state': {}, 'sets': {'seen': []}, 'status': 'planning',
                          'started_at': dt.datetime.now(dt.timezone.utc).isoformat()}, prefer='return=minimal')
t0 = time.time()
code, b, _ = step(port, {'run_id': run['id'], 'kind': 'mrmc'})
print('first', code, str(b)[:200], flush=True)
last = None
while time.time() - t0 < 600:
    st = get('replay_run_state', run_id=f"eq.{run['id']}", select='night,status,note')[0]
    rr = get('replay_runs', id=f"eq.{run['id']}", select='night,status')[0]
    n = len(get('replay_run_days', run_id=f"eq.{run['id']}", select='night'))
    if (st, rr, n) != last: print(round(time.time() - t0, 1), st, rr, n, flush=True); last = (st, rr, n)
    if n >= len(dates) and st['status'] == 'idle': break
    time.sleep(1)
el = round(time.time() - t0, 1)
days = get('replay_run_days', run_id=f"eq.{run['id']}", select='night,stats', order='night')
json.dump({'run': run['id'], 'nights': len(dates), 'done_nights': len(days), 'secs': el,
           'per_night_t': [d['stats'].get('t') for d in days]}, open(out, 'w'), indent=1)
print('chain done', el, 's for', len(days), 'of', len(dates), 'nights', flush=True)
