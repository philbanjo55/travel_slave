import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, spacing } from '../../theme';
import { PairCheck, fetchStopPairs, removeSunPair, saveSunShot, setVantagePhoto } from '../../services/sunPlan';
import { usePhotoUpload } from '../../hooks/usePhotoUpload';
import VantagePhoto from './VantagePhoto';
import PairMapPicker, { PinKind } from './PairMapPicker';
import ShotLinker from './ShotLinker';
import { Coords, formatCoords, parseCoords } from '../../utils/coords';
import { compassPoint, shotTitle } from './sunStyle';

// Add, edit and remove the vantage -> subject pairs on one stop. Writes go
// straight to the database, which builds the terrain for new coordinates by
// itself; the planner refreshes when a change is saved. Needs a connection.

type Props = {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  stopId: string;
  stopName?: string | null;
  stopPhotos?: any[];              // photos to choose a vantage's reference photo from
  editVantageId?: string | null;   // open straight on this vantage's form
  stopCoords?: Coords | null;      // the stop's main location, where the map opens
};

type Form = {
  vantageId: string | null;
  code: string;
  name: string;                  // the shot's name
  vCoords: string;
  sCoords: string;
  subjectId: string | null;      // "Same subject as": share that subject point
  subjectAt: string;             // its coordinates as chosen, to tell if they were changed
  sHeight: string;
  photoId: string | null;
  photoUrl: string | null;
  savedPhotoId: string | null;   // what the vantage has now, to tell if it changed
};

const GRID_GAP = 6;

const EMPTY: Form = {
  vantageId: null, code: '', name: '', vCoords: '', sCoords: '', subjectId: null, subjectAt: '', sHeight: '',
  photoId: null, photoUrl: null, savedPhotoId: null,
};

