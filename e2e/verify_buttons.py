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


def scroll_top(n=8):
    # Start the swipe inside the list (y 1000): the fixed header is taller since the TODAY line on the tab.
    for _ in range(n):
        C.adb('shell', 'input', 'swipe', '540', '1000', '540', '1850', '250')
    time.sleep(1)


def mid_screen(s, needle):
    """Scroll by small steps until the button holding needle sits between 35% and 70% of the screen height."""
    h = 1920
    try:
        m = re.search(r'(\d+)x(\d+)', C.adb('shell', 'wm', 'size') or '')
        if m: h = int(m.group(2))
    except Exception:
        pass
    for _ in range(4):
        c = next((c for c in s.clickables if needle.lower() in c['label'].lower()), None)
        if c is None:
            return s
        y = c['xy'][1]
        if 0.35 * h <= y <= 0.70 * h:
            return s
        d = int(y - 0.5 * h)  # > 0: move content up; < 0: move it down
        d = max(-500, min(500, d))
        C.adb('shell', 'input', 'swipe', '540', str(int(0.6 * h)), '540', str(int(0.6 * h) - d), '600')
        s = C.capture(1.2)
    return s


def nudge_up():
    # Move the content up a little so a target found at the bottom edge sits mid-screen before a tap.
    C.adb('shell', 'input', 'swipe', '540', '1500', '540', '1050', '400')
    return C.capture(1.2)


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
    seen0, _ = V.texts_all(2)
    mine = [t for t in seen0 if t.startswith('Your day as planned:')]
    print('INFO your-day line: ' + ' | '.join(mine), flush=True)
    V.check('btn-your-day-no-bare-zero', not any(t.strip().endswith(': 0.0') for t in mine), ' | '.join(mine)[:200] or 'line not shown')
    scroll_top()  # texts_all scrolled past the button (the card is taller since the plan-check line)
    s = scroll_find('Re-plan now with the cameras')
    if s is None:
        seen3, _ = V.texts_all(6, up_first=6)
        print('INFO page after scrolling back up: ' + ' | '.join(t for t in seen3 if len(t) > 3)[:2500], flush=True)
        V.check('btn-replan-now-refind', False, 'button not found again after scrolling back up'); return
    s2 = nudge_up()
    if V.has(s2, 'Re-plan now with the cameras'):
        s = s2
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


def today_auto_open():
    """The trip page opens on today's day and marks its tab TODAY (10 Nov 2026)."""
    p = open_live()
    if p is None:
        return
    s = C.capture(2)
    V.show('today-open', s)
    V.check('today-badge', V.has(s, 'TODAY'), "today's tab marked")
    r = scroll_find('Re-plan now with the cameras')
    V.check('today-auto-open', r is not None, "opened on today's card without tapping a tab")
    V.check('today-alive', C.app_alive())


def plan_check_card():
    """Claude's plan check on today's day card (10 Nov 2026): the line shows, opens, and lists what was checked."""
    if open_live() is None or open_today() is None:
        return
    s = scroll_find('Plan check')
    V.check('plan-check-shown', s is not None, "today's card on the trip page")
    if s is None:
        seen, _ = V.texts_all(6)
        print('INFO trip page: ' + ' | '.join(seen)[:1500], flush=True); return
    V.show('plan-check-line', s)
    V.check('plan-check-open-tap', V.tap_text(s, "Claude's plan check"), 'tap the line')
    t = C.capture(2)
    V.show('plan-check-open', t)
    seen, _ = V.texts_all(3)
    V.check('plan-check-details', seen_has(seen, 'Claude checks the plan only'), 'details shown after the tap')
    w = scroll_find('What was checked')
    V.check('plan-check-checks-link', w is not None)
    if w is not None:
        w = mid_screen(w, 'What was checked')
        V.tap_text(w, 'What was checked')
        time.sleep(1.5)
        seen2, _ = V.texts_all(3)
        ok = seen_has(seen2, 'Weather warnings') or seen_has(seen2, 'Avalanche') or seen_has(seen2, 'Hide what was checked')
        V.check('plan-check-checks-list', ok, 'checked items listed')
        if not ok:
            print('INFO after What-was-checked tap: ' + ' | '.join(t for t in seen2 if len(t) > 3)[:2500], flush=True)
        V.show('plan-check-checks', C.capture(1))
    V.check('plan-check-no-object-text', not seen_has(seen, '[object Object]'))
    V.check('plan-check-alive', C.app_alive())


def main():
    for st in (today_auto_open, plan_check_card, replan_now_card, ghost_accept, plans_tab):
        try:
            st()
        except Exception as e:
            V.check(st.__name__, False, f'error {e!r}')
        if C.check_crash(st.__name__):
            V.check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
