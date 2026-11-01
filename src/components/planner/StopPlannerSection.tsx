import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import {
  CurveSlot, GridCell, StopSettings, fetchStopCurve, fetchStopSettings, hhmm, labelMinutes, minutesLabel, tzMinutes,
} from '../../services/planner';
import { startReplan } from '../../services/planningStatus';
import SettingsEditor, { settingsSummary } from './SettingsEditor';
import { DayPlanner, stopHint, tripGrid } from './DayPlannerHints';

type Tab = 'today' | 'trip' | 'settings';

// TEST app only (redesign E-all b, Phil 1 Nov 2026): the planner's read of this stop. A big
// chance header (its light and time, the next-best day, the tier), then three tabs: Today
// (its chance through the day, the planned window boxed), Trip (its best chance on every
// trip day) and Settings (shot, tier, light, fog, starred shot).
export default function StopPlannerSection({ stopId, planner, tripId, tripDate, days, timeLabel, duration, tz: tripTz }: {
  stopId: string; planner: DayPlanner | null; tripId: string | null; tripDate: string | null; days: any[];
  timeLabel: string | null; duration: number | null; tz?: string;
}) {
  const navigation = useNavigation<any>();
  const [setting, setSetting] = useState<StopSettings | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [cells, setCells] = useState<GridCell[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [replanning, setReplanning] = useState(false);

  useEffect(() => { fetchStopSettings(stopId).then(r => setSetting(r.setting)).catch(() => {}); }, [stopId]);
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    tripGrid(tripId).then(c => { if (alive) setCells(c.filter(x => x.stop_id === stopId)); });
    return () => { alive = false; };
  }, [tripId, stopId]);

  const tz: string | undefined = planner?.run?.params?.tz ?? tripTz;
  const hint = stopHint(stopId, planner);
  const v = planner?.byStop.get(stopId);
  const pct = hint ? Math.round(hint.p * 100) : null;
  const tier = setting?.tier ?? planner?.tiers.get(stopId) ?? null;
  const dayNo = useMemo(() => new Map(days.filter((d: any) => d.date).map((d: any) => [d.date, d.day_number as number])), [days]);

  // "Day 3 almost as good (74%)": the next-best trip day, else the planner's better-day hint.
  const other = (cells ?? []).filter(c => c.trip_date !== tripDate && dayNo.has(c.trip_date)).sort((a, b) => b.p_good - a.p_good)[0];
  const better = planner?.betterDay.get(stopId);
  const second = better ? `Day ${better.dayNumber} looks better (${Math.round(better.p_good * 100)}%)`
    : other && hint && other.p_good >= 0.3 ? `Day ${dayNo.get(other.trip_date)} ${other.p_good >= hint.p ? 'as good' : 'almost as good'} (${Math.round(other.p_good * 100)}%)`
    : other && !hint && other.p_good >= 0.3 ? `Best day: Day ${dayNo.get(other.trip_date)} (${Math.round(other.p_good * 100)}%)` : null;

  const replan = async () => {
    if (!tripId) return;
    setReplanning(true);
    try { await startReplan(tripId); setSaved(false); } catch { /* the strip shows nothing; try again */ }
    setReplanning(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.label}>T · THIS STOP</Text>
          {pct != null ? (
            <View style={styles.bigRow}>
              <Text style={[styles.big, pct >= 40 && styles.good]}>{pct}%</Text>
              <Text style={styles.bigSub} numberOfLines={2}>
                {hint?.changed ? 'you changed it · new chance after the next plan'
                  : `chance${hint?.light ? ` · ${hint.light}` : ''}${v ? ` at ${hhmm(v.peak_at ?? v.start, tz)}` : ''}`}
              </Text>
            </View>
          ) : <Text style={styles.bigSub}>{tier ? 'Not in this day\'s plan yet.' : 'Not rated: the planner skips it.'}</Text>}
          {second ? <Text style={styles.second}>{second}</Text> : null}
        </View>
        {tier ? <Text style={styles.tierPill}>{tier}</Text> : null}
      </View>

      <View style={styles.seg} accessibilityRole="tablist">
        {(['today', 'trip', 'settings'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[styles.segBtn, tab === t && styles.segOn]} onPress={() => setTab(t)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.segText, tab === t && styles.segTextOn]}>{t === 'today' ? 'Today' : t === 'trip' ? 'Trip' : 'Settings'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'today' ? (
        tripDate ? <TodayChart stopId={stopId} tripDate={tripDate} tz={tz} timeLabel={timeLabel} duration={duration} />
          : <Text style={styles.hint}>This stop isn't on a dated day.</Text>
      ) : tab === 'trip' ? (
        <View style={{ gap: 2 }}>
          {cells == null ? <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} />
            : !cells.length ? <Text style={styles.hint}>No chances yet: rate the stop and plan again.</Text>
            : days.filter((d: any) => d.date).map((d: any) => {
              const c = cells.find(x => x.trip_date === d.date);
              const here = d.date === tripDate;
              const p = c ? Math.round(c.p_good * 100) : null;
              return (
                <TouchableOpacity key={d.id} style={[styles.tripRow, here && styles.tripRowOn]} activeOpacity={0.8}
                  onPress={() => tripId && navigation.navigate('Planner', { tripId, tab: 'plans', date: d.date })}
                  accessibilityRole="button" accessibilityLabel={`Day ${d.day_number}${p != null ? `, ${p}%` : ''}. Open its plan`}>
                  <Text style={[styles.tripDay, here && styles.bold]}>Day {d.day_number}</Text>
                  <Text style={[styles.tripDate, here && styles.bold]}>{format(parseISO(d.date), 'EEE d MMM')}</Text>
                  <View style={styles.tripBar}>
                    {p != null ? <View style={[styles.tripFill, { width: `${Math.max(p, 2)}%`, backgroundColor: barColor(c!.p_good) }]} /> : null}
                  </View>
                  <Text style={[styles.tripPct, here && styles.bold]}>{p != null ? `${p}%` : '—'}</Text>
                  <Text style={styles.tripAt}>{c ? `${hhmm(c.best_at, tz)}${c.source === 'light' ? ' · light' : ''}` : ''}</Text>
                </TouchableOpacity>
              );
            })}
          <Text style={styles.hint}>Best chance each trip day (forecast where it reaches, else light only). Tap a day for its plan.</Text>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SettingsEditor stopId={stopId} initial={setting} onChange={s => { setSetting(s); setSaved(true); }} />
          {saved && tripId ? (
            <TouchableOpacity style={styles.replan} onPress={replan} disabled={replanning} accessibilityRole="button">
              <Text style={styles.replanText}>Saved. Re-plan with this change?</Text>
              {replanning ? <ActivityIndicator size="small" color={colors.signalOk} /> : <Text style={styles.replanGo}>Plan again ›</Text>}
            </TouchableOpacity>
          ) : !setting ? null : <Text style={styles.hint}>{settingsSummary(setting)}</Text>}
        </View>
      )}
    </View>
  );
}

