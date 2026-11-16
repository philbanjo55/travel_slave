"""Light rows for pruned bench dates, computed read-only (same SQL as mock_serve.ts), saved as <dir>/<trip>_<date>.json.
usage: light_fetch.py <dir> <threads> <trip>:<from>:<to> ...   (needs Q_SH = a Management API query script)"""
import sys, os, json, subprocess, datetime as dt, threading, queue
OUT, N = sys.argv[1], int(sys.argv[2]); Q = os.environ['Q_SH']
os.makedirs(OUT, exist_ok=True)
SQL = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_serve.ts')).read().split('const lightSql = (trip: string, date: string) => `')[1].split('`;')[0]
jobs = queue.Queue()
for spec in sys.argv[3:]:
    trip, a, b = spec.split(':'); d = dt.date.fromisoformat(a)
    while d <= dt.date.fromisoformat(b):
        f = os.path.join(OUT, f'{trip}_{d}.json')
        if not os.path.exists(f): jobs.put((trip, d.isoformat(), f))
        d += dt.timedelta(days=1)
def work():
    while True:
        try: trip, d, f = jobs.get_nowait()
        except queue.Empty: return
        sql = SQL.replace('${trip}', trip).replace('${date}', d)
        rows = None
        for k in range(4):
            r = subprocess.run([Q, f"select coalesce(json_agg(t), '[]'::json) j from ({sql}) t"], capture_output=True, text=True)
            try: rows = json.loads(r.stdout)[0]['j']; break
            except Exception: print('retry', d, r.stdout[:150], flush=True)
        if not rows: print('fail', trip, d, flush=True); continue
        json.dump(rows, open(f + '.tmp', 'w')); os.replace(f + '.tmp', f); print(d, len(rows), flush=True)
ths = [threading.Thread(target=work) for _ in range(N)]
for t in ths: t.start()
for t in ths: t.join()
