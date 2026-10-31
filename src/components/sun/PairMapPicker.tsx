import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, spacing } from '../../theme';
import { Coords } from '../../utils/coords';
import { bearingDeg, distanceM } from '../../utils/sunEngine';
import { compassPoint } from './sunStyle';

// Place a vantage (where you stand) and its subject on a satellite map. Tap
// the map to drop the pin that is selected below, or drag either pin. Same
// colours as the planner map: you red, subject black. "Done" hands both
// points back to the vantage form, which saves them as usual.

export type PinKind = 'v' | 's';

type Props = {
  v: Coords | null;
  s: Coords | null;
  start: PinKind;
  centre: Coords | null;          // the stop's main location
  others?: { v: Coords; s: Coords }[];   // the stop's other vantages, drawn faintly
  onDone: (v: Coords | null, s: Coords | null) => void;
  onCancel: () => void;
};

const ll = (c: Coords) => ({ latitude: c.lat, longitude: c.lng });
const round = (c: { latitude: number; longitude: number }): Coords =>
  ({ lat: Math.round(c.latitude * 1e6) / 1e6, lng: Math.round(c.longitude * 1e6) / 1e6 });

export default function PairMapPicker({ v: v0, s: s0, start, centre, others, onDone, onCancel }: Props) {
  const [v, setV] = useState<Coords | null>(v0);
  const [s, setS] = useState<Coords | null>(s0);
  const [active, setActive] = useState<PinKind>(start);
  const [satellite, setSatellite] = useState(true);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef<MapView>(null);

  // Open on the pins when both exist, else on the one pin, else the stop.
  const focus = v ?? s ?? centre ?? { lat: 62.0, lng: -6.9 };
  const onReady = () => {
    if (v0 && s0) {
      mapRef.current?.fitToCoordinates([ll(v0), ll(s0)], {
        edgePadding: { top: 120, right: 80, bottom: 120, left: 80 }, animated: false,
      });
    }
  };

  const place = (c: Coords) => {
    if (active === 'v') {
      setV(c);
      if (!s) setActive('s');   // first pin down: next tap places the subject
    } else {
      setS(c);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Location is off', 'Allow location for this app to use where you are standing.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const c = round(pos.coords);
      setV(c);
      mapRef.current?.animateToRegion({ ...ll(c), latitudeDelta: 0.01, longitudeDelta: 0.02 }, 350);
      if (!s) setActive('s');
    } catch (e: any) {
      Alert.alert('Could not get your location', String(e?.message ?? e));
    } finally {
      setLocating(false);
    }
  };

  const dist = v && s ? distanceM(v, s) : null;
  const facing = v && s && dist! >= 20 ? compassPoint(bearingDeg(v, s)) : null;

  return (
    <View style={styles.root}>
      <View style={styles.mapBox}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          mapType={satellite ? 'hybrid' : 'standard'}
          initialRegion={{ ...ll(focus), latitudeDelta: 0.012, longitudeDelta: 0.024 }}
          onMapReady={onReady}
          onPress={(e) => place(round(e.nativeEvent.coordinate))}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
        >
          {(others ?? []).map((o, i) => (
            <Polyline key={`o${i}`} coordinates={[ll(o.v), ll(o.s)]} strokeColor="rgba(255,255,255,0.35)" strokeWidth={1.5} lineDashPattern={[4, 4]} />
          ))}
          {v && s && <Polyline coordinates={[ll(v), ll(s)]} strokeColor="#ffffff" strokeWidth={2.5} />}
          {s && (
            <Marker
              coordinate={ll(s)} anchor={{ x: 0.5, y: 0.5 }} draggable
              onDragEnd={(e) => setS(round(e.nativeEvent.coordinate))}
              onPress={() => setActive('s')}
            >
              <View style={styles.pinWrap}>
                <View style={[styles.dot, styles.dotS, active === 's' && styles.dotActive]} />
                <Text style={styles.pinLabel}>subject</Text>
              </View>
            </Marker>
          )}
          {v && (
            <Marker
              coordinate={ll(v)} anchor={{ x: 0.5, y: 0.5 }} draggable
              onDragEnd={(e) => setV(round(e.nativeEvent.coordinate))}
              onPress={() => setActive('v')}
            >
              <View style={styles.pinWrap}>
                <View style={[styles.dot, styles.dotV, active === 'v' && styles.dotActive]} />
                <Text style={styles.pinLabel}>you</Text>
              </View>
            </Marker>
          )}
        </MapView>
        <TouchableOpacity style={styles.mapToggle} onPress={() => setSatellite(x => !x)}>
          <Text style={styles.mapToggleText}>{satellite ? 'Map' : 'Satellite'}</Text>
        </TouchableOpacity>
        {dist != null && (
          <View style={styles.readout} pointerEvents="none">
            <Text style={styles.readoutText}>
              {facing ? `facing ${facing} · ` : ''}{dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.hint}>Tap the map to place the selected pin. Press and hold a pin to drag it.</Text>
        <View style={styles.seg} accessibilityRole="tablist">
          {(['v', 's'] as const).map(k => {
            const on = active === k;
            const set = k === 'v' ? !!v : !!s;
            return (
              <TouchableOpacity
                key={k} onPress={() => setActive(k)} style={[styles.segBtn, on && styles.segOn]}
                accessibilityRole="tab" accessibilityState={{ selected: on }}
              >
                <View style={[styles.segDot, k === 'v' ? styles.dotV : styles.dotS]} />
                <Text style={[styles.segText, on && styles.segTextOn]}>{k === 'v' ? 'You' : 'Subject'}</Text>
                {set && <Ionicons name="checkmark" size={14} color={on ? '#000' : '#5aaa7a'} />}
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.secondary} onPress={useMyLocation} disabled={locating}>
          {locating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="locate" size={16} color={colors.textPrimary} />}
          <Text style={styles.secondaryText}>Put "You" where I'm standing</Text>
        </TouchableOpacity>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={onCancel}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primary, { flex: 2 }, !(v || s) && { opacity: 0.4 }]}
            onPress={() => onDone(v, s)} disabled={!(v || s)}
          >
            <Ionicons name="checkmark" size={18} color="#000" />
            <Text style={styles.primaryText}>Use these points</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapBox: { flex: 1 },
  mapToggle: {
    position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  mapToggleText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  readout: {
    position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  readoutText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pinWrap: { alignItems: 'center', width: 70, height: 50, justifyContent: 'center' },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: '#ffffff' },
  dotV: { backgroundColor: '#E5484D' },
  dotS: { backgroundColor: '#000000' },
  dotActive: { width: 24, height: 24, borderRadius: 12, borderWidth: 3 },
  pinLabel: {
    position: 'absolute', bottom: 0, color: '#ffffff', fontSize: 11, fontWeight: '700',
    textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 },
  },
  panel: {
    padding: spacing.xl, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  hint: { color: colors.textTertiary, fontSize: 12 },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: '#444444', borderRadius: 10, overflow: 'hidden' },
  segBtn: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#000' },
  segOn: { backgroundColor: '#ffffff' },
  segDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#ffffff' },
  segText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  segTextOn: { color: '#000000' },
  actions: { flexDirection: 'row', gap: 10 },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ffffff',
    borderRadius: 10, minHeight: 46, marginTop: 4,
  },
  primaryText: { color: '#000000', fontSize: 15, fontWeight: '700' },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, minHeight: 44, marginTop: 4,
  },
  secondaryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});
