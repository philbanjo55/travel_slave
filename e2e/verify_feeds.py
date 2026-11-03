#!/usr/bin/env python3
"""Read-only checks of the Feeds page (camera icon on a trip page, TEST app).

Opens Feeds on the real Teton and Faroes trips, reads every card, checks every camera is live
without a tap, that pictures are fresh and reload, that Pause works, that nothing runs off the edge, and checks that the page never falls over (offline too). Every
Supabase write is blocked by e2e/fetchGuard.ts. Prints CHECK / TEXT / INFO lines to the job log.
"""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C
import verify as V

H24 = re.compile(r'(?<![\d:])(?:[01]\d|2[0-3]):[0-5]\d(?!:|[\s\u202f\u00a0]?[AP]M)')
RELOADED = re.compile(r'reloaded (\d{1,2}:\d{2}:\d{2}[\s\u202f\u00a0][AP]M)')
FRESH = ('Picture taken', 'This camera shows no clock', 'Camera not answering', 'Loading the live picture', 'Paused')


def up():
    for _ in range(8):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); time.sleep(0.4)


def fresh_lines(key, tag):
    up()
    seen, _ = V.texts_all(8)
    out = []
    for t in seen:
        if t.startswith(FRESH) and t not in out:
            out.append(t)
    for t in out:
        print(f'INFO {key} {tag}: {t[:160]}', flush=True)
    return out


