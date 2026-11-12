#!/usr/bin/env python3
"""Tell T reading test (worksheet g4): 40 notes with the right answer written beforehand, read by the deployed
t-notes function with dry: true (nothing stored). Pass mark (Phil's design): 38 of 40 exactly right, and no wrong
place or date in the rest.   python3 tools/tell_t/notes_test.py [case numbers...]"""
import json, subprocess, sys, concurrent.futures as cf

import os
URL = os.environ.get('T_NOTES_URL', 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/t-notes')   # T_NOTES_URL: a test copy of the function
TRIP = '5e247891-d800-4d07-b5e0-8ad748ae2754'   # Grand Teton Winter 2026, 29 Dec - 4 Jan
A = '2026-12-30T14:40:00Z'                      # Wed 30 Dec, 7:40 AM in Jackson
D = {'tue': '2026-12-29', 'wed': '2026-12-30', 'thu': '2026-12-31', 'fri': '2027-01-01', 'sat': '2027-01-02', 'sun': '2027-01-03', 'mon': '2027-01-04'}
TA, JM = 'T.A. Moulton Barn', 'John Moulton Barn + Pink House'
SRO, OX, JL = 'Snake River Overlook', 'Oxbow Bend', 'Jenny Lake'
REST = [D['wed'], D['thu'], D['fri'], D['sat'], D['sun'], D['mon']]

def r(type, days, **kw): return dict(type=type, dates=[D[d] for d in days.split()], **kw)
def rest(type, day, **kw): return dict(type=type, rest=D[day], **kw)

# (text, expected, card day, as_of). expected: list of rules | 'ask' | 'none' | ('ask', 'none') for either.
# Times: stated times must match exactly; times Claude works out (tol) may be off by that many minutes.
CASES = [
 ("Dinner at 7", [r('back_by', 'wed', time='18:40', tol=15)]),
 ("dinner at Gather at 7, Holly's tired, nothing long today", [r('back_by', 'wed', time='18:40', tol=15), r('max_visit', 'wed', minutes=90)]),
 ("sleep in tomorrow", [r('leave_after', 'thu', time='09:00')]),
 ("breakfast at 8 tomorrow", [r('leave_after', 'thu', time='08:45', tol=15)]),
 ("Lunch at the inn 12 to 2", [r('busy', 'wed', **{'from': '12:00', 'to': '14:00'})]),
 ("skip Menor's Ferry", [r('skip', 'wed', places=["Menor's Ferry"])]),
 ("today I wanna prioritize going to mormon row, regardless of the other stops", [r('must', 'wed', places=[TA]), r('must', 'wed', places=[JM])]),
 ("Mormon Row at sunrise tomorrow", [r('must', 'thu', places=[TA], **{'from': '07:10', 'to': '07:55', 'tol': 12}), r('must', 'thu', places=[JM], **{'from': '07:10', 'to': '07:55', 'tol': 12})]),
 ("want Oxbow tomorrow afternoon", [r('must', 'thu', places=[OX], **{'from': '12:00'})]),
 ("spend 3 hours at Snake River Overlook today", [r('stay', 'wed', places=[SRO], minutes=180)], None, None, [r('must', 'wed', places=[SRO])]),
 ("stay close to town today", [r('max_leg', 'wed', minutes=30)]),
 ("no drives over 20 minutes on Friday", [r('max_leg', 'fri', minutes=20)]),
 ("Moose-Wilson road is closed until Friday", ('ask', 'none')),
 ("Taggart Lake trailhead is closed today", [r('skip', 'wed', places=['Taggart & Bradley Lakes'])], None, None, [r('skip', 'wed', places=[JL])]),
 ("done with Elk Ranch Flats for the rest of the trip", [rest('skip', 'wed', places=['Elk Ranch Flats'])]),
 ("always back by 6 for dinner from now on", [rest('back_by', 'wed', time='18:00')]),
 ("never start before 6:30", [rest('leave_after', 'wed', time='06:30')]),
 ("the barns", 'ask'),
 ("skip the overlook", 'ask'),
 ("asdf qwer zxcv", 'none'),
 ("The light was amazing at Oxbow yesterday!", 'none'),
 ("skip Cunningham Cabin", 'over', 'tue', A),   # typed on yesterday's card: refused before Claude is asked
 ("sleep in tomorrow till 9", [r('leave_after', 'thu', time='09:00')], 'wed', '2026-12-31T05:30:00Z'),
 ("sleep in tomorrow till 9", 'ask', 'thu', '2026-12-31T07:30:00Z'),
 ("massage at 3 for an hour in town tomorrow", [r('busy', 'thu', **{'from': '15:00', 'to': '16:00'})]),
 ("Friday and Saturday: back by 4", [r('back_by', 'fri sat', time='16:00')]),
 ("tired today, but I still want Jenny Lake", [r('max_visit', 'thu', minutes=90), r('must', 'thu', places=[JL])], 'thu', '2026-12-31T14:00:00Z'),
 ("skip Chapel and Menor's Ferry today", [r('skip', 'wed', places=['Chapel of the Transfiguration', "Menor's Ferry"])]),
 ("Oxbow around 3 on Saturday", [r('must', 'sat', places=[OX], **{'from': '14:30', 'to': '15:30'})]),
 ("Snake River Overlook at sunset today", [r('must', 'wed', places=[SRO], **{'from': '15:23', 'to': '16:23', 'tol': 12})]),
 ("New Year's Eve dinner at 8", [r('back_by', 'thu', time='19:40', tol=15)], 'thu', '2026-11-20T18:00:00Z'),
 ("sleep in", [r('leave_after', 'fri', time='09:00')], 'fri', '2026-11-20T18:00:00Z'),
 ("it's snowing hard", 'none'),
 ("what's the best day for Mormon Row?", 'none', None, None, None, dict(q=('best_day', [TA, JM]))),
 ("be back by 2, we're going to the hot springs", [r('back_by', 'wed', time='14:00')]),
 ("don't plan anything before 10 on the 1st", [r('leave_after', 'fri', time='10:00', tol=30)]),
 ("2 hours max per stop this week", {'any': [[rest('max_visit', 'wed', minutes=120)], [r('max_visit', 'wed thu fri sat sun', minutes=120)]]}),   # "this week" may end on Sunday
 ("Jenny Lake tomorrow no matter what", [r('must', 'thu', places=[JL])]),
 ("Holly wants to go shopping in town 1-3 on Saturday", [r('busy', 'sat', **{'from': '13:00', 'to': '15:00'})]),
 ("skip Oxbow today and tomorrow, want it Sunday morning instead", [r('skip', 'wed thu', places=[OX]), r('must', 'sun', places=[OX], to='11:00', from_any=True)]),
]

# Held-out set (11 Nov 2026): 20 messier notes written after the instructions were fixed, never tuned on.
# {'any': [...]} = any one of these answers is right. anytime = the visit's time is not checked.
GV, TP, CC, WF, BP = 'Glacier View Turnout', 'Teton Pines Nordic Center — Groomed Ski', 'Cunningham Cabin', 'Willow Flats Overlook', 'Blacktail Ponds Overlook'
HELD = [
 ("gonna be back by like 430 today", [r('back_by', 'wed', time='16:30')]),
 ("no long hikes tmrw hollys knee hurts", [r('max_visit', 'thu', minutes=90)]),
 ("wanna hit snake river at sunrise friday", [r('must', 'fri', places=[SRO], **{'from': '07:10', 'to': '07:55', 'tol': 12})]),
 ("skip jenny lake this trip", [rest('skip', 'wed', places=[JL])]),
 ("lunch w friends noon to 130 thurs", [r('busy', 'thu', **{'from': '12:00', 'to': '13:30'})]),
 ("cunningham cabin first thing tomorrow", {'any': [[r('must', 'thu', places=[CC], anytime=True)], [r('first', 'thu', places=[CC])]]}),
 ("dont wanna drive more than 45 min today", [r('max_leg', 'wed', minutes=45)]),
 ("we have a 6pm reservation", [r('back_by', 'wed', time='17:40', tol=15)]),
 ("taking tomorrow morning off, nothing before noon", [r('leave_after', 'thu', time='12:00')]),
 ("teton pines saturday afternoon", [r('must', 'sat', places=[TP], **{'from': '12:00'})]),
 ("willow flats and oxbow tmrw", [r('must', 'thu', places=[WF]), r('must', 'thu', places=[OX])]),
 ("not doing taggart, too tired", 'ask'),   # Taggart is on Saturday, the note has no day: must ask (first passes: skipped Wed, or the whole trip)
 ("hour and a half at oxbow on sunday", [r('stay', 'sun', places=[OX], minutes=90)], None, None, [r('must', 'sun', places=[OX])]),
 ("the road to antelope flats is drifted shut today", {'any': ['ask', 'none', [r('skip', 'wed', places=[TA, JM])], [r('skip', 'wed', places=[TA]), r('skip', 'wed', places=[JM])]]}),
 ("holly is sick. day off", [r('day_off', 'wed')]),   # first run (before day_off existed): a whole-day busy block; day_off added because of it
 ("thx", 'none'),
 ("on the 2nd be back by 3 and skip elk ranch", [r('back_by', 'sat', time='15:00'), r('skip', 'sat', places=['Elk Ranch Flats'])]),
 ("glacier view at sunset tmrw", [r('must', 'thu', places=[GV], **{'from': '15:24', 'to': '16:24', 'tol': 12})]),
 ("no more sunrise shoots, rest of trip", {'any': ['ask', [rest('leave_after', 'wed', time='08:15', tol=45)]]}),
 ("blacktail ponds for 45 min around 10 tomorrow", [r('must', 'thu', places=[BP], **{'from': '09:30', 'to': '10:30'}), r('stay', 'thu', places=[BP], minutes=45)]),
]

# Easy day / only N stops (11 Nov 2026).
EASY = [
 ("easy day tomorrow", [r('max_stops', 'thu', count=3), r('max_visit', 'thu', minutes=120)]),
 ("only 3 stops today", [r('max_stops', 'wed', count=3)]),
 ("just 2 stops friday and I want oxbow", [r('max_stops', 'fri', count=2), r('must', 'fri', places=[OX])]),
 ("lets take it easy today", [r('max_stops', 'wed', count=3), r('max_visit', 'wed', minutes=120)]),
 ("one stop tmrw then done", [r('max_stops', 'thu', count=1)]),
 ("easy day saturday, back by 3", [r('max_stops', 'sat', count=3), r('max_visit', 'sat', minutes=120), r('back_by', 'sat', time='15:00')]),
]

# More things to say (11 Nov 2026): icy roads, no skis, gear return, order, only in good weather, top spots, arrive by.
TG = 'Taggart & Bradley Lakes'
MORE = [
 ("roads are icy today", [r('slow_roads', 'wed', factor=1.25)]),
 ("chains required, roads are really bad tomorrow", [r('slow_roads', 'thu', factor=1.5)]),
 ("no skis today", [r('no_gear', 'wed')]),
 ("returning the skis saturday at 4", [r('gear_to', 'sat', time='16:00')]),
 ("start at Oxbow tomorrow", [r('first', 'thu', places=[OX])]),
 ("finish at snake river overlook today", [r('last', 'wed', places=[SRO])]),
 ("oxbow before mormon row on friday", [r('before', 'fri', places=[OX], then_places=[TA, JM])]),
 ("only do taggart if the weather's good", [rest('optional', 'wed', places=[TG])]),
 ("just the best spots today", [r('only_top', 'wed', tier='S')]),
 ("get to taggart by 8", [rest('arrive_by', 'wed', places=[TG], time='08:00')]),
 ("jenny lake lot fills by 9 on saturday", [r('arrive_by', 'sat', places=[JL], time='09:00')]),
 ("icy roads, easy day, back by 4", [r('slow_roads', 'wed', factor=1.25), r('max_stops', 'wed', count=3), r('max_visit', 'wed', minutes=120), r('back_by', 'wed', time='16:00')]),
]

# Faroes set (11 Nov 2026): the other trip, never used while writing the instructions. Sun 16 May 2027, 9:00 AM there.
# Word from the field, the evening recap and questions for T (11 Nov 2026). The 6th item says what else the note
# must hold: now = {here, late, stay, sky} (late / stay may be (value, tolerance)), recap = {place: result},
# q = (kind or kinds, places or None). Without it a note must hold none of the three.
NOWC = [
 ("I'm at Oxbow", 'none', None, None, None, dict(now=dict(here=OX))),
 ("still at T.A. Moulton, need another half hour", 'none', None, None, None, dict(now=dict(here=TA, stay=30))),
 ("running an hour late", 'none', None, None, None, dict(now=dict(late=60))),
 ("we're about 30 min behind", 'none', None, None, None, dict(now=dict(late=30))),
 ("staying here 20 more minutes", 'none', None, None, None, dict(now=dict(stay=20))),
 ("peaks are out!", 'none', None, None, None, dict(now=dict(sky='out'))),
 ("totally socked in at Jenny Lake", 'none', None, None, None, dict(now=dict(sky='hidden', here_opt=JL))),
 ("fog in the valley, can't see anything", 'none', None, None, None, dict(now=dict(sky='hidden'))),
 ("clouds are in and out over the Grand", 'none', None, None, None, dict(now=dict(sky='mixed'))),
 ("looks like it might clear up later", 'none'),
 ("supposed to snow this afternoon", 'none'),
 ("back at the hotel", 'none', None, None, None, dict(now=dict(here='hotel'))),
 ("socked in here, skip Oxbow today", [r('skip', 'wed', places=[OX])], None, None, None, dict(now=dict(sky='hidden'))),
 ("I'm at Dornans", 'none'),
 ("peaks are out", ('none', 'ask'), 'thu', None, None, dict(now=dict(sky='out'), now_opt=True)),   # typed on tomorrow's card: still about right now (or a question back)
 ("peaks are out", 'none', 'wed', '2026-11-20T18:00:00Z'),   # weeks before the trip: nothing to report on
 ("it cleared! Tetons are completely out", 'none', None, None, None, dict(now=dict(sky='out'))),
 ("nailed the barns this morning", 'none', None, None, None, dict(recap={TA: 'nailed', JM: 'nailed'})),
 ("Oxbow was clouded out", 'none', None, None, None, dict(recap={OX: 'missed'})),
 ("got Snake River Overlook but the light was flat, want another go", 'none', None, None, None, dict(recap={SRO: 'got'})),
 ("nailed T.A. Moulton, Oxbow was a bust, sleep in tomorrow", [r('leave_after', 'thu', time='09:00')], None, None, None, dict(recap={TA: 'nailed', OX: 'missed'})),
 ("got the shot at Jenny Lake!", 'none', None, None, None, dict(recap={JL: 'nailed'})),
 ("The light was amazing at Oxbow yesterday!", 'none'),
 ("done with Elk Ranch Flats for the rest of the trip", [rest('skip', 'wed', places=['Elk Ranch Flats'])]),
 ("why is Oxbow on Thursday?", 'none', None, None, None, dict(q=('why', [OX]))),
 ("what if we skip Jenny Lake?", [dict(type='skip', places=[JL], any_scope=True)], None, None, None, dict(q=('what_if', None))),
 ("what if we're back by 4 on Friday?", [r('back_by', 'fri', time='16:00')], None, None, None, dict(q=('what_if', None))),
 ("when should I shoot the barns?", 'none', None, None, None, dict(q=('best_day', [TA, JM]))),
 ("what's the weather tomorrow?", 'none', None, None, None, dict(q=(('other',), None), q_opt=True)),
 ("why did you move Taggart?", 'none', None, None, None, dict(q=('why', ['Taggart & Bradley Lakes']))),
 ("is today a good day for Oxbow?", 'none', None, None, None, dict(q=(('best_day', 'other', 'why'), [OX]))),
 ("dinner at 7 and I'm running 20 minutes late", [r('back_by', 'wed', time='18:40', tol=15)], None, None, None, dict(now=dict(late=20))),
 ("missed Schwabacher, way too cloudy", 'none', None, None, None, dict(recap_opt=True)),
]

FO_TRIP, FO_NOW, FO_CARD = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d', '2027-05-16T08:00:00Z', '2027-05-16'
def f(type, days, **kw): return dict(type=type, dates=[f'2027-05-{d}' for d in days.split()], **kw)
def frest(type, day, **kw): return dict(type=type, rest=f'2027-05-{day}', **kw)
BOUR = ['Bøur — West Viewpoint', 'Bøur — Panoramic Viewpoint', 'Bøur — Evening', 'Bøur Viewpoint']
FO = [
 ("skip sandavagur church", {'any': ['ask', [f('skip', '16', places=['Sandavágur Church'])]]}),   # it is on a past day: asking "whole trip or which day?" is right
 ("kallur on the 27th no matter what", [f('must', '27', places=['Kallur'])]),
 ("mulafossur at sunset tomorrow", [f('must', '17', places=['🐦 Múlafossur'], **{'from': '20:47', 'to': '21:47', 'tol': 15})]),
 ("ferry to sandoy is cancelled wednesday", {'any': ['ask', [f('skip', '19', places=['Sandoy — Drangarnir + Søltuvík'])]]}),
 ("dinner in torshavn at 8 on the 23rd", [f('back_by', '23', time='19:40', tol=15)]),
 ("too windy for the cliffs today", {'any': ['ask', 'none']}),
 ("saksun and tjornuvik before fossa on sunday", [f('before', '23', places=['Saksun', 'Tjørnuvík'], then_places=['Fossá'])]),
 ("easy day tuesday", [f('max_stops', '18', count=3), f('max_visit', '18', minutes=120)]),
 ("day off tomorrow", [f('day_off', '17')]),
 ("no skis today", 'none'),
 ("roads are foggy and slow today", [f('slow_roads', '16', factor=1.25)]),
 ("trollkonufingur first today", [f('first', '16', places=['Trøllkonufingur'])]),
 ("be at gjogv by 10 on the 25th", [f('arrive_by', '25', places=['🐦 Gjógv Gorge'], time='10:00')]),
 ("only the god tier spots tomorrow", [f('only_top', '17', tier='GOD')]),
 ("spend 2 hours at bour west viewpoint", [f('stay', '16', places=['Bøur — West Viewpoint'], minutes=120)], None, None, [f('must', '16', places=['Bøur — West Viewpoint'])]),
 ("skip bour", {'any': ['ask', [f('skip', '16', places=BOUR)], [f('skip', '16', places=['Bøur — Evening'])]]}),   # the Bøur stop that is on today
 ("want tindholmur landing on the 26th in the morning", [f('must', '26', places=['⚓ Tindhólmur — Landing on the Islet'], to='11:00', from_any=True)]),
 ("sleep in on the 20th and 21st", [f('leave_after', '20 21', time='09:00')]),
 ("nothing longer than 3 hours for the rest of the trip", [frest('max_visit', '16', minutes=180)]),
 ("ravnagjogv only if its foggy", {'any': ['ask', 'none', [frest('optional', '16', places=['Ravnagjógv Gorge'])]]}),
]
# A place that is not on the trip (Phil, 11 Nov 2026: keep the time free, do not add a stop). off = rule.off_trip.
def b(day, fr, to, off=True, **kw): return r('busy', day, **{'from': fr, 'to': to, 'off': off}, **kw)
OFF = [
 ("Sleigh ride at the Elk Refuge at 2", [b('wed', '14:00', '15:00', tol_to=60)]),
 ("Coffee at Persephone at 10 for an hour tomorrow", [b('thu', '10:00', '11:00')]),
 ("I want to stop at the National Museum of Wildlife Art today", 'ask'),
 ("wildlife art museum 1 to 3 on Friday", [b('fri', '13:00', '15:00')]),
 ("Holly wants to see the antler arches in the town square sometime tomorrow", 'ask'),
 ("Add Schwabacher Landing tomorrow at sunrise", [b('thu', '07:10', '08:40', tol=15, tol_to=45)]),
 ("dog sledding 9 to 1 on Saturday", [b('sat', '09:00', '13:00')]),
 ("Lunch at the inn 12 to 2", [b('wed', '12:00', '14:00', off=False)]),
 ("massage at the hotel spa at 4 for 90 minutes", [b('wed', '16:00', '17:30', off=False)]),
 ("lunch at Dornans at 12:30", [b('wed', '12:30', '13:30', tol_to=60)]),
 ("Dinner at Snake River Grill at 7:30", [r('back_by', 'wed', time='19:10', tol=15)]),
 ("I'm at the Elk Refuge visitor center", 'none'),
 ("skip the sleigh ride", 'none'),
 ("sleigh ride at 2 tomorrow and skip Menor's Ferry tomorrow", [b('thu', '14:00', '15:00', tol_to=60), r('skip', 'thu', places=["Menor's Ferry"])]),
 ("want to shoot Schwabacher Landing sometime this week", ('ask', 'none')),
 ("National Elk Refuge sleigh ride 10am-11:30 Sunday", [b('sun', '10:00', '11:30')]),
 ("ice skating in Teton Village tomorrow 3-4", [b('thu', '15:00', '16:00')]),
 ("snowmobile tour all morning Friday, 8 to noon", [b('fri', '08:00', '12:00')]),
]
TRIP_OF = {}

def call(case):
    text, exp, card, asof = (list(case) + [None, None, None])[:4]
    body = dict(action='read', dry=True, trip_id=TRIP, date=D[card or 'wed'], as_of=asof or A, text=text)
    if CASES is FO: body.update(trip_id=FO_TRIP, date=FO_CARD, as_of=FO_NOW)
    out = subprocess.run(['curl', '-s', '-m', '90', '-X', 'POST', URL, '-H', 'Content-Type: application/json', '-H', 'apikey: placeholder', '-d', json.dumps(body)], capture_output=True, text=True).stdout
    try: return json.loads(out)
    except Exception: return {'ok': False, 'error': out[:200]}

mins = lambda t: int(t[:2]) * 60 + int(t[3:])
def scope(a): return ('rest', a['from_date']) if 'dates' not in a else ('dates', tuple(sorted(a['dates'])))
def same_scope(e, a):
    if 'rest' in e:   # "rest of the trip" may also come as every remaining day listed
        return scope(a) == ('rest', e['rest']) or scope(a) == ('dates', tuple(d for d in REST if d >= e['rest'])) or (a.get('dates') and len(a['dates']) >= 6 and a['dates'][0] == e['rest'])
    return scope(a) == ('dates', tuple(sorted(e['dates'])))
def match(e, a):
    if e['type'] != a['type'] or not (e.get('any_scope') or same_scope(e, a)): return False
    if 'places' in e and sorted(e['places']) != sorted(a.get('places') or []): return False
    if 'minutes' in e and e['minutes'] != a.get('minutes'): return False
    if 'count' in e and e['count'] != a.get('count'): return False
    if 'factor' in e and abs(e['factor'] - (a.get('factor') or 0)) > 0.001: return False
    if 'tier' in e and e['tier'] != a.get('tier'): return False
    if 'then_places' in e and sorted(e['then_places']) != sorted(a.get('then_places') or []): return False
    if 'off' in e and bool(a.get('off_trip')) != e['off']: return False   # a place not on the trip: T only keeps the time free
    tol = e.get('tol', 0)
    for k in ('time', 'from', 'to'):
        if k in e:
            if not a.get(k) or abs(mins(e[k]) - mins(a[k])) > (e.get('tol_to', tol) if k == 'to' else tol): return False
        elif k == 'from' and e.get('from_any'): pass   # "morning" = from first light: any start is fine
        elif k in ('from', 'to') and e['type'] == 'must' and a.get(k) and not e.get('anytime'): return False   # a time nobody asked for
    return True

def grade(case, res):
    ok, why, bad = grade_rules(case, res)
    if not res.get('ok') or case[1] == 'over': return ok, why, bad
    ex = (list(case) + [None] * 6)[5] or {}
    n = res['note']; now, recap, ans = n.get('now'), n.get('recap') or [], n.get('answer')
    errs = []
    en = ex.get('now')
    if en is None:
        if now: errs.append(f'now not expected: {json.dumps(now)}')
    elif not now:
        if not ex.get('now_opt'): errs.append(f'no now, wanted {en}')
    else:
        here = (now.get('here') or {}); hname = 'hotel' if here.get('hotel') else here.get('place')
        if 'here' in en and hname != en['here']: errs.append(f"here {hname}, wanted {en['here']}")
        if 'here' not in en and hname and hname != en.get('here_opt'): errs.append(f'here {hname} not expected')
        for k, f in (('late', 'late_min'), ('stay', 'stay_min')):
            want = en.get(k); val = now.get(f)
            if want is None:
                if val: errs.append(f'{k} {val} not expected')
            else:
                w, tol = want if isinstance(want, tuple) else (want, 0)
                if val is None or abs(val - w) > tol: errs.append(f'{k} {val}, wanted {w}')
        if en.get('sky') != now.get('sky'): errs.append(f"sky {now.get('sky')}, wanted {en.get('sky')}")
    er = ex.get('recap'); got_r = {x['place']: x['result'] for x in recap}
    if er is None:
        if got_r and not ex.get('recap_opt'): errs.append(f'recap not expected: {got_r}')
    elif got_r != er: errs.append(f'recap {got_r}, wanted {er}')
    eq = ex.get('q')
    if eq is None:
        if ans: errs.append(f"question not expected: {ans.get('kind')}")
    elif not ans:
        if not ex.get('q_opt'): errs.append(f'no question, wanted {eq[0]}')
    else:
        kinds = eq[0] if isinstance(eq[0], tuple) else (eq[0],)
        if ans.get('kind') not in kinds: errs.append(f"question kind {ans.get('kind')}, wanted {kinds}")
        if eq[1] is not None and sorted(ans.get('places') or []) != sorted(eq[1]): errs.append(f"question places {ans.get('places')}, wanted {eq[1]}")
    if errs: return False, (why + '; ' if not ok else '') + '; '.join(errs), True
    return ok, why, bad

def grade_rules(case, res):
    exp, extra_ok = case[1], (list(case) + [None] * 5)[4] or []
    if exp == 'over': return (not res.get('ok') and 'is over' in str(res.get('error'))), str(res.get('error') or 'was read'), False
    if not res.get('ok'): return False, 'error: ' + str(res.get('error')), True
    if isinstance(exp, dict):   # any one of several right answers
        tries = [grade((case[0], alt) + tuple(case[2:]), res) for alt in exp['any']]
        return next((t for t in tries if t[0]), tries[-1])
    n = res['note']; rules, ask = n['rules'], n['ask']
    if (n.get('answer') or {}).get('kind') == 'what_if': rules = n['answer'].get('if_rules') or []   # the "if" of a what-if
    kinds = (exp,) if isinstance(exp, str) else exp if isinstance(exp, tuple) else None
    if kinds:
        got = 'ask' if ask else 'none' if not rules else 'rules'
        return got in kinds, f'got {got}' + (f' ({ask["question"]})' if ask else '') + (f' {json.dumps(rules)}' if rules else ''), got == 'rules'
    if ask: return False, 'asked: ' + ask['question'], False
    left, wrong = list(rules), False
    for e in exp:
        m = next((a for a in left if match(e, a)), None)
        if m is None: return False, f'missing {json.dumps(e)}; got {json.dumps(rules)}', True
        left.remove(m)
    left = [a for a in left if not any(match(e, a) for e in extra_ok)]
    return (not left), ('ok' if not left else f'extra {json.dumps(left)}'), bool(left)

if __name__ == '__main__':
    if '--held' in sys.argv: CASES = HELD; sys.argv.remove('--held')
    if '--easy' in sys.argv: CASES = EASY; sys.argv.remove('--easy')
    if '--more' in sys.argv: CASES = MORE; sys.argv.remove('--more')
    if '--fo' in sys.argv: CASES = FO; sys.argv.remove('--fo')
    if '--now' in sys.argv: CASES = NOWC; sys.argv.remove('--now')
    if '--off' in sys.argv: CASES = OFF; sys.argv.remove('--off')
    pick = [int(x) for x in sys.argv[1:]] or range(1, len(CASES) + 1)
    with cf.ThreadPoolExecutor(6) as ex: results = list(ex.map(lambda i: (i, call(CASES[i - 1])), pick))
    ok = 0; cost = 0.0; bad = []
    for i, res in results:
        good, why, wrongish = grade(CASES[i - 1], res)
        ok += good; cost += float((res.get('note') or {}).get('cost_usd') or 0)
        print(f"{'PASS' if good else 'FAIL'} {i:2d} {CASES[i - 1][0][:60]!r}" + ('' if good else f'\n        {why[:700]}'))
        if not good: bad.append(i)
    print(f'\n{ok} of {len(results)} right. Failed: {bad}. Cost ${cost:.2f}')
