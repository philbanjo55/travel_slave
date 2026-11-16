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
STOP_REF_PHOTOS = None   # set by sun_3d(): whether the opened stop page showed its reference photo thumbnail


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


def cut_off(label, s=None, strict=True, within=None):
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

    roots = list(s.root) if s.root is not None else []
    if within and s.root is not None:
        # Only the fixed bar holding `within` (13 Nov 2026): rows of the list scrolled behind an opaque bottom bar are
        # still in the screen read, though hidden, and were reported as cut off.
        parent = {c: p for p in s.root.iter() for c in p}
        hit = next((n for n in s.root.iter('node') if within.lower() in ((n.get('text') or n.get('content-desc') or '').lower())), None)
        box = hit
        while box is not None and box in parent:
            up = parent[box]
            if up.tag != 'node':
                break
            ux1, uy1, ux2, uy2 = C.bounds(up)
            if (uy2 - uy1) > 0.45 * h:
                break
            box = up
        roots = [box] if box is not None else roots
    for c in roots:
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
    # To the very end: swipe until the screen stops changing (14 swipes fell short on a long page, and a note that
    # simply carried on below the screen was reported as cut off).
    last = None
    for _ in range(40):
        C.swipe_up()
        now = tuple(C.capture(0.8).all_texts)
        if now == last:
            break
        last = now
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
    for k in range(5):   # an empty read means Android's screen reader was busy (16 Nov run: 0 controls), not an empty screen
        if a.all_texts:
            break
        print(f'INFO ghost screen read empty, retry {k + 1}', flush=True)
        time.sleep(2); a = C.capture(2)
    V.show('btn-ghost', a)
    if not a.all_texts:
        V.check('btn-accept-shown', None, 'screen could not be read (Android busy)'); return
    seen, _ = V.texts_all(4)
    V.check('btn-accept-shown', seen_has(seen, "Accept T's plan from now on") or seen_has(seen, 'preview'), 'Accept bar in ghost mode')
    cut_off('accept-bar', C.capture(1), within="Accept T's plan" if seen_has(seen, "Accept T's plan from now on") else 'preview')
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
    s = mid_screen(s, "Claude's plan check")   # at the top edge the tap landed on the fixed header (16 Nov runs)
    V.check('plan-check-open-tap', V.tap_text(s, "Claude's plan check"), 'tap the line')
    t = C.capture(2)
    V.show('plan-check-open', t)
    prow = next((c for c in t.clickables if c['label'].startswith("Claude's plan check")), None)
    opened = prow is not None and 'hide details' in prow['label'].lower()   # the row says Hide details once open
    print(f"INFO plan check row after tap: {(prow or {}).get('label', 'not on screen')[:160]}", flush=True)
    seen, _ = V.texts_all(3)
    w = scroll_find('What was checked', max_scrolls=4)
    V.check('plan-check-details', opened or w is not None or seen_has(seen, 'Claude checks the plan only'), 'details shown after the tap')
    V.check('plan-check-checks-link', True if w is not None else (None if opened else False),
            'link found' if w is not None else ('details open, no checks list on this review' if opened else 'not found'))
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


