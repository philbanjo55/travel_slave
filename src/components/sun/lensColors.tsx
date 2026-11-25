import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Pair } from '../../utils/sunEngine';
import { framingOf } from '../../services/shotSaves';

// One colour per camera + lens (Phil, 25 Nov 2026: "the dot color of each shot needs to correspond to a lens I have, so
// I can compare where/what shots I take ... give each their own distinct color"). A shot's dot on the maps (split view,
// Overhead) takes the colour of its framing's lens (the framing the shot opens with); a shot not framed yet is grey.
// Blue is left out on purpose (the "you are here" dot), and white (it vanishes on snow; the shot you are on is white
// in the middle with a ring in its lens's colour). Kept apart from the trail colours (trailRoutes.ts: white, sky blue,
// indigo, sand).
export const LENS_COLORS: { id: string; label: string; color: string }[] = [
  { id: '75', label: '4×5 · 75', color: '#E53935' },
  { id: '90', label: '4×5 · 90', color: '#FB8C00' },
  { id: '135', label: '4×5 · 135', color: '#FDD835' },
  { id: '300', label: '4×5 · 300', color: '#2E7D32' },
  { id: '617-75', label: '6×17 · 75', color: '#00897B' },
  { id: '617-90', label: '6×17 · 90', color: '#7E57C2' },
  { id: '617-135', label: '6×17 · 135', color: '#EC407A' },
  { id: '617-300', label: '6×17 · 300', color: '#795548' },
  { id: 'gw690', label: '6×9', color: '#111111' },
];
export const NO_LENS_COLOR = '#9E9E9E';   // not framed yet: grey (white would vanish on snow, black is the Fuji)
export const lensColor = (lensId: string | null | undefined): string => LENS_COLORS.find(l => l.id === lensId)?.color ?? NO_LENS_COLOR;
// '' = not framed (or a lens with no colour of its own)
export const lensKeyOf = (p: Pair): string => { const id = framingOf(p)?.lens ?? ''; return LENS_COLORS.some(l => l.id === id) ? id : ''; };
export const shotColor = (p: Pair): string => lensColor(lensKeyOf(p));

// Which lenses are hidden on the maps (Phil, 25 Nov 2026: "check / uncheck the lenses on the map"). One filter for every
// map (split view and Overhead), kept while the app is open. The shot you are on always shows.
let hidden: Set<string> = new Set();
const subs = new Set<() => void>();
export function toggleLens(id: string) {
  const n = new Set(hidden);
  if (n.has(id)) n.delete(id); else n.add(id);
  hidden = n;
  subs.forEach(f => { try { f(); } catch { /* a map gone */ } });
}
export function useLensFilter(): Set<string> {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN(x => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return hidden;
}
export const hiddenIds = (pairs: Pair[], selId: string, hide: Set<string>): string[] =>
  (hide.size ? pairs.filter(p => p.vantage_id !== selId && hide.has(lensKeyOf(p))).map(p => p.vantage_id) : []);
export const visibleShots = (pairs: Pair[], selId: string, hide: Set<string>) =>
  (hide.size ? pairs.filter(p => p.vantage_id === selId || !hide.has(lensKeyOf(p))) : pairs);

// The key: the lenses the stop's shots use (and "Not framed" when some are not); a tap shows or hides that lens's dots.
export function LensLegend({ pairs, style }: { pairs: Pair[]; style?: any }) {
  const hide = useLensFilter();
  const used = new Set(pairs.map(lensKeyOf));
  const rows = [...LENS_COLORS.filter(l => used.has(l.id)), ...(used.has('') ? [{ id: '', label: 'Not framed', color: NO_LENS_COLOR }] : [])];
  if (!rows.length || (rows.length === 1 && rows[0].id === '')) return null;
  return (
    <View style={[styles.box, style]} pointerEvents="box-none">
      {rows.map(r => {
        const on = !hide.has(r.id);
        return (
          <TouchableOpacity key={r.id || 'none'} onPress={() => toggleLens(r.id)} style={styles.row} hitSlop={{ top: 3, bottom: 3, left: 6, right: 6 }}
            accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${r.label} shots on the map: ${on ? 'shown' : 'hidden'}. Tap to ${on ? 'hide' : 'show'}`}>
            <View style={[styles.dot, on ? { backgroundColor: r.color } : { backgroundColor: 'transparent', borderColor: r.color === '#111111' ? '#888888' : r.color }]} />
            <Text style={[styles.text, !on && styles.textOff]}>{r.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 24 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: '#ffffff' },
  text: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  textOff: { color: '#777777', textDecorationLine: 'line-through' },
});
