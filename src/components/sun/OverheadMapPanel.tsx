import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Modal } from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Pair, LatLng, SkyPos, SUN_UP_GEO, destination, distanceM } from '../../utils/sunEngine';
import { SUN, shortName } from './sunStyle';
import { shotFov } from './shotFov';
import { MarksButton, useOverheadMarks } from './overhead3d';

// Overhead, satellite look (Phil, 16 Nov 2026): every shot of the place from above on Google's satellite map: each
// stand spot, its framing as a wedge (saved heading, lens and landscape / portrait; else the line to the subject at
// 135 mm), the picked shot filled, a tag at the edge pointing to a far subject, and a sun band at the slider's time
// (Sun button). The small view takes no gestures (the page scrolls over it): +/- and the compass; tap a spot to pick
// it. Full screen: pinch, drag and turn. Needs signal (Google's pictures, summer).

type Props = {
  pairs: Pair[];
  sel: Pair;
  onPick: (p: Pair) => void;
  sun: SkyPos;
  shaded?: boolean;   // a ridge shades the picked shot's subject at this time (grey arrows)
  height: number;
  fullBar?: React.ReactNode;   // full screen: the time and slider under the map (Phil, 16 Nov 2026: move the sun there too)
};

const coord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });
const MPD_LAT = 110540;

function fmtKm(m: number): string { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }

let lastSunOn = true;

