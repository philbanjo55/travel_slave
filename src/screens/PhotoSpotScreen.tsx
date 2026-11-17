import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert, Modal } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Sun3DPanel from '../components/sun/Sun3DPanel';
import { colors } from '../theme';
import { supabase } from '../services/supabase';
import { addShotRemember, fetchSpotJob, isOpen, markSpotSeen, SpotJob, Lens } from '../services/photoSpot';
import { useTripStore } from '../store/tripStore';
import { dayStartMs, sunPosition } from '../utils/sunEngine';
import type { Pair } from '../utils/sunEngine';
import { useSunStop } from '../services/sunPlan';
import type { RefPhoto } from '../components/sun/RefPhotoOverlay';

// Find my spot, the answer (Phil's mockup "Found" / "Lens135", 16 Nov 2026): the photo with our sky line on it,
// its 4x5 equivalent, how sure, and a plan per lens he owns; a tap on a lens shows that view in our 3D (read only).
// "Add as a shot" makes a framed shot at that lens's spot on the stop (and its practice copies); "Open in 3D" opens
// the same view full screen as the stop page's full-screen 3D (Phil, 16 Nov 2026: "place and frame the shot there and
// save, with the photo overlay"): walk mode, Save as my spot, Aim at subject, Save framing, and the reference photo
// opening on the photo the spot was found from. A shot already added is edited as it now stands (the trip's sun plan);
// one not added yet is added (photo_spot_add_shot, this lens) by the first save, which then goes onto it.

const KM_PER_DEG = 111.132;

function lensPair(job: SpotJob, row: Lens): Pair {
  const r = job.result!;
  const m = r.main_landmark;
  // the view's target: the main landmark, else a point 5 km along the aim (the saved framing decides the view anyway)
  const s = m ? { lat: m.lat, lng: m.lng } : {
    lat: row.lat + 5 * Math.cos(row.heading * Math.PI / 180) / KM_PER_DEG,
    lng: row.lng + 5 * Math.sin(row.heading * Math.PI / 180) / (KM_PER_DEG * Math.cos(row.lat * Math.PI / 180)),
  };
  return {
    vantage_id: `spot-${job.id}-${row.id}`, code: null, vantage_name: null, subject_id: '', subject_name: m?.name ?? 'View',
    v: { lat: row.lat, lng: row.lng }, s, bearing: null, dist_m: 0, v_sky: null, s_sky: null,
    framing: { heading: row.heading, pitch: row.pitch, lens: row.id, orient: 'landscape', at: job.updated_at },
  };
}

// A daylight moment for the picture: today's solar noon at the spot.
function noonAt(lng: number) {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  return d.getTime() - (lng / 15) * 3600e3;
}

