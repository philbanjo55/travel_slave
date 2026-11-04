#!/usr/bin/env python3
"""Does the screen stay on the trip and day you tapped? (TEST app, read-only.)

Phil, 4 Nov 2026: on 🧪 Teton Live, tapping day 4 "bugs out / refreshes / goes to Faroes day 4".
This walks the live (training) and planned trips, every day, the Day map, the Planner tabs, the
Feeds page, a stop page and backgrounding, and after every step reads the screen: which trip's
title is showing and which day ("Delete day N" is the shown day's own label). It also reads the
E2E_TRIP lines e2e/fetchGuard.ts logs whenever the trip held in memory changes.

Every Supabase write is blocked by e2e/fetchGuard.ts. Prints CHECK / INFO / TEXT lines.
"""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C
import verify as V

os.makedirs(f'{C.OUT}/shots', exist_ok=True)
os.makedirs(f'{C.OUT}/xml', exist_ok=True)

TETON_DAYS = {1: 'Touchdown — Highway Scout', 2: 'Snake River Sunrise + Moose', 3: 'GOD: Teton Park Road Ski to Jenny Lake',
              4: 'Mormon Row + North Loop', 5: 'Taggart Lake', 6: 'Oxbow Sunrise + Open Afternoon', 7: 'Last Morning + Wheels Up'}
FAROES_DAYS = {0: 'Wheels Up', 1: 'Landfall — Vágar', 2: 'ANCHOR: Traelanipa + Drangarnir landing', 3: 'ANCHOR: Dunnesdrangar',
               4: 'ANCHOR: Drangarnir', 5: '', 6: '', 7: '', 8: '', 9: '', 10: 'North Streymoy → Tórshavn',
               11: 'ANCHOR: Mýlingur OR flex', 12: 'North Eysturoy', 13: 'Transit north + Klakkur', 14: 'ANCHOR: Kalsoy'}
TRIPS = {
    'teton_live': {'name': 'Teton Live', 'live': True, 'days': TETON_DAYS},
    'faroes_live': {'name': 'Faroes Live', 'live': True, 'days': FAROES_DAYS},
    'teton_plan': {'name': 'Grand Teton Winter 2026', 'live': False, 'days': TETON_DAYS},
    'faroes_plan': {'name': 'Faroe Islands 2027', 'live': False, 'days': {**FAROES_DAYS, 15: 'Wheels Down'}},
}


def which(s):
    """Trips whose title is on screen. Titles never appear inside one another's screens."""
    blob = '\n'.join(s.all_texts)
    out = [k for k, t in TRIPS.items() if t['name'] in blob]
    # "Training for Grand Teton Winter 2026" only shows on the Training list, never on a trip page.
    if 'teton_plan' in out and 'Training for Grand Teton Winter 2026' in blob:
        out.remove('teton_plan')
    if 'faroes_plan' in out and 'Training for Faroe Islands 2027' in blob:
        out.remove('faroes_plan')
    return out


def shown_day(s):
    for t in s.all_texts:
        m = re.fullmatch(r'Delete day (\d+)', t.strip())
        if m:
            return int(m.group(1))
    return None


def mark(name):
    C.adb('shell', 'log', '-p', 'w', '-t', 'ReactNativeJS', f'E2E_MARK {name}')


def store_since(name):
    """Trip titles the in-memory trip changed to since mark(name)."""
    lines = V.logcat().splitlines()
    idx = max((i for i, l in enumerate(lines) if f'E2E_MARK {name}' in l), default=-1)
    out = []
    for l in lines[idx + 1:]:
        m = re.search(r'E2E_TRIP (\d+) (.*?) days=(\d+)', l)
        if m:
            out.append(m.group(2))
    return out


