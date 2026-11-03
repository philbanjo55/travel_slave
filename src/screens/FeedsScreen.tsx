import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl, ActivityIndicator, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { solverAction, ago } from '../services/planner';
import { useLive } from '../components/planner/CameraView';
import { colors, typography, spacing } from '../theme';

// Feeds (TEST app only, Phil 3 Nov 2026): every live feed for the trip on one page, an addition to
// the stop pages. Cameras within 50 km with what the archive saw (live, frozen, night, offline) and
// the time the picture itself was taken when its source says so; the nearby airport's newest
// report; when the forecasts and T's plans last updated. Refreshes every minute while open; nothing
// downloads with the screen hidden or the app in the background.

type FeedCamera = {
  code: string; name: string; source: string | null; distance_km: number | null; tz: string | null;
  status: 'live' | 'frozen' | 'night' | 'offline'; stale_reason: string | null;
  image_url: string; live_url: string; live_time: string | null; live_source_time: string | null; last_checked: string | null;
  frame: null | { url: string | null; taken_at: string; label: string | null; hills_visible: boolean | null; cloud_on_hills: string | null; note: string | null };
};
type FeedStation = {
  icao: string; name: string | null; distance_km: number | null; hidden_ceiling_ft: number | null; peaks_hidden: boolean | null;
  obs: null | { hr: string; fetched_at: string | null; ceiling_ft: number | null; lowest_cloud_ft: number | null; cloud_pct: number | null;
                visibility_m: number | null; temperature_c: number | null; wx_string: string | null; fog: boolean | null };
};
type Feeds = {
  now: string; cameras: FeedCamera[]; stations: FeedStation[];
  updated: { forecast: string | null; ensemble: string | null; ensemble_run: string | null; planner_scores: string | null; plan: string | null };
};

const REFRESH_MS = 60_000;
const STATUS: Record<FeedCamera['status'], { text: string; color: string }> = {
  live: { text: 'Live', color: colors.signalOk },
  frozen: { text: 'Frozen', color: '#d9a441' },
  night: { text: 'Night', color: colors.textSecondary },
  offline: { text: 'Offline', color: '#d05a5a' },
};
const clock = (iso: string) => format(new Date(iso), 'h:mm a');

