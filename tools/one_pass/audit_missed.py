"""For each place dropped from today that the one-pass rest plan did not re-place: could any later day hold it next to
what T planned there (solver-replay tool audit = exact search under every rule)? usage: audit_missed.py <analysis.json> <port>"""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import get, step
res = json.load(open(sys.argv[1])); port = int(sys.argv[2])
out = []
for m in res['missed']:
    rows = get('replay_run_days', run_id=f"eq.{m['run']}", kind='eq.mrmc', select='night,replay_date,visits', order='night')
    sim = None
    r0 = get('replay_run_days', run_id=f"eq.{m['run']}", night='eq.0', select='stats')
    sim = (r0[0]['stats'] or {}).get('sim') or {}
    ids = [k for k, x in sim.items() if x['u'] == m['unit'] and x['free']]
    fits = []
    for x in rows:
        vis = [v for v in (x['visits'] or []) if v.get('value') is not None and not v.get('booked')]
        add = [{'stop_id': k, 'start': x['replay_date'] + 'T18:00:00Z'} for k in ids[:1] if not m['unit'].startswith('t:')] or \
              [{'stop_id': k, 'start': x['replay_date'] + 'T18:00:00Z'} for k in ids]
        code, b, _ = step(port, {'run_id': m['run'], 'kind': 'mrmc', 'night': x['night'], 'tool': 'audit',
                                 'visits': [{'stop_id': v['stop_id'], 'start': v['start']} for v in vis] + add})
        fits.append({'date': x['replay_date'], 'feasible': b.get('feasible'), 'checked': b.get('checked'), 'alone': None,
                     'n_planned': len(vis), 'missing': b.get('missing')})
        if not b.get('feasible'):
            code, b2, _ = step(port, {'run_id': m['run'], 'kind': 'mrmc', 'night': x['night'], 'tool': 'audit', 'visits': add})
            fits[-1]['alone'] = b2.get('feasible')
    out.append({**m, 'days': fits, 'fits_with_plan': any(f['feasible'] for f in fits), 'fits_alone': any(f['feasible'] or f['alone'] for f in fits)})
    print(m['names'], 'with plan', out[-1]['fits_with_plan'], 'alone', out[-1]['fits_alone'], flush=True)
json.dump(out, open(sys.argv[1].replace('.json', '_audit.json'), 'w'), indent=1)
print('fits with the day as planned:', sum(o['fits_with_plan'] for o in out), 'of', len(out), '; fits on a day alone:', sum(o['fits_alone'] for o in out))
