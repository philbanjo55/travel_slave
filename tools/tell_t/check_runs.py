#!/usr/bin/env python3
"""Tell T: an independent check that bench plans follow their notes (worksheet g4, test gap 5).

Written apart from the planner's own check (solver-replay noteCheck): it reads only what was stored (each night's
visits) plus the trip's stops and drive table, and decides place by stop NAME, not by the planner's subject groups.
For every night of the given bench configs it checks every note rule in force that day, that the day is physically
possible (each visit starts after the one before ends plus the drive), that bookings are where the no-notes run of
the same week has them, and that no night came back without a route.

  python3 tools/tell_t/check_runs.py <trip_id> <baseline config> <config> [<config> ...]
Needs q.sh-style SQL access: set QSH to a script that takes one SQL string and prints JSON rows."""
import json, os, subprocess, sys
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

QSH = os.environ.get('QSH', '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/q.sh')
def q(sql):
    out = subprocess.run([QSH, sql], capture_output=True, text=True).stdout
    d = json.loads(out)
    if isinstance(d, dict): raise SystemExit('SQL error: ' + out[:300])
    return d

trip, base_cfg, cfgs = sys.argv[1], sys.argv[2], sys.argv[3:]
tz = ZoneInfo(q(f"select coalesce(timezone,'UTC') tz from trips where id='{trip}'")[0]['tz'])
stops = {r['id']: r for r in q(f"select s.id, s.name, s.time_locked, s.duration_minutes dur, d.date, ss.tier from stops s left join days d on d.id=s.day_id left join solver_stop_settings ss on ss.stop_id=s.id where d.trip_id='{trip}'")}
dm = {(r['f'], r['t']): r['m'] for r in q(f"select from_stop_id f, to_stop_id t, minutes m from solver_drive_matrix where trip_id='{trip}'")}
accs = q(f"select name, check_in, check_out from accommodations where trip_id='{trip}'")
# Keep together (the trip's own setting plus a run's guessed pairs): key -> the places' names.
tog_db = {r['stop_id']: r['together'] for r in q(f"select ss.stop_id, ss.together from solver_stop_settings ss join stops s on s.id=ss.stop_id join days d on d.id=s.day_id where d.trip_id='{trip}' and ss.together is not null and ss.tier is not null")}
days = sorted({s['date'] for s in stops.values() if s['date']})
name_of = lambda sid: stops[sid]['name'] if sid in stops else sid
TOP = {'GOD': 3, 'S': 2, 'A': 1}

def hotel_stop(date, end):
    """The stop that stands for where the day starts / ends: a stop named after that night's accommodation."""
    night = date if end else days[max(0, days.index(date) - 1)] if date in days else date
    acc = next((a for a in accs if a['check_in'] <= night < a['check_out']), None) or (accs[0] if accs else None)
    word = (acc['name'] if acc else '').split(' ')[0].lower()
    own = [s for s in stops.values() if s['date'] == date and word and word in s['name'].lower()]
    locked = [s for s in stops.values() if s['date'] == date and s['time_locked'] and not s['tier']]
    if locked and ((not end and date == days[0]) or (end and date == days[-1])): return locked[0 if not end else -1]['id']
    return own[-1 if end else 0]['id'] if own else None

def drive(a, b, f=1.0):
    if a is None or b is None: return None
    if a == b: return 0.0
    m = dm.get((a, b))
    return None if m is None else m * f

def lm(iso):  # local minutes of the day
    t = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(tz)
    return t.hour * 60 + t.minute + t.second / 60
hm = lambda s: int(s[:2]) * 60 + int(s[3:])
clock = lambda m: f'{int(m // 60)}:{int(m % 60):02d}'
def on(rule, td):
    if isinstance(rule.get('dates'), list): return td in rule['dates']
    return (not rule.get('from_date') or td >= rule['from_date']) and (not rule.get('to_date') or td <= rule['to_date'])
names = lambda ids: {name_of(i) for i in (ids or []) if i in stops and stops[i]['tier']}

def load(cfg):
    rows = q(f"select r.id run, r.start_date s, r.config c, d.night, d.trip_date td, d.visits v, d.stats st from replay_runs r join replay_run_days d on d.run_id=r.id where r.config->>'name'='{cfg}' and r.trip_id='{trip}' order by r.start_date, d.night")
    return rows

