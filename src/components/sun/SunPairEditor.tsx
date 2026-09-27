import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, spacing } from '../../theme';
import { PairCheck, fetchStopPairs, removeSunPair, saveSunPair, setVantagePhoto } from '../../services/sunPlan';
import { usePhotoUpload } from '../../hooks/usePhotoUpload';
import VantagePhoto from './VantagePhoto';
import { Coords, formatCoords, parseCoords } from '../../utils/coords';
import { compassPoint, shortName } from './sunStyle';

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
};

type Form = {
  vantageId: string | null;
  code: string;
  vantageName: string;
  vCoords: string;
  subjectName: string;
  sCoords: string;
  sHeight: string;
  photoId: string | null;
  photoUrl: string | null;
  savedPhotoId: string | null;   // what the vantage has now, to tell if it changed
};

const EMPTY: Form = {
  vantageId: null, code: '', vantageName: '', vCoords: '', subjectName: '', sCoords: '', sHeight: '',
  photoId: null, photoUrl: null, savedPhotoId: null,
};

export default function SunPairEditor({ visible, onClose, tripId, stopId, stopName, stopPhotos, editVantageId }: Props) {
  const [pairs, setPairs] = useState<PairCheck[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PairCheck | null>(null);
  const [locating, setLocating] = useState(false);
  const [choosing, setChoosing] = useState(false);
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
    if (visible) { setForm(null); setSaved(null); setSaveError(null); setChoosing(false); load(editVantageId); }
  }, [visible, stopId]);

  const vParsed = form ? parseCoords(form.vCoords) : null;
  const sParsed = form ? parseCoords(form.sCoords) : null;
  const heightText = form?.sHeight.trim() ?? '';
  const height = heightText === '' ? null : Number(heightText.replace(',', '.'));
  const heightOk = height === null || (isFinite(height) && height >= 0 && height <= 3000);
  const canSave = !!form && !!form.vantageName.trim() && !!form.subjectName.trim() && !!vParsed && !!sParsed && heightOk && !saving;

  // Spots and subjects already on this stop, to reuse without retyping.
  const spots = useMemo(() => {
    const seen = new Map<string, PairCheck>();
    (pairs ?? []).forEach(p => { const k = `${p.vantage_name}|${p.v_lat}|${p.v_lng}`; if (!seen.has(k)) seen.set(k, p); });
    return [...seen.values()];
  }, [pairs]);
  const subjects = useMemo(() => {
    const seen = new Map<string, PairCheck>();
    (pairs ?? []).forEach(p => { if (!seen.has(p.subject_id)) seen.set(p.subject_id, p); });
    return [...seen.values()];
  }, [pairs]);

  const set = (patch: Partial<Form>) => setForm(f => (f ? { ...f, ...patch } : f));

  const startAdd = () => { setSaved(null); setSaveError(null); setChoosing(false); setForm({ ...EMPTY }); };
  const startEdit = (p: PairCheck) => {
    setSaved(null); setSaveError(null); setChoosing(false);
    setForm({
      vantageId: p.vantage_id, code: p.code ?? '', vantageName: p.vantage_name,
      vCoords: formatCoords({ lat: p.v_lat, lng: p.v_lng }),
      subjectName: p.subject_name, sCoords: formatCoords({ lat: p.s_lat, lng: p.s_lng }),
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
      let r = await saveSunPair(tripId, stopId, {
        vantageId: form.vantageId, code: form.code.trim() || null,
        vantageName: form.vantageName.trim(), vLat: vParsed.lat, vLng: vParsed.lng,
        subjectName: form.subjectName.trim(), sLat: sParsed.lat, sLng: sParsed.lng, sHeight: height,
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
    Alert.alert('Remove from this stop?', `${label(p)} → ${shortName(p.subject_name)}\n\nThe pins stay saved and can be added again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeSunPair(tripId, stopId, p.vantage_id); load(); }
        catch (e: any) { Alert.alert('Not removed', e.message); }
      } },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={form ? () => setForm(null) : onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{form ? (form.vantageId ? 'Edit vantage' : 'Add a vantage') : 'Sun & Moon vantages'}</Text>
            {!!stopName && <Text style={styles.subtitle} numberOfLines={1}>{stopName}</Text>}
          </View>
          <TouchableOpacity onPress={form ? () => setForm(null) : onClose} hitSlop={12} accessibilityLabel={form ? 'Back' : 'Close'}>
            <Ionicons name={form ? 'arrow-back' : 'close'} size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!form && (
              <>
                {saved && <SavedCard p={saved} />}

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
                      <Text style={[styles.cardTitle, { flex: 1 }]}>{label(p)} <Text style={styles.arrow}>→</Text> {shortName(p.subject_name)}</Text>
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
                <Text style={styles.tip}>
                  A vantage is where you stand; the subject is what you photograph. Put the subject pin on the face you want lit:
                  shade is worked out at that exact point. Terrain is calculated automatically when you save.
                </Text>
              </>
            )}

            {form && (
              <>
                <Text style={styles.section}>WHERE YOU STAND</Text>
                {!form.vantageId && spots.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                    {spots.map(p => (
                      <TouchableOpacity key={p.vantage_id} style={styles.chip}
                        onPress={() => set({ vantageName: p.vantage_name, code: p.code ?? '', vCoords: formatCoords({ lat: p.v_lat, lng: p.v_lng }) })}>
                        <Text style={styles.chipText}>Same spot as {label(p)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                <Field label="Name" value={form.vantageName} onChange={t => set({ vantageName: t })} placeholder="e.g. Bøur panoramic viewpoint" />
                <Field label="Short label (optional)" value={form.code} onChange={t => set({ code: t })} placeholder="e.g. A1" maxLength={12} />
                <Field label="Coordinates" value={form.vCoords} onChange={t => set({ vCoords: t })}
                  placeholder="Paste from Google Maps" keyboardType="numbers-and-punctuation" />
                <CoordStatus text={form.vCoords} parsed={vParsed} />
                <TouchableOpacity style={styles.secondary} onPress={useMyLocation} disabled={locating}>
                  {locating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="locate" size={16} color={colors.textPrimary} />}
                  <Text style={styles.secondaryText}>Use my location</Text>
                </TouchableOpacity>

                <Text style={[styles.section, { marginTop: 22 }]}>WHAT YOU'RE PHOTOGRAPHING</Text>
                {subjects.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                    {subjects.map(p => (
                      <TouchableOpacity key={p.subject_id} style={styles.chip}
                        onPress={() => set({ subjectName: p.subject_name, sCoords: formatCoords({ lat: p.s_lat, lng: p.s_lng }), sHeight: p.s_height_m != null ? String(p.s_height_m) : '' })}>
                        <Text style={styles.chipText}>{shortName(p.subject_name)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                <Field label="Name" value={form.subjectName} onChange={t => set({ subjectName: t })} placeholder="e.g. Drangarnir" />
                <Field label="Coordinates" value={form.sCoords} onChange={t => set({ sCoords: t })}
                  placeholder="Paste from Google Maps" keyboardType="numbers-and-punctuation" />
                <CoordStatus text={form.sCoords} parsed={sParsed} />
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
                      <View style={styles.pickGrid}>
                        {(stopPhotos ?? []).map((ph: any) => {
                          const on = ph.id === form.photoId;
                          return (
                            <TouchableOpacity
                              key={ph.id}
                              onPress={() => { set({ photoId: ph.id, photoUrl: ph.storage_url }); setChoosing(false); }}
                              style={[styles.pickCell, on && styles.pickCellOn]}
                              accessibilityLabel={on ? 'Chosen photo' : 'Choose this photo'}
                              accessibilityState={{ selected: on }}
                            >
                              <VantagePhoto id={ph.id} url={ph.storage_url} style={StyleSheet.absoluteFill} />
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
      </SafeAreaView>
    </Modal>
  );
}

function label(p: PairCheck): string {
  return p.code ? `${p.code} ${shortName(p.vantage_name)}` : shortName(p.vantage_name);
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
        <Text style={styles.cardTitle}>Saved: {label(p)} → {shortName(p.subject_name)}</Text>
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
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pickCell: { width: '31.5%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden', backgroundColor: '#0a0a0a' },
  pickCellOn: { borderWidth: 3, borderColor: '#F0B04A' },
  arrow: { color: colors.textSecondary },
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