def age_min(t):
    if 'just taken' in t:
        return 0
    m = re.search(r'(?:(\d+) h)?\s*(?:(\d+) min)? old', t)
    if not m or not (m.group(1) or m.group(2)):
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def tap_desc(s, desc):
    for n in s.root.iter('node') if s.root is not None else []:
        if (n.get('content-desc') or '').strip().lower() == desc:
            x1, y1, x2, y2 = C.bounds(n); C.tap(((x1 + x2) // 2, (y1 + y2) // 2)); return True
    return False


def overflow():
    """Texts whose box reaches the screen's right edge (the list has a margin, so nothing should)."""
    up()
    bad = []
    for i in range(9):
        s = C.capture(1.2)
        if s.root is None:
            continue
        w = max(C.bounds(n)[2] for n in s.root.iter('node'))
        for n in s.root.iter('node'):
            t = (n.get('text') or '').strip()
            if t and C.bounds(n)[2] >= w - 12 and t not in bad:
                bad.append(t[:60])
        C.swipe_up()
    return bad


def blob(seen):
    return '\n'.join(seen)


def open_feeds(trip):
    s = V.home()
    if not V.tap_text(s, trip):
        V.check(f'feeds-{trip[:6]}-trip-open', False, 'trip not on the list'); return None
    t = C.capture(6)
    if not V.tap_text(t, 'Open the live feeds'):
        V.check(f'feeds-{trip[:6]}-button', False, 'no camera button on the trip page'); return None
    return C.capture(10)


def broken(s):
    return V.has(s, 'Something went wrong') or not C.app_alive()


def page(trip, key):
    s = open_feeds(trip)
    if s is None:
        return
    V.show(f'{key}-open', s)
    V.check(f'{key}-no-crash', not broken(s), 'error screen after the page loaded' if broken(s) else '')
    if broken(s):
        V.show(f'{key}-error', C.capture(0.5)); V.back(); return
    seen, last = V.texts_all(6)
    b = blob(seen)
    V.check(f'{key}-cameras', 'CAMERAS' in b and any(x in b for x in ('Live', 'Frozen', 'Night', 'Offline')))
    V.check(f'{key}-last-updated', 'LAST UPDATED' in b and 'Weather forecast' in b)
    V.check(f'{key}-airport', 'AIRPORT REPORT' in b)
    h24 = sorted(set(m.group(0) for t in seen for m in H24.finditer(t)))
    V.check(f'{key}-one-clock', not h24, f'24-hour times on the page: {h24[:8]}' if h24 else '')
    for t in seen:
        if any(w in t for w in ('Report ', 'Old report', 'Ceiling', 'Peaks', 'Times are', 'Newest model run', 'Not reporting', 'from a stop')):
            print(f'INFO {key} line: {t[:160]}', flush=True)

    # Every camera is live from the moment the page opens: no buttons to press.
    V.check(f'{key}-no-live-buttons', 'Show live' not in b)
    time.sleep(15)
    first = fresh_lines(key, 'live-1')
    V.show(f'{key}-live-1', C.capture(0.5))
    ok1 = [t for t in first if t.startswith('Picture taken') or t.startswith('This camera shows no clock')]
    V.check(f'{key}-live-on-open', len(ok1) >= max(1, len(first) - 1),
            f'{len(ok1)} of {len(first)} live; others: {[t[:60] for t in first if t not in ok1][:4]}')
    ages = [(t, age_min(t)) for t in ok1 if t.startswith('Picture taken')]
    old = [t for t, a in ages if a is not None and a > 30]
    V.check(f'{key}-pictures-fresh', not old, f'older than 30 min: {old[:4]}' if old else f'{len(ages)} with a clock, newest {min((a for _, a in ages if a is not None), default=None)} min')
    edge = overflow()
    V.check(f'{key}-fits-width', not edge, f'text touching the right edge: {edge[:4]}' if edge else '')
    V.check(f'{key}-live-alive', not broken(C.capture(0.5)))
    # 40 s later the pictures have been fetched again: the lines move on.
    time.sleep(40)
    second = fresh_lines(key, 'live-2')
    r1 = [m.group(1) for t in first for m in RELOADED.finditer(t)]
    r2 = [m.group(1) for t in second for m in RELOADED.finditer(t)]
    V.check(f'{key}-live-reloads', second != first or (r2 and r2 != r1), f'reloaded before {r1[:3]} after {r2[:3]}')
    # Pause stops it and says so on the cards; Resume brings it back.
    up()
    st = C.capture(1)
    if tap_desc(st, 'pause live'):
        p = C.capture(2)
        V.show(f'{key}-paused', p)
        V.check(f'{key}-pause', V.has(p, 'Paused'))
        tap_desc(C.capture(0.5), 'resume live')
        time.sleep(8)
        V.check(f'{key}-resume', not V.has(C.capture(1), 'Paused ·'))
    else:
        V.check(f'{key}-pause', False, 'no Pause button')

    # The page refreshes itself each minute: leave it open past one refresh.
    time.sleep(30)
    s = C.capture(1)
    V.check(f'{key}-minute-refresh-alive', not broken(s))

    # Offline: pull to refresh, the page says it could not refresh and keeps the cards.
    V.net(False)
    for _ in range(8):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); time.sleep(0.4)
    C.adb('shell', 'input', 'swipe', '540', '500', '540', '1600', '400')
    time.sleep(25)
    off = C.capture(1)
    V.show(f'{key}-offline', off)
    V.check(f'{key}-offline-alive', not broken(off))
    V.check(f'{key}-offline-message', V.has(off, 'refresh') or V.has(off, 'did not load') or V.has(off, 'weak signal'))
    V.check(f'{key}-offline-keeps-cards', V.has(off, 'CAMERAS'))
    V.net(True)
    V.back()
    V.check(f'{key}-back-to-trip', C.app_alive() and not V.has(C.capture(2), 'CAMERAS'))


def main():
    for trip, key in (('Grand Teton Winter 2026', 'feeds-teton'), ('Faroe Islands 2027', 'feeds-faroes')):
        try:
            page(trip, key)
        except Exception as e:
            V.check(key, False, f'error {e!r}')
            V.net(True)
        if C.check_crash(key):
            V.check(key + '-crash', False, 'app died')
    lc = V.logcat()
    for line in lc.splitlines():
        if 'E2E_FEEDS' in line or ('ReactNativeJS' in line and ('Error' in line or 'Invalid' in line)):
            print('LOG ' + line[-300:], flush=True)
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
