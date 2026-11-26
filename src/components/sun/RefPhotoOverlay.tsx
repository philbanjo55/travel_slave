import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPhotoUri } from '../../services/photoCache';

// The stop's reference photo inside the full-screen 3D view (Phil, 15 Nov 2026, mockup "photo button / see-through"):
// a small card in the top-right corner, and on a tap the photo laid see-through over the whole picture with an
// opacity slider. Everything here sits over the web view and never touches it, so the view, heading, lens and walk
// position stay exactly as they are. The photos are the stop page's own list (reference first, then field; on a
// practice trip the real trip's borrowed ones too) and come from the phone's photo store when saved there, so they
// show with no signal.

export type RefPhoto = { id?: string | null; storage_url?: string | null; base64_data?: string | null };

export function useRefPhotoUri(photo: RefPhoto | null | undefined): string {
  const [uri, setUri] = useState('');
  const id = photo?.id ?? null, url = photo?.storage_url ?? null;
  useEffect(() => {
    let alive = true;
    setUri('');
    if (!photo) return;
    getPhotoUri(photo).then(u => { if (alive && u) setUri(u); }).catch(() => {});
    return () => { alive = false; };
  // the photo is known by its id and address; a new array of the same photos is not a reason to read it again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, url]);
  return uri;
}

const CARD_W = 104, CARD_H = 133, X_OUT = 9;   // the X sits half outside the card's corner, inside this view's own box

// The small card: the photo, "1 of 2", arrows (and a sideways swipe) for the next one, an X. A tap shows it see-through.
export function RefPhotoCard({ photos, index, onIndex, onSee, onClose, top }: {
  photos: RefPhoto[]; index: number; onIndex: (i: number) => void; onSee: () => void; onClose: () => void; top: number;
}) {
  const n = photos.length;
  const uri = useRefPhotoUri(photos[index]);
  const cb = useRef({ index, n, onIndex });
  cb.current = { index, n, onIndex };
  // A sideways swipe over the card steps through the photos; a plain tap goes to the photo's own button (see-through).
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => cb.current.n > 1 && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_e, g) => {
      const c = cb.current;
      if (Math.abs(g.dx) > 24 && c.n > 1) c.onIndex((c.index + (g.dx < 0 ? 1 : -1) + c.n) % c.n);
    },
  })).current;
  const step = (d: number) => onIndex((index + d + n) % n);
  return (
    <View style={[styles.cardWrap, { top }]} pointerEvents="box-none">
      <View style={styles.card} {...swipe.panHandlers}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onSee}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={`See photo ${index + 1} of ${n} over the view`}
        >
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        </TouchableOpacity>
        {n > 1 ? (
          <>
            <TouchableOpacity onPress={() => step(-1)} style={[styles.arrow, styles.arrowLeft]} accessibilityRole="button" accessibilityLabel="Previous reference photo" hitSlop={4}>
              <Ionicons name="chevron-back" size={16} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => step(1)} style={[styles.arrow, styles.arrowRight]} accessibilityRole="button" accessibilityLabel="Next reference photo" hitSlop={4}>
              <Ionicons name="chevron-forward" size={16} color="#ffffff" />
            </TouchableOpacity>
          </>
        ) : null}
        {n > 1 ? (
          <View style={styles.count} pointerEvents="none">
            <Text style={styles.countText}>{index + 1} of {n}</Text>
          </View>
        ) : null}
      </View>
      <TouchableOpacity onPress={onClose} style={styles.x} accessibilityRole="button" accessibilityLabel="Close reference photo" hitSlop={8}>
        <Ionicons name="close" size={14} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

// Where the photo sits over the picture: scale and offset (dp) from "fit" (Phil, 16 Nov 2026: zoom the photo in and out
// to match it to his framing). Kept by the 3D panel while the photo or lens changes; reset when the photo is closed.
export type PhotoXf = { s: number; x: number; y: number };
export const XF0: PhotoXf = { s: 1, x: 0, y: 0 };
const S_MIN = 0.3, S_MAX = 4;
const clampS = (v: number) => Math.max(S_MIN, Math.min(S_MAX, v));
type Pt = [number, number];

