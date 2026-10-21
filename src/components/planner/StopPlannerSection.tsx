import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../../theme';
import { CameraFrame, StopSettings, fetchFrames, fetchStopSettings } from '../../services/planner';
import { FrameModal, FrameTile } from './CameraView';
import SettingsEditor, { settingsSummary } from './SettingsEditor';

// TEST app only. Nearby cameras first; the planner folds into one line
// (tier, light, shot) that opens the settings editor.
export default function StopPlannerSection({ stopId, coords }: {
  stopId: string; coords: { lat: number; lng: number } | null;
}) {
  const [setting, setSetting] = useState<StopSettings | null>(null);
  const [openPlanner, setOpenPlanner] = useState(false);
  const [cams, setCams] = useState<CameraFrame[] | null>(null);
  const [open, setOpen] = useState<CameraFrame | null>(null);

  useEffect(() => {
    fetchStopSettings(stopId).then(r => setSetting(r.setting)).catch(() => {});
  }, [stopId]);

  const loadCams = useCallback(() => {
    if (!coords) return;
    fetchFrames(coords, 3).then(setCams).catch(() => setCams([]));
  }, [coords?.lat, coords?.lng]);
  useEffect(loadCams, [loadCams]);

  const tier = setting?.tier ?? null;
  const summary = settingsSummary(setting);

  return (
    <View style={styles.card}>
      {coords ? (
        <>
          <Text style={styles.label}>NEARBY CAMERAS</Text>
          {cams == null ? <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.sm }} />
            : cams.length === 0 ? <Text style={styles.hint}>No camera within 50 km</Text>
            : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.camRow}>
                {cams.map(c => <FrameTile key={c.camera.code} item={c} onPress={() => setOpen(c)} />)}
              </ScrollView>
            )}
        </>
      ) : null}

      <TouchableOpacity style={styles.plannerRow} onPress={() => setOpenPlanner(v => !v)} activeOpacity={0.8}
        accessibilityRole="button" accessibilityState={{ expanded: openPlanner }}
        accessibilityLabel={`Planner settings: ${tier ?? 'not rated'}${summary ? ', ' + summary : ''}`}>
        <Text style={styles.label}>PLANNER</Text>
        {tier ? <Text style={styles.tierPill}>{tier}</Text> : <Text style={styles.hint}>not rated</Text>}
        <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
        {setting?.source === 'suggested' ? <Text style={styles.suggested}>MY GUESS</Text> : null}
        <Ionicons name={openPlanner ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      {openPlanner ? <SettingsEditor stopId={stopId} initial={setting} onChange={setSetting} /> : null}

      <FrameModal item={open} onClose={() => { setOpen(null); loadCams(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl, marginBottom: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  hint: { fontSize: 12, color: colors.textTertiary },
  camRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  plannerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.xs,
  },
  tierPill: { fontSize: 11, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  summary: { flex: 1, fontSize: 12, color: colors.textSecondary },
  suggested: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: colors.textTertiary },
});
