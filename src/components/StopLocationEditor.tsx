import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, spacing } from '../theme';
import { updateStop } from '../services/supabase';
import { LegChange, recalcLegsAround } from '../services/driveTimes';
import { useTripStore } from '../store/tripStore';
import { Coords, formatCoords, parseCoords } from '../utils/coords';

// Set or change a stop's main location: the point used for navigation,
// the route map, drive times and the weather. Paste coordinates, use where
// you are, or drag the pin. Saving updates the stop, recalculates the two
// drive legs that touch it, and refreshes the trip; the weather and the
// stop's elevation follow the new point on their own. Needs a connection.

type Props = {
  visible: boolean;
  onClose: () => void;
  stop: { id: string; name?: string | null; lat?: number | null; lng?: number | null };
  fallback?: Coords | null;   // where to centre the map when the stop has no location yet
};

export default function StopLocationEditor({ visible, onClose, stop, fallback }: Props) {
  const { refreshCurrentTrip } = useTripStore();
  const original: Coords | null = stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : null;
  const [text, setText] = useState('');
  const [pin, setPin] = useState<Coords | null>(original);
  const [satellite, setSatellite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<LegChange[] | null>(null);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (visible) {
      setText(formatCoords(original)); setPin(original); setError(null); setLegs(null);
    }
  }, [visible, stop.id]);

  const moveTo = (c: Coords, fly = true) => {
    setPin(c);
    if (fly) mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: 0.006, longitudeDelta: 0.012 }, 350);
  };

  const onText = (t: string) => {
    setText(t);
    const c = parseCoords(t);
    if (c) moveTo(c);
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Location is off', 'Allow location for this app to use where you are.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const c = { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 };
      setText(formatCoords(c)); moveTo(c);
    } catch (e: any) {
      Alert.alert('Could not get your location', String(e?.message ?? e));
    } finally {
      setLocating(false);
    }
  };

  const parsed = parseCoords(text);
  const changed = !!pin && (!original || Math.abs(pin.lat - original.lat) > 1e-7 || Math.abs(pin.lng - original.lng) > 1e-7);
  const movedM = pin && original ? distanceM(original, pin) : null;

  const save = async () => {
    if (!pin) return;
    setSaving(true); setError(null);
    try {
      await updateStop(stop.id, { lat: pin.lat, lng: pin.lng });
      let result: LegChange[] = [];
      try { result = await recalcLegsAround(stop.id); } catch { /* the location is saved either way */ }
      setLegs(result);
      refreshCurrentTrip().catch(() => {});
    } catch (e: any) {
      setError(/network|fetch/i.test(String(e?.message)) ? 'No connection. Try again when you have signal.' : String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const centre = pin ?? original ?? fallback ?? { lat: 62.0, lng: -6.9 };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{original ? 'Change location' : 'Set location'}</Text>
            {!!stop.name && <Text style={styles.subtitle} numberOfLines={1}>{stop.name}</Text>}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {legs ? (
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="checkmark-circle" size={18} color="#5aaa7a" />
                  <Text style={styles.cardTitle}>Location saved</Text>
                </View>
                <Text style={styles.line}>{formatCoords(pin)}</Text>
                {legs.length === 0 && <Text style={styles.line}>No drive legs touch this stop.</Text>}
                {legs.map((l, i) => (
                  <Text key={i} style={[styles.line, l.failed && { color: '#e2b25a' }]}>
                    Drive {short(l.from)} → {short(l.to)}: {mins(l.before)} → {l.failed ? `${mins(l.after)} (could not route; kept)` : mins(l.after)}
                  </Text>
                ))}
                <Text style={styles.hint}>
                  Weather and elevation follow the new point within the hour. Stop times are not shifted automatically:
                  if a drive got longer or shorter, adjust the times you care about.
                </Text>
                <TouchableOpacity style={styles.primary} onPress={onClose}>
                  <Text style={styles.primaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.mapBox}>
                  <MapView
                    ref={mapRef}
                    provider={PROVIDER_GOOGLE}
                    style={StyleSheet.absoluteFill}
                    mapType={satellite ? 'hybrid' : 'standard'}
                    initialRegion={{ latitude: centre.lat, longitude: centre.lng, latitudeDelta: 0.01, longitudeDelta: 0.02 }}
                    onLongPress={(e) => { const c = round(e.nativeEvent.coordinate); setText(formatCoords(c)); moveTo(c, false); }}
                  >
                    {pin && (
                      <Marker
                        coordinate={{ latitude: pin.lat, longitude: pin.lng }}
                        draggable
                        onDragEnd={(e) => { const c = round(e.nativeEvent.coordinate); setText(formatCoords(c)); setPin(c); }}
                        pinColor="#E5484D"
                      />
                    )}
                    {original && changed && (
                      <Marker coordinate={{ latitude: original.lat, longitude: original.lng }} pinColor="#888888" opacity={0.7} title="Current location" />
                    )}
                  </MapView>
                  <TouchableOpacity style={styles.mapToggle} onPress={() => setSatellite(s => !s)}>
                    <Text style={styles.mapToggleText}>{satellite ? 'Map' : 'Satellite'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>Drag the red pin, or long-press the map to drop it. Grey is the current location.</Text>

                <Text style={styles.label}>Coordinates</Text>
                <TextInput
                  style={styles.input} value={text} onChangeText={onText} placeholder="Paste from Google Maps"
                  placeholderTextColor="#555" autoCorrect={false} autoCapitalize="none" keyboardType="numbers-and-punctuation"
                  accessibilityLabel="Coordinates"
                />
                {!!text.trim() && (parsed
                  ? <Text style={styles.good}>✓ {formatCoords(parsed)}</Text>
                  : <Text style={styles.bad}>Can't read these. Paste "62.085177, -7.366927" or a Google Maps link.</Text>)}

                <TouchableOpacity style={styles.secondary} onPress={useMyLocation} disabled={locating}>
                  {locating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="locate" size={16} color={colors.textPrimary} />}
                  <Text style={styles.secondaryText}>Use my location</Text>
                </TouchableOpacity>

                {movedM != null && changed && (
                  <Text style={[styles.line, movedM > 20000 && { color: '#e2b25a' }]}>
                    Moves the stop {movedM >= 1000 ? `${(movedM / 1000).toFixed(1)} km` : `${Math.round(movedM)} m`}
                    {movedM > 20000 ? '. That is a long way: check the coordinates.' : '.'}
                  </Text>
                )}
                <Text style={styles.hint}>This is the point used for navigation, the route map, drive times and the weather.</Text>

                {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
                <TouchableOpacity style={[styles.primary, (!changed || saving) && { opacity: 0.4 }]} onPress={save} disabled={!changed || saving}>
                  {saving ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="checkmark" size={18} color="#000" />}
                  <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save location'}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function round(c: { latitude: number; longitude: number }): Coords {
  return { lat: Math.round(c.latitude * 1e6) / 1e6, lng: Math.round(c.longitude * 1e6) / 1e6 };
}
function mins(m: number | null | undefined): string { return m == null ? '—' : `${m} min`; }
function short(n: string): string { return String(n ?? '').replace(/^[^A-Za-z0-9\u00C0-\u024F]+/, '').split(/\s+[—–-]\s+/)[0].slice(0, 28); }
function distanceM(a: Coords, b: Coords): number {
  const R = 6371008.8, r = Math.PI / 180;
  const dp = (b.lat - a.lat) * r, dl = (b.lng - a.lng) * r;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  body: { padding: spacing.xl, gap: 10, paddingBottom: 60 },
  mapBox: { height: 300, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  mapToggle: {
    position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  mapToggleText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  label: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.surface,
  },
  good: { color: '#5aaa7a', fontSize: 12 },
  bad: { color: '#e0776b', fontSize: 12 },
  line: { color: '#aaaaaa', fontSize: 13 },
  hint: { color: colors.textTertiary, fontSize: 11, lineHeight: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: '#3f7d5a', padding: 14, gap: 8 },
  cardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ffffff',
    borderRadius: 10, minHeight: 46, marginTop: 8,
  },
  primaryText: { color: '#000000', fontSize: 15, fontWeight: '700' },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, minHeight: 40, marginTop: 4,
  },
  secondaryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  errorBox: { borderWidth: 1, borderColor: '#6b3a33', backgroundColor: '#2a1714', borderRadius: 8, padding: 12 },
  errorText: { color: '#f0a79c', fontSize: 13 },
});