// The photo over the whole picture, see-through. Touches go through it to the view underneath (drag to look still works),
// except with "Move photo" on: then two fingers pinch the photo larger or smaller around the pinch, one finger moves
// it, and a double tap puts it back to fit. PanResponder only (no native module). The transform lives here while the
// fingers move (only this small view redraws) and is handed to the panel when they lift.
export function RefPhotoGhost({ photo, opacity, xf = XF0, move = false, onXf, onSize }: {
  photo: RefPhoto; opacity: number; xf?: PhotoXf; move?: boolean; onXf?: (xf: PhotoXf) => void;
  onSize?: (w: number, h: number) => void;   // the photo's own size once it loads (its shape is needed to keep it on the scene)
}) {
  const uri = useRefPhotoUri(photo);
  const [t, setT] = useState<PhotoXf>(xf);
  useEffect(() => { setT(xf); }, [xf.s, xf.x, xf.y]);
  const cur = useRef(t);
  cur.current = t;
  const onXfRef = useRef(onXf);
  onXfRef.current = onXf;
  const viewRef = useRef<React.ComponentRef<typeof View>>(null);
  const box = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const measure = () => viewRef.current?.measureInWindow((x, y, w, h) => { box.current = { x, y, w: Math.max(1, w), h: Math.max(1, h) }; });
  // the gesture so far: how many fingers, the transform and the fingers' middle / spread when that number last changed
  const g = useRef({ n: 0, s0: 1, x0: 0, y0: 0, mx: 0, my: 0, d0: 1, moved: false, lastTap: 0 });
  const responder = useRef((() => {
    const pts = (e: any): Pt[] => (e.nativeEvent.touches ?? []).map((q: any) => [q.pageX, q.pageY] as Pt);
    const begin = (p: Pt[]) => {
      const st = g.current, c = cur.current;
      st.n = p.length; st.s0 = c.s; st.x0 = c.x; st.y0 = c.y;
      if (p.length >= 2) {
        st.mx = (p[0][0] + p[1][0]) / 2; st.my = (p[0][1] + p[1][1]) / 2;
        st.d0 = Math.max(10, Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]));
      } else if (p.length === 1) { st.mx = p[0][0]; st.my = p[0][1]; }
    };
    const set = (v: PhotoXf) => { cur.current = v; setT(v); };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { measure(); g.current.moved = false; begin(pts(e)); },
      onPanResponderMove: (e) => {
        const p = pts(e), st = g.current;
        if (p.length !== st.n) { begin(p); if (p.length > 1) st.moved = true; return; }
        if (p.length >= 2) {
          const mx = (p[0][0] + p[1][0]) / 2, my = (p[0][1] + p[1][1]) / 2;
          const s = clampS(st.s0 * Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) / st.d0);
          // the photo point that was under the fingers' middle stays under it (scale is about the view's centre)
          const cx = box.current.x + box.current.w / 2, cy = box.current.y + box.current.h / 2;
          set({ s, x: mx - cx - (s * (st.mx - cx - st.x0)) / st.s0, y: my - cy - (s * (st.my - cy - st.y0)) / st.s0 });
          st.moved = true;
        } else if (p.length === 1) {
          const dx = p[0][0] - st.mx, dy = p[0][1] - st.my;
          if (Math.abs(dx) + Math.abs(dy) > 6) st.moved = true;
          if (st.moved) set({ s: st.s0, x: st.x0 + dx, y: st.y0 + dy });
        }
      },
      onPanResponderRelease: () => {
        const st = g.current;
        if (!st.moved) {   // a tap: two in a row put the photo back to fit
          const now = Date.now();
          if (now - st.lastTap < 320) { set(XF0); st.lastTap = 0; } else st.lastTap = now;
        }
        st.n = 0;
        onXfRef.current?.(cur.current);
      },
      onPanResponderTerminate: () => { g.current.n = 0; onXfRef.current?.(cur.current); },
    });
  })()).current;
  if (!uri) return null;
  return (
    <View
      ref={viewRef}
      style={StyleSheet.absoluteFill}
      pointerEvents={move ? 'auto' : 'none'}
      onLayout={measure}
      {...(move ? responder.panHandlers : null)}
      accessibilityLabel={move ? 'Photo: pinch to zoom, drag to move, double tap to fit' : undefined}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { opacity, transform: [{ translateX: t.x }, { translateY: t.y }, { scale: t.s }] }]}
          resizeMode="contain"   // the whole photo, never cropped: zooming out shows all of it (Phil, 16 Nov 2026)
          onLoad={(e: any) => { const sw = e?.nativeEvent?.source?.width, sh = e?.nativeEvent?.source?.height; if (onSize && sw > 0 && sh > 0) onSize(sw, sh); }}
        />
      </View>
    </View>
  );
}

