#!/usr/bin/env python3
"""Targeted checks for the 7 fixes, plus a read-only walk of the Teton trip.

Read-only: the build has e2e/fetchGuard.ts, which turns every Supabase write
into a 403. The few checks below that press a button which would write
(unarchive, film change, day status) only run once the log shows the guard is
installed, and only on archived test data ("Offline Test") or a cached
exposure, so nothing real could change even if the guard were missing.
Nothing is ever deleted.

Prints CHECK <name> PASS|FAIL|SKIP lines and TEXT lines (what the screen
said) to stdout, so the results can be read from the job log.
"""
import os, re, subprocess, time, sys
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C  # reuse adb helpers (crawl.py only runs its crawl under __main__)

PKG = C.PKG
results = []


def check(name, ok, detail=''):
    tag = 'PASS' if ok is True else ('SKIP' if ok is None else 'FAIL')
    results.append((name, tag, detail))
    print(f'CHECK {name} {tag} {detail}', flush=True)


def show(label, s):
    ts = [t for t in s.all_texts if t.strip()]
    if not ts:  # the app isn't on screen: say what is, and why it might not be
        other = [(n.get('package'), (n.get('text') or n.get('content-desc') or '').strip()) for n in (s.root.iter('node') if s.root is not None else [])]
        print(f'DIAG [{label}] focus={C.focus_pkg()} pid={C.adb("shell", "pidof", PKG).strip()} on_screen=' +
              ' ¦ '.join(f'{p}:{t[:40]}' for p, t in other if t)[:600], flush=True)
        crash = C.adb('logcat', '-d', '-b', 'crash', timeout=60).strip().splitlines()
        for line in crash[-25:]:
            print('DIAG crash ' + line[:220], flush=True)
        js = [l for l in C.adb('logcat', '-d', timeout=60).splitlines() if 'ReactNativeJS' in l or 'AndroidRuntime' in l or 'philmframe' in l]
        for line in js[-25:]:
            print('DIAG log ' + line[:220], flush=True)
    print(f'TEXT [{label}] ' + ' ¦ '.join(t.replace("\n", " ")[:80] for t in ts[:70]), flush=True)
    C.screenshot('verify-' + label)


def has(s, *needles):
    blob = '\n'.join(s.all_texts).lower()
    return all(n.lower() in blob for n in needles)


