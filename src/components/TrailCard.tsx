import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme';
import { feet, miles, trailIcon, trailLine, TrailInfo, trailWord } from '../services/trailInfo';
import { minutesToHoursMin } from '../utils/helpers';

// The stop page's hike / ski card (Phil, 26 Nov 2026, option 3 "profile card"): the activity, length, climb and rough
// time, the route's own up and down drawn as thin bars (no SVG in the app), high / low point and the stop's length.
// Miles and feet.
export default function TrailCard({ trail, stayMin }: { trail: TrailInfo; stayMin?: number | null }) {
  const prof = trail.profile.length > 1 ? trail.profile : null;
  const ups = prof ? prof.map(p => p[1]) : [];
  const lo = prof ? Math.min(...ups) : 0, hi = prof ? Math.max(...ups) : 0;
  // the height axis spans at least 500 ft (152 m), so a nearly flat route draws nearly flat (Phil, 26 Nov 2026: "how do
  // I know if the low to high is 1 foot or 5k feet"); its top and bottom are labelled in feet
  const span = Math.max(152.4, hi - lo), top = lo + span;
  return (
    <View style={styles.card} accessibilityLabel={`${trailWord(trail)} route: ${trailLine(trail)}, ${feet(trail.climb_m)} feet of climbing`}>
      <View style={styles.head}>
        <View style={styles.pill}>
          <MaterialCommunityIcons name={trailIcon(trail) as any} size={14} color="#ffffff" />
          <Text style={styles.pillText}>{trail.activity === 'ski' ? 'XC SKI' : 'HIKE'}</Text>
        </View>
        <Text style={styles.headText} numberOfLines={1}>{miles(trail.length_m)} mi{trail.loop ? ' loop' : ' out & back'} · {feet(trail.climb_m)} ft up · {trailLine(trail).split(' · ')[1]}</Text>
      </View>
      {prof ? (
        <>
          <View style={styles.plot}>
            <View style={styles.yAxis}>
              <Text style={styles.axis}>{feet(top).toLocaleString()} ft</Text>
              <Text style={styles.axis}>{feet(lo + span / 2).toLocaleString()}</Text>
              <Text style={styles.axis}>{feet(lo).toLocaleString()} ft</Text>
            </View>
            <View style={styles.graphWrap}>
              <View style={[styles.grid, { top: 0 }]} />
              <View style={[styles.grid, { top: '50%' }]} />
              <View style={styles.graph}>
                {prof.map((p, i) => (
                  <View key={i} style={[styles.bar, { height: `${Math.max(2, (100 * (p[1] - lo)) / span)}%` }]} />
                ))}
              </View>
            </View>
          </View>
          <View style={[styles.axisRow, { marginLeft: Y_W }]}>
            <Text style={styles.axis}>start</Text>
            {!trail.loop ? <Text style={styles.axis}>turn back</Text> : null}
            <Text style={styles.axis}>{miles(trail.length_m)} mi</Text>
          </View>
        </>
      ) : null}
      <Text style={styles.foot} numberOfLines={2}>
        {prof ? `High point ${feet(hi).toLocaleString()} ft · low ${feet(lo).toLocaleString()} ft` : trail.name}
        {stayMin ? ` · ${minutesToHoursMin(stayMin)} at this stop` : ''}
      </Text>
    </View>
  );
}

const Y_W = 58;
const styles = StyleSheet.create({
  plot: { flexDirection: 'row', height: 72 },
  yAxis: { width: Y_W, justifyContent: 'space-between', paddingRight: 6 },
  graphWrap: { flex: 1 },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#2a2a2a' },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: '#111111', borderWidth: 1, borderColor: '#282828', gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.signalOk, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  headText: { flex: 1, color: '#ffffff', fontSize: 13, fontWeight: '700' },
  graph: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 1, borderBottomWidth: 1, borderBottomColor: '#3a3a3a' },
  bar: { flex: 1, backgroundColor: '#2f5a42', borderTopWidth: 2, borderTopColor: colors.signalOk },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between' },
  axis: { color: '#888888', fontSize: 10 },
  foot: { color: '#888888', fontSize: 11 },
});
