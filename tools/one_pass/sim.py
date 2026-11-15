"""One-pass Re-plan bench test (tests 2-4). For every bench week (or live practice round) and day d, a re-plan at local
noon: today's plan after noon = the run's own plan for day d from noon on (case 'op'), or that minus one planned place
(case 'opdrop', the forced drop). Then the rest of the trip:
  op / opdrop = a week draft from d+1 seeded with what is done (earlier days and today before noon, at their truth, as
  Phil's ticks) plus today's plan after noon (at its expected value) = what planner_t_rest does live;
  stale = the draft the app would still show (two-step): Teton = the draft made the evening before (from d, ticks
  through d-1), Faroes = the 04:23 UTC draft made at dawn on d (from d+1, ticks through d-1, today unknown).
usage: sim.py <source config> <out.jsonl> [--every k] [--limit n] [--arms op,opdrop,stale] [--ports 8101,8102]"""
import sys, json, datetime as dt, threading, queue, time, argparse
from zoneinfo import ZoneInfo
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import get, make_run, run_to_end

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--every', type=int, default=1); ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--arms', default='stale,op,opdrop'); ap.add_argument('--ports', default='8101,8102,8103,8104')
ap.add_argument('--runs', default='')  # explicit run ids (live practice rounds)
ap.add_argument('--tag', default='op_sim')
a = ap.parse_args()
ARMS = a.arms.split(','); PORTS = [int(p) for p in a.ports.split(',')]

if a.runs:
    runs = get('replay_runs', id=f'in.({a.runs})', select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')
else:
    runs = get('replay_runs', config='cs.' + json.dumps({'name': a.src}), select='id,trip_id,start_date,nights,trip_dates,config', order='start_date')
if a.limit: runs = runs[:a.limit]
TZ = {}
def tz_of(trip):
    if trip not in TZ: TZ[trip] = get('trips', id=f'eq.{trip}', select='timezone')[0]['timezone']
    return TZ[trip]

def add_days(s, k): return (dt.date.fromisoformat(s) + dt.timedelta(days=k)).isoformat()
def noon_utc(date, tz):
    return dt.datetime.fromisoformat(date + 'T12:00:00').replace(tzinfo=ZoneInfo(tz)).astimezone(dt.timezone.utc)
def ts(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))

done = set()
try:
    for line in open(a.out):
        j = json.loads(line); done.add((j['R'], j['d'], j['arm']))
except FileNotFoundError: pass

jobs = []
for R in runs:
    rows = get('replay_run_days', run_id=f'eq.{R["id"]}', kind='eq.mrmc', select='night,visits,stats', order='night')
    by = {r['night']: r for r in rows}
    live = bool(R['config'].get('live'))
    if len(by) < R['nights'] and not live: print('skip incomplete', R['id'], len(by)); continue
    north = R['config'].get('once_add') is not None or 'Faroe' in tz_of(R['trip_id'])
    tz = tz_of(R['trip_id'])
    for d in range(0, R['nights'] - 1, a.every):
        if any(k not in by for k in range(d + 1)): break
        noon = noon_utc(add_days(R['start_date'], d), tz)
        H_state, H_seen = {}, []
        def tick(v):
            if v.get('value') is None: return
            k = v['stop_id']; t = round(250 * (v.get('truth') or 0))
            H_state[k] = max(H_state.get(k, 0), t)
            if k not in H_seen: H_seen.append(k)
        for k in range(d):
            for v in by[k]['visits'] or []: tick(v)
        hist_state, hist_seen = dict(H_state), list(H_seen)   # through d-1 (the stale draft's ticks)
        today = by[d]['visits'] or []
        before = [v for v in today if ts(v['start']) < noon]
        after = [v for v in today if ts(v['start']) >= noon]
        for v in before: tick(v)
        base = dict(H_state)
        for arm in ARMS:
            if (R['id'], d, arm) in done: continue
            jobs.append(dict(R=R, d=d, arm=arm, north=north, tz=tz, noon=noon.isoformat(), hist=(hist_state, hist_seen),
                             done=(dict(base), list(H_seen)), after=after))

INFO = {}
lock = threading.Lock()
def info_for(trip):
    with lock: return INFO.get(trip)

