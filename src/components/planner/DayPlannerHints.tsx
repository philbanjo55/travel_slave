import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../../theme';
import { format, isToday } from 'date-fns';
import {
  DayChange, GridCell, Plan, PlanRun, PlanVisit, TripSetting, fetchDayRuns, fetchPlans, fetchSubjectGrid, fetchTripSettings, hhmm,
  latestByDay, LIGHT_WORDS, changesLine, mineReason, pctOf, planCeiling, clock12,
} from '../../services/planner';
import { ScoreBar } from './ScoreBar';

// TEST app only: the planner's read of the trip day shown on the trip page.
export type DayPlanner = {
  run: PlanRun | null; mine?: Plan; best?: Plan;
  byStop: Map<string, PlanVisit>;
  betterDay: Map<string, { date: string; dayNumber: number; p_good: number }>;
  tiers: Map<string, string>;
  // Stops Phil changed after this plan was made: its chance is from before.
  changed: Set<string>;
  // Shown from the copy saved on the phone because T couldn't be reached (no signal).
  offline?: boolean;
};

// The last read of each trip day's plan, saved on the phone so the trip page still shows T's
// plan with no signal (Nov 2 field review: offline the T card and chips just disappeared).
const DP_KEY = (tripId: string, date: string) => `dayplanner:${tripId}:${date}`;
function saveDayPlanner(tripId: string, date: string, d: DayPlanner) {
  const plain = {
    run: d.run, mine: d.mine, best: d.best, byStop: [...d.byStop], betterDay: [...d.betterDay],
    tiers: [...d.tiers], changed: [...d.changed],
  };
  AsyncStorage.setItem(DP_KEY(tripId, date), JSON.stringify(plain)).catch(() => {});
}
async function loadDayPlanner(tripId: string, date: string): Promise<DayPlanner | null> {
  try {
    const v = await AsyncStorage.getItem(DP_KEY(tripId, date));
    if (!v) return null;
    const j = JSON.parse(v);
    return { run: j.run, mine: j.mine, best: j.best, byStop: new Map(j.byStop), betterDay: new Map(j.betterDay),
      tiers: new Map(j.tiers), changed: new Set(j.changed), offline: true };
  } catch { return null; }
}
const withTimeout = <T,>(p: Promise<T>, ms = 15000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// The subject grid takes ~2 s; keep one per trip for 10 minutes.
const gridCache = new Map<string, { at: number; cells: Promise<GridCell[]> }>();
export function tripGrid(tripId: string) {
  const hit = gridCache.get(tripId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.cells;
  const cells = fetchSubjectGrid(tripId).catch(() => [] as GridCell[]);
  gridCache.set(tripId, { at: Date.now(), cells });
  return cells;
}

// Tiers change only when Phil edits them; one read per trip per 10 minutes,
// dropped when he saves a setting (SettingsEditor calls forgetTiers).
const tierCache = new Map<string, { at: number; rows: Promise<TripSetting[]> }>();
function tripTiers(tripId: string) {
  const hit = tierCache.get(tripId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows;
  const rows = fetchTripSettings(tripId).catch(() => [] as TripSetting[]);
  tierCache.set(tripId, { at: Date.now(), rows });
  return rows;
}
const tierListeners = new Set<() => void>();
export function forgetTiers() { tierCache.clear(); tierListeners.forEach(f => f()); }

// A stop's tier on a trip (for the % scale's fallback ceiling); refreshed after a settings save.
export function useTierOf(tripId: string | null | undefined): (stopId: string) => string | null {
  const [m, setM] = useState<Map<string, string>>(new Map());
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    const f = () => setSaves(n => n + 1);
    tierListeners.add(f);
    return () => { tierListeners.delete(f); };
  }, []);
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    tripTiers(tripId).then(rows => { if (alive) setM(new Map(rows.filter(r => r.tier).map(r => [r.stop_id, r.tier as string]))); });
    return () => { alive = false; };
  }, [tripId, saves]);
  return (id: string) => m.get(id) ?? null;
}

function tierState(rows: TripSetting[], run: PlanRun | null) {
  const tiers = new Map(rows.filter(t => t.tier).map(t => [t.stop_id, t.tier as string]));
  const changed = new Set(rows.filter(t => run && t.source === 'phil' && t.updated_at && Date.parse(t.updated_at) > Date.parse(run.created_at)).map(t => t.stop_id));
  return { tiers, changed };
}