def store_check(key, name, want):
    seen = store_since(name)
    other = [t for t in seen if t != '(none)' and TRIPS[want]['name'] not in t]
    print(f'INFO {key} trip in memory since tap: {seen}', flush=True)
    V.check(f'{key}-memory', not other, f'another trip loaded over it: {other}' if other else f'{len(seen)} changes, all {TRIPS[want]["name"]}')


def watch(key, want, day, secs, label=''):
    """Read the screen again and again for secs seconds. Fails on any read showing another trip or day."""
    bad, reads, shown = [], 0, False
    t0 = time.time()
    while time.time() - t0 < secs:
        s = C.capture(0.4)
        reads += 1
        if not C.app_alive():
            bad.append(f'{int(time.time() - t0)}s app closed')
            V.show(f'{key}-closed', s); break
        tr, d = which(s), shown_day(s)
        if not tr and not s.all_texts:
            continue  # loading
        if tr != [want] or (day is not None and d is not None and d != day) or V.has(s, 'Something went wrong'):
            bad.append(f'{int(time.time() - t0)}s showed {tr or "no trip title"} day {d}')
            if not shown:
                V.show(f'{key}-wrong', s); shown = True
    V.check(key, not bad, (f'{len(bad)} of {reads} reads wrong: {bad[:5]}' if bad else f'{reads} reads over {secs}s, all {TRIPS[want]["name"]}{f" day {day}" if day is not None else ""}') + label)
    return not bad


def tap_day(n, s=None):
    """Tap the 'Day n' tab on the trip page, scrolling the tab bar sideways if needed."""
    for attempt in range(8):
        s = s or C.capture(0.8)
        tabs = [c for c in s.clickables if re.match(r'day \d+(,| \||$)', c['label'], re.I)]
        for c in tabs:
            if re.match(rf'day {n}(,| \||$)', c['label'], re.I):
                C.tap(c['xy']); return True
        if not tabs:
            s = None; time.sleep(1.5); continue
        nums = [int(re.match(r'day (\d+)', c['label'], re.I).group(1)) for c in tabs]
        y = tabs[0]['xy'][1]
        if n > max(nums):
            C.adb('shell', 'input', 'swipe', '900', str(y), '200', str(y), '350')
        else:
            C.adb('shell', 'input', 'swipe', '200', str(y), '900', str(y), '350')
        s = None; time.sleep(0.8)
    return False


def go_home():
    s = V.home()
    return s


def open_trip(key, from_home=True):
    """Open a trip. Live trips are on the Training list, planned ones on the home list."""
    t = TRIPS[key]
    if from_home:
        go_home()
    if t['live']:
        if not V.find_scroll('Training trips'):
            return False
        time.sleep(2)
        s = C.capture(1.0)
        ok = V.tap_text(s, t['name'])
    else:
        ok = V.find_scroll(t['name'])
    return ok


def wait_trip(want, secs=25):
    t0 = time.time()
    while time.time() - t0 < secs:
        s = C.capture(1.0)
        if which(s) == [want] and shown_day(s) is not None:
            return s
    return C.capture(0.5)


# ---------------------------------------------------------------------------
def phil_repro(other, wait, n=1):
    """Open another trip first, go back, open Teton Live, tap Day 4, then watch (Phil's report)."""
    key = f'repro{n}-{other}-{wait}s'
    if not open_trip(other):
        V.check(key, None, f'could not open {other}'); return
    time.sleep(wait)
    V.back()
    if TRIPS[other]['live']:
        s = C.capture(1.0)  # back on the Training list
        mark(key)
        V.tap_text(s, 'Teton Live')
    else:
        mark(key)
        open_trip('teton_live', from_home=False)
    time.sleep(3)
    if not tap_day(4):
        V.check(key, None, 'no Day 4 tab'); V.show(key + '-nodaytab', C.capture(0.5)); return
    watch(key, 'teton_live', 4, 30)
    store_check(key, key, 'teton_live')