// The bar along the bottom of the picture while the photo is see-through: "Move photo", "See-through", the amount,
// an X back to the card.
// `inBar` (Phil, 26 Nov 2026: controls in a bar above the full-screen view, not over it): a plain row for that bar,
// with the photo's ‹ n of m › in front.
export function SeeThroughBar({ value, onChange, onClose, bottom, move, onMove, inBar, nav }: {
  value: number; onChange: (v: number) => void; onClose: () => void; bottom?: number; move?: boolean; onMove?: (on: boolean) => void;
  inBar?: boolean; nav?: { index: number; count: number; onIndex: (i: number) => void };
}) {
  return (
    <View style={inBar ? styles.barRow : [styles.bar, { bottom: bottom ?? 34 }]}>
      {inBar ? <Text style={styles.rowLabel}>PHOTO</Text> : null}
      {nav && nav.count > 1 ? (
        <>
          <TouchableOpacity onPress={() => nav.onIndex((nav.index - 1 + nav.count) % nav.count)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="Previous photo" hitSlop={4}>
            <Ionicons name="chevron-back" size={16} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.navText}>{nav.index + 1} of {nav.count}</Text>
          <TouchableOpacity onPress={() => nav.onIndex((nav.index + 1) % nav.count)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="Next photo" hitSlop={4}>
            <Ionicons name="chevron-forward" size={16} color="#ffffff" />
          </TouchableOpacity>
        </>
      ) : null}
      {onMove ? (
        <TouchableOpacity
          onPress={() => onMove(!move)}
          style={[styles.moveBtn, move && styles.moveBtnOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: !!move }}
          accessibilityLabel="Move photo"
          hitSlop={6}
        >
          <Ionicons name="move-outline" size={16} color={move ? '#000000' : '#ffffff'} />
        </TouchableOpacity>
      ) : null}
      <Text style={styles.barText}>See-through</Text>
      <AmountSlider value={value} onChange={onChange} />
      <TouchableOpacity onPress={onClose} style={styles.barX} accessibilityRole="button" accessibilityLabel="Close see-through" hitSlop={8}>
        <Ionicons name="close" size={16} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

const MIN = 0.1, MAX = 0.9;
const clamp = (v: number) => Math.max(MIN, Math.min(MAX, v));

// 10-90 %, built on PanResponder like the time slider (no new native module).
function AmountSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<React.ComponentRef<typeof View>>(null);
  const geom = useRef({ x: 0, w: 1 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const measure = () => trackRef.current?.measureInWindow((x, _y, w) => { geom.current = { x, w: Math.max(1, w) }; });
  const setFromX = (pageX: number) => {
    const f = (pageX - geom.current.x) / geom.current.w;
    onChangeRef.current(clamp(Math.round((MIN + f * (MAX - MIN)) * 100) / 100));
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { measure(); setFromX(e.nativeEvent.pageX); },
    onPanResponderMove: (e) => setFromX(e.nativeEvent.pageX),
  })).current;
  const pct = Math.round(value * 100);
  const at = ((value - MIN) / (MAX - MIN)) * 100;
  return (
    <View
      ref={trackRef}
      style={styles.slider}
      onLayout={measure}
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="See-through amount"
      accessibilityValue={{ min: 10, max: 90, now: pct, text: `${pct}%` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(clamp(Math.round((value + 0.1) * 100) / 100));
        if (e.nativeEvent.actionName === 'decrement') onChange(clamp(Math.round((value - 0.1) * 100) / 100));
      }}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: `${at}%` }]} />
      </View>
      <View style={[styles.knob, { left: `${at}%` }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: { position: 'absolute', right: 10 - X_OUT, width: CARD_W + X_OUT, height: CARD_H + X_OUT },
  card: {
    position: 'absolute', left: 0, bottom: 0, width: CARD_W, height: CARD_H, borderRadius: 8, borderWidth: 2, borderColor: '#ffffff',
    overflow: 'hidden', backgroundColor: '#0a0a0a',
  },
  x: {
    position: 'absolute', top: 0, right: 0, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111111', borderWidth: 1, borderColor: '#444444',
  },
  arrow: { position: 'absolute', top: CARD_H / 2 - 16, width: 24, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  arrowLeft: { left: 0, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  arrowRight: { right: 0, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  count: { position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  countText: { color: '#ffffff', fontSize: 10 },
  bar: {
    position: 'absolute', left: 10, right: 10, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)',
  },
  barText: { color: '#ffffff', fontSize: 12 },
  barRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: '#888888', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, width: 46 },
  navBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#444444', backgroundColor: '#1e1e1e' },
  navText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  barX: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  moveBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#666666' },
  moveBtnOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  slider: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#555555', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#5aaa7a' },
  knob: { position: 'absolute', top: 8, width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: '#ffffff' },
});
