import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import {
  Light, LIGHT_CHOICES, ShotStatus, StopSettings, StopShot, TIER_CHOICES,
  fetchStopSettings, markShot, saveStopSettings,
} from '../../services/planner';

const STATES: { key: ShotStatus; text: string }[] = [
  { key: null, text: 'Not shot' },
  { key: 'got', text: 'Got it' },
  { key: 'nailed', text: 'Nailed it' },
];
const STATUS_TEXT: Record<string, string> = { got: 'got it', nailed: 'nailed it' };

// One line for a stop's planner settings: "front, side light · fog good · got it".
export function settingsSummary(s: Pick<StopSettings, 'light_wanted' | 'fog_wanted' | 'shot_status'> | null): string {
  if (!s) return '';
  const lights = (s.light_wanted ?? []).join(', ');
  return [lights ? `${lights} light` : null, s.fog_wanted ? 'fog good' : null, s.shot_status ? STATUS_TEXT[s.shot_status] : null]
    .filter(Boolean).join(' · ');
}

// Tier, light, fog, starred shot and got/nailed for one stop. Every tap
// saves straight away as Phil's own setting (source 'phil'); "Keep as is"
// confirms Claude's guess unchanged. onChange reports each saved setting.
export default function SettingsEditor({ stopId, initial, onChange }: {
  stopId: string; initial?: StopSettings | null; onChange?: (s: StopSettings) => void;
}) {
  const [setting, setSetting] = useState<StopSettings | null>(initial ?? null);
  const [shots, setShots] = useState<StopShot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStopSettings(stopId).then(r => { setSetting(r.setting); setShots(r.shots); }).catch(() => {});
  }, [stopId]);

  const apply = (s: StopSettings) => { setSetting(s); onChange?.(s); };
  const run = async (fn: () => Promise<StopSettings | null>) => {
    setSaving(true); setError(null);
    try { const s = await fn(); if (s) apply(s); }
    catch (e: any) { setError(/network|fetch/i.test(String(e?.message)) ? 'No connection. Try again when you have signal.' : String(e?.message ?? e)); }
    setSaving(false);
  };
  const save = (patch: Parameters<typeof saveStopSettings>[1]) => run(() => saveStopSettings(stopId, patch));
  const chooseShot = (s: ShotStatus) => {
    if (s === (setting?.shot_status ?? null)) return;
    run(async () => { await markShot(stopId, s); return setting ? { ...setting, shot_status: s } : null; });
  };
  const toggleLight = (l: Light) => {
    const cur = setting?.light_wanted ?? [];
    const next = cur.includes(l) ? cur.filter(x => x !== l) : [...cur, l];
    save({ light_wanted: LIGHT_CHOICES.map(c => c.key).filter(k => next.includes(k)) });
  };

  const tier = setting?.tier ?? null;
  const status = setting?.shot_status ?? null;
  const suggested = setting?.source === 'suggested';

  return (
    <View style={styles.editor}>
      <Field label="Shot">
        {STATES.map(s => <Chip key={String(s.key)} text={s.text} on={status === s.key} disabled={saving} onPress={() => chooseShot(s.key)} />)}
      </Field>
      <Field label="Tier">
        {TIER_CHOICES.map(t => <Chip key={t} text={t} on={tier === t} disabled={saving} onPress={() => save({ tier: tier === t ? null : t })} />)}
      </Field>
      <Field label="Light">
        {LIGHT_CHOICES.map(l => (
          <Chip key={l.key} text={l.text} on={(setting?.light_wanted ?? []).includes(l.key)} disabled={saving} onPress={() => toggleLight(l.key)} />
        ))}
        <Chip text="Fog is good" on={!!setting?.fog_wanted} disabled={saving} onPress={() => save({ fog_wanted: !setting?.fog_wanted })} />
      </Field>
      {shots.length > 1 ? (
        <Field label="★ Shot">
          {shots.map(s => {
            const on = (setting?.star_vantage_id ?? shots[0].vantage_id) === s.vantage_id;
            return <Chip key={s.vantage_id} text={`${on ? '★ ' : ''}${s.name}`} on={on} disabled={saving}
              onPress={() => save({ star_vantage_id: s.vantage_id })} />;
          })}
        </Field>
      ) : null}
      <View style={styles.footer}>
        {saving ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        {suggested ? (
          <>
            <Text style={[styles.hint, { flex: 1 }]}>Claude's guess. Change anything, or keep it as it is.</Text>
            <Chip text="Keep as is" on={false} disabled={saving} onPress={() => save({})} />
          </>
        ) : setting ? <Text style={[styles.hint, { flex: 1 }]}>Your settings. Plans use them from the next run.</Text>
          : <Text style={[styles.hint, { flex: 1 }]}>Not rated: pick a tier to have the planner consider it.</Text>}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

export function Chip({ text, on, disabled, onPress }: { text: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button" accessibilityState={{ selected: on, disabled }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hint: { fontSize: 12, color: colors.textTertiary },
  error: { fontSize: 12, color: '#e74c3c' },
});
