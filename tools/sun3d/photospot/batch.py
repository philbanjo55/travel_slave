"""Run solve.py over a job list, a few at a time; each result goes to <out>/<name>.json (skipped when it exists).

  batch.py jobs.json <out dir> [--procs 3]
  jobs: [{name, photo, region, stop: [lat, lng], landmarks?, no_names?, radius?}]
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))

ap = argparse.ArgumentParser(); ap.add_argument('jobs'); ap.add_argument('out'); ap.add_argument('--procs', type=int, default=3)
ap.add_argument('--rows', required=True); ap.add_argument('--cache', required=True); ap.add_argument('--hcache')
ap.add_argument('--no-trees', action='store_true')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
jobs = [j for j in json.load(open(a.jobs)) if not os.path.exists(os.path.join(a.out, j['name'] + '.json'))]
running = []
while jobs or running:
    while jobs and len(running) < a.procs:
        j = jobs.pop(0)
        cmd = [sys.executable, os.path.join(HERE, 'solve.py'), j['photo'], '--rows', a.rows, '--cache', a.cache, '--region', j['region'],
               '--stop', f"{j['stop'][0]},{j['stop'][1]}", '--out', os.path.join(a.out, j['name'] + '.json'), '--radius', str(j.get('radius', 2500))]
        if a.hcache: cmd += ['--hcache', a.hcache]
        if a.no_trees or j.get('no_trees'): cmd += ['--no-trees']
        if j.get('landmarks'): cmd += ['--landmarks', j['landmarks']]
        if j.get('no_names'): cmd += ['--no-names']
        log = open(os.path.join(a.out, j['name'] + '.log'), 'w')
        running.append((j, subprocess.Popen(['nice', '-n', '10'] + cmd, stdout=log, stderr=subprocess.STDOUT), time.time()))
    time.sleep(2)
    for r in running[:]:
        if r[1].poll() is not None:
            running.remove(r); print(r[0]['name'], 'exit', r[1].returncode, f'{time.time() - r[2]:.0f}s', flush=True)
print('ALL DONE', flush=True)