export function useDayPlanner(tripId: string | null, date: string | null | undefined, days: any[]): DayPlanner | null {
  const [state, setState] = useState<DayPlanner | null>(null);
  const focused = useIsFocused();
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    const f = () => setSaves(n => n + 1);
    tierListeners.add(f);
    return () => { tierListeners.delete(f); };
  }, []);
  // Read the plan again when the trip page comes back into view or the app comes back to the
  // front (at most once a minute), so the morning re-plan shows without leaving the trip.
  const [reads, setReads] = useState(0);
  const lastRead = useRef(0);
  const again = () => { if (Date.now() - lastRead.current > 60_000) setReads(n => n + 1); };
  useEffect(() => { if (focused) again(); }, [focused]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active') again(); });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!tripId || !date) { setState(null); return; }
    let alive = true;
    lastRead.current = Date.now();
    (async () => {
      try {
        const m = latestByDay(await withTimeout(fetchDayRuns(tripId))).get(date) ?? {};
        const run = m.forecast ?? m.light ?? null;
        const plans = run ? await withTimeout(fetchPlans(run.id)) : [];
        const mine = plans.find(p => p.rank === 0), best = plans.find(p => p.rank === 1);
        // Each stop's chance at its own time ("your day", rank 0); T runs from before v51 have
        // only the best plan, so its visits stand in until the next plan.
        const byStop = new Map((mine ? mine.visits.filter(v => v.rated) : (best?.visits ?? []).filter(v => v.p_good != null)).map(v => [v.stop_id, v]));
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
        const ts = tierState(await tripTiers(tripId), run);
        const next: DayPlanner = { run, mine, best, byStop, betterDay, ...ts };
        saveDayPlanner(tripId, date, next);
        if (alive) setState(next);
      } catch {
        // No signal (or T timed out): the last plan saved on the phone, marked offline; else
        // keep what is on screen.
        const saved = await loadDayPlanner(tripId, date);
        if (alive) setState(s => (s && s.run && (!saved?.run || s.run.created_at >= saved.run.created_at) ? { ...s, offline: true } : saved));
      }
    })();
    return () => { alive = false; };
  }, [tripId, date, reads]);
  // After a save, and back on the screen: read tiers again.
  useEffect(() => {
    if (!tripId || !focused) return;
    let alive = true;
    tripTiers(tripId).then(rows => { if (alive) setState(s => s && { ...s, ...tierState(rows, s.run) }); });
    return () => { alive = false; };
  }, [tripId, focused, saves]);
  return state;
}

// Redesign A1 (Phil, 1 Nov 2026): the day's score card on the trip page, read-only (accept
// all): your day as planned vs T's best, both as % of a perfect day, and what T would change.
// Tapping the header opens the Planner's Plans tab; tapping the changes line shows them on
// the timeline (ghost mode).
export type DayScore = { mine: number | null; best: number | null; reason: string | null; changes: DayChange[] };
export function dayScore(planner: DayPlanner | null, date: string, dayStops: any[], changes: DayChange[]): DayScore | null {
  if (!planner?.run || !planner.best) return null;
  const tierOf = (id: string) => planner.tiers.get(id) ?? null;
  const c = planCeiling(planner.run, [planner.mine, planner.best], tierOf);
  const tz: string | undefined = planner.run.params?.tz;
  const reason = mineReason(planner.mine, date, dayStops, tierOf, tz);
  return { mine: reason ? null : pctOf(planner.mine?.mean, c), best: pctOf(planner.best.mean, c), reason, changes };
}

