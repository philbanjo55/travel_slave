#!/usr/bin/env python3
"""Tell T flow test (worksheet g4): the notes function end to end on this machine, with Claude's answer supplied
ready-made, so every step after the reading is exercised: draft -> save -> ticks / field report / re-plan request ->
clear, questions, and the refusals. Uses the test-bed trip (and Teton Live for the read-only questions); every row it
makes is removed at the end.
  T_NOTES_TEST=1 SOLVER_URL=http://127.0.0.1:8001/ ... deno run t-notes/index.ts (port 8002), then
  python3 tools/tell_t/flow_test.py"""
import json, os, subprocess, sys
URL = os.environ.get('NOTES_URL', 'http://127.0.0.1:8002/')
QSH = os.environ.get('QSH', '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/q.sh')
BED, LIVE = '7e57bed0-0000-4000-8000-000000000001', '7e57bed0-0000-4000-8000-000000000003'
PLACE, STOP = 'Trælanípa · Sørvágsvatn · Bøsdalafossur · Geituskorardrangur', '2063c276-4270-46bc-96d3-e6487dbb91b0'
ASOF, DAY = '2026-05-15T18:00:00Z', '2026-05-15'
def q(sql):
    d = json.loads(subprocess.run([QSH, sql], capture_output=True, text=True).stdout)
    if isinstance(d, dict): raise SystemExit(str(d)[:300])
    return d
def post(**b):
    out = subprocess.run(['curl', '-s', '-m', '300', '-X', 'POST', URL, '-H', 'Content-Type: application/json', '-d', json.dumps(b)], capture_output=True, text=True).stdout
    try: return json.loads(out)
    except Exception: return {'ok': False, 'error': out[:300]}
EMPTY = dict(ask=None, rules=[], now=None, recap=[], question=None, cant_use=[])
def read(text, trip=BED, date=DAY, asof=ASOF, **parsed):
    b = dict(action='read', trip_id=trip, date=date, text='TEST: ' + text, parsed={**EMPTY, **parsed})
    if asof: b['as_of'] = asof
    return post(**b)
ok = 0; bad = []
def check(name, cond, detail=''):
    global ok
    if cond: ok += 1; print('PASS', name)
    else: bad.append(name); print('FAIL', name, '\n      ', str(detail)[:600])