export default function PhotoSpotScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { jobId } = route.params ?? {};
  const [job, setJob] = useState<SpotJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [full, setFull] = useState(false);
  const refresh = useTripStore((s: any) => s.refreshCurrentTrip);
  const tripData = useTripStore((s: any) => s.currentTripData);
  const focused = useIsFocused();   // one 3D web view at a time: the small one goes while full screen is open or the screen is left

  useEffect(() => {
    let alive = true;
    const go = async () => {
      const j = await fetchSpotJob(jobId);
      if (!alive) return;
      setJob(j); setLoading(false);
      if (j && isOpen(j)) setTimeout(go, 5000);
    };
    markSpotSeen(jobId);
    go();
    return () => { alive = false; };
  }, [jobId]);

  const r = job?.result ?? null;
  const rows = r?.ok ? (r.lenses ?? []) : [];
  const row = rows.find(x => x.id === pick) ?? rows.find(x => x.best) ?? rows[0] ?? null;
  const pair = useMemo(() => (job && row && r?.ok ? lensPair(job, row) : null), [job?.id, row?.id, r?.ok]);
  const t = useMemo(() => noonAt(row?.lng ?? 0), [row?.lng]);
  const sun = useMemo(() => (row ? sunPosition(t, row.lat, row.lng) : null), [t, row?.lat, row?.lng]);
  const added = row ? job?.shots?.[row.id] : null;
  // The stop's trip (the trip on the phone when it holds the stop, else asked once), its sun plan and photos, for the
  // full screen's saves and reference photo.
  const stopId = job?.stop_id ?? null;
  const inStore = useMemo(() => !!(stopId && (tripData?.days ?? []).some((d: any) => (d?.stops ?? []).some((x: any) => x?.id === stopId))), [tripData, stopId]);
  const [askedTrip, setAskedTrip] = useState<string | null>(null);
  useEffect(() => {
    if (!stopId || inStore) return;
    let alive = true;
    supabase.from('stops').select('trip_id').eq('id', stopId).maybeSingle()
      .then(({ data }: any) => { if (alive && data?.trip_id) setAskedTrip(data.trip_id); }, () => {});
    return () => { alive = false; };
  }, [stopId, inStore]);
  const tripId: string | null = inStore ? tripData?.trip?.id ?? null : askedTrip;
  const planStop = useSunStop(tripId, stopId ?? '');
  const livePair = added ? planStop?.pairs.find(p => p.vantage_id === added) ?? null : null;
  // The shot the full screen edits: the added shot as it stands now (its stand spot and framing may have been saved
  // since), else this lens's spot under the added shot's id, else the not-yet-added spot (made by the first save).
  const fullPair = useMemo<Pair | null>(() => (!pair ? null : added ? (livePair ?? { ...pair, vantage_id: added }) : pair), [pair, added, livePair]);
  const photos = useMemo<RefPhoto[]>(() => {
    const own: RefPhoto[] = job?.photo_url ? [{ id: job.photo_id, storage_url: job.photo_url }] : [];
    return own;   // only the photo the spot was found from (Phil, 16 Nov 2026: one photo per shot)
  }, [job?.photo_id, job?.photo_url]);
  // The full screen's day: the stop's own day as the stop page has it (else today, around solar noon), noon to start.
  const fDay0 = planStop ? dayStartMs(planStop.date, planStop.utc_offset_min) : t - 12 * 3600e3;
  const [fMinute, setFMinute] = useState(720);
  const fSun = useMemo(() => (fullPair ? sunPosition(fDay0 + fMinute * 60000, fullPair.v.lat, fullPair.v.lng) : null), [fDay0, fMinute, fullPair?.v.lat, fullPair?.v.lng]);
  // Not added yet: the full screen's first save adds the shot (this lens) and saves onto it. One add at a time.
  const jobRef = useRef(job);
  jobRef.current = job;
  const making = useRef<Promise<string> | null>(null);
  const makeShot = useCallback((): Promise<string> => {
    const j = jobRef.current, lens = row?.id;
    if (!j || !lens) return Promise.reject(new Error('No spot to add'));
    const have = j.shots?.[lens];
    if (have) return Promise.resolve(have);
    if (!making.current) {
      making.current = (async () => {
        const { data, error } = await supabase.rpc('photo_spot_add_shot', { p_job: j.id, p_lens: lens });
        if (error || !data?.vantage_id) {
          const msg = String(error?.message ?? '');
          throw new Error(/network|fetch|timed out|offline|abort/i.test(msg) ? 'Adding the shot needs a signal' : msg || 'The shot was not added');
        }
        addShotRemember(j.id, lens, data.vantage_id);
        setJob(x => (x ? { ...x, shots: { ...(x.shots ?? {}), [lens]: data.vantage_id } } : x));
        refresh?.().catch?.(() => {});
        return data.vantage_id as string;
      })().finally(() => { making.current = null; });
    }
    return making.current;
  }, [row?.id, refresh]);
  const conf = r?.confidence;
  const confColor = conf?.word === 'High' ? colors.signalOk : conf?.word === 'Medium' ? '#aaaaaa' : '#888888';

  const addShot = () => {
    if (!job || !row || adding || added) return;
    Alert.alert(`Add a ${row.f} mm shot?`, 'It goes on this stop, on the real trip and its practice copy.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: async () => {
        setAdding(true);
        const { data, error } = await supabase.rpc('photo_spot_add_shot', { p_job: job.id, p_lens: row.id });
        setAdding(false);
        if (error || !data?.vantage_id) { Alert.alert('Not added', error?.message ?? 'Check your connection and try again.'); return; }
        addShotRemember(job.id, row.id, data.vantage_id);
        setJob(j => (j ? { ...j, shots: { ...(j.shots ?? {}), [row.id]: data.vantage_id } } : j));
        refresh?.().catch?.(() => {});
      } },
    ]);
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Your spot</Text>
      </View>
      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      ) : !job ? (
        <Text style={styles.empty}>Not found. Needs a signal the first time.</Text>
      ) : isOpen(job) ? (
        <Text style={styles.empty}>Still finding where you stood…</Text>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 16 }]} accessibilityLabel="Your spot result">
          {job.overlay_url || job.photo_url ? (
            <Image source={{ uri: job.overlay_url ?? job.photo_url! }} style={styles.photo} resizeMode="cover" accessibilityLabel="Your photo with the 3D sky line drawn over it" />
          ) : null}
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.cap}>4×5 EQUIVALENT</Text>
              <Text style={styles.big}>{r?.fp_mm ? `${r.fp_mm} mm` : '—'} {r?.fp_mm ? <Text style={styles.small}>± 5%</Text> : null}</Text>
            </View>
            <View style={styles.tile} accessibilityLabel={`Confidence ${conf?.word ?? ''}`}>
              <Text style={styles.cap}>CONFIDENCE</Text>
              <Text style={[styles.big, { color: confColor }]} numberOfLines={1}>{conf?.word ?? (job.status === 'error' ? 'Error' : '—')}</Text>
              <Text style={styles.small} numberOfLines={2}>{conf?.line ?? job.error ?? ''}</Text>
            </View>
          </View>
          {rows.length ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.cap}>WITH YOUR LENSES</Text>
              {rows.map(x => {
                const on = x.id === row?.id;
                return (
                  <TouchableOpacity key={x.id} onPress={() => setPick(x.id)} style={[styles.row, on && styles.rowOn, !x.possible && { opacity: 0.5 }]}
                    accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${x.f} millimetre: ${x.plan}${x.best ? ', best fit' : ''}`}>
                    <Text style={styles.f}>{x.f}</Text>
                    <Text style={styles.plan} numberOfLines={1}>{x.plan}</Text>
                    {x.best ? <Text style={styles.best}>BEST FIT</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {pair && sun && focused && !full ? (
            <View style={styles.view3d} accessibilityLabel={`The view with the ${row?.f} mm from where it says to stand`}>
              <Sun3DPanel pair={pair} sun={sun} day0={t - 12 * 3600e3} height={200} preview onJump={() => {}} onFull={() => setFull(true)} others={planStop?.pairs} />
            </View>
          ) : null}
        </ScrollView>
      )}
      {r?.ok && row ? (
        <View style={[styles.buttons, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={[styles.btnMain, (added || !row.possible) && { opacity: 0.6 }]} onPress={addShot} disabled={!!added || adding || !row.possible}
            accessibilityRole="button" accessibilityLabel={added ? 'Added as a shot' : 'Add as a shot'}>
            {adding ? <ActivityIndicator color="#000" /> : <Text style={styles.btnMainText}>{added ? 'Added ✓' : 'Add as a shot'}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => setFull(true)} accessibilityRole="button" accessibilityLabel="Open in 3D">
            <Text style={styles.btnText}>Open in 3D</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Modal visible={full && !!fullPair && !!fSun} animationType="fade" onRequestClose={() => setFull(false)} statusBarTranslucent>
        <View style={[styles.fullWrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {full && fullPair && fSun ? (
            <Sun3DPanel
              pair={fullPair} tripId={tripId} stopId={stopId} sun={fSun} day0={fDay0} full onJump={setFMinute} onFull={() => setFull(false)}
              photos={photos} addShot={added ? undefined : makeShot}
              others={planStop?.pairs}   // the stop's other shots as pins (Phil, 17 Nov 2026)
            />
          ) : null}
          <TouchableOpacity onPress={() => setFull(false)} style={styles.fullClose} accessibilityRole="button" accessibilityLabel="Close the 3D view">
            <Text style={styles.btnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { color: '#888', fontSize: 14, textAlign: 'center', marginTop: 40 },
  body: { padding: 16, gap: 12 },
  photo: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#111' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: '#111', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 3 },
  cap: { color: '#888', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  big: { color: '#fff', fontSize: 18, fontWeight: '600' },
  small: { color: '#888', fontSize: 12, fontWeight: '400' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 40, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a' },
  rowOn: { backgroundColor: '#1a1a1a', borderColor: '#fff' },
  f: { width: 34, color: '#fff', fontSize: 15, fontWeight: '700' },
  plan: { flex: 1, color: '#ccc', fontSize: 13 },
  best: { color: '#000', backgroundColor: colors.signalOk, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  view3d: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#111' },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  btnMain: { flex: 1, height: 46, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnMainText: { color: '#000', fontSize: 15, fontWeight: '600' },
  btn: { flex: 1, height: 46, borderRadius: 10, borderWidth: 1, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  fullWrap: { flex: 1, backgroundColor: '#000' },
  fullClose: { alignSelf: 'flex-end', margin: 12, height: 40, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: '#444', justifyContent: 'center' },
});