def tap_text(s, needle, exact=False):
    for c in s.clickables:
        lab = c['label']
        if (lab == needle) if exact else (needle.lower() in lab.lower()):
            C.tap(c['xy'])
            return True
    # fall back to any node with that text (the clickable parent may be unlabelled)
    for n in s.root.iter('node') if s.root is not None else []:
        t = (n.get('text') or n.get('content-desc') or '').strip()
        if t and ((t == needle) if exact else (needle.lower() in t.lower())):
            x1, y1, x2, y2 = C.bounds(n)
            C.tap(((x1 + x2) // 2, (y1 + y2) // 2))
            return True
    return False


def find_scroll(needle, max_scrolls=8, exact=False):
    s = C.capture(1.0)
    for i in range(max_scrolls + 1):
        if tap_text(s, needle, exact):
            return True
        C.swipe_up(); s = C.capture(1.0)
    return False


def long_press_text(s, needle):
    for n in s.root.iter('node') if s.root is not None else []:
        t = (n.get('text') or n.get('content-desc') or '').strip()
        if needle.lower() in t.lower():
            x1, y1, x2, y2 = C.bounds(n)
            x, y = (x1 + x2) // 2, (y1 + y2) // 2
            C.adb('shell', 'input', 'swipe', str(x), str(y), str(x), str(y), '1500')
            return True
    return False


def dialog_ok():
    s = C.capture(0.5)
    for n in s.root.iter('node') if s.root is not None else []:
        if (n.get('resource-id') or '').endswith('button1'):
            x1, y1, x2, y2 = C.bounds(n)
            C.tap(((x1 + x2) // 2, (y1 + y2) // 2))
            return True
    return False


def back(n=1):
    for _ in range(n):
        C.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(1.5)


def header_icons(s):
    """Unlabelled header buttons at the top right of the trip list, left to right."""
    return sorted([c for c in s.clickables if c['xy'][1] < 400 and c['label'].startswith('<unlabelled')],
                  key=lambda c: c['xy'][0])


def logcat():
    return C.adb('logcat', '-d', '-s', 'ReactNativeJS:*', timeout=60)


def net(on):
    v = 'enable' if on else 'disable'
    C.adb('shell', 'svc', 'wifi', v); C.adb('shell', 'svc', 'data', v)
    C.adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable' if on else 'enable')
    time.sleep(6)


def guard_on():
    lc = logcat()
    return 'E2E_GUARD installed' in lc or 'E2E_BLOCKED' in lc


def blocked_count():
    return logcat().count('E2E_BLOCKED')


def home():
    s = C.launch()
    for _ in range(10):
        if has(s, 'TRIPS'):
            return s
        s = C.capture(3)
    return s


# ---------------------------------------------------------------------------
def fix1_offline_trips():
    net(False)
    s = home(); s = C.capture(8)
    show('offline-first-launch', s)
    check('trips-offline-message', has(s, "couldn't load your trips") and has(s, 'try again'),
          'fresh install, no network')
    net(True)
    if tap_text(s, 'Try again'):
        s = C.capture(10)
    show('after-try-again', s)
    check('trips-try-again-loads', has(s, 'Grand Teton Winter 2026') or has(s, 'Faroe Islands 2027'))


def fix_import_and_exposures():
    s = home()
    icons = header_icons(s)
    if not icons:
        check('import-no-sdocx', False, 'no header icons found'); return
    C.tap(icons[-1]['xy']); s = C.capture(4)
    show('exposures', s)
    check('exposures-empty-hint-or-list', has(s, 'Exposures') or has(s, 'Light Meter'))
    plus = [c for c in s.clickables if c['xy'][1] < 400 and c['xy'][0] > 700]
    if plus:
        C.tap(plus[-1]['xy']); s = C.capture(3)
        show('import', s)
        check('import-no-sdocx', has(s, 'Import Exposures') and not has(s, 'sdocx') and not has(s, 'coming in'))
        back()
    else:
        check('import-no-sdocx', False, 'no + button')
    # film change on the first cached exposure (write is blocked -> must say Not saved and revert)
    s = C.capture(1)
    cards = [c for c in s.clickables if '›' in c['label']]
    if not cards:
        check('exposure-film-not-saved', None, 'no exposures listed'); return
    C.tap(cards[0]['xy']); s = C.capture(3)
    show('exposure-detail', s)
    if not guard_on():
        check('exposure-film-not-saved', None, 'guard not confirmed in log; write tap skipped'); back(); return
    # film row = first clickable below the FILM STOCK label
    fy = None
    for n in s.root.iter('node'):
        if (n.get('text') or '') == 'FILM STOCK':
            fy = C.bounds(n)[3]
    rows = [c for c in s.clickables if fy and c['xy'][1] > fy]
    if not rows:
        check('exposure-film-not-saved', None, 'film row not on screen'); back(); return
    before = rows[0]['label']
    C.tap(rows[0]['xy']); m = C.capture(2)
    show('film-modal', m)
    opts = [c for c in m.clickables if 'P=' in c['label'] and c['label'].split(' | ')[0] != before]
    if not opts:
        check('exposure-film-not-saved', None, 'no other film stock to pick'); back(2); return
    n0 = blocked_count()
    C.tap(opts[0]['xy']); d = C.capture(4)
    show('after-film-pick', d)
    said = has(d, 'Not saved')
    dialog_ok(); a = C.capture(2)
    show('after-not-saved', a)
    still = any(c['label'] == before for c in a.clickables) or before in a.all_texts
    check('exposure-film-not-saved', said and still and blocked_count() > n0,
          f'alert={said} reverted_to="{before}"={still}')
    back(2)


def fix_archive_and_day_status():
    s = home()
    if not guard_on():
        check('unarchive-error', None, 'guard not confirmed'); check('day-status-not-saved', None, 'guard not confirmed'); return
    if not find_scroll('Show Archived'):
        check('unarchive-error', False, 'no Show Archived button'); return
    s = C.capture(2)
    for _ in range(8):
        if has(s, 'Offline Test'):
            break
        C.swipe_up(); s = C.capture(1)
    n0 = blocked_count()
    if not long_press_text(s, 'Offline Test'):
        check('unarchive-error', False, 'Offline Test not found'); return
    d = C.capture(2); show('trip-options', d)
    if tap_text(d, 'Unarchive'):
        e = C.capture(4); show('after-unarchive', e)
        check('unarchive-error', has(e, 'Could not update trip') and blocked_count() > n0)
        dialog_ok(); C.capture(1)
    else:
        check('unarchive-error', False, 'no Unarchive option'); back()
    # open the archived test trip and long-press its Day 1 tab
    s = C.capture(1)
    if not tap_text(s, 'Offline Test'):
        check('day-status-not-saved', False, 'could not open Offline Test'); return
    t = C.capture(5); show('offline-test-trip', t)
    n0 = blocked_count()
    if long_press_text(t, 'Day 1'):
        e = C.capture(4); show('after-day-longpress', e)
        check('day-status-not-saved', has(e, 'Not saved') and blocked_count() > n0)
        dialog_ok()
    else:
        check('day-status-not-saved', False, 'no Day 1 tab')


def walk_teton():
    """Read-only look at the real upcoming trip: trip, a stop, day map, compare, planner tabs."""
    s = home()
    if not tap_text(s, 'Grand Teton Winter 2026'):
        check('teton-open', False); return
    t = C.capture(6); show('teton-trip-day1', t)
    for i in range(3):
        C.swipe_up(); show(f'teton-trip-day1-scroll{i+1}', C.capture(1.5))
    for i in range(3):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '400'); time.sleep(0.6)
    if find_scroll('Snake River Overlook', 4):
        st = C.capture(5); show('stop-snake-river', st)
        check('stop-page-opens', C.app_alive() and not has(st, "isn't in the trip"))
        for i in range(6):
            C.swipe_up(); show(f'stop-snake-river-scroll{i+1}', C.capture(1.5))
        back()
    else:
        check('stop-page-opens', False, 'stop row not found')
    s = C.capture(2)
    if tap_text(s, 'MAP', exact=True):
        dy = C.capture(5); show('teton-day1-map', dy)
        check('day-screen-opens', has(dy, 'DAY 1'))
        if tap_text(dy, 'COMPARE', exact=True):
            cp = C.capture(4); show('teton-day1-compare', cp)
            check('day-compare-opens', C.app_alive() and has(cp, 'DAY ROLLUP'))
            for i in range(3):
                C.swipe_up(); show(f'compare-scroll{i+1}', C.capture(1.5))
            back()
        else:
            check('day-compare-opens', False, 'no COMPARE')
        back()
    else:
        check('day-screen-opens', False, 'no MAP button')
    s = C.capture(2)
    if tap_text(s, 'Open the Planner'):
        p = C.capture(8); show('planner-overview', p)
        for i in range(2):
            C.swipe_up(); show(f'planner-overview-scroll{i+1}', C.capture(1.5))
        for tab in ['Plans', 'Subjects', 'Map', 'Setup']:
            p = C.capture(1)
            if tap_text(p, tab, exact=True):
                q = C.capture(5); show(f'planner-{tab}', q)
                C.swipe_up(); show(f'planner-{tab}-scroll', C.capture(1.5))
        check('planner-tabs', C.app_alive())
        back()
    # day 3 (Jenny Lake ski day)
    s = C.capture(2)
    if tap_text(s, 'Day 3', exact=True):
        show('teton-trip-day3', C.capture(4))


def calculators():
    s = home(); icons = header_icons(s)
    if len(icons) < 3:
        return
    C.tap(icons[-3]['xy']); r = C.capture(3); show('reciprocity', r)
    if r.inputs:
        C.tap(r.inputs[0]['xy']); C.adb('shell', 'input', 'text', '8'); C.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        show('reciprocity-8s', C.capture(2))
    back()
    s = C.capture(1); icons = header_icons(s)
    C.tap(icons[-2]['xy']); f = C.capture(3); show('focus-spread', f)
    if f.inputs:
        C.tap(f.inputs[0]['xy']); C.adb('shell', 'input', 'text', '3.2'); C.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        show('focus-spread-3.2', C.capture(2))
    back()


def main():
    steps = [fix1_offline_trips, fix_import_and_exposures, fix_archive_and_day_status, walk_teton, calculators]
    for st in steps:
        try:
            st()
        except Exception as e:  # keep going; report the step
            check(st.__name__, False, f'error {e!r}')
            net(True)
        if C.check_crash(st.__name__):
            check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in results), flush=True)


if __name__ == '__main__':
    main()
