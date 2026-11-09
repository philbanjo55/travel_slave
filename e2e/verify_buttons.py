#!/usr/bin/env python3
"""Planner buttons on Teton Live (9 Nov 2026, Phil: test the buttons on the Android app).

Read-only: e2e/fetchGuard.ts turns every Supabase write into a 403, so the buttons
that start a plan (Re-plan now, Plan again) or change stops (Accept) can be pressed
without changing anything: each check looks for the button, presses the safe ones,
and then checks that the app is alive and the blocked request was the one expected
(E2E_BLOCKED in the log). Prints CHECK / TEXT / INFO lines to the job log.
"""
import os, re, sys, time, datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C
import verify as V


def seen_has(seen, needle):
    return any(needle.lower() in t.lower() for t in seen)


def scroll_find(needle, max_scrolls=10):
    """Scroll down until a node holding needle is on screen; return the screen or None. No tap."""
    s = C.capture(1.0)
    for _ in range(max_scrolls + 1):
        if V.has(s, needle):
            return s
        C.swipe_up(); s = C.capture(1.0)
    return None


def scroll_top(n=6):
    for _ in range(n):
        C.adb('shell', 'input', 'swipe', '540', '700', '540', '1800', '250')
    time.sleep(1)


def blocked_lines():
    return [l for l in V.logcat().splitlines() if 'E2E_BLOCKED' in l]


def open_live():
    s = V.home()
    if not V.has(s, 'Training trips') and not V.find_scroll('Training trips'):
        V.check('btn-training-row', False, 'no Training trips row'); return None
    if V.has(s, 'Training trips'):
        V.tap_text(s, 'Training trips')
    t = C.capture(3)
    V.show('btn-training', t)
    if not V.tap_text(t, 'Teton Live'):
        V.check('btn-live-open', False, 'no Teton Live row'); return None
    p = C.capture(6)
    ok = V.has(p, 'Open the Planner') or V.has(p, 'DAY ')
    V.check('btn-live-open', ok)
    V.show('btn-live-top', p)
    return p if ok else None


def open_today():
    """Tap today's day tab (labels read like 'DAY 3, Nov 9'); Teton Live is on Mountain time."""
    d = datetime.datetime.now(ZoneInfo('America/Denver'))
    want = f", {d.strftime('%b')} {d.day}"
    s = C.capture(1)
    short = want.strip(', ')  # 'Nov 9': the tab's own date line (exact match, so 'Nov 19' never matches)
    for _ in range(4):
        if V.tap_text(s, short, exact=True):
            t = C.capture(4)
            V.check('btn-today-tab', True, short); return t
        C.adb('shell', 'input', 'swipe', '900', '700', '200', '700', '300'); s = C.capture(0.8)
    V.check('btn-today-tab', False, 'no tab ending ' + want); return None


def replan_now_card():
    if open_live() is None or open_today() is None:
        return
    s = scroll_find('Re-plan now with the cameras')
    V.check('btn-replan-now-on-card', s is not None, "today's card on the trip page")
    if s is None:
        seen, _ = V.texts_all(6)
        print('INFO trip page: ' + ' | '.join(seen)[:1500], flush=True); return
    V.show('btn-replan-now-card', s)
    before = len(blocked_lines())
    V.tap_text(s, 'Re-plan now with the cameras')
    time.sleep(6)
    after = blocked_lines()[before:]
    print('INFO blocked after Re-plan now: ' + ' | '.join(a[-160:] for a in after)[:800], flush=True)
    V.check('btn-replan-now-sent', any('planner_t_now' in a for a in after), 'the tap sent planner_t_now (blocked)')
    V.check('btn-replan-now-alive', C.app_alive())
    V.show('btn-replan-now-after', C.capture(1))


def ghost_accept():
    if open_live() is None or open_today() is None:
        return
    s = C.capture(1)
    hit = None
    for _ in range(10):
        if V.tap_text(s, "Show T's changes on the timeline"):
            hit = True; break
        C.swipe_up(); s = C.capture(1)
    if not hit:
        V.check('btn-accept-shown', None, "no 'Show T's changes' line (T may match your day)"); return
    a = C.capture(5)
    V.show('btn-ghost', a)
    seen, _ = V.texts_all(4)
    V.check('btn-accept-shown', seen_has(seen, "Accept T's plan from now on") or seen_has(seen, 'preview'), 'Accept bar in ghost mode')
    V.check('btn-ghost-alive', C.app_alive())


def plans_tab():
    p = open_live()
    if p is None:
        return
    scroll_top()
    if not V.tap_text(C.capture(1), 'Open the Planner'):
        V.check('btn-planner-open', False); return
    o = C.capture(5)
    V.check('btn-planner-open', V.has(o, 'Plans'))
    if not V.tap_text(o, 'Plans', exact=True):
        V.check('btn-plans-tab', False); return
    t = C.capture(5)
    V.show('btn-plans', t)
    seen, _ = V.texts_all(4)
    V.check('btn-plan-again-shown', seen_has(seen, 'Plan again'))
    V.check('btn-plans-replan-now-shown', seen_has(seen, 'Re-plan now'), "on today's plan only")
    scroll_top()
    before = len(blocked_lines())
    s = C.capture(1)
    tapped = V.tap_text(s, 'Plan again') or V.find_scroll('Plan again')
    time.sleep(8)
    after = blocked_lines()[before:]
    print('INFO blocked after Plan again: ' + ' | '.join(a[-160:] for a in after)[:800], flush=True)
    V.check('btn-plan-again-sent', bool(tapped) and any('planner_t_replan' in a or 'solver-actions' in a for a in after), 'the tap sent a plan request (blocked)')
    V.check('btn-plan-again-alive', C.app_alive())
    seen2, _ = V.texts_all(2)
    V.check('btn-no-object-text', not seen_has(seen2, '[object Object]'), 'no raw [object Object] on screen after the blocked request')
    V.show('btn-plan-again-after', C.capture(1))


def main():
    for st in (replan_now_card, ghost_accept, plans_tab):
        try:
            st()
        except Exception as e:
            V.check(st.__name__, False, f'error {e!r}')
        if C.check_crash(st.__name__):
            V.check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