def sun3d_find_row(s, row):
    """Step down the day's timeline until a shot-stop row sits mid-screen, tap it, return its label (None if none)."""
    for _ in range(24):
        # Only tap a row that sits in the middle of the screen, from the capture it was found in: a stale position
        # near the bottom edge is Android's own Home button (the second run tapped it and left the app).
        hit = next((c for c in s.clickables if row.match(c['label'])), None)
        if hit is not None and 0.30 * 1920 <= hit['xy'][1] <= 0.72 * 1920:
            C.tap(hit['xy']); return hit['label']
        if hit is not None and hit['xy'][1] < 0.30 * 1920:
            C.adb('shell', 'input', 'swipe', '540', '900', '540', '1200', '500')   # a little back down
        else:
            C.adb('shell', 'input', 'swipe', '540', '1300', '540', '950', '500')   # a little further up
        s = C.capture(1.2)
    return None


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
    d0 = datetime.datetime.now(ZoneInfo('America/Denver'))
    for k in range(4):   # today first; a ski day may hold no shot stop (16 Nov), so try the next days
        if k:
            want = d0 + datetime.timedelta(days=k)
            short = f"{want.strftime('%b')} {want.day}"
            scroll_top(6); t = C.capture(1.0)
            if not V.tap_text(t, short, exact=True):
                C.adb('shell', 'input', 'swipe', '900', '384', '300', '384', '300'); t = C.capture(0.8)
                if not V.tap_text(t, short, exact=True):
                    continue
            print(f'INFO sun3d: no shot stop on the day before, trying {short}', flush=True)
            s = C.capture(3.0)
        stop = sun3d_find_row(s, row)
        if stop is not None:
            break
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
    global STOP_REF_PHOTOS
    STOP_REF_PHOTOS = V.has(t, 'Open reference photos')   # the thumbnail next to the stop's name (refphoto-* below)
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
    # Bring the section's heading up to about a third of the screen: the search above stops as soon as the heading
    # peeks in at the very bottom (offline it sat under the Home / Back buttons at y 2371, with its tabs off screen,
    # so the 3D tab was never tapped; the heading is plain text, so mid_screen, which looks at buttons, did nothing).
    def text_y(st, needle):
        for nd in (st.root.iter('node') if st.root is not None else []):
            t = (nd.get('text') or nd.get('content-desc') or '')
            if nd.get('package') == V.PKG and needle.lower() in t.lower():
                x1, y1, x2, y2 = C.bounds(nd); return (y1 + y2) // 2
        return None
    H = 2400
    for _ in range(5):
        y = text_y(s, 'SUN & MOON')
        if y is None or 0.22 * H <= y <= 0.45 * H:
            break
        d = max(-600, min(600, int(y - 0.33 * H)))
        C.adb('shell', 'input', 'swipe', '540', str(int(0.6 * H)), '540', str(int(0.6 * H) - d), '600')
        s = C.capture(1.2)
    # 3D is the first tab and the one open (Phil, 16 Nov 2026, branch claude/sun-3d-first): it must be selected before
    # any tap. (The tap below stays: on a build without the change it opens the tab, here it does nothing.)
    sec = os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'SunPlannerSection.tsx')
    if os.path.exists(sec) and ("['3d', 'map'" in open(sec, encoding='utf-8').read() or "['3d', 'overhead'" in open(sec, encoding='utf-8').read()):
        names = ('3D', 'Map', 'Overhead', 'Horizon', 'Photo')
        sel, on = [], []
        for nd in (s.root.iter('node') if s.root is not None else []):
            if nd.get('package') != V.PKG:
                continue
            here = [(x.get('text') or x.get('content-desc') or '').strip() for x in nd.iter('node')]
            tabs = [t for t in here if t in names]
            if len(tabs) == 1 and len([t for t in here if t]) == 1:   # a tab (the text itself, or its touchable)
                sel.append(tabs[0])
                if nd.get('selected') == 'true':
                    on.append(tabs[0])
        # the selected state may sit on the tab's touchable (its parent), not the text: fall back to the 3D panel itself
        first3d = '3D' in on or (not on and (V.has(s, '3D loads here') or V.has(s, 'Open the 3D view full screen') or V.has(s, 'Finding the terrain') or V.has(s, 'Drawing the terrain') or V.has(s, 'Looking ')))
        V.check('sun3d-tab-default', first3d, f'tabs {sel} selected {on}'[:120])
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
        # Real foreground, round 3 (laser survey, 12 Nov 2026): the plain view is up first (checked above), then the
        # foreground arrives behind it. Either it comes in (the note under the view then names the laser survey) or the
        # view says it was too heavy and stays plain: both are fine for the app, only a dead view is not.
        fg_label = 'Foreground (trees and buildings near you)'
        # The button's own label carries the state ("on, showing" / "on, loading" / "off"), so nothing is scrolled
        # here: the earlier version swiped down for the note each time and could drift the page or miss a tap.
        def fg_now():
            c = C.capture(1.5)
            return c, next((x['label'] for x in c.clickables if fg_label in x['label']), None)
        def fg_wait(ok, secs):
            t0 = time.time(); c, lab = fg_now()
            while time.time() - t0 < secs:
                if ok(c, lab):
                    break
                time.sleep(3); c, lab = fg_now()
            return c, lab, time.time() - t0
        def fg_tap(expect):   # tap until the label says so: a tap can miss while the page is still settling
            for _ in range(3):
                c, lab = fg_now()
                if lab is None:
                    return False
                if expect in lab:
                    return True
                V.tap_text(c, fg_label); time.sleep(2.5)
            c, lab = fg_now()
            return lab is not None and expect in lab
        def fg_say(c):
            print('INFO foreground, on screen: ' + ' | '.join(x for x in c.all_texts if len(x.strip()) > 2)[:1500], flush=True)
            for line in [l for l in C.adb('logcat', '-d', '-t', '4000', timeout=90).splitlines() if 'chromium' in l and ('ERROR' in l or 'CONSOLE' in l or 'Renderer' in l)][-10:]:
                print('INFO foreground web ' + line[:260], flush=True)
        gave_up = lambda c: V.has(c, 'foreground was too heavy') or V.has(c, "foreground didn't load")
        f, lab0 = fg_now()
        if lab0 is not None:
            V.check('fg-button', ': on' in lab0, lab0[:100])
            c, lab, took = fg_wait(lambda c, lab: (lab is not None and ', showing' in lab) or gave_up(c), 170)
            if lab is not None and ', showing' in lab:
                V.check('fg-in', True, f'foreground drawn {took:.0f} s after the plain view')
            elif gave_up(c):
                V.check('fg-in', None, f'the view fell back to the plain one after {took:.0f} s and said so')
            else:
                V.check('fg-in', False, f'no foreground and no fallback line after {took:.0f} s: {(lab or "button gone")[:90]}'); fg_say(c)
            V.check('fg-view-alive', V.has(c, 'Looking '), 'the picture is still up')
            if lab is not None and ', showing' in lab:
                # Three states (16 Nov 2026): on -> buildings only, no trees (no restart; sun times unchanged) -> off -> on
                three = 'buildings only, no trees' in open(os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'Sun3DPanel.tsx'), encoding='utf-8').read()
                if three:
                    def moments_now(st):
                        return sorted(t for t in st.all_texts if t.startswith(('First sun on', 'Sun reaches you', 'You lose the sun', 'Last sun on')) and ':' in t)
                    m0 = moments_now(c)
                    V.tap_text(c, fg_label); time.sleep(2.5)
                    c, lab, took = fg_wait(lambda c, lab: lab is not None and 'no trees' in lab, 30)
                    if lab is not None and ': on' in lab:   # the tap missed: once more
                        V.tap_text(c, fg_label); time.sleep(2.5)
                        c, lab, took = fg_wait(lambda c, lab: lab is not None and 'no trees' in lab, 30)
                    ok_nt = lab is not None and 'buildings only, no trees' in lab and ', showing' in lab and V.has(c, 'Looking ')
                    V.check('fg-notrees', ok_nt, f'{(lab or "button gone")[:90]} after {took:.0f} s')
                    time.sleep(3); m1 = moments_now(C.capture(1))
                    if m0 and m1:
                        V.check('fg-notrees-moments', m0 == m1, f'before {m0} | after {m1}'[:150])
                    else:
                        print(f'INFO fg-notrees moments not on screen (before {m0}, after {m1})', flush=True)
                    V.check('fg-notrees-alive', C.app_alive() and V.has(C.capture(1), 'Looking '), 'view still up with trees hidden')
                tapped = fg_tap(': off')
                c, lab, took = fg_wait(lambda c, lab: lab is not None and ': off' in lab and V.has(c, 'Looking '), 90)
                ok_off = tapped and lab is not None and ': off' in lab and V.has(c, 'Looking ')
                V.check('fg-off', ok_off, f'{(lab or "button gone")[:70]} / plain picture back after {took:.0f} s')
                if not ok_off:
                    fg_say(c)
                tapped = fg_tap(': on')
                c, lab, took = fg_wait(lambda c, lab: (lab is not None and ', showing' in lab) or gave_up(c), 170)
                ok_on = tapped and lab is not None and ', showing' in lab and V.has(c, 'Looking ')
                V.check('fg-on-again', ok_on, f'{(lab or "button gone")[:70]} after {took:.0f} s')
                if not ok_on:
                    fg_say(c)
            V.check('fg-alive', C.app_alive())
        else:
            print('INFO foreground: no Foreground button on screen (no detail box for this spot, or this build has none)', flush=True)
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
        # Full screen is open when the full-screen Close button is listed ("Close the 3D view"); a plain 'Close' also
        # matched "close to you" in the note under the view, so a full screen that never opened passed (12 Nov 2026,
        # and the Back press that followed then left the stop page). Tap up to three times and say how long it took.
        in_full = lambda st: any('Close the 3D view' in c['label'] for c in st.clickables)
        # Bring the full-screen button back on screen first: online, the weather card and camera picture above the
        # section finish loading during the HD test and push the 3D view below the screen (13 Nov 2026: three taps
        # on a button that was not on screen).
        for _ in range(6):
            s_ = C.capture(1)
            if any('Open the 3D view full screen' in c['label'] for c in s_.clickables):
                break
            y = text_y(s_, 'SUN & MOON')
            d = 600 if y is None else max(-600, min(600, int(y - 0.25 * H)))
            if abs(d) < 40:
                d = 400
            C.adb('shell', 'input', 'swipe', '540', str(int(0.6 * H)), '540', str(int(0.6 * H) - d), '600')
            time.sleep(1.5)
        opened = False; t_open = time.time(); tries = 0; g = C.capture(1)
        for tries in range(1, 4):
            f = C.capture(1)
            btn = next((c for c in f.clickables if 'Open the 3D view full screen' in c['label']), None)
            print(f'INFO full screen tap {tries}: button at {btn["xy"] if btn else None}', flush=True)
            if not V.tap_text(f, 'Open the 3D view full screen'):
                break
            for _ in range(8):
                g = C.capture(1.5)
                if in_full(g):
                    opened = True; break
            if opened:
                break
            # Not open: what is on screen, is the app answering, what did it log (13 Nov 2026 diagnosis)
            print('INFO full screen not open, clickables: ' + ' | '.join(f"{c['label'][:40]}@{c['xy']}" for c in g.clickables[:25]), flush=True)
            print('INFO full screen not open, focus: ' + ' '.join(l.strip() for l in C.adb('shell', 'dumpsys', 'window', timeout=30).splitlines() if 'mCurrentFocus' in l or 'mFocusedApp' in l)[:300], flush=True)
            for line in [l for l in C.adb('logcat', '-d', '-t', '400', timeout=60).splitlines() if 'ReactNativeJS' in l or 'ANR' in l or 'chromium' in l][-10:]:
                print('INFO full screen log ' + line[:240], flush=True)
        if tries:
            print(f'INFO full screen: {"open" if opened else "not open"} after {tries} tap(s), {time.time() - t_open:.0f} s', flush=True)
        if tries and opened:
            V.show('sun3d-full', g)
            V.check('sun3d-full-open', True, f'full screen with Close ({tries} tap(s), {time.time() - t_open:.0f} s)')
            t1 = time.time(); drawn = False
            for _ in range(12):
                if V.has(g, 'Looking '):
                    drawn = True; break
                g = C.capture(3)
            V.check('sun3d-full-drawn', drawn, f'full-screen view drawn within {time.time() - t1:.0f} s' if drawn else 'no caption in full screen')
            # Smoothness line (12 Nov 2026): a drag across the picture, then the page reports its frame time under the view.
            # Only shown by builds with the smoothness pass; the emulator's software graphics say nothing about a phone,
            # so the number is printed, not judged.
            if drawn:
                sm = None
                for k in range(5):   # the page reports after a moving burst; give the full-screen page time to finish loading
                    C.adb('shell', 'input', 'swipe', '300', '700', '800', '700', '1200'); time.sleep(4)
                    sm = next((t for t in C.capture(1.5).all_texts if t.startswith('Smoothness:')), None)
                    if sm:
                        break
                print('INFO smoothness: ' + (sm or 'no Smoothness line (build without the smoothness pass, or no frame reported)'), flush=True)
                panel = os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'Sun3DPanel.tsx')
                if os.path.exists(panel) and 'Smoothness:' in open(panel, encoding='utf-8').read():   # this build has it
                    V.check('sun3d-smoothness-line', sm is not None, (sm or 'no Smoothness line after a drag')[:100])
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
            try:
                ground_glass()
            except Exception as e:
                V.check('glass-run', False, f'ground glass checks stopped: {e!r}'[:120])
            try:
                framing()
            except Exception as e:
                V.check('frame-run', False, f'framing checks stopped: {e!r}'[:120])
            try:
                refphoto()
            except Exception as e:
                V.check('refphoto-run', False, f'reference photo checks stopped: {e!r}'[:120])
            V.show('sun3d-full-drawn', g)
            c_ = C.capture(1)
            closed = V.tap_text(c_, 'Close the 3D view')
            if not closed:
                V.back()
            time.sleep(2)
            print(f'INFO sun3d close: {"tapped Close" if closed else "no Close button, pressed Back"}', flush=True)
            ac = C.capture(1)
            V.show('sun3d-after-close', ac)
            after_close_texts = list(ac.all_texts)
        else:
            V.show('sun3d-full', g)
            V.check('sun3d-full-open', False, 'full screen did not open' if tries else 'no full-screen button on screen')
        time.sleep(4)
        # 13 Nov 2026: the notes, credits and saved line sit behind "About" (Phil: too much text under the picture)
        if V.find_scroll('About this view', 6):
            time.sleep(1.5)
        seen, _ = V.texts_all(2)
        # 14 Nov 2026: in both today's app and the new build the page was gone ~30 s after closing full screen while the
        # test scrolled for "About this view"; the chips were on screen right after closing, so count that screen too
        try:
            seen = list(seen) + list(after_close_texts)
        except NameError:
            pass
        V.check('sun3d-moments', seen_has(seen, 'First sun on') and seen_has(seen, 'Sun reaches you'), 'first / last light chips')
        if not (seen_has(seen, 'First sun on') and seen_has(seen, 'Sun reaches you')):   # 13 Nov 2026: where did the page go?
            V.show('sun3d-moments-screen', C.capture(1))
            keys = ('ReactHost', 'FATAL', 'has died', 'Killing', 'lowmemorykiller', 'ANR in', 'Start proc', 'onRenderProcessGone', 'Renderer process')
            for line in [l for l in C.adb('logcat', '-d', '-t', '6000', timeout=90).splitlines()
                         if any(k in l for k in keys) and ('philmframe' in l or 'chromium' in l or 'ReactHost' in l or 'lowmemory' in l)][-15:]:
                print('LOGCAT ' + line[:240], flush=True)
            for line in C.adb('logcat', '-d', '-b', 'crash', '-t', '40', timeout=60).strip().splitlines()[-20:]:
                print('CRASH ' + line[:240], flush=True)
        # Teton winter colour (13 Nov 2026): builds that know the region's colour file show its credit line under the view
        tsrc = os.path.join(os.path.dirname(__file__), '..', 'src', 'services', 'terrain.ts')
        if os.path.exists(tsrc) and 'color_credit' in open(tsrc, encoding='utf-8').read():
            V.check('sun3d-colour-credit', seen_has(seen, 'Ground colour: Copernicus'), 'Sentinel-2 / NAIP credit line under the view')
        V.check('sun3d-status', seen_has(seen, 'You: '), 'in the sun / in shade line')
        # 12 Nov 2026: Phil's 4x5 lenses, the frame box button and the Street View link
        V.check('sun3d-lenses-4x5', all(seen_has(seen, f'{f} millimetre lens') for f in (75, 90, 135, 300)), '75 / 90 / 135 / 300 lens buttons')
        V.check('sun3d-frame-button', seen_has(seen, '4x5 frame box'), 'frame box button')
        V.check('sun3d-street-view', seen_has(seen, 'Street View'), 'Street View link')
        V.check('sun3d-no-object-text', not seen_has(seen, '[object Object]') and not seen_has(seen, 'undefined'))
        line = next((x for x in seen if '3D terrain' in x), None)
        V.check('sun3d-saved-line', line is not None, (line or 'no "3D terrain saved for this trip" line')[:110])
    try:
        if not OFFLINE: stop_page_cut_offs()
    except Exception as e:
        print(f'INFO cut-off checks on the stop page stopped: {e}', flush=True)
    V.check('sun3d-alive', C.app_alive())


