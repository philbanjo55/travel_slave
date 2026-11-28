import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius } from '../../theme';
import { ClaudeSpend, DayChange, PlanRun, clock12, dayChanges, fetchClaudeSpend, spendLine } from '../../services/planner';
import { expShots, isLightOnly, shotsText } from '../../services/plannerWords';
import { TWeek, placements, samePlace } from '../../services/plannerWeekPure';
import { failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { usePlanningStatus } from '../../services/planningStatus';
import { useReplanMode, MODE_SUB } from '../../services/onePass';
import { replanFromNow } from '../../services/replanFromNow';
import { errText } from '../../utils/errText';
import ProgressBar from '../ProgressBar';
import { ReplanProgress, DayPlanner } from './DayPlannerHints';
import { PlanCheckRow, usePlanReview } from './PlanCheck';
import { TellTRow } from './TellT';
import NightlyToggle from './NightlyToggle';
import type { DayScore } from '../../services/plannerDay';

// Planner redesign, option 3 "Week strip on top" (Phil, 28 Nov 2026; mockup https://claude.ai/artifact/6bFbuwwtbZDFQLeDVYQ7Po).
// The pieces the trip page uses when OPTION3_UI is on: the one Re-plan button with T's plan time under it, the week strip
// (one tile per day: T's number and how many changes), the day bar (T's number vs yours, the plan check only when it
// found something, Use T's plan, Tell T) and the trip's ⋯ menu (nightly alert, Claude spend, the old Planner screens).

// ----- Re-plan from now on --------------------------------------------------------------------------------------------

export function ReplanFromNowBar({ tripId, tripTitle, run, tz }: { tripId: string; tripTitle?: string; run: PlanRun | null; tz?: string }) {
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
  const planned = run ? `T planned ${clock12(run.created_at, tz)}${format(parseISO(run.created_at), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? '' : ` ${format(parseISO(run.created_at), 'EEE')}`} · ${isLightOnly(run) ? 'typical weather' : 'forecast'}` : 'Not planned yet';
  return (
    <View style={styles.rpWrap}>
      <TouchableOpacity onPress={go} disabled={busy} style={[styles.rpBtn, busy && { opacity: 0.6 }]} activeOpacity={0.8} accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }} accessibilityLabel={`Re-plan from now on: ${MODE_SUB[mode ?? 'rest']}. Plan again and Re-plan now with the cameras in one`}>
        {busy ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="refresh" size={16} color={colors.textPrimary} />}
        <Text style={styles.rpText}>{busy ? 'Re-planning…' : 'Re-plan from now on'}</Text>
        <Text style={styles.rpSub}>· {MODE_SUB[mode ?? 'rest']}</Text>
      </TouchableOpacity>
      {now.phase === 'running' ? <ReplanProgress tripId={tripId} />
        : later ? <ProgressBar label={s && s.status !== 'queued' ? 'T is planning the later days' : 'T is starting'} compact
          fraction={total ? Math.max(0.04, done / total) : null} text={total ? `${done} of ${total} days` : undefined} />
        : now.phase === 'error' ? <Text style={styles.rpErr} numberOfLines={3}>{now.message}</Text>
        : <Text style={styles.rpLine} accessibilityLabel={planned}>{planned}</Text>}
    </View>
  );
}

// ----- Week strip -----------------------------------------------------------------------------------------------------

export type WeekTile = { t: number | null; changes: number; planned: boolean; past: boolean };

