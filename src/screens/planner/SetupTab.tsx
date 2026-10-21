import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import { StopSettings, TripSetting, confirmAllSettings, fetchTripSettings } from '../../services/planner';
import SettingsEditor, { settingsSummary } from '../../components/planner/SettingsEditor';

type Filter = 'guess' | 'mine' | 'unrated' | 'all';

// What the planner knows about each photo stop: tier, light, starred shot.
// Tap a row to change it; "Keep all" confirms every guess at once.
export default function SetupTab({ tripId, days }: { tripId: string; days: any[] }) {
  const [settings, setSettings] = useState<Map<string, TripSetting>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('guess');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSettings(new Map((await fetchTripSettings(tripId)).map(s => [s.stop_id, s]))); } catch { /* keep the old list */ }
    setLoading(false);
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  const shooting = days.flatMap((d: any) => (d.stops ?? []).filter((s: any) => s.shot_type !== 'logistics').map((s: any) => ({ s, d })));
  const kind = (id: string): Filter => {
    const st = settings.get(id);
    return !st?.tier ? 'unrated' : st.source === 'suggested' ? 'guess' : 'mine';
  };
  const counts = { guess: 0, mine: 0, unrated: 0, all: shooting.length };
  for (const { s } of shooting) counts[kind(s.id)]++;
  // The row being edited stays put even when an edit moves it out of the filter.
  const shown = shooting.filter(({ s }) => filter === 'all' || kind(s.id) === filter || s.id === open);
  const bookings = days.flatMap((d: any) => (d.stops ?? []).filter((s: any) => s.time_locked).map((s: any) => ({ s, d })));
  const rated = counts.guess + counts.mine;

  const keepAll = async () => {
    setBusy(true); setNote(null);
    try { const n = await confirmAllSettings(tripId); setNote(`Kept ${n} guesses as your settings.`); await load(); }
    catch (e: any) { setNote(String(e?.message ?? e)); }
    setBusy(false);
  };
  const update = (id: string, s: StopSettings) => setSettings(m => new Map(m).set(id, { ...s, stop_id: id }));

  let lastDay: string | null = null;
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.headline}>{rated} rated · {counts.guess} still my guesses</Text>
      <View style={styles.bar}>
        <View style={[styles.barMine, { flex: counts.mine || 0.0001 }]} />
        <View style={[styles.barGuess, { flex: counts.guess || 0.0001 }]} />
        <View style={[styles.barNone, { flex: counts.unrated || 0.0001 }]} />
      </View>
      <View style={styles.filters}>
        {([['guess', 'My guesses'], ['mine', 'Confirmed'], ['unrated', 'Not rated'], ['all', 'All']] as [Filter, string][]).map(([f, t]) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{t} {counts[f]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : null}

      {shown.map(({ s, d }) => {
        const st = settings.get(s.id) ?? null;
        const head = d.id !== lastDay ? (lastDay = d.id) : null;
        const isOpen = open === s.id;
        return (
          <View key={s.id}>
            {head ? <Text style={[styles.label, { marginTop: spacing.md }]}>DAY {d.day_number}{d.date ? ` · ${format(parseISO(d.date), 'EEE d MMM').toUpperCase()}` : ''}</Text> : null}
            <TouchableOpacity style={styles.row} onPress={() => setOpen(isOpen ? null : s.id)} activeOpacity={0.8}
              accessibilityState={{ expanded: isOpen }}>
              {st?.tier ? <Text style={styles.tier}>{st.tier}</Text> : <Text style={styles.tierNone}>—</Text>}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{settingsSummary(st) || (st?.tier ? 'no light set' : 'not rated')}</Text>
              </View>
              {st?.source === 'suggested' ? <Text style={styles.guess}>MY GUESS</Text> : null}
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            {isOpen ? <View style={styles.editor}><SettingsEditor stopId={s.id} initial={st} onChange={x => update(s.id, x)} /></View> : null}
          </View>
        );
      })}
      {!loading && !shown.length ? <Text style={styles.hint}>Nothing here.</Text> : null}

      {counts.guess > 0 ? (
        <TouchableOpacity style={styles.keepBtn} onPress={keepAll} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.keepText}>Keep all {counts.guess} guesses as they are</Text>}
        </TouchableOpacity>
      ) : null}
      {note ? <Text style={styles.hint}>{note}</Text> : null}

      <Text style={[styles.label, { marginTop: spacing.xl }]}>BOOKINGS THE PLANNER WON'T MOVE</Text>
      {bookings.length ? bookings.map(({ s, d }) => (
        <Text key={s.id} style={styles.booking}>D{d.day_number} {s.time_label ?? ''} · {s.name}</Text>
      )) : <Text style={styles.hint}>None. Lock a stop's time in the trip to keep the planner from moving it.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  headline: { fontFamily: 'Georgia', fontSize: 18, color: colors.textPrimary },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.border },
  barMine: { backgroundColor: colors.signalOk },
  barGuess: { backgroundColor: colors.accentDim },
  barNone: { backgroundColor: colors.border },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  chip: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse, fontWeight: '700' },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  tier: { width: 36, textAlign: 'center', fontSize: 11, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  tierNone: { width: 36, textAlign: 'center', fontSize: 12, color: colors.textTertiary },
  name: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  guess: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: colors.textTertiary },
  editor: { paddingLeft: 44, paddingBottom: spacing.sm },
  keepBtn: { marginTop: spacing.lg, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  keepText: { fontSize: 15, fontWeight: '700', color: colors.textInverse },
  booking: { fontSize: 13, color: colors.textPrimary, paddingVertical: 4 },
  hint: { fontSize: 12, color: colors.textTertiary },
});
