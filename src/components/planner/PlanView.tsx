import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import {
  Plan, PlanRun, PlanVisit, applyPreview, fetchDayRuns, fetchMultiRuns, fetchPlans, hhmm, ago, latestByDay,
  planDay, planDays, planTitle, runTripDates, LIGHT_WORDS,
} from '../../services/planner';
import { useTripStore } from '../../store/tripStore';
import { dayBadge } from './dayBadge';

const MODE_TEXT: Record<string, string> = {
  forecast: 'Forecast for this day',
  light: 'Light only: real sun for this date, typical (mostly cloudy) weather',
  preview: "Preview: this week's forecast played as this day (today's sun, not the trip's)",
};

// Opens a plan's stop on whichever trip day holds it now.
function useOpenStop() {
  const navigation = useNavigation<any>();
  const { currentTripData } = useTripStore();
  return (stopId: string) => {
    const day = currentTripData?.days.find((d: any) => (d.stops || []).some((x: any) => x.id === stopId));
    if (day) navigation.navigate('StopDetail', { stopId, dayId: day.id });
  };
}

// One trip day: Light only / This day, or this week's weather as that day.
export function DayPlanView({ tripId, tripDate }: { tripId: string; tripDate: string }) {
  const [preview, setPreview] = useState(false);
  const [run, setRun] = useState<PlanRun | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>('Loading…');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pv: boolean, replan = false) => {
    setError(null); setBusy('Loading…');
    try {
      let runId: string | null = null;
      if (!replan) {
        const latest = latestByDay(await fetchDayRuns(tripId)).get(tripDate) ?? {};
        runId = (pv ? latest.preview : (latest.forecast ?? latest.light))?.id ?? null;
      }
      if (!runId) {
        setBusy(replan ? 'Planning again with your latest changes…' : pv ? "Planning with this week's weather…" : 'Planning this day…');
        runId = await planDay(tripId, tripDate, pv, replan);
      }
      const r = (await fetchDayRuns(tripId, 40)).find(x => x.id === runId) ?? null;
      setRun(r); setPlans(await fetchPlans(runId));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setBusy(null);
  }, [tripId, tripDate]);

  useEffect(() => { load(preview); }, [preview, tripDate]);

  const badge = dayBadge(tripDate);
  const runDay = run?.stats?.days?.[0];
  const kind = runDay?.light_only ? 'light' : runDay && runDay.date !== runDay.trip_date ? 'preview' : 'forecast';
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.modeRow}>
        {[false, true].map(pv => (
          <TouchableOpacity key={String(pv)} onPress={() => setPreview(pv)} style={[styles.modeBtn, preview === pv && styles.modeOn]}>
            <Text style={[styles.modeText, preview === pv && styles.modeTextOn]}>
              {!pv ? (badge.text === 'LIGHT ONLY' ? 'Light only' : 'This day') : "This week's weather"}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => load(preview, true)} style={styles.replan} disabled={!!busy} accessibilityLabel="Plan again">
          <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          <Text style={styles.replanText}>Plan again</Text>
        </TouchableOpacity>
      </View>
      {busy ? <Busy text={busy} /> : error ? <Text style={styles.error}>{error}</Text> : (
        <>
          <Text style={styles.hint}>
            {MODE_TEXT[kind]}{run ? ` · planned ${ago(run.created_at)}` : ''}
            {runDay?.start_hotel && runDay?.end_hotel && runDay.start_hotel !== runDay.end_hotel
              ? `\nMove day: ${runDay.start_hotel} → ${runDay.end_hotel}` : ''}
          </Text>
          <PlanBody run={run} plans={plans} />
        </>
      )}
    </View>
  );
}