const barColor = (p: number) => (p >= 0.6 ? colors.signalOk : p >= 0.3 ? '#8a8a8a' : '#3a3a3a');

// The stop's chance per 15-min slot on its day (ECMWF ensemble, else light only), the planned
// window (its time and length) boxed, the best slot named.
function TodayChart({ stopId, tripDate, tz, timeLabel, duration }: {
  stopId: string; tripDate: string; tz?: string; timeLabel: string | null; duration: number | null;
}) {
  const [slots, setSlots] = useState<CurveSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSlots(null); setError(null);
    fetchStopCurve(stopId, tripDate).then(s => { if (alive) setSlots(s); }).catch(e => { if (alive) setError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [stopId, tripDate]);

  if (error) return <Text style={styles.hint}>{/network|fetch/i.test(error) ? 'No connection.' : error}</Text>;
  if (!slots) return <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} />;
  if (!slots.length) return <Text style={styles.hint}>No chances for this day yet (the stop needs a rating and a starred shot).</Text>;

  const mins = slots.map(s => tzMinutes(s.slot_at, tz) ?? 0);
  const n = slots.length;
  const best = slots.reduce((b, s, i) => (s.p_good > slots[b].p_good || (s.p_good === slots[b].p_good && s.mean > slots[b].mean) ? i : b), 0);
  const start = labelMinutes(timeLabel);
  const end = start != null ? start + Math.max(duration ?? 15, 15) : null;
  const inWin = (m: number) => start != null && end != null && m >= start - 7 && m < end;
  const first = mins.findIndex(inWin), lastI = mins.length - 1 - [...mins].reverse().findIndex(inWin);
  const hasWin = first >= 0 && lastI >= first;
  const ticks = mins.map((m, i) => ({ m, i })).filter(t => t.m % 180 === 0);
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.chart}>
        {slots.map((s, i) => (
          <View key={s.slot_at} style={[styles.col, { width: `${100 / n}%` }]}>
            <View style={[styles.colBar, { height: `${Math.max(s.p_good * 100, 2)}%`, backgroundColor: barColor(s.p_good) }]} />
          </View>
        ))}
        {hasWin ? <View pointerEvents="none" style={[styles.window, { left: `${(100 * first) / n}%`, width: `${(100 * (lastI - first + 1)) / n}%` }]} /> : null}
        <Text style={styles.bestTag}>best {minutesLabel(mins[best]).replace(':00 ', ' ')} · {Math.round(slots[best].p_good * 100)}%</Text>
      </View>
      <View style={styles.axis}>
        {ticks.map(t => (
          <Text key={t.i} style={[styles.tick, { left: `${(100 * t.i) / n}%` }]}>{minutesLabel(t.m).replace(':00 ', '')}</Text>
        ))}
      </View>
      <Text style={styles.hint}>
        Chance the shot comes out good, every 15 min{slots[0].source === 'light' ? ' (light only: typical weather, no forecast yet)' : ' (ECMWF ensemble)'}.
        {hasWin ? ' Box: your planned time.' : start == null ? '' : ' Your planned time is outside daylight.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl, marginBottom: spacing.lg, padding: spacing.md, gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  big: { fontFamily: 'Georgia', fontSize: 34, color: colors.textPrimary },
  good: { color: colors.signalOk },
  bigSub: { flex: 1, fontSize: 13, color: colors.textSecondary },
  second: { fontSize: 12, color: colors.textSecondary },
  tierPill: { fontSize: 12, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  seg: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: radius.sm, padding: 3 },
  segBtn: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm - 2 },
  segOn: { backgroundColor: colors.accent },
  segText: { fontSize: 13, color: colors.textSecondary },
  segTextOn: { color: colors.textInverse, fontWeight: '700' },
  hint: { fontSize: 11, color: colors.textTertiary, lineHeight: 16 },
  bold: { fontWeight: '700', color: colors.textPrimary },
  chart: { height: 96, flexDirection: 'row', alignItems: 'flex-end', position: 'relative', paddingTop: 16 },
  col: { height: '100%', justifyContent: 'flex-end', paddingHorizontal: 0.5 },
  colBar: { width: '100%', borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  window: { position: 'absolute', top: 14, bottom: -2, borderWidth: 1.5, borderColor: colors.textPrimary, borderRadius: 3 },
  bestTag: { position: 'absolute', top: 0, right: 0, fontSize: 10, fontWeight: '700', color: colors.signalOk },
  axis: { height: 14, position: 'relative' },
  tick: { position: 'absolute', fontSize: 9, color: colors.textTertiary },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, paddingHorizontal: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
  tripRowOn: { borderColor: colors.textSecondary },
  tripDay: { width: 44, fontSize: 12, color: colors.textSecondary },
  tripDate: { width: 78, fontSize: 12, color: colors.textSecondary },
  tripBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  tripFill: { height: 5, borderRadius: 3 },
  tripPct: { width: 36, textAlign: 'right', fontSize: 12, color: colors.textPrimary },
  tripAt: { width: 76, fontSize: 10, color: colors.textTertiary },
  replan: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.signalOk },
  replanText: { flex: 1, fontSize: 12, color: colors.textPrimary },
  replanGo: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
});