export function DayScoreCard({ tripId, date, planner, score, onShowChanges, past }: {
  tripId: string; date: string; planner: DayPlanner | null; score: DayScore | null; onShowChanges: () => void; past?: boolean;
}) {
  const navigation = useNavigation<any>();
  const open = () => navigation.navigate('Planner', { tripId, tab: 'plans', date });
  if (!planner?.run || !score) {
    return (
      <TouchableOpacity style={styles.card} onPress={open} activeOpacity={0.85} accessibilityRole="button">
        <Text style={styles.label}>T · THIS DAY</Text>
        <Text style={styles.cardSub}>{planner?.run ? 'Planned. Tap to see it.' : 'Not planned yet. Tap to plan this day.'}</Text>
      </TouchableOpacity>
    );
  }
  const at = new Date(planner.run.created_at);
  const planned = `${planner.offline ? 'offline · ' : ''}planned ${isToday(at) ? '' : format(at, 'EEE ')}${format(at, 'h:mm a')}`;
  const real = score.changes.filter(c => c.kind !== 'skipped');
  const same = real.length === 0;
  const head = (
    <TouchableOpacity style={styles.cardHead} onPress={open} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`T, this day, ${planned}. Open the plan`}>
      <Text style={styles.label}>T · THIS DAY</Text>
      <Text style={styles.planned}>{planned} ›</Text>
    </TouchableOpacity>
  );
  if (same) {
    return (
      <View style={styles.card}>
        {head}
        <View style={styles.bigRow}>
          <Text style={styles.big}>{score.best ?? '—'}{score.best != null ? '%' : ''}</Text>
          <Text style={styles.bigSub}>{score.best != null ? "of a perfect day · this is T's best plan" : 'nothing rated to score on this day'}</Text>
        </View>
        <ScoreBar mine={score.best} best={score.best} />
        {score.changes.length ? (
          <Text style={styles.cardSub} numberOfLines={2}>Not in T's plan: {score.changes.map(c => c.name).join(', ')} (stays on your day)</Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.card}>
      {head}
      <View style={styles.bigRow}>
        {score.mine != null ? (
          <>
            <Text style={styles.big}>{score.mine}%</Text>
            <Text style={styles.bigSub}>of a perfect day as planned</Text>
          </>
        ) : <Text style={[styles.bigSub, styles.reason]} numberOfLines={2}>{score.reason}</Text>}
        {score.best != null ? <Text style={styles.best}>best {score.best}%</Text> : null}
      </View>
      <ScoreBar mine={score.mine} best={score.best} />
      {past ? <Text style={styles.cardSub}>This day is over: nothing to change.</Text> : (
        <TouchableOpacity onPress={onShowChanges} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`${changesLine(score.changes)}. Show them on the timeline`}>
          <Text style={styles.changes} numberOfLines={2}>{changesLine(score.changes)} <Text style={styles.changesGo}>›</Text></Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// A stop's chance at its time on the shown day, its light, and one hint:
// a better time that day, else a better trip day.
export type StopHint = { p: number; light: string | null; chip: string | null; changed?: boolean };
export function stopHint(stopId: string, planner: DayPlanner | null): StopHint | null {
  const v = planner?.byStop.get(stopId);
  if (!v || v.p_good == null) return null;
  const tz: string | undefined = planner?.run?.params?.tz;
  const light = v.light ? LIGHT_WORDS[v.light] ?? v.light : null;
  if (planner?.changed.has(stopId)) return { p: v.p_good, light, chip: null, changed: true };
  const better = planner?.betterDay.get(stopId);
  const tryAt = v.best && v.best.p_good > v.p_good + 0.1 ? v.best : null;
  const chip = tryAt ? `Try ${clock12(tryAt.start, tz)} · ${Math.round(tryAt.p_good * 100)}%`
    : better ? `Better Day ${better.dayNumber} · ${Math.round(better.p_good * 100)}%` : null;
  return { p: v.p_good, light, chip };
}

// The chance as a bar, its number and the hint chip (day timeline, stop screen).
export function ChanceLine({ hint, label, onChip }: { hint: StopHint; label?: boolean; onChip?: () => void }) {
  const pct = Math.round(hint.p * 100);
  return (
    <View style={styles.chanceRow} accessibilityLabel={`Chance ${pct}%${hint.changed ? ', from before your change' : ''}${hint.light ? `, ${hint.light}` : ''}${hint.chip ? `. ${hint.chip}` : ''}`}>
      {label ? <Text style={styles.label}>CHANCE</Text> : null}
      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.max(pct, 2)}%` }, pct >= 40 && styles.barGood]} /></View>
      <Text style={styles.pct}>{pct}%</Text>
      {hint.changed ? <Text style={styles.hintText} numberOfLines={1}>you changed it · new chance after the next plan</Text>
        : hint.light ? <Text style={styles.hintText} numberOfLines={1}>{hint.light}</Text> : null}
      {hint.chip ? (onChip ? (
        <TouchableOpacity onPress={onChip} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} accessibilityRole="button"
          accessibilityLabel={`${hint.chip}. Part of T's best plan: show the changes`}>
          <Text style={[styles.chip, styles.chipTap]}>{hint.chip} ›</Text>
        </TouchableOpacity>
      ) : <Text style={styles.chip}>{hint.chip}</Text>) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl, marginTop: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 6,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  planned: { fontSize: 11, color: colors.textSecondary },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  big: { fontFamily: 'Georgia', fontSize: 30, color: colors.textPrimary },
  bigSub: { flex: 1, fontSize: 12, color: colors.textSecondary },
  reason: { fontSize: 13, color: colors.textPrimary },
  best: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
  cardSub: { fontSize: 12, color: colors.textSecondary },
  changes: { fontSize: 12, color: colors.textPrimary, lineHeight: 17 },
  changesGo: { color: colors.signalOk, fontWeight: '700' },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  chanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { flex: 1, minWidth: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  barFill: { height: 4, borderRadius: 2, backgroundColor: '#555555' },
  barGood: { backgroundColor: colors.textSecondary },
  pct: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, minWidth: 30 },
  hintText: { fontSize: 11, color: colors.textSecondary, flexShrink: 1 },
  chipTap: { backgroundColor: 'rgba(90,170,122,0.12)' },
  chip: {
    fontSize: 10, fontWeight: '700', color: colors.signalOk, borderWidth: 1, borderColor: colors.signalOk,
    borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
});
