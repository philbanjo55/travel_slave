import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../../theme';
import { StopSettings, fetchStopSettings } from '../../services/planner';
import SettingsEditor, { settingsSummary } from './SettingsEditor';
import { ChanceLine, DayPlanner, stopHint } from './DayPlannerHints';

// TEST app only. The planner's chance for this stop at its time, then its
// settings folded into one line (tier, light, shot) that opens the editor.
// The cameras moved to the picture at the top of the stop (StopCameraHero).
export default function StopPlannerSection({ stopId, planner }: { stopId: string; planner: DayPlanner | null }) {
  const [setting, setSetting] = useState<StopSettings | null>(null);
  const [openPlanner, setOpenPlanner] = useState(false);

  useEffect(() => {
    fetchStopSettings(stopId).then(r => setSetting(r.setting)).catch(() => {});
  }, [stopId]);

  const tier = setting?.tier ?? null;
  const summary = settingsSummary(setting);
  const hint = stopHint(stopId, planner);

  return (
    <View style={styles.card}>
      {hint ? <View style={styles.chance}><ChanceLine hint={hint} label /></View> : null}

      <TouchableOpacity style={[styles.plannerRow, hint && styles.plannerRowRule]} onPress={() => setOpenPlanner(v => !v)} activeOpacity={0.8}
        accessibilityRole="button" accessibilityState={{ expanded: openPlanner }}
        accessibilityLabel={`Planner settings: ${tier ?? 'not rated'}${summary ? ', ' + summary : ''}`}>
        <Text style={styles.label}>PLANNER</Text>
        {tier ? <Text style={styles.tierPill}>{tier}</Text> : <Text style={styles.hint}>not rated</Text>}
        <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
        {setting?.source === 'suggested' ? <Text style={styles.suggested}>MY GUESS</Text> : null}
        <Ionicons name={openPlanner ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      {openPlanner ? <SettingsEditor stopId={stopId} initial={setting} onChange={setSetting} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl, marginBottom: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  chance: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  hint: { fontSize: 12, color: colors.textTertiary },
  plannerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  plannerRowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tierPill: { fontSize: 11, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  summary: { flex: 1, fontSize: 12, color: colors.textSecondary },
  suggested: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: colors.textTertiary },
});
