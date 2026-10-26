import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { updateStop } from '../services/supabase';
import { planDurationChange } from '../services/driveTimes';
import { useTripStore } from '../store/tripStore';
import { addMinutesToTimeLabel, minutesToHoursMin } from '../utils/helpers';

// How long Phil spends at a stop. Saving moves the stops behind it on the
// same day (see planDurationChange: back-to-back stops follow, gaps absorb,
// fixed times never move). The planner reads the new length on its next run.

type Props = { visible: boolean; onClose: () => void; stop: any; dayStops: any[] };

const STEPS = [-30, -15, 15, 30];

export default function StopDurationEditor({ visible, onClose, stop, dayStops }: Props) {
  const { refreshCurrentTrip } = useTripStore();
  const [minutes, setMinutes] = useState<number>(stop.duration_minutes || 30);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { const m = stop.duration_minutes || 30; setMinutes(m); setText(String(m)); setError(null); }
  }, [visible, stop.id]);

  const set = (m: number) => { const v = Math.max(5, Math.min(16 * 60, Math.round(m))); setMinutes(v); setText(String(v)); };
  const onText = (t: string) => { setText(t); const n = parseInt(t, 10); if (n > 0) setMinutes(Math.min(16 * 60, n)); };

  const { shifts, clash } = useMemo(() => planDurationChange(dayStops, stop.id, minutes), [dayStops, stop.id, minutes]);
  const changed = minutes !== (stop.duration_minutes || 0);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await updateStop(stop.id, { duration_minutes: minutes });
      for (const s of shifts) await updateStop(s.id, { time_label: s.to });
      refreshCurrentTrip().catch(() => {});
      onClose();
    } catch (e: any) {
      setError(/network|fetch/i.test(String(e?.message)) ? 'No connection. Try again when you have signal.' : String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Time at this stop</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{stop.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.big}>{minutesToHoursMin(minutes)}</Text>
          {stop.time_label ? (
            <Text style={styles.line}>{stop.time_label} – {addMinutesToTimeLabel(stop.time_label, minutes)}</Text>
          ) : null}

          <View style={styles.stepRow}>
            {STEPS.map(d => (
              <TouchableOpacity key={d} style={styles.step} onPress={() => set(minutes + d)} accessibilityLabel={`${d > 0 ? 'Add' : 'Take off'} ${Math.abs(d)} minutes`}>
                <Text style={styles.stepText}>{d > 0 ? `+${d}` : d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput style={styles.input} value={text} onChangeText={onText} keyboardType="number-pad" accessibilityLabel="Minutes" />
            <Text style={styles.line}>minutes</Text>
          </View>

          {changed && shifts.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Later stops move</Text>
              {shifts.map(s => <Text key={s.id} style={styles.line}>{s.name}: {s.from} → {s.to}</Text>)}
            </View>
          ) : changed ? (
            <Text style={styles.hint}>Nothing later today moves: the next stop has room.</Text>
          ) : null}
          {clash ? (
            <Text style={styles.warn}>Runs into {clash}, which has a fixed time. It stays put, so check the day.</Text>
          ) : null}
          <Text style={styles.hint}>Stops right after this one move with it; a stop after a gap only moves if this runs into it. The planner uses the new length from its next run.</Text>

          {!!error && <Text style={styles.warn}>{error}</Text>}
          <TouchableOpacity style={[styles.primary, (!changed || saving) && { opacity: 0.4 }]} onPress={save} disabled={!changed || saving}>
            {saving ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="checkmark" size={18} color="#000" />}
            <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.xl, gap: 10,
    paddingBottom: 36, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  big: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginTop: 6 },
  stepRow: { flexDirection: 'row', gap: 8 },
  step: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  stepText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 80,
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.surface, textAlign: 'center',
  },
  line: { color: '#aaaaaa', fontSize: 13, textAlign: 'center' },
  hint: { color: colors.textTertiary, fontSize: 11, lineHeight: 16 },
  warn: { color: '#e2b25a', fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4 },
  cardTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ffffff',
    borderRadius: 10, minHeight: 46, marginTop: 4,
  },
  primaryText: { color: '#000000', fontSize: 15, fontWeight: '700' },
});
