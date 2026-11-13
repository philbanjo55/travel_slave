import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { format, parseISO } from 'date-fns';
import { colors, spacing } from '../../theme';
import { ack, usePlanningStatus } from '../../services/planningStatus';

// TEST app only (redesign B1): "T is re-planning Nov 1–6 · 3 of 6 days" with a thin bar while
// T works in the background, then "New plans ready · View" until Phil taps it or opens Plans.
export default function PlanningStrip({ tripId, onView }: { tripId: string; onView: () => void }) {
  const v = usePlanningStatus(tripId);
  if (v.kind === 'idle') return null;
  const s = v.status;
  const dates = s?.trip_dates ?? [];
  const span = dates.length
    ? `${format(parseISO(dates[0]), 'MMM d')}${dates.length > 1 ? `–${format(parseISO(dates[dates.length - 1]), dates[0].slice(0, 7) === dates[dates.length - 1].slice(0, 7) ? 'd' : 'MMM d')}` : ''}`
    : '';
  const view = () => { if (v.kind === 'ready') ack(tripId, s?.made); onView(); };
  if (v.kind === 'ready') {
    return (
      <TouchableOpacity style={[styles.strip, styles.ready]} onPress={view} activeOpacity={0.85}
        accessibilityRole="button" accessibilityLabel="New plans ready. View them">
        <View style={styles.dot} />
        <Text style={styles.text} numberOfLines={1}>New plans ready{span ? ` · ${span}` : ''}</Text>
        <Text style={styles.link}>View ›</Text>
      </TouchableOpacity>
    );
  }
  const running = s && (s.status === 'queued' || s.status === 'running');
  const done = running ? s!.night : 0, total = running ? s!.nights : 0;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <TouchableOpacity style={styles.strip} onPress={view} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={`T is re-planning${total ? `, ${done} of ${total} days` : ''}. View plans`}>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={styles.row}>
          <Text style={styles.text} numberOfLines={1}>
            {running ? `T is re-planning${span ? ` ${span}` : ''}` : 'T is starting…'}
            {total ? <Text style={styles.sub}>{`  ·  ${done} of ${total} days`}</Text> : null}
          </Text>
          <Text style={styles.link}>View ›</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(frac * 100, 4)}%` }]} /></View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  ready: { borderBottomColor: colors.signalOk },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.signalOk },
  text: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  sub: { fontWeight: '400', color: colors.textSecondary },
  link: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.signalOk },
  hint: { fontSize: 10, color: colors.textTertiary },
});
