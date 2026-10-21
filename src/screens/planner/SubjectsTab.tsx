import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import {
  GridCell, TripSetting, fetchDayRuns, fetchPlans, fetchSubjectGrid, fetchTripSettings, hhmm, latestByDay,
} from '../../services/planner';

type Filter = 'big' | 'rated' | 'open';
const TIER_ORDER = ['GOD', 'S', 'A', 'B', 'C', 'D', 'F'];

// Each subject's chances across the trip: which day is best for it, whether a
// day's Best plan already has it, and whether it's shot.
export default function SubjectsTab({ tripId, days, tz, goPlans }: {
  tripId: string; days: any[]; tz?: string; goPlans: (date: string) => void;
}) {
  const [grid, setGrid] = useState<Map<string, Map<string, GridCell>>>(new Map());
  const [settings, setSettings] = useState<Map<string, TripSetting>>(new Map());
  const [inPlan, setInPlan] = useState<Map<string, Set<string>>>(new Map());
  const [filter, setFilter] = useState<Filter>('big');
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cells, st, runs] = await Promise.all([fetchSubjectGrid(tripId), fetchTripSettings(tripId), fetchDayRuns(tripId)]);
      const g = new Map<string, Map<string, GridCell>>();
      for (const c of cells) { if (!g.has(c.stop_id)) g.set(c.stop_id, new Map()); g.get(c.stop_id)!.set(c.trip_date, c); }
      setGrid(g);
      setSettings(new Map(st.map(s => [s.stop_id, s])));
      // Which stops each day's Best plan visits.
      const latest = latestByDay(runs);
      const plan = new Map<string, Set<string>>();
      await Promise.all([...latest.entries()].map(async ([d, m]) => {
        const r = m.forecast ?? m.light;
        if (!r) return;
        const best = (await fetchPlans(r.id)).find(p => p.rank === 1);
        plan.set(d, new Set((best?.visits ?? []).map(v => v.stop_id)));
      }));
      setInPlan(plan);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setLoading(false);
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  const dated = days.filter((d: any) => d.date);
  const stops = new Map<string, any>();
  for (const d of days) for (const s of d.stops ?? []) stops.set(s.id, { ...s, day: d });
  const rows = [...grid.keys()].map(id => ({ id, s: stops.get(id), st: settings.get(id) }))
    .filter(r => r.s && r.st?.tier)
    .filter(r => filter === 'rated' || (filter === 'big' ? ['GOD', 'S'].includes(r.st!.tier!) : !r.st!.shot_status))
    .sort((a, b) => TIER_ORDER.indexOf(a.st!.tier!) - TIER_ORDER.indexOf(b.st!.tier!) || a.s.name.localeCompare(b.s.name));
  const todayIdx = dated.findIndex((d: any) => differenceInCalendarDays(parseISO(d.date), new Date()) >= 0);

  return (
    <ScrollView contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.textSecondary} />}>
      <Text style={styles.headline}>Best day for each subject</Text>
      <View style={styles.filters}>
        {([['big', 'GOD + S'], ['rated', 'All rated'], ['open', 'Not shot yet']] as [Filter, string][]).map(([f, t]) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.legend}>
        <View style={[styles.cell, styles.great]} /><Text style={styles.legendText}>great</Text>
        <View style={[styles.cell, styles.soso]} /><Text style={styles.legendText}>so-so</Text>
        <View style={[styles.cell, styles.poor]}><View style={styles.dot} /></View><Text style={styles.legendText}>in that day's plan</Text>
        <Text style={styles.legendText}>· outline = its own day</Text>
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
        const cells = grid.get(id)!;
        const bestDay = [...cells.values()].sort((a, b) => b.p_good - a.p_good || b.mean - a.mean)[0];
        const isOpen = open === id;
        return (
          <View key={id}>
            <TouchableOpacity style={styles.row} onPress={() => setOpen(isOpen ? null : id)} activeOpacity={0.8}>
              <View style={styles.nameCol}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {st!.tier}{st!.shot_status ? ` · ✓ ${st!.shot_status}` : ''}{s.time_locked ? ' · booked' : ''}
                </Text>
              </View>
              <View style={styles.cells}>
                {dated.map((d: any) => {
                  const c = cells.get(d.date);
                  const pg = c?.p_good ?? 0;
                  return (
                    <View key={d.id} style={[styles.cell, pg >= 0.6 ? styles.great : pg >= 0.3 ? styles.soso : styles.poor,
                      s.day?.id === d.id && styles.own]}>
                      {inPlan.get(d.date)?.has(id) ? <View style={styles.dot} /> : null}
                    </View>
                  );
                })}
              </View>
            </TouchableOpacity>
            {isOpen ? (
              <View style={styles.detail}>
                <Text style={styles.hint}>
                  Planned on Day {s.day?.day_number}. Best: {bestDay ? `${format(parseISO(bestDay.trip_date), 'EEE d MMM')}, ${Math.round(bestDay.p_good * 100)}% at ${hhmm(bestDay.best_at, tz)}` : '—'}
                  {bestDay?.source === 'light' ? ' (light only)' : ' (forecast)'}
                </Text>
                {dated.map((d: any) => {
                  const c = cells.get(d.date);
                  if (!c) return null;
                  return (
                    <View key={d.id} style={styles.detailRow}>
                      <Text style={styles.detailDay}>D{d.day_number} {format(parseISO(d.date), 'EEE d')}</Text>
                      <Text style={styles.detailVal}>{Math.round(c.p_good * 100)}% at {hhmm(c.best_at, tz)}</Text>
                      <TouchableOpacity onPress={() => goPlans(d.date)} style={styles.planBtn}>
                        <Text style={styles.link}>Plan ›</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
      {!loading && !rows.length ? <Text style={styles.hint}>No rated subjects here yet. Rate stops in Setup.</Text> : null}
      <Text style={styles.hint}>Past the forecast these are light only (sun and shade with typical weather), so most days look alike. Within 15 days they use the real forecast.</Text>
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
  poor: { backgroundColor: colors.surfaceElevated },
  own: { borderColor: colors.accent },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
  detail: { paddingLeft: spacing.sm, paddingBottom: spacing.md, gap: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  detailDay: { width: 80, fontSize: 12, color: colors.textSecondary },
  detailVal: { flex: 1, fontSize: 12, color: colors.textPrimary },
  planBtn: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  link: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  error: { color: '#e74c3c', fontSize: 12 },
  hint: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
});
