import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import { TripSetting, clock12, fetchTripSettings } from '../../services/planner';
import { VERDICT_COLOR, VERDICT_TEXT, countText, verdictOf } from '../../services/plannerWords';
import { TWeek, mineVisit, placements, tripWeek } from '../../services/plannerWeek';

type Filter = 'big' | 'rated' | 'open';
const TIER_ORDER = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F'];

// Where T puts each subject across the trip, and how good a bet it is there (Phil, 3 Nov 2026:
// one chance everywhere, T's own). A filled cell is a day T plans the subject (green Good bet,
// grey Long shot, dark Skip); an outlined cell is the subject's own day on your plan.
export default function SubjectsTab({ tripId, days, tz, goPlans }: {
  tripId: string; days: any[]; tz?: string; goPlans: (date: string) => void;
}) {
  const [week, setWeek] = useState<TWeek | null>(null);
  const [settings, setSettings] = useState<Map<string, TripSetting>>(new Map());
  const [filter, setFilter] = useState<Filter>('big');
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setError(null);
    try {
      const [w, st] = await Promise.all([tripWeek(tripId, days, fresh), fetchTripSettings(tripId)]);
      setWeek(w);
      setSettings(new Map(st.map(s => [s.stop_id, s])));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setLoading(false);
  }, [tripId, days.length]);
  useEffect(() => { load(); }, [load]);

  const dated = days.filter((d: any) => d.date);
  const stops = new Map<string, any>();
  for (const d of days) for (const s of d.stops ?? []) stops.set(s.id, { ...s, day: d });
  const rows = [...stops.keys()].map(id => ({ id, s: stops.get(id), st: settings.get(id) }))
    .filter(r => r.s && r.st?.tier && r.st.tier !== 'F')
    .filter(r => filter === 'rated' || (filter === 'big' ? ['GOD', 'S'].includes(r.st!.tier!) : r.st!.shot_status !== 'nailed'))
    .sort((a, b) => TIER_ORDER.indexOf(a.st!.tier!) - TIER_ORDER.indexOf(b.st!.tier!) || a.s.name.localeCompare(b.s.name));
  const todayIdx = dated.findIndex((d: any) => differenceInCalendarDays(parseISO(d.date), new Date()) >= 0);

  return (
    <ScrollView contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(true)} tintColor={colors.textSecondary} />}>
      <Text style={styles.headline}>Where T puts each subject</Text>
      <View style={styles.filters}>
        {([['big', 'GOD + S'], ['rated', 'All rated'], ['open', 'Not nailed yet']] as [Filter, string][]).map(([f, t]) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.legend}>
        <View style={[styles.cell, styles.great]} /><Text style={styles.legendText}>Good bet</Text>
        <View style={[styles.cell, styles.soso]} /><Text style={styles.legendText}>Long shot</Text>
        <View style={[styles.cell, styles.poor]} /><Text style={styles.legendText}>Skip</Text>
        <View style={[styles.cell, styles.own]} /><Text style={styles.legendText}>your day for it</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {rows.length ? (
        <View style={styles.dayHead}>
          <View style={styles.nameCol} />
          <View style={styles.cells}>
            {dated.map((d: any, i: number) => (
              <Text key={d.id} style={[styles.dayLabel, i === todayIdx && styles.today]} numberOfLines={1}>{d.day_number}</Text>
            ))}
          </View>
        </View>
      ) : null}

      {rows.map(({ id, s, st }) => {
        const where = placements(week, id);
        const top = where[0];
        const isOpen = open === id;
        const ownMine = s.day?.date ? mineVisit(week, id, s.day.date) : null;
        return (
          <View key={id}>
            <TouchableOpacity style={styles.row} onPress={() => setOpen(isOpen ? null : id)} activeOpacity={0.8}
              accessibilityRole="button" accessibilityLabel={`${s.name}. ${top ? `Best: Day ${top.dayNumber}, ${VERDICT_TEXT[verdictOf(top.visit.p_good)]}` : "Not in T's plans"}`}>
              <View style={styles.nameCol}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {st!.tier}{st!.shot_status === 'nailed' ? ' · ✓ nailed' : st!.shot_status === 'got' ? ' · ✓ got, go back' : ''}{s.time_locked ? ' · booked' : ''}
                </Text>
              </View>
              <View style={styles.cells}>
                {dated.map((d: any) => {
                  const t = where.find(w => w.date === d.date);
                  const own = s.day?.id === d.id;
                  const v = t?.visit.p_good ?? null;
                  const k = v != null ? verdictOf(v) : null;
                  return <View key={d.id} style={[styles.cell, k === 'good' ? styles.great : k === 'long' ? styles.soso : k === 'skip' ? styles.poor : styles.empty, own && styles.own]} />;
                })}
              </View>
            </TouchableOpacity>
            {isOpen ? (
              <View style={styles.detail}>
                <Text style={styles.hint}>
                  {top ? `T's best: Day ${top.dayNumber} at ${clock12(top.visit.start, top.run.params?.tz ?? tz)}, ${VERDICT_TEXT[verdictOf(top.visit.p_good)]} (${countText(top.visit, top.run)}).`
                    : "T doesn't plan it on any day yet."}
                  {s.day ? ` Your plan: Day ${s.day.day_number}${ownMine ? `, ${VERDICT_TEXT[verdictOf(ownMine.p_good)]} (${countText(ownMine, week?.byDate.get(s.day.date)?.run)})` : ''}.` : ''}
                </Text>
                {where.sort((a, b) => a.date.localeCompare(b.date)).map(w => (
                  <View key={w.date} style={styles.detailRow}>
                    <Text style={styles.detailDay}>D{w.dayNumber} {format(parseISO(w.date), 'EEE d')}</Text>
                    <Text style={[styles.detailVal, { color: VERDICT_COLOR[verdictOf(w.visit.p_good)] }]}>
                      {VERDICT_TEXT[verdictOf(w.visit.p_good)]} <Text style={styles.detailSub}>{countText(w.visit, w.run)} · {clock12(w.visit.start, w.run.params?.tz ?? tz)}</Text>
                    </Text>
                    <TouchableOpacity onPress={() => goPlans(w.date)} style={styles.planBtn}>
                      <Text style={styles.link}>Plan ›</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {!loading && !rows.length ? <Text style={styles.hint}>No rated subjects here yet. Rate stops in Setup.</Text> : null}
      <Text style={styles.hint}>Chances are T's: its forecasts for the next 3 days, then the real sun with typical weather for the date, so later days look alike until the forecast reaches them.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  headline: { fontFamily: 'Georgia', fontSize: 18, color: colors.textPrimary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse, fontWeight: '700' },
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  legendText: { fontSize: 11, color: colors.textTertiary, marginRight: 6 },
  dayHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 9, color: colors.textTertiary },
  today: { color: colors.textPrimary, fontWeight: '800' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  nameCol: { width: 120 },
  name: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  meta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  cells: { flex: 1, flexDirection: 'row', gap: 2 },
  cell: { flex: 1, height: 16, minWidth: 6, borderRadius: 3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  great: { backgroundColor: colors.signalOk },
  soso: { backgroundColor: '#5a5a5a' },
  poor: { backgroundColor: '#2e2e2e' },
  empty: { backgroundColor: 'transparent' },
  own: { borderColor: colors.accent },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
  detail: { paddingLeft: spacing.sm, paddingBottom: spacing.md, gap: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  detailDay: { width: 80, fontSize: 12, color: colors.textSecondary },
  detailVal: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  detailSub: { fontWeight: '400', color: colors.textSecondary },
  planBtn: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  link: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  error: { color: '#e74c3c', fontSize: 12 },
  hint: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
});
