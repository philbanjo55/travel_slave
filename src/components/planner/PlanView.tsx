import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius, typography } from '../../theme';
import {
  Plan, PlanRun, PlanVisit, applyPreview, fetchDayRuns, fetchMultiRuns, fetchPlans, hhmm, ago, latestByDay,
  planDay, planDays, planTitle, runTripDates, LIGHT_WORDS, usesT, latestT, waitForT, fetchTDays,
  canApply, applyPlan, clock12,
} from '../../services/planner';
import { onPlanLanded, startReplanNow, failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { VERDICT_COLOR, VERDICT_TEXT, countText, expShots, forecastCount, isLightOnly, lateReplan, planKindText, shotsText, verdictOf } from '../../services/plannerWords';
import { forgetWeek } from '../../services/plannerWeek';
import { startReplan, ack } from '../../services/planningStatus';
import { useTripStore } from '../../store/tripStore';
import { dayBadge } from './dayBadge';
import { useTierOf, forgetTiers } from './DayPlannerHints';
import { ShotsText } from './ScoreBar';
import { errText } from '../../utils/errText';

const MODE_TEXT: Record<string, string> = {
  forecast: 'Forecast for this day',
  tforecast: "T's plan from the forecast for this day",
  tlight: "T's week draft: real sun for this date and typical weather (no forecast reaches it yet)",
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
  const [t, setT] = useState<boolean | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Trips T plans: its newest plan for the day; Plan again rebuilds T's week draft.
  const loadT = useCallback(async (replan = false) => {
    setError(null); setBusy('Loading…');
    try {
      let r: PlanRun | null = null;
      if (replan) {
        const since = await startReplan(tripId);
        setBusy('T is planning the trip again (about 2–4 minutes). Progress is in the bar at the top; you can leave this screen.');
        r = await waitForT(tripId, tripDate, since, () => mounted.current);
        if (!mounted.current) return;
        if (!r) throw new Error("T is still planning, or doesn't re-plan this day (today is re-planned each morning). Check back in a few minutes.");
      } else r = await latestT(tripId, tripDate);
      if (replan) ack(tripId);
      setRun(r); setPlans(r ? await fetchPlans(r.id) : []);
      if (!r) setError("T hasn't planned this day yet. Tap Plan again.");
    } catch (e: any) { setError(errText(e)); }
    setBusy(null);
  }, [tripId, tripDate]);

  const load = useCallback(async (pv: boolean, replan = false) => {
    if (t) return loadT(replan);
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
    } catch (e: any) { setError(errText(e)); }
    setBusy(null);
  }, [tripId, tripDate, t, loadT]);

  useEffect(() => { usesT(tripId).then(setT).catch(() => setT(false)); }, [tripId]);
  useEffect(() => { if (t !== null) load(preview); }, [preview, tripDate, t]);

  // Re-plan now (Phil, 5 Nov 2026): today only, on trips T plans. Fresh camera pictures, then the
  // rest of today re-planned from where the plan says you are; the plan above stays until it is in.
  // The request lives in a shared store (replanNowStore): it carries on if Phil leaves, and the trip
  // page's day card shows the same one.
  const isToday = tripDate === format(new Date(), 'yyyy-MM-dd');
  const nowView = useReplanNow(t && isToday ? tripId : null);
  const { currentTripData } = useTripStore();
  const doNow = () => startReplanNow(tripId, currentTripData?.trip?.title).catch((e: any) => failReplanNow(tripId, errText(e)));
  useEffect(() => onPlanLanded(() => { if (t && isToday && mounted.current) loadT(); }), [t, isToday, loadT]);
  const nowNote = nowView.phase === 'done' ? nowView.message : null;

  const badge = dayBadge(tripDate);
  const runDay = run?.stats?.days?.[0];
  const kind = (t ? 't' : '') + (runDay?.light_only ? 'light' : runDay && runDay.date !== runDay.trip_date ? 'preview' : 'forecast');
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.modeRow}>
        {(t ? [false] : [false, true]).map(pv => (
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
      {t && isToday ? (
        <TouchableOpacity onPress={doNow} style={[styles.replan, styles.nowBtn]} disabled={!!busy || nowView.phase === 'running'} accessibilityLabel="Re-plan now">
          {nowView.phase === 'running' ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="camera-outline" size={16} color={colors.textPrimary} />}
          <Text style={[styles.replanText, { color: colors.textPrimary }]}>
            {nowView.phase === 'running' ? 'Re-planning with fresh camera pictures… (about 1 min)' : 'Re-plan now with the cameras'}
          </Text>
        </TouchableOpacity>
      ) : null}
      {busy ? <Busy text={busy} /> : error ? <Text style={styles.error}>{error}</Text> : (
        <>
          {nowNote ? <Text style={styles.warn}>{nowNote}</Text> : null}
          {nowView.phase === 'error' ? <Text style={styles.error}>{nowView.message}</Text> : null}
          {(() => { const l = lateReplan(run, plans); return l && run ? (
            <Text style={styles.warn}>This morning's re-plan came at {clock12(run.created_at, run.params?.tz)}, after the first stop ({clock12(l, run.params?.tz)}).</Text>
          ) : null; })()}
          <Text style={styles.hint}>
            {t && run ? `${planKindText(run)}, made ${clock12(run.created_at, run.params?.tz)} (${ago(run.created_at)})` : `${MODE_TEXT[kind]}${run ? ` · planned ${ago(run.created_at)}` : ''}`}
            {runDay?.start_hotel && runDay?.end_hotel && runDay.start_hotel !== runDay.end_hotel
              ? `\nMove day: ${runDay.start_hotel} → ${runDay.end_hotel}` : ''}
          </Text>
          <PlanBody tripId={tripId} run={run} plans={plans} />
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
  const [t, setT] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const loadT = useCallback(async (replan = false) => {
    setError(null); setBusy('Loading…'); setNote(null);
    try {
      if (replan) {
        const since = await startReplan(tripId);
        setBusy('T is planning the trip again (about 2–4 minutes). Progress is in the bar at the top; you can leave this screen.');
        await waitForT(tripId, tripDates[tripDates.length - 1], since, () => mounted.current);
        if (!mounted.current) return;
      }
      const j = await fetchTDays(tripId, tripDates);
      setRun(j.run); setPlans(j.plans);
      if (j.missing.length) setNote(`T has no plan yet for ${j.missing.map(d => format(parseISO(d), 'EEE d MMM')).join(', ')}.`);
    } catch (e: any) { setError(errText(e)); }
    setBusy(null);
  }, [tripId, key]);

  const load = useCallback(async (replan = false) => {
    if (t) return loadT(replan);
    setError(null); setBusy('Loading…');
    try {
      let r = replan ? undefined : (await fetchMultiRuns(tripId)).find(x => runTripDates(x).join(',') === key);
      if (!r) {
        setBusy(`Planning ${tripDates.length} days together… (about 10 seconds)`);
        const id = await planDays(tripId, tripDates);
        r = (await fetchMultiRuns(tripId, 10)).find(x => x.id === id);
      }
      setRun(r ?? null); setPlans(r ? await fetchPlans(r.id) : []);
    } catch (e: any) { setError(errText(e)); }
    setBusy(null);
  }, [tripId, key, t, loadT]);

  useEffect(() => { usesT(tripId).then(setT).catch(() => setT(false)); }, [tripId]);
  useEffect(() => { if (t !== null) load(); }, [key, t]);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.modeRow}>
        <Text style={[styles.hint, { flex: 1, paddingHorizontal: spacing.sm }]}>
          {t ? "T's plan for each day: the forecast plan where there is one, else the week draft."
             : 'A subject counts once, on its best day, with 6 h between back at night and out again.'}
        </Text>
        <TouchableOpacity onPress={() => load(true)} style={styles.replan} disabled={!!busy} accessibilityLabel="Plan again">
          <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          <Text style={styles.replanText}>Plan again</Text>
        </TouchableOpacity>
      </View>
      {busy ? <Busy text={busy} /> : error ? <Text style={styles.error}>{error}</Text> : (
        <>
          {run ? <Text style={styles.hint}>Planned {ago(run.created_at)}{note ? `\n${note}` : ''}</Text> : note ? <Text style={styles.hint}>{note}</Text> : null}
          <PlanBody tripId={tripId} run={run} plans={plans} byDay />
        </>
      )}
    </View>
  );
}

// Plan chips, summary and visits; "Use this plan…" opens the apply preview.
export function PlanBody({ tripId, run, plans, byDay, initialRank, onRank }: {
  tripId: string; run: PlanRun | null; plans: Plan[]; byDay?: boolean; initialRank?: number; onRank?: (rank: number) => void;
}) {
  const openStop = useOpenStop();
  const tierOf = useTierOf(tripId);
  const mine = plans.find(p => p.rank === 0), bestPlan = plans.find(p => p.rank === 1);
  // One scale everywhere: the good shots of the big subjects (GOD + S) each plan expects.
  const big = (p: Plan | undefined) => expShots(p, tierOf), rest = (p: Plan | undefined) => expShots(p, tierOf, false);
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
    try { setApply((await applyPreview(run.id, plan.rank)).result); } catch (e: any) { setError(errText(e)); }
    setBusy(false);
  };

  let lastDay: string | null = null;
  return (
    <View style={{ gap: spacing.sm }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {plans.map(p => (
          <TouchableOpacity key={p.rank} onPress={() => choose(p.rank)} style={[styles.chip, sel === p.rank && styles.chipOn]}>
            <Text style={[styles.chipText, sel === p.rank && styles.chipTextOn]}>
              {planTitle(p)} <Text style={sel === p.rank ? styles.chipPctOn : styles.chipPct}>{shotsText(big(p))}</Text>
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {plan ? (
        <>
          <Text style={styles.summary}>
            Good shots expected: <Text style={styles.bold}>{shotsText(big(plan))}</Text> of big subjects
            {rest(plan) >= 0.05 ? <>{', '}<Text style={styles.bold}>{shotsText(rest(plan))}</Text> of the others</> : null}
            {plan.drive_minutes != null ? `  ·  ${plan.drive_minutes} min driving` : ''}
            {plan.long_leg_minutes ? ` (${plan.long_leg_minutes} min over an hour)` : ''}
          </Text>
          {mine && bestPlan && plan.rank !== 0 && shotsText(big(mine)) !== shotsText(big(plan)) ? (
            <Text style={styles.hint}>
              Your day {shotsText(big(mine))} → {planTitle(plan).toLowerCase()} {shotsText(big(plan))}
              {big(plan) < big(mine) ? ". T's day is lower here because it saves a big subject for a better day of the week." : ''}
            </Text>
          ) : null}
          {(plan.rank === 0 ? plan.visits : joinRepeats(plan.visits)).map((v, i) => {
            const d = v.trip_date ?? v.date;
            const head = byDay && d !== lastDay ? (lastDay = d) : null;
            return (
              <View key={`${v.stop_id}-${i}`}>
                {head ? <Text style={[styles.label, { marginTop: spacing.md }]}>{format(parseISO(head), 'EEE d MMM').toUpperCase()}</Text> : null}
                <VisitRow v={v} tz={tz} mine={plan.rank === 0} run={run} dayFirst={i === 0 || !!head} onPress={() => openStop(v.stop_id)} />
              </View>
            );
          })}
          {plan.rank !== 0 ? (
            <TouchableOpacity style={styles.applyBtn} onPress={openApply} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.applyText}>Use this plan…</Text>}
            </TouchableOpacity>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>
            {isLightOnly(run) ? 'No forecast reaches this day yet: chances are for typical weather on this date, with its real sun.'
              : `Good bet = a good shot in at least half of T's ${forecastCount(run) ?? 6} forecasts; Long shot = in some; Skip = in none.`}
          </Text>
        </>
      ) : <Text style={styles.hint}>No plan.</Text>}
      <ApplySheet apply={apply} onClose={() => setApply(null)} tripId={tripId} run={run} plan={plan} mine={mine} />
    </View>
  );
}

// What applying a plan would change, its score against your day, and (test trips) Accept all.
export function ApplySheet({ apply, onClose, tripId, run, plan, mine, onAccepted }: {
  apply: any | null; onClose: () => void; tripId?: string; run?: PlanRun | null; plan?: Plan; mine?: Plan;
  onAccepted?: (result: any) => void;
}) {
  const insets = useSafeAreaInsets();   // the sheet's buttons stay above Android's Home / Back buttons
  const { currentTripData, loadTrip } = useTripStore();
  const [busy, setBusy] = useState(false);
  const tierOf = useTierOf(tripId);
  const mineS = mine ? expShots(mine, tierOf) : null, planS = plan ? expShots(plan, tierOf) : null;
  const pOf = (p: Plan | undefined, name: string) => p?.visits.find(v => v.name === name)?.p_good;
  const wasLabel = (date: string, name: string) => {
    const d = currentTripData?.days.find((x: any) => x.date === date);
    return (d?.stops ?? []).find((x: any) => x.name === name)?.time_label ?? null;
  };
  // Accepting a single day pulls stops off other days (Phil, 3 Nov 2026): accept happens for the
  // rest of the trip at once, from the day card on the trip page. This sheet only previews.
  const writable = false;
  const testTrip = !!tripId && canApply(tripId);
  const accept = async () => {
    if (!run || !plan || !tripId) return;
    setBusy(true);
    try {
      const j = await applyPlan(run.id, plan.rank);
      if (j.preview_only) throw new Error('This trip is preview only.');
      await loadTrip(tripId);
      forgetTiers();
      forgetWeek(tripId);
      onClose();
      onAccepted?.(j.result);
      Alert.alert('Plan accepted', acceptedText(j.result));
    } catch (e: any) { Alert.alert('Not applied', errText(e)); }
    setBusy(false);
  };
  return (
    <Modal visible={!!apply} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBg}>
        <View style={[styles.sheet, { paddingBottom: spacing.xxl + insets.bottom }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>What would change</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {plan && planS != null ? (
            <View style={{ gap: 4 }}>
              <ShotsText mine={mineS} best={planS} style={styles.sheetPct} />
              <Text style={styles.hint}>
                Good shots of big subjects expected{mineS != null ? `: your day ${shotsText(mineS)} → ${planTitle(plan)} ${shotsText(planS)}` : `: ${shotsText(planS)}`}
              </Text>
            </View>
          ) : null}
          <Text style={styles.hint}>
            {testTrip ? "Preview of this day only. To accept, tap the T card's changes line on the trip page: it applies T's plan for the rest of the trip at once (past days don't change)."
              : 'Preview only on real trips: nothing is moved until the solver is signed off.'}
            {apply?.stops_changed != null ? ` ${apply.stops_changed} stops would change.` : ''}
          </Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {(apply?.days ?? []).map((d: any) => (
              <View key={d.date} style={{ marginTop: spacing.md }}>
                <Text style={styles.label}>DAY {d.day_number} · {format(parseISO(d.date), 'EEE d MMM')}</Text>
                {d.stops.map((s: any) => {
                  const was = s.retimed && !s.moved_from ? wasLabel(d.date, s.name) : null;
                  const a = pOf(mine, s.name), b = pOf(plan, s.name);
                  return (
                    <View key={`${d.date}-${s.position}`} style={styles.applyRow}>
                      <Text style={[styles.applyTime, (s.retimed || s.moved_from) && styles.applyTimeNew]}>{s.time_label ?? ''}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.applyName, s.planned && styles.bold]} numberOfLines={1}>{s.name}</Text>
                        {was || (a != null && b != null && verdictOf(a) !== verdictOf(b)) || (a == null && b != null) ? (
                          <Text style={styles.applySub}>
                            {was ? `was ${was}` : ''}{was && b != null ? ' · ' : ''}
                            {a != null && b != null && verdictOf(a) !== verdictOf(b) ? `${VERDICT_TEXT[verdictOf(a)]} → ${VERDICT_TEXT[verdictOf(b)]}`
                              : b != null ? `${VERDICT_TEXT[verdictOf(b)]} (${countText({ p_good: b }, run).replace(/ forecasts$/, '')})` : ''}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.applyTag}>
                        {s.moved_from ? `from ${format(parseISO(s.moved_from), 'd MMM')}` : s.kind === 'new' ? 'added' : s.retimed ? 'new time' : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
            {apply?.set_aside?.length ? (
              <Text style={[styles.hint, { marginTop: spacing.md }]}>
                Set aside (another visit of the same place): {apply.set_aside.map((x: any) => x.name).join(', ')}
              </Text>
            ) : null}
            {apply?.clashes?.length ? (
              <Text style={[styles.hint, { marginTop: spacing.sm, color: colors.signalWarning }]}>
                Tight: {apply.clashes.map((x: any) => `${x.name} runs ${x.late_min} min into ${x.next_name}`).join('; ')}
              </Text>
            ) : null}
          </ScrollView>
          {writable ? (
            <TouchableOpacity style={styles.applyBtn} onPress={accept} disabled={busy} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.textInverse} />
                : <Text style={styles.applyText}>Accept all{mineS != null && planS != null ? ` · ${shotsText(mineS)} → ${shotsText(planS)} good shots` : ''}</Text>}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// "Day 2 updated · 4 stops moved" from solver_apply_plan's result.
export function acceptedText(r: any): string {
  const days = (r?.days ?? []).map((d: any) => `Day ${d.day_number}`).join(', ');
  const n = r?.stops_changed ?? 0;
  const aside = (r?.set_aside ?? []).map((x: any) => x.name);
  return `${days || 'Trip'} updated · ${n} stop${n === 1 ? '' : 's'} changed`
    + (aside.length ? `\nSet aside: ${aside.join(', ')}` : '')
    + (r?.clashes?.length ? `\nCheck: ${r.clashes.length} tight connection${r.clashes.length === 1 ? '' : 's'}` : '');
}

export function VisitRow({ v, tz, mine, onPress, index, run, dayFirst }: { v: PlanVisit; tz?: string; mine: boolean; onPress: () => void; index?: number; run?: PlanRun | null; dayFirst?: boolean }) {
  const vd = v.p_good != null ? verdictOf(v.p_good) : null;
  const light = v.light ? LIGHT_WORDS[v.light] ?? v.light : null;
  const muted = mine && !v.rated;
  return (
    <TouchableOpacity style={styles.visit} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.visitTime, muted && styles.muted]}>{index != null ? `${index} · ` : ''}{clock12(v.start, tz).replace(' AM', 'a').replace(' PM', 'p')}</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.visitName, muted && styles.muted]} numberOfLines={2}>{v.name}</Text>
          {v.booked ? <Text style={styles.booked}>BOOKED</Text> : null}
        </View>
        {v.done ? (
          <Text style={styles.visitMeta}>Done · this time has passed</Text>
        ) : vd ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.verdict, { color: VERDICT_COLOR[vd], borderColor: VERDICT_COLOR[vd] }]}>{VERDICT_TEXT[vd]}</Text>
            <Text style={styles.visitMeta} numberOfLines={1}>
              {countText(v, run)}{light ? ` · ${light}` : ''}{v.peak_at && v.peak_at !== v.start ? ` · best at ${clock12(v.peak_at, tz)}` : ''}
            </Text>
          </View>
        ) : null}
        {(v as any).move_why ? <Text style={styles.visitSub}>{(v as any).move_why}</Text> : null}
        {!mine && dayFirst && v.start ? (
          // The day's first stop: no "wait" (a note like "sleep in till 9" made the planner arrive early and wait 169 min,
          // 12 Nov 2026); say when to leave instead: the start less the drive.
          <Text style={styles.visitSub}>
            {v.drive_min ? `${v.drive_min} min drive · ` : ''}leave {clock12(new Date(new Date(v.start).getTime() - (v.drive_min ?? 0) * 60000).toISOString(), tz)}
          </Text>
        ) : !mine && (v.wait_min || v.drive_min) ? (
          <Text style={styles.visitSub}>
            {v.drive_min ? `${v.drive_min} min drive` : ''}{v.drive_min && v.wait_min ? ' · ' : ''}{v.wait_min ? `${v.wait_min} min wait` : ''}
          </Text>
        ) : null}
        {mine && !v.done && v.best && verdictOf(v.best.p_good) !== vd && v.best.p_good > (v.p_good ?? 0) ? (
          <Text style={styles.hintChip}>Better at {clock12(v.best.start, tz)}: {VERDICT_TEXT[verdictOf(v.best.p_good)]}</Text>
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
  nowBtn: { backgroundColor: colors.surface, borderRadius: radius.sm },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  hint: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
  error: { fontSize: 13, color: '#e74c3c' },
  warn: { fontSize: 12, color: colors.textPrimary, borderLeftWidth: 2, borderLeftColor: colors.textPrimary, paddingLeft: 8 },
  chips: { gap: 6, paddingVertical: spacing.xs },
  chip: { minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse, fontWeight: '700' },
  chipPct: { color: colors.signalOk, fontWeight: '700' },
  chipPctOn: { color: colors.textInverse, fontWeight: '800' },
  sheetPct: { fontFamily: 'Georgia', fontSize: 26, color: colors.textPrimary },
  applySub: { fontSize: 11, color: colors.textTertiary },
  applyTimeNew: { color: colors.signalOk, fontWeight: '700' },
  summary: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  bold: { fontWeight: '700', color: colors.textPrimary },
  visit: {
    flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  visitTime: { width: 52, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  visitName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  muted: { color: colors.textTertiary, fontWeight: '400' },
  booked: { fontSize: 9, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  verdict: { fontSize: 11, fontWeight: '800', borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
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
