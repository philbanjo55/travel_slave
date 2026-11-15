import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import {
  CurveSlot, StopSettings, ago, clock12, fetchStopCurve, fetchStopSettings, labelMinutes, minutesLabel, tzMinutes,
  LIGHT_WORDS,
} from '../../services/planner';
import { VERDICT_COLOR, VERDICT_TEXT, countText, planKindText, reasonText, verdictOf } from '../../services/plannerWords';
import { mineVisit, placements, samePlace } from '../../services/plannerWeek';
import { startReplan } from '../../services/planningStatus';
import SettingsEditor, { settingsSummary } from './SettingsEditor';
import { DayPlanner } from './DayPlannerHints';

type Tab = 'today' | 'trip' | 'settings';

// TEST app only: the planner's read of this stop. One chance, T's own, everywhere (Phil, 3 Nov
// 2026): the header gives T's verdict at your time with its reason, where T's plan puts the
// stop (this day, another time, or another day) and why; then three tabs: Today (when the
// light peaks through the day, from the raw forecast, timing only, no second chance), Trip
// (T's verdict on every day T plans the stop) and Settings (shot, tier, light, fog, star).
export default function StopPlannerSection({ stopId, planner, tripId, tripDate, days, timeLabel, duration, tz: tripTz }: {
  stopId: string; planner: DayPlanner | null; tripId: string | null; tripDate: string | null; days: any[];
  timeLabel: string | null; duration: number | null; tz?: string;
}) {
  const navigation = useNavigation<any>();
  const [setting, setSetting] = useState<StopSettings | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [saved, setSaved] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [curve, setCurve] = useState<{ slots: CurveSlot[]; builtAt: string | null } | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  useEffect(() => {
    if (!tripDate) return;
    let alive = true;
    setCurve(null); setCurveError(null);
    fetchStopCurve(stopId, tripDate).then(c => { if (alive) setCurve(c); }).catch(e => { if (alive) setCurveError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [stopId, tripDate]);

  useEffect(() => { fetchStopSettings(stopId).then(r => setSetting(r.setting)).catch(() => {}); }, [stopId]);

  const tz: string | undefined = planner?.run?.params?.tz ?? tripTz;
  const tier = setting?.tier ?? planner?.tiers.get(stopId) ?? null;
  const week = planner?.week ?? null;
  const run = planner?.run ?? null;

  // T's chance at YOUR time (T scores your own day on the same forecasts as its plan).
  const mineV = planner?.mine?.visits.find(v => samePlace(week, v.stop_id, stopId) && v.rated !== false && v.p_good != null)
    ?? (tripDate ? mineVisit(week, stopId, tripDate) : null);
  const bestV = planner?.best?.visits.find(v => samePlace(week, v.stop_id, stopId) && v.p_good != null) ?? null;
  const light = mineV?.light ? LIGHT_WORDS[mineV.light] ?? mineV.light : null;
  const startMin = labelMinutes(timeLabel);
  const bestMin = bestV ? tzMinutes(bestV.start, tz) : null;
  const elsewhere = placements(week, stopId).filter(p => p.date !== tripDate);
  // Where T's plan puts it, and why (in T's chances).
  const tPlan = !planner?.best ? null
    : bestV ? (startMin != null && bestMin != null && Math.abs(bestMin - startMin) >= 10
      ? { text: `T's plan: ${clock12(bestV.start, tz)} instead`, v: bestV, why: reasonText(bestV, run) }
      : { text: "T's plan keeps your time", v: null, why: null })
    : elsewhere[0] ? { text: `T does it on Day ${elsewhere[0].dayNumber ?? '?'} instead, at ${clock12(elsewhere[0].visit.start, elsewhere[0].run.params?.tz ?? tz)}`, v: elsewhere[0].visit, why: reasonText(elsewhere[0].visit, elsewhere[0].run) }
    : { text: "Not in T's plans this trip", v: null, why: mineV && verdictOf(mineV.p_good) === 'skip' ? 'No day looks good enough for it' : null };

  // The Today chart is the raw forecast's shape (timing only): when the light peaks.
  const slots = curve?.slots ?? [];
  // When each part was last updated.
  const updated = [
    run ? `${planKindText(run)} ${ago(run.created_at)}` : null,
    slots[0]?.source === 'forecast' && curve?.builtAt ? `chart forecast ${ago(curve.builtAt)}` : slots[0]?.source === 'light' ? 'chart: light only' : null,
  ].filter(Boolean).join(' · ');
  const vd = mineV ? verdictOf(mineV.p_good) : null;

  const replan = async () => {
    if (!tripId) return;
    setReplanning(true);
    try { await startReplan(tripId); setSaved(false); } catch { /* the strip shows nothing; try again */ }
    setReplanning(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.label}>T · THIS STOP</Text>
          {planner?.changed.has(stopId) ? <Text style={styles.bigSub}>You changed it: new chances after the next plan.</Text> : null}
          {mineV && vd ? (
            <>
              <View style={styles.bigRow}>
                <Text style={[styles.big, { color: VERDICT_COLOR[vd] }]}>{VERDICT_TEXT[vd]}</Text>
                <Text style={styles.bigSub} numberOfLines={2}>at your time{timeLabel ? `, ${timeLabel}` : ''}</Text>
              </View>
              <Text style={styles.why}>{reasonText(mineV, run)}{light ? ` · ${light}` : ''}</Text>
            </>
          ) : <Text style={styles.bigSub}>{!tier ? 'Not rated: the planner skips it.' : run ? "T hasn't scored your time for this stop yet." : 'Not planned yet.'}</Text>}
          {tPlan ? (
            <View style={styles.tPlan}>
              <Text style={styles.second}>
                {tPlan.text}
                {tPlan.v ? <Text style={{ color: VERDICT_COLOR[verdictOf(tPlan.v.p_good)], fontWeight: '700' }}>{` · ${VERDICT_TEXT[verdictOf(tPlan.v.p_good)]}`}</Text> : null}
              </Text>
              {tPlan.why ? <Text style={styles.whySmall}>{tPlan.why}</Text> : null}
            </View>
          ) : null}
          {/* The peak time is on the Today chart below (its "peak" tag): no second line here (Phil, 13 Nov 2026: less text). */}
          {updated ? <Text style={styles.updated}>{updated}</Text> : null}
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
        tripDate ? <TodayChart slots={curve?.slots ?? null} error={curveError} tz={tz} timeLabel={timeLabel} duration={duration} />
          : <Text style={styles.hint}>This stop isn't on a dated day.</Text>
      ) : tab === 'trip' ? (
        <View style={{ gap: 2 }}>
          {!week ? <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} />
            : days.filter((d: any) => d.date).map((d: any) => {
              const td = week.byDate.get(d.date);
              const t = td?.best?.visits.find(v => v.stop_id === stopId && v.p_good != null) ?? null;
              const own = d.date === tripDate ? mineVisit(week, stopId, d.date) : null;
              const v = t ?? own;
              const here = d.date === tripDate;
              const k = v ? verdictOf(v.p_good) : null;
              return (
                <TouchableOpacity key={d.id} style={[styles.tripRow, here && styles.tripRowOn]} activeOpacity={0.8}
                  onPress={() => tripId && navigation.navigate('Planner', { tripId, tab: 'plans', date: d.date })}
                  accessibilityRole="button" accessibilityLabel={`Day ${d.day_number}${k ? `, ${VERDICT_TEXT[k]}` : ''}. Open its plan`}>
                  <Text style={[styles.tripDay, here && styles.bold]}>Day {d.day_number}</Text>
                  <Text style={[styles.tripDate, here && styles.bold]}>{format(parseISO(d.date), 'EEE d MMM')}</Text>
                  {k && v ? (
                    <>
                      <Text style={[styles.tripVerdict, { color: VERDICT_COLOR[k] }]}>{VERDICT_TEXT[k]}</Text>
                      <Text style={styles.tripAt} numberOfLines={1}>
                        {countText(v, td?.run).replace(/ forecasts$/, '').replace(' typical days', '/10 typical')} · {clock12(v.start, td?.run?.params?.tz ?? tz)}{t ? '' : ' · yours'}
                      </Text>
                    </>
                  ) : <Text style={styles.tripNone}>{td ? 'not in T’s plan' : 'not planned yet'}</Text>}
                </TouchableOpacity>
              );
            })}
          <Text style={styles.hint}>After 3 days: typical weather, no forecast yet. Tap a day for its plan.</Text>
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


// The stop's chance per 15-min slot on its day (ECMWF ensemble, else light only), the planned
// window (its time and length) boxed, the best slot named.
function TodayChart({ slots, error, tz, timeLabel, duration }: {
  slots: CurveSlot[] | null; error: string | null; tz?: string; timeLabel: string | null; duration: number | null;
}) {
  if (error) return <Text style={styles.hint}>{/network|fetch/i.test(error) ? 'No connection.' : error}</Text>;
  if (!slots) return <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing.md }} />;
  if (!slots.length) return <Text style={styles.hint}>No chart for this day yet (the stop needs a rating and a starred shot).</Text>;
  if (!slots.some(s => s.p_good > 0)) return <Text style={styles.hint}>No good light or weather at any time this day in the raw forecast.</Text>;

  const mins = slots.map(s => tzMinutes(s.slot_at, tz) ?? 0);
  const n = slots.length;
  const best = slots.reduce((b, s, i) => (s.p_good > slots[b].p_good || (s.p_good === slots[b].p_good && s.mean > slots[b].mean) ? i : b), 0);
  const start = labelMinutes(timeLabel);
  const end = start != null ? start + Math.max(duration ?? 15, 15) : null;
  const inWin = (m: number) => start != null && end != null && m >= start - 7 && m < end;
  const first = mins.findIndex(inWin), lastI = mins.length - 1 - [...mins].reverse().findIndex(inWin);
  const hasWin = first >= 0 && lastI >= first;
  const ticks = mins.map((m, i) => ({ m, i })).filter(t => t.m % 180 === 0);
  // Relative bars: the shape of the day (timing), not a second chance next to T's.
  const top = Math.max(...slots.map(s => s.p_good), 0.0001);
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.chart}>
        {slots.map((s, i) => (
          <View key={s.slot_at} style={[styles.col, { width: `${100 / n}%` }]}>
            <View style={[styles.colBar, { height: `${Math.max((s.p_good / top) * 100, 2)}%`, backgroundColor: i === best ? colors.signalOk : '#6a6a6a' }]} />
          </View>
        ))}
        {hasWin ? <View pointerEvents="none" style={[styles.window, { left: `${(100 * first) / n}%`, width: `${(100 * (lastI - first + 1)) / n}%` }]} /> : null}
        {slots[best].p_good > 0 ? <Text style={styles.bestTag}>peak {minutesLabel(mins[best]).replace(':00 ', ' ')}</Text> : null}
      </View>
      <View style={styles.axis}>
        {ticks.map(t => (
          <Text key={t.i} style={[styles.tick, { left: `${(100 * t.i) / n}%` }]}>{minutesLabel(t.m).replace(':00 ', '')}</Text>
        ))}
      </View>
      <Text style={styles.hint}>
        Timing only{slots[0].source === 'light' ? ' (no forecast yet)' : ' (raw ECMWF)'}: go by T's verdict above.
        {hasWin ? ' Box: your time.' : start == null ? '' : ' Your time is outside daylight.'}
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
  big: { fontFamily: 'Georgia', fontSize: 28, color: colors.textPrimary },
  good: { color: colors.signalOk },
  bigSub: { flex: 1, fontSize: 13, color: colors.textSecondary },
  second: { fontSize: 13, color: colors.textPrimary },
  why: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  whySmall: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  tPlan: { gap: 1, marginTop: 2 },
  tripVerdict: { width: 72, fontSize: 12, fontWeight: '700' },
  tripNone: { flex: 1, fontSize: 11, color: colors.textTertiary },
  updated: { fontSize: 10, color: colors.textTertiary, marginTop: 2 },
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
  tripAt: { flex: 1, fontSize: 11, color: colors.textSecondary },
  replan: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.signalOk },
  replanText: { flex: 1, fontSize: 12, color: colors.textPrimary },
  replanGo: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
});
