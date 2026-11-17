import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, View } from 'react-native';

// "Is this part of the page on (or nearly on) the screen yet?" (16 Nov 2026). The stop page's Sun & Moon section opens
// on its 3D tab, but the 3D view (a WebGL web view) must not start the moment the stop page opens: on a slow phone (and
// on the test emulator's software graphics) drawing it while the page is still coming up froze the app. So the inline
// 3D view starts only once the section has been scrolled to within a quarter screen of the bottom edge, and then stays.
// The page's scroll view calls pingNearView() on scroll; each waiting part measures itself then.

// 17 Nov 2026 (Phil: "when I scroll it buffers"): the 3D view also waits until the scrolling has stopped (0.7 s quiet)
// and the section is well on screen, so it never starts loading while the page is moving.
const subs = new Set<() => void>();
const QUIET_MS = 700;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
export function pingNearView(): void {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => { quietTimer = null; subs.forEach(f => { try { f(); } catch { /* a part gone */ } }); }, QUIET_MS);
}

type Box = React.ComponentRef<typeof View>;
export function useNearView(): { ref: React.RefObject<Box | null>; near: boolean; onLayout: () => void; start: () => void } {
  const ref = useRef<Box | null>(null);
  const [near, setNear] = useState(false);
  const check = useCallback(() => {
    ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const H = Dimensions.get('window').height;
      if (quietTimer) return;   // still scrolling: the settle check comes after
      if (h > 0 && y < H * 0.8 && y + h > H * 0.15) setNear(true);
    });
  }, []);
  useEffect(() => {
    if (near) return;
    subs.add(check);
    const t = setTimeout(check, 900);   // a page opened already scrolled down (or a short page) has no scroll to wait for
    return () => { subs.delete(check); clearTimeout(t); };
  }, [near, check]);
  const start = useCallback(() => setNear(true), []);   // a tap on the placeholder starts it at once
  return { ref, near, onLayout: check, start };
}
