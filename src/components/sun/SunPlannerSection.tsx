import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, PanResponder, LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';
import { SunStop, SUN_PLANNER_ENABLED, useSunStopState } from '../../services/sunPlan';
import SunPairEditor from './SunPairEditor';
import {
  dayEvents, dayStartMs, fmtMinute, lightAt, moonPosition, parseTimeLabel,
} from '../../utils/sunEngine';
import SunMapPanel from './SunMapPanel';
import SunHorizonPanel from './SunHorizonPanel';
import VantagePhoto from './VantagePhoto';
import FullScreenPhotoViewer from '../FullScreenPhotoViewer';
import type { Pair } from '../../utils/sunEngine';
import { LABELS, PHASE_COLORS, compassPoint, shortName } from './sunStyle';

// Sun & Moon for one stop, under Weather. A stop with no vantage -> subject
// pairs shows only a small "add" button. Hidden entirely when the planner is
// switched off, or if anything in it throws: the rest of the stop screen is
// never affected.

type Props = {
  tripId: string | null | undefined; stopId: string; timeLabel?: string | null; stopName?: string | null;
  stopPhotos?: any[];   // the stop's photos, to pick vantage reference photos from
  stopCoords?: { lat: number; lng: number } | null;   // the stop's main location, where the vantage map opens
};

export default function SunPlannerSection(props: Props) {
  if (!SUN_PLANNER_ENABLED) return null;
  return (
    <SectionGuard>
      <SunPlannerInner {...props} />
    </SectionGuard>
  );
}

class SectionGuard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: any) { console.warn('[sun] section hidden after an error:', e); }
  render() { return this.state.failed ? null : this.props.children; }
}

