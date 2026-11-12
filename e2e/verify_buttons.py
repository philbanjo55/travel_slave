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


OFFLINE = False   # set by offline_3d(): the network is off and every check name gets an 'offline-' prefix


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


# ---- Cut-off check (Phil, 12 Nov 2026: "the full screen mode I can't use any of the controls bc they go past my
# screen where I have buttons for home etc"). Android reports where its own bars are and where every control is, so
# a control that sits under the status bar or under the Home / Back buttons can be flagged. The run uses three-button
# navigation like Phil's phone (e2e/run.sh): the thin gesture bar would hide the problem. What this cannot see: text
# cut short with "..." and anything drawn inside a web view or a map.
def bars(s):
    """(status bar bottom, navigation bar top, width, height) in pixels."""
    w, h = 1080, 2400
    m = re.search(r'(\d+)x(\d+)', C.adb('shell', 'wm', 'size') or '')
    if m:
        w, h = int(m.group(1)), int(m.group(2))
    top, nav = 0, h
    out = C.adb('shell', 'dumpsys', 'window')
    for kind, x1, y1, x2, y2 in re.findall(r'type=(statusBars|navigationBars)\s+frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', out):
        y1, y2 = int(y1), int(y2)
        if kind == 'statusBars' and 0 < y2 < h / 2:
            top = max(top, y2)
        if kind == 'navigationBars' and h / 2 < y1 < h:
            nav = min(nav, y1)
    # second source: the system's own Home / Back buttons in the screen read
    for n in (s.root.iter('node') if s is not None and s.root is not None else []):
        if n.get('package') == 'com.android.systemui' and re.search(r'/(home|back|recent_apps|home_button)$', n.get('resource-id') or ''):
            y1 = C.bounds(n)[1]
            if h / 2 < y1 < h:
                nav = min(nav, y1)
    return top, nav, w, h


