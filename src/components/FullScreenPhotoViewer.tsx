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
}: {
  photo: any | null;
  photos?: any[];
  visible: boolean;
  onClose: () => void;
  onDelete?: (photo: any) => void;
  onMakeFirst?: (photo: any) => void;
}) {
  const list = photos && photos.length ? photos : photo ? [photo] : [];
  // Tracked by id, not position, so reordering the list (Set as first)
  // keeps showing the same photo.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const found = list.findIndex((p: any) => p.id === currentId);
  const index = found >= 0 ? found : 0;
  const current = list[index] ?? null;
  const [uris, setUris] = useState<Record<string, string>>({});

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
          {list.length > 1 && (
            <View style={styles.counter} pointerEvents="none">
              <Text style={styles.counterText}>{index + 1} / {list.length}</Text>
            </View>
          )}
          {onMakeFirst && current && list.length > 1 && (
            index === 0 ? (
              <View style={[styles.firstBtn, styles.firstBtnOn]} pointerEvents="none">
                <Ionicons name="star" size={16} color="#000" />
                <Text style={[styles.firstText, { color: '#000' }]}>First photo</Text>
              </View>
            ) : (
              <Pressable
                style={styles.firstBtn}
                onPress={() => onMakeFirst(current)}
                hitSlop={8}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
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
