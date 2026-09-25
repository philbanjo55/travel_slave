import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import {
  Pair, LatLng, Light, MoonPos, SUN_UP_GEO, destination, relAngle,
} from '../../utils/sunEngine';
import { SUN } from './sunStyle';

// The planner map: you, the subject, the line between you, and where the sun
// and moon are. "My view" (default) turns the map so the subject is straight
// ahead; tapping the compass switches to north up, like Google Maps.
// The map itself does not pan or zoom; it frames the pair.

type Props = {
  pair: Pair;
  light: Light;
  moon: MoonPos;
  riseAz: number | null;
  setAz: number | null;
  height: number;
};

const coord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

export default function SunMapPanel({ pair, light, moon, riseAz, setAz, height }: Props) {
  const mapRef = useRef<MapView>(null);
  const [width, setWidth] = useState(0);
  const [myView, setMyView] = useState(true);
  const [labelsTrack, setLabelsTrack] = useState(true);

  const bearing = pair.bearing ?? 0;
  const heading = myView && pair.bearing != null ? bearing : 0;

  // Metres per screen point that frames the pair, and the camera for it.
  const frame = useMemo(() => {
    const mid = { lat: (pair.v.lat + pair.s.lat) / 2, lng: (pair.v.lng + pair.s.lng) / 2 };
    const w = width || 342;
    const dist = Math.max(pair.dist_m, 50);
    let mpp: number;
    if (heading !== 0) {
      mpp = dist / Math.max(60, height - 90);
    } else {
      const dN = Math.abs(pair.s.lat - pair.v.lat) * 110540;
      const dE = Math.abs(pair.s.lng - pair.v.lng) * 111320 * Math.cos(mid.lat * Math.PI / 180);
      mpp = Math.max(dN / Math.max(60, height - 80), dE / Math.max(60, w - 80), 1);
    }
    const zoom = Math.log2((156543.03392 * Math.cos(mid.lat * Math.PI / 180)) / mpp);
    return { mid, mpp, zoom: Math.min(20, Math.max(3, zoom)) };
  }, [pair.vantage_id, pair.v.lat, pair.v.lng, pair.s.lat, pair.s.lng, pair.dist_m, heading, width, height]);

  const camera = {
    center: coord(frame.mid), heading, pitch: 0, zoom: frame.zoom, altitude: 0,
  };

  useEffect(() => {
    mapRef.current?.animateCamera(camera, { duration: 350 });
  }, [frame.mid.lat, frame.mid.lng, frame.zoom, heading]);

  // Custom marker views need to draw once before they can stop tracking.
  useEffect(() => {
    setLabelsTrack(true);
    const t = setTimeout(() => setLabelsTrack(false), 600);
    return () => clearTimeout(t);
  }, [pair.vantage_id, heading]);

  const px = frame.mpp;                       // metres per screen point
  const longRay = Math.max(pair.dist_m * 3, px * 700);
  const sunUp = light.sun.geo >= SUN_UP_GEO;
  const moonUp = moon.geo >= SUN_UP_GEO;

  const overlays = useMemo(() => {
    const V = pair.v, S = pair.s;
    const line = (from: LatLng, az: number, m: number) => [coord(from), coord(destination(from, az, m))];
    const out: { rays: { latitude: number; longitude: number }[][]; arc: { latitude: number; longitude: number }[] } = { rays: [], arc: [] };
    if (sunUp) {
      // Three arrows coming from the sun's side and landing on the subject.
      const az = light.sun.az;
      for (const o of [-1, 0, 1]) {
        const base = destination(S, az + 90, o * 14 * px);
        const tail = destination(base, az, 70 * px);
        const tip = destination(base, az, 16 * px);
        out.rays.push([coord(tail), coord(tip)]);
        const back = destination(tip, az, 9 * px);
        out.rays.push([coord(destination(back, az + 90, 5 * px)), coord(tip), coord(destination(back, az - 90, 5 * px))]);
      }
      // The angle between the sun and your line to the subject, drawn at you.
      if (pair.bearing != null) {
        const d = relAngle(az, bearing);
        const steps = Math.max(2, Math.ceil(Math.abs(d) / 5));
        for (let i = 0; i <= steps; i++) out.arc.push(coord(destination(V, bearing + (d * i) / steps, 34 * px)));
      }
    }
    return {
      ...out,
      rise: riseAz != null ? line(V, riseAz, longRay) : null,
      set: setAz != null ? line(V, setAz, longRay) : null,
      sun: sunUp ? line(V, light.sun.az, longRay) : null,
      moon: moonUp ? line(V, moon.az, longRay) : null,
    };
  }, [pair.vantage_id, light.sun.az, sunUp, moon.az, moonUp, riseAz, setAz, px, longRay]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const scaleM = 1000 / px > 140 ? 500 : 1000;
  const shaded = light.label === 'in shadow';

  return (
    <View style={[styles.wrap, { height }]} onLayout={onLayout}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        mapType="satellite"
        initialCamera={camera}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        moveOnMarkerPress={false}
      >
        {overlays.rise && <Polyline coordinates={overlays.rise} strokeColor="rgba(240,176,74,0.8)" strokeWidth={2} />}
        {overlays.set && <Polyline coordinates={overlays.set} strokeColor="rgba(224,102,43,0.8)" strokeWidth={2} />}
        {overlays.moon && <Polyline coordinates={overlays.moon} strokeColor="rgba(127,167,245,0.6)" strokeWidth={4} />}
        {overlays.sun && <Polyline coordinates={overlays.sun} strokeColor="rgba(240,176,74,0.35)" strokeWidth={9} />}
        <Polyline coordinates={[coord(pair.v), coord(pair.s)]} strokeColor="#ffffff" strokeWidth={2.5} />
        {overlays.arc.length > 1 && (
          <Polyline coordinates={overlays.arc} strokeColor="#ffffff" strokeWidth={1.5} lineDashPattern={[3, 3]} />
        )}
        {overlays.rays.map((r, i) => (
          <Polyline key={i} coordinates={r} strokeColor={shaded ? '#6b6b6b' : SUN} strokeWidth={2.5} lineCap="round" />
        ))}
        <Circle center={coord(pair.s)} radius={8 * px} fillColor="#000000" strokeColor="#ffffff" strokeWidth={2.5} />
        <Circle center={coord(pair.v)} radius={8 * px} fillColor="#E5484D" strokeColor="#ffffff" strokeWidth={2} />
        <Marker
          key={`s-${pair.vantage_id}-${heading}`}
          coordinate={coord(destination(pair.s, heading, 22 * px))}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={labelsTrack}
          tappable={false}
        >
          <Text style={styles.pinLabel}>{pair.subject_name.replace(/\s*\(.*$/, '')}</Text>
        </Marker>
        <Marker
          key={`v-${pair.vantage_id}-${heading}`}
          coordinate={coord(destination(pair.v, heading + 180, 24 * px))}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={labelsTrack}
          tappable={false}
        >
          <Text style={styles.pinLabel}>you</Text>
        </Marker>
      </MapView>

      <View pointerEvents="none" style={styles.scale}>
        <View style={[styles.scaleBar, { width: scaleM / px }]} />
        <Text style={styles.scaleText}>{scaleM === 1000 ? '1 km' : '500 m'}</Text>
      </View>

      <TouchableOpacity
        style={styles.compassBtn}
        onPress={() => setMyView(v => !v)}
        accessibilityRole="button"
        accessibilityLabel={myView ? 'Map faces your view. Tap for north up' : 'Map is north up. Tap for your view'}
        hitSlop={8}
      >
        <View style={[styles.compass, !myView && styles.compassNorth]}>
          <View style={[styles.needleWrap, { transform: [{ rotate: `${-heading}deg` }] }]}>
            <Text style={styles.needleN}>N</Text>
            <View style={styles.needle} />
          </View>
        </View>
        <Text style={[styles.modeText, !myView && { color: '#ffffff' }]}>{myView ? 'MY VIEW' : 'NORTH UP'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#0b0e0c' },
  pinLabel: {
    color: '#ffffff', fontSize: 11, fontWeight: '600',
    textShadowColor: '#000000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 },
  },
  scale: { position: 'absolute', left: 12, bottom: 8 },
  scaleBar: { height: 6, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: '#dddddd' },
  scaleText: { color: '#dddddd', fontSize: 10, marginTop: 2, textShadowColor: '#000', textShadowRadius: 2 },
  compassBtn: { position: 'absolute', right: 6, top: 6, alignItems: 'center', width: 60 },
  compass: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center',
  },
  compassNorth: { borderColor: '#ffffff', borderWidth: 1.5 },
  needleWrap: { width: 34, height: 34, alignItems: 'center' },
  needleN: { color: '#ffffff', fontSize: 8, fontWeight: '700', marginTop: 1, lineHeight: 9 },
  needle: {
    width: 0, height: 0, marginTop: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 12,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ffffff',
  },
  modeText: { marginTop: 3, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: '#aaaaaa' },
});
