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
// photos, swipe left/right (when not zoomed) to page through them. Built only
// on react-native-gesture-handler + reanimated (already in the native build),
// so it ships as a JS OTA — no new APK.
export default function FullScreenPhotoViewer({
  photo,
  photos,
  visible,
  onClose,
  onDelete,
}: {
  photo: any | null;
  photos?: any[];
  visible: boolean;
  onClose: () => void;
  onDelete?: (photo: any) => void;
}) {
  const [uri, setUri] = useState<string>('');
  const list = photos && photos.length ? photos : photo ? [photo] : [];
  const [index, setIndex] = useState(0);
  const current = list[Math.min(index, Math.max(0, list.length - 1))] ?? null;

  // Open on the photo that was tapped.
  useEffect(() => {
    if (visible) {
      const i = photo ? list.findIndex((p: any) => p.id === photo.id) : 0;
      setIndex(i >= 0 ? i : 0);
    }
  }, [visible, photo?.id]);

  const step = (dir: number) => {
    setIndex(i => Math.max(0, Math.min(list.length - 1, i + dir)));
  };

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Resolve the (cached or remote) URI the same way PhotoItem does.
  useEffect(() => {
    let cancelled = false;
    setUri('');
    if (current) {
      getPhotoUri(current)
        .then((r) => {
          if (!cancelled && r) setUri(r);
        })
        .catch(() => {});
    } else {
      setUri('');
    }
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  // Reset zoom/pan whenever we open or switch photos.
  useEffect(() => {
    if (visible) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
    }
  }, [visible, current?.id]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      } else if (e.numberOfPointers === 1) {
        // Not zoomed: the photo follows the finger sideways, to swipe.
        tx.value = e.translationX;
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        return;
      }
      if (Math.abs(e.translationX) > width * 0.2 || Math.abs(e.velocityX) > 800) {
        runOnJS(step)(e.translationX < 0 ? 1 : -1);
      }
      tx.value = withTiming(0, { duration: 150 });
      savedTx.value = 0;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2);
        savedScale.value = 2;
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(onClose)();
    });

  const composed = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

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
              {uri ? (
                <Animated.Image
                  source={{ uri }}
                  style={[styles.img, animStyle]}
                  resizeMode="contain"
                />
              ) : (
                <ActivityIndicator color="#fff" />
              )}
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
  center: { width, height, justifyContent: 'center', alignItems: 'center' },
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
