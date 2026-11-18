#!/usr/bin/env python3
"""Tell T: random notes for the bench (worksheet g4, test gap 1). Prints SQL that queues one local bench run per
base run (same week, same settings) with 5 random note rules each, seeded by the week, so reruns give the same
notes. Every rule type, any trip day (flight days and gear days included), sometimes clashing on purpose.
  python3 tools/tell_t/fuzz_notes.py <trip_id> <base config> <new config> [seed] > queue.sql"""
import json, os, random, subprocess, sys
QSH = os.environ.get('QSH', '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/q.sh')
def q(sql):
    d = json.loads(subprocess.run([QSH, sql], capture_output=True, text=True).stdout)
    if isinstance(d, dict): raise SystemExit(str(d)[:300])
    return d
trip, base, new, seed = sys.argv[1], sys.argv[2], sys.argv[3], (sys.argv[4] if len(sys.argv) > 4 else '1')
rows = q(f"select s.id, s.name, d.date from stops s join days d on d.id=s.day_id join solver_stop_settings ss on ss.stop_id=s.id where d.trip_id='{trip}' and ss.tier is not null and not coalesce(s.time_locked,false)")
places = {}
for r in rows: places.setdefault(r['name'], []).append(r['id'])
names = sorted(places)
runs = q(f"select id, start_date s, trip_dates td, config->'gear' gear from replay_runs where config->>'name'='{base}' and trip_id='{trip}' order by start_date")
if os.environ.get('EVERY'): runs = runs[::int(os.environ['EVERY'])]   # EVERY=4: every 4th base run
hhmm = lambda m: f'{m // 60:02d}:{m % 60:02d}'

def rule(rnd, days, gear, used):
    t = rnd.choice(['back_by', 'leave_after', 'busy', 'skip', 'must', 'must', 'max_visit', 'max_leg', 'stay', 'day_off', 'max_stops', 'slow_roads',
                    'no_gear', 'gear_to', 'first', 'last', 'before', 'optional', 'only_top', 'arrive_by'])
    d = rnd.choice(days)
    scope = {'dates': sorted(rnd.sample(days, rnd.choice([1, 1, 1, 2])))} if rnd.random() < 0.85 else {'from_date': d, 'to_date': None}
    one = {'dates': [d]}
    p = lambda: places[rnd.choice(names)]
    if t == 'back_by': return {'type': t, 'time': hhmm(rnd.randrange(13 * 60, 18 * 60 + 1, 30)), **scope}
    if t == 'leave_after': return {'type': t, 'time': hhmm(rnd.randrange(7 * 60 + 30, 10 * 60 + 31, 30)), **scope}
    if t == 'busy': a = rnd.randrange(10 * 60, 15 * 60 + 1, 30); return {'type': t, 'from': hhmm(a), 'to': hhmm(a + rnd.choice([30, 60, 90, 120])), 'label': 'Busy (your note)', **one}
    if t == 'skip': return {'type': t, 'stops': p() + (p() if rnd.random() < 0.3 else []), **scope}
    if t == 'must':
        band = rnd.choice([{}, {}, {'to': '11:00'}, {'from': '12:00'}, (lambda a: {'from': hhmm(a), 'to': hhmm(a + 60)})(rnd.randrange(8 * 60, 15 * 60 + 1, 30))])
        return {'type': t, 'stops': p(), **band, **one}
    if t == 'max_visit': return {'type': t, 'minutes': rnd.choice([60, 90, 120, 180]), **scope}
    if t == 'max_leg': return {'type': t, 'minutes': rnd.choice([20, 30, 45]), **one}
    if t == 'stay': return {'type': t, 'stops': p(), 'minutes': rnd.randrange(45, 181, 15), **scope}
    if t == 'day_off': return {'type': t, **one}
    if t == 'max_stops': return {'type': t, 'count': rnd.choice([1, 2, 3, 4]), **scope}
    if t == 'slow_roads': return {'type': t, 'factor': rnd.choice([1.25, 1.5]), **scope}
    if t == 'no_gear': return {'type': t, **one} if gear else None
    if t == 'gear_to':
        if not gear or 'gear' in used or len(days) < 4: return None
        used.add('gear'); return {'type': t, 'time': hhmm(rnd.randrange(10 * 60, 16 * 60 + 1, 30)), 'dates': [rnd.choice(days[3:6])]}
    if t in ('first', 'last'):
        if (t, d) in used: return None
        used.add((t, d)); return {'type': t, 'stops': p(), **one}
    if t == 'before': a, b = rnd.sample(names, 2); return {'type': t, 'stops': places[a], 'then': places[b], **scope}
    if t == 'optional': return {'type': t, 'stops': p(), 'from_date': days[0], 'to_date': None}
    if t == 'only_top': return {'type': t, 'tier': rnd.choice(['S', 'S', 'GOD']), **one}
    if t == 'arrive_by': return {'type': t, 'stops': p(), 'time': hhmm(rnd.randrange(8 * 60, 11 * 60 + 1, 30)), **scope}

print(f"-- Tell T fuzz: {len(runs)} runs '{new}' from '{base}', seed {seed}, 5 random note rules each (tools/tell_t/fuzz_notes.py).")
for r in runs:
    rnd = random.Random(f"{seed}|{r['s']}"); used = set(); notes = []
    while len(notes) < 5:
        x = rule(rnd, r['td'], r['gear'], used)
        if x: notes.append(x)
    if os.environ.get('NO_NOTES'): notes = []   # NO_NOTES=1: the same runs without notes (a control)
    cfg = json.dumps({'name': new, 'local': True, 'notes': notes, **json.loads(os.environ.get('EXTRA', '{}'))}).replace("'", "''")
    print(f"insert into public.replay_runs (trip_id, start_date, trip_dates, nights, config, status) select trip_id, start_date, trip_dates, nights, config || '{cfg}'::jsonb, 'queued' from public.replay_runs r where r.id = {r['id']} and not exists (select 1 from public.replay_runs x where x.config->>'name' = '{new}' and x.start_date = r.start_date and x.trip_id = r.trip_id);")
