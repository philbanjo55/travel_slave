import React, { useEffect, useMemo, useRef, useState } from 'react';
import { hiddenIds, LensLegend, shotColor, useLensFilter, visibleShots } from './lensColors';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Pair, LatLng, destination, distanceM } from '../../utils/sunEngine';
import { SUN } from './sunStyle';
import { shotFov } from './shotFov';
import { useTrailRoutes } from '../../services/trailRoutes';
import type { TrailRoute } from '../../services/trailRoutes';
import { fmtDist, overheadShots, useFindMe } from './overhead3d';

// Split 3D (Phil, 24 Nov 2026, mockup docs/mockups/split_3d_mockup.png): full-screen 3D cut in two, the eye view on top
// and the view from above under it, as Google's Street View split. Sun3DPanel holds the state; this file has the parts
// that are not the 3D page itself:
//   SplitIcon      the button's picture (a frame with its lower half filled)
//   SplitDivider   the grey bar between the halves, dragged to resize (30%-70% of the height)
//   SplitControls  over the lower half: + / -, Find me, Terrain | Satellite, Back, the hint line
//   SplitSatMap    Satellite: Google's satellite map (needs a signal) with the shots, the trails, a blue dot where the eye
//                  view stands now and a cone the way it looks (lens's horizontal angle). A tap on the map moves the eye
//                  view there; a drag that starts on the dot or the arrow at the cone's end turns it.
// Terrain (our own 3D from above, works offline) is drawn by the 3D page itself in the same canvas (S3D.split).

export const SPLIT_MIN = 0.3, SPLIT_MAX = 0.7;
export const SPLIT_HINT = 'Tap the map to stand there · drag your dot to turn';
const coord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });
const MPD_LAT = 110540;
const norm = (d: number) => ((d % 360) + 360) % 360;

export function SplitIcon({ on }: { on: boolean }) {
  const c = '#ffffff'; void on;
  return (
    <View style={[styles.icon, { borderColor: c }]}>
      <View style={[styles.iconHalf, { backgroundColor: c }]} />
    </View>
  );
}

// The bar between the halves. `top` = where the halves meet (dp from the picture's top), `h` = the picture's height.
export function SplitDivider({ top, h, onFrac }: { top: number; h: number; onFrac: (f: number, done: boolean) => void }) {
  const start = useRef(top);
  const live = useRef({ top, h, onFrac });
  live.current = { top, h, onFrac };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = live.current.top; },
    onPanResponderMove: (_e, g) => { const { h: H, onFrac: f } = live.current; if (H > 0) f(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, (start.current + g.dy) / H)), false); },
    onPanResponderRelease: (_e, g) => { const { h: H, onFrac: f } = live.current; if (H > 0) f(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, (start.current + g.dy) / H)), true); },
    onPanResponderTerminate: () => {},
  }), []);
  return (
    <View style={[styles.divider, { top: top - 11 }]} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Drag to resize the two halves" hitSlop={{ top: 6, bottom: 6 }}>
      <View style={styles.dividerBar}><View style={styles.dividerGrip} /></View>
    </View>
  );
}

export type SplitMode = 'terrain' | 'satellite';

