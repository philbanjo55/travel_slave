import React, { useEffect, useState } from 'react';
import { Modal, View, StyleSheet, Pressable, ActivityIndicator, Dimensions } from 'react-native';
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
// zoom, drag to pan while zoomed, double-tap to toggle 1x/2x. Built only on
// react-native-gesture-handler + reanimated (already in the native build), so
// it ships as a JS OTA — no new APK.
export default function FullScreenPhotoViewer({
  photo,
  visible,
  onClose,
}: {
  photo: any | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [uri, setUri] = useState<string>('');

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Resolve the (cached or remote) URI the same way PhotoItem does.
  useEffect(() => {
    let cancelled = false;
    if (photo) {
      getPhotoUri(photo)
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
  }, [photo?.id]);

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
  }, [visible, photo?.id]);

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
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
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
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
