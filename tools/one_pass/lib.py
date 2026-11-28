"""Shared helpers for the one-pass tests: Supabase REST (the proxy adds the key) and a local step driver."""
import json, time, requests

SB = 'https://ohshrzlvvxyovcjmdajc.supabase.co/rest/v1/'
H = {'apikey': 'placeholder', 'Content-Type': 'application/json'}
S = requests.Session()


def get(path, **params):
    for k in range(5):
        try:
            r = S.get(SB + path, headers=H, params=params, timeout=60)
            if r.status_code < 500:
                r.raise_for_status(); return r.json()
        except requests.RequestException:
            if k == 4: raise
        time.sleep(2 + 3 * k)
    raise RuntimeError('get failed ' + path)


def post(path, body, prefer='return=representation'):
    for k in range(5):
        try:
            r = S.post(SB + path, headers={**H, 'Prefer': prefer}, data=json.dumps(body), timeout=60)
            if r.status_code < 500:
                if not r.ok: raise RuntimeError(f'{r.status_code} {r.text[:300]}')
                return r.json() if r.text else None
        except requests.RequestException:
            if k == 4: raise
        time.sleep(2 + 3 * k)
    raise RuntimeError('post failed ' + path)


def patch(path, body, **params):
    for k in range(5):
        try:
            r = S.patch(SB + path, headers={**H, 'Prefer': 'return=minimal'}, params=params, data=json.dumps(body), timeout=60)
            if r.status_code < 500:
                if not r.ok: raise RuntimeError(f'{r.status_code} {r.text[:300]}')
                return
        except requests.RequestException:
            if k == 4: raise
        time.sleep(2 + 3 * k)
    raise RuntimeError('patch failed ' + path)


def make_run(trip, start, dates, config, state=None, seen=None, status='sim'):
    r = post('replay_runs', {'trip_id': trip, 'start_date': start, 'trip_dates': dates, 'nights': len(dates),
                             'config': config, 'status': status, 'night': 0})[0]
    post('replay_run_state', {'run_id': r['id'], 'kind': 'mrmc', 'night': 0, 'state': state or {},
                              'sets': {'seen': seen or []}, 'status': 'idle'}, prefer='return=minimal')
    return r['id']


def step(port, body, timeout=900):
    t0 = time.time()
    r = requests.post(f'http://127.0.0.1:{port}/', data=json.dumps(body), headers={'Content-Type': 'application/json'}, timeout=timeout)
    try: b = r.json()
    except Exception: b = {'ok': False, 'error': r.text[:300]}
    return r.status_code, b, time.time() - t0


def run_to_end(run_id, port, nights, log=None, max_req=None):
    """Drive a run like replay_run_tick does: one request at a time, the night moved on when the step is idle at n+1."""
    n = 0; reqs = 0; errs = 0; times = []
    max_req = max_req or nights * 12 + 10
    while n < nights and reqs < max_req:
        code, b, dt = step(port, {'run_id': run_id, 'kind': 'mrmc'}); reqs += 1; times.append(dt)
        st = get('replay_run_state', run_id=f'eq.{run_id}', select='night,status,note')[0]
        if st['status'] == 'error' or not b.get('ok'):
            errs += 1
            if log: log(f'run {run_id} night {n} error {code} {str(b)[:200]} / {st}')
            if errs > 2: return {'ok': False, 'n': n, 'reqs': reqs, 'err': str(b)[:300]}
            patch('replay_run_state', {'status': 'idle', 'note': 'retry'}, run_id=f'eq.{run_id}')
            continue
        if st['night'] > n:
            n = st['night']
            patch('replay_runs', {'night': n} if n < nights else {'night': n, 'status': 'simdone'}, id=f'eq.{run_id}')
    return {'ok': n >= nights, 'n': n, 'reqs': reqs, 'secs': round(sum(times), 1)}
