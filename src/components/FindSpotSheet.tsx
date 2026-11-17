import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors } from '../theme';
import { supabase } from '../services/supabase';
import { useSunStop } from '../services/sunPlan';
import type { SpotHint } from '../services/photoSpot';
import { useTripStore } from '../store/tripStore';
import { Coords, formatCoords, parseCoords } from '../utils/coords';
import PairMapPicker, { PinKind } from './sun/PairMapPicker';
import { CoordStatus, Field, pairEditorStyles as ps } from './sun/SunPairEditor';
import { shotTitle } from './sun/sunStyle';

// Find your spot (Phil, 17 Nov 2026, mockup "find_spot_before_after"): before the search, an optional say in where it
// looks. Roughly where he stood (the stop's stand spots, pasted coordinates, the map or his location: searched within
// 300 m of it) and, optionally, what he aimed at. Built from the Add a vantage screen's parts (SunPairEditor). "Skip"
// is the search as before (within 2.5 km of the stop).

type Props = {
  visible: boolean;
  onClose: () => void;
  stopId: string;
  stopName?: string | null;
  tripId?: string | null;        // the stop's trip (its shots give the chips); asked once when not given
  photoUri?: string | null;      // the photo's thumb, top right
  centre?: Coords | null;        // the stop's pin, where the map opens
  onFind: (hint: SpotHint | null) => Promise<void> | void;   // null = Skip, search the whole area
};

