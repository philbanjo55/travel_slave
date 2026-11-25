import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Pair } from '../../utils/sunEngine';
import { framingOf } from '../../services/shotSaves';

// One colour per camera + lens (Phil, 25 Nov 2026: "the dot color of each shot needs to correspond to a lens I have, so
// I can compare where/what shots I take ... give each their own distinct color"). A shot's dot on the maps (split view,
// Overhead) takes the colour of its framing's lens (the framing the shot opens with); a shot not framed yet is grey.
// Blue is left out on purpose (the "you are here" dot), and white (it vanishes on snow).
export const LENS_COLORS: { id: string; label: string; color: string }[] = [
  { id: '75', label: '4×5 · 75', color: '#E53935' },
  { id: '90', label: '4×5 · 90', color: '#FB8C00' },
  { id: '135', label: '4×5 · 135', color: '#FDD835' },
  { id: '300', label: '4×5 · 300', color: '#43A047' },
  { id: '617-75', label: '6×17 · 75', color: '#00BCD4' },
  { id: '617-90', label: '6×17 · 90', color: '#7E57C2' },
  { id: '617-135', label: '6×17 · 135', color: '#EC407A' },
  { id: '617-300', label: '6×17 · 300', color: '#795548' },
  { id: 'gw690', label: '6×9', color: '#111111' },
];
export const NO_LENS_COLOR = '#9E9E9E';   // not framed yet: grey (white would vanish on snow, black is the Fuji)
export const lensColor = (lensId: string | null | undefined): string => LENS_COLORS.find(l => l.id === lensId)?.color ?? NO_LENS_COLOR;
export const shotColor = (p: Pair): string => lensColor(framingOf(p)?.lens);

// The key: only the lenses the shown shots use (and "Not framed" when some are not).
export function LensLegend({ pairs, style }: { pairs: Pair[]; style?: any }) {
  const used = new Set(pairs.map(p => framingOf(p)?.lens ?? ''));
  const rows = LENS_COLORS.filter(l => used.has(l.id));
  if (!rows.length) return null;
  const none = used.has('') || [...used].some(id => id && !LENS_COLORS.some(l => l.id === id));
  return React.createElement(View, { style: [styles.box, style], pointerEvents: 'none', accessibilityLabel: `Lens colours: ${rows.map(r => r.label).join(', ')}` },
    ...rows.map(r => React.createElement(View, { key: r.id, style: styles.row },
      React.createElement(View, { style: [styles.dot, { backgroundColor: r.color }] }),
      React.createElement(Text, { style: styles.text }, r.label))),
    none ? React.createElement(View, { key: 'none', style: styles.row },
      React.createElement(View, { style: [styles.dot, { backgroundColor: NO_LENS_COLOR }] }),
      React.createElement(Text, { style: styles.text }, 'Not framed')) : null);
}

const styles = StyleSheet.create({
  box: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#ffffff' },
  text: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
});
