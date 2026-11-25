import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, useWindowDimensions } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { getPhotoUri } from '../services/photoCache';
import { minutesToHoursMin } from '../utils/helpers';
import { Alert } from 'react-native';
import { Place, RankGroup, tallyText, useTripPlaces } from '../services/stopsPage';
import { useTripStore } from '../store/tripStore';
import { supabase } from '../services/supabase';

const WORKING = '#d4a017';   // the day tabs' yellow

// Stops page marks (Phil, 17 Nov 2026): a long press goes off -> yellow (working on it) -> green (reviewed, good to go)
// -> off, on every visit of the place; saved to stops.review / stops.checked like the day tabs' marks.
async function cyclePlaceMark(p: Place) {
  const next = !p.checked && !p.review ? { checked: false, review: true } : p.review ? { checked: true, review: false } : { checked: false, review: false };
  const ids = new Set(p.stopIds);
  const put = (v: { checked: boolean; review: boolean }) => useTripStore.setState((state: any) => {
    if (!state.currentTripData) return state;
    return { currentTripData: { ...state.currentTripData, days: state.currentTripData.days.map((d: any) => ({
      ...d, stops: (d.stops ?? []).map((st: any) => (ids.has(st.id) ? { ...st, ...v } : st)),
    })) } };
  });
  put(next);
  const { error } = await supabase.from('stops').update(next).in('id', p.stopIds);
  if (error) {
    put({ checked: p.checked, review: p.review });
    Alert.alert('Not saved', "Couldn't change the stop's mark. Check your connection and try again.");
  }
}

// The trip page's Stops view (TEST app; design "FINAL", Phil OK 16 Nov 2026): every rated place once, by rank,
// two cards a row. A card = the stop page's first photo with a green framed-shots bar, the name, one grey line.
// Could do better = GO BACK tag; nailed = faded, grey photo, NAILED. A tap opens the place's first visit.

const PAD = spacing.lg;
const GAP = spacing.md;

function CardPhoto({ photo, nailed }: { photo: any | null; nailed: boolean }) {
  const [uri, setUri] = useState('');
  useEffect(() => {
    let alive = true;
    setUri('');
    if (photo) getPhotoUri(photo).then(u => { if (alive && u) setUri(u); }).catch(() => {});
    return () => { alive = false; };
  }, [photo?.id]);
  if (!uri) return null;
  return (
    <View style={[StyleSheet.absoluteFill, nailed && styles.grey]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
    </View>
  );
}

function StopCard({ p, width, onOpen }: { p: Place; width: number; onOpen: (p: Place) => void }) {
  const nailed = p.status === 'nailed';
  const better = p.status === 'got';
  // (the "3/3 framed" count and its green bar were taken off, Phil 25 Nov 2026: "I don't need it anymore")
  const line = p.minutes ? minutesToHoursMin(p.minutes) : '';
  return (
    <TouchableOpacity style={[styles.card, { width }, nailed && styles.faded]} onPress={() => onOpen(p)} onLongPress={() => { cyclePlaceMark(p); }} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={`Stop card: ${p.name}${p.checked ? ', reviewed' : p.review ? ', working on it' : ''}`}
      accessibilityHint="Long press: working on it, reviewed, or no mark">
      <View style={[styles.photo, p.checked ? styles.markOk : p.review ? styles.markWork : null]}>
        <CardPhoto photo={p.photo} nailed={nailed} />
        {nailed ? <View style={styles.darken} /> : null}
        {nailed ? <View style={styles.nailedWrap}><Text style={styles.nailedText}>NAILED</Text></View> : null}
        {better ? <Text style={styles.goBack}>GO BACK</Text> : null}
        {p.checked || p.review ? <View style={[styles.markDot, { backgroundColor: p.checked ? colors.signalOk : WORKING }]} /> : null}
      </View>
      <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
      {line ? <Text style={styles.line} numberOfLines={1}>{line}</Text> : null}
    </TouchableOpacity>
  );
}

// The first tab of the trip page's day tabs: "ALL <n>" over "Stops" (n = places), the day tabs' own look.
export function StopsTab({ tripId, tripData, active, onPress, styles: t }: {
  tripId: string; tripData: any; active: boolean; onPress: () => void; styles: Record<string, any>;
}) {
  const { count } = useTripPlaces(tripId, tripData);
  return (
    <TouchableOpacity style={[t.tab, active && t.tabActive]} onPress={onPress}
      accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={`Stops: all ${count} places`}>
      <Text style={[t.tabDayNum, active && t.tabDayNumActive]}>{`All ${count}`}</Text>
      <Text style={[t.tabDate, active && t.tabDateActive]}>Stops</Text>
    </TouchableOpacity>
  );
}

export default function StopsView({ tripId, tripData, onOpen, bottomPad = 0 }: {
  tripId: string; tripData: any; onOpen: (p: Place) => void; bottomPad?: number;
}) {
  const { groups } = useTripPlaces(tripId, tripData);
  const { width } = useWindowDimensions();
  const cardW = Math.floor((width - PAD * 2 - GAP) / 2);
  return (
    <ScrollView contentContainerStyle={[styles.list, { paddingBottom: spacing.xxl + bottomPad }]} showsVerticalScrollIndicator={false}
      accessibilityLabel="Stops view">
      {groups.length === 0 ? <Text style={styles.empty}>No rated stops yet</Text> : null}
      {groups.map(g => (
        <View key={g.tier} style={styles.section}>
          <View style={styles.head}>
            <Text style={styles.headTitle}>{`${g.tier} TIER`}</Text>
            <Text style={styles.tally}>{tallyText(g)}</Text>
          </View>
          <View style={styles.grid}>
            {g.places.map(p => <StopCard key={p.key} p={p} width={cardW} onOpen={onOpen} />)}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: PAD },
  section: { paddingTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm },
  headTitle: { flex: 1, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: colors.textSecondary },
  tally: { fontSize: 11, color: '#cccccc' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: { gap: 5 },
  faded: { opacity: 0.55 },
  photo: { height: 100, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  grey: { filter: [{ grayscale: 1 }] },
  darken: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  nailedWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  nailedText: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: colors.textPrimary },
  goBack: {
    position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: colors.textInverse,
    backgroundColor: colors.textPrimary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
  },
  barTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.6)' },
  barFill: { height: 4, backgroundColor: colors.signalOk },
  markOk: { borderWidth: 2, borderColor: colors.signalOk },
  markWork: { borderWidth: 2, borderColor: WORKING },
  markDot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#000000' },
  name: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, lineHeight: 18 },
  line: { fontSize: 11, color: colors.textSecondary },
  empty: { fontSize: 13, color: colors.textSecondary, paddingTop: spacing.xl, textAlign: 'center' },
});