function SunPlannerInner({ tripId, stopId, timeLabel, stopName, stopPhotos, stopCoords }: Props) {
  const { stop, ready } = useSunStopState(tripId, stopId);
  const [editing, setEditing] = useState(false);
  const [editVantageId, setEditVantageId] = useState<string | null>(null);
  if (!tripId) return null;
  const openEditor = (vantageId?: string | null) => { setEditVantageId(vantageId ?? null); setEditing(true); };
  const editor = (
    <SunPairEditor
      visible={editing} onClose={() => setEditing(false)} tripId={tripId} stopId={stopId} stopName={stopName}
      stopPhotos={stopPhotos} editVantageId={editVantageId} stopCoords={stopCoords}
    />
  );
  if (!stop) {
    if (!ready) return null;
    return (
      <>
        <TouchableOpacity style={styles.addBtn} onPress={() => openEditor()} accessibilityRole="button">
          <Text style={styles.addBtnText}>＋ Add Sun &amp; Moon vantage</Text>
        </TouchableOpacity>
        {editor}
      </>
    );
  }
  return (
    <>
      <Planner stop={stop} timeLabel={timeLabel} onEdit={openEditor} />
      {editor}
    </>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Tab = 'map' | 'horizon' | 'photo';
const TAB_NAMES: Record<Tab, string> = { map: 'Map', horizon: 'Horizon', photo: 'Photo' };

function Planner({ stop, timeLabel, onEdit }: { stop: SunStop; timeLabel?: string | null; onEdit: (vantageId?: string | null) => void }) {
  const stopMinute = parseTimeLabel(timeLabel);
  const day0 = dayStartMs(stop.date, stop.utc_offset_min);
  const [pairIdx, setPairIdx] = useState(0);
  const [tab, setTab] = useState<Tab>('map');
  const [viewing, setViewing] = useState<Pair | null>(null);
  const pair = stop.pairs[Math.min(pairIdx, stop.pairs.length - 1)];
  const openPhoto = (p: Pair) => { if (p.photo_id) setViewing(p); };

  const events = useMemo(() => dayEvents(pair.v, day0), [pair.v.lat, pair.v.lng, day0]);
  const home = stopMinute ?? events.goldenPm ?? 720;
  const [minute, setMinute] = useState(home);
  useEffect(() => { setMinute(home); }, [stop.date, home]);

  const ms = day0 + minute * 60000;
  const light = lightAt(pair, ms);
  const moon = moonPosition(ms, pair.v.lat, pair.v.lng);
  const lab = LABELS[light.label];
  const showAngle = light.delta != null && (light.label === 'front' || light.label === 'side' || light.label === 'backlit');
  const [, mo, d] = stop.date.split('-').map(Number);

  return (
    <View style={styles.section}>
      <View style={styles.headRow}>
        <Text style={styles.title}>SUN &amp; MOON</Text>
        <Text style={styles.date}>{MONTHS[mo - 1]} {d}</Text>
        <Text style={styles.moonPct}>· moon {Math.round(moon.illum * 100)}%</Text>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['map', 'horizon', 'photo'] as const).map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{TAB_NAMES[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.readout}>
        <View style={[styles.chip, { backgroundColor: lab.bg }]}>
          <Text style={[styles.chipText, { color: lab.fg }]}>{lab.text}</Text>
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {lab.detail}{showAngle ? ` · ${Math.round(light.delta!)}°` : ''}
        </Text>
        <Text style={styles.facing}>
          {pair.bearing != null ? `facing ${compassPoint(pair.bearing)} · ` : ''}{(pair.dist_m / 1000).toFixed(1)} km
        </Text>
      </View>

      {tab === 'map' ? (
        <SunMapPanel pair={pair} light={light} moon={moon} riseAz={events.riseAz} setAz={events.setAz} height={208} />
      ) : tab === 'horizon' ? (
        <SunHorizonPanel pair={pair} day0={day0} light={light} moon={moon} />
      ) : (
        <PhotoPanel pair={pair} onOpen={() => openPhoto(pair)} onAdd={() => onEdit(pair.vantage_id)} />
      )}

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{fmtMinute(minute)}</Text>
        {stopMinute != null && (minute === stopMinute ? (
          <View style={styles.stopBadge}><Text style={styles.stopBadgeText}>STOP</Text></View>
        ) : (
          <TouchableOpacity style={styles.stopBadge} onPress={() => setMinute(stopMinute)}>
            <Text style={styles.stopBadgeText}>BACK TO STOP</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.jumps}>
          {events.rise != null && (
            <TouchableOpacity onPress={() => setMinute(events.rise!)} style={styles.jump} accessibilityLabel="Jump to sunrise">
              <Text style={styles.jumpText}>↗ {fmtMinute(events.rise).replace(/ [AP]M$/, '')}</Text>
            </TouchableOpacity>
          )}
          {events.goldenPm != null && (
            <TouchableOpacity onPress={() => setMinute(events.goldenPm!)} style={styles.jump} accessibilityLabel="Jump to golden hour">
              <Text style={[styles.jumpText, { color: '#F0B04A' }]}>● {fmtMinute(events.goldenPm).replace(/ [AP]M$/, '')}</Text>
            </TouchableOpacity>
          )}
          {events.set != null && (
            <TouchableOpacity onPress={() => setMinute(events.set!)} style={styles.jump} accessibilityLabel="Jump to sunset">
              <Text style={styles.jumpText}>↘ {fmtMinute(events.set).replace(/ [AP]M$/, '')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <TimeScrubber minute={minute} onChange={setMinute} phases={events.phases} />

      {stop.pairs.length === 1 && (
        <View style={styles.onePair}>
          <PairThumb pair={pair} size={46} onOpen={() => openPhoto(pair)} />
          <Text style={[styles.onePairText, { flex: 1 }]} numberOfLines={2}>
            <Text style={styles.onePairStrong}>{pair.code ? `${pair.code} ` : ''}{shortName(pair.vantage_name)}</Text>
            <Text> → </Text>
            <Text style={styles.onePairStrong}>{shortName(pair.subject_name)}</Text>
          </Text>
        </View>
      )}
      {stop.pairs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {stop.pairs.map((p, i) => {
            const on = p === pair;
            return (
              <TouchableOpacity
                key={p.vantage_id}
                onPress={() => setPairIdx(i)}
                style={[styles.pairChip, on && styles.pairChipOn]}
                accessibilityState={{ selected: on }}
              >
                <PairThumb pair={p} size={34} />
                <View>
                  <Text style={[styles.pairCode, on && styles.pairTextOn]}>{p.code || shortName(p.vantage_name)}</Text>
                  <Text style={[styles.pairTo, on && styles.pairTextOn]} numberOfLines={1}>{shortName(p.subject_name)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <TouchableOpacity onPress={() => onEdit()} style={styles.editLink} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.editLinkText}>Edit vantages</Text>
      </TouchableOpacity>
      <FullScreenPhotoViewer
        photo={viewing ? { id: viewing.photo_id, storage_url: viewing.photo_url } : null}
        visible={!!viewing}
        onClose={() => setViewing(null)}
      />
    </View>
  );
}

function pairTitle(p: Pair): string {
  return `${p.code ? `${p.code} · ` : ''}${shortName(p.vantage_name)} → ${shortName(p.subject_name)}`;
}

// The vantage's reference photo. With onOpen, a tap opens it full screen; on
// the vantage chips it is only a picture, so a tap just selects the chip.
// No photo: a plain dark square with a faint camera, not a button.
function PairThumb({ pair, size, onOpen }: { pair: Pair; size: number; onOpen?: () => void }) {
  if (!pair.photo_id) {
    return (
      <View style={[styles.thumbEmpty, { width: size, height: size }]} accessibilityLabel="No reference photo">
        <Ionicons name="camera-outline" size={Math.round(size * 0.42)} color="#4a4a4a" />
      </View>
    );
  }
  const img = <VantagePhoto id={pair.photo_id} url={pair.photo_url} style={{ width: size, height: size, borderRadius: 6 }} />;
  if (!onOpen) return img;
  return (
    <TouchableOpacity onPress={onOpen} accessibilityLabel={`Open the reference photo for ${pairTitle(pair)}`}>
      {img}
    </TouchableOpacity>
  );
}

function PhotoPanel({ pair, onOpen, onAdd }: { pair: Pair; onOpen: () => void; onAdd: () => void }) {
  if (!pair.photo_id) {
    return (
      <View style={[styles.photoPanel, styles.photoEmpty]}>
        <Text style={styles.photoEmptyText}>No reference photo for {pair.code || shortName(pair.vantage_name)} yet.</Text>
        <TouchableOpacity onPress={onAdd} style={styles.photoAddBtn} accessibilityRole="button">
          <Text style={styles.photoAddText}>＋ Add a reference photo</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} accessibilityLabel={`Open the reference photo for ${pairTitle(pair)}`}>
      <VantagePhoto id={pair.photo_id} url={pair.photo_url} style={styles.photoPanel} resizeMode="contain" />
      <View style={styles.photoCap} pointerEvents="none">
        <Text style={styles.photoCapText} numberOfLines={1}>{pairTitle(pair)}</Text>
      </View>
      <View style={styles.photoFull} pointerEvents="none">
        <Text style={styles.photoCapText}>⤢</Text>
      </View>
    </TouchableOpacity>
  );
}

// A time-of-day slider over the day's night / blue / golden / day bands.
// Built on PanResponder so it needs no new native module.
function TimeScrubber({ minute, onChange, phases }: {
  minute: number;
  onChange: (m: number) => void;
  phases: { from: number; to: number; kind: keyof typeof PHASE_COLORS }[];
}) {
  const trackRef = useRef<View>(null);
  const geom = useRef({ x: 0, w: 1 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const measure = () => trackRef.current?.measureInWindow((x, _y, w) => { geom.current = { x, w: Math.max(1, w) }; });
  const setFromX = (pageX: number) => {
    const f = (pageX - geom.current.x) / geom.current.w;
    onChangeRef.current(Math.max(0, Math.min(1439, Math.round(f * 1439))));
  };

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { measure(); setFromX(e.nativeEvent.pageX); },
    onPanResponderMove: (e) => setFromX(e.nativeEvent.pageX),
  })).current;

  const onLayout = (_e: LayoutChangeEvent) => measure();
  const pct = (minute / 1439) * 100;

  return (
    <View
      ref={trackRef}
      style={styles.scrub}
      onLayout={onLayout}
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Time of day"
      accessibilityValue={{ text: fmtMinute(minute) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(1439, minute + 15));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(0, minute - 15));
      }}
    >
      <View style={styles.track}>
        {phases.map((p, i) => (
          <View
            key={i}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${(p.from / 1440) * 100}%`, width: `${((p.to - p.from) / 1440) * 100}%`, backgroundColor: PHASE_COLORS[p.kind] }}
          />
        ))}
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${pct}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.xl, marginBottom: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 10,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', rowGap: 6 },
  title: { ...typography.labelMedium, fontSize: 11, letterSpacing: 1.4 },
  date: { fontSize: 10, color: '#5aaa7a' },
  moonPct: { fontSize: 10, color: '#7FA7F5' },
  tabs: {
    marginLeft: 'auto', flexDirection: 'row', borderWidth: 1, borderColor: '#444444', borderRadius: 8, overflow: 'hidden',
  },
  tab: { minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: '#000000' },
  tabOn: { backgroundColor: '#ffffff' },
  tabText: { fontSize: 11, fontWeight: '600', color: '#ffffff' },
  tabTextOn: { color: '#000000' },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 26 },
  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  detail: { flexShrink: 1, fontSize: 12, color: '#aaaaaa' },
  facing: { marginLeft: 'auto', fontSize: 11, color: '#888888' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  stopBadge: { borderWidth: 1, borderColor: '#555555', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  stopBadgeText: { fontSize: 9, letterSpacing: 1, color: '#aaaaaa' },
  jumps: { marginLeft: 'auto', flexDirection: 'row', gap: 2 },
  jump: { minHeight: 28, paddingHorizontal: 5, justifyContent: 'center' },
  jumpText: { fontSize: 11, color: '#aaaaaa' },
  scrub: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#050505' },
  thumb: {
    position: 'absolute', top: 5, width: 18, height: 18, marginLeft: -9, borderRadius: 9,
    backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#000000',
  },
  chips: { gap: 6 },
  onePair: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#111111', paddingHorizontal: 8, paddingVertical: 8 },
  onePairText: { fontSize: 12, color: '#888888' },
  onePairStrong: { color: '#ffffff', fontWeight: '600' },
  editLink: { alignSelf: 'flex-end', paddingVertical: 2 },
  editLinkText: { fontSize: 12, color: '#888888', textDecorationLine: 'underline' },
  addBtn: {
    marginHorizontal: spacing.xl, marginBottom: spacing.lg, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: 8,
  },
  addBtnText: { fontSize: 12, fontWeight: '500', color: '#888888' },
  pairChip: {
    flexDirection: 'row', gap: 7, minHeight: 44, minWidth: 76, paddingLeft: 4, paddingRight: 9, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: '#111111', alignItems: 'center',
  },
  thumbEmpty: { borderRadius: 6, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  photoPanel: { height: 208, borderRadius: 8, backgroundColor: '#000000' },
  photoEmpty: { borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  photoEmptyText: { color: '#888888', fontSize: 12, textAlign: 'center' },
  photoAddBtn: { borderWidth: 1, borderColor: '#444444', borderStyle: 'dashed', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  photoAddText: { color: '#cccccc', fontSize: 12, fontWeight: '600' },
  photoCap: { position: 'absolute', left: 8, bottom: 8, maxWidth: '80%', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  photoFull: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  photoCapText: { color: '#ffffff', fontSize: 11 },
  pairChipOn: { backgroundColor: '#ffffff' },
  pairCode: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
  pairTo: { fontSize: 11, color: '#ffffff', maxWidth: 110 },
  pairTextOn: { color: '#000000' },
});