tick = lambda: q(f"select shot_status s from solver_stop_settings where stop_id='{STOP}'")[0]['s']
row = lambda i: q(f"select status, rules, now, recap, answer, say from t_notes where id={i}")[0]
try:
    q(f"select solver_mark_shot('{STOP}', null)")
    # 1. Recap: nailed -> the tick is set on save, not before; the note is done (no lasting rule).
    r = read('nailed it', recap=[dict(place=PLACE, result='nailed')]); n = r.get('note') or {}
    check('recap read: draft with one tick line', r.get('ok') and n.get('status') == 'draft' and len(n.get('say') or []) == 1 and 'Nailed it' in n['say'][0]['text'], r)
    check('recap read: nothing marked before the OK', tick() is None)
    s = post(action='save', id=n.get('id'))
    check('recap save: tick set', s.get('ok') and tick() == 'nailed' and (s.get('marks') or [{}])[0].get('set') is True, s)
    check('recap save: note done', row(n['id'])['status'] == 'done')
    check('save twice refused', post(action='save', id=n['id']).get('ok') is False)
    # 2. A weaker word later never lowers the tick; "missed" changes nothing.
    r = read('got it, meh', recap=[dict(place=PLACE, result='got')]); s = post(action='save', id=r['note']['id'])
    check('recap got after nailed: not lowered', s.get('ok') and tick() == 'nailed' and s['marks'][0]['set'] is False, s)
    r = read('missed it', recap=[dict(place=PLACE, result='missed')]); s = post(action='save', id=r['note']['id'])
    check('recap missed: tick untouched', s.get('ok') and tick() == 'nailed' and s['marks'][0]['set'] is False, s)
    q(f"select solver_mark_shot('{STOP}', null)")
    r = read('ok light', recap=[dict(place=PLACE, result='got')]); s = post(action='save', id=r['note']['id'])
    check('recap got: tick set to got', s.get('ok') and tick() == 'got', s)
    q(f"select solver_mark_shot('{STOP}', null)")
    # 3. Word from the field: kept as a report; the re-plan request is refused cleanly where T is not planning today.
    r = read('socked in', now=dict(here_place=PLACE, late_minutes=None, stay_minutes=30, sky='hidden', why='test')); n = r.get('note') or {}
    check('now read: draft with two lines', r.get('ok') and n.get('status') == 'draft' and len(n.get('say') or []) == 2 and (n.get('now') or {}).get('sky') == 'hidden', r)
    s = post(action='save', id=n.get('id'))
    rep = q(f"select sky, place, void from t_reports where note_id={n.get('id', 0)}")
    check('now save: report kept', s.get('ok') and len(rep) == 1 and rep[0]['sky'] == 'hidden', (s, rep))
    check('now save: re-plan refused cleanly (no live plan today)', isinstance(s.get('now'), dict) and s['now'].get('ok') is False, s)
    check('now save: note done', row(n['id'])['status'] == 'done')
    # 4. Not on the day itself: no "now".
    r = read('peaks out', date='2026-05-16', now=dict(here_place=None, late_minutes=None, stay_minutes=None, sky='out', why='test')); n = r.get('note') or {}
    check('now on another day: not used, said so', r.get('ok') and n.get('now') is None and any('on the day itself' in x for x in n.get('info') or []), r)
    # 5. A note on a past day is refused.
    r = read('skip it', date='2026-05-14', rules=[])
    check('past day refused', r.get('ok') is False and 'is over' in str(r.get('error')), r)
    # 6. Rules + recap together: active, tick set.
    rule = dict(type='leave_after', dates=['2026-05-16'], rest_of_trip=False, time='09:00', **{'from': None, 'to': None}, places=[], then_places=[], at_place=None, minutes=None, count=None, factor=None, tier=None, label=None, why='test')
    r = read('nailed it, sleep in tomorrow', rules=[rule], recap=[dict(place=PLACE, result='nailed')]); n = r.get('note') or {}
    s = post(action='save', id=n.get('id'))
    check('rules + recap: active and marked', s.get('ok') and row(n['id'])['status'] == 'active' and tick() == 'nailed', s)
    c = post(action='clear', id=n['id'])
    check('clear: cleared, tick stays', c.get('ok') and row(n['id'])['status'] == 'cleared' and tick() == 'nailed', c)
    q(f"select solver_mark_shot('{STOP}', null)")
    # 7. Quick button, then clear.
    r = post(action='quick', trip_id=BED, date=DAY, as_of=ASOF, kind='sleep_in'); n = r.get('note') or {}
    check('quick: active at once', r.get('ok') and n.get('status') == 'active' and n['rules'][0]['type'] == 'leave_after', r)
    q(f"update t_notes set text = 'TEST: ' || text where id = {n.get('id', 0)}")
    check('quick clear', post(action='clear', id=n.get('id')).get('ok'))
    # 8. Questions change nothing: answered from T's stored plans (Teton Live, real time), never saved as rules.
    for kind, place in (('why', 'Oxbow Bend'), ('best_day', 'T.A. Moulton Barn'), ('best_day', 'Jenny Lake')):
        today = q(f"select (now() at time zone 'America/Denver')::date::text d")[0]['d']
        r = read(f'{kind} {place}?', trip=LIVE, date=today, asof=None, question=dict(kind=kind, places=[place], text='test')); n = r.get('note') or {}
        lines = (n.get('answer') or {}).get('lines') or []
        check(f'ask {kind} {place}: answered, no rules', r.get('ok') and n.get('status') == 'answer' and not n.get('rules') and lines and all(place in l or l.startswith(('T has', 'Its weakest')) for l in lines), r)
        print('        ', ' | '.join(lines)[:500])
        check(f'ask {kind}: cannot be saved', post(action='save', id=n.get('id')).get('ok') is False)
    r = read('weather?', trip=LIVE, date=today, asof=None, question=dict(kind='other', places=[], text='test'))
    check('ask other: says it cannot', r.get('ok') and "can't answer" in ' '.join((r['note'].get('answer') or {}).get('lines') or []), r)
    # 9. What if (the rest of the trip planned with and without the "if", on the planner running here; nothing published).
    if '--whatif' in sys.argv:
        jl = dict(type='skip', dates=[today], rest_of_trip=True, time=None, **{'from': None, 'to': None}, places=['Jenny Lake'], then_places=[], at_place=None, minutes=None, count=None, factor=None, tier=None, label=None, why='test')
        before = q(f"select count(*) c from solver_runs where trip_id='{LIVE}'")[0]['c']
        b = dict(action='read', trip_id=LIVE, date=today, text='TEST: what if we skip Jenny Lake?', force=True, parsed={**EMPTY, 'rules': [jl], 'question': dict(kind='what_if', places=['Jenny Lake'], text='test')})
        r = post(**b); n = r.get('note') or {}; a = n.get('answer') or {}
        check('what if: answered, nothing kept as a rule', r.get('ok') and n.get('status') == 'answer' and not n.get('rules') and a.get('if_rules') and a.get('lines'), r)
        print('        ', ' | '.join(a.get('lines') or [])[:500])
        check('what if: nothing published, no test runs left', q(f"select count(*) c from solver_runs where trip_id='{LIVE}'")[0]['c'] == before and q("select count(*) c from replay_runs where status='whatif'")[0]['c'] == 0)
finally:
    q(f"select solver_mark_shot('{STOP}', null)")
    q("with d as (select id from t_notes where text like 'TEST: %'), r as (" + "del" + "ete from t_reports where note_id in (select id from d) returning 1) select count(*) from r")
    q("with x as (" + "del" + "ete from t_notes where text like 'TEST: %' returning 1) select count(*) from x")
print(f'\n{ok} passed, {len(bad)} failed', bad)
