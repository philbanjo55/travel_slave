import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Pair } from '../../utils/sunEngine';
import { SUN, shortName } from './sunStyle';
import { shotFov } from './shotFov';

// Overhead, our own 3D look (Phil, 16 Nov 2026): the 3D page (tools/sun3d/app_view.js) looking straight down over every
// shot of the place, with our winter ground, buildings, trees and the real calculated shadows at the slider's time,
// and it works with no signal (the terrain is saved on the phone). Sun3DPanel does the terrain, foreground and sun as
// for the 3D tab; with its `overhead` prop it hides the perspective controls and shows these instead: Sun on / off,
// the compass (my view / north up), + / -, full screen. Drawn by the page over the picture, as the satellite Overhead
// (OverheadMapPanel) draws it: stand spots, framing wedges, the line / tag to the subject, the sun band and arrows.

export type Overhead3D = {
  pairs: Pair[];                  // every shot of the place
  selId: string;                  // the picked shot (Sun3DPanel's `pair` must be this one)
  onPick: (p: Pair) => void;      // a stand spot tapped on the picture
  sunOn: boolean;
  onSun: (on: boolean) => void;
  shaded?: boolean;               // a ridge shades the picked shot's subject now (grey arrows); left out = the page works it out
};

type Mode = 'view' | 'north' | 'turned';
let lastMode: Mode = 'view';
// The cone, the other shots' wedges and the sun arrows on or off (Phil, 17 Nov 2026: hide them to see the ground);
// shared by the 3D and satellite looks, kept while the app is open.
let marksOn = true;
const marksSubs = new Set<(v: boolean) => void>();
export function useOverheadMarks(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(marksOn);
  useEffect(() => { marksSubs.add(setV); return () => { marksSubs.delete(setV); }; }, []);
  const set = useCallback((x: boolean) => { marksOn = x; marksSubs.forEach(f => f(x)); }, []);
  return [v, set];
}   // kept while the app is open, so full screen opens the way the small view was

// The page's shot list: stand spot, subject, framing heading (null = toward the subject) and the lens's angle across.
export function overheadShots(pairs: Pair[], selId: string) {
  return pairs.map(p => {
    const f = shotFov(p);
    return {
      id: p.vantage_id, code: p.code ?? null, name: p.shot_name ?? p.vantage_name ?? null, subject: shortName(p.subject_name),
      v: p.v, s: p.s, heading_deg: p.framing ? p.framing.heading : null, fov_deg: Math.round(f.fov * 10) / 10,
      star: !!p.starred, sel: p.vantage_id === selId,
    };
  });
}