export default function OverheadMapPanel(props: Props) {
  const [full, setFull] = useState(false);
  const [sunOn, setSunOnState] = useState(lastSunOn);
  const setSunOn = (v: boolean) => { lastSunOn = v; setSunOnState(v); };
  const insets = useSafeAreaInsets();
  return (
    <>
      <OverheadMap {...props} full={false} sunOn={sunOn} onSun={setSunOn} onFull={() => setFull(true)} />
      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={[styles.fullScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {full ? <OverheadMap {...props} full sunOn={sunOn} onSun={setSunOn} onFull={() => setFull(false)} /> : null}
          {full && props.fullBar ? <View style={styles.fullBar}>{props.fullBar}</View> : null}
        </View>
      </Modal>
    </>
  );
}

function OverheadMap({ pairs, sel, onPick, sun, shaded, height, full, sunOn, onSun, onFull }: Props & {
  full: boolean; sunOn: boolean; onSun: (v: boolean) => void; onFull: () => void;
}) {
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [myView, setMyView] = useState(true);
  const [labelsTrack, setLabelsTrack] = useState(true);
  const [zoomStep, setZoomStep] = useState(0);
  const [cam, setCam] = useState<{ lat: number; lng: number; heading: number; zoom: number } | null>(null);

  const selFov = shotFov(sel);
  const [marks, setMarks] = useOverheadMarks();
  const heading = myView && selFov.aim != null ? selFov.aim : 0;

  // Start wide enough for every stand spot of the place, centred on the picked shot's stand spot (Phil, 16 Nov 2026:
  // zooming has to stay on where he stands). In "my view" the spot sits a little below the middle so its wedge has room;
  // it keeps that place on screen at every zoom (the middle is worked out again for each zoom).
  const cosl0 = Math.cos((sel.v.lat * Math.PI) / 180);
  const hh = size.h || height;
  const frame = useMemo(() => {
    let spread = 30;
    for (const p of pairs) spread = Math.max(spread, Math.hypot((p.v.lat - sel.v.lat) * MPD_LAT, (p.v.lng - sel.v.lng) * 111320 * cosl0));
    const w = size.w || 342;
    const mpp = (spread * 2.4 + 100) / Math.max(80, Math.min(w, hh) - 70);
    const zoom = Math.log2((156543.03392 * cosl0) / mpp);
    return { zoom: Math.min(21, Math.max(3, zoom)) };
  }, [pairs.map(p => p.vantage_id).join('|'), sel.vantage_id, size.w, hh]);
  const targetZoom = Math.min(21, Math.max(3, frame.zoom + zoomStep));
  const centreFor = (zoom: number) => {
    const m = (156543.03392 * cosl0) / Math.pow(2, zoom);
    return myView ? destination(sel.v, heading, m * hh * 0.15) : sel.v;
  };
  const mid = centreFor(targetZoom);
  useEffect(() => {
    mapRef.current?.animateCamera({ center: coord(mid), heading, pitch: 0, zoom: targetZoom }, { duration: 350 });
  }, [mid.lat, mid.lng, targetZoom, heading]);
  useEffect(() => { setZoomStep(0); }, [heading, sel.vantage_id]);
  useEffect(() => {
    setLabelsTrack(true);
    const t = setTimeout(() => setLabelsTrack(false), 700);
    return () => clearTimeout(t);
  }, [sel.vantage_id, heading, pairs.length, cam?.zoom == null ? 0 : Math.round(cam.zoom * 2)]);

  const onRegionChangeComplete = () => {
    mapRef.current?.getCamera().then(c => {
      if (!c?.center) return;
      setCam({ lat: c.center.latitude, lng: c.center.longitude, heading: c.heading ?? 0, zoom: c.zoom ?? targetZoom });
    }).catch(() => {});
  };
  const zoomBy = (d: number) => {
    const from = cam?.zoom ?? targetZoom;
    setCam(null);
    setZoomStep(Math.min(21, Math.max(3, from + d)) - frame.zoom);
  };

  const shown = cam ?? { lat: mid.lat, lng: mid.lng, heading, zoom: targetZoom };
  const cosl = Math.cos((shown.lat * Math.PI) / 180);
  const px = (156543.03392 * cosl) / Math.pow(2, shown.zoom);   // metres per screen point
  const sunUp = sun.geo >= SUN_UP_GEO;

  // Three sun arrows coming from the sun's side and landing on the picked shot's view, as the Map tab drew them on the
  // subject (grey when a ridge shades the subject).
  const arrows = useMemo(() => {
    if (!sunUp) return [] as { latitude: number; longitude: number }[][];
    const az = sun.az;
    // on the subject (17 Nov 2026, Phil: as the Map tab did); when the subject is far off the screen, on the line toward it
    // about where it leaves the view
    const dS = distanceM(sel.v, sel.s), reach = 0.4 * Math.min(size.w || 342, size.h || height) * px;
    const target = dS <= reach * 1.6 ? sel.s : destination(sel.v, sel.bearing ?? selFov.aim ?? 0, reach);
    const out: { latitude: number; longitude: number }[][] = [];
    for (const o of [-1, 0, 1]) {
      const base = destination(target, az + 90, o * 16 * px);
      const tip = destination(base, az, 14 * px);
      out.push([coord(destination(base, az, 70 * px)), coord(tip)]);
      const back = destination(tip, az, 9 * px);
      out.push([coord(destination(back, az + 90, 5 * px)), coord(tip), coord(destination(back, az - 90, 5 * px))]);
    }
    return out;
  }, [sunUp, sun.az, sel.vantage_id, selFov.aim, px, size.w, size.h]);

  const shapes = useMemo(() => pairs.map(p => {
    const f = shotFov(p);
    const on = p.vantage_id === sel.vantage_id;
    if (f.aim == null) return { p, on, wedge: null as null | { latitude: number; longitude: number }[] };
    const L = on ? Math.max(distanceM(p.v, p.s), 20 * px) : 70 * px;   // the picked shot's cone reaches its subject
    return { p, on, wedge: [coord(p.v), coord(destination(p.v, f.aim - f.fov / 2, L)), coord(destination(p.v, f.aim + f.fov / 2, L))] };
  }), [pairs, sel.vantage_id, px]);

  // Where the picked shot's aim leaves the screen, when its subject is off screen: "↑ Grand · 13.6 km".
  const tag = useMemo(() => {
    const W = size.w, H = size.h;
    if (!W || !H || selFov.aim == null) return null;
    const toScreen = (q: LatLng) => {
      const dN = (q.lat - shown.lat) * MPD_LAT, dE = (q.lng - shown.lng) * 111320 * cosl;
      const t = (shown.heading * Math.PI) / 180;
      return { x: W / 2 + (dE * Math.cos(t) - dN * Math.sin(t)) / px, y: H / 2 - (dE * Math.sin(t) + dN * Math.cos(t)) / px };
    };
    const s = toScreen(sel.s);
    if (s.x > 8 && s.x < W - 8 && s.y > 8 && s.y < H - 8) return null;
    const v = toScreen(sel.v);
    const a = ((sel.bearing ?? selFov.aim) - shown.heading) * Math.PI / 180;
    const dx = Math.sin(a), dy = -Math.cos(a);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (W - 60 - v.x) / dx); if (dx < -1e-6) t = Math.min(t, (60 - v.x) / dx);
    if (dy > 1e-6) t = Math.min(t, (H - 18 - v.y) / dy); if (dy < -1e-6) t = Math.min(t, (18 - v.y) / dy);
    if (!isFinite(t) || t < 0) return null;
    const arrow = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round((((a * 180) / Math.PI) % 360 + 360) % 360 / 45) % 8];
    return { x: v.x + dx * t, y: v.y + dy * t, text: `${arrow} ${shortName(sel.subject_name)} · ${fmtKm(distanceM(sel.v, sel.s))}` };
  }, [size.w, size.h, shown.lat, shown.lng, shown.heading, px, sel.vantage_id, selFov.aim]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });
  const scaleM = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(m => m / px > 50) ?? 5000;

  return (
    <View style={[styles.wrap, full ? styles.wrapFull : { height }]} onLayout={onLayout} accessibilityLabel={`Overhead satellite, ${pairs.length} shots`}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        mapType="satellite"
        initialCamera={{ center: coord(mid), heading, pitch: 0, zoom: targetZoom, altitude: 0 }}
        showsUserLocation
        showsMyLocationButton={false}
        onRegionChangeComplete={onRegionChangeComplete}
        scrollEnabled={full}
        zoomEnabled={full}
        rotateEnabled={full}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        moveOnMarkerPress={false}
      >
        {marks && sunOn && sunUp ? (
          <Polyline coordinates={[coord(sel.v), coord(destination(sel.v, sun.az, 260 * px))]} strokeColor="rgba(240,176,74,0.35)" strokeWidth={10} />
        ) : null}
        {marks && sunOn && sunUp ? arrows.map((r, i) => (
          <Polyline key={`sa-${i}`} coordinates={r} strokeColor={shaded ? '#9a9a9a' : SUN} strokeWidth={3} lineCap="round" />
        )) : null}
        {marks && shapes.map(({ p, on, wedge }) => (wedge ? (
          on
            ? <Polygon key={`w-${p.vantage_id}`} coordinates={wedge} fillColor="rgba(240,176,74,0.22)" strokeColor={SUN} strokeWidth={2} />
            : <Polyline key={`w-${p.vantage_id}`} coordinates={[wedge[1], wedge[0], wedge[2]]} strokeColor="rgba(0,0,0,0.75)" strokeWidth={2} lineDashPattern={[6, 5]} />
        ) : null))}
        <Polyline coordinates={[coord(sel.v), coord(sel.s)]} strokeColor="rgba(0,0,0,0.55)" strokeWidth={4.5} />
        <Polyline coordinates={[coord(sel.v), coord(sel.s)]} strokeColor="#ffffff" strokeWidth={2.5} />
        <Circle center={coord(sel.s)} radius={7 * px} fillColor="#000000" strokeColor="#ffffff" strokeWidth={2} />
        {shapes.map(({ p, on }) => (
          <Marker
            key={`m-${p.vantage_id}-${on ? 1 : 0}`}
            coordinate={coord(p.v)}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={labelsTrack}
            onPress={() => onPick(p)}
            accessibilityLabel={`Shot ${p.code ?? ''}${on ? ', picked' : ''}`}
          >
            <View style={styles.spotWrap}>
              <View style={[styles.spot, on && styles.spotOn]} />
              <Text style={[styles.pinLabel, on && styles.pinLabelOn]}>{p.code || '•'}{on && p.starred ? ' ★' : ''}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {tag ? (
        <View pointerEvents="none" style={[styles.tag, { left: Math.max(4, Math.min(size.w - 124, tag.x - 60)), top: Math.max(4, Math.min(size.h - 26, tag.y - 11)) }]}>
          <Text style={styles.tagText} numberOfLines={1}>{tag.text}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={() => onSun(!sunOn)}
        style={[styles.sunBtn, sunOn && styles.sunBtnOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: sunOn }}
        accessibilityLabel={sunOn ? 'Sun on' : 'Sun off'}
        hitSlop={6}
      >
        <Text style={[styles.sunText, sunOn && { color: '#000000' }]}>☀ SUN</Text>
      </TouchableOpacity>

      <MarksButton on={marks} onPress={() => setMarks(!marks)} />

      <View pointerEvents="none" style={styles.scale}>
        <View style={[styles.scaleBar, { width: scaleM / px }]} />
        <Text style={styles.scaleText}>{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</Text>
      </View>

      <TouchableOpacity
        style={styles.compassBtn}
        onPress={() => { setMyView(v => !v); setCam(null); }}
        accessibilityRole="button"
        accessibilityLabel={myView ? 'Map faces the shot. Tap for north up' : 'Map is north up. Tap to face the shot'}
        hitSlop={8}
      >
        <View style={[styles.compass, !myView && styles.compassNorth]}>
          <View style={[styles.needleWrap, { transform: [{ rotate: `${-shown.heading}deg` }] }]}>
            <Text style={styles.needleN}>N</Text>
            <View style={styles.needle} />
          </View>
        </View>
        <Text style={[styles.modeText, !myView && { color: '#ffffff' }]}>{myView ? 'MY VIEW' : 'NORTH UP'}</Text>
      </TouchableOpacity>

      <View style={styles.zoomBox}>
        <TouchableOpacity style={styles.zoomBtn} onPress={() => zoomBy(1)} accessibilityLabel="Zoom in" hitSlop={4}>
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>
        <View style={styles.zoomSep} />
        <TouchableOpacity style={styles.zoomBtn} onPress={() => zoomBy(-1)} accessibilityLabel="Zoom out" hitSlop={4}>
          <Text style={styles.zoomText}>−</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={onFull} style={styles.fullBtn} accessibilityRole="button" accessibilityLabel={full ? 'Close the overhead view' : 'Open the overhead view full screen'} hitSlop={6}>
        <Ionicons name={full ? 'close' : 'expand-outline'} size={18} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: '#000000' },
  fullBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 8, backgroundColor: '#000000' },
  wrap: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#0b0e0c' },
  wrapFull: { flex: 1, borderRadius: 0 },
  spotWrap: { alignItems: 'center' },
  spot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#000000', borderWidth: 2, borderColor: '#ffffff' },
  spotOn: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#E5484D' },
  pinLabel: {
    marginTop: 1, color: '#ffffff', fontSize: 11, fontWeight: '700',
    textShadowColor: '#000000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 },
  },
  pinLabelOn: { fontSize: 13 },
  tag: { position: 'absolute', width: 120, alignItems: 'center' },
  tagText: { color: '#ffffff', fontSize: 11, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  sunBtn: { position: 'absolute', left: 8, top: 8, borderRadius: 6, borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 9, paddingVertical: 6 },
  sunBtnOn: { backgroundColor: SUN, borderColor: SUN },
  sunText: { color: '#ffffff', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  scale: { position: 'absolute', right: 12, bottom: 8, alignItems: 'flex-end' },
  scaleBar: { height: 6, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: '#dddddd' },
  scaleText: { color: '#dddddd', fontSize: 10, marginTop: 2, textShadowColor: '#000', textShadowRadius: 3 },
  compassBtn: { position: 'absolute', right: 6, top: 6, alignItems: 'center', width: 60 },
  compass: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
  compassNorth: { borderColor: '#ffffff', borderWidth: 1.5 },
  needleWrap: { width: 34, height: 34, alignItems: 'center' },
  needleN: { color: '#ffffff', fontSize: 8, fontWeight: '700', marginTop: 1, lineHeight: 9 },
  needle: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ffffff' },
  zoomBox: { position: 'absolute', right: 13, top: 78, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444' },
  zoomBtn: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: '#ffffff', fontSize: 18, fontWeight: '600', lineHeight: 20 },
  zoomSep: { height: 1, backgroundColor: '#444444' },
  modeText: { marginTop: 3, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: '#aaaaaa', textShadowColor: '#000', textShadowRadius: 3 },
  fullBtn: { position: 'absolute', left: 8, bottom: 8, width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
});