// Over the lower half (`top` = its top, dp): zoom and Find me on the right, the two chips and the hint at the bottom.
export function SplitControls({ top, mode, onMode, onZoom, meOn, onMe, onMeOff, meLine, jumps, onBack, walking }: {
  top: number; mode: SplitMode; onMode: (m: SplitMode) => void; onZoom: (k: number) => void;
  meOn: boolean; onMe: () => void; onMeOff: () => void; meLine: string | null; jumps: number; onBack: () => void; walking: boolean;
}) {
  return (
    <>
      <View style={[styles.zoomCol, { top: top + 14 }]} pointerEvents="box-none">
        <View style={styles.zoomBox}>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => onZoom(2)} accessibilityLabel="Zoom the map in" hitSlop={4}>
            <Text style={styles.zoomText}>+</Text>
          </TouchableOpacity>
          <View style={styles.zoomSep} />
          <TouchableOpacity style={styles.zoomBtn} onPress={() => onZoom(0.5)} accessibilityLabel="Zoom the map out" hitSlop={4}>
            <Text style={styles.zoomText}>−</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.meBtn, meOn && styles.meBtnOn]}
          onPress={onMe}
          onLongPress={onMeOff}
          accessibilityRole="switch"
          accessibilityState={{ checked: meOn }}
          accessibilityLabel={meOn ? 'Find me is on. Tap to centre, hold to turn it off' : 'Find me: show where you are'}
          hitSlop={4}
        >
          <Ionicons name="locate" size={20} color={meOn ? '#4285F4' : '#ffffff'} />
        </TouchableOpacity>
      </View>
      <View style={styles.bottomCol} pointerEvents="box-none">
        <View style={styles.chipRow} pointerEvents="box-none">
          <View style={styles.chips} accessibilityRole="tablist">
            {(['terrain', 'satellite'] as const).map(m => (
              <TouchableOpacity
                key={m}
                onPress={() => onMode(m)}
                style={[styles.chip, mode === m && styles.chipOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                accessibilityLabel={m === 'terrain' ? 'Terrain: our 3D from above, works offline' : 'Satellite: Google satellite map, needs a signal'}
              >
                <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{m === 'terrain' ? 'Terrain' : 'Satellite'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {jumps > 0 && !walking ? (
            <TouchableOpacity onPress={onBack} style={styles.backChip} accessibilityRole="button" accessibilityLabel="Back: undo the last move">
              <Ionicons name="arrow-undo" size={14} color="#ffffff" />
              <Text style={styles.chipText}>Back</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText} numberOfLines={1}>{meLine ?? SPLIT_HINT}</Text>
        </View>
      </View>
    </>
  );
}

// '#rrggbb' -> 'rgba(r,g,b,a)' (blue when there is no lens colour)
const withAlpha = (hex: string | undefined, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  const c = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [66, 133, 244];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
};

type Cam = { lat: number; lng: number; heading: number; zoom: number };
export type SatReq = { n: number; zoom?: number; center?: LatLng };

// The satellite half. `eye` = where the eye view stands now, `yaw` = where it looks (compass degrees), `fov` = the lens's
// horizontal angle (degrees). onGo / onYaw move and turn the eye view (the panel sends them to the page).
export function SplitSatMap({ pairs, sel, eye, yaw, fov, routes, me, req, onGo, onYaw, onPick, viewColor }: {
  pairs: Pair[]; sel: Pair; eye: LatLng; yaw: number | null; fov: number; routes: TrailRoute[];
  me: { lat: number; lng: number } | null; req: SatReq; onGo: (p: LatLng) => void; onYaw: (deg: number, done: boolean) => void;
  onPick?: (vantageId: string) => void;   // another shot's dot: open that shot as saved (25 Nov 2026)
  viewColor?: string;
}) {
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const aim = shotFov(sel).aim ?? 0;   // the map faces the shot's aim, as the Overhead tab's "my view"; it does not turn
  const cosl0 = Math.cos((eye.lat * Math.PI) / 180);
  const start = useMemo(() => {
    let spread = 30;
    for (const p of pairs) spread = Math.max(spread, distanceM(eye, p.v));
    const w = size.w || 412, h = size.h || 380;
    const mpp = (spread * 2.4 + 100) / Math.max(80, Math.min(w, h) - 70);
    const zoom = Math.min(21, Math.max(3, Math.log2((156543.03392 * cosl0) / mpp)));
    return { zoom, center: destination(eye, aim, mpp * h * 0.15) };
  // the first camera only: later the map stays where it was put
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w > 0, sel.vantage_id]);
  const [cam, setCam] = useState<Cam | null>(null);
  const shown: Cam = cam ?? { lat: start.center.lat, lng: start.center.lng, heading: aim, zoom: start.zoom };
  const mpp = (156543.03392 * Math.cos((shown.lat * Math.PI) / 180)) / Math.pow(2, shown.zoom);   // metres per dp
  const toScreen = (q: LatLng) => {
    const dN = (q.lat - shown.lat) * MPD_LAT, dE = (q.lng - shown.lng) * 111320 * Math.cos((shown.lat * Math.PI) / 180);
    const t = (shown.heading * Math.PI) / 180;
    return { x: size.w / 2 + (dE * Math.cos(t) - dN * Math.sin(t)) / mpp, y: size.h / 2 - (dE * Math.sin(t) + dN * Math.cos(t)) / mpp };
  };
  useEffect(() => {
    if (!size.w) return;
    mapRef.current?.setCamera({ center: coord(start.center), heading: aim, pitch: 0, zoom: start.zoom });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  const onRegion = () => {
    mapRef.current?.getCamera().then(c => {
      if (!c?.center) return;
      setCam({ lat: c.center.latitude, lng: c.center.longitude, heading: c.heading ?? aim, zoom: c.zoom ?? shown.zoom });
    }).catch(() => {});
  };
  // + / - and Find me from the controls
  const reqSeen = useRef(req.n);   // (a request made before this map was shown is not done again)
  useEffect(() => {
    if (!req.n || req.n === reqSeen.current) return;
    reqSeen.current = req.n;
    const z = req.zoom != null ? Math.min(21, Math.max(3, shown.zoom + Math.log2(req.zoom))) : shown.zoom;
    mapRef.current?.animateCamera({ center: coord(req.center ?? { lat: shown.lat, lng: shown.lng }), heading: shown.heading, pitch: 0, zoom: z }, { duration: 250 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.n]);
  // the eye view walked or jumped off the map (Back, the walk arrows, a tap on the eye view): bring it back in
  useEffect(() => {
    if (!size.w || !cam) return;
    const s = toScreen(eye);
    if (s.x < size.w * 0.12 || s.x > size.w * 0.88 || s.y < size.h * 0.12 || s.y > size.h * 0.88) mapRef.current?.animateCamera({ center: coord(eye) }, { duration: 300 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eye.lat, eye.lng]);

  // the turn: the finger's direction from the dot on the screen, plus the map's heading (the map does not turn)
  const [dragYaw, setDragYaw] = useState<number | null>(null);
  const look = dragYaw ?? yaw ?? aim;
  const L = 90 * mpp, half = fov / 2;
  const cone = useMemo(() => {
    const pts = [coord(eye)];
    for (let i = 0; i <= 12; i++) pts.push(coord(destination(eye, look - half + (fov * i) / 12, L)));
    return pts;
  }, [eye.lat, eye.lng, look, half, fov, L]);
  const tip = destination(eye, look, L + 14 * mpp);
  const dotPt = toScreen(eye), tipPt = toScreen(tip);
  const live = useRef({ dotPt, heading: shown.heading, onYaw });
  live.current = { dotPt, heading: shown.heading, onYaw };
  const grab = useRef({ x: 0, y: 0, last: 0 });
  const turnTo = (x: number, y: number, done: boolean) => {
    const { dotPt: d, heading, onYaw: f } = live.current;
    if (Math.hypot(x - d.x, y - d.y) < 6) return;
    const deg = norm((Math.atan2(x - d.x, -(y - d.y)) * 180) / Math.PI + heading);
    setDragYaw(done ? null : deg);
    const t = Date.now();
    if (done || t - grab.current.last >= 80) { grab.current.last = t; f(deg, done); }
  };
  const makePan = (where: () => { x: number; y: number }) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => { const o = where(); grab.current.x = o.x + e.nativeEvent.locationX; grab.current.y = o.y + e.nativeEvent.locationY; },
    onPanResponderMove: (_e, g) => turnTo(grab.current.x + g.dx, grab.current.y + g.dy, false),
    onPanResponderRelease: (_e, g) => turnTo(grab.current.x + g.dx, grab.current.y + g.dy, true),
    onPanResponderTerminate: () => setDragYaw(null),
  });
  const HIT = 52, DOT = 40;
  const tipBox = useRef({ x: 0, y: 0 }), dotBox = useRef({ x: 0, y: 0 });
  tipBox.current = { x: tipPt.x - HIT / 2, y: tipPt.y - HIT / 2 }; dotBox.current = { x: dotPt.x - DOT / 2, y: dotPt.y - DOT / 2 };
  const tipPan = useMemo(() => makePan(() => tipBox.current), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const dotPan = useMemo(() => makePan(() => dotBox.current), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const [track, setTrack] = useState(true);   // markers with their own views are redrawn only for a moment
  useEffect(() => { setTrack(true); const t = setTimeout(() => setTrack(false), 700); return () => clearTimeout(t); }, [sel.vantage_id, pairs.length]);
  const selFov = shotFov(sel);
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });
  const inMap = (p: { x: number; y: number }) => size.w > 0 && p.x > -20 && p.y > -20 && p.x < size.w + 20 && p.y < size.h + 20;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} accessibilityLabel="Satellite map under the 3D view">
      {size.w > 0 ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          mapType="satellite"
          initialCamera={{ center: coord(start.center), heading: aim, pitch: 0, zoom: start.zoom, altitude: 0 }}
          showsUserLocation={!!me}
          showsMyLocationButton={false}
          onRegionChangeComplete={onRegion}
          onPress={e => { const c = e.nativeEvent.coordinate; if (c) onGo({ lat: c.latitude, lng: c.longitude }); }}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsCompass={false}
          moveOnMarkerPress={false}
        >
          {routes.map(r => (
            <React.Fragment key={`rt-${r.id}`}>
              {/* a dark edge under the colour, as on the terrain map (white and sand read on snow too) */}
              <Polyline coordinates={r.coords.map(c => ({ latitude: c[1], longitude: c[0] }))} strokeColor="rgba(0,0,0,0.55)" strokeWidth={7} />
              <Polyline coordinates={r.coords.map(c => ({ latitude: c[1], longitude: c[0] }))} strokeColor={r.color ?? '#FFFFFF'} strokeWidth={3.5} lineDashPattern={r.dash ? [10, 7] : undefined} />
            </React.Fragment>
          ))}
          {selFov.aim != null ? (
            <Polyline coordinates={[coord(destination(sel.v, selFov.aim - selFov.fov / 2, Math.max(distanceM(sel.v, sel.s), 20 * mpp))), coord(sel.v), coord(destination(sel.v, selFov.aim + selFov.fov / 2, Math.max(distanceM(sel.v, sel.s), 20 * mpp)))]} strokeColor={SUN} strokeWidth={2} />
          ) : null}
          <Polyline coordinates={[coord(sel.v), coord(sel.s)]} strokeColor="#ffffff" strokeWidth={2.5} />
          <Circle center={coord(sel.s)} radius={7 * mpp} fillColor="#000000" strokeColor="#ffffff" strokeWidth={2} />
          {pairs.map(p => {
            const on = p.vantage_id === sel.vantage_id;
            return (
              <Marker key={`m-${p.vantage_id}-${on ? 1 : 0}`} coordinate={coord(p.v)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track}
                onPress={() => (!on && onPick ? onPick(p.vantage_id) : onGo(p.v))} accessibilityLabel={on ? `Stand at shot ${p.code ?? ''}` : `Open shot ${p.code ?? ''}`}>
                <View style={styles.spotWrap}>
                  <View style={[styles.spot, { backgroundColor: shotColor(p) }, on && styles.spotOn, on && { borderColor: shotColor(p) }]} />
                  <Text style={styles.pinLabel}>{on && p.starred ? '★ ' : ''}{p.code || '•'}</Text>
                </View>
              </Marker>
            );
          })}
          <Polygon coordinates={cone} fillColor={withAlpha(viewColor, 0.35)} strokeColor={withAlpha(viewColor, 0.9)} strokeWidth={1.5} />
          <Marker coordinate={coord(eye)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track}>
            <View style={[styles.meDot, viewColor ? { backgroundColor: '#ffffff', borderColor: viewColor, borderWidth: 5, width: 22, height: 22, borderRadius: 11 } : null]} />
          </Marker>
        </MapView>
      ) : null}
      {/* where a finger can take hold of the dot or the arrow (the map's own markers cannot be dragged without a long press) */}
      {inMap(dotPt) ? <View style={[styles.hit, { left: dotBox.current.x, top: dotBox.current.y, width: DOT, height: DOT, borderRadius: DOT / 2 }]} {...dotPan.panHandlers} accessibilityLabel="Where you stand in the view. Drag to turn" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 16, height: 16, borderWidth: 1.5, borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  iconHalf: { height: 6 },
  divider: { position: 'absolute', left: 0, right: 0, height: 22, justifyContent: 'center' },
  dividerBar: { height: 12, backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000000' },
  dividerGrip: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#8a8a8a' },
  zoomCol: { position: 'absolute', right: 12, alignItems: 'center', gap: 10 },
  zoomBox: { borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444' },
  zoomBtn: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: '#ffffff', fontSize: 20, fontWeight: '600', lineHeight: 22 },
  zoomSep: { height: 1, backgroundColor: '#444444' },
  meBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
  meBtnOn: { borderColor: '#4285F4' },
  bottomCol: { position: 'absolute', left: 12, right: 12, bottom: 10, gap: 8 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444' },
  chipOn: { backgroundColor: '#5aaa7a', borderColor: '#5aaa7a' },
  chipText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#ffffff' },
  backChip: { minHeight: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444' },
  hint: { alignItems: 'center' },
  hintText: { color: '#ffffff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden', maxWidth: '100%' },
  spotWrap: { alignItems: 'center' },
  spot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#000000', borderWidth: 2, borderColor: '#ffffff', shadowColor: '#000000', shadowOpacity: 0.9, shadowRadius: 1.5, elevation: 2 },
  spotOn: { width: 22, height: 22, borderRadius: 11, borderWidth: 5, backgroundColor: '#ffffff' },   // the shot you are on: white with a ring in its lens's colour
  pinLabel: { marginTop: 1, color: '#ffffff', fontSize: 12, fontWeight: '700', textShadowColor: '#000000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  handle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffffff', borderWidth: 2.5, borderColor: '#4285F4', alignItems: 'center', justifyContent: 'center' },
  handleArrow: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 11, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#4285F4', marginBottom: 2 },
  meDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#4285F4', borderWidth: 3, borderColor: '#ffffff' },
  hit: { position: 'absolute' },
  mapBox: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#0b0e0c' },
});

// Everything the split needs that the plain view must not pay for (Jenny Lake froze the emulator while these hooks
// lived in Sun3DPanel with split off): the stop's shots and trails, Find me, the page told what each half is, the lower
// half's controls, the satellite map and the divider. Sun3DPanel mounts this ONLY while split is on (full screen, chosen,
// not HD); on unmount the page gets the whole view back. `sink`: Sun3DPanel hands it the page's 'look' / 'overheadMe'
// messages (none of them reach Sun3DPanel's own state).
export function SplitLayer({ run, ready, readyN, mode, onMode, top, h, frac, onFrac, pair, others, eye, lens, jumps, walking, sink, onPick, viewColor }: {
  run: (js: string) => void; ready: boolean; readyN: number; mode: SplitMode; onMode: (m: SplitMode) => void;
  top: number; h: number; frac: number; onFrac: (f: number) => void; pair: Pair; others?: Pair[]; eye: LatLng;
  lens: { f: number; fw: number }; jumps: number; walking: boolean; sink: React.MutableRefObject<((m: any) => void) | null>;
  onPick?: (vantageId: string) => void;
  viewColor?: string;   // the lens you look through: your dot and cone take its colour (25 Nov 2026)
}) {
  useEffect(() => { if (ready) run(`window.S3D.viewColor && window.S3D.viewColor(${JSON.stringify(viewColor ?? '')})`); }, [ready, readyN, viewColor, run]);
  const ter = mode === 'terrain', sat = !ter;
  const pairs = useMemo(() => {
    const list = others && others.length ? others : [pair];
    return list.some(p => p.vantage_id === pair.vantage_id) ? list : [pair, ...list];
  }, [others, pair]);
  const hide = useLensFilter();   // the lenses unticked in the map's key (the shot you are on always shows)
  const shown = useMemo(() => visibleShots(pairs, pair.vantage_id, hide), [pairs, pair.vantage_id, hide]);
  const shotsKey = JSON.stringify(overheadShots(pairs, pair.vantage_id));   // every shot: the filter only hides dots (below)
  const hideKey = useMemo(() => JSON.stringify(hiddenIds(pairs, pair.vantage_id, hide)), [pairs, pair.vantage_id, hide]);
  useEffect(() => { if (ready && ter) run(`window.S3D.shotsHide && window.S3D.shotsHide(${hideKey})`); }, [ready, readyN, ter, hideKey, run]);
  const routes = useTrailRoutes(useMemo(() => pairs.map(p => p.v), [pairs]));
  const routesKey = routes.map(r => `${r.id}:${r.coords.length}:${r.color ?? ''}`).join('|');
  const fracRef = useRef(frac);
  // Terrain: the page draws both halves; Satellite: the page is the plain eye view and posts `look` while dragged
  useEffect(() => {
    if (!ready) return;
    run(ter ? `window.S3D.split && window.S3D.split({ "on": true, "frac": ${fracRef.current.toFixed(4)}, "shots": ${shotsKey} })` : 'window.S3D.split && window.S3D.split({ on: false })');
    run(`window.S3D.liveLook && window.S3D.liveLook(${sat ? 'true' : 'false'})`);
  }, [ready, readyN, ter, sat, shotsKey, run]);
  useEffect(() => () => { run('window.S3D.split && window.S3D.split({ on: false })'); run('window.S3D.liveLook && window.S3D.liveLook(false)'); }, [run]);
  useEffect(() => {
    if (ready) run(`window.S3D.overheadRoutes && window.S3D.overheadRoutes(${JSON.stringify(routes)})`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, readyN, routesKey, run]);
  // the divider: the page follows at most every 50 ms, and once more when the finger lifts
  const fracSent = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null }>({ t: 0, timer: null });
  useEffect(() => () => { if (fracSent.current.timer) clearTimeout(fracSent.current.timer); }, []);
  const dividerMoved = (f: number, done: boolean) => {
    fracRef.current = f; onFrac(f);
    if (!ter) return;
    const c = fracSent.current, send = () => { c.t = Date.now(); c.timer = null; run(`window.S3D.split && window.S3D.split({ on: true, frac: ${fracRef.current.toFixed(4)} })`); };
    if (c.timer) clearTimeout(c.timer);
    const wait = done ? 0 : 50 - (Date.now() - c.t);
    if (wait <= 0) send(); else c.timer = setTimeout(send, wait);
  };
  // the page's messages for the split: the eye view's heading (Satellite's cone, in whole degrees) and Find me off the map
  const [yaw, setYaw] = useState<number | null>(null);
  const [meOut, setMeOut] = useState(false);
  useEffect(() => {
    sink.current = m => {
      if (m.type === 'overheadMe') setMeOut(!!m.outside);
      else if (m.type === 'look' && sat && typeof m.yaw === 'number') { const y = Math.round(m.yaw); setYaw(p => (p === y ? p : y)); }
    };
    return () => { sink.current = null; };
  }, [sink, sat]);
  const me = useFindMe(true);
  const meSent = useRef(false);
  const [req, setReq] = useState<SatReq>({ n: 0 });
  useEffect(() => { meSent.current = false; }, [mode]);
  useEffect(() => {
    if (!ready || !ter) return;
    if (!me.on || !me.pos) { run('window.S3D.overheadMe && window.S3D.overheadMe(null)'); meSent.current = false; return; }
    const msg = { lat: me.pos.lat, lng: me.pos.lng, acc: me.pos.acc, heading: me.heading, center: !meSent.current, span: meSent.current ? undefined : 900 };
    meSent.current = true;
    run(`window.S3D.overheadMe && window.S3D.overheadMe(${JSON.stringify(msg)})`);
  }, [ready, ter, me.on, me.pos, me.heading, run]);
  useEffect(() => {   // Satellite: centre on you the first time Find me has a fix
    if (!sat || !me.on || !me.pos || meSent.current) return;
    meSent.current = true; setReq(r => ({ n: r.n + 1, center: { lat: me.pos!.lat, lng: me.pos!.lng } }));
  }, [sat, me.on, me.pos]);
  const zoom = (k: number) => { if (ter) run(`window.S3D.overheadZoom(${k})`); else setReq(r => ({ n: r.n + 1, zoom: k })); };
  const findMe = () => {
    meSent.current = false; me.setOn(true);
    if (!me.pos) return;
    meSent.current = true;
    if (ter) run(`window.S3D.overheadMe && window.S3D.overheadMe(${JSON.stringify({ lat: me.pos.lat, lng: me.pos.lng, acc: me.pos.acc, heading: me.heading, center: true })})`);
    else setReq(r => ({ n: r.n + 1, center: { lat: me.pos!.lat, lng: me.pos!.lng } }));
  };
  const meLine = !me.on ? null : me.perm === 'no' ? 'Location is off for this app' : !me.pos ? 'Finding you…'
    : `${meOut && ter ? "You're outside this map" : `You · ±${Math.max(1, Math.round(me.pos.acc ?? 0))} m`} · ${fmtDist(distanceM(me.pos, pair.v))} to ${pair.code ?? 'the shot'}`;
  return (
    <>
      {sat ? (
        <View style={[styles.mapBox, { top }]}>
          <SplitSatMap
            pairs={shown} sel={pair} eye={eye} yaw={yaw} fov={(2 * Math.atan(lens.fw / (2 * lens.f)) * 180) / Math.PI} routes={routes}
            me={me.on && me.pos ? me.pos : null} req={req}
            onGo={p => run(`window.S3D.goTo && window.S3D.goTo(${p.lat},${p.lng})`)}
            onYaw={deg => { setYaw(Math.round(deg)); run(`window.S3D.yaw && window.S3D.yaw(${deg.toFixed(2)})`); }}
            onPick={onPick} viewColor={viewColor}
          />
        </View>
      ) : null}
      {ready ? <LensLegend pairs={pairs} style={{ left: 12, top: top + 12 }} /> : null}
      {ready ? (
        <SplitControls top={top} mode={mode} onMode={onMode} onZoom={zoom} meOn={me.on} onMe={findMe} onMeOff={() => me.setOn(false)}
          meLine={meLine} jumps={jumps} walking={walking} onBack={() => run('window.S3D.back && window.S3D.back()')} />
      ) : null}
      <SplitDivider top={top} h={h} onFrac={dividerMoved} />
    </>
  );
}
