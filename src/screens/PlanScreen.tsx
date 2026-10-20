import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius, typography } from '../theme';
import {
  Plan, PlanRun, PlanVisit, applyPreview, fetchDayRuns, fetchPlans, hhmm, ago, latestByDay, planDay, LIGHT_WORDS,
} from '../services/planner';
import { dayBadge } from './PlannerScreen';
import { useTripStore } from '../store/tripStore';

type Mode = 'auto' | 'preview';

const MODE_TEXT: Record<string, string> = {
  forecast: 'Forecast for this day',
  light: 'Light only: real sun for this date, typical (mostly cloudy) weather',
  preview: "Preview: this week's forecast played as this day (today's sun, not the trip's)",
};

function planTitle(p: Plan) {
  if (p.rank === 0) return 'My day';
  if (p.note?.startsWith('safest')) return 'Safest';
  return p.rank === 1 ? 'Best' : `Alt ${p.rank}`;
}

export default function PlanScreen() {
  const navigation = useNavigation<any>();
  const { tripId, tripDate, dayNumber } = useRoute<any>().params;
  const [mode, setMode] = useState<Mode>('auto');
  const [run, setRun] = useState<PlanRun | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sel, setSel] = useState(1);
  const [busy, setBusy] = useState<string | null>('Loading…');
  const [error, setError] = useState<string | null>(null);
  const [apply, setApply] = useState<any | null>(null);
  const { currentTripData } = useTripStore();
  // A plan's stop lives on whichever trip day holds it now.
  const openStop = (stopId: string) => {
    const day = currentTripData?.days.find((d: any) => (d.stops || []).some((x: any) => x.id === stopId));
    if (day) navigation.navigate('StopDetail', { stopId, dayId: day.id });
  };

  const load = useCallback(async (m: Mode, replan = false) => {
    setError(null);
    try {
      let runId: string | null = null;
      if (!replan) {
        const latest = latestByDay(await fetchDayRuns(tripId)).get(tripDate) ?? {};
        const r = m === 'preview' ? latest.preview : (latest.forecast ?? latest.light);
        runId = r?.id ?? null;
      }
      if (!runId) {
        setBusy(m === 'preview' ? "Planning with this week's weather…" : 'Planning this day…');
        runId = await planDay(tripId, tripDate, m === 'preview');
      }
      const runs = await fetchDayRuns(tripId, 40);
      const r = runs.find(x => x.id === runId) ?? null;
      const ps = await fetchPlans(runId);
      setRun(r); setPlans(ps);
      setSel(ps.some(p => p.rank === 1) ? 1 : ps[0]?.rank ?? 1);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setBusy(null);
  }, [tripId, tripDate]);

  useEffect(() => { load(mode); }, [mode]);

  const tz: string | undefined = run?.params?.tz;
  const plan = plans.find(p => p.rank === sel);
  const runDay = run?.stats?.days?.[0];
  const kind = runDay?.light_only ? 'light' : runDay && runDay.date !== runDay.trip_date ? 'preview' : 'forecast';
  const badge = dayBadge(tripDate);

  const openApply = async () => {
    if (!run || !plan) return;
    setBusy('Working out what would move…');
    try { setApply((await applyPreview(run.id, plan.rank)).result); } catch (e: any) { setError(String(e?.message ?? e)); }
    setBusy(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Day {dayNumber} · {format(parseISO(tripDate), 'EEE d MMM')}</Text>
          <Text style={[styles.badge, { color: badge.color }]}>{badge.text}</Text>
        </View>
        <TouchableOpacity onPress={() => load(mode, true)} style={styles.iconBtn} disabled={!!busy} accessibilityLabel="Plan again">
          <Ionicons name="refresh" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.modeRow}>
        {(['auto', 'preview'] as Mode[]).map(m => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeBtn, mode === m && styles.modeOn]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>
              {m === 'auto' ? (badge.text === 'LIGHT ONLY' ? 'Light only' : 'This day') : "This week's weather"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {busy ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.hint}>{busy}</Text></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.hint}>
            {MODE_TEXT[kind]}{run ? ` · planned ${ago(run.created_at)}` : ''}
            {runDay?.start_hotel && runDay?.end_hotel && runDay.start_hotel !== runDay.end_hotel
              ? `\nMove day: ${runDay.start_hotel} → ${runDay.end_hotel}` : ''}
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {plans.map(p => (
              <TouchableOpacity key={p.rank} onPress={() => setSel(p.rank)} style={[styles.chip, sel === p.rank && styles.chipOn]}>
                <Text style={[styles.chipText, sel === p.rank && styles.chipTextOn]}>{planTitle(p)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {plan ? (
            <>
              <Text style={styles.summary}>
                Expected <Text style={styles.bold}>{Math.round(plan.mean)}</Text>
                {'  ·  '}bad weather <Text style={styles.bold}>{Math.round(plan.cvar11)}</Text>
                {plan.drive_minutes != null ? `  ·  ${plan.drive_minutes} min driving` : ''}
                {plan.long_leg_minutes ? ` (${plan.long_leg_minutes} min over an hour)` : ''}
              </Text>
              {plan.visits.map((v, i) => <VisitRow key={`${v.stop_id}-${i}`} v={v} tz={tz} mine={plan.rank === 0}
                onPress={() => openStop(v.stop_id)} />)}
              {plan.rank !== 0 ? (
                <TouchableOpacity style={styles.applyBtn} onPress={openApply}>
                  <Text style={styles.applyText}>Use this plan…</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.hint}>
                Chance = share of the 51 weather versions (or light scenarios) where the shot comes out good.
              </Text>
            </>
          ) : <Text style={styles.hint}>No plan.</Text>}
        </ScrollView>
      )}

      <Modal visible={!!apply} transparent animationType="slide" onRequestClose={() => setApply(null)}>
        <View style={styles.sheetBg}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>What would change</Text>
              <TouchableOpacity onPress={() => setApply(null)} style={styles.iconBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              Preview only in the TEST app: nothing is moved on your real trip until the solver is signed off.
              {apply?.stops_changed != null ? ` ${apply.stops_changed} stops would change.` : ''}
            </Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {(apply?.days ?? []).map((d: any) => (
                <View key={d.date} style={{ marginTop: spacing.md }}>
                  <Text style={styles.label}>DAY {d.day_number} · {format(parseISO(d.date), 'EEE d MMM')}</Text>
                  {d.stops.map((s: any) => (
                    <View key={`${d.date}-${s.position}`} style={styles.applyRow}>
                      <Text style={styles.applyTime}>{s.time_label ?? ''}</Text>
                      <Text style={[styles.applyName, s.planned && styles.bold]} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.applyTag}>
                        {s.moved_from ? `from ${format(parseISO(s.moved_from), 'd MMM')}` : s.retimed ? 'new time' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function VisitRow({ v, tz, mine, onPress }: { v: PlanVisit; tz?: string; mine: boolean; onPress: () => void }) {
  const pct = v.p_good != null ? Math.round(v.p_good * 100) : null;
  const barColor = pct == null ? colors.border : pct >= 60 ? colors.signalOk : pct >= 30 ? '#aaaaaa' : '#555555';
  const light = v.light ? LIGHT_WORDS[v.light] ?? v.light : null;
  const muted = mine && !v.rated;
  return (
    <TouchableOpacity style={styles.visit} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.visitTime, muted && styles.muted]}>{hhmm(v.start, tz)}</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.visitName, muted && styles.muted]} numberOfLines={2}>{v.name}</Text>
          {v.booked ? <Text style={styles.booked}>BOOKED</Text> : null}
        </View>
        {pct != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.barBg}><View style={[styles.bar, { width: `${Math.max(pct, 3)}%`, backgroundColor: barColor }]} /></View>
            <Text style={styles.visitMeta}>
              {pct}%{light ? ` · ${light}` : ''}{v.peak_at && v.peak_at !== v.start ? ` at ${hhmm(v.peak_at, tz)}` : ''}
            </Text>
          </View>
        ) : null}
        {!mine && (v.wait_min || v.drive_min) ? (
          <Text style={styles.visitSub}>
            {v.drive_min ? `${v.drive_min} min drive` : ''}{v.drive_min && v.wait_min ? ' · ' : ''}{v.wait_min ? `${v.wait_min} min wait` : ''}
          </Text>
        ) : null}
        {mine && v.best && v.best.p_good > (v.p_good ?? 0) + 0.1 ? (
          <Text style={styles.hintChip}>Better at {hhmm(v.best.start, tz)}: {Math.round(v.best.p_good * 100)}%</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headlineLarge },
  badge: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  modeRow: { flexDirection: 'row', margin: spacing.lg, marginBottom: 0, backgroundColor: colors.surface, borderRadius: radius.sm, padding: 3 },
  modeBtn: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm - 2 },
  modeOn: { backgroundColor: colors.accent },
  modeText: { fontSize: 13, color: colors.textSecondary },
  modeTextOn: { color: colors.textInverse, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  hint: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
  error: { fontSize: 13, color: '#e74c3c', textAlign: 'center' },
  chips: { gap: 6, paddingVertical: spacing.sm },
  chip: { minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse, fontWeight: '700' },
  summary: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  bold: { fontWeight: '700', color: colors.textPrimary },
  visit: {
    flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  visitTime: { width: 46, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  visitName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  muted: { color: colors.textTertiary, fontWeight: '400' },
  booked: { fontSize: 9, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  barBg: { width: 70, height: 4, borderRadius: 2, backgroundColor: colors.border },
  bar: { height: 4, borderRadius: 2 },
  visitMeta: { fontSize: 12, color: colors.textSecondary, flexShrink: 1 },
  visitSub: { fontSize: 11, color: colors.textTertiary },
  hintChip: {
    alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', color: colors.signalOk,
    borderWidth: 1, borderColor: colors.signalOk, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5,
  },
  applyBtn: { marginTop: spacing.lg, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 15, fontWeight: '700', color: colors.textInverse },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  sheetTitle: { flex: 1, ...typography.headlineLarge },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 30 },
  applyTime: { width: 70, fontSize: 12, color: colors.textSecondary },
  applyName: { flex: 1, fontSize: 13, color: colors.textPrimary },
  applyTag: { fontSize: 11, color: colors.signalOk },
});