base = {(r['s'], r['td']): r for r in load(base_cfg)}
# NOTES_FROM=<config>: judge the plans by another config's notes (plans made WITHOUT those notes must fail:
# proof that this check can catch a plan that ignores a note).
fake = os.environ.get('NOTES_FROM')
fake_notes = (q(f"select config->'notes' n from replay_runs where config->>'name'='{fake}' limit 1")[0]['n'] or []) if fake else None
total = defaultdict(int); problems = []; unmet = []
for cfg in cfgs:
    rows = load(cfg)
    for r in rows:
        td, vs, notes = r['td'], r['v'] or [], (fake_notes if fake_notes is not None else (r['c'].get('notes') or []))
        rules = [n for n in notes if on(n, td)]
        gear_ids = set((r['c'].get('gear') or {}).get('stops') or [])
        total['nights'] += 1
        tag = f"{cfg} week {r['s']} {td}"
        if (r['st'] or {}).get('error'): problems.append(f'{tag}: NO ROUTE ({r["st"]["error"]})'); continue
        # 0. Keep together: all of a pair on the day or none of it (every night, noted or not), unless a note that day
        # skips one of them by name while the other is asked for.
        tog0 = {} if r['c'].get('no_together') else {**tog_db, **(r['c'].get('together_add') or {})}
        pr0 = defaultdict(set)
        for sid, k in tog0.items():
            if sid in stops and stops[sid]['tier']: pr0[k].add(name_of(sid))
        seen = {v['name'] for v in vs if not v.get('booked')}
        sk0 = set().union(*[names(n.get('stops')) for n in rules if n['type'] == 'skip']) if rules else set()
        for k, ns in pr0.items():
            if len(ns) > 1 and (ns & seen) and not ns <= seen and not ((ns - seen) <= sk0):
                problems.append(f"{tag}: keep together '{k}' is split: planned {sorted(ns & seen)}, missing {sorted(ns - seen)}")
        if not rules and not any(n['type'] in ('gear_to', 'gear_from') for n in notes): total['plain'] += 1; continue
        total['noted'] += 1
        slow = max([float(n.get('factor') or 1) for n in rules if n['type'] == 'slow_roads'] + [1.0])
        H0, H = hotel_stop(td, False), hotel_stop(td, True)
        free = [v for v in vs if not v.get('booked')]
        want = set().union(*[names(n.get('stops')) for n in rules if n['type'] in ('must', 'first', 'last')]) if rules else set()
        # A wanted place brings its keep-together partner (it passes the day's other notes too), unless a note skips it.
        tog = {} if r['c'].get('no_together') else {**tog_db, **(r['c'].get('together_add') or {})}
        pairs = defaultdict(set)
        for sid, k in tog.items():
            if sid in stops and stops[sid]['tier']: pairs[k].add(name_of(sid))
        skipped = set().union(*[names(n.get('stops')) for n in rules if n['type'] == 'skip']) if rules else set()
        asked = set(want)
        for k, ns in pairs.items():
            if ns & asked: want |= {x for x in ns if x not in skipped or x in asked}
        wanted = lambda v: v['name'] in want
        bad = lambda msg: problems.append(f'{tag}: {msg}')
        # 1. The day is physically possible: no visit starts before the last one ended plus the drive.
        prev_end, prev_id = None, H0
        for v in sorted(vs, key=lambda v: v['start']):
            d = drive(prev_id, v['stop_id'], slow)
            if prev_end is not None and d is not None and lm(v['start']) + 0.5 < prev_end + d and not (v.get('booked') and prev_booked):
                bad(f"{v['name']} starts {clock(lm(v['start']))}, but the stop before ends {clock(prev_end)} and the drive is {d:.0f} min")
            # (Not on the first day's first leg: the planner starts the arrival day at the hotel, at landing time, where
            # this check starts it at the airport. A small difference in the planner from before the notes.)
            if slow > 1 and d is not None and not v.get('booked') and abs(v.get('drive_min', 0) - round(d)) > 1 and prev_id is not None and not (td == days[0] and prev_end is None):
                bad(f"{v['name']}: drive shown {v.get('drive_min')} min, slow roads say {d:.0f}")
            prev_end, prev_id, prev_booked = lm(v['end']), v['stop_id'], bool(v.get('booked'))
        # 2. Bookings are where the no-notes run has them (a gear change moves the shop stop: skipped those weeks).
        b = base.get((r['s'], td))
        if b is not None and not any(n['type'] in ('gear_to', 'gear_from') for n in notes):
            mine = sorted((v['stop_id'], round(lm(v['start']))) for v in vs if v.get('booked') and not v.get('note'))
            theirs = sorted((v['stop_id'], round(lm(v['start']))) for v in (b['v'] or []) if v.get('booked'))
            if mine != theirs: bad(f'bookings differ from the no-notes run: {[(name_of(a), clock(t)) for a, t in mine]} vs {[(name_of(a), clock(t)) for a, t in theirs]}')
        # 3. Each rule.
        for n in rules:
            t = n['type']; total['rule ' + t] += 1
            P = names(n.get('stops'))
            if t == 'back_by':
                for v in free:
                    d = drive(v['stop_id'], H, slow)
                    if d is not None and lm(v['end']) + d > hm(n['time']) + 0.5: bad(f"back_by {n['time']}: {v['name']} ends {clock(lm(v['end']))} + {d:.0f} min home")
            elif t == 'leave_after':
                for v in free:
                    d = drive(H0, v['stop_id'], slow)
                    if d is not None and lm(v['start']) - d < hm(n['time']) - 0.5: bad(f"leave_after {n['time']}: {v['name']} at {clock(lm(v['start']))} is a {d:.0f} min drive")
            elif t == 'busy':
                hit = [v for v in vs if v.get('booked') and v.get('note') and abs(lm(v['start']) - hm(n['from'])) < 1]
                if not hit: bad(f"busy {n['from']}-{n['to']} is not on the plan")
                elif abs((lm(hit[0]['end']) - lm(hit[0]['start'])) - (hm(n['to']) - hm(n['from']))) > 14.5: bad(f"busy {n['from']}-{n['to']} has the wrong length")
            elif t == 'skip':
                if not (P & want):
                    for v in free:
                        if v['name'] in P: bad(f"skip: {v['name']} is planned")
            elif t in ('must', 'first', 'last'):
                for p in P:
                    hit = [v for v in vs if v['name'] == p]
                    if not hit: unmet.append(f"{tag}: wanted {p}, not planned (planner said: {(r['st'].get('notes') or {}).get('broken')}; lost: {(r['st'].get('notes') or {}).get('lost')})"); continue
                    lo, hi = n.get('from'), n.get('to')
                    if (lo or hi) and not any(v.get('booked') or ((not lo or lm(v['start']) >= hm(lo) - 0.5) and (not hi or lm(v['start']) <= hm(hi) + 0.5)) for v in hit):
                        bad(f"must {p} {lo}-{hi}: planned at {[clock(lm(v['start'])) for v in hit]}")
                if t == 'first' and free and any(v['name'] in P for v in free) and free[0]['name'] not in P: bad(f"first {P}: the day starts at {free[0]['name']}")
                if t == 'last' and free and any(v['name'] in P for v in free) and free[-1]['name'] not in P: bad(f"last {P}: the day ends at {free[-1]['name']}")
            elif t == 'max_visit':
                for v in free:
                    if lm(v['end']) - lm(v['start']) > n['minutes'] + 0.5 and not wanted(v): bad(f"max_visit {n['minutes']}: {v['name']} is {lm(v['end']) - lm(v['start']):.0f} min")
            elif t == 'max_leg':
                for v in free:
                    d = drive(v['stop_id'], H, slow)
                    if not wanted(v) and (v.get('drive_min', 0) > n['minutes'] + 0.5 or (d is not None and d > n['minutes'] + 0.5)): bad(f"max_leg {n['minutes']}: {v['name']} drive {v.get('drive_min')} / home {d}")
            elif t == 'stay':
                for v in free:
                    if v['name'] in P and abs((lm(v['end']) - lm(v['start'])) - -(-n['minutes'] // 15) * 15) > 0.5: bad(f"stay {n['minutes']}: {v['name']} is {lm(v['end']) - lm(v['start']):.0f} min")
            elif t == 'day_off':
                for v in free:
                    if not wanted(v): bad(f"day_off: {v['name']} is planned")
            elif t == 'max_stops':
                others = [v for v in free if not wanted(v)]
                if len(others) > max(0, n['count'] - len(asked)): bad(f"max_stops {n['count']}: {len(free)} stops ({len(want)} wanted)")
            elif t == 'no_gear':
                for v in free:
                    if v['stop_id'] in gear_ids and not wanted(v): bad(f"no_gear: {v['name']} needs the gear")
            elif t == 'before':
                A, B = P, names(n.get('then'))
                ia = [i for i, v in enumerate(free) if v['name'] in A]; ib = [i for i, v in enumerate(free) if v['name'] in B]
                if ia and ib and max(ia) > min(ib): bad(f"before: {B} comes before {A}")
            elif t == 'only_top':
                need = TOP.get(n.get('tier'), 2)
                for v in free:
                    if TOP.get(stops[v['stop_id']]['tier'], 0) < need and not wanted(v): bad(f"only_top {n.get('tier')}: {v['name']} is tier {stops[v['stop_id']]['tier']}")
            elif t == 'arrive_by':
                for v in free:
                    if v['name'] in P and lm(v['start']) > hm(n['time']) + 0.5: bad(f"arrive_by {n['time']}: {v['name']} starts {clock(lm(v['start']))}")
            elif t == 'optional':
                # The chance stored is the morning re-plan's. Visits the morning re-plan kept because Phil had already
                # left for them (stats.mr.kept, the day's first visits) were chosen on the evening forecast: not judged.
                kept = int(((r['st'] or {}).get('mr') or {}).get('kept') or 0)
                for v in sorted(free, key=lambda v: v['start'])[kept:]:
                    if v['name'] in P and v.get('p_good') is not None and v['p_good'] < 0.5 and not wanted(v): bad(f"optional: {v['name']} planned on a {v['p_good']:.0%} chance")
            elif t in ('slow_roads',): pass
        # A gear return moved by a note: the gear places stay inside the new window.
        for n in notes:
            if n['type'] == 'gear_to' and td >= n['dates'][0]:
                for v in free:
                    if v['stop_id'] in gear_ids and (td > n['dates'][0] or lm(v['end']) > hm(n['time']) - 20 + 0.5): bad(f"gear_to {n['dates'][0]} {n['time']}: {v['name']} ends {clock(lm(v['end']))} on {td}")

print(json.dumps(dict(total), indent=1))
print(f'\n{len(problems)} problems')
for p in problems[:60]: print('  ', p)
print(f'\n{len(unmet)} wanted places not planned (not a rule break when the planner says why)')
for u in unmet[:25]: print('  ', u[:260])
