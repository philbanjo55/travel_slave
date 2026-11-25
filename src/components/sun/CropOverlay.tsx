// Crop ratios inside the 4x5 frame box (Phil, 20 Nov 2026: "select aspect (crop) ratios for the 4x5 framings ... what
// the image would look like ... and what size it would end up as with x as the long end (inches)"; then: keep the list,
// add a custom crop sized by dragging its corners, drag to move it, save the ratio with the framing, the long side is
// only a calculator, and "Frame only" shows just the cropped frame).
//
// Drawn by React Native over the web view, inside the same container (so the upside-down ground-glass view turns it
// too). The frame box's place on screen is the page's own lens maths (lensFov in tools/sun3d/app_view.js, unitPx in
// Sun3DPanel): frame width = one focal length in dp x film width / focal length.
import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FrameCrop, CropRatio } from '../../utils/sunEngine';

export type { FrameCrop, CropRatio };
type Std = { id: Exclude<CropRatio, 'custom'> | '4x5'; label: string; say: string; a: number; b: number };
export const CROP_RATIOS: Std[] = [
  { id: '4x5', label: '4×5 full', say: 'Crop 4 by 5, full frame', a: 5, b: 4 },
  { id: '1:1', label: '1:1', say: 'Crop 1 to 1', a: 1, b: 1 },
  { id: '11x14', label: '11×14', say: 'Crop 11 by 14', a: 14, b: 11 },
  { id: '5x7', label: '5×7', say: 'Crop 5 by 7', a: 7, b: 5 },
  { id: '3:2', label: '3:2', say: 'Crop 3 to 2', a: 3, b: 2 },
  { id: '16:9', label: '16:9', say: 'Crop 16 to 9', a: 16, b: 9 },
  { id: '2:1', label: '2:1', say: 'Crop 2 to 1', a: 2, b: 1 },
  { id: '3:1', label: '3:1 pano', say: 'Crop 3 to 1, panorama', a: 3, b: 1 },
];
const MIN = 0.1;   // the smallest custom crop, as a share of the frame's width / height
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

// Film opening as the camera is turned (mm), e.g. 4x5 landscape = 120 x 96.
export type Film = { fw: number; fh: number };

// The largest box of a standard ratio that fits the frame, turned like the frame, centred on (cx, cy) as far as it fits.
export function fitCrop(id: CropRatio | '4x5', film: Film, cx = 0.5, cy = 0.5): FrameCrop | null {
  if (id === '4x5') return null;
  const s = CROP_RATIOS.find(r => r.id === id);
  if (!s) return null;
  const r = s.a / s.b, R = film.fw >= film.fh ? r : 1 / r;   // crop width / height in mm
  const wmm = Math.min(film.fw, film.fh * R), hmm = wmm / R;
  const w = wmm / film.fw, h = hmm / film.fh;
  return { ratio: id as CropRatio, w: r4(w), h: r4(h), cx: r4(clamp(cx, w / 2, 1 - w / 2)), cy: r4(clamp(cy, h / 2, 1 - h / 2)) };
}

// A crop on a frame turned the other way (landscape <-> portrait): a standard ratio is fitted again, a custom one keeps
// its shape on the film as far as it fits.
export function refitCrop(c: FrameCrop | null, film: Film): FrameCrop | null {
  if (!c) return null;
  if (c.ratio !== 'custom') return fitCrop(c.ratio, film, c.cx, c.cy);
  const w = clamp(c.w, MIN, 1), h = clamp(c.h, MIN, 1);
  return { ...c, w, h, cx: clamp(c.cx, w / 2, 1 - w / 2), cy: clamp(c.cy, h / 2, 1 - h / 2) };
}

