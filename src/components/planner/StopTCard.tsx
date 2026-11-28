import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius } from '../../theme';
import {
  CurveSlot, LIGHT_CHOICES, LIGHT_WORDS, Light, ShotStatus, StopSettings, StopShot, TIER_CHOICES, clock12, fetchStopCurve,
  fetchStopSettings, labelMinutes, markShot, minutesLabel, saveStopSettings, tzMinutes,
} from '../../services/planner';
import { VERDICT_TEXT, Verdict, countText, verdictOf } from '../../services/plannerWords';
import { mineVisit, placements, samePlace } from '../../services/plannerWeek';
import { TCurve, bestWindow, useTCurves } from '../../services/tCurve';
import { replanFromNow } from '../../services/replanFromNow';
import { failReplanNow, useReplanNow } from '../../services/replanNowStore';
import { useTripStore } from '../../store/tripStore';
import { errText } from '../../utils/errText';
import { DayPlanner, forgetTiers } from './DayPlannerHints';
import { MiniCurve, TDayChart } from './TChart';

// The stop page's T card, planner look round 2 (Phil, 28 Nov 2026: OK'd https://claude.ai/artifact/5o13SQdCPoAyhJzDwwez9P
// after calling the first option 3 build ugly, too big, settings never folded, a flat chart). One thing first: the best
// time on this day; then your time in one line; T's own curve for the day (RPC t_stop_curve); small day cards with their
// own curves; the settings folded into one summary line that opens.

const AMBER = '#e0b34a';
const VCOLOR: Record<Verdict, string> = { good: colors.signalOk, long: AMBER, skip: '#8a8a8a' };
const SHORT: Record<Verdict, string> = { good: 'Good', long: 'Long shot', skip: 'Skip' };