def cut_off(label, s=None, strict=True):
    """strict (a fixed screen or pop-up): a quarter of a control under a bar is a miss. Not strict (a scrolling page read at
    its end): only a control more than half under a bar. Sides (Phil: "and sides"): a control that touches the left or
    right edge of the screen without being a full-width row is running off the side (the screen read clips positions at
    the edge, so touching it is the sign). Rows that scroll sideways (day tabs, chips) are left out: their ends are
    meant to run off."""
    s = s or C.capture(1)
    top, nav, w, h = bars(s)
    bad, side, seen, edge = [], [], set(), []
    count = [0]

    def walk(n, sideways):
        cls = n.get('class') or ''
        sideways = sideways or 'HorizontalScrollView' in cls or 'ViewPager' in cls
        if n.get('package') == V.PKG:
            txt = (n.get('text') or n.get('content-desc') or '').strip()
            click = n.get('clickable') == 'true'
            x1, y1, x2, y2 = C.bounds(n)
            if (txt or click) and x2 - x1 >= 8 and y2 - y1 >= 8 and (y2 - y1) <= 0.45 * h:
                count[0] += 1
                name = (txt or ' | '.join(C.texts(n)) or '<no label>')[:44]
                key = (name, y1 // 20)
                under_nav, under_top = max(0, y2 - nav), max(0, top - y1)
                frac = (under_nav + under_top) / (y2 - y1)
                if frac >= (0.25 if strict else 0.5) and key not in seen:
                    seen.add(key)
                    bad.append(f"{name!r} y {y1}-{y2} ({'under the Home/Back buttons' if under_nav else 'under the status bar'})")
                at_left, at_right = x1 <= 0, x2 >= w
                if not sideways and (at_left != at_right) and (x2 - x1) < 0.9 * w and ('side', key) not in seen:
                    seen.add(('side', key))
                    edge.append((name, x1, y1, x2, y2, at_left))
        for c in list(n):
            walk(c, sideways)

    if s.root is not None:
        for c in list(s.root):
            walk(c, False)
    # A control at one edge whose row has a twin of the same size at the other edge is a row of equal boxes filling the
    # width (a tab bar, two chips side by side): flush by design, with its text inside. Anything else is reported.
    for name, x1, y1, x2, y2, at_left in edge:
        twin = any(abs(o[2] - y1) <= 6 and abs(o[4] - y2) <= 6 and o[5] != at_left and abs((o[3] - o[1]) - (x2 - x1)) <= 12 for o in edge)
        if not twin:
            side.append(f"{name!r} x {x1}-{x2} (runs off the {'left' if at_left else 'right'} side)")
    detail = f'bars: status to {top}, buttons from {nav} of {h}; {count[0]} controls read'
    if nav >= h:
        V.check(f'cut-{label}', None, 'could not find where the navigation buttons start')
    else:
        V.check(f'cut-{label}', not bad, (detail if not bad else f'{len(bad)} cut off: ' + '; '.join(bad[:6]) + ' [' + detail + ']')[:600])
    V.check(f'cut-{label}-sides', not side, (f'nothing runs off the left or right ({w} wide)' if not side else f'{len(side)} off the side: ' + '; '.join(side[:6]))[:600])


def stop_page_cut_offs():
    """On an open stop page: its pop-ups and its end, each checked for controls under the bars."""
    def popup(name, needle, exact=False):
        scroll_top(6)
        f = scroll_find(needle, 12)
        if f is None:
            print(f'INFO cut-{name}: no {needle!r} on the stop page', flush=True); return
        f = mid_screen(f, needle)
        if not V.tap_text(f, needle, exact=exact):
            print(f'INFO cut-{name}: could not tap {needle!r}', flush=True); return
        g = C.capture(3)
        cut_off(name, g)
        V.back(); time.sleep(1.5)
        if not C.app_alive() or C.focus_pkg() != V.PKG:
            print(f'INFO cut-{name}: Back left the app', flush=True)
    popup('stop-time-editor', 'Change time at this stop')
    popup('camera-view', 'Tap for the full picture')
    popup('vantage-editor', 'Edit vantages')
    scroll_top(6)
    for _ in range(14):
        C.swipe_up()
    cut_off('stop-page-end', C.capture(1.5), strict=False)



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
    if s is None:
        scroll_top()
        if scroll_find("Today's stops are done") is not None:
            V.check('btn-replan-now-on-card', None, "today's stops are over: the card rightly has no Re-plan now"); return
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
    aft = C.capture(1)
    V.show('btn-replan-now-after', aft)
    V.check('btn-replan-now-no-object-text', not V.has(aft, '[object Object]'), 'the refusal reads as words on the card')


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
    cut_off('accept-bar', C.capture(1))
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
    cut_off('planner', o)
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
    if r is None:
        scroll_top()
        # In the evening (after today's last stop) the card says the day is done and has no Re-plan now.
        r = scroll_find("Today's stops are done")
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
    w = scroll_find('What was checked')
    # The side-by-side card is taller: the closing line can sit below the first screens, the link above it is proof enough.
    V.check('plan-check-details', w is not None or seen_has(seen, 'Claude checks the plan only'), 'details shown after the tap')
    V.check('plan-check-checks-link', w is not None)
    if w is not None:
        # The link itself: the card around it is also a button whose label holds the same words and comes first, so
        # centring on "What was checked" centred the card and, with a long list of flags, left the link off screen
        # (the tap then closed the card). Step down until the link itself is in the middle of the screen.
        # The link is not listed as a button of its own (it sits inside the card, which is one), so find its text and
        # tap that spot, once it is in the middle of the screen.
        def link_xy(st):
            for nd in (st.root.iter('node') if st.root is not None else []):
                if nd.get('package') == V.PKG and (nd.get('text') or nd.get('content-desc') or '').strip().startswith('What was checked'):
                    x1, y1, x2, y2 = C.bounds(nd)
                    if x2 - x1 > 8 and y2 - y1 > 8:
                        return ((x1 + x2) // 2, (y1 + y2) // 2)
            return None
        # Start from the top of the page and step down: the search above can end below the link (the card's own label
        # holds the same words, so it is "found" while the link itself is already above the screen; from there the old
        # loop only went further down and never met it).
        scroll_top(8)
        w = C.capture(1.2)
        link = None
        for _ in range(30):
            link = link_xy(w)
            if link is not None and 0.30 * 2400 <= link[1] <= 0.72 * 2400:
                break
            if link is not None and link[1] < 0.30 * 2400:
                C.adb('shell', 'input', 'swipe', '540', '1000', '540', '1300', '500')
            else:
                C.adb('shell', 'input', 'swipe', '540', '1400', '540', '1050', '500')
            w = C.capture(1.2); link = None
        if link is not None:
            C.tap(link)
        else:
            print('INFO plan check: the What-was-checked link never came on screen', flush=True)
        time.sleep(1.5)
        seen2, _ = V.texts_all(3)
        ok = seen_has(seen2, 'Weather warnings') or seen_has(seen2, 'Avalanche') or seen_has(seen2, 'Hide what was checked')
        V.check('plan-check-checks-list', ok, 'checked items listed')
        if not ok:
            print('INFO after What-was-checked tap: ' + ' | '.join(t for t in seen2 if len(t) > 3)[:2500], flush=True)
        V.show('plan-check-checks', C.capture(1))
    V.check('plan-check-no-object-text', not seen_has(seen, '[object Object]'))
    V.check('plan-check-alive', C.app_alive())


def type_text(t):
    """Type into the focused box (adb wants %s for a space)."""
    C.adb('shell', 'input', 'text', t.replace(' ', '%s').replace("'", ''))
    time.sleep(1.0)


def wait_text(needle, secs=40):
    s = C.capture(1.5)
    for _ in range(int(secs / 2.5)):
        if V.has(s, needle):
            return s
        s = C.capture(2.5)
    return None


def tell_logs():
    return [l for l in V.logcat().splitlines() if 'E2E_TELL' in l]


def open_tell_sheet():
    """From the trip page: today's card -> Tell T sheet. Returns the sheet screen or None."""
    s = scroll_find('Tell T about this day')
    if s is None:
        return None
    s = mid_screen(s, 'Tell T about this day')
    V.tap_text(s, 'Tell T about this day')
    sh = C.capture(2.5)
    return sh if (V.has(sh, 'Send the note to T') or V.has(sh, 'Send to T')) else None


def tell_send(note):
    """Tap the box, type, send. Returns nothing; the caller waits for what comes next."""
    s = C.capture(1)
    V.tap_text(s, 'Your note for T')
    time.sleep(1.2)
    type_text(note)
    s = C.capture(1.2)
    seen = ' | '.join(c['label'] for c in s.clickables)[:300]
    print('INFO tell before send: ' + seen, flush=True)
    return V.tap_text(s, 'Send the note to T') or V.tap_text(s, 'Send to T')


def close_tell_sheet():
    s = C.capture(1)
    if not V.tap_text(s, 'Close Tell T'):
        V.back()
    time.sleep(1.5)


def tell_t():
    """Tell T on today's day card (11 Nov 2026). The test build says notes are on, reads are dry and saves are blocked:
    the box opens, a typed note comes back as plain-words rules, the OK is sent (and blocked), a question is answered,
    a quick button is sent (and blocked), and the app stays up."""
    if open_live() is None or open_today() is None:
        return
    sh = open_tell_sheet()
    V.check('tell-button-on-card', sh is not None, "today's card on the trip page -> sheet")
    if sh is not None:
        cut_off('tell-sheet', sh)
    if sh is None:
        seen, _ = V.texts_all(6)
        print('INFO trip page: ' + ' | '.join(seen)[:1500], flush=True); return
    V.show('tell-sheet', sh)
    V.check('tell-quick-buttons', V.has(sh, 'Sleep in') and V.has(sh, 'Day off'), 'one-tap buttons shown')
    # 1. A typed note -> what T understood, before anything changes.
    sent = tell_send('dinner at 7')
    p = None
    if sent:
        s = C.capture(1.5)
        for _ in range(20):
            if V.has(s, 'Looks right') or V.has(s, 'Which day'):
                break
            s = C.capture(2.5)
        if V.has(s, 'Which day'):
            # An evening run: the time in the note has passed, so T first asks which day. Pick tomorrow.
            day = (datetime.datetime.now(ZoneInfo('America/Denver')) + datetime.timedelta(days=1))
            label = f"{day.strftime('%a')} {day.day} {day.strftime('%b')}"
            V.check('tell-asks-which-day', V.tap_text(s, label), f'time already passed: asked which day, tapped {label}')
            p = wait_text('Looks right', 50)
        elif V.has(s, 'Looks right'):
            p = s
    V.check('tell-preview', p is not None, 'preview with Looks right' if sent else 'Send not tapped')
    print('INFO tell reads: ' + ' | '.join(l[-300:] for l in tell_logs() if 'read' in l)[-900:], flush=True)
    if p is None:
        V.show('tell-no-preview', C.capture(1))
    else:
        V.show('tell-preview', p)
        seen = [c['label'] for c in p.clickables] + [t for t in getattr(p, 'texts', [])]
        seen2, _ = V.texts_all(0)
        seen = seen + list(seen2)
        V.check('tell-preview-plain-words', seen_has(seen, 'Be back at') and seen_has(seen, 'T WILL'), ' | '.join(t for t in seen if len(t) > 3)[:400])
        V.check('tell-preview-no-object-text', not seen_has(seen, '[object Object]') and not seen_has(seen, 'undefined'))
        before = len(blocked_lines())
        V.tap_text(C.capture(1), 'Looks right')
        time.sleep(5)
        after = blocked_lines()[before:]
        print('INFO blocked after Looks right: ' + ' | '.join(a[-160:] for a in after)[:600], flush=True)
        V.check('tell-ok-sent', any('t-notes action=save' in a for a in after), 'the OK sent a save (blocked)')
        e = C.capture(1)
        V.show('tell-after-ok', e)
        V.check('tell-ok-error-shown', V.has(e, 'blocked by emulator test') or V.has(e, 'Back to the note'), 'the refusal is shown, not swallowed')
    V.check('tell-alive-1', C.app_alive())
    close_tell_sheet()
    # 2. A question changes nothing and gets an answer from T's own plans.
    scroll_top()
    sh = open_tell_sheet()
    if sh is None:
        V.check('tell-question-answered', False, 'sheet did not reopen')
    else:
        sent = tell_send('what is the best day for Oxbow Bend?')
        a = wait_text('T SAYS', 50) if sent else None
        V.check('tell-question-answered', a is not None, 'T SAYS shown')
        if a is None:
            V.show('tell-no-answer', C.capture(1))
        else:
            V.show('tell-answer', a)
            seen, _ = V.texts_all(0)
            V.check('tell-answer-text', seen_has(seen, 'Oxbow Bend') and seen_has(seen, 'A question changes nothing'), ' | '.join(t for t in seen if len(t) > 3)[:500])
        close_tell_sheet()
    V.check('tell-alive-2', C.app_alive())
    # 3. A quick button is sent at once (blocked here).
    scroll_top()
    sh = open_tell_sheet()
    if sh is None:
        V.check('tell-quick-sent', False, 'sheet did not reopen')
    else:
        before = len(blocked_lines())
        tapped = V.tap_text(sh, 'Quick: Day off') or V.tap_text(sh, 'Day off')
        time.sleep(6)
        after = blocked_lines()[before:]
        print('INFO blocked after Day off: ' + ' | '.join(x[-160:] for x in after)[:500], flush=True)
        V.check('tell-quick-sent', bool(tapped) and any('t-notes action=quick' in x for x in after), 'Day off sent a quick note (blocked)')
        V.show('tell-after-quick', C.capture(1))
        close_tell_sheet()
    V.check('tell-alive-3', C.app_alive())


def tell_t_setup():
    """Planner Setup tab lists the trip rules from notes (empty here: says so)."""
    p = open_live()
    if p is None:
        return
    scroll_top()
    if not V.tap_text(C.capture(1), 'Open the Planner'):
        V.check('tell-setup-planner-open', False); return
    o = C.capture(5)
    if not V.tap_text(o, 'Setup', exact=True):
        V.check('tell-setup-tab', False, 'no Setup tab'); return
    t = C.capture(4)
    V.show('tell-setup', t)
    seen, _ = V.texts_all(2)
    V.check('tell-trip-rules-shown', seen_has(seen, 'TRIP RULES'), 'trip rules box on the Setup tab')
    V.check('tell-setup-alive', C.app_alive())


def side_by_side_card():
    """The day card as YOUR DAY VS T'S DAY (12 Nov 2026, Phil: crowded card, "how do I view T?"): two columns, Details opens."""
    if open_live() is None or open_today() is None:
        return
    s = scroll_find("YOUR DAY VS T'S DAY")
    V.check('card-side-by-side', s is not None, "today's card on the trip page")
    if s is None:
        seen, _ = V.texts_all(6)
        print('INFO trip page: ' + ' | '.join(seen)[:1500], flush=True); return
    V.show('card-side-by-side', s)
    seen, _ = V.texts_all(2)
    V.check('card-columns', seen_has(seen, 'YOURS') and seen_has(seen, "T'S"), ' | '.join(t for t in seen if len(t) > 2)[:600])
    V.check('card-no-old-crowd', not seen_has(seen, 'moved here from your') and not seen_has(seen, 'Week from today'), 'the long lists are not on the card until Details is opened')
    scroll_top()
    s = scroll_find('Details')
    if s is None:
        V.check('card-details-open', False, 'no Details link'); return
    s = mid_screen(s, 'Details')
    V.check('card-details-tap', V.tap_text(s, 'Details'), 'tap Details')
    time.sleep(1.5)
    seen2, _ = V.texts_all(4)
    V.check('card-details-open', seen_has(seen2, 'open the plan'), ' | '.join(t for t in seen2 if len(t) > 3)[:900])
    V.show('card-details', C.capture(1))
    V.check('card-no-object-text', not seen_has(seen2, '[object Object]') and not seen_has(seen2, 'undefined'))
    V.check('card-alive', C.app_alive())


def sun_3d():
    """3D sun view on a stop page (12 Nov 2026): Sun & Moon -> 3D draws the terrain, shows first / last light, opens full screen."""
    if open_live() is None or open_today() is None:
        return
    # Open a stop from the TIMELINE under the day card (its rows read "6:30 AM Taggart & Bradley Lakes"); the same
    # names inside the card's two columns are not links (the first run tapped one of those and opened nothing).
    names = ('Oxbow Bend', 'Taggart & Bradley Lakes', 'Snake River Overlook', 'Cunningham Cabin', 'Teton Point Turnout', 'Glacier View Turnout')
    row = re.compile(r'^\d{1,2}:\d{2} [AP]M .*(' + '|'.join(re.escape(n) for n in names) + ')')
    stop = None
    s = C.capture(1.0)
    for _ in range(24):
        # Only tap a row that sits in the middle of the screen, from the capture it was found in: a stale position
        # near the bottom edge is Android's own Home button (the second run tapped it and left the app).
        hit = next((c for c in s.clickables if row.match(c['label'])), None)
        if hit is not None and 0.30 * 1920 <= hit['xy'][1] <= 0.72 * 1920:
            C.tap(hit['xy']); stop = hit['label']; break
        if hit is not None and hit['xy'][1] < 0.30 * 1920:
            C.adb('shell', 'input', 'swipe', '540', '900', '540', '1200', '500')   # a little back down
        else:
            C.adb('shell', 'input', 'swipe', '540', '1300', '540', '950', '500')   # a little further up
        s = C.capture(1.2)
    V.check('sun3d-stop-tap', stop is not None, (stop or "no timeline row with a shot stop on today's list")[:80])
    if stop is None:
        seen, _ = V.texts_all(6)
        print('INFO trip page: ' + ' | '.join(seen)[:1500], flush=True); return
    # What Android itself says happened in the seconds after the tap (the first three runs lost the app here).
    for wait in (1.5, 2.5):
        time.sleep(wait)
        act = [l.strip() for l in C.adb('shell', 'dumpsys', 'activity', 'activities').splitlines()
               if 'ResumedActivity' in l or 'mFocusedApp' in l or 'topResumedActivity' in l]
        print(f'INFO sun3d after tap +{wait}s: focus={C.focus_pkg()} pid={C.adb("shell", "pidof", V.PKG).strip()} ' + ' ¦ '.join(act)[:500], flush=True)
    pid = C.adb('shell', 'pidof', V.PKG).strip()
    full = C.adb('logcat', '-d', '-t', '4000', timeout=90).splitlines()
    mine = [l for l in full if f' {pid} ' in l[:40]] if pid else full
    # Run 4 showed React Native tearing its runtime down right after the tap; its log began mid-trace. Print the head:
    # from 25 lines before the first ReactHost error to 40 after, then every JS error line.
    first = next((i for i, l in enumerate(mine) if 'unknown:ReactHost' in l or 'JavascriptException' in l or 'FATAL' in l), None)
    if first is None:
        print('INFO sun3d log: no ReactHost error line in the app log', flush=True)
    else:
        for line in mine[max(0, first - 25): first + 40]:
            print('INFO sun3d head ' + line[:400], flush=True)
    for line in [l for l in full if 'ReactNativeJS' in l][-30:]:
        print('INFO sun3d js ' + line[:600], flush=True)
    for line in C.adb('logcat', '-d', '-b', 'crash', '-t', '60', timeout=60).strip().splitlines()[-40:]:
        print('INFO sun3d crash ' + line[:300], flush=True)
    t = C.capture(1)
    V.show('sun3d-stop-page', t)
    texts = [x for x in t.all_texts if x.strip()]
    opened = len(texts) > 3 and not V.has(t, 'Open the Planner')   # app still on screen, and not the trip page
    V.check('sun3d-stop-open', opened, 'stop page on screen' if opened else ('the app is not on screen' if len(texts) <= 3 else 'still on the trip page'))
    if not opened:
        return
    time.sleep(3)
    s = scroll_find('SUN & MOON', 14)
    V.check('sun3d-section', s is not None, 'Sun & Moon section on the stop page')
    if s is None:
        seen, _ = V.texts_all(8)
        print('INFO stop page: ' + ' | '.join(seen)[:1500], flush=True); return
    s = mid_screen(s, 'SUN & MOON')
    V.check('sun3d-tab', V.tap_text(s, '3D', exact=True), 'tap the 3D tab')
    # The caption under the picture ("Looking W 259 ...") is what says it has drawn; bring it onto the screen first
    # (run 6 drew fine, but the caption sat below the fold while this loop waited).
    t0 = time.time()
    # Put the 3D picture in the middle of the screen (its full-screen button is the handle): a fixed swipe left the
    # caption off screen on one run, and the view was marked not ready although it had drawn.
    # Without a signal the panel may need a moment before its full-screen button exists; the search below scrolls on
    # down the page when it does not find it at once, and the first offline run ended up staring at the page's end.
    if OFFLINE:
        for _ in range(12):
            tab = C.capture(3)
            if V.has(tab, 'Open the 3D view full screen') or V.has(tab, 'Looking '):
                break
        def where(st, words=('SUN & MOON', 'Looking ', 'millimetre lens', '3D terrain', 'terrain', 'Horizon', 'Photo', 'NO SUN', 'full screen')):
            out = []
            for nd in (st.root.iter('node') if st.root is not None else []):
                t = (nd.get('text') or nd.get('content-desc') or '').strip()
                if nd.get('package') == V.PKG and t and (t == '3D' or any(w.lower() in t.lower() for w in words)):
                    x1, y1, x2, y2 = C.bounds(nd); out.append(f'{t[:40]}@y{y1}-{y2}{"*" if nd.get("selected") == "true" else ""}')
            return ' ; '.join(out)[:900]
        print('INFO sun3d offline, at the tab tap (old capture): ' + where(s), flush=True)
        print('INFO sun3d offline, 36 s after the tab tap: ' + where(tab), flush=True)
        print('INFO sun3d offline, all texts then: ' + ' | '.join(x for x in tab.all_texts if len(x.strip()) > 2)[:5000], flush=True)
    f0 = scroll_find('Open the 3D view full screen', 8)
    if f0 is not None:
        mid_screen(f0, 'Open the 3D view full screen')
    t = C.capture(2); ok = False; why = ''
    for _ in range(40):   # the first time it downloads the terrain (a few MB), then draws
        if V.has(t, 'Looking '):
            ok = True; print(f'INFO sun3d drawn within {time.time() - t0:.0f} s of the tab tap', flush=True); break
        bad = [x for x in ("couldn't start", 'too old', "Couldn't get the terrain", 'No 3D terrain', 'outside the 3D terrain') if V.has(t, x)]
        if bad:
            why = bad[0]; break
        t = C.capture(3)
    V.show('sun3d-view', t)
    if not ok:   # what the web view itself said (its console and errors land in logcat as chromium lines)
        seen_now, _ = V.texts_all(2)
        print('INFO sun3d not ready, on screen: ' + ' | '.join(x for x in seen_now if len(x) > 3)[-1200:], flush=True)
        web = [l for l in C.adb('logcat', '-d', '-t', '4000', timeout=90).splitlines()
               if any(w in l for w in ('chromium', 'WebView', 'RNCWebView', 'cr_', 'Console', 'WebGL', 'GL error'))]
        for line in web[-40:]:
            print('INFO sun3d web ' + line[:300], flush=True)
    if not ok and why in ("couldn't start", 'too old'):
        V.check('sun3d-ready', None, "the emulator's web view can't draw it: " + why)
    else:
        V.check('sun3d-ready', ok, why or 'drawn: caption with the looking direction shown')
    if ok:
        # HD (Google's picture, 12 Nov 2026): the button shows only while the door says it is switched on. One tap on
        # = one counted view. No screenshots are taken while Google's picture is up (it must not be stored).
        def peek():
            # texts here and one screen further down, then back where we were (the HD button must stay on screen)
            out = list(C.capture(1.2).all_texts)
            C.adb('shell', 'input', 'swipe', '540', '1500', '540', '800', '500')
            out += C.capture(1.2).all_texts
            C.adb('shell', 'input', 'swipe', '540', '800', '540', '1500', '500')
            time.sleep(1)
            return out
        f = C.capture(1)
        hd_label = 'HD picture from Google'
        if any(hd_label in c['label'] for c in f.clickables):
            V.check('sun3d-hd-button', True, 'HD button on the 3D view')
            V.tap_text(f, hd_label)
            t2 = time.time(); on = False; note = ''
            for _ in range(30):
                time.sleep(3)
                seen_hd = peek()
                if seen_has(seen_hd, 'Picture: Google Maps'):
                    on = True; break
                bad = [x for x in seen_hd if "HD picture couldn't load" in x or "HD picture isn't available" in x]
                if bad:
                    note = bad[0]; break
            V.check('sun3d-hd-on', on, f'Google picture up after {time.time() - t2:.0f} s' if on else (note or 'the HD page never took over')[:120])
            if on:
                time.sleep(20)   # let tiles stream in; it must still be up, not fallen back
                seen_hd = peek()
                still = seen_has(seen_hd, 'Picture: Google Maps') and not seen_has(seen_hd, "couldn't load")
                V.check('sun3d-hd-stays', still, 'still on Google after 20 s' if still else 'fell back to the offline view')
                V.check('sun3d-hd-caption', seen_has(seen_hd, 'Looking '), 'caption shown in HD')
                print('INFO sun3d hd texts: ' + ' | '.join(x for x in seen_hd if 'HD' in x or 'Google' in x or 'Looking' in x or 'First sun' in x or 'Sun reaches' in x)[:900], flush=True)
            web = [l for l in C.adb('logcat', '-d', '-t', '3000', timeout=90).splitlines() if 'chromium' in l and ('ERROR' in l or 'CONSOLE' in l)]
            for line in web[-12:]:
                print('INFO sun3d hd web ' + line[:260], flush=True)
            f = C.capture(1)
            off_ok = V.tap_text(f, hd_label)
            time.sleep(6)
            seen_off = peek()
            V.check('sun3d-hd-off', off_ok and not seen_has(seen_off, 'Picture: Google Maps') and seen_has(seen_off, 'Looking '), 'back to the offline view')
        else:
            print('INFO sun3d hd: no HD button (the door says it is off or unreachable)', flush=True)
        if OFFLINE:
            V.check('sun3d-hd-hidden', not any(hd_label in c['label'] for c in f.clickables), 'no HD button without a signal (it needs one)')
        # Full screen, while the button is on screen with the caption.
        f = C.capture(1)
        if V.tap_text(f, 'Open the 3D view full screen'):
            g = C.capture(5)
            V.show('sun3d-full', g)
            V.check('sun3d-full-open', V.has(g, 'Close'), 'full screen with Close')
            t1 = time.time(); drawn = False
            for _ in range(12):
                if V.has(g, 'Looking '):
                    drawn = True; break
                g = C.capture(3)
            V.check('sun3d-full-drawn', drawn, f'full-screen view drawn within {time.time() - t1:.0f} s' if drawn else 'no caption in full screen')
            cut_off('3d-full-screen', g)
            # Walk mode (12 Nov 2026, branch claude/sun3d-walk): the arrows move the viewpoint. Save is never tapped here.
            g2 = C.capture(1)
            if V.tap_text(g2, 'Walk mode: move your viewpoint'):
                time.sleep(1.5); w0 = C.capture(1)
                arrows = ('Walk forward', 'Step left', 'Step right', 'Walk back')
                V.check('walk-arrows', all(V.has(w0, a) for a in arrows), 'four arrows in full screen')
                fwd = next((c for c in w0.clickables if 'Walk forward' in c['label']), None)
                if fwd is not None:
                    x, y = fwd['xy']
                    C.adb('shell', 'input', 'swipe', str(x), str(y), str(x), str(y), '1500')   # hold the arrow for 1.5 s
                    time.sleep(2.5)
                    w1 = C.capture(1)
                    line = next((t for t in w1.all_texts if "You've walked" in t), None)
                    V.check('walk-moved', line is not None, (line or 'no "You have walked" line after holding the forward arrow')[:110])
                    V.check('walk-save-offered', V.has(w1, 'Save this as my stand spot for the shot'), 'Save as my spot button (not tapped)')
                    cut_off('walk-mode', w1)
                    V.tap_text(w1, 'Back to my saved spot'); time.sleep(2)
                    w2 = C.capture(1)
                    V.check('walk-back', V.has(w2, 'Hold an arrow to walk'), 'back on the saved spot')
                V.check('walk-alive', C.app_alive())
            else:
                print('INFO walk: no walk button in full screen (this build has no walk mode)', flush=True)
            V.show('sun3d-full-drawn', g)
            V.back(); time.sleep(2)
        else:
            V.check('sun3d-full-open', False, 'no full-screen button on screen')
        time.sleep(4)
        seen, _ = V.texts_all(2)
        V.check('sun3d-moments', seen_has(seen, 'First sun on') and seen_has(seen, 'Sun reaches you'), 'first / last light chips')
        V.check('sun3d-status', seen_has(seen, 'You: '), 'in the sun / in shade line')
        # 12 Nov 2026: Phil's 4x5 lenses, the frame box button and the Street View link
        V.check('sun3d-lenses-4x5', all(seen_has(seen, f'{f} millimetre lens') for f in (75, 90, 135, 300)), '75 / 90 / 135 / 300 lens buttons')
        V.check('sun3d-frame-button', seen_has(seen, '4x5 frame box'), 'frame box button')
        V.check('sun3d-street-view', seen_has(seen, 'Street View from this spot'), 'Street View link')
        V.check('sun3d-no-object-text', not seen_has(seen, '[object Object]') and not seen_has(seen, 'undefined'))
        line = next((x for x in seen if '3D terrain' in x), None)
        V.check('sun3d-saved-line', line is not None, (line or 'no "3D terrain saved for this trip" line')[:110])
    try:
        if not OFFLINE: stop_page_cut_offs()
    except Exception as e:
        print(f'INFO cut-off checks on the stop page stopped: {e}', flush=True)
    V.check('sun3d-alive', C.app_alive())


def offline_3d():
    """12 Nov 2026 (Phil: "add to the test an offline check as well to see what features would still work. I'm hoping
    all of the 3d ones"). Runs last: by now the trip, the sun plan and the 3D terrain are saved on the phone. Network
    off, app started fresh (nothing in memory), then the whole 3D pass again; every check is named offline-<name>."""
    global OFFLINE
    orig = V.check
    C.adb('shell', 'svc', 'wifi', 'disable'); C.adb('shell', 'svc', 'data', 'disable'); time.sleep(6)
    ping = (C.adb('shell', 'ping', '-c', '1', '-W', '2', '8.8.8.8') or '').strip().splitlines()
    print('INFO offline: wifi and mobile data off; ping: ' + (ping[-1] if ping else 'no answer')[:140], flush=True)
    gone = not any(' 0% packet loss' in l for l in ping)
    orig('offline-network-off', gone, 'the emulator has no way out' if gone else 'the network is still up: the offline checks below prove nothing')
    OFFLINE = True
    V.check = lambda name, ok=None, note='': orig('offline-' + name, ok, note)
    try:
        C.launch()
        first = C.capture(2)
        print('INFO offline first screen: ' + ' | '.join(t for t in first.all_texts if len(t.strip()) > 2)[:900], flush=True)
        sun_3d()
        # What else is on a stop page and the trip page without a signal (read by a person, not judged here)
        seen, _ = V.texts_all(3)
        print('INFO offline stop page end: ' + ' | '.join(t for t in seen if len(t) > 3)[-1500:], flush=True)
        V.back(); time.sleep(2)
        top = C.capture(2)
        print('INFO offline trip page: ' + ' | '.join(t for t in top.all_texts if len(t.strip()) > 2)[:1800], flush=True)
    finally:
        V.check = orig; OFFLINE = False
        C.adb('shell', 'svc', 'wifi', 'enable'); C.adb('shell', 'svc', 'data', 'enable'); time.sleep(10)


def main():
    for st in (sun_3d, today_auto_open, side_by_side_card, plan_check_card, replan_now_card, ghost_accept, plans_tab, tell_t, tell_t_setup, offline_3d):
        try:
            st()
        except Exception as e:
            V.check(st.__name__, False, f'error {e!r}')
        if C.check_crash(st.__name__):
            V.check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
