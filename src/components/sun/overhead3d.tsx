import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { Pair } from '../../utils/sunEngine';
import { distanceM } from '../../utils/sunEngine';
import { declinationDeg } from '../../utils/declination';
import { SUN, shortName } from './sunStyle';
import { shotFov } from './shotFov';
import type { TrailRoute } from '../../services/trailRoutes';

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
  routes?: TrailRoute[];          // Phil's AllTrails routes through the place (services/trailRoutes), a pink line on the ground
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

  // the trails, sent once the page is ready and again when they change (they come from the phone's cache or the server)
  const routes = overhead?.routes ?? [];
  const routesKey = routes.map(r => `${r.id}:${r.coords.length}`).join('|');
  useEffect(() => {
    if (!on || !ready) return;
    run(`window.S3D.overheadRoutes && window.S3D.overheadRoutes(${JSON.stringify(routes)})`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ready, routesKey, run]);

  // Find me (Phil, 23 Nov 2026): the phone's GPS spot on the picture. Works with no signal (GPS needs none).
  const me = useFindMe(on);
  const meSent = useRef(false);
  useEffect(() => {
    if (!on || !ready) return;
    if (!me.on || !me.pos) { run('window.S3D.overheadMe && window.S3D.overheadMe(null)'); meSent.current = false; return; }
    const msg = { lat: me.pos.lat, lng: me.pos.lng, acc: me.pos.acc, heading: me.heading, center: !meSent.current, span: meSent.current ? undefined : 900 };
    meSent.current = true;
    run(`window.S3D.overheadMe && window.S3D.overheadMe(${JSON.stringify(msg)})`);
  }, [on, ready, me.on, me.pos, me.heading, run]);
  const recenter = () => { meSent.current = false; me.setOn(true); if (me.pos) run(`window.S3D.overheadMe && window.S3D.overheadMe(${JSON.stringify({ lat: me.pos.lat, lng: me.pos.lng, acc: me.pos.acc, heading: me.heading, center: true })})`); };
  const selPair = (overhead?.pairs ?? []).find(p => p.vantage_id === overhead?.selId);
  const meLine = !me.on ? null
    : me.perm === 'no' ? 'Location is off for this app'
    : !me.pos ? 'Finding you…'
    : `You · ±${Math.max(1, Math.round(me.pos.acc ?? 0))} m${selPair ? ` · ${fmtDist(distanceM(me.pos, selPair.v))} to ${selPair.code ?? 'the shot'}` : ''}`;

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
      <TouchableOpacity
        style={[styles.meBtn, me.on && styles.meBtnOn]}
        onPress={() => (me.on && me.pos ? (meSent.current ? me.setOn(false) : recenter()) : recenter())}
        onLongPress={() => me.setOn(false)}
        accessibilityRole="switch"
        accessibilityState={{ checked: me.on }}
        accessibilityLabel={me.on ? 'Find me is on. Tap to turn it off' : 'Find me: show where you are'}
        hitSlop={4}
      >
        <Ionicons name="locate" size={20} color={me.on ? '#4285F4' : '#ffffff'} />
      </TouchableOpacity>
      {meLine ? (
        <View style={styles.mePill} pointerEvents="none"><Text style={styles.meText} numberOfLines={1}>{meLine}</Text></View>
      ) : null}
      <TouchableOpacity onPress={onFull} style={styles.fullBtn} accessibilityRole="button" accessibilityLabel={full ? 'Close the overhead view' : 'Open the overhead view full screen'} hitSlop={6}>
        <Ionicons name={full ? 'close' : 'expand-outline'} size={18} color="#ffffff" />
      </TouchableOpacity>
    </>
  );
  return { onMessage, controls };
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`);
const normDeg = (d: number) => ((d % 360) + 360) % 360;
let findMeOn = false;   // kept while the app is open, so full screen opens the way the small view was

// The phone's position and facing while Find me is on (the same reading as WalkToShot: true north from the magnetic
// heading plus the declination where the phone is, smoothed so the fan doesn't shake).
function useFindMe(active: boolean) {
  const [on, setOnState] = useState(findMeOn);
  const setOn = useCallback((v: boolean) => { findMeOn = v; setOnState(v); }, []);
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number | null } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [perm, setPerm] = useState<'asking' | 'ok' | 'no'>('asking');
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const smooth = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!active || !on) { setPos(null); setHeading(null); return; }
    let alive = true;
    const subs: { remove: () => void }[] = [];
    smooth.current = null;
    (async () => {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (!alive) return;
        if (p.status !== 'granted') { setPerm('no'); return; }
        setPerm('ok');
        subs.push(await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
          l => { if (!alive) return; posRef.current = { lat: l.coords.latitude, lng: l.coords.longitude }; setPos({ lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? null }); },
        ));
        try {
          subs.push(await Location.watchHeadingAsync(h => {
            if (!alive) return;
            const q = posRef.current, dec = q ? declinationDeg(q.lat, q.lng) : null;
            const deg = h.magHeading != null && h.magHeading >= 0 && dec != null ? normDeg(h.magHeading + dec)
              : h.trueHeading != null && h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            if (deg == null || deg < 0) return;
            const r = (deg * Math.PI) / 180, s = smooth.current;
            const n = s ? { x: s.x * 0.7 + Math.sin(r) * 0.3, y: s.y * 0.7 + Math.cos(r) * 0.3 } : { x: Math.sin(r), y: Math.cos(r) };
            smooth.current = n;
            setHeading(Math.round(normDeg((Math.atan2(n.x, n.y) * 180) / Math.PI)));
          }));
        } catch { /* no compass: the dot alone */ }
      } catch {
        if (alive) setPerm('no');
      }
    })();
    return () => { alive = false; subs.forEach(s => { try { s.remove(); } catch { /* gone */ } }); };
  }, [active, on]);
  return { on, setOn, pos, heading, perm };
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
  meBtn: { position: 'absolute', right: 13, top: 153, width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
  meBtnOn: { borderColor: '#4285F4' },
  mePill: { position: 'absolute', bottom: 12, left: 52, right: 52, alignItems: 'center' },
  meText: { color: '#ffffff', fontSize: 12, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  fullBtn: { position: 'absolute', left: 8, bottom: 8, width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
});