export default function StopTCard({ stopId, planner, tripId, tripDate, days, timeLabel, tz: tripTz }: {
  stopId: string; planner: DayPlanner | null; tripId: string | null; tripDate: string | null; days: any[];
  timeLabel: string | null; tz?: string;
}) {
  const navigation = useNavigation<any>();
  const tz: string | undefined = planner?.run?.params?.tz ?? tripTz;
  const week = planner?.week ?? null;
  const run = planner?.run ?? null;
  const dates = useMemo(() => days.filter((d: any) => d.date).map((d: any) => d.date as string), [days]);
  const curves = useTCurves(stopId, dates);
  const got = tripDate ? curves.get(tripDate) : undefined;
  const curve: TCurve | undefined = got === false ? undefined : got;
  // Past the forecast: the old light-only curve, drawn dotted (typical light).
  const [typical, setTypical] = useState<CurveSlot[] | null>(null);
  useEffect(() => {
    setTypical(null);
    if (!tripDate || curve !== null) return;
    let alive = true;
    fetchStopCurve(stopId, tripDate).then(c => { if (alive) setTypical(c.slots); }).catch(() => {});
    return () => { alive = false; };
  }, [stopId, tripDate, curve === null]);

  const mineV = planner?.mine?.visits.find(v => samePlace(week, v.stop_id, stopId) && v.rated !== false && v.p_good != null)
    ?? (tripDate ? mineVisit(week, stopId, tripDate) : null);
  const bestV = planner?.best?.visits.find(v => samePlace(week, v.stop_id, stopId) && v.p_good != null) ?? null;
  const pillV = bestV ?? mineV;
  const pill = pillV ? verdictOf(pillV.p_good) : null;
  const slots = curve?.slots ?? null;
  const win = slots ? bestWindow(slots) : null;
  const winText = win && slots ? `${clock12(slots[win[0]].t, tz)} – ${minutesLabel((tzMinutes(slots[win[1]].t, tz) ?? 0) + 15)}` : null;
  const youMin = labelMinutes(timeLabel);
  const vd = mineV ? verdictOf(mineV.p_good) : null;
  const light = mineV?.light ? LIGHT_WORDS[mineV.light] ?? mineV.light : null;
  const bestDay = placements(week, stopId)[0]?.date ?? null;
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  return (
    <View style={st.card}>
      <View style={st.hd}>
        <Text style={st.lbl}>T · {tripDate ? format(parseISO(tripDate), 'EEE d MMM').toUpperCase() : 'THIS STOP'}</Text>
        {pill ? <Text style={[st.pill, pill === 'good' ? st.pillOk : { color: VCOLOR[pill], borderColor: VCOLOR[pill] }]}>{VERDICT_TEXT[pill]}</Text> : null}
      </View>
      {!tripDate ? <Text style={st.yours}>This stop isn't on a dated day.</Text> : (
        <>
          <View style={st.best}>
            {winText ? (
              <>
                <Text style={st.w} accessibilityLabel={`Best time ${winText}`}>{winText}</Text>
                <Text style={st.q}>best light, {slots![win![0]].good} of {slots![win![0]].of} models</Text>
              </>
            ) : curve === null ? <Text style={st.q}>Typical light only: no forecast for this day yet.</Text>
              : got === false ? <Text style={st.q}>No signal: T's chances show once it can read them.</Text>
              : curve === undefined ? <Text style={st.q}>Loading T's chances…</Text>
              : <Text style={st.q}>No good light or weather at any time this day.</Text>}
          </View>
          {timeLabel ? (
            <Text style={st.yours} numberOfLines={2}>
              At your {timeLabel}: <Text style={st.yoursB}>{vd ? VERDICT_TEXT[vd].toLowerCase() : 'not scored yet'}</Text>
              {mineV ? ` · ${light ?? countText(mineV, run).replace(/ forecasts$/, '')}` : ''}
            </Text>
          ) : null}
          <View style={st.chart}>
            <TDayChart slots={slots} typical={typical ? typical.map(s => ({ t: s.slot_at, pct: Math.round(s.p_good * 100) })) : null}
              tz={tz} youMin={youMin} youLabel={youMin != null ? minutesLabel(youMin).replace(' AM', '').replace(' PM', '') : null} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.days} accessibilityLabel="T's verdict for this stop on each day">
            {days.filter((d: any) => d.date).map((d: any) => {
              const td = week?.byDate.get(d.date);
              const tv = td?.best?.visits.find(v => samePlace(week, v.stop_id, stopId) && v.p_good != null) ?? null;
              const v = tv ?? (d.date === tripDate ? mineVisit(week, stopId, d.date) : null);
              const k = v ? verdictOf(v.p_good) : null;
              const cg = curves.get(d.date);
              const c = cg === false ? undefined : cg;
              const pick = d.date === bestDay;
              const here = d.date === tripDate;
              return (
                <TouchableOpacity key={d.id} style={[st.dy, pick && st.dyPick, here && !pick && st.dyHere]} activeOpacity={0.8}
                  onPressIn={e => { pressAt.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; }}
                  onPress={e => {
                    // a swipe that ended on a card is not a tap (emulator run 186: a page swipe opened Sunday)
                    const p = pressAt.current;
                    if (p && (Math.abs(e.nativeEvent.pageX - p.x) > 10 || Math.abs(e.nativeEvent.pageY - p.y) > 10)) return;
                    if (tripId) (navigation as any).popTo('Trip', { tripId, date: d.date });
                  }}
                  accessibilityRole="button" accessibilityLabel={`${format(parseISO(d.date), 'EEEE d MMM')}: ${k ? VERDICT_TEXT[k] : c === null ? 'typical light' : "not in T's plan"}${pick ? ', best day' : ''}. Open that day`}>
                  <Text style={[st.dyA, here && { color: colors.textPrimary }]}>{format(parseISO(d.date), 'EEE d')}</Text>
                  <Text style={[st.dyV, { color: k ? VCOLOR[k] : '#666666' }]} numberOfLines={1}>{k ? SHORT[k] : c === null ? 'typical' : '–'}</Text>
                  <MiniCurve values={c ? c.slots.map(x => x.pct) : null} width={58} height={16} dim={!k || k === 'skip'} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}
      <SettingsFold stopId={stopId} tripId={tripId} />
    </View>
  );
}

// One summary line that opens into segmented rows. Every change is saved as Phil's own setting and T re-plans by itself
// 4 s after the last tap (one request for several taps).
function SettingsFold({ stopId, tripId }: { stopId: string; tripId: string | null }) {
  const [open, setOpen] = useState(false);
  const [setting, setSetting] = useState<StopSettings | null>(null);
  const [shots, setShots] = useState<StopShot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const { currentTripData } = useTripStore();
  const nowRun = useReplanNow(tripId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { fetchStopSettings(stopId).then(r => { setSetting(r.setting); setShots(r.shots); }).catch(() => {}); }, [stopId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const replanSoon = () => {
    if (!tripId) return;
    setChanged(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      replanFromNow(tripId, currentTripData?.trip?.title).then(() => setChanged(false)).catch((e: any) => failReplanNow(tripId, errText(e)));
    }, 4000);
  };
  const run = async (fn: () => Promise<StopSettings | null>) => {
    setSaving(true); setError(null);
    try { const s = await fn(); forgetTiers(); if (s) setSetting(s); replanSoon(); }
    catch (e: any) { setError(/network|fetch/i.test(String(e?.message)) ? 'No connection. Try again when you have signal.' : String(e?.message ?? e)); }
    setSaving(false);
  };
  const save = (patch: Parameters<typeof saveStopSettings>[1]) => run(() => saveStopSettings(stopId, patch));
  const status = setting?.shot_status ?? null;
  const tier = setting?.tier ?? null;
  const lights = setting?.light_wanted ?? [];
  const star = shots.find(x => x.vantage_id === setting?.star_vantage_id) ?? null;
  const lightWords = LIGHT_CHOICES.filter(c => lights.includes(c.key)).map(c => c.text);
  const summary = [tier ?? 'Not rated', lightWords.length ? lightWords.join(', ') : null, star ? `★ ${star.name}` : null].filter(Boolean).join(' · ');
  const statusText = status === 'nailed' ? 'Nailed it' : status === 'got' ? 'Go back for better' : 'Not shot yet';
  const toggleLight = (l: Light) => {
    const next = lights.includes(l) ? lights.filter(x => x !== l) : [...lights, l];
    save({ light_wanted: LIGHT_CHOICES.map(c => c.key).filter(k => next.includes(k)) });
  };
  const chooseShot = (s: ShotStatus) => {
    if (s === status) return;
    run(async () => { await markShot(stopId, s); return setting ? { ...setting, shot_status: s } : null; });
  };
  if (!open) {
    return (
      <TouchableOpacity style={st.set} onPress={() => setOpen(true)} activeOpacity={0.8} accessibilityRole="button"
        accessibilityLabel={`Stop settings: ${summary}. ${statusText}. Open the settings`}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.sum} numberOfLines={1}>{setting ? summary : 'Settings'}</Text>
          <Text style={st.sumSub}>{changed || nowRun.phase === 'running' ? 'Saved · T is re-planning' : statusText}</Text>
        </View>
        <Text style={st.chev}>⌄</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={st.setx}>
      <Row k="SHOT">
        <Seg items={[{ k: null as ShotStatus, t: 'Not yet' }, { k: 'got' as ShotStatus, t: 'Go back' }, { k: 'nailed' as ShotStatus, t: 'Nailed' }]}
          on={x => x === status} label={x => (x === 'got' ? 'Go back for better' : x === 'nailed' ? 'Nailed it' : 'Missed it')}
          onPress={chooseShot} disabled={saving} />
      </Row>
      <Row k="TIER">
        <Seg items={TIER_CHOICES.map(t => ({ k: t, t }))} on={x => x === tier} label={x => `Tier ${x}`}
          onPress={x => save({ tier: tier === x ? null : x })} disabled={saving} />
      </Row>
      <Row k="LIGHT">
        <View style={st.tg}>
          {LIGHT_CHOICES.map(l => <Tog key={l.key} t={l.text} on={lights.includes(l.key)} onPress={() => toggleLight(l.key)} disabled={saving} />)}
          <Tog t="Fog is good" on={!!setting?.fog_wanted} onPress={() => save({ fog_wanted: !setting?.fog_wanted })} disabled={saving} />
          <Tog t="Fine under cloud" on={setting?.needs_peaks === false} onPress={() => save({ needs_peaks: setting?.needs_peaks === false })} disabled={saving} />
        </View>
      </Row>
      {shots.length ? (
        <Row k="★ SHOT">
          <View style={st.tg}>
            {shots.map(x => (
              <Tog key={x.vantage_id} t={`${x.vantage_id === setting?.star_vantage_id ? '★ ' : ''}${x.name}`} on={x.vantage_id === setting?.star_vantage_id}
                onPress={() => x.vantage_id !== setting?.star_vantage_id && save({ star_vantage_id: x.vantage_id })} disabled={saving} />
            ))}
          </View>
        </Row>
      ) : null}
      {error ? <Text style={st.err}>{error}</Text> : null}
      <TouchableOpacity style={st.close} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close the stop settings">
        <Text style={[st.sumSub, { flex: 1 }]}>{changed || nowRun.phase === 'running' ? 'Saved · T is re-planning with it.' : 'T re-plans on its own a few seconds after a change.'}</Text>
        <Text style={st.chev}>⌃</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <View style={st.srow}><Text style={st.k}>{k}</Text>{children}</View>;
}
function Seg<T>({ items, on, label, onPress, disabled }: {
  items: { k: T; t: string }[]; on: (k: T) => boolean; label: (k: T) => string; onPress: (k: T) => void; disabled?: boolean;
}) {
  return (
    <View style={st.seg}>
      {items.map((x, i) => (
        <TouchableOpacity key={String(x.k ?? 'none')} style={[st.segI, i === items.length - 1 && { borderRightWidth: 0 }, on(x.k) && st.segOn]}
          onPress={() => onPress(x.k)} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on(x.k) }} accessibilityLabel={label(x.k)}>
          <Text style={[st.segT, on(x.k) && st.segTOn]} numberOfLines={1}>{x.t}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
function Tog({ t, on, onPress, disabled }: { t: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[st.tog, on && st.togOn]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t}>
      <Text style={[st.togT, on && st.togTOn]} numberOfLines={1}>{t}</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: spacing.xl, marginBottom: spacing.lg, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#262626', overflow: 'hidden' },
  hd: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 11 },
  lbl: { fontSize: 10, letterSpacing: 1.3, color: '#8a8a8a', fontWeight: '800' },
  pill: { fontSize: 11, fontWeight: '800', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, overflow: 'hidden' },
  pillOk: { color: '#0c1a11', backgroundColor: colors.signalOk, borderColor: colors.signalOk },
  best: { paddingHorizontal: 12, paddingTop: 6 },
  w: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  q: { fontSize: 12, color: '#8a8a8a', marginTop: 1 },
  yours: { paddingHorizontal: 12, paddingTop: 3, fontSize: 11.5, color: '#8a8a8a' },
  yoursB: { color: '#dddddd', fontWeight: '600' },
  chart: { paddingHorizontal: 6, paddingTop: 6 },
  days: { gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  dy: { width: 70, borderRadius: 10, borderWidth: 1, borderColor: '#262626', paddingHorizontal: 6, paddingTop: 6, paddingBottom: 5, backgroundColor: '#171717' },
  dyPick: { borderColor: colors.signalOk, backgroundColor: '#0f1913' },
  dyHere: { borderColor: '#555555' },
  dyA: { fontSize: 10, color: '#8a8a8a', fontWeight: '700' },
  dyV: { fontSize: 11, fontWeight: '800', marginTop: 1, marginBottom: 4 },
  set: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#262626', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sum: { fontSize: 12, color: '#dddddd', lineHeight: 18 },
  sumSub: { fontSize: 12, color: '#8a8a8a', lineHeight: 18 },
  chev: { color: '#8a8a8a', fontSize: 16 },
  setx: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#262626', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 9 },
  srow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  k: { width: 46, fontSize: 10, color: '#8a8a8a', fontWeight: '800', letterSpacing: 0.8 },
  seg: { flex: 1, flexDirection: 'row', borderWidth: 1, borderColor: '#333333', borderRadius: 9, overflow: 'hidden' },
  segI: { flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#2a2a2a' },
  segOn: { backgroundColor: colors.textPrimary },
  segT: { fontSize: 11, color: '#bbbbbb' },
  segTOn: { color: '#000000', fontWeight: '800' },
  tg: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tog: { borderWidth: 1, borderColor: '#333333', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, minHeight: 30, justifyContent: 'center' },
  togOn: { borderColor: colors.textPrimary },
  togT: { fontSize: 11, color: '#bbbbbb' },
  togTOn: { color: colors.textPrimary, fontWeight: '700' },
  err: { fontSize: 12, color: '#e74c3c' },
  close: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
});
