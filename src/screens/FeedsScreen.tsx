import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  // ensemble_run is one time per weather model ({ gfs025: iso, ecmwf_ifs025: iso, ... }).
  updated: { forecast: string | null; ensemble: string | null; ensemble_run: string | Record<string, string> | null; planner_scores: string | null; plan: string | null };
};

const REFRESH_MS = 60_000;
const STATUS: Record<FeedCamera['status'], { text: string; color: string }> = {
  live: { text: 'Live', color: colors.signalOk },
  frozen: { text: 'Frozen', color: '#d9a441' },
  night: { text: 'Night', color: colors.textSecondary },
  offline: { text: 'Offline', color: '#d05a5a' },
};
// Every time on the page is shown in the cameras' own time (the trip's time), 12-hour, so the
// camera's printed clock, the archive and the airport all read the same way (3 Nov 2026: the
// camera's "13:30" sat next to phone-time "3:30 PM"). A bad value shows a dash, never a crash.
function clock(iso: string | null | undefined, tz?: string | null, seconds = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz ?? undefined, hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(d);
  } catch { return format(d, seconds ? 'h:mm:ss a' : 'h:mm a'); }
}
// A camera-local "13:30" (from a file name) as "1:30 PM".
function hm12(hm: string | null | undefined): string | null {
  const m = hm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hm ?? null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
function tzName(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    const n = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value;
    // "GMT+0" says less than the place: "Faroe time".
    return n && !/^(GMT|UTC)/.test(n) ? n : `${tz.split('/').pop()!.replace(/_/g, ' ')} time`;
  } catch { return tz; }
}
// The newest of the ensemble's model runs.
function newestRun(r: Feeds['updated']['ensemble_run']): string | null {
  if (!r) return null;
  if (typeof r === 'string') return r;
  const ts = Object.values(r).map(v => Date.parse(v)).filter(Number.isFinite);
  return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
}
// An airport report older than this is not "the weather now".
const STATION_OLD_MIN = 180;
const ageMin = (iso: string) => (Date.now() - Date.parse(iso)) / 60000;