def framing():
    """Framing and next / previous shot in the full-screen 3D view (14 Nov 2026, branch claude/sun3d-framing).
    Runs inside sun_3d's full screen on Teton Live (a practice trip). Save framing is tapped only to see its question,
    which is always CANCELLED: a shot (vantage row) is shared by the practice copy and the real Grand Teton trip, so a
    saved framing here would change the real trip too (fetchGuard would refuse the write anyway). Checks frame-*."""
    panel = os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'Sun3DPanel.tsx')
    if os.path.exists(panel) and 'Save framing' not in open(panel, encoding='utf-8').read():
        print('INFO framing: this build has no framing controls', flush=True); return
    s = C.capture(1)
    # Walk mode off first: its row sits above the framing row inside the short scrolling area under the picture
    walk_on = next((c for c in s.clickables if 'Walk mode: move your viewpoint' in c['label']), None)
    if walk_on is not None and (V.has(s, 'Hold an arrow to walk') or V.has(s, "You've walked") or V.has(s, 'Back to my saved spot')):
        C.tap(walk_on['xy']); time.sleep(1.5); s = C.capture(1)
    H = 2400
    def framing_row(st):
        return next((t for t in st.all_texts if t.startswith(('Framing: ', 'Not framed yet', 'Framed ', 'Saved on the phone'))), None)
    for _ in range(4):   # the row may sit below the fold of the area under the picture: a small swipe inside it
        if framing_row(s) and any('Save framing for this shot' in c['label'] for c in s.clickables):
            break
        C.adb('shell', 'input', 'swipe', '540', str(int(0.80 * H)), '540', str(int(0.70 * H)), '500'); s = C.capture(1.2)
    line = framing_row(s)
    V.check('frame-line', line is not None, (line or 'no "Not framed yet" / "Framed ..." line in full screen')[:110])
    # Save framing greys out while the view is the saved framing (16 Nov 2026): a greyed button is not clickable, so look
    # for the node itself; on a framed shot it must start greyed, then Aim at subject changes the view and lights it.
    node = next((nd for nd in (s.root.iter('node') if s.root is not None else []) if nd.get('package') == V.PKG
                 and 'Save framing for this shot' in (nd.get('content-desc') or '')), None)
    lit = any('Save framing for this shot' in c['label'] for c in s.clickables)
    V.check('frame-save-button', node is not None or lit, 'Save framing button')
    if (line or '').startswith('Framed ') and not lit:
        V.check('frame-save-grey-unchanged', True, 'greyed while the view is the saved framing')
        if V.tap_text(s, 'Aim at subject'):
            time.sleep(2.5); s = C.capture(1)
        lit = any('Save framing for this shot' in c['label'] for c in s.clickables)
        V.check('frame-save-lights-after-change', lit, 'Save framing lights up once the view moves')
    V.check('frame-aim-button', any('Aim at subject' in c['label'] for c in s.clickables), 'Aim at subject button')
    cut_off('3d-framing', s)
    # Save framing: its question, then Cancel (never Save, see above)
    if V.tap_text(s, 'Save framing for this shot'):
        q = None
        for _ in range(5):
            q = C.capture(1.2)
            if V.has(q, 'Save this framing?'):
                break
        asked = q is not None and V.has(q, 'Save this framing?')
        V.check('frame-save-asks', asked, 'question before saving' if asked else 'no "Save this framing?" question')
        if asked:
            V.check('frame-save-shared-note', V.has(q, 'practice copies included'), 'says it changes the shot on every trip')
            print('INFO framing question: ' + ' | '.join(t for t in q.all_texts if len(t) > 3)[:400], flush=True)
            cancelled = V.tap_text(q, 'Cancel', exact=True)
            time.sleep(1.5); a = C.capture(1)
            V.check('frame-save-cancel', cancelled and not V.has(a, 'Save this framing?'), 'cancelled, nothing saved')
            after = framing_row(a)
            V.check('frame-line-unchanged', after == line, f'before: {(line or "")[:50]} | after: {(after or "")[:50]}')
        else:
            V.back(); time.sleep(1)
    # Aim at subject: the view stays up
    a = C.capture(1)
    if V.tap_text(a, 'Aim at subject'):
        time.sleep(2); b = C.capture(1)
        V.check('frame-aim', V.has(b, 'Looking ') and C.app_alive(), 'view still drawn after Aim at subject')
    # Next / previous shot ("Shot 5 of 38 · Oxbow Bend · main" over the time slider)
    pat = re.compile(r'Shot (\d+) of (\d+)')
    def where(st):
        for t in st.all_texts:
            m = pat.search(t)
            if m:
                return int(m.group(1)), int(m.group(2)), t
        return None
    st = C.capture(1); w0 = where(st)
    V.check('frame-tour-line', w0 is not None, (w0[2] if w0 else 'no "Shot n of m" line in full screen')[:110])
    if w0 is None or w0[1] < 2:
        return
    n0, total, _ = w0
    first, back_ = ('Next shot', 'Previous shot') if n0 < total else ('Previous shot', 'Next shot')
    want = n0 + 1 if first == 'Next shot' else n0 - 1
    if not V.tap_text(st, first, exact=True):
        V.check('frame-next', False, f'no {first} button'); return
    t0 = time.time(); w1 = None; drawn = False
    for _ in range(30):   # another stop may need its terrain read from the phone first
        c = C.capture(3); w1 = where(c)
        if w1 and w1[0] == want and V.has(c, 'Looking '):
            drawn = True; break
    V.check('frame-next', w1 is not None and w1[0] == want, f'{first}: {(w1[2] if w1 else "no line")[:90]}')
    V.check('frame-next-drawn', drawn, f'view drawn {time.time() - t0:.0f} s after {first}' if drawn else 'no "Looking" caption after the switch')
    V.check('frame-next-alive', C.app_alive())
    c = C.capture(1)
    if V.tap_text(c, back_, exact=True):
        w2 = None
        for _ in range(30):
            c = C.capture(3); w2 = where(c)
            if w2 and w2[0] == n0 and V.has(c, 'Looking '):
                break
        V.check('frame-prev', w2 is not None and w2[0] == n0, f'{back_}: {(w2[2] if w2 else "no line")[:90]}')
    else:
        V.check('frame-prev', False, f'no {back_} button')
    cut_off('3d-tour', C.capture(1))


