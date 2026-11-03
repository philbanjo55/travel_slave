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
// An airport report older than this is not "the weather now"; one silent a day is not reporting.
const STATION_OLD_MIN = 180;
const STATION_DEAD_MIN = 24 * 60;
const ageMin = (iso: string) => (Date.now() - Date.parse(iso)) / 60000;
// A picture older than this while the camera answers: it is stuck on an old picture.
const FROZEN_MIN = 45;
// Minutes since a camera-local "13:30" (from a file name or the camera's clock), today in its zone.
function localAgeMin(hm: string, tz: string | null | undefined): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  try {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz ?? undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())) p[x.type] = x.value;
    let d = Number(p.hour) * 60 + Number(p.minute) - (Number(m[1]) * 60 + Number(m[2]));
    if (d < -5) d += 1440; // yesterday's picture
    return Math.max(0, d);
  } catch { return null; }
}
function oldText(min: number): string {
  if (min < 1) return 'just taken';
  if (min < 60) return `${Math.round(min)} min old`;
  const h = Math.floor(min / 60), r = Math.round(min % 60);
  return `${h} h${r ? ` ${r} min` : ''} old`;
}

type View_ = { y: number; h: number };

// Every camera is live from the moment Feeds opens and reloads itself every 30 s (Phil, 3 Nov
// 2026: "if I'm there I wanna see live at the moment it loads"). The archived picture shows
// until the live one arrives, and stays if the camera stops answering. Cards far off screen
// stop downloading and keep their last picture.
function CameraCard({ c, tz, paused, view }: { c: FeedCamera; tz: string | null; paused: boolean; view: View_ | null }) {
  const [box, setBox] = useState<{ y: number; h: number } | null>(null);
  const near = !view || !box || (box.y + box.h > view.y - view.h * 0.5 && box.y < view.y + view.h * 1.5);
  // The archived picture's address is signed again on every refresh, so a new address does not
  // mean a new picture: keep the old one while the picture is the same.
  const shown = useRef<{ taken: string | null; url: string | null }>({ taken: null, url: null });
  if (c.frame?.taken_at !== shown.current.taken || !shown.current.url) shown.current = { taken: c.frame?.taken_at ?? null, url: c.frame?.url ?? null };
  const live = useLive({ code: c.code, name: c.name, island: '', lat: 0, lng: 0, image_url: c.image_url, live_url: c.live_url, live_time: c.live_time, distance_km: c.distance_km, tz: c.tz }, true, undefined, paused || !near);
  const ctz = c.tz ?? tz;
  const archive = c.frame ? clock(c.frame.taken_at, ctz) : null;

  // How old the picture on show is, from the camera's own time when it gives one.
  let pictureAt: string | null = null;
  let oldMin: number | null = null;
  if (live && !live.failed) {
    if (live.picture) { pictureAt = hm12(live.picture); oldMin = localAgeMin(live.picture, ctz); }
    else if (c.live_source_time) { pictureAt = clock(c.live_source_time, ctz); oldMin = Math.max(0, ageMin(c.live_source_time)); }
  }
  const noClock = live && !live.failed && pictureAt == null;
  const stuck = oldMin != null ? oldMin > FROZEN_MIN : noClock && c.status === 'frozen';

  const st = !live ? { text: paused ? 'Paused' : 'Loading', color: colors.textSecondary }
    : live.failed ? { text: 'Not answering', color: STATUS.offline.color }
    : stuck ? STATUS.frozen
    : c.status === 'night' ? STATUS.night
    : STATUS.live;
  const fresh = !live
    ? (paused ? (archive ? `Paused · showing the ${archive} archive picture` : 'Paused')
       : archive ? `Loading the live picture · showing the ${archive} archive picture` : 'Loading the live picture…')
    : live.failed ? (archive ? `Camera not answering · showing the ${archive} archive picture` : 'Camera not answering')
    : pictureAt ? `Picture taken ${pictureAt} · ${oldText(oldMin ?? 0)}`
    : `This camera shows no clock · reloaded ${clock(live.at.toISOString(), ctz, true)}`;
  const peaks = c.frame?.hills_visible != null
    ? `Peaks ${c.frame.hills_visible ? 'clear' : 'hidden'} in the ${archive} archive picture${c.frame.cloud_on_hills && c.frame.cloud_on_hills !== 'none' ? ` (cloud ${c.frame.cloud_on_hills})` : ''}`
    : null;
  const uri = live && !live.failed ? live.uri : shown.current.url ?? live?.uri ?? undefined;
  return (
    <View style={styles.card} onLayout={e => setBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.camName} numberOfLines={1}>{c.name}</Text>
          <Text style={styles.small} numberOfLines={1}>{c.source ?? ''}{c.distance_km != null ? ` · ${c.distance_km} km from a stop` : ''}</Text>
        </View>
        <View style={[styles.pill, { borderColor: st.color }]}>
          <View style={[styles.dot, { backgroundColor: st.color }]} />
          <Text style={[styles.pillText, { color: st.color }]}>{st.text}</Text>
        </View>
      </View>
      {uri ? <Image source={{ uri }} style={styles.pic} resizeMode="cover" /> : <View style={[styles.pic, styles.picEmpty]}><Text style={styles.small}>No picture</Text></View>}
      <Text style={styles.fresh}>{fresh}</Text>
      {peaks ? <Text style={styles.small}>{peaks}</Text> : null}
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
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<View_ | null>(null);
  const listY = useRef(0);
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
  // Stacked: the name on one line, the time under it, so nothing runs off a phone's edge
  // (3 Nov 2026: the Ensemble row ran past the right margin).
  const row = (label: string, iso: string | null | undefined, note?: string | null) => (
    <View style={styles.updRow} key={label}>
      <Text style={styles.updLabel}>{label}</Text>
      <Text style={styles.updVal}>{iso ? `${clock(iso, tz)} · ${ago(iso)}` : 'Not yet'}</Text>
      {note ? <Text style={styles.small}>{note}</Text> : null}
    </View>
  );
  // An airport silent for a day is not reporting: one line for it, not a card (Driggs, silent
  // since 13 Oct 2026, showed a 22-day-old report).
  const stations = data?.stations ?? [];
  const silent = stations.filter(s => !s.obs || ageMin(s.obs.hr) > STATION_DEAD_MIN);
  const reporting = stations.filter(s => !silent.includes(s));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Feeds</Text>
        {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        {data?.cameras.length ? (
          <TouchableOpacity onPress={() => setPaused(p => !p)} style={styles.pauseBtn} accessibilityLabel={paused ? 'Resume live' : 'Pause live'}>
            <Ionicons name={paused ? 'play' : 'pause'} size={14} color={colors.textPrimary} />
            <Text style={styles.pauseText}>{paused ? 'Resume' : 'Pause'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={styles.list}
        onLayout={e => { const h = e.nativeEvent.layout.height; setView(v => ({ y: v?.y ?? 0, h })); }}
        onScroll={e => { listY.current = e.nativeEvent.contentOffset.y; setView(v => v ? { ...v, y: listY.current } : v); }}
        scrollEventThrottle={400}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.textSecondary} />}>
        {err ? <Text style={styles.err}>{data ? `Could not refresh. Showing what was checked at ${clock(data.now, tz)}.` : err}</Text> : null}
        {data && tzLabel ? <Text style={[styles.small, { paddingTop: spacing.md }]}>Times are trip time ({tzLabel}). Cameras reload every 30 seconds.</Text> : null}
        {!data && !err ? <Text style={styles.small}>Loading…</Text> : null}

        {data ? <Text style={styles.section}>CAMERAS</Text> : null}
        {data && !data.cameras.length ? <Text style={styles.small}>No cameras within 50 km of this trip.</Text> : null}
        {data?.cameras.map(c => <CameraCard key={c.code} c={c} tz={tz} paused={paused} view={view} />)}

        {stations.length ? <Text style={styles.section}>AIRPORT REPORT</Text> : null}
        {reporting.map(s => {
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
                <Text style={styles.small}>{s.obs ? `Report ${clock(s.obs.hr, tz)} · ${ago(s.obs.hr)}` : 'No report'}{s.distance_km != null ? ` · ${s.distance_km} km from a stop` : ''}</Text>
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
        {silent.length ? (
          <Text style={styles.small}>Not reporting: {silent.map(s => `${s.name ?? s.icao} (${s.icao})${s.obs ? `, silent since ${format(new Date(s.obs.hr), 'MMM d')}` : ''}`).join('; ')}.</Text>
        ) : null}

        {u ? <Text style={styles.section}>LAST UPDATED</Text> : null}
        {u ? (
          <View style={styles.card}>
            {row('Weather forecast', u.forecast)}
            {row('Ensemble (51 versions)', u.ensemble, run ? `Newest model run ${clock(run, tz)}` : null)}
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
  fresh: { fontSize: 13, color: colors.textPrimary },
  pauseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  pauseText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  updRow: { gap: 2, paddingVertical: 2 },
  updLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  updVal: { fontSize: 13, color: colors.textSecondary },
});
