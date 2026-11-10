import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../../theme';
import { format, isToday } from 'date-fns';
import {
  DayChange, GridCell, Plan, PlanRun, PlanVisit, TripSetting, fetchDayRuns, fetchPlans, fetchSubjectGrid, fetchTripSettings,
  latestByDay, LIGHT_WORDS, mineReason, clock12,
} from '../../services/planner';
import { VERDICT_COLOR, VERDICT_TEXT, countText, isBig, planKindText, shotsText, verdictOf } from '../../services/plannerWords';
import { TDay, TWeek, bestElsewhere, tripWeek } from '../../services/plannerWeek';
import { DayScore } from '../../services/plannerDay';
import { onPlanLanded, startReplanNow, failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { useTripStore } from '../../store/tripStore';
import { PlanCheckRow } from './PlanCheck';
export { dayScore, moveReasons } from '../../services/plannerDay';
export type { DayScore } from '../../services/plannerDay';

// TEST app only: the planner's read of the trip day shown on the trip page.
export type DayPlanner = {
  run: PlanRun | null; mine?: Plan; best?: Plan;
  byStop: Map<string, PlanVisit>;
  betterDay: Map<string, { date: string; dayNumber: number; p_good: number }>;
  tiers: Map<string, string>;
  // Every trip day's T plans (where a stop went, the week's totals).
  week?: TWeek | null;
  // Subjects already nailed (they drop out of the week's count).
  nailed?: Set<string>;
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
    tiers: [...d.tiers], changed: [...d.changed], week: d.week?.days ?? null, nailed: [...(d.nailed ?? [])],
  };
  AsyncStorage.setItem(DP_KEY(tripId, date), JSON.stringify(plain)).catch(() => {});
}
async function loadDayPlanner(tripId: string, date: string): Promise<DayPlanner | null> {
  try {
    const v = await AsyncStorage.getItem(DP_KEY(tripId, date));
    if (!v) return null;
    const j = JSON.parse(v);
    return { run: j.run, mine: j.mine, best: j.best, byStop: new Map(j.byStop), betterDay: new Map(j.betterDay),
      tiers: new Map(j.tiers), changed: new Set(j.changed), offline: true, nailed: new Set(j.nailed ?? []),
      week: j.week ? { days: j.week as TDay[], byDate: new Map((j.week as TDay[]).map(d => [d.date, d])), at: 0 } : null };
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
  const nailed = new Set(rows.filter(t => t.shot_status === 'nailed').map(t => t.stop_id));
  return { tiers, changed, nailed };
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
  // A Re-plan now just landed: read the plan again at once.
  useEffect(() => onPlanLanded(() => setReads(n => n + 1)), []);
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
        // "Better on Day 6": only where T's own plans put the stop on another day as a better
        // bet (one chance everywhere: T's, never the raw forecast grid's).
        const week = await withTimeout(tripWeek(tripId, days)).catch(() => null);
        const betterDay = new Map<string, { date: string; dayNumber: number; p_good: number }>();
        for (const stopId of byStop.keys()) {
          const o = bestElsewhere(week, stopId, date);
          if (o?.dayNumber != null) betterDay.set(stopId, { date: o.date, dayNumber: o.dayNumber, p_good: o.visit.p_good ?? 0 });
        }
        const ts = tierState(await tripTiers(tripId), run);
        const next: DayPlanner = { run, mine, best, byStop, betterDay, week, ...ts };
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

// The day card on the trip page (Phil, 3 Nov 2026: readable at a glance at 5 AM). The day is
// scored as the good shots T expects of the big subjects (GOD + S) on T's plan and on Phil's
// own day, with the week from today; each change says where the stop went and why; a morning
// re-plan that came after the first stop is flagged. Tapping the head opens the Plans tab;
// tapping the changes shows them on the timeline (ghost mode).
export function DayScoreCard({ tripId, date, planner, score, onShowChanges, past }: {
  tripId: string; date: string; planner: DayPlanner | null; score: DayScore | null; onShowChanges: () => void; past?: boolean;
}) {
  const navigation = useNavigation<any>();
  const [more, setMore] = useState(false);
  const open = () => navigation.navigate('Planner', { tripId, tab: 'plans', date });
  if (!planner?.run || !score) {
    return (
      <TouchableOpacity style={styles.card} onPress={open} activeOpacity={0.85} accessibilityRole="button">
        <Text style={styles.label}>T · THIS DAY</Text>
        <Text style={styles.cardSub}>{planner?.run ? 'Planned. Tap to see it.' : 'Not planned yet. Tap to plan this day.'}</Text>
      </TouchableOpacity>
    );
  }
  const run = planner.run;
  const tz: string | undefined = run.params?.tz;
  const at = new Date(run.created_at);
  const planned = `${planner.offline ? 'offline · ' : ''}${planKindText(run)} · ${isToday(at) ? '' : format(at, 'EEE ')}${clock12(run.created_at, tz)}`;
  const real = score.changes.filter(c => c.kind !== 'skipped');
  const tierOf = (id: string) => planner.tiers.get(id) ?? null;
  const goods = planner.best!.visits.filter(v => isBig(tierOf(v.stop_id)) && verdictOf(v.p_good) === 'good').length;
  const grey = score.bigOnDay && score.best < 0.1 && score.others < 0.1;
  const head = (
    <TouchableOpacity style={styles.cardHead} onPress={open} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`T, this day, ${planned}. Open the plan`}>
      <Text style={styles.label}>T · THIS DAY</Text>
      <Text style={styles.planned} numberOfLines={1}>{planned} ›</Text>
    </TouchableOpacity>
  );
  const f = score.first;
  const shown = more ? score.reasons : score.reasons.slice(0, 2);
  return (
    <View style={styles.card}>
      {head}
      {score.late ? (
        <Text style={styles.warn}>This morning's re-plan came at {clock12(run.created_at, tz)}, after the first stop ({clock12(score.late, tz)}). Go by your plan for that one.</Text>
      ) : null}
      {grey ? (
        <Text style={styles.headline}>Grey day: no big subject is a good bet.</Text>
      ) : score.bigOnDay ? (
        <View style={styles.bigRow}>
          <Text style={styles.big}>{shotsText(score.best)}</Text>
          <Text style={styles.bigSub} numberOfLines={2}>
            good shots of big subjects expected{real.length || score.mine == null ? " on T's plan" : ''}
            {goods ? ` · ${goods} good bet${goods === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
      ) : (
        <Text style={styles.headline}>No big subjects this day{score.others >= 0.05 ? ` · ${shotsText(score.others)} good shots of the others` : ''}.</Text>
      )}
      {score.mine != null && real.length && score.bigOnDay ? (
        <Text style={styles.cardSub}>Your day as planned: {score.mine >= 0.05 ? shotsText(score.mine)
          // Never a bare 0 (emulator test, 9 Nov 2026: Teton Live Day 3 read "0.0" because its own stops are all tier A).
          : (planner.mine?.visits ?? []).some(v => isBig(tierOf(v.stop_id))) ? 'none of its big subjects look like a good bet'
          : 'no big subjects (S or GOD) on it'}</Text>
      ) : score.reason && score.bigOnDay ? <Text style={styles.cardSub}>{score.reason}</Text> : null}
      {f ? (
        <Text style={styles.first} numberOfLines={2}>
          First: {f.name} at {clock12(f.start, tz)} · <Text style={{ color: VERDICT_COLOR[verdictOf(f.p_good)], fontWeight: '700' }}>{VERDICT_TEXT[verdictOf(f.p_good)]}</Text> ({countText(f, run)})
        </Text>
      ) : null}
      {score.lowerWhy ? <Text style={styles.cardSub}>{score.lowerWhy}</Text> : null}
      {!past ? <PlanCheckRow tripId={tripId} date={date} tz={tz} /> : null}
      {!past && date === format(new Date(), 'yyyy-MM-dd') ? <ReplanNowRow tripId={tripId} /> : null}
      {past ? <Text style={styles.cardSub}>This day is over: nothing to change.</Text> : score.reasons.length ? (
        <View style={styles.reasons}>
          <TouchableOpacity onPress={onShowChanges} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Show T's changes on the timeline">
            <Text style={styles.changesHead}>{real.length ? `T changes ${real.length} stop${real.length === 1 ? '' : 's'}` : "Not in T's plan"} <Text style={styles.changesGo}>· show on the day ›</Text></Text>
          </TouchableOpacity>
          {shown.map(r => <Text key={r} style={styles.reasonLine}>· {r}</Text>)}
          {score.reasons.length > 2 ? (
            <TouchableOpacity onPress={() => setMore(m => !m)} hitSlop={{ top: 8, bottom: 8 }} accessibilityRole="button">
              <Text style={styles.moreLink}>{more ? 'Fewer' : `${score.reasons.length - 2} more`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : score.bigOnDay ? <Text style={styles.cardSub}>This is T's plan: nothing to change.</Text> : null}
      {score.week && score.week.days > 1 ? (
        <Text style={styles.week}>
          Week from today: T {shotsText(score.week.t)}{score.week.mine != null ? ` · yours ${shotsText(score.week.mine)}` : ''} good shots of big subjects
          {score.week.bigLeft ? `. T gets at least one good shot of about ${Math.round(score.week.covered)} of the ${score.week.bigLeft} big subjects left` : ''}
        </Text>
      ) : null}
    </View>
  );
}

// A stop's T chance at its time on the shown day, its light, and one hint: a better time that
// day, else a better trip day (both from T's own plans).
export type StopHint = { p: number; light: string | null; chip: string | null; changed?: boolean; done?: boolean; count: string };
export function stopHint(stopId: string, planner: DayPlanner | null): StopHint | null {
  const v = planner?.byStop.get(stopId);
  if (!v || v.p_good == null) return null;
  const tz: string | undefined = planner?.run?.params?.tz;
  const light = v.light ? LIGHT_WORDS[v.light] ?? v.light : null;
  const count = countText(v, planner?.run).replace(/ forecasts$/, '');
  // Over by the time of the newest re-plan: done, no chance or hint (worksheet B2).
  if (v.done) return { p: v.p_good, light: null, chip: null, done: true, count: '' };
  if (planner?.changed.has(stopId)) return { p: v.p_good, light, chip: null, changed: true, count };
  const better = planner?.betterDay.get(stopId);
  const tryAt = v.best && verdictOf(v.best.p_good) !== verdictOf(v.p_good) && v.best.p_good > v.p_good ? v.best : null;
  const chip = tryAt ? `Try ${clock12(tryAt.start, tz)} · ${VERDICT_TEXT[verdictOf(tryAt.p_good)]}`
    : better ? `Day ${better.dayNumber}: ${VERDICT_TEXT[verdictOf(better.p_good)]}` : null;
  return { p: v.p_good, light, chip, count };
}

// The verdict, its count and the hint chip (day timeline, stop screen).
export function ChanceLine({ hint, label, onChip }: { hint: StopHint; label?: boolean; onChip?: () => void }) {
  const vd = verdictOf(hint.p);
  if (hint.done) return (
    <View style={styles.chanceRow} accessibilityLabel="Done, this time has passed">
      {label ? <Text style={styles.label}>T</Text> : null}
      <Text style={styles.hintText} numberOfLines={1}>Done · this time has passed</Text>
    </View>
  );
  return (
    <View style={styles.chanceRow} accessibilityLabel={`${VERDICT_TEXT[vd]}, ${hint.count}${hint.changed ? ', from before your change' : ''}${hint.light ? `, ${hint.light}` : ''}${hint.chip ? `. ${hint.chip}` : ''}`}>
      {label ? <Text style={styles.label}>T</Text> : null}
      <Text style={[styles.verdict, { color: VERDICT_COLOR[vd], borderColor: VERDICT_COLOR[vd] }]}>{VERDICT_TEXT[vd]}</Text>
      <Text style={styles.count} numberOfLines={1}>{hint.count}</Text>
      {hint.changed ? <Text style={styles.hintText} numberOfLines={1}>you changed it · new chance after the next plan</Text>
        : hint.light ? <Text style={styles.hintText} numberOfLines={1}>{hint.light}</Text> : <View style={{ flex: 1 }} />}
      {hint.chip ? (onChip ? (
        <TouchableOpacity onPress={onChip} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} accessibilityRole="button"
          accessibilityLabel={`${hint.chip}. Part of T's plan: show the changes`}>
          <Text style={[styles.chip, styles.chipTap]}>{hint.chip} ›</Text>
        </TouchableOpacity>
      ) : <Text style={styles.chip}>{hint.chip}</Text>) : null}
    </View>
  );
}

// Re-plan now on today's card (Phil, 5 Nov 2026): fresh camera pictures, then the rest of today
// re-planned from where the plan says you are; the result shows here.
export function ReplanNowRow({ tripId }: { tripId: string }) {
  const v = useReplanNow(tripId);
  const { currentTripData } = useTripStore();
  const go = () => startReplanNow(tripId, currentTripData?.trip?.title).catch((e: any) => failReplanNow(tripId, String(e?.message ?? e)));
  if (v.phase === 'running') {
    return <Text style={styles.cardSub}>Re-planning the rest of today with fresh camera pictures (about 1 minute). The new plan shows here.</Text>;
  }
  return (
    <View style={{ gap: 4 }}>
      {v.phase === 'done' ? <Text style={styles.warn}>{v.status.done_at ? `${clock12(v.status.done_at, currentTripData?.trip?.timezone ?? undefined)}: ` : ''}{v.message}</Text> : null}
      {v.phase === 'error' ? <Text style={[styles.cardSub, { color: '#e74c3c' }]}>{v.message}</Text> : null}
      <TouchableOpacity onPress={go} style={styles.nowBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Re-plan the rest of today now with the cameras">
        <Text style={styles.nowText}>Re-plan now with the cameras ›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  nowBtn: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.surface },
  nowText: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
  card: {
    marginHorizontal: spacing.xl, marginTop: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 6,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  planned: { fontSize: 11, color: colors.textSecondary },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  big: { fontFamily: 'Georgia', fontSize: 34, color: colors.textPrimary },
  bigSub: { flex: 1, fontSize: 13, color: colors.textSecondary },
  headline: { fontFamily: 'Georgia', fontSize: 18, lineHeight: 24, color: colors.textPrimary },
  first: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  warn: { fontSize: 12, color: colors.textPrimary, borderLeftWidth: 2, borderLeftColor: colors.textPrimary, paddingLeft: 8 },
  cardSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  reasons: { gap: 3, marginTop: 2 },
  changesHead: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  reasonLine: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  moreLink: { fontSize: 12, fontWeight: '700', color: colors.signalOk },
  week: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6 },
  changesGo: { color: colors.signalOk, fontWeight: '700' },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  chanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verdict: { fontSize: 11, fontWeight: '800', borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  count: { fontSize: 11, color: colors.textPrimary },
  hintText: { fontSize: 11, color: colors.textSecondary, flexShrink: 1 },
  chipTap: { backgroundColor: 'rgba(90,170,122,0.12)' },
  chip: {
    fontSize: 10, fontWeight: '700', color: colors.signalOk, borderWidth: 1, borderColor: colors.signalOk,
    borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
});