def ground_glass():
    """Ground glass (16 Nov 2026): in full-screen 3D a button turns the picture (and the shot's photo) upside down and
    left-right; the buttons stay upright and the view stays drawn. Checks glass-*."""
    s = C.capture(1)
    b = next((c for c in s.clickables if c['label'].split(' | ')[0].startswith('Ground glass')), None)
    if b is None:
        print('INFO glass: no ground glass button (this build has none)', flush=True); return
    V.check('glass-button', True, b['label'][:60])
    C.tap(b['xy']); time.sleep(2); g = C.capture(1)
    on = next((c for c in g.clickables if c['label'].startswith('Ground glass on')), None)
    V.check('glass-on', on is not None and V.has(g, 'Looking ') and C.app_alive(), 'picture turned, view still drawn')
    V.show('glass-on', g)
    cut_off('3d-glass', g)
    if on is not None:
        C.tap(on['xy']); time.sleep(1.5)
    off = C.capture(1)
    V.check('glass-off', any(c['label'].startswith('Ground glass: turn') for c in off.clickables) and C.app_alive(), 'back the right way up')


def overhead_walk():
    """Overhead tab (satellite) and Walk to shot (16 Nov 2026) on a Teton Live stop with shots. Checks over-* / walkto-*.
    The emulator's GPS is set far away (run.sh geo fix), so Walk to shot shows a distance in km, never "You're there"."""
    sec = os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'SunPlannerSection.tsx')
    if os.path.exists(sec) and "'overhead'" not in open(sec, encoding='utf-8').read():
        print('INFO overhead: this build has no Overhead tab', flush=True); return
    if open_live() is None or open_today() is None:
        return
    names = ('Oxbow Bend', 'Taggart & Bradley Lakes', 'Snake River Overlook', 'Cunningham Cabin', 'Teton Point Turnout', 'Glacier View Turnout')
    row = re.compile(r'^\d{1,2}:\d{2} [AP]M .*(' + '|'.join(re.escape(n) for n in names) + ')')
    stop = None; s = C.capture(1.0)
    d0 = datetime.datetime.now(ZoneInfo('America/Denver'))
    for k in range(4):
        if k:
            want = d0 + datetime.timedelta(days=k); short = f"{want.strftime('%b')} {want.day}"
            scroll_top(6); t = C.capture(1.0)
            if not V.tap_text(t, short, exact=True):
                C.adb('shell', 'input', 'swipe', '900', '384', '300', '384', '300'); t = C.capture(0.8)
                if not V.tap_text(t, short, exact=True):
                    continue
            s = C.capture(3.0)
        stop = sun3d_find_row(s, row)
        if stop is not None:
            break
    V.check('over-stop-tap', stop is not None, (stop or 'no shot stop on the next days')[:80])
    if stop is None:
        return
    time.sleep(3)
    s = scroll_find('SUN & MOON', 14)
    if s is None:
        V.check('over-section', False, 'no Sun & Moon section'); return
    for _ in range(3):   # the tabs a third of the way down
        y = next((C.bounds(nd)[1] for nd in (s.root.iter('node') if s.root is not None else []) if (nd.get('text') or '') == 'SUN & MOON'), None)
        if y is None or 500 <= y <= 1000:
            break
        C.adb('shell', 'input', 'swipe', '540', '1440', '540', str(1440 - (y - 750)), '600'); s = C.capture(1.2)
    V.check('over-tab', V.tap_text(s, 'Overhead', exact=True), 'tap the Overhead tab')
    def label(st):
        if st is None or st.root is None:
            return None
        return next(((nd.get('content-desc') or nd.get('text') or '') for nd in st.root.iter('node')
                     if (nd.get('content-desc') or nd.get('text') or '').startswith('Overhead satellite')), None)
    o = None; lab = None
    for _ in range(8):
        o = C.capture(1.5); lab = label(o)
        if lab:
            break
    V.check('over-shown', lab is not None, (lab or 'no overhead map')[:80])
    V.show('over-inline', o)
    sun = next((c for c in o.clickables if c['label'].split(' | ')[0] in ('Sun on', 'Sun off')), None)
    if sun is not None:
        before = sun['label'].split(' | ')[0]; C.tap(sun['xy']); time.sleep(1); o2 = C.capture(1)
        after = next((c['label'].split(' | ')[0] for c in o2.clickables if c['label'].split(' | ')[0] in ('Sun on', 'Sun off')), None)
        V.check('over-sun-toggle', after is not None and after != before, f'{before} -> {after}')
        sun2 = next((c for c in o2.clickables if c['label'].split(' | ')[0] == after), None)
        if sun2: C.tap(sun2['xy']); time.sleep(0.8)
    else:
        V.check('over-sun-toggle', False, 'no Sun button')
    o = C.capture(1)
    full = next((c for c in o.clickables if 'Open the overhead view full screen' in c['label']), None)
    if full is not None:
        C.tap(full['xy']); time.sleep(3); f = C.capture(1)
        closer = next((c for c in f.clickables if 'Close the overhead view' in c['label']), None)
        V.check('over-full-open', closer is not None and C.app_alive(), 'full screen overhead')
        V.show('over-full', f); cut_off('overhead-full', f)
        if closer is not None:
            C.tap(closer['xy']); time.sleep(1.5)
        else:
            V.back(); time.sleep(1)
    else:
        V.check('over-full-open', False, 'no full screen button')
    V.check('over-alive', C.app_alive())
    # Walk to shot
    w = C.capture(1)
    wb = next((c for c in w.clickables if c['label'].startswith('Walk to')), None)
    if wb is None:
        for _ in range(4):
            C.adb('shell', 'input', 'swipe', '540', '1500', '540', '1100', '500'); w = C.capture(1)
            wb = next((c for c in w.clickables if c['label'].startswith('Walk to')), None)
            if wb: break
    V.check('walkto-button', wb is not None, (wb['label'] if wb else 'no Walk to button')[:60])
    if wb is None:
        return
    C.tap(wb['xy'])
    got = None
    for _ in range(10):
        got = C.capture(1.5)
        allow = next((c for c in got.clickables if c['label'].lower().startswith(('while using the app', 'only this time'))), None)
        if allow is not None:
            C.tap(allow['xy']); continue
        if any(re.fullmatch(r'[\d.]+ (km|m)', t.strip()) for t in got.all_texts) or V.has(got, "You're there") or V.has(got, 'Location is off'):
            break
    dist = next((t for t in got.all_texts if re.fullmatch(r'[\d.]+ (km|m)', t.strip())), None)
    V.check('walkto-open', V.has(got, 'Walk to'), 'walk screen open')
    V.check('walkto-distance', dist is not None, (dist or 'no distance (' + ' | '.join(got.all_texts)[:120] + ')'))
    V.check('walkto-aim', V.has(got, 'aim ') or V.has(got, 'Aim '), 'the way to aim once there')
    V.check('walkto-directions', any('Walking directions in Google Maps' in c['label'] for c in got.clickables), 'Directions button (not tapped)')
    V.show('walkto', got); cut_off('walk-to-shot', got)
    cl = next((c for c in got.clickables if 'Close walk to shot' in c['label']), None)
    if cl: C.tap(cl['xy'])
    else: V.back()
    time.sleep(1.5)
    V.check('walkto-closed', not V.has(C.capture(1), 'Walking directions') and C.app_alive(), 'back on the stop page')


