"""Planner end to end on the test robot trip (Phil, 27 Nov 2026: "I don't wanna keep seeing that things don't work so
make sure it covers everything and edge cases").

The older planner checks run on Teton Live with every write blocked, so they could only see that a request left the
phone. Trip 7e57bed0-...-0004 ("Test robot") is the test's own practice copy of the Grand Teton trip on Teton Live's
dates, with its own planner T: e2e/fetchGuard.ts lets writes through for it only. Here the test really accepts T's
plan, really re-plans, really saves and removes a Tell T note, and then reads the server to see that it happened and
that the screen shows it. Faults (server error, timeout, no signal) are switched on through RPC e2e_fault, which only
the test build reads. Every section starts from e2e_prepare(): the robot trip back to the main trip's itinerary.

Whatever the time of day, each check has something to check: when today's stops are over, the card must say so and
offer no Re-plan for today, and Accept / chips are checked on tomorrow instead.
"""
import json, os, re, sys, time, datetime, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import crawl as C
import verify as V

ROBOT = '7e57bed0-0000-4000-8000-000000000004'
HOST = 'https://ohshrzlvvxyovcjmdajc.supabase.co'
KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2'
VERDICTS = ('Good bet', 'Long shot', 'Skip', 'Done, this time has passed', 'Done · this time has passed')
PREP = {}


