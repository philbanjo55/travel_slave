"""Fetch solver_light_terms rows for pruned past dates, computed read-only from vantage_light (byte-identical to the
cache path, checked on Teton 2026-12-30 and Faroes 2027-05-20), into light/<trip>_<date>.json for the test copy.
usage: light_fetch.py <threads> <trip>:<from>:<to> ..."""
import sys, os, json, subprocess, datetime as dt, threading, queue
D = os.path.dirname(os.path.abspath(__file__)); OUT = os.environ.get('LIGHT_DIR', 'light'); Q = os.environ['Q_SH']  # q.sh: Management API SQL (see CLAUDE.md)
os.makedirs(OUT, exist_ok=True)
jobs = queue.Queue()
for spec in sys.argv[2:]:
    trip, a, b = spec.split(':')
    d = dt.date.fromisoformat(a)
    while d <= dt.date.fromisoformat(b):
        f = os.path.join(OUT, f'{trip}_{d}.json')
        if not os.path.exists(f): jobs.put((trip, d.isoformat(), f))
        d += dt.timedelta(days=1)
print(jobs.qsize(), 'dates', flush=True)
def work():
    while True:
        try: trip, d, f = jobs.get_nowait()
        except queue.Empty: return
        sql = subprocess.run(['python3', os.path.join(D, 'light_sql.py'), trip, d], capture_output=True, text=True).stdout
        for k in range(3):
            r = subprocess.run([Q, f"select coalesce(json_agg(t), '[]'::json) j from ({sql}) t"], capture_output=True, text=True)
            try:
                rows = json.loads(r.stdout)[0]['j']; break
            except Exception:
                rows = None
        if rows is None: print('fail', trip, d, r.stdout[:200], flush=True); continue
        json.dump(rows, open(f + '.tmp', 'w')); os.replace(f + '.tmp', f)
        print(trip[:4], d, len(rows), flush=True)
ths = [threading.Thread(target=work) for _ in range(int(sys.argv[1]))]
for t in ths: t.start()
for t in ths: t.join()
print('light done', flush=True)