def refphoto():
    """Reference photo in the full-screen 3D view (15 Nov 2026, branch claude/sun3d-ref-photo): the photo button opens a
    small card of the stop's photos, X closes it, a tap on the card lays the photo see-through over the picture with an
    amount slider, its X goes back to the card. None of it may restart the view: the caption's heading must be the same
    after. Runs inside sun_3d's full screen (online and offline). Checks refphoto-*."""
    panel = os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'Sun3DPanel.tsx')
    if os.path.exists(panel) and 'RefPhotoCard' not in open(panel, encoding='utf-8').read():
        print('INFO refphoto: this build has no reference photo card', flush=True); return
    look = re.compile(r'Looking (\S+ \d+)°')
    def heading(st):
        for t in st.all_texts:
            m = look.search(t)
            if m:
                return m.group(1)
        return None
    def clickable(st, label, exact=False):
        # a button's label is its texts joined by ' | ', and an icon glyph counts as a text: compare the first part
        return next((c for c in st.clickables if ((c['label'].split(' | ')[0].strip().lower() == label.lower()) if exact else (label.lower() in c['label'].lower()))), None)
    def wait_for(test, tries=6):
        st = C.capture(1)
        for _ in range(tries):
            if test(st):
                return st, True
            st = C.capture(1.2)
        return st, False
    s = C.capture(1)
    h0 = heading(s)
    btn = clickable(s, 'Reference photo', exact=True)
    if btn is None:
        if STOP_REF_PHOTOS and 'ownRef' not in open(panel, encoding='utf-8').read():
            V.check('refphoto-button', False, 'the stop page shows reference photos, but there is no photo button in full screen')
            print('INFO refphoto: panel says ' + ' | '.join(t for t in s.all_texts if '3D view' in t or 'photos ' in t)[:300], flush=True)
            print('INFO refphoto: buttons ' + ' | '.join(c['label'][:30] for c in s.clickables)[:600], flush=True)
        else:
            V.check('refphoto-button', None, 'this shot has no photo of its own: no photo button (as designed)')
        return
    V.check('refphoto-button', True, f'photo button in full screen (heading {h0})')
    def tap_btn():
        b = clickable(C.capture(1), 'Reference photo', exact=True)
        if b: C.tap(b['xy'])
        return b is not None
    # Open the card
    tap_btn()
    c, ok = wait_for(lambda st: clickable(st, 'Close reference photo') is not None)
    count = next((t for t in c.all_texts if re.fullmatch(r'\d+ of \d+', t.strip())), None)
    V.check('refphoto-card-open', ok, f'card with {count or "one photo (no n of m)"}')
    V.check('refphoto-one-only', clickable(c, 'Next reference photo') is None and (count is None), "only the shot's own photo: no arrows, no count")
    if not ok:
        V.show('refphoto-card', c); return
    card = clickable(c, 'over the view')
    if card is not None:
        # is a picture drawn inside the card? (offline: from the phone's photo store)
        x, y = card['xy']
        imgs = [n for n in (c.root.iter('node') if c.root is not None else []) if n.get('package') == V.PKG and 'Image' in (n.get('class') or '')
                and C.bounds(n)[0] <= x <= C.bounds(n)[2] and C.bounds(n)[1] <= y <= C.bounds(n)[3]]
        print(f'INFO refphoto card at {card["xy"]}: {len(imgs)} image view(s) under it', flush=True)
    if clickable(c, 'Next reference photo') is not None:
        V.tap_text(c, 'Next reference photo'); n2 = C.capture(1.2)
        count2 = next((t for t in n2.all_texts if re.fullmatch(r'\d+ of \d+', t.strip())), None)
        V.check('refphoto-next', count2 is not None and count2 != count, f'{count} -> {count2}')
        c = n2
    cut_off('3d-refphoto-card', c)
    # X closes it (the button stays)
    V.tap_text(c, 'Close reference photo')
    c, ok = wait_for(lambda st: clickable(st, 'Close reference photo') is None)
    V.check('refphoto-card-close', ok and clickable(c, 'Reference photo', exact=True) is not None, 'card closed, photo button still there')
    # Card -> see-through
    tap_btn()
    c, ok = wait_for(lambda st: clickable(st, 'over the view') is not None)
    if not ok:
        V.check('refphoto-see-open', False, 'the card did not open again'); return
    V.tap_text(c, 'over the view')
    c, ok = wait_for(lambda st: V.has(st, 'See-through amount') and clickable(st, 'Close see-through') is not None)
    V.check('refphoto-see-open', ok and clickable(c, 'Close reference photo') is None, 'see-through bar with the amount slider, card hidden')
    if ok:
        V.show('refphoto-see', c)
        cut_off('3d-refphoto-see', c)
        if 'Move photo' in open(os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'sun', 'RefPhotoOverlay.tsx'), encoding='utf-8').read():
            V.check('refphoto-move-btn', any((nd.get('content-desc') or '').startswith('Move photo') for nd in (c.root.iter('node') if c.root is not None else [])),
                    'Move photo toggle on the see-through bar')
        # move the amount: a tap near the slider's right end; the bar and the picture stay
        node = next((n for n in (c.root.iter('node') if c.root is not None else []) if (n.get('content-desc') or '') == 'See-through amount'), None)
        if node is not None:
            x1, y1, x2, y2 = C.bounds(node)
            C.tap((x1 + int(0.85 * (x2 - x1)), (y1 + y2) // 2)); time.sleep(1)
            d = C.capture(1)
            V.check('refphoto-slider', V.has(d, 'See-through amount') and V.has(d, 'Looking ') and C.app_alive(), 'slider moved, bar and view still up')
        V.tap_text(C.capture(1), 'Close see-through')
        c, ok = wait_for(lambda st: clickable(st, 'Close see-through') is None and clickable(st, 'Close reference photo') is not None)
        V.check('refphoto-see-close', ok, 'see-through closed, back to the card')
    # Close the card with the photo button itself, then: the view is the same one (no restart, same heading)
    if clickable(C.capture(1), 'Close reference photo') is not None:
        tap_btn()
    c, gone = wait_for(lambda st: clickable(st, 'Close reference photo') is None and clickable(st, 'Close see-through') is None)
    h1 = heading(c)
    V.check('refphoto-closed', gone, 'card and see-through gone after the photo button')
    V.check('refphoto-spot-kept', h0 is not None and h1 == h0, f'heading before: {h0} | after: {h1}')
    V.check('refphoto-alive', C.app_alive())


def stops_page(fresh=True):
    """Stops tab on the trip page (TEST app, design FINAL, 16 Nov 2026): a first tab 'ALL <n> / Stops' before the days
    shows every rated place once under rank headings (GOD TIER, S TIER, ...), two cards a row; a card opens its stop page
    and Back comes back to the Stops view."""
    h = 2400
    m = re.search(r'(\d+)x(\d+)', C.adb('shell', 'wm', 'size') or '')
    if m:
        h = int(m.group(2))
    if fresh:
        if open_live() is None:
            return
    s = C.capture(1.5)
    tab = next((c for c in s.clickables if c['label'].lower().startswith('stops: all')), None)
    if tab is None:   # the tab row may have scrolled to today's tab: swipe it back to its start
        day = next((c for c in s.clickables if re.match(r'day \d', c['label'].lower())), None)
        if day is None:   # offline the page fills in a moment later
            s = C.capture(2.5); day = next((c for c in s.clickables if re.match(r'day \d', c['label'].lower())), None)
        ty = str(day['xy'][1]) if day else '384'   # swipe on the tab row itself (it scrolls to today's tab); 384 = its height in run 106
        print(f'INFO stops tab row at y {ty}', flush=True)
        for _ in range(3):
            C.adb('shell', 'input', 'swipe', '150', ty, '1000', ty, '300'); s = C.capture(0.8)
            tab = next((c for c in s.clickables if c['label'].lower().startswith('stops: all')), None)
            if tab is not None:
                break
    if tab is None and not fresh and open_live() is not None:
        s = C.capture(1.5)
        tab = next((c for c in s.clickables if c['label'].lower().startswith('stops: all')), None)
    V.check('stops-tab', tab is not None, (tab['label'] if tab else 'no Stops tab before the day tabs')[:80])
    if tab is None:
        print('INFO stops trip page: ' + ' | '.join(t for t in s.all_texts if len(t.strip()) > 1)[:900], flush=True); return
    n = re.search(r'all (\d+)', tab['label'].lower())
    V.check('stops-tab-count', bool(n and int(n.group(1)) > 0), tab['label'][:60])
    C.tap(tab['xy'])
    v = C.capture(2.5)
    V.show('stops-view', v)
    heads = [t for t in v.all_texts if re.fullmatch(r'(GOD|S|A|B|C|D|F) TIER', t.strip())]
    order = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F']
    ranks = [t.split()[0] for t in heads]
    V.check('stops-headings', bool(heads) and ranks == sorted(ranks, key=order.index), ', '.join(heads) or 'no rank heading')
    tally = [t for t in v.all_texts if re.search(r'\d+ (to shoot|to redo|nailed)', t)]
    V.check('stops-tally', bool(tally), (tally[0] if tally else 'no "N to shoot" line')[:80])
    cards = [c for c in v.clickables if 'stop card:' in c['label'].lower()]
    V.check('stops-cards', len(cards) > 0, f'{len(cards)} cards on screen: ' + ', '.join(c['label'].split('|')[0].replace('Stop card: ', '') for c in cards[:6])[:300])
    xs = sorted({c['xy'][0] // 100 for c in cards})
    V.check('stops-two-columns', len(xs) >= 2 if len(cards) > 1 else None, f'card columns at x ~{[x * 100 for x in xs]}')
    lines = [t for t in v.all_texts if re.search(r'\d+/\d+ framed', t)]
    V.check('stops-framed-line', bool(lines), (lines[0] if lines else 'no "n/m framed" line (sun plan not loaded?)')[:80])
    # No day on screen while the Stops view is shown (its MAP button and timeline belong to a day)
    V.check('stops-no-day', not V.has(v, 'MAP'), 'day header hidden' if not V.has(v, 'MAP') else 'MAP button still on screen')
    # Open a card that sits in the middle of the screen; Back must come back to the Stops view
    pick = next((c for c in cards if 0.25 * h <= c['xy'][1] <= 0.75 * h), cards[0] if cards else None)
    if pick is not None:
        name = pick['label'].split('|')[0].replace('Stop card: ', '').strip()
        C.tap(pick['xy'])
        t = C.capture(3)
        V.show('stops-stop-page', t)
        opened = V.has(t, name) and not any('stop card:' in c['label'].lower() for c in t.clickables)
        V.check('stops-card-opens', opened, name[:60])
        V.back(); time.sleep(1)
        b = C.capture(2)
        back_ok = any('stop card:' in c['label'].lower() for c in b.clickables)
        V.check('stops-back', back_ok, 'Back returns to the Stops view' if back_ok else 'not on the Stops view after Back')
        if not back_ok:
            print('INFO stops after back: ' + ' | '.join(t for t in b.all_texts if len(t.strip()) > 1)[:600], flush=True); return
    # The view's end: nothing under the Home / Back buttons once scrolled to the bottom
    last = None
    for _ in range(25):
        C.swipe_up()
        now = tuple(C.capture(0.8).all_texts)
        if now == last:
            break
        last = now
    e = C.capture(1.5)
    V.show('stops-view-end', e)
    cut_off('stops-view-end', e, strict=False)
    # A day tab still works: tap the first 'Day N' tab and the day comes back
    scroll_top(4)
    d = C.capture(1)
    day = next((c for c in d.clickables if re.match(r'^day \d+', c['label'].lower())), None)
    if day is not None:
        C.tap(day['xy'])
        g = C.capture(2)
        V.check('stops-day-tab-back', V.has(g, 'MAP') and not any('stop card:' in c['label'].lower() for c in g.clickables), day['label'][:40])
    else:
        V.check('stops-day-tab-back', None, 'no Day tab on screen')


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
        stops_page(fresh=False)
    finally:
        V.check = orig; OFFLINE = False
        C.adb('shell', 'svc', 'wifi', 'enable'); C.adb('shell', 'svc', 'data', 'enable'); time.sleep(10)


def faroes_3d():
    """Faroes foreground in the app (13 Nov 2026): on Faroes Live, today's first shot stop -> Sun & Moon -> 3D draws, the
    foreground (aerial photo colour, houses, water) comes in, and the Faroese agency's credit line shows."""
    s = V.home()
    if not V.has(s, 'Training trips') and not V.find_scroll('Training trips'):
        V.check('fo3d-trip', False, 'no Training trips row'); return
    s = C.capture(1)
    if V.has(s, 'Training trips'):
        V.tap_text(s, 'Training trips')
    t = C.capture(3)
    if not V.tap_text(t, 'Faroes Live'):
        V.check('fo3d-trip', False, 'no Faroes Live row'); return
    p = C.capture(6)
    V.check('fo3d-trip', V.has(p, 'DAY '), 'Faroes Live open')
    skip = ('Cottages', 'Sleep', 'Hotel', 'Depart', 'Check', 'Return', 'Airport', 'Ferry')
    row = re.compile(r'^\d{1,2}:\d{2} [AP]M (.+)')
    tried = set(); opened = None
    # today first, then the next days (14 Nov 2026: an arrival day has no shot stop, so the check never ran)
    for off in range(4):
      if opened is not None:
        break
      d = datetime.datetime.now(ZoneInfo('Atlantic/Faroe')) + datetime.timedelta(days=off)
      short = f"{d.strftime('%b')} {d.day}"
      p = C.capture(0.5)
      for _ in range(6):
        if V.tap_text(p, short, exact=True):
            break
        C.adb('shell', 'input', 'swipe', '900', '700', '200', '700', '300'); p = C.capture(0.8)
      time.sleep(3)
      print(f'INFO fo3d day {short}', flush=True)
      for _ in range(3):
          s = C.capture(1.0); hit = None
          for _ in range(20):
              hit = next((c for c in s.clickables if row.match(c['label']) and not any(k in c['label'] for k in skip)
                          and row.match(c['label']).group(1)[:30] not in tried), None)
              if hit is not None and 0.30 * 2400 <= hit['xy'][1] <= 0.72 * 2400:
                  break
              C.adb('shell', 'input', 'swipe', '540', '1300', '540', '950', '500'); s = C.capture(1.2); hit = None
          if hit is None:
              break
          tried.add(row.match(hit['label']).group(1)[:30]); C.tap(hit['xy']); time.sleep(4)
          st = scroll_find('SUN & MOON', 14)
          if st is None:
              V.back(); time.sleep(2); continue
          opened = hit['label'][:60]; break
    V.check('fo3d-stop', opened is not None, (opened or 'no shot stop with a Sun & Moon section today'))
    if opened is None:
        return
    H = 2400
    def text_y(st, needle):
        for nd in (st.root.iter('node') if st.root is not None else []):
            t = (nd.get('text') or nd.get('content-desc') or '')
            if nd.get('package') == V.PKG and needle.lower() in t.lower():
                x1, y1, x2, y2 = C.bounds(nd); return (y1 + y2) // 2
        return None
    for _ in range(5):
        y = text_y(st, 'SUN & MOON')
        if y is None or 0.22 * H <= y <= 0.45 * H:
            break
        dd = max(-600, min(600, int(y - 0.33 * H)))
        C.adb('shell', 'input', 'swipe', '540', str(int(0.6 * H)), '540', str(int(0.6 * H) - dd), '600')
        st = C.capture(1.2)
    V.check('fo3d-tab', V.tap_text(st, '3D', exact=True), 'tap the 3D tab')
    f0 = scroll_find('Open the 3D view full screen', 8)
    if f0 is not None:
        mid_screen(f0, 'Open the 3D view full screen')
    t0 = time.time(); ok = False; c = C.capture(2)
    for _ in range(40):
        if V.has(c, 'Looking '):
            ok = True; break
        c = C.capture(3)
    V.check('fo3d-ready', ok, f'drawn {time.time() - t0:.0f} s after the tab tap' if ok else 'no caption')
    if not ok:
        print('INFO fo3d on screen: ' + ' | '.join(x for x in c.all_texts if len(x.strip()) > 2)[:1500], flush=True); V.back(); return
    fg_label = 'Foreground (trees and buildings near you)'
    lab = None; t1 = time.time()
    for _ in range(60):
        c = C.capture(2)
        lab = next((x['label'] for x in c.clickables if fg_label in x['label']), None)
        if lab is None or ', showing' in lab or V.has(c, "foreground didn't load") or V.has(c, 'foreground was too heavy'):
            break
        time.sleep(2)
    V.check('fo3d-fg-in', lab is not None and ', showing' in lab, f'{(lab or "no Foreground button")[:80]} after {time.time() - t1:.0f} s')
    seen = []
    if V.find_scroll('About this view', 4):   # credits behind "About" since 13 Nov 2026
        time.sleep(1.5)
    for _ in range(3):
        seen += C.capture(1.2).all_texts
        C.adb('shell', 'input', 'swipe', '540', '1500', '540', '900', '500')
    V.check('fo3d-credit', seen_has(seen, 'Umhvørvisstovan'), 'Faroese agency credit line under the view')
    V.check('fo3d-alive', C.app_alive())
    print('INFO fo3d texts: ' + ' | '.join(x for x in seen if any(k in x for k in ('Looking', 'Foreground', 'Umhv', 'First sun', 'Smoothness', 'saved')))[:1200], flush=True)
    V.back(); time.sleep(2)


def move_photo_checks(d, tag):
    """"Move photo" on the see-through bar (Phil, 16 Nov 2026: zoom the photo to match the framing). On: the photo takes
    the touches (a drag over the picture must NOT turn the 3D view: same heading after), double tap = fit; off again.
    A real two-finger pinch can't be made with adb input, so only one-finger drag and the double tap are tried."""
    look = re.compile(r'Looking (\S+ \d+)°')
    def heading(st):
        return next((m.group(1) for t in st.all_texts for m in [look.search(t)] if m), None)
    def node(st):
        return next((n for n in (st.root.iter('node') if st.root is not None else [])
                     if n.get('package') == V.PKG and (n.get('content-desc') or '').startswith('Move photo')), None)
    n = node(d)
    V.check(f'{tag}-move-photo-btn', n is not None, 'Move photo toggle on the see-through bar')
    if n is None:
        print('INFO move photo: buttons ' + ' | '.join(c['label'][:30] for c in d.clickables)[:600], flush=True); return
    h0 = heading(d)
    x1, y1, x2, y2 = C.bounds(n); C.tap(((x1 + x2) // 2, (y1 + y2) // 2)); time.sleep(1.2)
    e = C.capture(1); n = node(e)
    on = n is not None and n.get('checked') == 'true'
    V.check(f'{tag}-move-photo-on', on, f'toggle on (checked {n.get("checked") if n is not None else None})')
    H = 2400
    # one finger over the picture (upper middle, clear of the buttons and the bar): moves the photo, not the view
    C.adb('shell', 'input', 'swipe', '300', str(int(0.30 * H)), '700', str(int(0.34 * H)), '400'); time.sleep(1.2)
    # double tap: back to fit
    C.adb('shell', 'input', 'tap', '540', str(int(0.30 * H))); time.sleep(0.12)
    C.adb('shell', 'input', 'tap', '540', str(int(0.30 * H))); time.sleep(1.2)
    f = C.capture(1); h1 = heading(f)
    V.show(f'{tag}-move-photo', f)
    V.check(f'{tag}-move-photo-drag', C.app_alive() and V.has(f, 'See-through amount') and h0 is not None and h1 == h0,
            f'after drag + double tap: bar still up, view heading {h0} -> {h1}')
    n = node(f)
    if n is not None:
        x1, y1, x2, y2 = C.bounds(n); C.tap(((x1 + x2) // 2, (y1 + y2) // 2)); time.sleep(1.2)
    g = C.capture(1); n = node(g)
    V.check(f'{tag}-move-photo-off', n is not None and n.get('checked') != 'true', 'toggle off again')
    cut_off(f'{tag}-move-photo', g)


def spot_open_3d_edit():
    """Your spot -> Open in 3D as an editing view (16 Nov 2026, branch claude/spot-open3d): the full screen has the stop's
    trip and stop, so walk mode, Save framing and the reference photo are there, and the photo card opens on the job's
    own photo. The job (T.A. Moulton Barn, 34a139a0) has no shot added: Save framing is tapped only to read its question
    ("added to this stop as a shot first") and CANCELLED; nothing is saved (fetchGuard would refuse it). Checks spot-3d-*."""
    def btn(st, label, exact=True):
        return next((c for c in st.clickables if ((c['label'].split(' | ')[0].strip().lower() == label.lower()) if exact else (label.lower() in c['label'].lower()))), None)
    t0 = time.time(); f = C.capture(1)
    while time.time() - t0 < 120 and btn(f, 'Walk mode: move your viewpoint') is None:
        time.sleep(4); f = C.capture(1)
    V.check('spot-3d-walk-btn', btn(f, 'Walk mode: move your viewpoint') is not None,
            f'walk button after {time.time() - t0:.0f} s' if btn(f, 'Walk mode: move your viewpoint') else 'no walk button in 120 s (view not drawn, or no trip / stop)')
    print('INFO spot-3d texts: ' + ' | '.join(t for t in f.all_texts if len(t.strip()) > 2)[:500], flush=True)
    H = 2400
    for _ in range(4):   # the framing row may sit below the fold of the short area under the picture
        if btn(f, 'Save framing for this shot', exact=False) is not None:
            break
        C.adb('shell', 'input', 'swipe', '540', str(int(0.80 * H)), '540', str(int(0.70 * H)), '500'); f = C.capture(1.2)
    # only enabled buttons are listed as clickables, so being there = enabled
    V.check('spot-3d-save-framing', btn(f, 'Save framing for this shot', exact=False) is not None, 'Save framing button enabled')
    line = next((t for t in f.all_texts if t.startswith(('Framing: ', 'Not a shot yet', 'Not framed yet', 'Framed '))), None)
    print(f'INFO spot-3d framing line: {line!r}', flush=True)
    V.check('spot-3d-aim', btn(f, 'Aim at subject') is not None, 'Aim at subject button')
    cut_off('spot-3d-edit', f)
    if V.tap_text(f, 'Save framing for this shot'):
        q = None
        for _ in range(5):
            q = C.capture(1.2)
            if V.has(q, 'Save this framing?'):
                break
        asked = q is not None and V.has(q, 'Save this framing?')
        V.check('spot-3d-save-asks', asked and V.has(q, 'added to this stop as a shot first') and V.has(q, 'practice'),
                'question says the shot is added first, real trip and practice copy' if asked else 'no "Save this framing?" question')
        if asked:
            print('INFO spot-3d framing question: ' + ' | '.join(t for t in q.all_texts if len(t) > 3)[:400], flush=True)
            cancelled = V.tap_text(q, 'Cancel', exact=True)
            time.sleep(1.5); a = C.capture(1)
            V.check('spot-3d-save-cancel', cancelled and not V.has(a, 'Save this framing?'), 'cancelled, nothing saved')
        else:
            V.back(); time.sleep(1)
    # Reference photo: the button, the card on the job's photo (1 of n), see-through, close
    f = C.capture(1)
    b = btn(f, 'Reference photo')
    V.check('spot-3d-refphoto-btn', b is not None, 'photo button in the full screen')
    if b is None:
        print('INFO spot-3d buttons: ' + ' | '.join(c['label'][:30] for c in f.clickables)[:600], flush=True); return
    C.tap(b['xy'])
    c = C.capture(1.2)
    for _ in range(5):
        if btn(c, 'Close reference photo', exact=False) is not None: break
        c = C.capture(1.2)
    count = next((t for t in c.all_texts if re.fullmatch(r'\d+ of \d+', t.strip())), None)
    V.check('spot-3d-refphoto-open', btn(c, 'Close reference photo', exact=False) is not None and (count is None or count.startswith('1 of')),
            f'card open on {count or "no n of m label"}')
    V.show('spot-3d-refphoto', c)
    card = btn(c, 'over the view', exact=False)
    if card is not None:
        C.tap(card['xy']); d = C.capture(1.5)
        for _ in range(4):
            if V.has(d, 'See-through amount'): break
            d = C.capture(1.2)
        V.check('spot-3d-refphoto-see', V.has(d, 'See-through amount') and V.has(d, 'Looking '), 'job photo see-through over the view, slider shown')
        V.show('spot-3d-refphoto-see', d)
        cut_off('spot-3d-refphoto-see', d)
        move_photo_checks(d, 'spot-3d')
        V.tap_text(d, 'Close see-through'); time.sleep(1.2)
    e = C.capture(1)
    b = btn(e, 'Reference photo')
    if btn(e, 'Close reference photo', exact=False) is not None and b is not None:
        C.tap(b['xy']); time.sleep(1.2); e = C.capture(1)
    V.check('spot-3d-refphoto-closed', btn(e, 'Close reference photo', exact=False) is None and btn(e, 'Close see-through', exact=False) is None
            and V.has(e, 'Looking ') and C.app_alive(), 'card and see-through closed, view still up')


def find_spot():
    """Find my spot (16 Nov 2026): the Find spot pill in the photo viewer, its progress card, and the Your spot screen
    for a job already done on Teton Live's T.A. Moulton Barn (job 34a139a0, photo 9ae511b2). Read only: a new request is
    answered by e2e/fetchGuard.ts with a made-up open job; Add as a shot is never pressed."""
    import json, urllib.request
    stop_id = 'ea39ff42-3f27-4838-b085-c288e475407c'
    try:
        req = urllib.request.Request(f'https://ohshrzlvvxyovcjmdajc.supabase.co/rest/v1/stops?id=eq.{stop_id}&select=time_label,days(date)',
                                     headers={'apikey': 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2'})
        row = json.load(urllib.request.urlopen(req, timeout=30))[0]
        d = datetime.date.fromisoformat(row['days']['date'])
    except Exception as e:
        V.check('spot-day', False, f'could not read the stop day: {e!r}'[:120]); return
    if open_live() is None:
        return
    tab = f"{d.strftime('%b')} {d.day}"
    s = C.capture(1); hit = False
    for _ in range(6):
        if V.tap_text(s, tab, exact=True):
            hit = True; break
        C.adb('shell', 'input', 'swipe', '900', '700', '200', '700', '300'); s = C.capture(0.8)
    V.check('spot-day-tab', hit, tab)
    if not hit: return
    time.sleep(3)
    rowre = re.compile(r'^\d{1,2}:\d{2} [AP]M .*T\.A\. Moulton Barn')
    s = C.capture(1.0); opened = False
    for _ in range(20):
        c = next((c for c in s.clickables if rowre.match(c['label'])), None)
        if c is not None and 0.30 * 1920 <= c['xy'][1] <= 0.72 * 1920:
            C.tap(c['xy']); opened = True; break
        if c is not None and c['xy'][1] < 0.30 * 1920:
            C.adb('shell', 'input', 'swipe', '540', '900', '540', '1200', '500')
        else:
            C.adb('shell', 'input', 'swipe', '540', '1300', '540', '950', '500')
        s = C.capture(1.2)
    V.check('spot-stop-open', opened, 'T.A. Moulton Barn from the day list')
    if not opened: return
    t = C.capture(4)
    if not V.tap_text(t, 'Open reference photos'):
        V.check('spot-viewer', False, 'no reference photo thumbnail'); return
    v = C.capture(3)
    def pill(st):
        return next((c['label'] for c in st.clickables if c['label'].split(' | ')[0].startswith(('Find spot', 'Your spot', 'Finding where'))), None)
    V.check('spot-pill', pill(v) is not None, (pill(v) or 'no Find spot pill in the viewer')[:80])
    V.show('spot-viewer', v)
    cut_off('spot-viewer', v)
    # Each photo of the stop in turn: a photo with no job gets a tap (progress card); then back to the done one.
    done_photo, progress = False, False
    for i in range(4):
        lab = pill(v) or ''
        print(f'INFO spot photo {i + 1}: pill {lab[:60]!r}', flush=True)
        if lab.startswith('Your spot'):
            done_photo = True
        if lab.startswith('Find spot: where') and not progress:
            V.tap_text(v, 'Find spot: where was this taken')
            w = C.capture(2.5)
            progress = V.has(w, 'Finding where you stood') and V.has(w, 'You can leave')
            V.check('spot-progress', progress, 'Finding where you stood card with its bar')
            V.show('spot-progress', w)
            cut_off('spot-progress', w)
        if done_photo and progress:
            break
        C.adb('shell', 'input', 'swipe', '950', '1150', '120', '1150', '250'); v = C.capture(2.5)
    if not progress:
        V.check('spot-progress', False, 'no photo without a job to tap')
    for _ in range(4):   # back toward the first photos until the done one shows
        if (pill(v) or '').startswith('Your spot'):
            done_photo = True; break
        C.adb('shell', 'input', 'swipe', '120', '1150', '950', '1150', '250'); v = C.capture(2.5)
    V.check('spot-done-photo', (pill(v) or '').startswith('Your spot'), 'the photo with a finished job shows Your spot')
    if not (pill(v) or '').startswith('Your spot'): return
    V.tap_text(v, 'Your spot: see where you stood')
    r = None
    for _ in range(10):
        r = C.capture(2)
        if V.has(r, 'WITH YOUR LENSES'): break
    ok = r is not None and V.has(r, 'Your spot') and V.has(r, 'EQUIVALENT') and V.has(r, 'WITH YOUR LENSES')
    V.check('spot-result', ok, 'Your spot screen with the 4x5 equivalent and the lens rows')
    V.show('spot-result', r)
    if not ok: return
    V.check('spot-confidence', V.has(r, 'CONFIDENCE') and (V.has(r, 'High') or V.has(r, 'Medium') or V.has(r, 'Low')), 'confidence tile')
    V.check('spot-best-fit', V.has(r, 'BEST FIT'), 'a lens row marked best fit')
    cut_off('spot-result', r)
    # The 3D picture of the chosen lens: its caption says it has drawn.
    t0 = time.time(); drawn = False
    while time.time() - t0 < 90:
        x = scroll_find('Looking ', 3)
        if x is not None: drawn = True; break
        time.sleep(5)
    V.check('spot-3d-preview', drawn, f'3D view drawn in {time.time() - t0:.0f} s' if drawn else 'no "Looking ..." caption in 90 s')
    V.show('spot-3d-preview', C.capture(1))
    scroll_top(3)
    r = C.capture(1)
    if V.tap_text(r, '135 millimetre'):
        time.sleep(4); V.show('spot-lens-135', C.capture(1))
    scroll_top(3)
    V.check('spot-add-btn', V.has(C.capture(1), 'Add as a shot'), 'Add as a shot button (not pressed)')
    if V.tap_text(C.capture(1), 'Open in 3D', exact=True):
        f = C.capture(4)
        has_close = any(c['label'].split(' | ')[0] == 'Close the 3D view' for c in f.clickables)
        V.check('spot-open-3d', has_close, 'full-screen 3D with its Close button')
        V.show('spot-open-3d', f)
        if has_close:
            spot_open_3d_edit()
            f = C.capture(1)
        cut_off('spot-open-3d', f)
        V.tap_text(f, 'Close the 3D view', exact=True); time.sleep(2)
    else:
        V.check('spot-open-3d', False, 'no Open in 3D button')
    V.show('spot-after-close', C.capture(1.5))
    print('INFO spot before back: ' + ' | '.join(l.strip() for l in (C.adb('shell', 'dumpsys', 'activity', 'activities') or '').splitlines() if 'mResumedActivity' in l or 'topResumedActivity' in l)[:400], flush=True)
    V.back(); time.sleep(2.5)
    print('INFO spot after back: ' + ' | '.join(t for t in C.capture(1.0).all_texts if len(t.strip()) > 1)[:400], flush=True)
    alive, focus = C.app_alive(), C.focus_pkg()
    V.check('spot-back', alive and focus == V.PKG, f'back from Your spot keeps the app open (alive {alive}, focus {focus})')


def main():
    sections = (find_spot, sun_3d, overhead_walk, stops_page, today_auto_open, side_by_side_card, plan_check_card, replan_now_card, ghost_accept, plans_tab, tell_t, tell_t_setup, faroes_3d, offline_3d)
    # E2E_ONLY = comma list of section names: the workflow runs the sections on several emulators at once (16 Nov 2026)
    only = [x.strip() for x in os.environ.get('E2E_ONLY', '').split(',') if x.strip()]
    if only:
        sections = tuple(st for st in sections if st.__name__ in only)
        print('INFO sections this emulator: ' + ', '.join(st.__name__ for st in sections), flush=True)
    for st in sections:
        # Every section starts on a fresh app (16 Nov 2026): one software-graphics freeze in 3D used to leave the app hung
        # and fail every later section with 'no Training trips row'. offline_3d makes its own fresh start.
        if st is not offline_3d:
            try:
                C.launch()
            except Exception as e:
                print(f'INFO relaunch before {st.__name__} failed: {e!r}', flush=True)
        try:
            st()
        except Exception as e:
            V.check(st.__name__, False, f'error {e!r}')
        if C.check_crash(st.__name__):
            V.check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