// The crop on the film (mm) and its name: "3:2", "4×5", or a custom "2.37:1".
export function cropMm(c: FrameCrop | null, film: Film) {
  const w = (c ? c.w : 1) * film.fw, h = (c ? c.h : 1) * film.fh;
  return { w, h, long: Math.max(w, h), short: Math.min(w, h) };
}
export function cropName(c: FrameCrop | null | undefined, film?: Film): string {
  if (!c) return '4×5';
  if (c.ratio !== 'custom') return (CROP_RATIOS.find(r => r.id === c.ratio)?.label ?? c.ratio).replace(' pano', '').replace(' full', '');
  if (!film) return 'custom';
  const m = cropMm(c, film);
  return `${(m.long / m.short).toFixed(2)}:1`;
}
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace(/\.0$/, '');

// The print calculator's long side (inches): one number for every shot, kept on the phone, never on the server.
let longIn = 30;
let longRead = false;
const LONG_KEY = 'pf_print_long_in';
export async function readLongIn(): Promise<number> {
  if (longRead) return longIn;
  longRead = true;
  try { const v = Number(await AsyncStorage.getItem(LONG_KEY)); if (v >= 8 && v <= 80) longIn = v; } catch { /* default */ }
  return longIn;
}
export function setLongInStored(v: number) {
  longIn = v;
  AsyncStorage.setItem(LONG_KEY, String(v)).catch(() => { /* kept for this run */ });
}
export const longInNow = () => longIn;
// A tap moves half an inch (Phil, 22 Nov 2026); a long press moves 5 inches.
export const stepLong = (v: number, dir: 1 | -1, big = false) =>
  clamp(Math.round((v + dir * (big ? 5 : 0.5)) * 2) / 2, 8, 80);
export function printSize(c: FrameCrop | null, film: Film, L: number) {
  const m = cropMm(c, film);
  return { long: L, short: (L * m.short) / m.long, enlarge: (L * 25.4) / m.long, pct: Math.round((100 * m.w * m.h) / (film.fw * film.fh)), m };
}

type OverlayProps = {
  pic: { w: number; h: number };
  unit: number;                 // one focal length in dp on this view (unitPx)
  lens: { f: number; fw: number; fh: number };
  crop: FrameCrop | null;
  editing: boolean;             // the crop panel is open: the box can be moved / sized (else touches go to the view)
  only: boolean;                // "Frame only": black everywhere outside the crop
  flip: boolean;                // the view is turned upside down (ground glass): drags go the other way
  longIn: number;
  onChange: (c: FrameCrop) => void;
};

