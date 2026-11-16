import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Modal } from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Pair, LatLng, SkyPos, SUN_UP_GEO, destination, distanceM } from '../../utils/sunEngine';
import { SUN, shortName } from './sunStyle';
import { shotFov } from './shotFov';

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
  height: number;
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
        </View>
      </Modal>
    </>
  );
}

function OverheadMap({ pairs, sel, onPick, sun, height, full, sunOn, onSun, onFull }: Props & {
  full: boolean; sunOn: boolean; onSun: (v: boolean) => void; onFull: () => void;
}) {
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [myView, setMyView] = useState(true);
  const [labelsTrack, setLabelsTrack] = useState(true);
  const [zoomStep, setZoomStep] = useState(0);
  const [cam, setCam] = useState<{ lat: number; lng: number; heading: number; zoom: number } | null>(null);

  const selFov = shotFov(sel);
  const heading = myView && selFov.aim != null ? selFov.aim : 0;

  // Frame every stand spot of the place (subjects can be km away: the edge tag points to them).
  const frame = useMemo(() => {
    const pts = pairs.map(p => p.v);
    const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const lng0 = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
    const cosl = Math.cos((lat0 * Math.PI) / 180);
    let spread = 40;
    for (const p of pts) spread = Math.max(spread, Math.hypot((p.lat - lat0) * MPD_LAT, (p.lng - lng0) * 111320 * cosl) * 2);
    const w = size.w || 342, h = size.h || height;
    const mpp = (spread * 1.25 + 120) / Math.max(80, Math.min(w, h) - 70);
    // nudge the middle back from the aim, so the wedges have room in front of the spots
    const mid = heading !== 0 || myView ? destination({ lat: lat0, lng: lng0 }, heading + 180, mpp * h * 0.18) : { lat: lat0, lng: lng0 };
    const zoom = Math.log2((156543.03392 * cosl) / mpp);
    return { mid, zoom: Math.min(21, Math.max(3, zoom)) };
  }, [pairs.map(p => p.vantage_id).join('|'), size.w, size.h, height, heading, myView]);

  const targetZoom = Math.min(21, Math.max(3, frame.zoom + zoomStep));
  useEffect(() => {
    mapRef.current?.animateCamera({ center: coord(frame.mid), heading, pitch: 0, zoom: targetZoom }, { duration: 350 });
  }, [frame.mid.lat, frame.mid.lng, targetZoom, heading]);
  useEffect(() => { setZoomStep(0); }, [heading]);
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
  const zoomBy = (d: number) => setZoomStep(prev => Math.min(21, Math.max(3, frame.zoom + prev + d)) - frame.zoom);

  const shown = cam ?? { lat: frame.mid.lat, lng: frame.mid.lng, heading, zoom: targetZoom };
  const cosl = Math.cos((shown.lat * Math.PI) / 180);
  const px = (156543.03392 * cosl) / Math.pow(2, shown.zoom);   // metres per screen point
  const sunUp = sun.geo >= SUN_UP_GEO;

  const shapes = useMemo(() => pairs.map(p => {
    const f = shotFov(p);
    const on = p.vantage_id === sel.vantage_id;
    if (f.aim == null) return { p, on, wedge: null as null | { latitude: number; longitude: number }[] };
    const L = (on ? 110 : 70) * px;
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
        initialCamera={{ center: coord(frame.mid), heading, pitch: 0, zoom: targetZoom, altitude: 0 }}
        onRegionChangeComplete={onRegionChangeComplete}
        scrollEnabled={full}
        zoomEnabled={full}
        rotateEnabled={full}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        moveOnMarkerPress={false}
      >
        {sunOn && sunUp ? (
          <Polyline coordinates={[coord(sel.v), coord(destination(sel.v, sun.az, 260 * px))]} strokeColor="rgba(240,176,74,0.45)" strokeWidth={12} />
        ) : null}
        {shapes.map(({ p, on, wedge }) => (wedge ? (
          on
            ? <Polygon key={`w-${p.vantage_id}`} coordinates={wedge} fillColor="rgba(240,176,74,0.28)" strokeColor={SUN} strokeWidth={2} />
            : <Polyline key={`w-${p.vantage_id}`} coordinates={[wedge[1], wedge[0], wedge[2]]} strokeColor="rgba(0,0,0,0.75)" strokeWidth={2} lineDashPattern={[6, 5]} />
        ) : null))}
        <Polyline coordinates={[coord(sel.v), coord(sel.s)]} strokeColor="rgba(255,255,255,0.5)" strokeWidth={1.5} lineDashPattern={[2, 6]} />
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
