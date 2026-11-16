"""Place day windows test (16 Nov 2026): drive a copy of a bench run through a mock_serve.ts server, nothing written.
usage: drive.py <port> <source run id> <out.json> [--nights n] [--start-off k] [--extra '{json}']
The copy gets a fake run id (900000 + source id), status 'running', night 0, nothing shot; its config is the source's
plus --extra and fixed budgets (req_budget_ms 60000, rescue_ms 100000: the same work every time); publish / live /
local / chain are taken out. Each request plans the next step, as replay_run_tick would; out.json = the nights' rows
(timings stripped), the blocked writes and the request count."""
import sys, json, time, argparse, datetime as dt, requests

SB = 'https://ohshrzlvvxyovcjmdajc.supabase.co/rest/v1/'
H = {'apikey': 'placeholder'}

ap = argparse.ArgumentParser()
ap.add_argument('port', type=int); ap.add_argument('src', type=int); ap.add_argument('out')
ap.add_argument('--nights', type=int, default=0); ap.add_argument('--start-off', type=int, default=0)
ap.add_argument('--extra', default='{}'); ap.add_argument('--fake', type=int, default=0)
a = ap.parse_args()

R = requests.get(SB + 'replay_runs', headers=H, params={'id': f'eq.{a.src}', 'select': '*'}, timeout=60).json()[0]
cfg = {**R['config'], 'req_budget_ms': 60000, 'rescue_ms': 100000, **json.loads(a.extra)}
for k in ('publish', 'live', 'local', 'edge', 'chain', 'chain_nights', 'one_pass', 'tell', 'trace'): cfg.pop(k, None)
cfg['name'] = 'pw_test'
dates = R['trip_dates'][a.start_off:]
if a.nights: dates = dates[:a.nights]
start = (dt.date.fromisoformat(R['start_date']) + dt.timedelta(days=a.start_off)).isoformat()
fake = a.fake or 900000 + a.src
run = {**R, 'id': fake, 'start_date': start, 'trip_dates': dates, 'nights': len(dates), 'config': cfg, 'status': 'running', 'night': 0, 'state': {}}
state = {'run_id': fake, 'kind': 'mrmc', 'night': 0, 'state': {}, 'sets': {'seen': []}, 'status': 'idle', 'note': None}
base = f'http://127.0.0.1:{a.port}/'
requests.post(base + '__mock/reset', json={'runs': [run], 'states': [state]}, timeout=30)

def deep(x):
    if isinstance(x, dict): return {k: deep(v) for k, v in x.items() if k not in ('ms', 't', 'updated_at', 'created_at')}
    if isinstance(x, list): return [deep(v) for v in x]
    return x

n, reqs, errs, t0 = 0, 0, 0, time.time()
log = []
while n < len(dates) and reqs < len(dates) * 15 + 10:
    r = requests.post(base, json={'run_id': fake, 'kind': 'mrmc'}, timeout=900); reqs += 1
    d = requests.get(base + '__mock/dump', timeout=60).json()
    st = d['replay_run_state'][0]
    if st['status'] == 'error' or r.status_code != 200:
        errs += 1; log.append({'night': n, 'code': r.status_code, 'body': r.text[:300], 'note': st.get('note')})
        print('error', a.src, n, r.status_code, r.text[:200], st.get('note'), flush=True)
        if errs > 2: break
        continue
    if st['night'] > n:
        n = st['night']
        requests.post(base + '__mock/run', json={'night': n}, timeout=30)  # the tick's job: move the run on
        print(a.src, 'night', n, 'of', len(dates), round(time.time() - t0), 's', flush=True)
d = requests.get(base + '__mock/dump', timeout=60).json()
rows = sorted(d['replay_run_days'], key=lambda x: x['night'])
json.dump({'src': a.src, 'extra': json.loads(a.extra), 'nights_done': n, 'nights': len(dates), 'reqs': reqs, 'errors': log,
           'secs': round(time.time() - t0), 'blocked': d['blocked'], 'dates': dates,
           'rows': [deep({k: x.get(k) for k in ('night', 'kind', 'visits', 'predicted', 'realized', 'drive_minutes', 'stats')}) for x in rows]},
          open(a.out, 'w'), indent=1)
print('done', a.src, n, 'nights', reqs, 'requests', round(time.time() - t0), 's, blocked', len(d['blocked']), flush=True)
