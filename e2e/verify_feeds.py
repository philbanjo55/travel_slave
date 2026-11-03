#!/usr/bin/env python3
"""Read-only checks of the Feeds page (camera icon on a trip page, TEST app).

Opens Feeds on the real Teton and Faroes trips, reads every card, turns Live on for every
camera, waits for a reload, and checks that the page never falls over (offline too). Every
Supabase write is blocked by e2e/fetchGuard.ts. Prints CHECK / TEXT / INFO lines to the job log.
"""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C
import verify as V

H24 = re.compile(r'(?<![\d:])(?:[01]\d|2[0-3]):[0-5]\d(?!:| ?[AP]M)')
LOADED = re.compile(r'loaded (\d{1,2}:\d{2}:\d{2} [AP]M)')


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
        if any(w in t for w in ('Archived ·', 'Camera says', 'report ', 'Old report', 'Ceiling', 'Peaks', 'Times are', 'newest model run', 'Not checked', 'Checked hourly')):
            print(f'INFO {key} line: {t[:160]}', flush=True)

    # Live on for every camera, from the top.
    for _ in range(8):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); time.sleep(0.4)
    turned = 0
    for _ in range(10):
        st = C.capture(1.2)
        btns = [c for c in st.clickables if c['label'].strip().lower() in ('show live', 'live')]
        for c in btns:
            C.tap(c['xy']); turned += 1; time.sleep(0.6)
        C.swipe_up()
    print(f'INFO {key} live buttons turned on: {turned}', flush=True)
    time.sleep(12)
    for _ in range(8):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); time.sleep(0.4)
    first, _ = V.texts_all(8)
    V.show(f'{key}-live-1', C.capture(0.5))
    live1 = [t for t in first if t.startswith('Live ·') or 'did not load' in t or 'Loading live' in t]
    for t in live1:
        print(f'INFO {key} live-1: {t[:160]}', flush=True)
    V.check(f'{key}-live-loads', bool(live1) and any(t.startswith('Live ·') for t in live1),
            f'{sum(t.startswith("Live ·") for t in live1)} loaded, {sum("did not load" in t for t in live1)} failed')
    V.check(f'{key}-live-alive', not broken(C.capture(0.5)))
    # 35 s later every live picture should have been fetched again.
    time.sleep(35)
    for _ in range(8):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1700', '300'); time.sleep(0.4)
    second, _ = V.texts_all(8)
    live2 = [t for t in second if t.startswith('Live ·') or 'did not load' in t]
    for t in live2:
        print(f'INFO {key} live-2: {t[:160]}', flush=True)
    l1 = [m.group(1) for t in live1 for m in LOADED.finditer(t)]
    l2 = [m.group(1) for t in live2 for m in LOADED.finditer(t)]
    V.check(f'{key}-live-reloads', bool(l2) and set(l2) != set(l1), f'before {l1[:6]} after {l2[:6]}')

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
