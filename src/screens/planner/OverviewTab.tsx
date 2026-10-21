import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import {
  Brief, CameraFrame, ClaudeSpend, PlanRun, TripSetting, fetchBrief, fetchClaudeSpend, fetchDayRuns, fetchScores,
  fetchTripFrames, fetchTripSettings, latestByDay, planDay, spendLine,
} from '../../services/planner';
import { FrameModal, FrameTile } from '../../components/planner/CameraView';
import { dayBadge } from '../../components/planner/dayBadge';
import { markBriefSeen } from '../../services/plannerSeen';

type DayRow = { id: string; date: string; day_number: number; run?: PlanRun; best?: number; mine?: number; top?: string[] };

export default function OverviewTab({ tripId, days, goPlans, goTab, extra }: {
  tripId: string; days: any[]; goPlans: (date: string) => void; goTab: (t: 'setup' | 'subjects') => void;
  extra?: React.ReactNode;
}) {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [cams, setCams] = useState<CameraFrame[] | null>(null);
  const [open, setOpen] = useState<CameraFrame | null>(null);
  const [spend, setSpend] = useState<ClaudeSpend | null>(null);
  const [settings, setSettings] = useState<TripSetting[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const st = await fetchTripSettings(tripId);
      setSettings(st);
      const next = base.find(r => differenceInCalendarDays(parseISO(r.date), new Date()) >= 0);
      if (next) {
        const tiers = new Map(st.map(s => [s.stop_id, s.tier]));
        const b = await fetchBrief(tripId, next.date, id => tiers.get(id) ?? null).catch(() => null);
        setBrief(b);
        if (b) markBriefSeen(tripId, b.runAt);
      }
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setLoading(false);
    fetchTripFrames(tripId).then(setCams).catch(() => setCams([]));
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
  const guesses = settings.filter(s => s.source === 'suggested').length;
  const big = (t: string) => {
    const s = settings.filter(x => x.tier === t);
    return { n: s.length, nailed: s.filter(x => x.shot_status === 'nailed').length, got: s.filter(x => x.shot_status === 'got').length };
  };
  const god = big('GOD'), sTier = big('S');

  return (
    <ScrollView contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.textSecondary} />}>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {next ? (
        <TouchableOpacity style={styles.brief} activeOpacity={0.85} onPress={() => goPlans(next.date)}>
          <Text style={styles.label}>
            {brief ? 'TONIGHT\'S BRIEF · ' : 'NEXT TRIP DAY · '}DAY {next.day_number} · {format(parseISO(next.date), 'EEE d MMM').toUpperCase()}
          </Text>
          {brief ? (
            <>
              <Text style={styles.briefLine}>{brief.headline}{brief.leave ? ` ${brief.leave}` : ''}</Text>
              {brief.changes.map(c => <Text key={c} style={styles.briefSub}>{c}</Text>)}
              {!brief.changes.length ? <Text style={styles.briefSub}>No big changes since the last plan.</Text> : null}
            </>
          ) : next.run ? (
            <Text style={styles.briefLine}>Best plan {fmt(next.best)}{next.mine != null ? ` · your day ${fmt(next.mine)}` : ''}</Text>
          ) : <Text style={styles.briefSub}>Not planned yet. Tap to plan it.</Text>}
          <View style={styles.briefFoot}>
            <Text style={[styles.badge, { color: dayBadge(next.date).color }]}>{dayBadge(next.date).text}</Text>
            <Text style={styles.link}>Open the day's plan ›</Text>
          </View>
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
          <TouchableOpacity key={r.id} style={styles.dayRow} activeOpacity={0.8} onPress={() => goPlans(r.date)}>
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
      <TouchableOpacity style={styles.subjRow} onPress={() => goTab('subjects')} activeOpacity={0.85}>
        {[['GOD', god], ['S', sTier]].map(([t, c]: any) => (
          <View key={t} style={styles.subjCard}>
            <Text style={styles.subjTier}>{t} <Text style={styles.subjCount}>{c.n}</Text></Text>
            <Text style={styles.subjLine}>{c.nailed} nailed · {c.got} got · {c.n - c.nailed - c.got} to go</Text>
          </View>
        ))}
      </TouchableOpacity>
      {guesses > 0 ? (
        <TouchableOpacity style={styles.nudge} onPress={() => goTab('setup')} activeOpacity={0.85}>
          <Text style={styles.nudgeText}>{guesses} stops still use my guesses</Text>
          <Text style={styles.link}>Tier and light · 2 minutes to confirm ›</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={[styles.label, { marginTop: spacing.xl }]}>CAMERAS NOW</Text>
      <Text style={styles.hint}>Tap one, check it, and say what you see. Your taps are the scoreboard's ground truth.</Text>
      {cams == null ? <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} />
        : cams.length === 0 ? <Text style={styles.hint}>No cameras near this trip's stops yet.</Text> : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm }}>
          {cams.map(c => <FrameTile key={c.camera.code} item={c} onPress={() => setOpen(c)} />)}
        </ScrollView>
      )}
      {spend ? <Text style={styles.hint}>{spendLine(spend)}</Text> : null}
      {extra}
      <FrameModal item={open} onClose={() => { setOpen(null); fetchTripFrames(tripId).then(setCams).catch(() => {}); }} />
    </ScrollView>
  );
}

const fmt = (x?: number) => (x == null ? '—' : String(Math.round(x)));

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  error: { color: '#e74c3c', fontSize: 12 },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  brief: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md,
    padding: spacing.lg, gap: 6, marginBottom: spacing.md,
  },
  briefLine: { fontFamily: 'Georgia', fontSize: 18, lineHeight: 24, color: colors.textPrimary },
  briefSub: { fontSize: 13, color: colors.textSecondary },
  briefFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  link: { fontSize: 12, color: colors.accent, fontWeight: '600' },
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
  subjCount: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  subjLine: { fontSize: 12, color: colors.textSecondary },
  nudge: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  nudgeText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textTertiary },
});