# ---- server ------------------------------------------------------------------------------------------------
def _req(url, body=None, timeout=60):
    data = None if body is None else json.dumps(body).encode()
    rq = urllib.request.Request(url, data=data, method='POST' if body is not None else 'GET',
                                headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(rq, timeout=timeout) as r:
        t = r.read().decode()
        return json.loads(t) if t else None


def rpc(name, args=None):
    return _req(f'{HOST}/rest/v1/rpc/{name}', args or {})


def rest(path):
    return _req(f'{HOST}/rest/v1/{path}')


def prepare(tag):
    try:
        j = rpc('e2e_prepare')
        PREP.clear(); PREP.update(j or {})
        print(f"INFO robot prepare ({tag}): today {j.get('today')} {j.get('local_time')} {j.get('tz')}, rated stops today "
              f"{j.get('rated_stops_today')}, weather rows {j.get('weather_rows')}, sync {json.dumps(j.get('sync'))[:300]}", flush=True)
        return j
    except Exception as e:
        V.check(f'robot-prepare-{tag}', False, f'e2e_prepare failed: {e!r}'); return None


def fault(kind, match, secs=90):
    try:
        rpc('e2e_fault', {'p_kind': kind, 'p_match': match, 'p_secs': secs})
        time.sleep(5)   # the build polls every 2 s
        print(f'INFO fault on: {kind} {match} for {secs} s', flush=True)
    except Exception as e:
        print(f'INFO fault {kind} {match} could not be set: {e!r}', flush=True)


def faults_off():
    try: rpc('e2e_fault_clear'); time.sleep(4)
    except Exception as e: print(f'INFO faults_off failed {e!r}', flush=True)


def state():
    try: return rpc('e2e_state') or {}
    except Exception as e:
        print(f'INFO e2e_state failed {e!r}', flush=True); return {}


def robot_days():
    return rest(f'days?trip_id=eq.{ROBOT}&select=id,day_number,date&order=day_number') or []


def robot_stops():
    return rest(f'stops?trip_id=eq.{ROBOT}&select=id,day_id,position,name,time_label,shot_type&order=position') or []


def robot_tiers():
    ids = [s['id'] for s in robot_stops()]
    out = {}
    for i in range(0, len(ids), 40):
        part = ','.join(ids[i:i + 40])
        for r in rest(f'solver_stop_settings?stop_id=in.({part})&select=stop_id,tier') or []:
            out[r['stop_id']] = r['tier']
    return out


def robot_logs(word):
    return [l for l in V.logcat().splitlines() if word in l]


# ---- screen ------------------------------------------------------------------------------------------------
def open_robot():
    s = V.home()
    if not V.has(s, 'Training trips') and not V.find_scroll('Training trips'):
        V.check('robot-open', False, 'no Training trips row'); return None
    s = C.capture(1)
    if V.has(s, 'Training trips'):
        V.tap_text(s, 'Training trips')
    t = C.capture(3)
    if not V.tap_text(t, 'Test robot'):
        V.find_scroll('Test robot')
    p = None
    for _ in range(6):
        p = C.capture(2)
        if V.has(p, 'Open the Planner') or V.has(p, 'DAY '): break
    ok = p is not None and (V.has(p, 'Open the Planner') or V.has(p, 'DAY '))
    V.check('robot-open', ok, 'the robot trip page')
    return p if ok else None


def tab_for(date_str):
    d = datetime.date.fromisoformat(date_str)
    return f"{d.strftime('%b')} {d.day}"


def open_day(date_str, tag):
    want = tab_for(date_str)
    s = C.capture(1)
    for _ in range(5):
        if V.tap_text(s, want, exact=True):
            t = C.capture(4)
            V.check(f'robot-{tag}-tab', True, want); return t
        C.adb('shell', 'input', 'swipe', '900', '700', '200', '700', '300'); s = C.capture(0.8)
    V.check(f'robot-{tag}-tab', False, 'no tab ' + want); return None


def scroll_top(n=8):
    for _ in range(n):
        C.adb('shell', 'input', 'swipe', '540', '1000', '540', '1850', '250')
    time.sleep(1)


def find(needle, max_scrolls=12):
    s = C.capture(1)
    for _ in range(max_scrolls + 1):
        if V.has(s, needle): return s
        C.swipe_up(); s = C.capture(1)
    return None


def screen_h():
    try:
        m = re.search(r'(\d+)x(\d+)', C.adb('shell', 'wm', 'size') or '')
        return int(m.group(2)) if m else 2400
    except Exception:
        return 2400


def button(s, prefix):
    return next((c for c in s.clickables if c['label'].startswith(prefix) or prefix.lower() in c['label'].lower()), None)


def safe_tap(prefix, tag, tries=4):
    """Bring a clickable whose label holds prefix to the middle of the screen, check that Android gives it a real
    box (a box under the day tabs comes back upside down and swallows the tap: run 174), then tap it."""
    h = screen_h()
    s = C.capture(1)
    for _ in range(tries):
        b = button(s, prefix)
        if b is None:
            C.swipe_up(); s = C.capture(1); continue
        y = b['xy'][1]
        if 0.35 * h <= y <= 0.70 * h:
            time.sleep(1.5)   # let the list stop gliding
            s = C.capture(0.5); b = button(s, prefix) or b
            C.tap(b['xy'])
            print(f"INFO tapped {b['label'][:70]!r} at {b['xy']} ({tag})", flush=True)
            return b
        d = max(-600, min(600, int(y - 0.5 * h)))
        C.adb('shell', 'input', 'swipe', '540', str(int(0.6 * h)), '540', str(int(0.6 * h) - d), '600')
        s = C.capture(1.2)
    print(f'INFO no tappable {prefix!r} ({tag}): ' + ' | '.join(c["label"][:40] for c in s.clickables)[:900], flush=True)
    return None


def all_screen(scrolls=14):
    """Every app node's text and y, top to bottom over the whole day (absolute order by scroll step)."""
    scroll_top()
    out, seen_sig = [], set()
    for k in range(scrolls):
        s = C.capture(1)
        if s.sig in seen_sig and k > 0: break
        seen_sig.add(s.sig)
        for n in (s.root.iter('node') if s.root is not None else []):
            if n.get('package') != V.PKG: continue
            t = (n.get('text') or n.get('content-desc') or '').strip()
            if not t: continue
            x1, y1, x2, y2 = C.bounds(n)
            if y2 <= y1: continue
            out.append((k, y1, t))
        C.swipe_up()
    # de-duplicate: the same text at the same place on consecutive steps
    out.sort()
    return out


def day_choice():
    """Today while it still has a day card with something to do, else tomorrow. Returns (date, why)."""
    today = PREP.get('today')
    days = robot_days()
    dates = [d['date'] for d in days]
    if today not in dates:
        return (dates[0] if dates else None), 'today is not a trip day: the first day'
    return today, 'today'


# ---- checks ------------------------------------------------------------------------------------------------
def chips_check(tag):
    """Every rated stop on the open day's timeline shows T's chance line (or 'Done, this time has passed')."""
    rows = all_screen()
    stops = robot_stops(); tiers = robot_tiers()
    names = {s['name'] for s in stops if s.get('day_id') and tiers.get(s['id']) and s.get('shot_type') != 'logistics'}
    # walk the screen in order: a stop name opens a card, a verdict line before the next name belongs to it
    seq, cur = [], None
    TIME = re.compile(r'^\d{1,2}:\d\d\s?(AM|PM)\s', re.I)
    for k, y, t in rows:
        nm = next((n for n in names if TIME.match(t) and (t[TIME.match(t).end():] == n or t[TIME.match(t).end():].startswith(n + ','))), None)
        if nm:
            if cur is None or cur[0] != nm: cur = [nm, False]; seq.append(cur)
            continue
        if cur and t.startswith(VERDICTS): cur[1] = True
    shown = [n for n, _ in seq]
    missing = sorted({n for n, ok in seq if not ok} - {n for n, ok in seq if ok})
    print(f'INFO chips ({tag}): cards {shown}, without a chance line {missing}', flush=True)
    V.check(f'robot-chips-{tag}', bool(seq) and not missing,
            f'{len(seq)} rated stop cards, {len(missing)} without T\'s chance: {missing}' if seq else 'no rated stop card read on the day')
    V.check(f'robot-chips-{tag}-no-object-text', not any('[object Object]' in t for _, _, t in rows))
    return seq


def timeline_order_matches(day_id, tag):
    rows = all_screen()
    stops = [s for s in robot_stops() if s.get('day_id') == day_id]
    want = [s['name'] for s in sorted(stops, key=lambda s: s['position'])]
    got = []
    TIME = re.compile(r'^\d{1,2}:\d\d\s?(AM|PM)\s', re.I)
    for _, _, t in rows:
        m = TIME.match(t)
        nm = next((n for n in want if m and (t[m.end():] == n or t[m.end():].startswith(n + ','))), None)
        if nm and (not got or got[-1] != nm): got.append(nm)
    ok = [n for n in got if n in want] == [n for n in want if n in got] and len(set(got)) >= max(1, len(set(want)) - 1)
    V.check(f'robot-{tag}-order', ok, f'screen {got} vs server {want}')


# ---- sections ----------------------------------------------------------------------------------------------
def robot_chips():
    if not prepare('chips'): return
    date, why = day_choice()
    if open_robot() is None or date is None: return
    if open_day(date, 'chips') is None: return
    print(f'INFO chips day {date} ({why})', flush=True)
    s = C.capture(1)
    if V.has(s, "Today's stops are done"):
        V.check('robot-day-over-no-replan', not any(c['label'].startswith('Re-plan: Today') for c in s.clickables),
                "today is over: no 'today + rest' Re-plan on today's card")
    chips_check('day')
    # tomorrow too: a later day has its chips from the week plan
    days = [d['date'] for d in robot_days()]
    if date in days and days.index(date) + 1 < len(days):
        if open_day(days[days.index(date) + 1], 'chips-next') is not None:
            chips_check('next-day')
    V.check('robot-chips-alive', C.app_alive())


def robot_accept():
    if not prepare('accept'): return
    date, why = day_choice()
    if open_robot() is None or date is None: return
    days = robot_days()
    # the first day from the chosen one that has T changes to show
    for d in [x for x in days if x['date'] >= date][:3]:
        if open_day(d['date'], 'accept') is None: return
        scroll_top()
        if find("Show T's changes on the timeline", 6) or find("See what T leaves out", 2):
            break
    else:
        V.check('robot-accept-shown', None, 'T matches the itinerary on the next 3 days: nothing to accept'); return
    day_id = d['id']
    before = {s['id']: (s['day_id'], s['position'], s['time_label']) for s in robot_stops()}
    seen0 = {str(a['id']) for a in state().get('applies', [])}
    if not (safe_tap("Show T's changes on the timeline", 'accept') or safe_tap('See what T leaves out', 'accept')):
        V.check('robot-accept-shown', False, "the card's button could not be tapped"); return
    # the preview line ("N stops change over M days") must come, not a spinner for ever
    s = None
    for _ in range(15):
        s = C.capture(2)
        if any(re.search(r'\d+ stops change', t) for t in s.all_texts): break
    line = next((t for t in s.all_texts if re.search(r'\d+ stops change', t)), None)
    V.check('robot-accept-preview', line is not None, line or 'no preview line in 30 s')
    n_pre = int(re.search(r'(\d+) stops change', line).group(1)) if line else None
    # double tap Accept: must apply once
    b = button(s, "Accept T's plan for the rest of the trip")
    if b is None:
        V.check('robot-accept-button', False, ' | '.join(c['label'][:40] for c in s.clickables)[:600]); return
    C.tap(b['xy']); time.sleep(0.3); C.tap(b['xy'])
    alert = None
    for _ in range(30):
        a = C.capture(2)
        if V.has(a, 'Plan accepted') or V.has(a, 'Not applied'): alert = a; break
    V.check('robot-accept-result', alert is not None and V.has(alert, 'Plan accepted'),
            ' | '.join(alert.all_texts)[:300] if alert else 'no answer in 60 s')
    if alert: V.dialog_ok(); time.sleep(2)
    after = {s['id']: (s['day_id'], s['position'], s['time_label']) for s in robot_stops()}
    moved = sum(1 for k, v in after.items() if before.get(k) != v)
    new_applies = [a for a in state().get('applies', []) if str(a['id']) not in seen0]
    print(f'INFO accept: preview said {n_pre}, server moved {moved} stops, new applies {new_applies}', flush=True)
    V.check('robot-accept-server', moved > 0 or n_pre == 0, f'{moved} stops changed on the server (preview said {n_pre})')
    V.check('robot-accept-once', len(new_applies) <= 1,
            f'{len(new_applies)} applies after a double tap')
    # the screen follows the server, and the chips are still there (27 Nov: chips vanished after Accept)
    if open_day(d['date'], 'accept-after') is not None:
        timeline_order_matches(day_id, 'accept')
        chips_check('after-accept')
    # Accept again right away: nothing left to accept, said in words (never a crash or a raw error)
    scroll_top()
    if find("Show T's changes on the timeline", 4) and safe_tap("Show T's changes on the timeline", 'accept-again'):
        a2 = C.capture(6)
        V.check('robot-accept-again-no-object-text', not V.has(a2, '[object Object]'))
        V.back()
    V.check('robot-accept-alive', C.app_alive())
    r = prepare('accept-undo')   # the robot back to the itinerary: the reset must undo what Accept moved
    if r:
        back = {s['id']: (s['day_id'], s['position'], s['time_label']) for s in robot_stops()}
        diff = [k for k, v in before.items() if back.get(k) != v]
        extra = [k for k, v in back.items() if k not in before and v[0] is not None]
        V.check('robot-accept-reset', len(diff) <= 1 and not extra,
                f"after the reset {len(diff)} stops differ from before Accept, {len(extra)} extra visits still on a day")


def replan_button(s):
    return next((c for c in s.clickables if c['label'].startswith('Re-plan: ')), None)


def robot_replan():
    if not prepare('replan'): return
    date, why = day_choice()
    if open_robot() is None or date is None: return
    if open_day(date, 'replan') is None: return
    scroll_top()
    s = find('Re-plan: ', 8)
    if s is None:
        over = find("Today's stops are done", 2)
        V.check('robot-replan-shown', over is not None, "no Re-plan button and the card does not say today is over")
        return
    b = replan_button(s)
    mode = b['label'].split('.')[0] if b else '?'
    print(f'INFO replan mode: {mode}', flush=True)
    seen_runs = {r['id'] for r in state().get('runs', [])}
    sent0 = len(robot_logs('planner_t_replan_one'))
    t0 = time.time()
    b = safe_tap('Re-plan: ', 'replan')
    if b is None:
        V.check('robot-replan-tap', False, 'button never came to a tappable place'); return
    C.tap(b['xy'])   # a second, quick tap: must not start a second re-plan
    busy = None
    for _ in range(6):
        st = C.capture(1)
        if V.has(st, 'Re-planning') or V.has(st, 'Progress:') or V.has(st, 'T is re-planning'): busy = st; break
    V.check('robot-replan-busy-shown', busy is not None, 'the card shows it is working within ~10 s of the tap')
    sent = robot_logs('planner_t_replan_one')[sent0:]
    V.check('robot-replan-sent-once', len([l for l in sent if 'E2E_ROBOT' in l]) == 1, f'{len(sent)} requests after a double tap')
    # the result: a new T run (draft) for the robot on the server, and the card says it is done
    done = None
    for _ in range(36):   # up to 6 min
        time.sleep(10)
        runs = [r for r in state().get('runs', []) if r['id'] not in seen_runs and r.get('name') != 'app_T']
        # a draft replaced by a newer one is 'stopped' (one-pass restarts the rest-of-trip draft from today's new plan)
        if runs and all(r['status'] in ('done', 'error', 'stopped') for r in runs):
            done = runs; break
    secs = time.time() - t0
    print(f'INFO replan runs: {done} after {secs:.0f} s', flush=True)
    V.check('robot-replan-time', done is not None and secs < 240, f'whole re-plan (today + rest of trip) took {secs:.0f} s (aim: under 4 min)')
    V.check('robot-replan-server', bool(done) and done[-1]['status'] == 'done' and not any(r['status'] == 'error' for r in done),
            f"{len(done or [])} new T runs, statuses {[r['status'] for r in done or []]}" if done else 'no new T run finished in 6 min')
    st = C.capture(2)
    V.check('robot-replan-idle-again', replan_button(st) is not None or find('Re-plan: ', 4) is not None, 'the button is back after the re-plan')
    V.check('robot-replan-no-object-text', not V.has(C.capture(1), '[object Object]'))
    V.check('robot-replan-alive', C.app_alive())


def robot_replan_restart():
    """Tap Re-plan, kill the app at once, start it again: the card must pick the re-plan up (it is remembered)."""
    if not prepare('restart'): return
    date, _ = day_choice()
    if open_robot() is None or date is None: return
    if open_day(date, 'restart') is None: return
    scroll_top()
    if find('Re-plan: ', 8) is None:
        V.check('robot-restart-shown', None, 'no Re-plan button on this day (day over)'); return
    if safe_tap('Re-plan: ', 'restart') is None:
        V.check('robot-restart-tap', False, 'not tappable'); return
    time.sleep(2)
    C.adb('shell', 'am', 'force-stop', V.PKG); time.sleep(2)
    if open_robot() is None or open_day(date, 'restart-again') is None: return
    seen = None
    for _ in range(20):
        st = C.capture(3)
        txt = ' | '.join(st.all_texts)
        if re.search(r'Re-planning|T is re-planning|re-planned|Progress:|Updated|done', txt, re.I): seen = txt; break
        scroll_top(2); find('Re-plan: ', 3)
    V.check('robot-restart-picked-up', seen is not None, (seen or 'nothing about the re-plan after the restart')[:300])
    V.check('robot-restart-alive', C.app_alive())


def robot_faults():
    if not prepare('faults'): return
    date, _ = day_choice()
    # 1. server error on the Re-plan call: said in words, the button comes back
    fault('error', 'planner_t_replan_one', 120)
    try:
        if open_robot() is not None and open_day(date, 'fault-error') is not None:
            scroll_top()
            if find('Re-plan: ', 8) and safe_tap('Re-plan: ', 'fault-error'):
                st = None
                for _ in range(10):
                    st = C.capture(2)
                    if replan_button(st) and not V.has(st, 'Re-planning'): break
                txt = ' | '.join(st.all_texts) if st else ''
                V.check('robot-fault-error-words', 'test fault' in txt.lower() or 'could not' in txt.lower() or 'error' in txt.lower(),
                        'an error line on the card: ' + next((t for t in (st.all_texts if st else []) if 'fault' in t.lower() or 'error' in t.lower()), 'none'))
                V.check('robot-fault-error-no-object-text', '[object Object]' not in txt)
                V.check('robot-fault-error-button-back', st is not None and replan_button(st) is not None, 'Re-plan can be tapped again')
            else:
                V.check('robot-fault-error-words', None, 'no Re-plan on this day')
    finally:
        faults_off()
    # 2. Accept's preview hangs: the bar must not spin for ever
    fault('timeout', 'apply_week', 150)
    try:
        if open_robot() is not None and open_day(date, 'fault-timeout') is not None:
            scroll_top()
            if find("Show T's changes on the timeline", 6) and safe_tap("Show T's changes on the timeline", 'fault-timeout'):
                st = None; t0 = time.time()
                while time.time() - t0 < 45:
                    st = C.capture(3)
                    if any(re.search(r'\d+ stops change|could not|not reach|timed out|try again|error', t, re.I) for t in st.all_texts): break
                txt = ' | '.join(st.all_texts) if st else ''
                V.check('robot-fault-timeout-not-stuck', bool(re.search(r'could not|not reach|timed out|try again|error', txt, re.I)),
                        f'after {time.time() - t0:.0f} s: ' + txt[:300])
                V.back()
            else:
                V.check('robot-fault-timeout-not-stuck', None, "no T changes to show on this day")
    finally:
        faults_off()
    # 3. no signal at all: the day still shows from the phone, Re-plan says why it can't
    if open_robot() is None or open_day(date, 'offline') is None: return
    V.net(False)
    try:
        C.adb('shell', 'am', 'force-stop', V.PKG); time.sleep(2)
        p = open_robot()
        if p is not None and open_day(date, 'offline-day') is not None:
            seq = chips_check('offline')
            scroll_top()
            b0 = find('Re-plan: ', 8)
            if b0 is not None:
                print('INFO offline before tap: ' + ' | '.join(t for t in b0.all_texts if re.search(r'plan|Progress', t, re.I))[:800]
                      + ' / clickable: ' + ' | '.join(c['label'][:50] for c in b0.clickables if 'plan' in c['label'].lower()), flush=True)
            if b0 is not None and safe_tap('Re-plan: ', 'offline'):
                st = None
                for _ in range(15):
                    st = C.capture(2)
                    if any(re.search(r'signal|offline|network|could not|not reach', t, re.I) for t in st.all_texts): break
                txt = ' | '.join(st.all_texts) if st else ''
                if not re.search(r'signal|offline|network|could not|not reach', txt, re.I):
                    C.adb('shell', 'input', 'swipe', '540', '900', '540', '1500', '400'); st2 = C.capture(1.5)
                    txt += ' | ' + ' | '.join(st2.all_texts)
                    print('INFO offline log: ' + ' || '.join(l[-160:] for l in V.logcat().splitlines()
                          if re.search(r'E2E_|Re-plan|replan|Network|abort', l))[-2500:], flush=True)
                V.check('robot-offline-replan-says-why', bool(re.search(r'signal|offline|network|could not|not reach', txt, re.I)), txt[:300])
                V.check('robot-offline-no-object-text', '[object Object]' not in txt)
    finally:
        V.net(True)
    V.check('robot-faults-alive', C.app_alive())


def robot_tell():
    if not prepare('tell'): return
    date, _ = day_choice()
    if open_robot() is None or open_day(date, 'tell') is None: return
    scroll_top()
    if not find('Tell T about this day', 8) or not safe_tap('Tell T about this day', 'tell'):
        V.check('robot-tell-open', False, 'no Tell T button'); return
    sh = C.capture(2.5)
    V.check('robot-tell-open', V.has(sh, 'Send the note to T') or V.has(sh, 'Send to T'))
    V.tap_text(sh, 'Your note for T'); time.sleep(1)
    C.adb('shell', 'input', 'text', 'Tomorrow%sback%sat%sthe%shotel%sby%s4%sPM')
    time.sleep(1)
    s = C.capture(1)
    V.tap_text(s, 'Send the note to T') or V.tap_text(s, 'Send to T')
    pv = None
    for _ in range(25):
        pv = C.capture(2)
        if V.has(pv, 'Looks right'): break
    V.check('robot-tell-preview', pv is not None and V.has(pv, 'Looks right'), ' | '.join(pv.all_texts)[:300] if pv else '')
    if not (pv and V.tap_text(pv, 'Looks right: tell T to go by this note')) and not (pv and V.tap_text(pv, 'Looks right')):
        return
    note = None
    for _ in range(30):
        time.sleep(3)
        rows = rest(f't_notes?trip_id=eq.{ROBOT}&status=eq.active&select=id,text,status') or []
        if rows: note = rows[0]; break
    V.check('robot-tell-saved', note is not None, f'note on the server: {note}')
    # the sheet closes, the note shows on the card, and T re-plans (a new robot run)
    for _ in range(8):
        st = C.capture(2)
        if not (V.has(st, 'Close Tell T') or V.has(st, 'Send the note to T') or V.has(st, 'Looks right')): break
        if not V.tap_text(st, 'Close Tell T'): V.back()
    st = None
    for _ in range(4):   # the card refreshes its notes after the sheet closes: give it a few tries
        scroll_top()
        st = find('YOUR NOTES FOR T', 8)
        if st is not None: break
        time.sleep(5)
    if st is None:
        rows = all_screen(8)
        print('INFO card after the note: ' + ' | '.join(t for _, _, t in rows if 'note' in t.lower() or 'T' in t[:2])[:1500], flush=True)
    V.check('robot-tell-on-card', st is not None, 'the note is listed on the card')
    if st is None or note is None: return
    rm = next((c for c in st.clickables if c['label'].startswith('Remove the note')), None)
    if rm is None:
        V.check('robot-tell-remove', False, 'no remove button'); return
    C.tap(rm['xy']); time.sleep(1.5)
    a = C.capture(1)
    V.tap_text(a, 'Remove', exact=True) or V.tap_text(a, 'REMOVE', exact=True) or V.dialog_ok()
    gone = False
    for _ in range(15):
        time.sleep(3)
        rows = rest(f't_notes?id=eq.{note["id"]}&select=status') or []
        if rows and rows[0]['status'] == 'cleared': gone = True; break
    V.check('robot-tell-removed', gone, 'the note is cleared on the server')
    V.check('robot-tell-no-object-text', not V.has(C.capture(1), '[object Object]'))
    V.check('robot-tell-alive', C.app_alive())


SECTIONS = (robot_chips, robot_accept, robot_replan, robot_replan_restart, robot_tell, robot_faults)
