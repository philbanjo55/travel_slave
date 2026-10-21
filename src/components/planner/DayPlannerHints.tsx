import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../../theme';
import { GridCell, Plan, PlanRun, PlanVisit, TripSetting, fetchDayRuns, fetchPlans, fetchSubjectGrid, fetchTripSettings, hhmm, latestByDay, LIGHT_WORDS } from '../../services/planner';

// TEST app only: the planner's read of the trip day shown on the trip page.
export type DayPlanner = {
  run: PlanRun | null; mine?: Plan; best?: Plan;
  byStop: Map<string, PlanVisit>;
  betterDay: Map<string, { date: string; dayNumber: number; p_good: number }>;
  tiers: Map<string, string>;
};

// The subject grid takes ~2 s; keep one per trip for 10 minutes.
const gridCache = new Map<string, { at: number; cells: Promise<GridCell[]> }>();
function tripGrid(tripId: string) {
  const hit = gridCache.get(tripId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.cells;
  const cells = fetchSubjectGrid(tripId).catch(() => [] as GridCell[]);
  gridCache.set(tripId, { at: Date.now(), cells });
  return cells;
}

// Tiers change only when Phil edits them; one read per trip per 10 minutes.
const tierCache = new Map<string, { at: number; rows: Promise<TripSetting[]> }>();
function tripTiers(tripId: string) {
  const hit = tierCache.get(tripId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows;
  const rows = fetchTripSettings(tripId).catch(() => [] as TripSetting[]);
  tierCache.set(tripId, { at: Date.now(), rows });
  return rows;
}

export function useDayPlanner(tripId: string | null, date: string | null | undefined, days: any[]): DayPlanner | null {
  const [state, setState] = useState<DayPlanner | null>(null);
  useEffect(() => {
    if (!tripId || !date) { setState(null); return; }
    let alive = true;
    (async () => {
      try {
        const m = latestByDay(await fetchDayRuns(tripId)).get(date) ?? {};
        const run = m.forecast ?? m.light ?? null;
        const plans = run ? await fetchPlans(run.id) : [];
        const mine = plans.find(p => p.rank === 0), best = plans.find(p => p.rank === 1);
        const byStop = new Map((mine?.visits ?? []).filter(v => v.rated).map(v => [v.stop_id, v]));
        const betterDay = new Map<string, { date: string; dayNumber: number; p_good: number }>();
        const cells = await tripGrid(tripId);
        const dayNo = new Map(days.filter((d: any) => d.date).map((d: any) => [d.date, d.day_number]));
        for (const [stopId, v] of byStop) {
          const here = v.p_good ?? 0;
          const other = cells.filter(c => c.stop_id === stopId && c.trip_date !== date && dayNo.has(c.trip_date))
            .sort((a, b) => b.p_good - a.p_good)[0];
          if (other && other.p_good >= 0.5 && other.p_good >= here + 0.2) {
            betterDay.set(stopId, { date: other.trip_date, dayNumber: dayNo.get(other.trip_date)!, p_good: other.p_good });
          }
        }
        const tiers = new Map((await tripTiers(tripId)).filter(t => t.tier).map(t => [t.stop_id, t.tier as string]));
        if (alive) setState({ run, mine, best, byStop, betterDay, tiers });
      } catch { if (alive) setState(null); }
    })();
    return () => { alive = false; };
  }, [tripId, date]);
  return state;
}

// "PLANNER · Your day 15 · best plan 22. Add Múlafossur at 20:15 (96%)."
export function DayPlannerBanner({ tripId, date, planner }: { tripId: string; date: string; planner: DayPlanner | null }) {
  const navigation = useNavigation<any>();
  const open = () => navigation.navigate('Planner', { tripId, tab: 'plans', date });
  const tz: string | undefined = planner?.run?.params?.tz;
  let line = 'Not planned yet. Tap to plan this day.';
  if (planner?.run && planner.best) {
    const mineIds = new Set((planner.mine?.visits ?? []).map(v => v.stop_id));
    const add = planner.best.visits.filter(v => !mineIds.has(v.stop_id) && (v.p_good ?? 0) >= 0.5)
      .sort((a, b) => (b.p_good ?? 0) - (a.p_good ?? 0))[0];
    line = `Your day ${Math.round(planner.mine?.objective ?? 0)} · best plan ${Math.round(planner.best.objective)}.`
      + (add ? ` Add ${add.name} at ${hhmm(add.peak_at ?? add.start, tz)} (${Math.round((add.p_good ?? 0) * 100)}%).` : '');
  } else if (planner?.run) line = 'Planned. Tap to see it.';
  return (
    <TouchableOpacity style={styles.banner} onPress={open} activeOpacity={0.85} accessibilityLabel={`Planner: ${line}`}>
      <Text style={styles.label}>PLANNER</Text>
      <Text style={styles.bannerText} numberOfLines={2}>{line}</Text>
    </TouchableOpacity>
  );
}

// A stop's chance at its time on the shown day, its light, and one hint:
// a better time that day, else a better trip day.
export type StopHint = { p: number; light: string | null; chip: string | null };
export function stopHint(stopId: string, planner: DayPlanner | null): StopHint | null {
  const v = planner?.byStop.get(stopId);
  if (!v || v.p_good == null) return null;
  const tz: string | undefined = planner?.run?.params?.tz;
  const light = v.light ? LIGHT_WORDS[v.light] ?? v.light : null;
  const better = planner?.betterDay.get(stopId);
  const tryAt = v.best && v.best.p_good > v.p_good + 0.1 ? v.best : null;
  const chip = tryAt ? `Try ${hhmm(tryAt.start, tz)} · ${Math.round(tryAt.p_good * 100)}%`
    : better ? `Better Day ${better.dayNumber} · ${Math.round(better.p_good * 100)}%` : null;
  return { p: v.p_good, light, chip };
}

// The chance as a bar, its number and the hint chip (day timeline, stop screen).
export function ChanceLine({ hint, label }: { hint: StopHint; label?: boolean }) {
  const pct = Math.round(hint.p * 100);
  return (
    <View style={styles.chanceRow} accessibilityLabel={`Chance ${pct}%${hint.light ? `, ${hint.light}` : ''}${hint.chip ? `. ${hint.chip}` : ''}`}>
      {label ? <Text style={styles.label}>CHANCE</Text> : null}
      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.max(pct, 2)}%` }, pct >= 40 && styles.barGood]} /></View>
      <Text style={styles.pct}>{pct}%</Text>
      {hint.light ? <Text style={styles.hintText} numberOfLines={1}>{hint.light}</Text> : null}
      {hint.chip ? <Text style={styles.chip}>{hint.chip}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
  },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  bannerText: { fontSize: 13, color: colors.textPrimary },
  chanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { flex: 1, minWidth: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  barFill: { height: 4, borderRadius: 2, backgroundColor: '#555555' },
  barGood: { backgroundColor: colors.textSecondary },
  pct: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, minWidth: 30 },
  hintText: { fontSize: 11, color: colors.textSecondary, flexShrink: 1 },
  chip: {
    fontSize: 10, fontWeight: '700', color: colors.signalOk, borderWidth: 1, borderColor: colors.signalOk,
    borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
});