function CameraCard({ c }: { c: FeedCamera }) {
  const [live, setLive] = useState(false);
  const liveState = useLive(live ? { code: c.code, name: c.name, island: '', lat: 0, lng: 0, image_url: c.image_url, live_url: c.live_url, live_time: c.live_time, distance_km: c.distance_km } : undefined, live);
  const st = STATUS[c.status];
  // When the picture on show was taken: the source's own time if known.
  const pictureLine = live
    ? (liveState?.failed ? 'Live picture did not load' : liveState
        ? `Live · ${liveState.picture ? `picture ${liveState.picture}` : c.live_source_time ? `picture ${clock(c.live_source_time)}` : 'camera gives no time'} · loaded ${format(liveState.at, 'h:mm:ss a')}`
        : 'Loading live picture…')
    : c.frame ? `Archived · picture ${clock(c.frame.taken_at)} (${ago(c.frame.taken_at)})` : 'No picture yet';
  const why = c.status === 'frozen' ? `Serving an old picture (${c.stale_reason ?? 'repeat'})`
    : c.status === 'offline' ? `Nothing new since ${c.last_checked ? ago(c.last_checked) : 'a while'}`
    : c.status === 'night' ? 'Not checked at night'
    : c.live_time || c.live_source_time ? `Camera says ${c.live_time ?? clock(c.live_source_time!)}` : 'Checked hourly; camera gives no time';
  const uri = live ? liveState?.uri : c.frame?.url ?? undefined;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.camName} numberOfLines={1}>{c.name}</Text>
          <Text style={styles.small}>{c.source ?? ''}{c.distance_km != null ? ` · ${c.distance_km} km` : ''}</Text>
        </View>
        <View style={[styles.pill, { borderColor: st.color }]}>
          <View style={[styles.dot, { backgroundColor: st.color }]} />
          <Text style={[styles.pillText, { color: st.color }]}>{st.text}</Text>
        </View>
      </View>
      {uri ? <Image source={{ uri }} style={styles.pic} resizeMode="cover" /> : <View style={[styles.pic, styles.picEmpty]}><Text style={styles.small}>No picture</Text></View>}
      <View style={styles.cardFoot}>
        <View style={{ flex: 1 }}>
          <Text style={styles.small}>{pictureLine}</Text>
          <Text style={styles.small}>{why}</Text>
          {c.frame?.label && !live ? <Text style={styles.small}>Archive read: {c.frame.hills_visible === false ? 'peaks hidden' : c.frame.hills_visible ? 'peaks clear' : c.frame.label}{c.frame.cloud_on_hills && c.frame.cloud_on_hills !== 'none' ? ` · cloud ${c.frame.cloud_on_hills}` : ''}</Text> : null}
        </View>
        <TouchableOpacity onPress={() => setLive(v => !v)} style={[styles.liveBtn, live && styles.liveBtnOn]} accessibilityLabel={live ? 'Stop live' : 'Show live'}>
          <Ionicons name={live ? 'pause' : 'radio-outline'} size={14} color={live ? colors.textInverse : colors.textPrimary} />
          <Text style={[styles.liveText, live && { color: colors.textInverse }]}>{live ? 'Live on' : 'Live'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function FeedsScreen() {
  const navigation = useNavigation<any>();
  const { tripId } = (useRoute().params ?? {}) as { tripId: string };
  const focused = useIsFocused();
  const [data, setData] = useState<Feeds | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const s = AppState.addEventListener('change', x => setActive(x === 'active')); return () => s.remove(); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await solverAction<Feeds>({ action: 'feeds', trip_id: tripId })); setErr(null); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setLoading(false); }
  }, [tripId]);
  useEffect(() => {
    if (!focused || !active) return;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [focused, active, load]);

  const u = data?.updated;
  const row = (label: string, iso: string | null | undefined, extra?: string) => (
    <View style={styles.updRow} key={label}>
      <Text style={styles.updLabel}>{label}</Text>
      <Text style={styles.updVal}>{iso ? `${clock(iso)} · ${ago(iso)}${extra ?? ''}` : '—'}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Feeds</Text>
        {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.textSecondary} />}>
        {err ? <Text style={styles.err}>{err}</Text> : null}
        {!data && !err ? <Text style={styles.small}>Loading…</Text> : null}

        {data ? <Text style={styles.section}>CAMERAS</Text> : null}
        {data && !data.cameras.length ? <Text style={styles.small}>No cameras within 50 km of this trip.</Text> : null}
        {data?.cameras.map(c => <CameraCard key={c.code} c={c} />)}

        {data?.stations.length ? <Text style={styles.section}>AIRPORT REPORT</Text> : null}
        {data?.stations.map(s => (
          <View key={s.icao} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.camName}>{s.name ?? s.icao} ({s.icao})</Text>
                <Text style={styles.small}>{s.distance_km != null ? `${s.distance_km} km` : ''}{s.obs ? ` · report ${clock(s.obs.hr)} (${ago(s.obs.hr)})` : ' · no report'}</Text>
              </View>
              {s.peaks_hidden != null ? (
                <View style={[styles.pill, { borderColor: s.peaks_hidden ? '#d9a441' : colors.signalOk }]}>
                  <Text style={[styles.pillText, { color: s.peaks_hidden ? '#d9a441' : colors.signalOk }]}>{s.peaks_hidden ? 'Peaks hidden' : 'Ceiling clear'}</Text>
                </View>
              ) : null}
            </View>
            {s.obs ? (
              <Text style={styles.small}>
                {s.obs.ceiling_ft != null ? `Ceiling ${s.obs.ceiling_ft.toLocaleString()} ft` : 'No ceiling'}
                {s.hidden_ceiling_ft ? ` (peaks hide below ${s.hidden_ceiling_ft.toLocaleString()} ft)` : ''}
                {s.obs.cloud_pct != null ? ` · cloud ${s.obs.cloud_pct}%` : ''}
                {s.obs.visibility_m != null ? ` · visibility ${(s.obs.visibility_m / 1000).toFixed(0)} km` : ''}
                {s.obs.temperature_c != null ? ` · ${Math.round(s.obs.temperature_c)}°C` : ''}
                {s.obs.fog ? ' · fog' : ''}{s.obs.wx_string ? ` · ${s.obs.wx_string}` : ''}
              </Text>
            ) : null}
          </View>
        ))}

        {u ? <Text style={styles.section}>LAST UPDATED</Text> : null}
        {u ? (
          <View style={styles.card}>
            {row('Weather forecast', u.forecast)}
            {row('Ensemble (51 versions)', u.ensemble, u.ensemble_run ? ` · model run ${clock(u.ensemble_run)}` : '')}
            {row('Planner scores', u.planner_scores)}
            {row("T's newest plan", u.plan)}
          </View>
        ) : null}
        {data ? <Text style={[styles.small, { marginTop: spacing.lg }]}>Checked {clock(data.now)}. Pull down to refresh.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 },
  section: { ...typography.labelLarge, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  camName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  small: { fontSize: 12, color: colors.textSecondary },
  err: { fontSize: 13, color: '#d05a5a', paddingTop: spacing.md },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '600' },
  pic: { width: '100%', aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: colors.surfaceElevated },
  picEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  liveBtnOn: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  liveText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  updRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  updLabel: { fontSize: 13, color: colors.textPrimary },
  updVal: { fontSize: 13, color: colors.textSecondary },
});