export function CropOverlay({ pic, unit, lens, crop, editing, only, flip, longIn: L, onChange }: OverlayProps) {
  const fW = (unit * lens.fw) / lens.f, fH = (unit * lens.fh) / lens.f;
  const fx = (pic.w - fW) / 2, fy = (pic.h - fH) / 2;
  const film: Film = { fw: lens.fw, fh: lens.fh };
  const c = crop;
  const cw = c ? c.w * fW : fW, ch = c ? c.h * fH : fH;
  const cx = fx + (c ? c.cx * fW : fW / 2) - cw / 2, cy = fy + (c ? c.cy * fH : fH / 2) - ch / 2;
  // the latest values for the gesture handlers (made once)
  const live = useRef({ crop: c, fW, fH, flip, onChange });
  live.current = { crop: c, fW, fH, flip, onChange };
  const start = useRef<FrameCrop | null>(null);

  const mover = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!live.current.crop,
    onMoveShouldSetPanResponder: () => !!live.current.crop,
    onPanResponderGrant: () => { start.current = live.current.crop; },
    onPanResponderMove: (_e, g) => {
      const s = start.current, k = live.current; if (!s) return;
      const sg = k.flip ? -1 : 1;
      const ncx = clamp(s.cx + (sg * g.dx) / k.fW, s.w / 2, 1 - s.w / 2), ncy = clamp(s.cy + (sg * g.dy) / k.fH, s.h / 2, 1 - s.h / 2);
      k.onChange({ ...s, cx: r4(ncx), cy: r4(ncy) });
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  // a corner of a custom crop: the opposite corner stays put
  const corner = (sx: -1 | 1, sy: -1 | 1) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = live.current.crop; },
    onPanResponderMove: (_e, g) => {
      const s = start.current, k = live.current; if (!s) return;
      const sg = k.flip ? -1 : 1;
      const ax = s.cx - (sx * s.w) / 2, ay = s.cy - (sy * s.h) / 2;   // the fixed corner
      let ex = s.cx + (sx * s.w) / 2 + (sg * g.dx) / k.fW, ey = s.cy + (sy * s.h) / 2 + (sg * g.dy) / k.fH;
      ex = clamp(ex, 0, 1); ey = clamp(ey, 0, 1);
      if (sx > 0) ex = Math.max(ex, ax + MIN); else ex = Math.min(ex, ax - MIN);
      if (sy > 0) ey = Math.max(ey, ay + MIN); else ey = Math.min(ey, ay - MIN);
      k.onChange({ ratio: 'custom', w: r4(Math.abs(ex - ax)), h: r4(Math.abs(ey - ay)), cx: r4((ex + ax) / 2), cy: r4((ey + ay) / 2) });
    },
    onPanResponderTerminationRequest: () => false,
  });
  const corners = useMemo(() => [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1)], []);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null;   // no crop: the page's own frame box (and its own blackout) is all there is
  const p = printSize(c, film, L);
  const shade = only ? styles.black : styles.shade;
  // outside the crop: with "Frame only" black over the whole view, else shaded inside the frame box
  const ox = only ? 0 : fx, oy = only ? 0 : fy, ow = only ? pic.w : fW, oh = only ? pic.h : fH;
  const bands = [
    { left: ox, top: oy, width: ow, height: Math.max(0, cy - oy) },
    { left: ox, top: cy + ch, width: ow, height: Math.max(0, oy + oh - cy - ch) },
    { left: ox, top: cy, width: Math.max(0, cx - ox), height: ch },
    { left: cx + cw, top: cy, width: Math.max(0, ox + ow - cx - cw), height: ch },
  ];
  const custom = c?.ratio === 'custom';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={editing ? 'box-none' : 'none'}>
      {bands.map((b, i) => <View key={i} style={[styles.band, shade, b]} pointerEvents="none" />)}
      {c ? (
        <View
          style={[styles.box, { left: cx, top: cy, width: cw, height: ch }]}
          {...(editing ? mover.panHandlers : {})}
          accessibilityLabel={`Crop ${cropName(c, film)}, ${fmt(p.long)} by ${fmt(p.short)} inches${editing ? '. Drag to move it' : ''}`}
        >
          <Text style={styles.tag} numberOfLines={1}>{cropName(c, film)} · {fmt(p.long)} × {fmt(p.short)} in</Text>
        </View>
      ) : null}
      {c && editing && custom ? ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy], i) => (
        <View
          key={i}
          style={[styles.handle, { left: (sx < 0 ? cx : cx + cw) - 18, top: (sy < 0 ? cy : cy + ch) - 18 }]}
          {...corners[i].panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Resize crop"
        >
          <View style={styles.handleDot} />
        </View>
      )) : null}
    </View>
  );
}

type PanelProps = {
  crop: FrameCrop | null;
  film: Film;
  filmName: string;   // '4×5' or '6×9'
  longIn: number;
  onPick: (id: CropRatio | '4x5') => void;
  onLong: (v: number) => void;
};

