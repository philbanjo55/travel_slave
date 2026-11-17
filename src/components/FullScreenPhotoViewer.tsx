import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { getPhotoUri } from '../services/photoCache';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isOpen, lookupSpot, markSpotSeen, requestSpot, spotProgress, useSpot } from '../services/photoSpot';
import { useTripStore } from '../store/tripStore';
import FindSpotSheet from './FindSpotSheet';
import type { SpotHint } from '../services/photoSpot';

const { width, height } = Dimensions.get('window');

// Full-screen, pinch-to-zoom photo viewer. Tap (or the X) to close, pinch to
// zoom, drag to pan while zoomed, double-tap to toggle 1x/2x. Given a list of
// photos, swipe left/right (when not zoomed) to page through them: the photos
// sit side by side on one strip and the neighbours are loaded ahead, so the
// next one slides in with the finger instead of loading after the swipe.
// Built only on react-native-gesture-handler + reanimated (already in the
// native build), so it ships as a JS OTA — no new APK.
export default function FullScreenPhotoViewer({
  photo,
  photos,
  visible,
  onClose,
  onDelete,
  onMakeFirst,
  spotStop,
}: {
  photo: any | null;
  photos?: any[];
  visible: boolean;
  onClose: () => void;
  onDelete?: (photo: any) => void;
  onMakeFirst?: (photo: any) => Promise<boolean | void> | void;
  // Find spot: the stop the photos are on (none = no button); trip and pin feed the Find your spot sheet's chips and map
  spotStop?: { id: string; name?: string; tripId?: string | null; lat?: number | null; lng?: number | null } | null;
}) {
  const list = photos && photos.length ? photos : photo ? [photo] : [];
  // Tracked by id, not position, so reordering the list (Set as first)
  // keeps showing the same photo.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const found = list.findIndex((p: any) => p.id === currentId);
  const index = found >= 0 ? found : 0;
  const current = list[index] ?? null;
  const [uris, setUris] = useState<Record<string, string>>({});
  // "Set as first" feedback: which photo is being saved, and which one was
  // just saved (shown as done until the reordered list arrives).
  const [settingId, setSettingId] = useState<string | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) { setSettingId(null); setSetId(null); }
  }, [visible]);
  const makeFirst = async (p: any) => {
    if (!onMakeFirst || settingId) return;
    setSettingId(p.id);
    try {
      const ok = await onMakeFirst(p);
      if (ok !== false) setSetId(p.id);
    } finally {
      setSettingId(null);
    }
  };

  // Open on the photo that was tapped.
  useEffect(() => {
    if (visible) setCurrentId(photo?.id ?? list[0]?.id ?? null);
  }, [visible, photo?.id]);

  // Resolve every photo's (cached or remote) URI up front, so the neighbours
  // are ready before they slide in.
  const listKey = list.map((p: any) => p.id).join(',');
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    list.forEach((p: any) => {
      if (uris[p.id]) return;
      getPhotoUri(p).then((r) => {
        if (!cancelled && r) setUris((u) => (u[p.id] ? u : { ...u, [p.id]: r }));
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [visible, listKey]);

  // The strip: photo i sits at x = i * width, and the strip is moved to
  // -index * width. A swipe animates the strip to the neighbour and only then
  // updates the index, which leaves the strip exactly where it already is.
  const stripX = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const indexSV = useSharedValue(0);
  const countSV = useSharedValue(1);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const zx = useSharedValue(0);
  const zy = useSharedValue(0);
  const savedZx = useSharedValue(0);
  const savedZy = useSharedValue(0);

  useEffect(() => {
    indexSV.value = index;
    countSV.value = list.length;
    stripX.value = -index * width;
  }, [index, list.length]);

  // Reset zoom whenever we open or switch photos.
  useEffect(() => {
    if (visible) {
      scale.value = 1; savedScale.value = 1;
      zx.value = 0; zy.value = 0; savedZx.value = 0; savedZy.value = 0;
    }
  }, [visible, current?.id]);

  const goTo = (i: number) => {
    const p = list[i];
    if (p) setCurrentId(p.id);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        zx.value = withTiming(0); zy.value = withTiming(0);
        savedZx.value = 0; savedZy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .minDistance(8)
    .onStart(() => {
      dragStart.value = stripX.value;
    })
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        zx.value = savedZx.value + e.translationX;
        zy.value = savedZy.value + e.translationY;
        return;
      }
      if (e.numberOfPointers !== 1) return;
      // Resist at the ends, where there is no photo to slide in.
      const atStart = indexSV.value === 0 && e.translationX > 0;
      const atEnd = indexSV.value === countSV.value - 1 && e.translationX < 0;
      stripX.value = dragStart.value + e.translationX * (atStart || atEnd ? 0.3 : 1);
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedZx.value = zx.value; savedZy.value = zy.value;
        return;
      }
      let target = indexSV.value;
      if (Math.abs(e.translationX) > width * 0.2 || Math.abs(e.velocityX) > 800) {
        target = Math.max(0, Math.min(countSV.value - 1, target + (e.translationX < 0 ? 1 : -1)));
      }
      const changed = target !== indexSV.value;
      stripX.value = withTiming(-target * width, { duration: changed ? 220 : 160 }, (finished) => {
        if (finished && changed) runOnJS(goTo)(target);
      });
    });

  // Taps are limited to a finger that barely moves, so a swipe is never
  // also read as a tap (which closed the viewer mid-swipe).
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(10)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withTiming(1); savedScale.value = 1;
        zx.value = withTiming(0); zy.value = withTiming(0);
        savedZx.value = 0; savedZy.value = 0;
      } else {
        scale.value = withTiming(2); savedScale.value = 2;
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(10)
    .maxDuration(300)
    .onEnd(() => {
      runOnJS(onClose)();
    });

  const composed = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stripX.value }] }));
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zx.value }, { translateY: zy.value }, { scale: scale.value }],
  }));

  // Only the current photo and its two neighbours are mounted. Keyed by id,
  // so a neighbour that becomes current keeps its already-loaded image.
  const slots = [index - 1, index, index + 1].filter((i) => i >= 0 && i < list.length);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.backdrop}>
          <GestureDetector gesture={composed}>
            <Animated.View style={styles.center}>
              <Animated.View style={[styles.strip, stripStyle]}>
                {slots.map((i) => {
                  const p = list[i];
                  const u = uris[p.id];
                  return (
                    <View key={p.id} style={[styles.slot, { left: i * width }]}>
                      {u ? (
                        <Animated.Image
                          source={{ uri: u }}
                          style={[styles.img, i === index ? zoomStyle : null]}
                          resizeMode="contain"
                        />
                      ) : (
                        <ActivityIndicator color="#fff" />
                      )}
                    </View>
                  );
                })}
              </Animated.View>
            </Animated.View>
          </GestureDetector>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {visible && spotStop && current?.id && (current.storage_url || /^https?:/.test(String(current.url ?? ''))) ? (
            <FindSpot photoId={current.id} photoUri={uris[current.id] ?? null} stop={spotStop} onLeave={onClose} />
          ) : null}
          {list.length > 1 && (
            <View style={styles.counter} pointerEvents="none">
              <Text style={styles.counterText}>{index + 1} / {list.length}</Text>
            </View>
          )}
          {onMakeFirst && current && list.length > 1 && (
            index === 0 || setId === current.id ? (
              <View style={[styles.firstBtn, styles.firstBtnOn]} pointerEvents="none">
                <Ionicons name="star" size={16} color="#000" />
                <Text style={[styles.firstText, { color: '#000' }]}>
                  {index === 0 ? 'First photo' : 'Set as first ✓'}
                </Text>
              </View>
            ) : settingId === current.id ? (
              <View style={styles.firstBtn} pointerEvents="none">
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.firstText}>Setting…</Text>
              </View>
            ) : (
              <Pressable
                style={styles.firstBtn}
                onPress={() => makeFirst(current)}
                hitSlop={8}
                disabled={!!settingId}
                accessibilityLabel="Set this as the first photo"
              >
                <Ionicons name="star-outline" size={16} color="#fff" />
                <Text style={styles.firstText}>Set as first</Text>
              </Pressable>
            )
          )}
          {onDelete && current && (
            <Pressable
              style={styles.deleteBtn}
              onPress={() => onDelete(current)}
              hitSlop={12}
              accessibilityLabel="Delete this photo"
            >
              <Ionicons name="trash-outline" size={22} color="#fff" />
            </Pressable>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Find spot (Phil, 16 Nov 2026): a white pill at the top; while it works, a card at the bottom with a bar.
// The job carries on without the viewer (services/photoSpot): leaving is fine.
function FindSpot({ photoId, photoUri, stop, onLeave }: {
  photoId: string; photoUri: string | null; stop: { id: string; name?: string; tripId?: string | null; lat?: number | null; lng?: number | null }; onLeave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const offline = useTripStore((s: any) => s.isOffline);
  const kept = useSpot(photoId, stop.id);
  const job = kept?.job ?? null;
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { setErr(null); lookupSpot(photoId, stop.id).catch(() => {}); }, [photoId, stop.id]);
  const open = isOpen(job);
  useEffect(() => {   // the bar creeps on between polls
    if (!open) return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [open]);
  const found = job?.status === 'done' && job.result?.ok;
  const failed = job?.status === 'error' || (job?.status === 'done' && !job.result?.ok);
  const see = () => {
    if (!job) return;
    markSpotSeen(job.id);
    onLeave();
    navigation.navigate('PhotoSpot', { jobId: job.id, stopName: stop.name ?? null });
  };
  // Find spot / Find again open the Find your spot sheet first (Phil, 17 Nov 2026): optional pins, or Skip = as before.
  const [sheet, setSheet] = useState<{ again: boolean } | null>(null);
  const start = async (again = false, hint?: SpotHint | null) => {
    if (asking) return;
    setAsking(true); setErr(null);
    const r = await requestSpot(stop.id, photoId, stop.name, again, hint);
    setAsking(false);
    if (r.error) setErr(r.error);
  };
  const onFind = async (hint: SpotHint | null) => {
    const again = sheet?.again ?? false;
    setSheet(null);
    await start(again, hint);
  };
  const label = offline && !found ? 'Needs a signal' : found ? 'Your spot' : open || asking ? 'Finding…' : 'Find spot';
  return (
    <>
      <Pressable
        style={[styles.spotPill, { top: Math.max(50, insets.top + 8) }, (offline && !found) || open ? styles.spotPillDim : null]}
        onPress={() => (found ? see() : !open && !offline ? setSheet({ again: failed }) : undefined)}
        disabled={(offline && !found) || open || asking}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={found ? 'Your spot: see where you stood' : open ? 'Finding where you stood' : offline ? 'Find spot needs a signal' : 'Find spot: where was this taken'}
      >
        <Ionicons name="locate-outline" size={16} color="#000" />
        <Text style={styles.spotPillText}>{label}</Text>
      </Pressable>
      {open || asking ? (
        <View style={[styles.spotCard, { bottom: insets.bottom + 100 }]} accessibilityLabel="Finding where you stood">
          <View style={styles.spotRow}>
            <Text style={styles.spotTitle}>Finding where you stood</Text>
            <Text style={styles.spotSmall}>about 3 min</Text>
          </View>
          <View style={styles.spotBar}><View style={[styles.spotFill, { width: `${Math.round(spotProgress(job) * 100)}%` }]} /></View>
          <Text style={styles.spotSmall}>{job?.note && /set up|did not start/.test(job.note) ? job.note[0].toUpperCase() + job.note.slice(1) : "You can leave. It tells you when it's done."}</Text>
        </View>
      ) : found ? (
        <Pressable style={[styles.spotCard, { bottom: insets.bottom + 100 }]} onPress={see} accessibilityRole="button" accessibilityLabel="Spot found. See it">
          <View style={styles.spotRow}>
            <Text style={styles.spotTitle}>Spot found</Text>
            <Text style={[styles.spotSmall, { color: '#5aaa7a' }]}>{job?.result?.confidence?.word ?? ''}</Text>
          </View>
          <View style={styles.spotRow}>
            <Text style={styles.spotSmall}>Tap to see it</Text>
            {!offline ? (
              <Pressable onPress={() => setSheet({ again: true })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Find this spot again">
                <Text style={[styles.spotSmall, { color: '#ffffff', fontWeight: '700' }]}>Find again</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      ) : failed || err ? (
        <View style={[styles.spotCard, { bottom: insets.bottom + 100 }]} accessibilityLabel="Couldn't place it">
          <Text style={styles.spotTitle}>{err ? "Couldn't start" : "Couldn't place it"}</Text>
          <Text style={styles.spotSmall}>{err ?? job?.result?.why ?? job?.error ?? ''}</Text>
        </View>
      ) : null}
      <FindSpotSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        stopId={stop.id}
        stopName={stop.name ?? null}
        tripId={stop.tripId ?? null}
        photoUri={photoUri}
        centre={stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : null}
        onFind={onFind}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  spotPill: {
    position: 'absolute', right: 76, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  spotPillDim: { opacity: 0.6 },
  spotPillText: { color: '#000', fontSize: 13, fontWeight: '600' },
  spotCard: {
    position: 'absolute', left: 16, right: 16, backgroundColor: '#111111', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
  },
  spotRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  spotTitle: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  spotSmall: { color: '#888888', fontSize: 12 },
  spotBar: { height: 4, borderRadius: 2, backgroundColor: '#2a2a2a', overflow: 'hidden' },
  spotFill: { height: 4, borderRadius: 2, backgroundColor: '#5aaa7a' },
  counter: {
    position: 'absolute', top: 54, left: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  counterText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  firstBtn: {
    position: 'absolute', bottom: 44, left: 20, height: 44, paddingHorizontal: 14, borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  firstBtnOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  firstText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  deleteBtn: {
    position: 'absolute', bottom: 44, right: 20, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: { width, height, overflow: 'hidden' },
  strip: { position: 'absolute', left: 0, top: 0, width, height },
  slot: { position: 'absolute', top: 0, width, height, justifyContent: 'center', alignItems: 'center' },
  img: { width, height },
  closeBtn: {
    position: 'absolute',
    top: 44,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
