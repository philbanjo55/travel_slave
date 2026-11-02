#!/usr/bin/env python3
"""Tap-through crawler for the Philm+Frame TEST app on an Android emulator.

Read-only test: the build it drives has e2e/fetchGuard.ts, which blocks every
Supabase write. On top of that, buttons whose label looks like a write
(delete, save, tick, plan again ...) are never tapped; they are listed instead.

For every screen it reaches it saves a screenshot and the view tree, taps each
button top to bottom (scrolling down the screen), and records what happened:
new screen, change in place, dialog, left the app, crash, or no visible change.
Output: out/report.json, out/shots/*.png, out/xml/*.xml.
"""
import hashlib, json, os, re, subprocess, sys, time
import xml.etree.ElementTree as ET

PKG = os.environ.get('APP_PKG', 'com.philmframe.app.test')
OUT = os.environ.get('OUT', 'out')
TOTAL_MIN = float(os.environ.get('CRAWL_MINUTES', '110'))
MAX_DEPTH = int(os.environ.get('MAX_DEPTH', '5'))
MAX_SCROLLS = int(os.environ.get('MAX_SCROLLS', '6'))
MAX_TAPS_PER_SCREEN = int(os.environ.get('MAX_TAPS', '40'))
# On the trip list, only open trips whose row mentions one of these.
ROOT_FOCUS = [w.strip().lower() for w in os.environ.get('ROOT_FOCUS', 'faroes,teton,test').split(',') if w.strip()]

DENY = re.compile(
    r'\b(delete|remove|archive|unarchive|restore|save|saved|apply|confirm|nailed|missed it|go back for better|'
    r'plan again|replan|re-plan|upload|import|add photo|add photos|choose photo|take photo|camera roll|'
    r'migrate|label|tick|untick|done|mark|reset|clear|send|publish|use this|set as|link|unlink|'
    r'accept|accept all|plan \d+ days?|plan this day|plan day|enable nightly|disable nightly|nightly brief|recalculate|calculate drive|pull weather|refresh weather)\b', re.I)

os.makedirs(f'{OUT}/shots', exist_ok=True)
os.makedirs(f'{OUT}/xml', exist_ok=True)
START = time.time()
DEADLINE = START + TOTAL_MIN * 60
report = {'screens': [], 'events': [], 'skipped': [], 'crashes': []}
visited = set()
shot_n = [0]


def log(*a):
    print(f'[{time.time() - START:7.1f}s]', *a, flush=True)


def adb(*args, timeout=30, binary=False):
    r = subprocess.run(['adb', *args], capture_output=True, timeout=timeout)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def focus_pkg():
    out = adb('shell', 'dumpsys', 'window')
    m = re.search(r'mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^/ }]+)', out)
    return m.group(1) if m else ''


def app_alive():
    return adb('shell', 'pidof', PKG).strip() != ''


def dump():
    for _ in range(6):
        adb('shell', 'rm', '-f', '/sdcard/w.xml')
        out = adb('shell', 'uiautomator', 'dump', '/sdcard/w.xml', timeout=40)
        if 'dumped' in out:
            raw = adb('exec-out', 'cat', '/sdcard/w.xml', binary=True)
            try:
                return ET.fromstring(raw)
            except ET.ParseError:
                pass
        time.sleep(1.5)
    return None


def bounds(n):
    m = re.findall(r'\d+', n.get('bounds', '[0,0][0,0]'))
    x1, y1, x2, y2 = map(int, m)
    return x1, y1, x2, y2


def texts(node):
    out = []
    for n in node.iter():
        t = (n.get('text') or n.get('content-desc') or '').strip()
        if t:
            out.append(t)
    return out


def norm(t):
    return re.sub(r'\d+', '#', t)


