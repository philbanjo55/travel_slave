import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../../theme';
import { format, isToday } from 'date-fns';
import {
  DayChange, GridCell, Plan, PlanRun, PlanVisit, TripSetting, fetchDayRuns, fetchPlans, fetchSubjectGrid, fetchTripSettings,
  latestByDay, LIGHT_WORDS, mineReason, clock12, joinRepeats,
} from '../../services/planner';
import { VERDICT_COLOR, VERDICT_TEXT, countText, isBig, planKindText, shotsText, verdictOf } from '../../services/plannerWords';
import { TDay, TWeek, bestElsewhere, tripWeek } from '../../services/plannerWeek';
import { DayScore, tripToday } from '../../services/plannerDay';
import { onPlanLanded, startReplanNow, failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { useTripStore } from '../../store/tripStore';
import { PlanCheckRow } from './PlanCheck';
import { TellTRow } from './TellT';
import { covers, useNotes } from '../../services/tNotes';
import { placements, samePlace } from '../../services/plannerWeekPure';
import { errText } from '../../utils/errText';
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

// The day card on the trip page (Phil, 11 Nov 2026, after his first real use: "the UI is terrible and crowded",
// "how do I view T?", "I do like the side by side"). The card is YOUR DAY VS T'S DAY: his own stops next to T's
// stops, each with its time and T's verdict, and the day's one number on each side (good shots of big subjects
// expected). Under it: the plan check, Re-plan now (today), his notes, and one button that shows T's day on the
// timeline (ghost mode, where Accept lives). Everything else (when the plan was made, why each stop moved, the
// week) is behind Details.
function DayCol({ title, num, rows, tz, accent, empty, tagOf }: {
  title: string; num: string | null; rows: PlanVisit[]; tz?: string; accent?: boolean; empty: string;
  // What T did with one of Phil's own stops that is not on T's day: "Skipped (your note)", "T moved it to Fri".
  tagOf?: (v: PlanVisit) => string | null;
}) {
  const said = rows.map(v => `${v.start ? clock12(v.start, tz) : ''} ${v.name}`).join(', ');
  return (
    <View style={[styles.col, accent ? styles.colT : null]} accessibilityLabel={`${accent ? "T's day" : 'Your day'}${num ? `, ${num} good shots of big subjects expected` : ''}: ${said || 'nothing'}`}>
      <View style={styles.colHead}>
        <Text style={[styles.label, accent ? { color: colors.signalOk } : null]}>{title}</Text>
        {num ? <Text style={styles.colNum}>{num}</Text> : null}
      </View>
      {rows.length ? rows.map((v, i) => {
        const vd = v.p_good != null && v.rated !== false && !v.booked ? verdictOf(v.p_good) : null;
        const tag = tagOf ? tagOf(v) : null;
        return (
          <View key={`${v.stop_id}:${i}`} style={styles.colRow}>
            <Text style={styles.colTime}>{v.start ? clock12(v.start, tz) : ''}</Text>
            <Text style={styles.colName} numberOfLines={2}>{v.name}</Text>
            {v.done ? <Text style={styles.colSub}>Done</Text>
              : tag ? <Text style={styles.colSub}>{tag}</Text>
              : vd ? <Text style={[styles.colVerdict, { color: VERDICT_COLOR[vd] }]}>{VERDICT_TEXT[vd]}</Text> : null}
          </View>
        );
      }) : <Text style={styles.colSub}>{empty}</Text>}
    </View>
  );
}

export function DayScoreCard({ tripId, date, planner, score, onShowChanges, past }: {
  tripId: string; date: string; planner: DayPlanner | null; score: DayScore | null; onShowChanges: () => void; past?: boolean;
}) {
  const navigation = useNavigation<any>();
  const [details, setDetails] = useState(false);
  // Tell T (worksheet g4): a plan-check flag can start a note; the places a quick button offers are the trip's rated ones.
  const [tell, setTell] = useState<string | null>(null);
  const { currentTripData: tripData } = useTripStore();
  // Places a note in force tells T to leave out on this day.
  const { notes } = useNotes(tripId);
  const skipIds = useMemo(() => {
    const out = new Set<string>();
    for (const n of notes) if (n.status === 'active' && covers(n, date)) {
      for (const r of (n.rules ?? []) as any[]) {
        const on = Array.isArray(r.dates) ? r.dates.includes(date) : (!r.from_date || date >= r.from_date) && (!r.to_date || date <= r.to_date);
        if (r.type === 'skip' && on) for (const id of r.stops ?? []) out.add(id);
      }
    }
    return out;
  }, [notes, date]);
  const places = useMemo(() => {
    const names = new Set<string>();
    for (const d of tripData?.days ?? []) for (const st of d.stops ?? []) if (planner?.tiers.has(st.id) && !st.time_locked) names.add(st.name);
    return [...names].sort();
  }, [tripData, planner]);
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
  const grey = score.bigOnDay && score.best < 0.1 && score.others < 0.1;
  const mineRows = (planner.mine?.visits ?? []).filter(v => v.start);
  const tRows = joinRepeats((planner.best?.visits ?? []).filter(v => v.start));
  // Today, after the last stop on either list: nothing left to change (Phil put two notes on a finished day).
  const ends = [...mineRows, ...tRows].map(v => Date.parse(v.end ?? v.start ?? '')).filter(Number.isFinite);
  const tToday = tripToday(run, date);
  const dayDone = !past && date === tToday && ends.length > 0 && Date.now() > Math.max(...ends);
  const canReplan = !past && !dayDone && date === format(new Date(), 'yyyy-MM-dd');
  const week = planner.week ?? null;
  const tagOf = (v: PlanVisit): string | null => {
    if (v.booked || (v.rated === false && v.p_good == null)) return null;
    if (tRows.some(t => samePlace(week, t.stop_id, v.stop_id))) return null;
    if ([...skipIds].some(id => samePlace(week, id, v.stop_id))) return 'Skipped (your note)';
    const o = placements(week, v.stop_id).filter(p => p.date !== date && p.date >= tToday).sort((a, b) => a.date.localeCompare(b.date))[0];
    return o ? `T moved it to ${format(new Date(`${o.date}T12:00:00`), 'EEE')}` : "Not on T's plan";
  };
  const dayWords = format(new Date(`${date}T12:00:00`), 'EEE d MMM');
  const mineNum = !score.bigOnDay ? null : score.mine != null ? shotsText(score.mine) : '–';
  const tNum = !score.bigOnDay ? null : shotsText(score.best);
  const caption = grey ? 'Grey day: no big subject is a good bet.'
    : !score.bigOnDay ? `No big subjects this day${score.others >= 0.05 ? ` · ${shotsText(score.others)} good shots of the others` : ''}.`
    : `The numbers: good shots of big subjects expected.${score.mine != null && score.mine < 0.05
      ? ((planner.mine?.visits ?? []).some(v => isBig(tierOf(v.stop_id))) ? ' None of your big subjects look like a good bet.' : ' Your day has no big subjects (S or GOD) on it.') : ''}`;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.label}>YOUR DAY VS T'S DAY</Text>
        <Text style={styles.planned}>{dayWords}</Text>
        <TouchableOpacity onPress={() => setDetails(d => !d)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }} accessibilityRole="button"
          accessibilityLabel={details ? 'Hide the details' : 'Show the details of this plan'}>
          <Text style={styles.moreLink}>{details ? 'Less' : 'Details'} ›</Text>
        </TouchableOpacity>
      </View>
      {score.late ? (
        <Text style={styles.warn}>This morning's re-plan came at {clock12(run.created_at, tz)}, after the first stop ({clock12(score.late, tz)}). Go by your plan for that one.</Text>
      ) : null}
      {dayDone ? <Text style={styles.warn}>Today's stops are done. Notes for tomorrow go on tomorrow's day.</Text> : null}
      <View style={styles.cols}>
        <DayCol title="YOURS" num={mineNum} rows={mineRows} tz={tz} empty={planner.mine ? 'Nothing on your list' : 'Your list is not scored yet'} tagOf={tagOf} />
        <DayCol title="T'S" num={tNum} rows={tRows} tz={tz} accent empty="Nothing planned" />
      </View>
      <Text style={styles.cardSub}>{caption}</Text>
      {!past ? <PlanCheckRow tripId={tripId} date={date} tz={tz} onTellT={setTell} /> : null}
      {canReplan ? <ReplanNowStatus tripId={tripId} /> : null}
      {past ? <Text style={styles.cardSub}>This day is over: nothing to change.</Text> : (
        // The card's actions as real buttons (Phil, 12 Nov 2026): Use T's day first, Tell T and Re-plan now under it.
        <TellTRow tripId={tripId} date={date} dayLabel={dayWords} places={places} open={tell} onOpened={() => setTell(null)}
          above={score.reasons.length ? (
            <TouchableOpacity onPress={onShowChanges} style={styles.useBtn} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Show T's changes on the timeline">
              <Text style={styles.useText}>{real.length ? "Use T's day" : "See what T leaves out"} ›</Text>
            </TouchableOpacity>
          ) : score.bigOnDay ? <Text style={styles.cardSub}>Your day is T's plan: nothing to change.</Text> : null}
          side={canReplan ? <ReplanNowButton tripId={tripId} /> : null} />
      )}
      {details ? (
        <View style={styles.details}>
          <TouchableOpacity onPress={open} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`T, this day, ${planned}. Open the plan`}>
            <Text style={styles.planned}>{planned} · open the plan ›</Text>
          </TouchableOpacity>
          {score.reason && score.bigOnDay ? <Text style={styles.cardSub}>{score.reason}</Text> : null}
          {score.lowerWhy ? <Text style={styles.cardSub}>{score.lowerWhy}</Text> : null}
          {score.reasons.length ? <Text style={styles.changesHead}>{real.length ? `T changes ${real.length} stop${real.length === 1 ? '' : 's'}` : "Not in T's plan"}</Text> : null}
          {score.reasons.map(r => <Text key={r} style={styles.reasonLine}>· {r}</Text>)}
          {score.week && score.week.days > 1 ? (
            <Text style={styles.week}>
              Week from today: T {shotsText(score.week.t)}{score.week.mine != null ? ` · yours ${shotsText(score.week.mine)}` : ''} good shots of big subjects
              {score.week.bigLeft ? `. T gets at least one good shot of about ${Math.round(score.week.covered)} of the ${score.week.bigLeft} big subjects left` : ''}
            </Text>
          ) : null}
        </View>
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
// Since 12 Nov 2026 in two parts: what the last request did (a line on the card) and the button itself.
export function ReplanNowStatus({ tripId }: { tripId: string }) {
  const v = useReplanNow(tripId);
  const { currentTripData } = useTripStore();
  if (v.phase === 'running') {
    return <Text style={styles.cardSub}>Re-planning the rest of today with fresh camera pictures (about 1 minute). The new plan shows here.</Text>;
  }
  if (v.phase === 'done') return <Text style={styles.warn}>{v.status.done_at ? `${clock12(v.status.done_at, currentTripData?.trip?.timezone ?? undefined)}: ` : ''}{v.message}</Text>;
  if (v.phase === 'error') return <Text style={[styles.cardSub, { color: '#e74c3c' }]}>{v.message}</Text>;
  return null;
}

export function ReplanNowButton({ tripId }: { tripId: string }) {
  const v = useReplanNow(tripId);
  const { currentTripData } = useTripStore();
  const busy = v.phase === 'running';
  const go = () => startReplanNow(tripId, currentTripData?.trip?.title).catch((e: any) => failReplanNow(tripId, errText(e)));
  return (
    <TouchableOpacity onPress={go} disabled={busy} style={[styles.nowBtn, busy && { opacity: 0.6 }]} activeOpacity={0.8} accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }} accessibilityLabel="Re-plan now with the cameras: the rest of today">
      {busy ? <ActivityIndicator size="small" color={colors.textPrimary} /> : null}
      <Text style={styles.nowText} numberOfLines={1}>{busy ? 'Re-planning…' : 'Re-plan now'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  nowBtn: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: '#555555' },
  nowText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  card: {
    marginHorizontal: spacing.xl, marginTop: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 6,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  cols: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  col: { flex: 1, padding: spacing.sm, gap: 8, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  colT: { borderColor: colors.signalOk },
  colHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  colNum: { fontFamily: 'Georgia', fontSize: 24, color: colors.textPrimary },
  colRow: { gap: 1 },
  colTime: { fontSize: 11, color: colors.textSecondary },
  colName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, lineHeight: 17 },
  colVerdict: { fontSize: 11, fontWeight: '800' },
  colSub: { fontSize: 11, color: colors.textSecondary },
  useBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.textPrimary },
  useText: { fontSize: 14, fontWeight: '700', color: colors.textInverse },
  details: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 },
  planned: { fontSize: 11, color: colors.textSecondary },
  warn: { fontSize: 12, color: colors.textPrimary, borderLeftWidth: 2, borderLeftColor: colors.textPrimary, paddingLeft: 8 },
  cardSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  changesHead: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  reasonLine: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  moreLink: { fontSize: 12, fontWeight: '700', color: colors.signalOk },
  week: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6 },
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