// Up to three trip days planned together.
export function MultiPlanView({ tripId, tripDates }: { tripId: string; tripDates: string[] }) {
  const [run, setRun] = useState<PlanRun | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>('Loading…');
  const [error, setError] = useState<string | null>(null);
  const key = tripDates.join(',');

  const load = useCallback(async (replan = false) => {
    setError(null); setBusy('Loading…');
    try {
      let r = replan ? undefined : (await fetchMultiRuns(tripId)).find(x => runTripDates(x).join(',') === key);
      if (!r) {
        setBusy(`Planning ${tripDates.length} days together… (about 10 seconds)`);
        const id = await planDays(tripId, tripDates);
        r = (await fetchMultiRuns(tripId, 10)).find(x => x.id === id);
      }
      setRun(r ?? null); setPlans(r ? await fetchPlans(r.id) : []);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setBusy(null);
  }, [tripId, key]);

  useEffect(() => { load(); }, [key]);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.modeRow}>
        <Text style={[styles.hint, { flex: 1, paddingHorizontal: spacing.sm }]}>
          A subject counts once, on its best day, with 6 h between back at night and out again.
        </Text>
        <TouchableOpacity onPress={() => load(true)} style={styles.replan} disabled={!!busy} accessibilityLabel="Plan again">
          <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          <Text style={styles.replanText}>Plan again</Text>
        </TouchableOpacity>
      </View>
      {busy ? <Busy text={busy} /> : error ? <Text style={styles.error}>{error}</Text> : (
        <>
          {run ? <Text style={styles.hint}>Planned {ago(run.created_at)}</Text> : null}
          <PlanBody run={run} plans={plans} byDay />
        </>
      )}
    </View>
  );
}