// One tile per trip day from the week of T plans the trip page already reads (planner.week): T's good shots of the big
// subjects and how many stops T's plan changes on that day against the day as it stands.
export function weekTiles(week: TWeek | null, days: any[], tierOf: (id: string) => string | null | undefined, today: string, tz?: string): Map<string, WeekTile> {
  const out = new Map<string, WeekTile>();
  for (const d of days) {
    if (!d.date) continue;
    const td = week?.byDate.get(d.date);
    const past = d.date < today;
    if (!td?.best) { out.set(d.date, { t: null, changes: 0, planned: false, past }); continue; }
    const t = td.run?.stats?.exp_big != null ? Number(td.run.stats.exp_big) : expShots(td.best, tierOf);
    const ch: DayChange[] = past ? [] : dayChanges(d.stops ?? [], days, td.mine, td.best, td.run?.params?.tz ?? tz, tierOf);
    out.set(d.date, { t, changes: ch.length, planned: true, past });
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
            <Text style={[styles.tileA, today && { color: colors.signalOk }]}>{d.date ? format(parseISO(d.date), 'EEE d').toUpperCase() : `DAY ${d.day_number}`}</Text>
            <Text style={styles.tileB}>{tile?.t != null ? shotsText(tile.t) : '–'}</Text>
            <Text style={[styles.tileC, (!tile?.changes || tile.past) && styles.tileGrey]} numberOfLines={1}>{today ? 'TODAY' : sub}</Text>
            {d.checked ? <View style={[styles.mark, { backgroundColor: colors.signalOk }]} /> : d.review ? <View style={[styles.mark, { backgroundColor: '#d4a017' }]} /> : null}
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

export function DayBar({ tripId, date, planner, score, past, places, onUse, details, weather }: {
  tripId: string; date: string; planner: DayPlanner | null; score: DayScore | null; past: boolean; places: string[];
  onUse: () => void; details: string[]; weather?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tell, setTell] = useState<string | null>(null);
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
  const tNum = score.bigOnDay ? shotsText(score.best) : '–';
  const mineNum = !score.bigOnDay ? null : score.mine != null ? shotsText(score.mine) : '–';
  return (
    <View style={styles.bar}>
      <View style={styles.barHead}>
        <Text style={styles.barBig} accessibilityLabel={`T's day: ${tNum} good shots of big subjects`}>{tNum}</Text>
        <Text style={styles.barSub} numberOfLines={2}>
          {score.bigOnDay ? `good shots · yours ${mineNum}` : `no big subjects this day${score.others >= 0.05 ? ` · ${shotsText(score.others)} of the others` : ''}`}
        </Text>
        <TouchableOpacity onPress={() => setOpen(o => !o)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }} accessibilityRole="button"
          accessibilityLabel={open ? 'Hide the details' : 'Show the details of this plan'}>
          <Text style={styles.link}>{open ? 'Less' : 'Details'} ›</Text>
        </TouchableOpacity>
      </View>
      {score.late ? <Text style={styles.warn}>Re-plan came at {clock12(planner.run.created_at, tz)}, after the first stop: go by your plan for it.</Text> : null}
      {flagged ? <PlanCheckRow tripId={tripId} date={date} tz={tz} onTellT={setTell} /> : null}
      {past ? <Text style={styles.barSub}>This day is over: nothing to change.</Text> : (
        <TellTRow tripId={tripId} date={date} dayLabel={dayWords} places={places} open={tell} onOpened={() => setTell(null)}
          side={real.length || score.reasons.length ? (
            <TouchableOpacity onPress={onUse} style={styles.useBtn} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Use T's plan from now on">
              <Text style={styles.useText}>Use T's plan</Text>
            </TouchableOpacity>
          ) : null} />
      )}
      {open ? (
        <View style={styles.details}>
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
  rpBtn: { minHeight: 42, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: '#555555' },
  rpText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  rpSub: { fontSize: 11, color: colors.textSecondary },
  rpLine: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  rpErr: { fontSize: 12, color: '#e74c3c' },
  tile: { width: 66, minHeight: 64, paddingHorizontal: 7, paddingVertical: 6, marginRight: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 1 },
  tileOn: { borderColor: colors.signalOk, backgroundColor: '#0f1a14' },
  tileToday: { borderColor: '#2f5a40' },
  tileA: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.textSecondary },
  tileB: { fontFamily: 'Georgia', fontSize: 18, color: colors.textPrimary },
  tileC: { fontSize: 9, fontWeight: '700', color: colors.signalOk },
  tileGrey: { color: colors.textSecondary, fontWeight: '400' },
  mark: { position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: 3 },
  bar: {
    marginHorizontal: spacing.xl, marginTop: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 8,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
  },
  barHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  barBig: { fontFamily: 'Georgia', fontSize: 24, color: colors.textPrimary },
  barSub: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  link: { fontSize: 12, fontWeight: '700', color: colors.signalOk },
  warn: { fontSize: 12, color: colors.textPrimary, borderLeftWidth: 2, borderLeftColor: colors.textPrimary, paddingLeft: 8 },
  useBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.textPrimary },
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