// Wires the page's overhead mode to the panel: sends the shots, the picked one, Sun and shade once the page is ready
// (again whenever they change: the page keeps its zoom and position), takes its taps and turns, and draws the buttons.
export function useOverhead3D({ overhead, ready, run, full, onFull }: {
  overhead?: Overhead3D; ready: boolean; run: (js: string) => void; full?: boolean; onFull: () => void;
}) {
  const [mode, setModeState] = useState<Mode>(lastMode);
  const [up, setUp] = useState(0);   // the compass heading at the top of the picture, as the page last said
  const setMode = useCallback((m: Mode) => { lastMode = m; setModeState(m); }, []);
  const pairsRef = useRef<Pair[]>([]);
  pairsRef.current = overhead?.pairs ?? [];
  const pickRef = useRef<((p: Pair) => void) | null>(null);
  pickRef.current = overhead?.onPick ?? null;
  const on = !!overhead;
  const shots = useMemo(() => (overhead ? overheadShots(overhead.pairs, overhead.selId) : []), [overhead?.pairs, overhead?.selId]);
  const shotsKey = JSON.stringify(shots);
  const sunOn = overhead?.sunOn ?? true, shaded = overhead?.shaded;
  const [marks, setMarks] = useOverheadMarks();
  const firstSent = useRef(false);
  useEffect(() => { if (!ready) firstSent.current = false; }, [ready]);
  useEffect(() => {
    if (!on || !ready) return;
    const msg: Record<string, unknown> = { on: true, shots, sun: sunOn, marks, shaded: typeof shaded === 'boolean' ? shaded : null };
    if (!firstSent.current) { msg.heading_up_deg = lastMode === 'north' ? 'north' : 'view'; firstSent.current = true; }
    run(`window.S3D.overhead && window.S3D.overhead(${JSON.stringify(msg)})`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ready, shotsKey, sunOn, shaded, marks, run]);

  // true = the page's message was for the overhead view
  const onMessage = useCallback((m: any): boolean => {
    if (m.type === 'overheadTap') { const p = pairsRef.current.find(x => x.vantage_id === m.id); if (p && pickRef.current) pickRef.current(p); return true; }
    if (m.type === 'overheadView' || m.type === 'overhead') {
      if (typeof m.up === 'number') setUp(m.up);
      if (m.mode === 'view' || m.mode === 'north' || m.mode === 'turned') setMode(m.mode);
      return true;
    }
    return false;
  }, [setMode]);

  const compass = () => run(`window.S3D.overheadUp(${mode === 'view' ? '"north"' : '"view"'})`);
  const zoom = (k: number) => run(`window.S3D.overheadZoom(${k})`);
  const controls = !on ? null : (
    <>
      <TouchableOpacity
        onPress={() => overhead!.onSun(!sunOn)}
        style={[styles.sunBtn, sunOn && styles.sunBtnOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: sunOn }}
        accessibilityLabel={sunOn ? 'Sun on' : 'Sun off'}
        hitSlop={6}
      >
        <Text style={[styles.sunText, sunOn && { color: '#000000' }]}>☀ SUN</Text>
      </TouchableOpacity>
      <MarksButton on={marks} onPress={() => setMarks(!marks)} />
      <TouchableOpacity
        style={styles.compassBtn}
        onPress={compass}
        accessibilityRole="button"
        accessibilityLabel={mode === 'view' ? 'Picture faces the shot. Tap for north up' : 'Tap to face the shot'}
        hitSlop={8}
      >
        <View style={[styles.compass, mode === 'north' && styles.compassNorth]}>
          <View style={[styles.needleWrap, { transform: [{ rotate: `${-up}deg` }] }]}>
            <Text style={styles.needleN}>N</Text>
            <View style={styles.needle} />
          </View>
        </View>
        <Text style={[styles.modeText, mode === 'north' && { color: '#ffffff' }]}>{mode === 'view' ? 'MY VIEW' : mode === 'north' ? 'NORTH UP' : 'TURNED'}</Text>
      </TouchableOpacity>
      <View style={styles.zoomBox}>
        <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(2)} accessibilityLabel="Zoom in" hitSlop={4}>
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>
        <View style={styles.zoomSep} />
        <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(0.5)} accessibilityLabel="Zoom out" hitSlop={4}>
          <Text style={styles.zoomText}>−</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onFull} style={styles.fullBtn} accessibilityRole="button" accessibilityLabel={full ? 'Close the overhead view' : 'Open the overhead view full screen'} hitSlop={6}>
        <Ionicons name={full ? 'close' : 'expand-outline'} size={18} color="#ffffff" />
      </TouchableOpacity>
    </>
  );
  return { onMessage, controls };
}

// Cone and sun arrows on / off, under the Sun button (both looks)
export function MarksButton({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.marksBtn, on && styles.marksBtnOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? 'Cone and sun arrows shown. Tap to hide' : 'Cone and sun arrows hidden. Tap to show'}
      hitSlop={6}
    >
      <Ionicons name={on ? 'triangle' : 'triangle-outline'} size={11} color={on ? '#000000' : '#ffffff'} style={{ transform: [{ rotate: '180deg' }] }} />
      <Text style={[styles.sunText, on && { color: '#000000' }]}>CONE</Text>
    </TouchableOpacity>
  );
}

// The same look as OverheadMapPanel's buttons.
const styles = StyleSheet.create({
  sunBtn: { position: 'absolute', left: 8, top: 8, borderRadius: 6, borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 9, paddingVertical: 6 },
  sunBtnOn: { backgroundColor: SUN, borderColor: SUN },
  sunText: { color: '#ffffff', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  marksBtn: { position: 'absolute', left: 8, top: 46, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 6, borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 9, paddingVertical: 6 },
  marksBtnOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  compassBtn: { position: 'absolute', right: 6, top: 6, alignItems: 'center', width: 60 },
  compass: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
  compassNorth: { borderColor: '#ffffff', borderWidth: 1.5 },
  needleWrap: { width: 34, height: 34, alignItems: 'center' },
  needleN: { color: '#ffffff', fontSize: 8, fontWeight: '700', marginTop: 1, lineHeight: 9 },
  needle: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ffffff' },
  modeText: { marginTop: 3, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: '#aaaaaa', textShadowColor: '#000', textShadowRadius: 3 },
  zoomBox: { position: 'absolute', right: 13, top: 78, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444' },
  zoomBtn: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: '#ffffff', fontSize: 18, fontWeight: '600', lineHeight: 20 },
  zoomSep: { height: 1, backgroundColor: '#444444' },
  fullBtn: { position: 'absolute', left: 8, bottom: 8, width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
});
