import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { useTripStore } from '../store/tripStore';
import { colors, spacing, radius, typography } from '../theme';
import {
  CameraFrame, ClaudeSpend, PlanRun, fetchClaudeSpend, fetchDayRuns, fetchFrames, fetchScores, fetchTripSettings,
  latestByDay, planDay, spendLine,
} from '../services/planner';
import { FrameModal, FrameTile } from '../components/planner/CameraView';

type DayRow = { id: string; date: string; day_number: number; run?: PlanRun; best?: number; mine?: number; top?: string[] };

// Forecast for the next 3 days, outlook to day 15, light only beyond.
export function dayBadge(date: string): { text: string; color: string } {
  const n = differenceInCalendarDays(parseISO(date), new Date());
  if (n < 0) return { text: 'PAST', color: colors.textTertiary };
  if (n <= 2) return { text: 'FORECAST', color: colors.signalOk };
  if (n <= 15) return { text: 'OUTLOOK', color: colors.signalWarning };
  return { text: 'LIGHT ONLY', color: colors.textSecondary };
}

export default function PlannerScreen() {
  const navigation = useNavigation<any>();
  const { tripId } = useRoute<any>().params;
  const { currentTripData } = useTripStore();
  const [rows, setRows] = useState<DayRow[]>([]);
  const [cams, setCams] = useState<CameraFrame[] | null>(null);
  const [open, setOpen] = useState<CameraFrame | null>(null);
  const [spend, setSpend] = useState<ClaudeSpend | null>(null);
  const [subjects, setSubjects] = useState<{ tier: string; nailed: number; got: number; left: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days: any[] = currentTripData?.days ?? [];

  const load = useCallback(async () => {
    setError(null);
    try {
      const runs = latestByDay(await fetchDayRuns(tripId));
      const base: DayRow[] = days.map((d: any) => {
        const m = runs.get(d.date) ?? {};
        return { id: d.id, date: d.date, day_number: d.day_number, run: m.forecast ?? m.light };
      });
      const scores = await fetchScores(base.filter(r => r.run).map(r => r.run!.id));
      setRows(base.map(r => ({ ...r, ...(r.run ? scores.get(r.run.id) : {}) })));
      const settings = await fetchTripSettings(tripId);
      setSubjects(['GOD', 'S'].map(t => {
        const s = settings.filter(x => x.tier === t);
        return {
          tier: t, nailed: s.filter(x => x.shot_status === 'nailed').length,
          got: s.filter(x => x.shot_status === 'got').length, left: s.filter(x => !x.shot_status).length,
        };
      }));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setLoading(false);
    fetchFrames().then(setCams).catch(() => setCams([]));
    fetchClaudeSpend().then(setSpend).catch(() => {});
  }, [tripId, days.length]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Plans every trip day that has none yet (light only before the forecast).
  const planMissing = async () => {
    const todo = rows.filter(r => !r.run && differenceInCalendarDays(parseISO(r.date), new Date()) >= 0);
    setPlanning({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      try { await planDay(tripId, todo[i].date); } catch { /* keep going */ }
      setPlanning({ done: i + 1, total: todo.length });
    }
    setPlanning(null);
    load();
  };

  const today = new Date();
  const next = rows.find(r => differenceInCalendarDays(parseISO(r.date), today) >= 0) ?? rows[0];
  const missing = rows.filter(r => !r.run && differenceInCalendarDays(parseISO(r.date), today) >= 0).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityLabel="Back to the trip">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Planner</Text>
          <Text style={styles.subtitle}>{currentTripData?.trip?.title ?? ''} · TEST</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.textSecondary} />}>
        {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {next ? (
          <TouchableOpacity style={styles.brief} activeOpacity={0.85}
            onPress={() => navigation.navigate('Plan', { tripId, tripDate: next.date, dayNumber: next.day_number })}>
            <Text style={styles.label}>NEXT TRIP DAY · DAY {next.day_number} · {format(parseISO(next.date), 'EEE d MMM')}</Text>
            {next.run ? (
              <>
                <Text style={styles.briefLine}>
                  Best plan {fmt(next.best)}{next.mine != null ? ` · your day ${fmt(next.mine)}` : ''}
                </Text>
                {next.top?.length ? <Text style={styles.briefSub}>Good chances: {next.top.join(', ')}</Text> : null}
              </>
            ) : <Text style={styles.briefSub}>Not planned yet. Tap to plan it.</Text>}
            <Text style={[styles.badge, { color: dayBadge(next.date).color }]}>{dayBadge(next.date).text}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.sectionHead}>
          <Text style={styles.label}>ALL DAYS</Text>
          {missing > 0 && !planning ? (
            <TouchableOpacity onPress={planMissing} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Plan {missing} days</Text>
            </TouchableOpacity>
          ) : null}
          {planning ? <Text style={styles.progress}>Planning {planning.done}/{planning.total}…</Text> : null}
        </View>
        {rows.map(r => {
          const b = dayBadge(r.date);
          return (
            <TouchableOpacity key={r.id} style={styles.dayRow} activeOpacity={0.8}
              onPress={() => navigation.navigate('Plan', { tripId, tripDate: r.date, dayNumber: r.day_number })}>
              <View style={{ width: 64 }}>
                <Text style={styles.dayNum}>DAY {r.day_number}</Text>
                <Text style={styles.dayDate}>{format(parseISO(r.date), 'EEE d MMM')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                {r.run ? (
                  <>
                    <Text style={styles.dayScore}>Best {fmt(r.best)}{r.mine != null ? ` · yours ${fmt(r.mine)}` : ''}</Text>
                    {r.top?.length ? <Text style={styles.dayTop} numberOfLines={1}>{r.top.join(' · ')}</Text> : null}
                  </>
                ) : <Text style={styles.dayTop}>Not planned</Text>}
              </View>
              <Text style={[styles.badge, { color: b.color }]}>{b.text}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.label, { marginTop: spacing.xl }]}>YOUR BIG SUBJECTS</Text>
        <View style={styles.subjRow}>
          {subjects.map(s => (
            <View key={s.tier} style={styles.subjCard}>
              <Text style={styles.subjTier}>{s.tier}</Text>
              <Text style={styles.subjLine}>{s.nailed} nailed · {s.got} got · {s.left} to go</Text>
            </View>
          ))}
        </View>
        <Text style={styles.hint}>Tick stops as Got it / Nailed it on each stop's screen.</Text>

        <Text style={[styles.label, { marginTop: spacing.xl }]}>CAMERAS NOW</Text>
        <Text style={styles.hint}>Tap one, check it, and say what you see. Your taps are the scoreboard's ground truth.</Text>
        {spend ? <Text style={styles.hint}>{spendLine(spend)}</Text> : null}
        {cams == null ? <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} /> : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm }}>
            {cams.map(c => <FrameTile key={c.camera.code} item={c} onPress={() => setOpen(c)} />)}
          </ScrollView>
        )}
      </ScrollView>
      <FrameModal item={open} onClose={() => { setOpen(null); fetchFrames().then(setCams).catch(() => {}); }} />
    </SafeAreaView>
  );
}

const fmt = (x?: number) => (x == null ? '—' : String(Math.round(x)));

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  title: { ...typography.displayMedium, fontSize: 20 },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  error: { color: '#e74c3c', fontSize: 12 },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  brief: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md,
    padding: spacing.lg, gap: 6, marginBottom: spacing.md,
  },
  briefLine: { fontFamily: 'Georgia', fontSize: 18, color: colors.textPrimary },
  briefSub: { fontSize: 13, color: colors.textSecondary },
  badge: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  smallBtn: {
    marginLeft: 'auto', minHeight: 32, paddingHorizontal: 12, justifyContent: 'center',
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  smallBtnText: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  progress: { marginLeft: 'auto', fontSize: 12, color: colors.textSecondary },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  dayNum: { ...typography.labelMedium, color: colors.textSecondary },
  dayDate: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  dayScore: { fontSize: 13, color: colors.textPrimary },
  dayTop: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  subjRow: { flexDirection: 'row', gap: spacing.sm },
  subjCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  subjTier: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  subjLine: { fontSize: 12, color: colors.textSecondary },
  hint: { fontSize: 12, color: colors.textTertiary },
});