def rapid_switch():
    key = 'rapid-switch'
    go_home()
    if not V.find_scroll('Training trips'):
        V.check(key, None, 'no Training list'); return
    time.sleep(2)
    for name in ('Teton Live', 'Faroes Live', 'Teton Live', 'Faroes Live'):
        V.tap_text(C.capture(0.8), name); time.sleep(1.2); V.back()
    mark(key)
    V.tap_text(C.capture(0.8), 'Teton Live')
    time.sleep(2)
    tap_day(4)
    watch(key, 'teton_live', 4, 40)
    store_check(key, key, 'teton_live')


def reverse():
    key = 'reverse-faroes-day4'
    if not open_trip('teton_live'):
        return
    time.sleep(1.5)
    V.back()
    mark(key)
    V.tap_text(C.capture(0.8), 'Faroes Live')
    time.sleep(3)
    tap_day(4)
    watch(key, 'faroes_live', 4, 25)
    store_check(key, key, 'faroes_live')


def every_day(key):
    t = TRIPS[key]
    if not open_trip(key):
        V.check(f'days-{key}', None, 'could not open'); return
    s = wait_trip(key)
    V.check(f'days-{key}-opens', which(s) == [key], f'showed {which(s)}')
    wrong = []
    for n, title in t['days'].items():
        if not tap_day(n):
            wrong.append(f'day {n}: no tab'); continue
        s = C.capture(1.2)
        tr, d = which(s), shown_day(s)
        ok = tr == [key] and d == n and (not title or title in s.all_texts)
        if not ok:
            wrong.append(f'day {n}: showed {tr} day {d}{"" if not title or title in s.all_texts else " (wrong title)"}')
            V.show(f'days-{key}-{n}', s)
    V.check(f'days-{key}', not wrong, '; '.join(wrong[:6]) if wrong else f'{len(t["days"])} days, each showed its own title')
    # Back on Day 4, sit still through a reload or two.
    tap_day(4)
    watch(f'days-{key}-still', key, 4, 15)
    # Day 4's map screen and back.
    s = C.capture(0.8)
    if V.tap_text(s, 'MAP', exact=True):
        m = C.capture(4)
        dm = re.findall(r'^DAY (\d+)$', '\n'.join(m.all_texts), re.M)
        V.check(f'map-{key}', not dm or dm == ['4'], f'map header said DAY {dm}' if dm else 'map text unreadable (map screen)')
        time.sleep(4)
        V.back()
        watch(f'map-{key}-back', key, 4, 10)
    return True


def planner(key):
    t = TRIPS[key]
    if not open_trip(key):
        return
    wait_trip(key)
    tap_day(4)
    time.sleep(1)
    if not V.tap_text(C.capture(0.8), 'Open the Planner'):
        V.check(f'planner-{key}', None, 'no Planner button'); return
    s = C.capture(4)
    bad = []
    def sub_ok(s, where):
        if not s.all_texts:
            print(f'INFO planner-{key} {where}: screen unreadable (map)', flush=True); return
        if t['name'] not in '\n'.join(s.all_texts) or [k for k in which(s) if k != key]:
            bad.append(f'{where}: {which(s)}'); V.show(f'planner-{key}-{where}', s)
    sub_ok(s, 'overview')
    if V.tap_text(s, 'Plans', exact=True):
        s = C.capture(3)
        sub_ok(s, 'plans')
        chips = sorted({int(m.group(1)) for c in s.clickables for m in [re.match(r'D(\d+)(,| \|)', c['label'])] if m})
        print(f'INFO planner-{key} plans clickables: {[c["label"][:30] for c in s.clickables][:25]}', flush=True)
        print(f'INFO planner-{key} day chips on screen: {chips}', flush=True)
        for n in chips[:6]:
            s = C.capture(0.6)
            for c in s.clickables:
                if re.match(rf'D{n}(,| \|)', c['label']):
                    C.tap(c['xy']); break
            s = C.capture(2)
            sub_ok(s, f'plans-D{n}')
    for tab in ('Subjects', 'Map', 'Setup', 'Overview'):
        if V.tap_text(C.capture(0.6), tab, exact=True):
            sub_ok(C.capture(3), tab.lower())
    V.check(f'planner-{key}', not bad and C.app_alive(), '; '.join(bad[:5]) if bad else 'every tab showed this trip')
    V.back()
    watch(f'planner-{key}-back', key, 4, 12)


