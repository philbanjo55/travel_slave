"""The chained draft (chain_test.py) vs the same draft driven one step at a time: same plans?"""
import sys, json, time, datetime as dt
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import get, make_run, run_to_end
c = json.load(open(sys.argv[1]))
R = get('replay_runs', config='cs.' + json.dumps({'name': sys.argv[2]}), select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')[int(sys.argv[3])]
cfg = {**R['config'], 'name': 'op_chain_ref', 'draft': True, 'fc_days': 0, 'kinds': ['mrmc'], 'req_budget_ms': 900, 'nonce': time.time()}
dates = R['trip_dates'][1:]; sd = (dt.date.fromisoformat(R['start_date']) + dt.timedelta(days=1)).isoformat()
rid = make_run(R['trip_id'], sd, dates, cfg); t0 = time.time(); r = run_to_end(rid, int(sys.argv[4]), len(dates)); el = time.time() - t0
A = get('replay_run_days', run_id=f"eq.{c['run']}", select='night,visits,predicted', order='night')
B = get('replay_run_days', run_id=f"eq.{rid}", select='night,visits,predicted', order='night')
same = [a['visits'] == b['visits'] and a['predicted'] == b['predicted'] for a, b in zip(A, B)]
print(json.dumps({'chain_run': c['run'], 'ref_run': rid, 'identical_nights': sum(same), 'of': len(same), 'ref_driver_secs': round(el, 1), 'ref_reqs': r['reqs']}))
print('chain run now', get('replay_runs', id=f"eq.{c['run']}", select='status,night'))