export default function FindSpotSheet({ visible, onClose, stopId, stopName, tripId: tripIn, photoUri, centre, onFind }: Props) {
  const offline = useTripStore((s: any) => s.isOffline);
  const [askedTrip, setAskedTrip] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || tripIn || !stopId) return;
    let alive = true;
    supabase.from('stops').select('trip_id').eq('id', stopId).maybeSingle()
      .then(({ data }: any) => { if (alive && data?.trip_id) setAskedTrip(data.trip_id); }, () => {});
    return () => { alive = false; };
  }, [visible, tripIn, stopId]);
  const tripId = tripIn ?? askedTrip;
  const planStop = useSunStop(tripId, stopId);
  const pairs = planStop?.pairs ?? [];

  const [vText, setVText] = useState('');
  const [sText, setSText] = useState('');
  const [mapping, setMapping] = useState<PinKind | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState<'pins' | 'skip' | null>(null);
  useEffect(() => { if (visible) { setVText(''); setSText(''); setMapping(null); setBusy(null); } }, [visible, stopId]);

  const vParsed = parseCoords(vText);
  const sParsed = parseCoords(sText);
  const sBad = !!sText.trim() && !sParsed;

  // The stop's stand spots and subjects, once each.
  const spots = useMemo(() => {
    const seen = new Map<string, typeof pairs[number]>();
    pairs.forEach(p => { const k = `${p.v.lat.toFixed(5)}|${p.v.lng.toFixed(5)}`; if (!seen.has(k)) seen.set(k, p); });
    return [...seen.values()];
  }, [pairs]);
  const subjects = useMemo(() => {
    const seen = new Map<string, typeof pairs[number]>();
    pairs.forEach(p => { const k = p.subject_id || p.subject_name; if (!seen.has(k)) seen.set(k, p); });
    return [...seen.values()];
  }, [pairs]);
  const same = (a: Coords | null, b: { lat: number; lng: number }) => !!a && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Location is off', 'Allow location for this app to use where you are standing.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setVText(formatCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
    } catch (e: any) {
      Alert.alert('Could not get your location', String(e?.message ?? e));
    } finally {
      setLocating(false);
    }
  };

  const go = async (withPins: boolean) => {
    if (busy || offline) return;
    if (withPins && (!vParsed || sBad)) return;
    setBusy(withPins ? 'pins' : 'skip');
    try {
      await onFind(withPins && vParsed ? {
        lat: vParsed.lat, lng: vParsed.lng, ...(sParsed ? { aim_lat: sParsed.lat, aim_lng: sParsed.lng } : {}),
      } : null);
    } finally {
      setBusy(null);
    }
  };

  const canPins = !!vParsed && !sBad && !busy && !offline;
  const close = mapping ? () => setMapping(null) : onClose;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={ps.root} edges={['top', 'bottom']}>
        <View style={[ps.header, styles.header]}>
          <TouchableOpacity onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={mapping ? 'Back' : 'Close'}>
            <Ionicons name={mapping ? 'arrow-back' : 'close'} size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={ps.title} accessibilityRole="header">{mapping ? 'Place on map' : 'Find your spot'}</Text>
            <Text style={ps.subtitle} numberOfLines={1}>{stopName ? `${stopName} · optional` : 'Optional'}</Text>
          </View>
          {photoUri && !mapping ? <Image source={{ uri: photoUri }} style={styles.thumb} accessibilityLabel="The photo" /> : null}
        </View>

        {mapping ? (
          <PairMapPicker
            v={vParsed} s={sParsed} start={mapping}
            centre={centre ?? (pairs[0] ? pairs[0].v : null)}
            others={pairs.map(p => ({ v: p.v, s: p.s }))}
            onCancel={() => setMapping(null)}
            onDone={(v, s2) => {
              if (v) setVText(formatCoords(v));
              if (s2) setSText(formatCoords(s2));
              setMapping(null);
            }}
          />
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={ps.body} keyboardShouldPersistTaps="handled">
              <Text style={ps.section}>WHERE YOU STOOD (ROUGHLY)</Text>
              {spots.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.chips} keyboardShouldPersistTaps="handled">
                  {spots.map(p => {
                    const on = same(vParsed, p.v);
                    return (
                      <TouchableOpacity key={p.vantage_id} style={[ps.chip, on && styles.chipOn]} onPress={() => setVText(formatCoords(p.v))}
                        accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Near ${shotTitle(p)}`}>
                        <Text style={ps.chipText}>Near {shotTitle(p)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
              <Field label="Coordinates" value={vText} onChange={setVText} placeholder="Paste from Google Maps" keyboardType="numbers-and-punctuation" />
              {vParsed
                ? <Text style={ps.good} accessibilityLabel="Pin set, search within 300 metres of it">✓ Pin set · search within 300 m of it</Text>
                : <CoordStatus text={vText} parsed={vParsed} />}
              <View style={ps.btnRow}>
                <TouchableOpacity style={[ps.secondary, { flex: 1 }]} onPress={() => setMapping('v')} accessibilityRole="button" accessibilityLabel="Set where you stood on the map">
                  <Ionicons name="map-outline" size={16} color={colors.textPrimary} />
                  <Text style={ps.secondaryText}>Set on map</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ps.secondary, { flex: 1 }]} onPress={useMyLocation} disabled={locating} accessibilityRole="button" accessibilityLabel="Use my location">
                  {locating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="locate" size={16} color={colors.textPrimary} />}
                  <Text style={ps.secondaryText}>Use my location</Text>
                </TouchableOpacity>
              </View>

              <Text style={[ps.section, { marginTop: 22 }]}>WHAT YOU WERE AIMING AT</Text>
              {subjects.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ps.chips} keyboardShouldPersistTaps="handled">
                  {subjects.map(p => {
                    const on = same(sParsed, p.s);
                    return (
                      <TouchableOpacity key={p.subject_id || p.subject_name} style={[ps.chip, on && styles.chipOn]} onPress={() => setSText(formatCoords(p.s))}
                        accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Aiming at ${p.subject_name}`}>
                        <Text style={ps.chipText}>{p.subject_name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
              <Field label="Coordinates" value={sText} onChange={setSText} placeholder="Paste from Google Maps" keyboardType="numbers-and-punctuation" />
              <CoordStatus text={sText} parsed={sParsed} />
              <TouchableOpacity style={ps.secondary} onPress={() => setMapping('s')} accessibilityRole="button" accessibilityLabel="Set what you were aiming at on the map">
                <Ionicons name="map-outline" size={16} color={colors.textPrimary} />
                <Text style={ps.secondaryText}>Set on map</Text>
              </TouchableOpacity>

              <Text style={ps.tip}>If the photo doesn't fit near your pin, it says so and shows where it fits best.</Text>

              <TouchableOpacity style={[ps.primary, styles.big, !canPins && { opacity: 0.4 }]} onPress={() => go(true)} disabled={!canPins}
                accessibilityRole="button" accessibilityState={{ disabled: !canPins }} accessibilityLabel={offline ? 'Find with my pins needs a signal' : 'Find with my pins'}>
                {busy === 'pins' ? <ActivityIndicator size="small" color="#000" /> : null}
                <Text style={ps.primaryText}>{offline ? 'Needs a signal' : 'Find with my pins'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[ps.secondary, styles.big, (offline || !!busy) && { opacity: 0.4 }]} onPress={() => go(false)} disabled={offline || !!busy}
                accessibilityRole="button" accessibilityState={{ disabled: offline || !!busy }} accessibilityLabel={offline ? 'Skip needs a signal' : 'Skip, search the whole area'}>
                {busy === 'skip' ? <ActivityIndicator size="small" color={colors.textPrimary} /> : null}
                <Text style={[ps.secondaryText, styles.bigText]}>{offline ? 'Needs a signal' : 'Skip · search the whole area'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { gap: 14 },
  thumb: { width: 44, height: 56, borderRadius: 6, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.textPrimary },
  big: { minHeight: 46, marginTop: 10 },
  bigText: { fontSize: 15 },
});