def seed_for(j, drop_ids):
    st, seen = dict(j['done'][0]), list(j['done'][1])
    for v in j['after']:
        if v.get('value') is None or v['stop_id'] in drop_ids: continue
        k = v['stop_id']; st[k] = max(st.get(k, 0), round(250 * v['value']))
        if k not in seen: seen.append(k)
    return st, seen

def pick_drop(j, info):
    for v in j['after']:
        x = info.get(v['stop_id'])
        if v.get('value') is None or v.get('booked') or not x or not x['free']: continue
        if x['tog']: return [w['stop_id'] for w in j['after'] if (info.get(w['stop_id']) or {}).get('tog') == x['tog']]
        return [v['stop_id']]
    return None

out = open(a.out, 'a'); olock = threading.Lock()
def emit(rec):
    with olock: out.write(json.dumps(rec) + '\n'); out.flush()

Q = queue.Queue()
# Week affinity (15 Nov: 20 parallel clients ran the API pool dry): a worker takes a whole week, stale runs first (their
# night 0 carries stats.sim), so its server's isolate keeps that week's light days cached.
groups = {}
for j in jobs: groups.setdefault(j['R']['id'], []).append(j)
for rid in sorted(groups, key=lambda r: groups[r][0]['R']['start_date']):
    Q.put(sorted(groups[rid], key=lambda j: (j['arm'] != 'stale', j['d'], j['arm'])))
print(len(jobs), 'jobs in', len(groups), 'weeks', flush=True)
# Stop info from any earlier sim run of the trip.
for trip in {j['R']['trip_id'] for j in jobs}:
    prev = get('replay_runs', trip_id=f'eq.{trip}', config='cs.' + json.dumps({'sim_info': True}), select='id', order='id.desc', limit='5')
    for pr in prev:
        r0 = get('replay_run_days', run_id=f"eq.{pr['id']}", night='eq.0', select='stats')
        if r0 and (r0[0]['stats'] or {}).get('sim'): INFO[trip] = r0[0]['stats']['sim']; break

def one(port, j):
    R, d, arm = j['R'], j['d'], j['arm']
    s = d if (arm == 'stale' and not j['north']) else d + 1
    if arm == 'stale': st, seen, drop = j['hist'][0], j['hist'][1], None
    else:
        info = info_for(R['trip_id'])
        if info is None: emit({'R': R['id'], 'd': d, 'arm': arm, 'error': 'no stop info'}); return
        drop = pick_drop(j, info) if arm == 'opdrop' else []
        if arm == 'opdrop' and not drop:
            emit({'R': R['id'], 'd': d, 'arm': arm, 'skip': 'nothing to drop'}); return
        st, seen = seed_for(j, set(drop))
    cfg = {**R['config'], 'name': a.tag, 'arm': arm, 'tag': f"{R['id']}/{d}/{arm}", 'draft': True, 'fc_days': 0,
           'sim_mean': True, 'sim_info': True, 'req_budget_ms': 3000, 'nonce': time.time()}
    if not R['config'].get('live'): cfg.pop('live', None)  # live practice rounds keep it: days with no truth yet are allowed
    cfg.pop('publish', None); cfg.pop('tell', None)
    dates = R['trip_dates'][s:]
    try:
        rid = make_run(R['trip_id'], add_days(R['start_date'], s), dates, cfg, st, seen)
        res = run_to_end(rid, port, len(dates), log=lambda m: print(m, flush=True))
    except Exception as e:
        emit({'R': R['id'], 'd': d, 'arm': arm, 'error': str(e)[:300]}); return
    if arm == 'stale' and info_for(R['trip_id']) is None:
        r0 = get('replay_run_days', run_id=f'eq.{rid}', night='eq.0', select='stats')
        sim = (r0[0]['stats'] or {}).get('sim') if r0 else None
        if sim:
            with lock: INFO[R['trip_id']] = sim
    emit({'R': R['id'], 'd': d, 'arm': arm, 'run': rid, 'start': s, 'drop': drop, 'noon': j['noon'], **res})
    print(R['id'], d, arm, res, flush=True)

def worker(port):
    while True:
        try: g = Q.get_nowait()
        except queue.Empty: return
        for j in g: one(port, j)

ths = [threading.Thread(target=worker, args=(p,)) for p in PORTS]
for t in ths: t.start()
for t in ths: t.join()
print('all done', flush=True)