export default function SunPairEditor({ visible, onClose, tripId, stopId, stopName, stopPhotos, editVantageId, stopCoords }: Props) {
  const [pairs, setPairs] = useState<PairCheck[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PairCheck | null>(null);
  const [locating, setLocating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [mapping, setMapping] = useState<PinKind | null>(null);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<number | null>(null);
  // Grid cells get an explicit size from the grid's measured width: a
  // percentage width with aspectRatio collapses to 0 height in a wrapping row.
  const [gridW, setGridW] = useState(0);
  const cell = gridW > 0 ? Math.floor((gridW - 2 * GRID_GAP) / 3) : 0;
  const { pickOne, uploading } = usePhotoUpload(stopId);

  const load = async (openVantageId?: string | null) => {
    setLoadError(null);
    try {
      const list = await fetchStopPairs(stopId);
      setPairs(list);
      const p = openVantageId ? list.find(x => x.vantage_id === openVantageId) : null;
      if (p) startEdit(p);
    }
    catch (e: any) { setLoadError(e.message); }
  };

  useEffect(() => {
    if (visible) { setForm(null); setSaved(null); setSaveError(null); setChoosing(false); setMapping(null); setLinking(false); setLinked(null); load(editVantageId); }
  }, [visible, stopId]);

  const vParsed = form ? parseCoords(form.vCoords) : null;
  const sParsed = form ? parseCoords(form.sCoords) : null;
  const heightText = form?.sHeight.trim() ?? '';
  const height = heightText === '' ? null : Number(heightText.replace(',', '.'));
  const heightOk = height === null || (isFinite(height) && height >= 0 && height <= 3000);
  const canSave = !!form && !!form.name.trim() && !!vParsed && !!sParsed && heightOk && !saving;

  // Spots and subjects already on this stop, to reuse without retyping.
  const spots = useMemo(() => {
    const seen = new Map<string, PairCheck>();
    (pairs ?? []).forEach(p => { const k = `${p.v_lat}|${p.v_lng}`; if (!seen.has(k)) seen.set(k, p); });
    return [...seen.values()];
  }, [pairs]);
  const subjects = useMemo(() => {
    const seen = new Map<string, PairCheck>();
    (pairs ?? []).forEach(p => { if (!seen.has(p.subject_id)) seen.set(p.subject_id, p); });
    return [...seen.values()];
  }, [pairs]);

  const set = (patch: Partial<Form>) => setForm(f => (f ? { ...f, ...patch } : f));

  // Labels are automatic: the stop's first letter and the next free number (T1, T2, ...).
  const nextCode = () => autoCode(stopName, (pairs ?? []).map(p => p.code));

  const startAdd = () => { setSaved(null); setSaveError(null); setChoosing(false); setForm({ ...EMPTY, code: nextCode() }); };
  const startEdit = (p: PairCheck) => {
    setSaved(null); setSaveError(null); setChoosing(false);
    setForm({
      vantageId: p.vantage_id, code: p.code || nextCode(), name: p.shot_name || p.subject_name,
      vCoords: formatCoords({ lat: p.v_lat, lng: p.v_lng }),
      sCoords: formatCoords({ lat: p.s_lat, lng: p.s_lng }), subjectId: null, subjectAt: '',
      sHeight: p.s_height_m != null ? String(p.s_height_m) : '',
      photoId: p.photo_id ?? null, photoUrl: p.photo_url ?? null, savedPhotoId: p.photo_id ?? null,
    });
  };

  const uploadNew = async () => {
    const ph = await pickOne('reference');
    if (ph) { set({ photoId: ph.id, photoUrl: ph.storage_url }); setChoosing(false); }
    else Alert.alert('No photo added', 'Nothing was uploaded. If you picked a photo, check your connection and try again.');
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Location is off', 'Allow location for this app to use where you are standing.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const c: Coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      set({ vCoords: formatCoords(c) });
      const acc = pos.coords.accuracy;
      if (acc != null && acc > 25) Alert.alert('Rough fix', `Your phone says this is accurate to about ${Math.round(acc)} m. Wait a moment in the open and try again for a better one.`);
    } catch (e: any) {
      Alert.alert('Could not get your location', String(e?.message ?? e));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!form || !vParsed || !sParsed) return;
    setSaving(true); setSaveError(null);
    try {
      // Share the chosen subject only if its point was left as it was.
      const shareSubject = !form.vantageId && form.subjectId && form.sCoords.trim() === form.subjectAt ? form.subjectId : null;
      let r = await saveSunShot(tripId, stopId, {
        vantageId: form.vantageId, name: form.name.trim(),
        vLat: vParsed.lat, vLng: vParsed.lng, sLat: sParsed.lat, sLng: sParsed.lng, sHeight: height,
        subjectId: shareSubject,
      });
      if ((form.photoId ?? null) !== (r.photo_id ?? null)) {
        r = await setVantagePhoto(tripId, r.vantage_id, form.photoId);
      }
      setSaved(r); setForm(null); load();
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = (p: PairCheck) => {
    Alert.alert('Remove from this stop?', `${label(p)}\n\nThe pins stay saved and can be added again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeSunPair(tripId, stopId, p.vantage_id); load(); }
        catch (e: any) { Alert.alert('Not removed', e.message); }
      } },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={linking ? () => setLinking(false) : mapping ? () => setMapping(null) : form ? () => setForm(null) : onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{linking ? 'Add shots from other stops' : mapping ? 'Place on map' : form ? (form.vantageId ? 'Edit vantage' : 'Add a vantage') : 'Sun & Moon vantages'}</Text>
            {!!stopName && <Text style={styles.subtitle} numberOfLines={1}>{stopName}</Text>}
          </View>
          <TouchableOpacity onPress={linking ? () => setLinking(false) : mapping ? () => setMapping(null) : form ? () => setForm(null) : onClose} hitSlop={12} accessibilityLabel={form || linking ? 'Back' : 'Close'}>
            <Ionicons name={form || mapping || linking ? 'arrow-back' : 'close'} size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {linking ? (
          <ShotLinker tripId={tripId} stopId={stopId} onDone={(n) => { setLinking(false); setLinked(n); load(); }} />
        ) : mapping && form ? (
          <PairMapPicker
            v={vParsed} s={sParsed} start={mapping}
            centre={stopCoords ?? (pairs?.[0] ? { lat: pairs[0].v_lat, lng: pairs[0].v_lng } : null)}
            others={(pairs ?? []).filter(p => p.vantage_id !== form.vantageId)
              .map(p => ({ v: { lat: p.v_lat, lng: p.v_lng }, s: { lat: p.s_lat, lng: p.s_lng } }))}
            onCancel={() => setMapping(null)}
            onDone={(v, s2) => {
              set({ ...(v ? { vCoords: formatCoords(v) } : {}), ...(s2 ? { sCoords: formatCoords(s2) } : {}) });
              setMapping(null);
            }}
          />
        ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!form && (
              <>
                {saved && <SavedCard p={saved} />}
                {linked != null && (
                  <View style={[styles.card, { borderColor: '#3f7d5a' }]}>
                    <Text style={styles.cardTitle}>{linked === 0 ? 'Nothing new to add' : `Added ${linked} shot${linked === 1 ? '' : 's'} to this stop`}</Text>
                  </View>
                )}

                {pairs === null && !loadError && <ActivityIndicator color={colors.textSecondary} style={{ marginVertical: 24 }} />}
                {loadError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{loadError}</Text>
                    <TouchableOpacity onPress={() => load(editVantageId)}><Text style={styles.link}>Try again</Text></TouchableOpacity>
                  </View>
                )}
                {pairs?.length === 0 && <Text style={styles.muted}>No vantages on this stop yet.</Text>}
                {pairs?.map(p => (
                  <View key={p.vantage_id} style={styles.card}>
                    <View style={styles.cardHead}>
                      {p.photo_id && <VantagePhoto id={p.photo_id} url={p.photo_url} style={styles.cardThumb} />}
                      <Text style={[styles.cardTitle, { flex: 1 }]}>{label(p)}</Text>
                    </View>
                    <Checks p={p} />
                    <View style={styles.cardActions}>
                      <TouchableOpacity style={styles.smallBtn} onPress={() => startEdit(p)}><Text style={styles.smallBtnText}>Edit</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.smallBtn} onPress={() => remove(p)}><Text style={[styles.smallBtnText, { color: '#e0776b' }]}>Remove</Text></TouchableOpacity>
                    </View>
                  </View>
                ))}

                {!loadError && (
                  <TouchableOpacity style={styles.primary} onPress={startAdd}>
                    <Ionicons name="add" size={18} color="#000" />
                    <Text style={styles.primaryText}>Add a vantage</Text>
                  </TouchableOpacity>
                )}
                {!loadError && (
                  <TouchableOpacity style={styles.secondary} onPress={() => { setSaved(null); setLinked(null); setLinking(true); }}>
                    <Ionicons name="link" size={16} color={colors.textPrimary} />
                    <Text style={styles.secondaryText}>Add shots from other stops</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.tip}>
                  A vantage is where you stand; the subject is what you photograph. Put the subject pin on the face you want lit:
                  shade is worked out at that exact point. Terrain is calculated automatically when you save.
                </Text>
              </>
            )}

            {form && (
              <>
                <Text style={styles.section}>SHOT</Text>
                <Field label="Name" value={form.name} onChange={t => set({ name: t })} placeholder="e.g. spikes" />
                <Text style={styles.hint}>Label <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{form.code}</Text> · set automatically</Text>

                <Text style={[styles.section, { marginTop: 22 }]}>WHERE YOU STAND</Text>
                {!form.vantageId && spots.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                    {spots.map(p => (
                      <TouchableOpacity key={p.vantage_id} style={styles.chip}
                        onPress={() => set({ vCoords: formatCoords({ lat: p.v_lat, lng: p.v_lng }) })}>
                        <Text style={styles.chipText}>Same spot as {label(p)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                <Field label="Coordinates" value={form.vCoords} onChange={t => set({ vCoords: t })}
                  placeholder="Paste from Google Maps" keyboardType="numbers-and-punctuation" />
                <CoordStatus text={form.vCoords} parsed={vParsed} />
                <View style={styles.btnRow}>
                  <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setMapping('v')}>
                    <Ionicons name="map-outline" size={16} color={colors.textPrimary} />
                    <Text style={styles.secondaryText}>Set on map</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={useMyLocation} disabled={locating}>
                    {locating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="locate" size={16} color={colors.textPrimary} />}
                    <Text style={styles.secondaryText}>Use my location</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.section, { marginTop: 22 }]}>WHAT YOU'RE PHOTOGRAPHING</Text>
                {!form.vantageId && subjects.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                    {subjects.map(p => {
                      const at = formatCoords({ lat: p.s_lat, lng: p.s_lng });
                      return (
                        <TouchableOpacity key={p.subject_id} style={styles.chip}
                          onPress={() => set({ subjectId: p.subject_id, subjectAt: at, sCoords: at, sHeight: p.s_height_m != null ? String(p.s_height_m) : '' })}>
                          <Text style={styles.chipText}>Same subject as {label(p)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
                <Field label="Coordinates" value={form.sCoords} onChange={t => set({ sCoords: t })}
                  placeholder="Paste from Google Maps" keyboardType="numbers-and-punctuation" />
                <CoordStatus text={form.sCoords} parsed={sParsed} />
                <TouchableOpacity style={styles.secondary} onPress={() => setMapping('s')}>
                  <Ionicons name="map-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.secondaryText}>Set on map</Text>
                </TouchableOpacity>
                <Field label="Height in metres (optional)" value={form.sHeight} onChange={t => set({ sHeight: t })}
                  placeholder="Only for thin sea stacks or towers" keyboardType="decimal-pad" />
                {!heightOk && <Text style={styles.bad}>Height must be a number from 0 to 3000.</Text>}
                <Text style={styles.hint}>The map data misses thin rock towers. A real height lets the top of a stack catch light after the sea below is in shade. Leave empty for hills and mountains.</Text>

                <Text style={[styles.section, { marginTop: 22 }]}>REFERENCE PHOTO</Text>
                <View style={styles.refRow}>
                  {form.photoId
                    ? <VantagePhoto id={form.photoId} url={form.photoUrl} style={styles.refThumb} />
                    : <View style={[styles.refThumb, styles.refEmpty]}><Ionicons name="image-outline" size={22} color="#555" /></View>}
                  <View style={{ flex: 1, gap: 6 }}>
                    <TouchableOpacity style={styles.refBtn} onPress={() => setChoosing(c => !c)} accessibilityRole="button">
                      <Text style={styles.smallBtnText}>{choosing ? 'Hide stop photos' : 'Choose from stop photos'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.refBtn} onPress={uploadNew} disabled={uploading} accessibilityRole="button">
                      {uploading ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.smallBtnText}>Upload new</Text>}
                    </TouchableOpacity>
                    {!!form.photoId && (
                      <TouchableOpacity style={styles.refBtn} onPress={() => set({ photoId: null, photoUrl: null })} accessibilityRole="button">
                        <Text style={[styles.smallBtnText, { color: '#e0776b' }]}>Remove photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                {choosing && (
                  (stopPhotos ?? []).length === 0
                    ? <Text style={styles.hint}>This stop has no photos yet. Use Upload new.</Text>
                    : (
                      <View style={styles.pickGrid} onLayout={e => setGridW(e.nativeEvent.layout.width)}>
                        {cell > 0 && (stopPhotos ?? []).map((ph: any) => {
                          const on = ph.id === form.photoId;
                          return (
                            <TouchableOpacity
                              key={ph.id}
                              onPress={() => { set({ photoId: ph.id, photoUrl: ph.storage_url }); setChoosing(false); }}
                              style={[styles.pickCell, { width: cell, height: cell }]}
                              accessibilityLabel={on ? 'Chosen photo' : 'Choose this photo'}
                              accessibilityState={{ selected: on }}
                            >
                              <VantagePhoto id={ph.id} url={ph.storage_url} style={{ width: cell, height: cell }} />
                              {on && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.pickCellOn]} />}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )
                )}
                <Text style={styles.hint}>The shot you're going for from this spot. It shows on the Sun & Moon chips and Photo tab, and is saved on the phone for offline.</Text>

                {!!saveError && <View style={styles.errorBox}><Text style={styles.errorText}>{saveError}</Text></View>}
                <TouchableOpacity style={[styles.primary, !canSave && { opacity: 0.4 }]} onPress={save} disabled={!canSave}>
                  {saving ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="checkmark" size={18} color="#000" />}
                  <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// "Trælanípa · Sørvágsvatn" + [T1, T2] -> "T3". Uses the first letter of the
// stop's name (skipping emoji and symbols), or V when there is none.
export function autoCode(stopName: string | null | undefined, codes: (string | null | undefined)[]): string {
  const isLetter = (ch: string) => ch.toLowerCase() !== ch.toUpperCase();
  const first = Array.from(String(stopName ?? '')).find(isLetter);
  const prefix = (first ?? 'V').toUpperCase();
  let max = 0;
  codes.forEach(c => {
    const code = String(c ?? '');
    const head = Array.from(code)[0] ?? '';
    const num = code.slice(head.length);
    if (head.toUpperCase() === prefix && /^\d+$/.test(num)) max = Math.max(max, Number(num));
  });
  return `${prefix}${max + 1}`;
}

function label(p: PairCheck): string {
  return shotTitle(p);
}

function Checks({ p }: { p: PairCheck }) {
  const facing = p.bearing != null ? `facing ${compassPoint(p.bearing)} ${Math.round(p.bearing)}°` : 'no direction';
  const subj = p.s_height_m != null ? `subject ${Math.round(p.s_height_m)} m (you set)` : p.s_ground_m != null ? `subject ground ${Math.round(p.s_ground_m)} m` : 'subject: no terrain data';
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.checkLine}>
        {p.v_ground_m != null ? `You stand at ${Math.round(p.v_ground_m)} m` : 'You: no terrain data'} · {subj}
      </Text>
      <Text style={styles.checkLine}>{facing} · {(p.dist_m / 1000).toFixed(2)} km</Text>
      {p.warnings?.map((w, i) => (
        <View key={i} style={styles.warn}>
          <Ionicons name="warning-outline" size={14} color="#e2b25a" />
          <Text style={styles.warnText}>{w}</Text>
        </View>
      ))}
    </View>
  );
}

function SavedCard({ p }: { p: PairCheck }) {
  return (
    <View style={[styles.card, { borderColor: '#3f7d5a' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="checkmark-circle" size={18} color="#5aaa7a" />
        <Text style={styles.cardTitle}>Saved: {label(p)}</Text>
      </View>
      <Checks p={p} />
      <Text style={styles.hint}>Terrain is ready. The Sun & Moon section updates in a moment.</Text>
    </View>
  );
}

function CoordStatus({ text, parsed }: { text: string; parsed: Coords | null }) {
  if (!text.trim()) return null;
  return parsed
    ? <Text style={styles.good}>✓ {formatCoords(parsed)}</Text>
    : <Text style={styles.bad}>Can't read these. Paste "62.085177, -7.366927" or a Google Maps link.</Text>;
}

function Field({ label, value, onChange, placeholder, keyboardType, maxLength }: {
  label: string; value: string; onChange: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numbers-and-punctuation' | 'decimal-pad'; maxLength?: number;
}) {
  return (
    <View style={{ gap: 4, marginTop: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input} value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor="#555" keyboardType={keyboardType ?? 'default'} autoCorrect={false}
        autoCapitalize="none" maxLength={maxLength} accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  body: { padding: spacing.xl, gap: 12, paddingBottom: 60 },
  muted: { color: colors.textSecondary, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  cardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardThumb: { width: 44, height: 44, borderRadius: 6 },
  refRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 6 },
  refThumb: { width: 104, height: 104, borderRadius: 8 },
  refEmpty: { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  refBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, marginTop: 6, minHeight: 40 },
  pickCell: { borderRadius: 6, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  pickCellOn: { borderWidth: 3, borderColor: '#F0B04A', borderRadius: 6 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  smallBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  checkLine: { color: '#aaaaaa', fontSize: 12 },
  warn: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  warnText: { color: '#e2b25a', fontSize: 12, flex: 1, lineHeight: 17 },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ffffff',
    borderRadius: 10, minHeight: 46, marginTop: 8,
  },
  primaryText: { color: '#000000', fontSize: 15, fontWeight: '700' },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, minHeight: 40, marginTop: 8,
  },
  secondaryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 8 },
  tip: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
  section: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  chips: { gap: 6, paddingVertical: 4 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  chipText: { color: colors.textPrimary, fontSize: 12 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.surface,
  },
  good: { color: '#5aaa7a', fontSize: 12 },
  bad: { color: '#e0776b', fontSize: 12 },
  hint: { color: colors.textTertiary, fontSize: 11, lineHeight: 16 },
  errorBox: { borderWidth: 1, borderColor: '#6b3a33', backgroundColor: '#2a1714', borderRadius: 8, padding: 12, gap: 6 },
  errorText: { color: '#f0a79c', fontSize: 13 },
  link: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
