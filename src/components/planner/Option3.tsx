import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius } from '../../theme';
import { ClaudeSpend, DayChange, PlanRun, clock12, dayChanges, fetchClaudeSpend, spendLine } from '../../services/planner';
import { expShots, isLightOnly, planKindText, shotsText } from '../../services/plannerWords';
import { TWeek, placements, samePlace } from '../../services/plannerWeekPure';
import { failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { usePlanningStatus } from '../../services/planningStatus';
import { useReplanMode, MODE_SUB } from '../../services/onePass';
import { replanFromNow } from '../../services/replanFromNow';
import { errText } from '../../utils/errText';
import ProgressBar from '../ProgressBar';
import { ReplanProgress, DayPlanner } from './DayPlannerHints';
import { MiniCurve } from './TChart';
import { PlanCheckRow, headline, usePlanReview } from './PlanCheck';
import { moveReasons } from '../../services/plannerDay';
import { TellTRow } from './TellT';
import NightlyToggle from './NightlyToggle';
import type { DayScore } from '../../services/plannerDay';

// Planner redesign, option 3 "Week strip on top" (Phil, 28 Nov 2026; mockup https://claude.ai/artifact/6bFbuwwtbZDFQLeDVYQ7Po).
// The pieces the trip page uses when OPTION3_UI is on: the one Re-plan button with T's plan time under it, the week strip
// (one tile per day: T's number and how many changes), the day bar (T's number vs yours, the plan check only when it
// found something, Use T's plan, Tell T) and the trip's ⋯ menu (nightly alert, Claude spend, the old Planner screens).

// ----- Re-plan from now on --------------------------------------------------------------------------------------------

export function ReplanFromNowBar({ tripId, tripTitle, run, tz, forecastTo }: { tripId: string; tripTitle?: string; run: PlanRun | null; tz?: string; forecastTo?: string | null }) {
  const now = useReplanNow(tripId);
  const planning = usePlanningStatus(tripId);
  const mode = useReplanMode(tripId);
  const [starting, setStarting] = useState(false);
  const busy = starting || now.phase === 'running';
  const go = async () => {
    setStarting(true);
    try { await replanFromNow(tripId, tripTitle); } catch (e: any) { failReplanNow(tripId, errText(e)); }
    setStarting(false);
  };
  const s = planning.kind === 'running' ? planning.status : null;
  const later = planning.kind === 'running';
  const done = later && s && (s.status === 'queued' || s.status === 'running') ? s.night : 0;
  const total = later && s && (s.status === 'queued' || s.status === 'running') ? s.nights : 0;
  const planned = run ? `T planned ${clock12(run.created_at, tz)}${format(parseISO(run.created_at), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? '' : ` ${format(parseISO(run.created_at), 'EEE')}`} · ${forecastTo ? `forecast to ${forecastTo}` : isLightOnly(run) ? 'typical weather' : 'forecast'}` : 'Not planned yet';
  return (
    <View style={styles.rpWrap}>
      <TouchableOpacity onPress={go} disabled={busy} style={[styles.rpCard, busy && { opacity: 0.75 }]} activeOpacity={0.8} accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }} accessibilityLabel={`Re-plan: from now on, ${MODE_SUB[mode ?? 'rest']}. ${busy ? 'Re-planning now' : 'Plan again and Re-plan now with the cameras in one'}`}>
        <View style={styles.rpGo}>
          {busy ? <ActivityIndicator size="small" color="#000000" /> : <Ionicons name="refresh" size={17} color="#000000" />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.rpText}>{busy ? 'Re-planning…' : 'Re-plan from now on'}</Text>
          {now.phase === 'error' ? <Text style={styles.rpErr} numberOfLines={3}>{now.message}</Text>
            : now.phase === 'running' || later ? null
            : <Text style={styles.rpLine} numberOfLines={1} accessibilityLabel={planned}>{planned}</Text>}
        </View>
      </TouchableOpacity>
      {now.phase === 'running' ? <ReplanProgress tripId={tripId} />
        : (later || starting) && now.phase !== 'error' ? <ProgressBar label={s && s.status !== 'queued' ? 'T is re-planning the later days' : 'T is re-planning…'} compact
          fraction={total ? Math.max(0.04, done / total) : null} text={total ? `${done} of ${total} days` : undefined} />
        : null}
    </View>
  );
}

