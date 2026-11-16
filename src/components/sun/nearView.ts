import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, View } from 'react-native';

// "Is this part of the page on (or nearly on) the screen yet?" (16 Nov 2026). The stop page's Sun & Moon section opens
// on its 3D tab, but the 3D view (a WebGL web view) must not start the moment the stop page opens: on a slow phone (and
// on the test emulator's software graphics) drawing it while the page is still coming up froze the app. So the inline
// 3D view starts only once the section has been scrolled to within a quarter screen of the bottom edge, and then stays.
// The page's scroll view calls pingNearView() on scroll; each waiting part measures itself then.

const subs = new Set<() => void>();
export function pingNearView(): void { subs.forEach(f => { try { f(); } catch { /* a part gone */ } }); }

type Box = React.ComponentRef<typeof View>;
export function useNearView(): { ref: React.RefObject<Box | null>; near: boolean; onLayout: () => void } {
  const ref = useRef<Box | null>(null);
  const [near, setNear] = useState(false);
  const check = useCallback(() => {
    ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const H = Dimensions.get('window').height;
      if (h > 0 && y < H * 1.25 && y + h > -H) setNear(true);
    });
  }, []);
  useEffect(() => {
    if (near) return;
    subs.add(check);
    const t = setTimeout(check, 400);   // a page opened already scrolled down (or a short page) has no scroll to wait for
    return () => { subs.delete(check); clearTimeout(t); };
  }, [near, check]);
  return { ref, near, onLayout: check };
}
