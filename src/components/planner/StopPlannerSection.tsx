import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../../theme';
import {
  CameraFrame, Light, LIGHT_CHOICES, ShotStatus, StopSettings, StopShot, TIER_CHOICES,
  fetchFrames, fetchStopSettings, markShot, saveStopSettings,
} from '../../services/planner';
import { FrameModal, FrameTile } from './CameraView';

const STATES: { key: ShotStatus; text: string }[] = [
  { key: null, text: 'Not shot' },
  { key: 'got', text: 'Got it' },
  { key: 'nailed', text: 'Nailed it' },
];
const STATUS_TEXT: Record<string, string> = { got: 'got it', nailed: 'nailed it' };

// TEST app only. Nearby cameras first; the planner folds into one line
// (tier, light, shot) that opens to change them. Phil's changes are marked as
// his (source 'phil'), so the solver stops treating them as Claude's guesses.
export default function StopPlannerSection({ stopId, coords }: {
  stopId: string; coords: { lat: number; lng: number } | null;
}) {
  const [setting, setSetting] = useState<StopSettings | null>(null);
  const [shots, setShots] = useState<StopShot[]>([]);
  const [openPlanner, setOpenPlanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cams, setCams] = useState<CameraFrame[] | null>(null);
  const [open, setOpen] = useState<CameraFrame | null>(null);

  useEffect(() => {
    fetchStopSettings(stopId).then(r => { setSetting(r.setting); setShots(r.shots); }).catch(() => {});
  }, [stopId]);

  const loadCams = useCallback(() => {
    if (!coords) return;
    fetchFrames(coords, 3).then(setCams).catch(() => setCams([]));
  }, [coords?.lat, coords?.lng]);
  useEffect(loadCams, [loadCams]);

  const run = async (fn: () => Promise<StopSettings | void>) => {
    setSaving(true); setError(null);
    try { const s = await fn(); if (s) setSetting(s); }
    catch (e: any) { setError(/network|fetch/i.test(String(e?.message)) ? 'No connection. Try again when you have signal.' : String(e?.message ?? e)); }
    setSaving(false);
  };
  const save = (patch: Parameters<typeof saveStopSettings>[1]) => run(() => saveStopSettings(stopId, patch));
  const chooseShot = (s: ShotStatus) => {
    if (s === (setting?.shot_status ?? null)) return;
    run(async () => { await markShot(stopId, s); setSetting(prev => prev ? { ...prev, shot_status: s } : prev); });
  };
  const toggleLight = (l: Light) => {
    const cur = setting?.light_wanted ?? [];
    const next = cur.includes(l) ? cur.filter(x => x !== l) : [...cur, l];
    save({ light_wanted: LIGHT_CHOICES.map(c => c.key).filter(k => next.includes(k)) });
  };

  const tier = setting?.tier ?? null;
  const lights = (setting?.light_wanted ?? []).join(', ');
  const status = setting?.shot_status ?? null;
  const suggested = setting?.source === 'suggested';
  const summary = [lights ? `${lights} light` : null, setting?.fog_wanted ? 'fog good' : null, status ? STATUS_TEXT[status] : null]
    .filter(Boolean).join(' · ');

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
        {suggested ? <Text style={styles.suggested}>MY GUESS</Text> : null}
        {saving ? <ActivityIndicator size="small" color={colors.textSecondary} />
          : <Ionicons name={openPlanner ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />}
      </TouchableOpacity>

      {openPlanner ? (
        <View style={styles.editor}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Shot</Text>
            <View style={styles.chips}>
              {STATES.map(s => (
                <Chip key={String(s.key)} text={s.text} on={status === s.key} disabled={saving} onPress={() => chooseShot(s.key)} />
              ))}
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Tier</Text>
            <View style={styles.chips}>
              {TIER_CHOICES.map(t => (
                <Chip key={t} text={t} on={tier === t} disabled={saving} onPress={() => save({ tier: tier === t ? null : t })} />
              ))}
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Light</Text>
            <View style={styles.chips}>
              {LIGHT_CHOICES.map(l => (
                <Chip key={l.key} text={l.text} on={(setting?.light_wanted ?? []).includes(l.key)} disabled={saving} onPress={() => toggleLight(l.key)} />
              ))}
              <Chip text="Fog is good" on={!!setting?.fog_wanted} disabled={saving} onPress={() => save({ fog_wanted: !setting?.fog_wanted })} />
            </View>
          </View>
          {shots.length > 1 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>★ Shot</Text>
              <View style={styles.chips}>
                {shots.map(s => {
                  const on = (setting?.star_vantage_id ?? shots[0].vantage_id) === s.vantage_id;
                  return <Chip key={s.vantage_id} text={`${on ? '★ ' : ''}${s.name}`} on={on} disabled={saving}
                    onPress={() => save({ star_vantage_id: s.vantage_id })} />;
                })}
              </View>
            </View>
          ) : null}
          {suggested ? (
            <View style={styles.confirmRow}>
              <Text style={[styles.hint, { flex: 1 }]}>Claude's guess. Change anything, or keep it as it is.</Text>
              <Chip text="Keep as is" on={false} disabled={saving} onPress={() => save({})} />
            </View>
          ) : <Text style={styles.hint}>Your settings. The planner uses them from tonight's run, or straight away when you plan a day.</Text>}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : error ? <Text style={styles.error}>{error}</Text> : null}

      <FrameModal item={open} onClose={() => { setOpen(null); loadCams(); }} />
    </View>
  );
}

function Chip({ text, on, disabled, onPress }: { text: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button" accessibilityState={{ selected: on, disabled }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{text}</Text>
    </TouchableOpacity>
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
  error: { fontSize: 12, color: '#e74c3c' },
  camRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  plannerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.xs,
  },
  tierPill: { fontSize: 11, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  summary: { flex: 1, fontSize: 12, color: colors.textSecondary },
  suggested: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: colors.textTertiary },
  editor: { gap: spacing.sm, paddingBottom: spacing.xs },
  field: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  fieldLabel: { width: 48, fontSize: 12, color: colors.textSecondary, paddingTop: 8 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    minHeight: 32, paddingHorizontal: 10, justifyContent: 'center',
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse, fontWeight: '700' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