// ----- Week strip -----------------------------------------------------------------------------------------------------

export type WeekTile = { t: number | null; changes: number; planned: boolean; past: boolean; curve: number[] | null; light: boolean };

// One tile per trip day from the week of T plans the trip page already reads (planner.week): T's good shots of the big
// subjects and how many stops T's plan changes on that day against the day as it stands.
export function weekTiles(week: TWeek | null, days: any[], tierOf: (id: string) => string | null | undefined, today: string, tz?: string): Map<string, WeekTile> {
  const out = new Map<string, WeekTile>();
  for (const d of days) {
    if (!d.date) continue;
    const td = week?.byDate.get(d.date);
    const past = d.date < today;
    if (!td?.best) { out.set(d.date, { t: null, changes: 0, planned: false, past, curve: null, light: true }); continue; }
    const t = td.run?.stats?.exp_big != null ? Number(td.run.stats.exp_big) : expShots(td.best, tierOf);
    const ch: DayChange[] = past ? [] : dayChanges(d.stops ?? [], days, td.mine, td.best, td.run?.params?.tz ?? tz, tierOf);
    // The tile's curve: T's chance at each of its visits, in time order (cheap: from the plan the page already has).
    const vs = td.best.visits.filter(v => v.p_good != null && v.start).sort((a, b) => a.start!.localeCompare(b.start!));
    const curve = vs.length >= 2 ? vs.map(v => Math.round((v.p_good ?? 0) * 100)) : vs.length === 1 ? [Math.round((vs[0].p_good ?? 0) * 100), Math.round((vs[0].p_good ?? 0) * 100)] : null;
    out.set(d.date, { t, changes: ch.length, planned: true, past, curve, light: isLightOnly(td.run) });
  }
  return out;
}

export function WeekStrip({ days, tiles, activeIndex, allOn, allCount, todayIndex, onDay, onAll, onLongDay }: {
  days: any[]; tiles: Map<string, WeekTile>; activeIndex: number; allOn: boolean; allCount: number; todayIndex: number;
  onDay: (i: number) => void; onAll: () => void; onLongDay: (d: any) => void;
}) {
  return (
    <>
      <TouchableOpacity style={[styles.tile, allOn && styles.tileOn]} onPress={onAll} accessibilityRole="tab"
        accessibilityState={{ selected: allOn }} accessibilityLabel={`Stops: all ${allCount} places`}>
        <Text style={styles.tileA}>ALL</Text>
        <Text style={styles.tileB}>{allCount}</Text>
        <Text style={[styles.tileC, styles.tileGrey]}>places</Text>
      </TouchableOpacity>
      {days.map((d: any, i: number) => {
        const on = !allOn && i === activeIndex;
        const tile = d.date ? tiles.get(d.date) : undefined;
        const today = i === todayIndex;
        const sub = !tile ? '' : tile.past ? 'done' : !tile.planned ? 'not planned' : tile.changes ? `${tile.changes} change${tile.changes === 1 ? '' : 's'}` : 'same';
        return (
          <TouchableOpacity key={d.id} style={[styles.tile, today && styles.tileToday, on && styles.tileOn]} onPress={() => onDay(i)} onLongPress={() => onLongDay(d)}
            accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={`Day ${d.day_number}${d.date ? `, ${format(parseISO(d.date), 'EEE MMM d')}` : ''}${today ? ', today' : ''}${tile?.t != null ? `, T ${shotsText(tile.t)} good shots` : ''}${sub ? `, ${sub}` : ''}`}>
            <Text style={[styles.tileA, (today || on) && { color: colors.signalOk }]}>{d.date ? format(parseISO(d.date), 'EEE d').toUpperCase() : `DAY ${d.day_number}`}</Text>
            <Text style={styles.tileB}>{tile?.t != null ? shotsText(tile.t) : '–'}</Text>
            <MiniCurve values={tile?.curve ?? null} width={48} height={14} dim={!!tile?.light || !!tile?.past} />
            <Text style={[styles.tileC, (!tile?.changes || tile.past) && styles.tileGrey, on && { color: colors.signalOk }]} numberOfLines={1}>{tile && !tile.planned ? 'typical' : sub}</Text>
            {today ? <View style={[styles.mark, { backgroundColor: colors.signalOk }]} accessibilityLabel="TODAY" /> : null}
            {d.checked || d.review ? <View style={[styles.mark, { top: 14, backgroundColor: d.checked ? colors.signalOk : '#d4a017' }]} /> : null}
          </TouchableOpacity>
        );
      })}
    </>
  );
}

