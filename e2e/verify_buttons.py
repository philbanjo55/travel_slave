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
    t = C.capture(2); ok = False; why = ''
    for _ in range(40):   # the first time it downloads the terrain (2 MB), then draws
        if V.has(t, 'Looking '):
            ok = True; break
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
        time.sleep(6)
        seen, _ = V.texts_all(2)
        V.check('sun3d-moments', seen_has(seen, 'First sun on') and seen_has(seen, 'Sun reaches you'), 'first / last light chips')
        V.check('sun3d-status', seen_has(seen, 'You: '), 'in the sun / in shade line')
        V.check('sun3d-no-object-text', not seen_has(seen, '[object Object]') and not seen_has(seen, 'undefined'))
        line = next((x for x in seen if '3D terrain' in x), None)
        V.check('sun3d-saved-line', line is not None, (line or 'no "3D terrain saved for this trip" line')[:110])
        f = scroll_find('Looking ', 6)
        if f is not None and V.tap_text(f, 'Open the 3D view full screen'):
            g = C.capture(5)
            V.show('sun3d-full', g)
            V.check('sun3d-full-open', V.has(g, 'Close'), 'full screen with Close')
            V.back(); time.sleep(1.5)
        else:
            V.check('sun3d-full-open', False, 'no full-screen button')
    V.check('sun3d-alive', C.app_alive())


def main():
    for st in (sun_3d, today_auto_open, side_by_side_card, plan_check_card, replan_now_card, ghost_accept, plans_tab, tell_t, tell_t_setup):
        try:
            st()
        except Exception as e:
            V.check(st.__name__, False, f'error {e!r}')
        if C.check_crash(st.__name__):
            V.check(st.__name__ + '-crash', False, 'app died')
    print('SUMMARY ' + ' '.join(f'{n}={t}' for n, t, _ in V.results), flush=True)


if __name__ == '__main__':
    main()
