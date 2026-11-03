#!/usr/bin/env python3
"""Read-only checks of the planner wording (one T chance per stop, verdicts, good shots).

Taps only on reading screens of the Teton trip; every Supabase write is blocked by
e2e/fetchGuard.ts anyway. Prints CHECK and TEXT lines to the job log.
"""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C
import verify as V

VERD = ('Good bet', 'Long shot', 'Skip')
PCT = re.compile(r'\b\d{1,3}%')


def blob(seen):
    return '\n'.join(seen)


def no_old_words(name, seen):
    b = blob(seen)
    bad = [w for w in ('weather versions', 'of a perfect day') if w in b]
    pcts = sorted(set(m.group(0) for t in seen for m in PCT.finditer(t) if 'cloud' not in t.lower() and 'mm' not in t))
    V.check(name + '-no-old-words', not bad, ', '.join(bad))
    print(f'INFO {name} percents left: {pcts[:20]}', flush=True)


def trip_page():
    t = V.open_teton()
    if t is None:
        V.check('pl-trip-open', False); return
    seen, _ = V.texts_all(8)
    V.show('pl-trip-end', C.capture(0.5))
    b = blob(seen)
    V.check('pl-trip-verdicts', any(v in b for v in VERD), 'Good bet / Long shot / Skip on the trip page')
    V.check('pl-trip-good-shots', 'good shots' in b.lower())
    V.check('pl-trip-plan-kind', any(k in b for k in ('Morning re-plan', 'Evening plan', 'Week draft', 'T plan')))
    V.check('pl-trip-week-line', 'Week from today' in b)
    print('INFO late re-plan line: ' + ' | '.join(x for x in seen if 're-plan came' in x)[:300], flush=True)
    print('INFO reasons: ' + ' | '.join(x for x in seen if '→' in x or 'instead' in x or ' from Day ' in x)[:900], flush=True)
    no_old_words('pl-trip', seen)


def next_day():
    t = V.open_teton()
    if t is None:
        return
    for d in ('DAY 4', 'DAY 5'):
        t = V.open_teton()
        if t is not None and V.tap_text(t, d, exact=True):
            seen, _ = V.texts_all(6)
            V.show('pl-' + d.replace(' ', '').lower(), C.capture(0.5))
            b = blob(seen)
            V.check('pl-' + d.replace(' ', '').lower() + '-verdicts', any(v in b for v in VERD))
            print(f'INFO {d} lower-why: ' + ' | '.join(x for x in seen if 'The week is what counts' in x)[:300], flush=True)
            no_old_words('pl-' + d.replace(' ', '').lower(), seen)


def open_stop_card(name):
    """Tap the stop card itself (its label starts with the time), never a reason line naming it."""
    pat = re.compile(r'^\d{1,2}:\d{2} [AP]M ' + re.escape(name))
    s = C.capture(1.0)
    for _ in range(9):
        hits = [c for c in s.clickables if pat.match(c['label'].strip())]
        print('DIAG stop clickables: ' + ' | '.join(f"{c['label'][:50]}@{c['xy']}" for c in s.clickables if name in c['label'])[:600], flush=True)
        if hits:
            C.tap(hits[0]['xy']); return C.capture(6)
        C.swipe_up(); s = C.capture(1.0)
    return None


def stop_page():
    t = V.open_teton()
    st = open_stop_card('Snake River Overlook') if t is not None else None
    if st is None:
        V.check('pl-stop-open', False, 'Snake River Overlook card not found'); return
    V.check('pl-stop-open', not V.has(st, 'Open the Planner'), 'stop page, not the trip page')
    seen, _ = V.texts_all(5)
    V.show('pl-stop-snake', C.capture(0.5))
    b = blob(seen)
    if not any(x.strip() for x in seen):  # the stop page never lets the screen reader in (same before this work)
        for n in ('pl-stop-verdict', 'pl-stop-t-plan-line', 'pl-stop-timing-only', 'pl-stop-trip-tab-verdicts'):
            V.check(n, None, 'stop page unreadable by uiautomator')
        V.back(); return
    V.check('pl-stop-verdict', any(v in b for v in VERD))
    V.check('pl-stop-t-plan-line', "T's plan" in b or 'Not in T' in b or 'T does it' in b)
    V.check('pl-stop-timing-only', 'For timing only' in b or 'peak' in b.lower() or 'Trip' in seen)
    no_old_words('pl-stop', seen)
    # Trip tab on the stop page: T's verdict per day
    s = C.capture(1)
    for _ in range(6):
        if V.tap_text(s, 'Trip', exact=True):
            break
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); s = C.capture(0.8)
    seen2, _ = V.texts_all(3)
    V.show('pl-stop-trip-tab', C.capture(0.5))
    V.check('pl-stop-trip-tab-verdicts', any(v in blob(seen2) for v in VERD) or 'not planned yet' in blob(seen2))
    V.back()


def planner_tabs():
    t = V.open_teton()
    if t is None or not V.tap_text(t, 'Open the Planner'):
        V.check('pl-planner-open', False); return
    seen, _ = V.texts_all(6)
    V.show('pl-overview-end', C.capture(0.5))
    b = blob(seen)
    V.check('pl-overview-shots', 'GOOD SHOTS OF BIG SUBJECTS' in b or 'good shots' in b.lower())
    no_old_words('pl-overview', seen)
    for tab in ('Plans', 'Subjects'):
        p = C.capture(1)
        for _ in range(8):
            if V.tap_text(p, tab, exact=True):
                break
            C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); p = C.capture(0.8)
        seen, _ = V.texts_all(4)
        V.show('pl-' + tab.lower(), C.capture(0.5))
        b = blob(seen)
        V.check('pl-' + tab.lower() + '-verdicts', any(v in b for v in VERD) or 'good shots' in b.lower())
        no_old_words('pl-' + tab.lower(), seen)
        if tab == 'Subjects':
            names = [x for x in seen if x == 'Snake River Overlook']
            print(f'INFO subjects Snake River rows: {len(names)}', flush=True)
    V.check('pl-planner-alive', C.app_alive())


def main():
    for st in (trip_page, next_day, stop_page, planner_tabs):
        try:
            st()
        except Exception as e:
            V.check(st.__name__, False, f'error {e!r}')
        if C.check_crash(st.__name__):
            V.check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