// ----- Timeline words -------------------------------------------------------------------------------------------------

// Why T leaves one of your stops off this day, in a few words: where it went, or that it is nailed / skipped.
export function skipWords(planner: DayPlanner | null, stopId: string, date: string, today: string): string {
  if (planner?.nailed?.has(stopId)) return 'T leaves it out: nailed';
  const week = planner?.week ?? null;
  const other = placements(week, stopId).filter(p => p.date !== date && p.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  return other ? `T moved it to ${format(parseISO(other.date), 'EEE')}` : 'T skips this';
}
export const sameStop = (planner: DayPlanner | null, a: string, b: string) => samePlace(planner?.week ?? null, a, b);

// ----- Day bar --------------------------------------------------------------------------------------------------------

const AMBER = '#e0b34a';
const shortName = (n: string) => n.split(/\s+[—–-]\s+|\s+\+\s+/)[0];
const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;

// The day card, planner look round 2 (Phil, 28 Nov 2026): T's number big with two thin bars against yours, the driving
// against yours, T's changes as short chips (a tap says why), the plan check as one amber row only when it found
// something, and Tell T | Use T's plan. Details holds the rest (every reason, the week, an OK plan check, day weather).
export function DayBar({ tripId, date, planner, score, past, places, onUse, details, weather, days }: {
  tripId: string; date: string; planner: DayPlanner | null; score: DayScore | null; past: boolean; places: string[];
  onUse: () => void; details: string[]; weather?: React.ReactNode; days?: any[];
}) {
  const [open, setOpen] = useState(false);
  const [tell, setTell] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const review = usePlanReview(tripId, date);
  const flagged = !!review && review.verdict !== 'ok' && (review.flags ?? []).some(f => f.severity !== 'info');
  const tz: string | undefined = planner?.run?.params?.tz;
  const dayWords = format(parseISO(date), 'EEE d MMM');
  if (!planner?.run || !score) {
    return (
      <View style={styles.bar}>
        <Text style={styles.barSub}>{planner?.run ? 'T has no plan for this day yet.' : 'Not planned yet: tap Re-plan from now on.'}</Text>
        {weather}
      </View>
    );
  }
  const real = score.changes.filter(c => c.kind !== 'skipped');
  const moves = real.filter(c => c.kind === 'moved');
  const adds = real.filter(c => c.kind === 'added');
  const reasonOf = (c: DayChange) => moveReasons([c], planner, date)[0] ?? null;
  const dayOf = (n: number | null | undefined) => (days ?? []).find((d: any) => d.day_number === n)?.date ?? null;
  const tNum = score.bigOnDay ? shotsText(score.best) : '–';
  const mineNum = !score.bigOnDay ? null : score.mine != null ? shotsText(score.mine) : '–';
  const top = Math.max(score.best, score.mine ?? 0, 0.01);
  const tD = planner.best?.drive_minutes ?? null, yD = planner.mine?.drive_minutes ?? null;
  const dd = tD != null && yD != null ? Math.round(tD - yD) : null;
  const selC = sel ? real.find(c => c.stop_id === sel) ?? null : null;
  return (
    <View style={styles.bar}>
      <View style={styles.vs}>
        <View accessibilityLabel={`T's day: ${tNum} good shots of big subjects`}>
          <Text style={styles.vsLab}>T'S DAY</Text>
          <Text style={styles.barBig}>{tNum}</Text>
        </View>
        <View style={styles.cmp}>
          {score.bigOnDay ? (
            <>
              <View style={styles.cbar}><View style={[styles.cbarFill, { width: `${Math.round((100 * score.best) / top)}%`, backgroundColor: colors.signalOk }]} /></View>
              <View style={styles.cbar}><View style={[styles.cbarFill, { width: `${Math.round((100 * (score.mine ?? 0)) / top)}%`, backgroundColor: '#666666' }]} /></View>
              <Text style={styles.yoursLine}>good shots of big subjects · yours {mineNum}</Text>
            </>
          ) : <Text style={styles.yoursLine}>no big subjects this day{score.others >= 0.05 ? ` · ${shotsText(score.others)} of the others` : ''}</Text>}
        </View>
        <TouchableOpacity onPress={() => setOpen(o => !o)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }} accessibilityRole="button"
          accessibilityLabel={open ? 'Hide the details' : 'Show the details of this plan'}>
          <Text style={styles.link}>{open ? 'Less' : 'Details'} ›</Text>
        </TouchableOpacity>
      </View>
      {tD != null ? (
        <Text style={styles.drive} accessibilityLabel={`T drives ${hm(tD)}${dd ? `, ${Math.abs(dd)} minutes ${dd < 0 ? 'less' : 'more'} than yours` : ''}`}>
          🚗  <Text style={styles.driveB}>{hm(tD)}</Text> driving
          {dd != null && Math.abs(dd) >= 5 ? (
            <Text>
              <Text style={{ color: dd < 0 ? colors.signalOk : AMBER, fontWeight: '800' }}> · {Math.abs(dd)} min {dd < 0 ? 'less' : 'more'}</Text>
              <Text style={styles.driveSub}> than yours ({hm(yD!)})</Text>
            </Text>
          ) : dd != null ? <Text style={styles.driveSub}> · about the same as yours</Text> : null}
        </Text>
      ) : null}
      {score.late ? <Text style={styles.warnText}>Re-plan came at {clock12(planner.run.created_at, tz)}, after the first stop: go by your plan for it.</Text> : null}
      {adds.length || moves.length ? (
        <View style={styles.chips}>
          {adds.map(c => {
            const from = c.fromDay ? dayOf(c.fromDay) : null;
            const label = from && from !== date ? `← ${shortName(c.name)} from ${format(parseISO(from), 'EEE')}` : `+ ${shortName(c.name)}${c.now ? ` ${c.now.replace(/:00 /, ' ').replace(' AM', '').replace(' PM', '')}` : ''}`;
            const isAdd = !(from && from !== date);
            return (
              <TouchableOpacity key={c.stop_id} onPress={() => setSel(x => (x === c.stop_id ? null : c.stop_id))} style={[styles.chip, isAdd && styles.chipAdd, sel === c.stop_id && styles.chipOn]}
                accessibilityRole="button" accessibilityLabel={`${label}. Why`}>
                <Text style={[styles.chipT, isAdd && { color: '#bfe3cc' }]} numberOfLines={1}>{label}</Text>
              </TouchableOpacity>
            );
          })}
          {moves.length ? (
            <TouchableOpacity onPress={() => setSel(x => (x === 'moves' ? null : 'moves'))} style={[styles.chip, styles.chipMore]} accessibilityRole="button"
              accessibilityLabel={`${moves.length} time moves. Show them`}>
              <Text style={[styles.chipT, { color: colors.signalOk }]}>+{moves.length} time move{moves.length === 1 ? '' : 's'} ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {selC ? <Text style={styles.reason}>{reasonOf(selC)}</Text> : null}
      {sel === 'moves' ? moves.map(c => <Text key={c.stop_id} style={styles.reason}>· {reasonOf(c)}</Text>) : null}
      {flagged && review ? (
        <TouchableOpacity onPress={() => setCheckOpen(o => !o)} style={styles.warnRow} accessibilityRole="button"
          accessibilityLabel={`Claude's plan check: ${headline(review)}. ${checkOpen ? 'Hide' : 'Show'} details`}>
          <Text style={styles.warnRowT} numberOfLines={2}>⚠ {headline(review)} {checkOpen ? '⌃' : '›'}</Text>
        </TouchableOpacity>
      ) : null}
      {flagged && checkOpen ? <PlanCheckRow tripId={tripId} date={date} tz={tz} onTellT={setTell} /> : null}
      {past ? <Text style={styles.barSub}>This day is over: nothing to change.</Text> : (
        <TellTRow tripId={tripId} date={date} dayLabel={dayWords} places={places} open={tell} onOpened={() => setTell(null)}
          side={real.length || score.reasons.length ? (
            <TouchableOpacity onPress={onUse} style={styles.useBtn} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Use T's plan: Show T's changes on the timeline">
              <Text style={styles.useText}>Use T's plan</Text>
            </TouchableOpacity>
          ) : null} />
      )}
      {open ? (
        <View style={styles.details}>
          <Text style={styles.detailLine}>{planKindText(planner.run)} · {clock12(planner.run.created_at, tz)}</Text>
          {details.map(d => <Text key={d} style={styles.detailLine}>· {d}</Text>)}
          {score.lowerWhy ? <Text style={styles.detailLine}>{score.lowerWhy}</Text> : null}
          {score.week && score.week.days > 1 ? (
            <Text style={styles.detailLine}>
              Week from today: T {shotsText(score.week.t)}{score.week.mine != null ? ` · yours ${shotsText(score.week.mine)}` : ''} good shots of big subjects
              {score.week.bigLeft ? ` · T covers ~${Math.round(score.week.covered)} of ${score.week.bigLeft} left` : ''}
            </Text>
          ) : null}
          {!flagged && review ? <PlanCheckRow tripId={tripId} date={date} tz={tz} onTellT={setTell} /> : null}
          {weather}
        </View>
      ) : null}
    </View>
  );
}

// ----- Trip ⋯ menu ----------------------------------------------------------------------------------------------------

export function TripMenu({ visible, onClose, tripId, tripTitle, tripTz, onOpenPlanner, onOpenFeeds }: {
  visible: boolean; onClose: () => void; tripId: string; tripTitle: string; tripTz?: string | null;
  onOpenPlanner: () => void; onOpenFeeds: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [spend, setSpend] = useState<ClaudeSpend | null>(null);
  useEffect(() => { if (visible) fetchClaudeSpend().then(setSpend).catch(() => {}); }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.dim} activeOpacity={1} onPress={onClose} accessibilityLabel="Close the menu" />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
        <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
          <Text style={styles.sheetTitle}>{tripTitle}</Text>
          <NightlyToggle tripId={tripId} tripTitle={tripTitle} tripTz={tripTz} />
          <Text style={styles.menuLine}>{spend ? spendLine(spend) : 'Claude spend: loading…'}</Text>
          <TouchableOpacity style={styles.menuBtn} onPress={() => { onClose(); onOpenFeeds(); }} accessibilityRole="button">
            <Ionicons name="videocam-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.menuText}>Live feeds: cameras and airports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuBtn} onPress={() => { onClose(); onOpenPlanner(); }} accessibilityRole="button"
            accessibilityLabel="Open the Planner">
            <Ionicons name="sparkles-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.menuText}>All planner views (plans, subjects, map, setup)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuBtn, { justifyContent: 'center' }]} onPress={onClose} accessibilityRole="button">
            <Text style={styles.menuText}>Close</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// Days of the trip the stop page's days row lists: T's verdict per day from the week.
export function useStableWeek(week: TWeek | null | undefined): TWeek | null {
  const [w, setW] = useState<TWeek | null>(week ?? null);
  useEffect(() => { if (week) setW(week); }, [week]);
  return useMemo(() => w, [w]);
}

const styles = StyleSheet.create({
  rpWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 6 },
  rpCard: { minHeight: 48, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: '#262626', backgroundColor: '#131313' },
  rpGo: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.textPrimary, alignItems: 'center', justifyContent: 'center' },
  rpText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  rpSub: { fontSize: 11, color: colors.textSecondary },
  rpLine: { fontSize: 11, color: colors.textSecondary },
  rpErr: { fontSize: 12, color: '#e74c3c' },
  tile: { width: 62, paddingHorizontal: 7, paddingTop: 6, paddingBottom: 5, marginRight: 6, borderRadius: 10, borderWidth: 1, borderColor: '#262626', backgroundColor: colors.surface, gap: 2 },
  tileOn: { borderColor: colors.signalOk, backgroundColor: '#0f1913' },
  tileToday: {},
  tileA: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#8a8a8a' },
  tileB: { fontFamily: 'Georgia', fontSize: 19, lineHeight: 22, color: colors.textPrimary },
  tileC: { fontSize: 9, fontWeight: '700', color: '#8a8a8a' },
  tileGrey: { color: '#8a8a8a', fontWeight: '700' },
  mark: { position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: 3 },
  bar: {
    marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.xs, paddingHorizontal: 12, paddingVertical: 11, gap: 9,
    borderRadius: 14, borderWidth: 1, borderColor: '#262626', backgroundColor: colors.surface,
  },
  barHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  barBig: { fontFamily: 'Georgia', fontSize: 30, lineHeight: 32, color: colors.textPrimary },
  vs: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vsLab: { fontSize: 10, letterSpacing: 1.1, fontWeight: '800', color: colors.signalOk },
  cmp: { flex: 1, gap: 4 },
  cbar: { height: 5, borderRadius: 3, backgroundColor: '#222222', overflow: 'hidden' },
  cbarFill: { height: 5, borderRadius: 3 },
  yoursLine: { fontSize: 11, color: '#8a8a8a' },
  drive: { fontSize: 12, color: '#dddddd' },
  driveB: { fontWeight: '700' },
  driveSub: { color: '#8a8a8a' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#333333', maxWidth: '100%' },
  chipAdd: { borderColor: '#2f5c43', backgroundColor: '#0f1913' },
  chipOn: { borderColor: colors.textPrimary },
  chipMore: { borderColor: 'transparent', paddingLeft: 2 },
  chipT: { fontSize: 11, color: '#dddddd' },
  reason: { fontSize: 11.5, color: '#bbbbbb', lineHeight: 16 },
  warnRow: { backgroundColor: '#1a160b', borderWidth: 1, borderColor: '#3a2f12', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6 },
  warnRowT: { fontSize: 11, color: '#e9d39a' },
  warnText: { fontSize: 12, color: colors.textPrimary, borderLeftWidth: 2, borderLeftColor: colors.textPrimary, paddingLeft: 8 },
  barSub: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  link: { fontSize: 12, fontWeight: '700', color: colors.signalOk },
  warn: { fontSize: 12, color: colors.textPrimary, borderLeftWidth: 2, borderLeftColor: colors.textPrimary, paddingLeft: 8 },
  useBtn: { flex: 1.4, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.textPrimary },
  useText: { fontSize: 14, fontWeight: '700', color: colors.textInverse },
  details: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8 },
  detailLine: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#141414', borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#333333', padding: spacing.lg, maxHeight: '80%' },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  menuLine: { fontSize: 12, color: colors.textSecondary },
  menuBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  menuText: { fontSize: 14, color: colors.textPrimary },
});