class State:
    def __init__(self, root):
        self.root = root
        app_nodes = [n for n in root.iter('node') if n.get('package') == PKG] if root is not None else []
        self.all_texts = [t for n in app_nodes for t in [(n.get('text') or n.get('content-desc') or '').strip()] if t]
        self.textset = set(norm(t) for t in self.all_texts)
        self.sig = hashlib.sha1('\n'.join(sorted(self.textset)).encode()).hexdigest()[:12]
        self.dialog = any((n.get('resource-id') or '').startswith('android:id/') and
                          (n.get('resource-id') or '').endswith(('alertTitle', 'message', 'button1'))
                          for n in app_nodes)
        self.clickables = []
        self.inputs = []
        for n in app_nodes:
            cls = n.get('class', '')
            x1, y1, x2, y2 = bounds(n)
            if x2 - x1 < 8 or y2 - y1 < 8:
                continue
            if 'EditText' in cls:
                self.inputs.append({'label': (n.get('text') or n.get('hint') or '').strip()[:60],
                                    'xy': ((x1 + x2) // 2, (y1 + y2) // 2)})
            elif n.get('clickable') == 'true' and n.get('enabled') == 'true':
                lab = ' | '.join(texts(n))[:90] or n.get('resource-id') or f'<unlabelled {cls.split(".")[-1]}>'
                self.clickables.append({'label': lab, 'xy': ((x1 + x2) // 2, (y1 + y2) // 2), 'y': y1})
        self.clickables.sort(key=lambda c: (c['y'], c['xy'][0]))


def similarity(a, b):
    if not a.textset and not b.textset:
        return 1.0
    return len(a.textset & b.textset) / max(1, len(a.textset | b.textset))


def screenshot(tag):
    shot_n[0] += 1
    name = f'{shot_n[0]:04d}_{re.sub(r"[^A-Za-z0-9]+", "-", tag)[:50]}'
    png = adb('exec-out', 'screencap', '-p', binary=True)
    with open(f'{OUT}/shots/{name}.png', 'wb') as f:
        f.write(png)
    return name


def save_xml(name, root):
    if root is not None:
        ET.ElementTree(root).write(f'{OUT}/xml/{name}.xml', encoding='utf-8')


def capture(settle=2.0):
    time.sleep(settle)
    return State(dump())


def launch():
    adb('shell', 'am', 'force-stop', PKG)
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
    time.sleep(12)
    return capture(2)


def swipe_up():
    adb('shell', 'input', 'swipe', '540', '1700', '540', '750', '450')


def tap(xy):
    adb('shell', 'input', 'tap', str(xy[0]), str(xy[1]))


def find_and_tap(label, scrolls):
    for _ in range(scrolls):
        swipe_up()
        time.sleep(0.8)
    s = capture(1.0)
    for c in s.clickables:
        if c['label'] == label:
            tap(c['xy'])
            return True
    return False


def replay(path):
    """Relaunch and redo the taps that led to the screen. Returns its State."""
    log('  replay', [p[1][:30] for p in path])
    s = launch()
    for scrolls, label in path:
        if not find_and_tap(label, scrolls):
            log('  replay failed at', label)
            return None
        s = capture(2.5)
    return s


def restore(before, path, scrolls):
    """Get back to `before` (same screen, same scroll)."""
    for _ in range(2):
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        s = capture(1.5)
        if focus_pkg() == PKG and similarity(s, before) > 0.6:
            return s
        if focus_pkg() != PKG:
            break
    s = replay(path)
    if s is None:
        return None
    for _ in range(scrolls):
        swipe_up()
        time.sleep(0.8)
    return capture(1.0)


def check_crash(where):
    if not app_alive():
        log('  CRASH after', where)
        crash = adb('logcat', '-d', '-b', 'crash', timeout=60)[-6000:]
        js = adb('logcat', '-d', '-s', 'ReactNativeJS:E', 'ReactNative:E', 'AndroidRuntime:E', timeout=60)[-6000:]
        report['crashes'].append({'after': where, 'crash_log': crash, 'js_log': js})
        adb('logcat', '-c')
        return True
    return False


def explore(path, depth, deadline, came_from):
    if time.time() > min(deadline, DEADLINE):
        return
    s = capture(1.0)
    if s.sig in visited:
        return
    visited.add(s.sig)
    name = screenshot('screen-' + (came_from or 'start'))
    save_xml(name, s.root)
    entry = {'shot': name, 'depth': depth, 'path': [p[1] for p in path], 'texts': s.all_texts[:80],
             'inputs': [i['label'] for i in s.inputs], 'taps': []}
    report['screens'].append(entry)
    log(f'SCREEN d{depth} {name} ({len(s.clickables)} buttons)')

    # Type into inputs (calculators etc.). Writes are blocked by the guard.
    for inp in s.inputs[:4]:
        tap(inp['xy']); time.sleep(0.5)
        adb('shell', 'input', 'text', '12')
        adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER')
        t = capture(1.5)
        n2 = screenshot(f'typed-{inp["label"] or "field"}')
        entry['taps'].append({'label': f'[typed 12 into] {inp["label"]}', 'result': 'typed', 'shot': n2,
                              'new_texts': sorted(set(t.all_texts) - set(s.all_texts))[:20]})
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')  # hide keyboard
        time.sleep(0.5)
    if s.inputs:
        s = restore(s, path, 0) or s

    tapped = set()
    taps = 0
    for scrolls in range(MAX_SCROLLS + 1):
        if scrolls:
            prev = s
            swipe_up()
            s = capture(1.0)
            if s.sig == prev.sig:
                break
        todo = [c for c in s.clickables if c['label'] not in tapped]
        for c in todo:
            now = time.time()
            if now > min(deadline, DEADLINE) or taps >= MAX_TAPS_PER_SCREEN:
                return
            tapped.add(c['label'])
            lab = c['label']
            if DENY.search(lab):
                report['skipped'].append({'screen': name, 'label': lab})
                continue
            if depth == 0 and ('—' in lab or ' - ' in lab) and not any(k in lab.lower() for k in ROOT_FOCUS):
                report['skipped'].append({'screen': name, 'label': lab, 'why': 'trip not in focus'})
                continue
            taps += 1
            before = s
            tap(c['xy'])
            after = capture(2.5)
            pkg = focus_pkg()
            rec = {'label': lab, 'scroll': scrolls}
            if check_crash(f'{name} > {lab}'):
                rec['result'] = 'CRASH'
                entry['taps'].append(rec)
                s = replay(path) or launch()
                for _ in range(scrolls):
                    swipe_up(); time.sleep(0.8)
                s = capture(1.0)
                continue
            if pkg != PKG:
                rec['result'] = f'left app -> {pkg}'
                rec['shot'] = screenshot(f'left-{lab}')
                entry['taps'].append(rec)
                s = restore(before, path, scrolls) or before
                continue
            if after.sig == before.sig:
                rec['result'] = 'no visible change'
                entry['taps'].append(rec)
                continue
            if after.dialog:
                rec['result'] = 'dialog'
                rec['dialog'] = after.all_texts[:20]
                rec['shot'] = screenshot(f'dialog-{lab}')
                entry['taps'].append(rec)
                adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
                s = capture(1.0)
                if similarity(s, before) < 0.6:
                    s = restore(before, path, scrolls) or before
                continue
            sim = similarity(after, before)
            rec['result'] = 'changed in place' if sim > 0.5 else 'new screen'
            rec['similarity'] = round(sim, 2)
            rec['new_texts'] = sorted(set(after.all_texts) - set(before.all_texts))[:25]
            entry['taps'].append(rec)
            left = max(1, len([x for x in s.clickables if x['label'] not in tapped]) + 1)
            child_deadline = time.time() + (min(deadline, DEADLINE) - time.time()) / left
            if depth < MAX_DEPTH and after.sig not in visited:
                explore(path + [(scrolls, lab)], depth + 1, child_deadline, lab)
            s = restore(before, path, scrolls)
            if s is None:
                log('  could not get back; stopping this screen')
                return


def main():
    adb('logcat', '-c')
    s = launch()
    if focus_pkg() != PKG:
        log('app did not open; focus is', focus_pkg())
    if check_crash('launch'):
        s = launch()
    try:
        explore([], 0, DEADLINE, None)
    finally:
        report['elapsed_min'] = round((time.time() - START) / 60, 1)
        report['screens_seen'] = len(report['screens'])
        with open(f'{OUT}/report.json', 'w') as f:
            json.dump(report, f, indent=1, ensure_ascii=False)
        log('done', report['screens_seen'], 'screens,', len(report['crashes']), 'crashes')


if __name__ == '__main__':
    main()
