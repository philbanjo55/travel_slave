import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../../theme';
import { MODE_SUB, OnePassStart, startOnePass, useReplanMode } from '../../services/onePass';
import { failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { useTripStore } from '../../store/tripStore';
import { errText } from '../../utils/errText';

// The one Re-plan button (one-pass, services/onePass; shown only with ONE_PASS_UI on): "Re-plan" and one short line,
// "Today + rest of trip", or "Tomorrow on" once today's stops are over. Replaces Re-plan now and Plan again where
// those were (today's day card, Planner > Plans, a stop's Settings after a save). The accessibility labels keep the
// old buttons' words so the emulator checks still find them.
export function OnePassButton({ tripId, variant, onStarted, onError, disabled }: {
  tripId: string; variant: 'card' | 'pill' | 'link';
  onStarted?: (s: OnePassStart) => void; onError?: (message: string) => void; disabled?: boolean;
}) {
  const mode = useReplanMode(tripId);
  const now = useReplanNow(tripId);
  const { currentTripData } = useTripStore();
  const [starting, setStarting] = useState(false);
  const busy = starting || now.phase === 'running';
  const sub = MODE_SUB[mode ?? 'rest'];
  const go = async () => {
    setStarting(true);
    try { onStarted?.(await startOnePass(tripId, currentTripData?.trip?.title)); }
    catch (e: any) { const m = errText(e); failReplanNow(tripId, m); onError?.(m); }
    setStarting(false);
  };
  const label = `Re-plan: ${sub}. Plan again and Re-plan now with the cameras in one`;
  const off = busy || !!disabled;
  if (variant === 'link') {
    return (
      <TouchableOpacity onPress={go} disabled={off} accessibilityRole="button" accessibilityLabel={label} style={styles.linkBtn}>
        {busy ? <ActivityIndicator size="small" color={colors.signalOk} /> : (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.linkGo}>Re-plan ›</Text>
            <Text style={styles.linkSub}>{sub}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }
  if (variant === 'pill') {
    return (
      <TouchableOpacity onPress={go} disabled={off} style={styles.pill} accessibilityRole="button" accessibilityLabel={label}>
        {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : <Ionicons name="refresh" size={16} color={colors.textSecondary} />}
        <View>
          <Text style={styles.pillText}>Re-plan</Text>
          <Text style={styles.pillSub}>{sub}</Text>
        </View>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity onPress={go} disabled={off} style={[styles.card, off && { opacity: 0.6 }]} activeOpacity={0.8} accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }} accessibilityLabel={label}>
      {busy ? <ActivityIndicator size="small" color={colors.textPrimary} /> : null}
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.cardText} numberOfLines={1}>{busy ? 'Re-planning…' : 'Re-plan'}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: '#555555' },
  cardText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cardSub: { fontSize: 11, color: colors.textSecondary },
  pill: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, minHeight: 36, alignItems: 'center', justifyContent: 'center',
          borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  pillSub: { fontSize: 10, color: colors.textTertiary },
  linkBtn: { minHeight: 40, justifyContent: 'center' },
  linkGo: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
  linkSub: { fontSize: 10, color: colors.textSecondary },
});
