import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing, radius, typography } from '../../theme';
import {
  CameraFrame, ShotStatus, fetchFrames, fetchStopSetting, markShot,
} from '../../services/planner';
import { FrameModal, FrameTile } from './CameraView';

const STATES: { key: ShotStatus; text: string; hint: string }[] = [
  { key: null, text: 'Not shot', hint: 'Planned at full value' },
  { key: 'got', text: 'Got it', hint: 'Planned again only for clearly better conditions' },
  { key: 'nailed', text: 'Nailed it', hint: 'No longer suggested' },
];

// TEST app only: the stop's shot tick and the nearest webcams.
export default function StopPlannerSection({ stopId, coords }: {
  stopId: string; coords: { lat: number; lng: number } | null;
}) {
  const [status, setStatus] = useState<ShotStatus>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cams, setCams] = useState<CameraFrame[] | null>(null);
  const [open, setOpen] = useState<CameraFrame | null>(null);

  useEffect(() => {
    fetchStopSetting(stopId).then(s => { setStatus(s?.shot_status ?? null); setTier(s?.tier ?? null); })
      .catch(() => {});
  }, [stopId]);

  const loadCams = useCallback(() => {
    if (!coords) return;
    fetchFrames(coords, 2).then(setCams).catch(() => setCams([]));
  }, [coords?.lat, coords?.lng]);
  useEffect(loadCams, [loadCams]);

  const choose = async (s: ShotStatus) => {
    if (s === status) return;
    setSaving(true); setError(null);
    try { await markShot(stopId, s); setStatus(s); } catch (e: any) { setError(String(e?.message ?? e)); }
    setSaving(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>PLANNER</Text>
        {tier ? <Text style={styles.tier}>{tier}</Text> : <Text style={styles.unrated}>not rated</Text>}
        {saving ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>
      <View style={styles.segment}>
        {STATES.map(s => {
          const on = status === s.key;
          return (
            <TouchableOpacity key={String(s.key)} onPress={() => choose(s.key)} disabled={saving}
              style={[styles.segBtn, on && styles.segOn]} accessibilityState={{ selected: on }}>
              <Text style={[styles.segText, on && styles.segTextOn]}>{s.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>{STATES.find(s => s.key === status)?.hint}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {coords ? (
        <>
          <Text style={[styles.title, { marginTop: spacing.md }]}>NEAREST CAMERAS</Text>
          {cams == null ? <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} />
            : cams.length === 0 ? <Text style={styles.hint}>No camera frames</Text>
            : (
              <View style={styles.camRow}>
                {cams.map(c => <FrameTile key={c.camera.code} item={c} wide onPress={() => setOpen(c)} />)}
              </View>
            )}
        </>
      ) : null}
      <FrameModal item={open} onClose={() => { setOpen(null); loadCams(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl, marginBottom: spacing.lg, padding: spacing.lg, gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.labelMedium, color: colors.textSecondary, flex: 1 },
  tier: { fontSize: 11, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  unrated: { fontSize: 11, color: colors.textTertiary },
  segment: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: radius.sm, padding: 3 },
  segBtn: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm - 2 },
  segOn: { backgroundColor: colors.accent },
  segText: { fontSize: 13, color: colors.textSecondary },
  segTextOn: { color: colors.textInverse, fontWeight: '700' },
  hint: { fontSize: 12, color: colors.textTertiary },
  error: { fontSize: 12, color: '#e74c3c' },
  camRow: { flexDirection: 'row', gap: spacing.md },
});