// Under the picture while the crop panel is open: the ratios, the print calculator and what the crop uses of the film.
export function CropPanel({ crop, film, filmName, longIn: L, onPick, onLong }: PanelProps) {
  const p = printSize(crop, film, L);
  const on = crop ? crop.ratio : '4x5';
  const name = cropName(crop, film);
  const full = { long: Math.max(film.fw, film.fh), short: Math.min(film.fw, film.fh) };
  const chips: { id: CropRatio | '4x5'; label: string; say: string }[] = [
    ...CROP_RATIOS.map(r => ({ id: r.id as CropRatio | '4x5', label: r.id === '4x5' ? `${filmName} full` : r.label, say: r.id === '4x5' ? `No crop, the whole ${filmName}` : r.say })),
    { id: 'custom', label: 'Custom', say: 'Custom crop: drag its corners' },
  ];
  return (
    <View style={styles.panel}>
      <Text style={styles.head}>CROP</Text>
      <View style={styles.chips} accessibilityRole="tablist">
        {chips.map(ch => {
          const sel = on === ch.id;
          return (
            <TouchableOpacity key={ch.id} onPress={() => onPick(ch.id)} style={[styles.chip, sel && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={ch.say}>
              <Text style={[styles.chipText, sel && styles.chipTextOn]}>{ch.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {crop?.ratio === 'custom' ? <Text style={styles.hint}>Drag the corners to size it, drag inside to move it.</Text>
        : crop ? <Text style={styles.hint}>Drag the crop to move it.</Text> : null}
      <View style={styles.longRow}>
        <Text style={styles.head}>PRINT, LONG SIDE</Text>
        <TouchableOpacity onPress={() => onLong(stepLong(L, -1))} onLongPress={() => onLong(stepLong(L, -1, true))} style={styles.step} accessibilityRole="button" accessibilityLabel="Shorter print" disabled={L <= 8}>
          <Text style={[styles.stepText, L <= 8 && { opacity: 0.4 }]}>−</Text>
        </TouchableOpacity>
        <Text style={styles.longVal} accessibilityLabel={`Long side ${L} inches`}>{L} in</Text>
        <TouchableOpacity onPress={() => onLong(stepLong(L, 1))} onLongPress={() => onLong(stepLong(L, 1, true))} style={styles.step} accessibilityRole="button" accessibilityLabel="Longer print" disabled={L >= 80}>
          <Text style={[styles.stepText, L >= 80 && { opacity: 0.4 }]}>+</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.result} accessibilityLabel={`Print: ${name}, ${fmt(p.long)} by ${fmt(p.short)} inches`}>{name} print: {fmt(p.long)} × {fmt(p.short)} in</Text>
      <Text style={styles.film}>
        Uses {fmt(p.m.long)} × {fmt(p.m.short)} mm of the {fmt(full.long)} × {fmt(full.short)} mm negative ({p.pct}%) · {fmt(p.enlarge)}× enlargement
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute' },
  shade: { backgroundColor: 'rgba(0,0,0,0.6)' },
  black: { backgroundColor: '#000000' },
  box: { position: 'absolute', borderWidth: 2, borderColor: '#ffffff' },
  tag: { position: 'absolute', left: 4, top: 4, color: '#ffffff', fontSize: 11, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  handle: { position: 'absolute', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  handleDot: { width: 14, height: 14, borderRadius: 3, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#000000' },
  panel: { marginTop: 8, gap: 6 },
  head: { color: '#888888', fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#444444', justifyContent: 'center' },
  chipOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  chipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#000000' },
  hint: { color: '#888888', fontSize: 12 },
  longRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  step: { width: 40, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#ffffff', fontSize: 16 },
  longVal: { minWidth: 54, textAlign: 'center', color: '#ffffff', fontSize: 15, fontWeight: '700' },
  result: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  film: { color: '#888888', fontSize: 12 },
});

// Grid lines in the framer (Phil, 25 Nov 2026: "an option to view grid lines in the viewer / framer"): thirds inside the
// crop (or the whole frame box; with the frame box off, the whole picture). Drawn only, never touched.
export function GridOverlay({ pic, unit, lens, crop, box }: { pic: { w: number; h: number }; unit: number; lens: { f: number; fw: number; fh: number }; crop: FrameCrop | null; box: boolean }) {
  let x = 0, y = 0, w = pic.w, h = pic.h;
  if (box) {
    const fW = (unit * lens.fw) / lens.f, fH = (unit * lens.fh) / lens.f;
    const fx = (pic.w - fW) / 2, fy = (pic.h - fH) / 2;
    w = crop ? crop.w * fW : fW; h = crop ? crop.h * fH : fH;
    x = fx + (crop ? crop.cx * fW : fW / 2) - w / 2; y = fy + (crop ? crop.cy * fH : fH / 2) - h / 2;
  }
  const lines = [1, 2].flatMap(k => [
    { left: x + (w * k) / 3, top: y, width: StyleSheet.hairlineWidth * 2, height: h },
    { left: x, top: y + (h * k) / 3, width: w, height: StyleSheet.hairlineWidth * 2 },
  ]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((l, i) => <View key={i} style={[gridStyles.line, l]} />)}
    </View>
  );
}
// The Chamonix 4x5 focusing screen (Phil, 25 Nov 2026, photo of his screen): a 1 cm grid from the middle of the glass
// and dashed outlines, centred, of the roll-film formats it marks: 6x4.5, 6x7, 6x9 and 6x12 (56 mm high, the long side
// across; turned with the camera in portrait). Drawn in millimetres on the frame box, so it fits any lens; on the 6x17
// back or the Fuji only the 1 cm grid is drawn (the outlines belong to the 4x5 glass).
const ROLL = [{ label: '6×4.5', w: 41.5, right: true }, { label: '6×7', w: 69.5, right: true }, { label: '6×9', w: 84, right: false }, { label: '6×12', w: 112, right: false }];   // labels where the screen has them
export function ChamonixOverlay({ pic, unit, lens }: { pic: { w: number; h: number }; unit: number; lens: { f: number; fw: number; fh: number } }) {
  const k = unit / lens.f;   // dp per mm on the film
  const fW = lens.fw * k, fH = lens.fh * k, fx = (pic.w - fW) / 2, fy = (pic.h - fH) / 2, mx = fx + fW / 2, my = fy + fH / 2;
  const hair = StyleSheet.hairlineWidth * 2;
  const lines: any[] = [];
  for (let d = 10; d < lens.fw / 2; d += 10) for (const sgn of [-1, 1]) lines.push({ left: mx + sgn * d * k, top: fy, width: hair, height: fH });
  for (let d = 10; d < lens.fh / 2; d += 10) for (const sgn of [-1, 1]) lines.push({ left: fx, top: my + sgn * d * k, width: fW, height: hair });
  lines.push({ left: mx, top: fy, width: hair, height: fH }, { left: fx, top: my, width: fW, height: hair });
  const is45 = Math.abs(Math.max(lens.fw, lens.fh) - 120) < 1 && Math.abs(Math.min(lens.fw, lens.fh) - 96) < 1;
  const land = lens.fw >= lens.fh;
  const boxes = is45 ? ROLL.map(r => {
    const w = (land ? r.w : 56) * k, h = (land ? 56 : r.w) * k;
    return { label: r.label, right: r.right, left: mx - w / 2, top: my - h / 2, width: w, height: h };
  }) : [];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((l, i) => <View key={`l${i}`} style={[gridStyles.fine, l]} />)}
      {boxes.map(b => (
        <View key={b.label} style={[gridStyles.roll, { left: b.left, top: b.top, width: b.width, height: b.height }]}>
          <Text style={[gridStyles.rollText, b.right ? { right: 3 } : { left: 3 }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}
const gridStyles = StyleSheet.create({
  fine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)' },
  roll: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.85)' },
  rollText: { position: 'absolute', top: 2, color: 'rgba(255,255,255,0.9)', fontSize: 9, fontWeight: '700', textShadowColor: '#000000', textShadowRadius: 2, textShadowOffset: { width: 0, height: 0 } },
  line: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.7)', shadowColor: '#000000', shadowOpacity: 0.8, shadowRadius: 1, shadowOffset: { width: 0, height: 0 }, elevation: 1 },
});
