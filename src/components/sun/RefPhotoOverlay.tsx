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
        <View style={styles.count} pointerEvents="none">
          <Text style={styles.countText}>{index + 1} of {n}</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onClose} style={styles.x} accessibilityRole="button" accessibilityLabel="Close reference photo" hitSlop={8}>
        <Ionicons name="close" size={14} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

// The photo over the whole picture, see-through. Touches go through it to the view underneath (drag to look still works).
export function RefPhotoGhost({ photo, opacity }: { photo: RefPhoto; opacity: number }) {
  const uri = useRefPhotoUri(photo);
  if (!uri) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={{ uri }} style={[StyleSheet.absoluteFill, { opacity }]} resizeMode="cover" />
    </View>
  );
}

// The bar along the bottom of the picture while the photo is see-through: "See-through", the amount, an X back to the card.
export function SeeThroughBar({ value, onChange, onClose, bottom }: {
  value: number; onChange: (v: number) => void; onClose: () => void; bottom: number;
}) {
  return (
    <View style={[styles.bar, { bottom }]}>
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
  barX: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  slider: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#555555', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#5aaa7a' },
  knob: { position: 'absolute', top: 8, width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: '#ffffff' },
});