// Plan chips, summary and visits; "Use this plan…" opens the apply preview.
export function PlanBody({ run, plans, byDay, initialRank, onRank }: {
  run: PlanRun | null; plans: Plan[]; byDay?: boolean; initialRank?: number; onRank?: (rank: number) => void;
}) {
  const openStop = useOpenStop();
  const [sel, setSel] = useState(initialRank ?? 1);
  const [apply, setApply] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSel(plans.some(p => p.rank === (initialRank ?? 1)) ? (initialRank ?? 1) : plans[0]?.rank ?? 1); }, [plans]);
  const choose = (r: number) => { setSel(r); onRank?.(r); };
  const tz: string | undefined = run?.params?.tz;
  const plan = plans.find(p => p.rank === sel);

  const openApply = async () => {
    if (!run || !plan) return;
    setBusy(true); setError(null);
    try { setApply((await applyPreview(run.id, plan.rank)).result); } catch (e: any) { setError(String(e?.message ?? e)); }
    setBusy(false);
  };

  let lastDay: string | null = null;
  return (
    <View style={{ gap: spacing.sm }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {plans.map(p => (
          <TouchableOpacity key={p.rank} onPress={() => choose(p.rank)} style={[styles.chip, sel === p.rank && styles.chipOn]}>
            <Text style={[styles.chipText, sel === p.rank && styles.chipTextOn]}>{planTitle(p)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {plan ? (
        <>
          <Text style={styles.summary}>
            Expected <Text style={styles.bold}>{Math.round(plan.mean)}</Text>
            {'  ·  '}bad weather <Text style={styles.bold}>{Math.round(plan.cvar11)}</Text>
            {plan.drive_minutes != null ? `  ·  ${plan.drive_minutes} min driving` : ''}
            {plan.long_leg_minutes ? ` (${plan.long_leg_minutes} min over an hour)` : ''}
          </Text>
          {plan.visits.map((v, i) => {
            const d = v.trip_date ?? v.date;
            const head = byDay && d !== lastDay ? (lastDay = d) : null;
            return (
              <View key={`${v.stop_id}-${i}`}>
                {head ? <Text style={[styles.label, { marginTop: spacing.md }]}>{format(parseISO(head), 'EEE d MMM').toUpperCase()}</Text> : null}
                <VisitRow v={v} tz={tz} mine={plan.rank === 0} onPress={() => openStop(v.stop_id)} />
              </View>
            );
          })}
          {plan.rank !== 0 ? (
            <TouchableOpacity style={styles.applyBtn} onPress={openApply} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.applyText}>Use this plan…</Text>}
            </TouchableOpacity>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>Chance = share of the 51 weather versions (or light scenarios) where the shot comes out good.</Text>
        </>
      ) : <Text style={styles.hint}>No plan.</Text>}
      <ApplySheet apply={apply} onClose={() => setApply(null)} />
    </View>
  );
}

export function ApplySheet({ apply, onClose }: { apply: any | null; onClose: () => void }) {
  return (
    <Modal visible={!!apply} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBg}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>What would change</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Preview only in the TEST app: nothing is moved on your real trip until the solver is signed off.
            {apply?.stops_changed != null ? ` ${apply.stops_changed} stops would change.` : ''}
          </Text>
          <ScrollView style={{ maxHeight: 460 }}>
            {(apply?.days ?? []).map((d: any) => (
              <View key={d.date} style={{ marginTop: spacing.md }}>
                <Text style={styles.label}>DAY {d.day_number} · {format(parseISO(d.date), 'EEE d MMM')}</Text>
                {d.stops.map((s: any) => (
                  <View key={`${d.date}-${s.position}`} style={styles.applyRow}>
                    <Text style={styles.applyTime}>{s.time_label ?? ''}</Text>
                    <Text style={[styles.applyName, s.planned && styles.bold]} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.applyTag}>
                      {s.moved_from ? `from ${format(parseISO(s.moved_from), 'd MMM')}` : s.retimed ? 'new time' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function VisitRow({ v, tz, mine, onPress, index }: { v: PlanVisit; tz?: string; mine: boolean; onPress: () => void; index?: number }) {
  const pct = v.p_good != null ? Math.round(v.p_good * 100) : null;
  const barColor = pct == null ? colors.border : pct >= 60 ? colors.signalOk : pct >= 30 ? '#aaaaaa' : '#555555';
  const light = v.light ? LIGHT_WORDS[v.light] ?? v.light : null;
  const muted = mine && !v.rated;
  return (
    <TouchableOpacity style={styles.visit} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.visitTime, muted && styles.muted]}>{index != null ? `${index} · ` : ''}{hhmm(v.start, tz)}</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.visitName, muted && styles.muted]} numberOfLines={2}>{v.name}</Text>
          {v.booked ? <Text style={styles.booked}>BOOKED</Text> : null}
        </View>
        {pct != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.barBg}><View style={[styles.bar, { width: `${Math.max(pct, 3)}%`, backgroundColor: barColor }]} /></View>
            <Text style={styles.visitMeta}>
              {pct}%{light ? ` · ${light}` : ''}{v.peak_at && v.peak_at !== v.start ? ` at ${hhmm(v.peak_at, tz)}` : ''}
            </Text>
          </View>
        ) : null}
        {!mine && (v.wait_min || v.drive_min) ? (
          <Text style={styles.visitSub}>
            {v.drive_min ? `${v.drive_min} min drive` : ''}{v.drive_min && v.wait_min ? ' · ' : ''}{v.wait_min ? `${v.wait_min} min wait` : ''}
          </Text>
        ) : null}
        {mine && v.best && v.best.p_good > (v.p_good ?? 0) + 0.1 ? (
          <Text style={styles.hintChip}>Better at {hhmm(v.best.start, tz)}: {Math.round(v.best.p_good * 100)}%</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function Busy({ text }: { text: string }) {
  return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.hint}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.sm, padding: 3 },
  modeBtn: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm - 2 },
  modeOn: { backgroundColor: colors.accent },
  modeText: { fontSize: 13, color: colors.textSecondary },
  modeTextOn: { color: colors.textInverse, fontWeight: '700' },
  replan: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, minHeight: 36, alignItems: 'center', justifyContent: 'center',
            borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  replanText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  hint: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
  error: { fontSize: 13, color: '#e74c3c' },
  chips: { gap: 6, paddingVertical: spacing.xs },
  chip: { minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse, fontWeight: '700' },
  summary: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  bold: { fontWeight: '700', color: colors.textPrimary },
  visit: {
    flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  visitTime: { width: 46, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  visitName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  muted: { color: colors.textTertiary, fontWeight: '400' },
  booked: { fontSize: 9, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  barBg: { width: 70, height: 4, borderRadius: 2, backgroundColor: colors.border },
  bar: { height: 4, borderRadius: 2 },
  visitMeta: { fontSize: 12, color: colors.textSecondary, flexShrink: 1 },
  visitSub: { fontSize: 11, color: colors.textTertiary },
  hintChip: {
    alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', color: colors.signalOk,
    borderWidth: 1, borderColor: colors.signalOk, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5,
  },
  applyBtn: { marginTop: spacing.lg, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 15, fontWeight: '700', color: colors.textInverse },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  sheetTitle: { flex: 1, ...typography.headlineLarge },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 30 },
  applyTime: { width: 70, fontSize: 12, color: colors.textSecondary },
  applyName: { flex: 1, fontSize: 13, color: colors.textPrimary },
  applyTag: { fontSize: 11, color: colors.signalOk },
});