def feeds(key):
    if not open_trip(key):
        return
    wait_trip(key)
    tap_day(4)
    time.sleep(1)
    mark(f'feeds-{key}')
    if not V.tap_text(C.capture(0.8), 'Open the live feeds'):
        V.check(f'feeds-{key}', None, 'no Feeds button'); return
    time.sleep(40)  # through a 30 s picture reload
    s = C.capture(0.5)
    V.check(f'feeds-{key}-alive', C.app_alive() and not V.has(s, 'Something went wrong'))
    V.back()
    watch(f'feeds-{key}-back', key, 4, 15)
    store_check(f'feeds-{key}', f'feeds-{key}', key)


def background(key, other=None):
    name = f'background-{key}' + (f'-after-{other}' if other else '')
    if other:
        open_trip(other); time.sleep(2); V.back()
        if TRIPS[other]['live'] and TRIPS[key]['live']:
            V.tap_text(C.capture(0.8), TRIPS[key]['name'])
        else:
            open_trip(key, from_home=not TRIPS[other]['live'])
    else:
        open_trip(key)
    time.sleep(3)
    tap_day(4)
    time.sleep(1)
    mark(name)
    C.adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(20)
    C.adb('shell', 'monkey', '-p', C.PKG, '-c', 'android.intent.category.LAUNCHER', '1')
    time.sleep(2)
    watch(name, key, 4, 25)
    store_check(name, name, key)


def stop_page(key, stop):
    if not open_trip(key):
        return
    wait_trip(key)
    tap_day(4)
    time.sleep(1.5)
    if not V.find_scroll(stop):
        V.check(f'stop-{key}', None, f'{stop} not found'); return
    s = C.capture(5)
    V.check(f'stop-{key}-alive', C.app_alive() and not V.has(s, 'Something went wrong'))
    V.back()
    watch(f'stop-{key}-back', key, 4, 12)


def main():
    t0 = time.time()
    print(f'INFO guard on: {V.guard_on() if C.app_alive() else "app not started yet"}', flush=True)
    go_home()
    print(f'INFO guard on: {V.guard_on()}', flush=True)
    # Phil's report first, several ways in.
    for i, (other, wait) in enumerate([('faroes_live', 1), ('faroes_live', 4), ('faroes_plan', 2), ('teton_plan', 2)], 1):
        phil_repro(other, wait, i)
    rapid_switch()
    reverse()
    # Every trip, every day, live and planned.
    for k in ('teton_live', 'faroes_live', 'teton_plan', 'faroes_plan'):
        every_day(k)
    for k in ('teton_live', 'faroes_live', 'teton_plan', 'faroes_plan'):
        planner(k)
    feeds('teton_live')
    feeds('faroes_live')
    background('teton_live')
    background('teton_live', other='faroes_live')
    stop_page('teton_live', 'Oxbow Bend')
    stop_page('faroes_live', 'Bøur Viewpoint')
    fails = [r for r in V.results if r[1] == 'FAIL']
    print(f'SUMMARY {len(V.results)} checks, {len(fails)} FAIL, '
          f'{sum(1 for r in V.results if r[1] == "SKIP")} SKIP, {int(time.time() - t0)}s', flush=True)
    for r in fails:
        print(f'SUMMARY FAIL {r[0]} {r[2]}', flush=True)
    c = V.logcat()
    errs = [l for l in c.splitlines() if 'Error' in l or 'TypeError' in l][-15:]
    for l in errs:
        print('INFO js ' + l[:220], flush=True)


if __name__ == '__main__':
    main()