function CameraCard({ c, tz }: { c: FeedCamera; tz: string | null }) {
  const [live, setLive] = useState(false);
  // The archived picture's address is signed again on every refresh, so a new address does not
  // mean a new picture: keep the old one while the picture is the same (3 Nov 2026: every
  // camera's picture downloaded again every minute).
  const shown = useRef<{ taken: string | null; url: string | null }>({ taken: null, url: null });
  if (c.frame?.taken_at !== shown.current.taken || !shown.current.url) shown.current = { taken: c.frame?.taken_at ?? null, url: c.frame?.url ?? null };
  const liveState = useLive(live ? { code: c.code, name: c.name, island: '', lat: 0, lng: 0, image_url: c.image_url, live_url: c.live_url, live_time: c.live_time, distance_km: c.distance_km, tz: c.tz } : undefined, live);
  const ctz = c.tz ?? tz;
  // With Live on, the pill says what the camera is doing now.
  const st = live && liveState?.failed ? { text: 'Not answering', color: STATUS.offline.color } : STATUS[c.status];
  // When the picture on show was taken: the source's own time if known.
  const pictureLine = live
    ? (liveState?.failed ? 'Live picture did not load' : liveState
        ? `Live · ${liveState.picture ? `picture ${hm12(liveState.picture)}` : c.live_source_time ? `picture ${clock(c.live_source_time, ctz)}` : 'camera gives no time'} · loaded ${clock(liveState.at.toISOString(), ctz, true)}`
        : 'Loading live picture…')
    : c.frame ? `Archived · picture ${clock(c.frame.taken_at, ctz)} (${ago(c.frame.taken_at)})` : 'No picture yet';
  const why = c.status === 'frozen' ? `Serving an old picture (${c.stale_reason ?? 'repeat'})`
    : c.status === 'offline' ? `Nothing new since ${c.last_checked ? ago(c.last_checked) : 'a while'}`
    : c.status === 'night' ? 'Not checked at night'
    : c.live_time || c.live_source_time ? `Camera says ${c.live_time ? hm12(c.live_time) : clock(c.live_source_time, ctz)}` : 'Checked hourly; camera gives no time';
  const uri = live ? liveState?.uri : shown.current.url ?? undefined;
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
    catch (e: any) {
      const m = String(e?.message ?? e);
      setErr(/weak signal|network|fetch/i.test(m) ? 'Feeds did not load (weak signal?). Pull down to try again.' : `Feeds did not load: ${m}`);
    }
    finally { setLoading(false); }
  }, [tripId]);
  useEffect(() => {
    if (!focused || !active) return;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [focused, active, load]);

  const u = data?.updated;
  // The trip's time: the cameras' zone (all of a trip's cameras share one).
  const tz = data?.cameras.find(c => c.tz)?.tz ?? null;
  const tzLabel = tzName(tz);
  const run = newestRun(u?.ensemble_run ?? null);
  const row = (label: string, iso: string | null | undefined, extra?: string) => (
    <View style={styles.updRow} key={label}>
      <Text style={styles.updLabel}>{label}</Text>
      <Text style={styles.updVal}>{iso ? `${clock(iso, tz)} · ${ago(iso)}${extra ?? ''}` : '—'}</Text>
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
        {err ? <Text style={styles.err}>{data ? `Could not refresh. Showing what was checked at ${clock(data.now, tz)}.` : err}</Text> : null}
        {data && tzLabel ? <Text style={[styles.small, { paddingTop: spacing.md }]}>Times are trip time ({tzLabel}).</Text> : null}
        {!data && !err ? <Text style={styles.small}>Loading…</Text> : null}

        {data ? <Text style={styles.section}>CAMERAS</Text> : null}
        {data && !data.cameras.length ? <Text style={styles.small}>No cameras within 50 km of this trip.</Text> : null}
        {data?.cameras.map(c => <CameraCard key={c.code} c={c} tz={tz} />)}

        {data?.stations.length ? <Text style={styles.section}>AIRPORT REPORT</Text> : null}
        {data?.stations.map(s => {
          // A report hours old is not the weather now (Driggs last reported 13 Oct).
          const old = !s.obs || ageMin(s.obs.hr) > STATION_OLD_MIN;
          // No ceiling in a fresh report means no low cloud deck: the peaks are clear.
          const hidden = old ? null : s.peaks_hidden ?? (s.hidden_ceiling_ft && s.obs && s.obs.ceiling_ft == null ? false : null);
          const pill = old ? { text: 'Old report', color: STATUS.offline.color }
            : hidden != null ? { text: hidden ? 'Peaks hidden' : 'Ceiling clear', color: hidden ? '#d9a441' : colors.signalOk } : null;
          return (
          <View key={s.icao} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.camName}>{s.name ?? s.icao} ({s.icao})</Text>
                <Text style={styles.small}>{s.distance_km != null ? `${s.distance_km} km` : ''}{s.obs ? ` · report ${clock(s.obs.hr, tz)} (${ago(s.obs.hr)})` : ' · no report'}</Text>
              </View>
              {pill ? (
                <View style={[styles.pill, { borderColor: pill.color }]}>
                  <Text style={[styles.pillText, { color: pill.color }]}>{pill.text}</Text>
                </View>
              ) : null}
            </View>
            {s.obs && !old ? (
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
          );
        })}

        {u ? <Text style={styles.section}>LAST UPDATED</Text> : null}
        {u ? (
          <View style={styles.card}>
            {row('Weather forecast', u.forecast)}
            {row('Ensemble (51 versions)', u.ensemble, run ? ` · newest model run ${clock(run, tz)}` : '')}
            {row('Planner scores', u.planner_scores)}
            {row("T's newest plan", u.plan)}
          </View>
        ) : null}
        {data ? <Text style={[styles.small, { marginTop: spacing.lg }]}>Checked {clock(data.now, tz)}. Pull down to refresh.</Text> : null}
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
