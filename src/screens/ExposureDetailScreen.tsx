import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { format, parseISO } from 'date-fns';
import {
  Exposure, FilmStock, loadFilmStocks, updateExposure, deleteExposure,
  getCachedExposures, addFilmStock,
} from '../services/exposures';

function fmtShutter(e: Exposure): string {
  if (e.shutter_display) return e.shutter_display;
  if (e.shutter_seconds == null) return '—';
  return e.shutter_seconds >= 1 ? `${e.shutter_seconds}s` : `1/${Math.round(1 / e.shutter_seconds)}`;
}

export default function ExposureDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { id } = route.params;

  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [stocks, setStocks] = useState<FilmStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [filmModal, setFilmModal] = useState(false);
  const [newStock, setNewStock] = useState('');

  const load = useCallback(async () => {
    // exposures come from cache (list already loaded them); find ours
    const cached = await getCachedExposures();
    const found = cached.find(e => e.id === id) || null;
    setExposure(found);
    setStocks(await loadFilmStocks());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setFilm = async (name: string | null) => {
    if (!exposure) return;
    setFilmModal(false);
    const stock = stocks.find(s => s.name === name);
    setExposure({ ...exposure, film_stock: name, film_stock_id: stock?.id ?? null });
    try {
      await updateExposure(exposure.id, { film_stock: name, film_stock_id: stock?.id ?? null });
    } catch {
      Alert.alert('Offline', 'Change saved locally; will sync when online.');
    }
  };

  const createStock = async () => {
    const name = newStock.trim();
    if (!name) return;
    try {
      const s = await addFilmStock(name);
      setStocks(prev => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
      setNewStock('');
      await setFilm(name);
    } catch {
      Alert.alert('Error', 'Could not add film stock (are you online?).');
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete exposure?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteExposure(id);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete (are you online?).');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (!exposure) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Exposure</Text>
        </View>
        <View style={styles.loading}><Text style={styles.emptySub}>Not found in cache.</Text></View>
      </SafeAreaView>
    );
  }

  const e = exposure;
  let when = '';
  try { when = format(parseISO(e.captured_at), 'EEE, MMM d yyyy · h:mm:ss a'); } catch {}

  const rows: [string, string][] = [
    ['Aperture', e.aperture != null ? `f/${e.aperture}` : '—'],
    ['Shutter', fmtShutter(e)],
    ['ISO', e.iso != null ? String(e.iso) : '—'],
    ['EV', e.ev != null ? String(e.ev) : '—'],
    ['Adjust EV', e.adjust_ev != null ? `${e.adjust_ev > 0 ? '+' : ''}${e.adjust_ev}` : '—'],
    ['ND EV', e.nd_ev != null ? String(e.nd_ev) : '—'],
    ['Meter', e.meter_name || '—'],
    ['Location', e.lat != null && e.lng != null ? `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}` : '—'],
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{when || 'Exposure'}</Text>
        <TouchableOpacity onPress={confirmDelete} style={styles.backBtn}>
          <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {e.photo_url ? (
          <Image source={{ uri: e.photo_url }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]}>
            <Ionicons name="image-outline" size={32} color={colors.textTertiary} />
            <Text style={styles.emptySub}>No photo</Text>
          </View>
        )}

        {/* Settings grid */}
        <View style={styles.grid}>
          {rows.map(([label, val]) => (
            <View key={label} style={styles.gridItem}>
              <Text style={styles.gridLabel}>{label.toUpperCase()}</Text>
              <Text style={styles.gridValue}>{val}</Text>
            </View>
          ))}
        </View>

        {/* Film stock — editable */}
        <Text style={styles.sectionLabel}>FILM STOCK</Text>
        <TouchableOpacity style={styles.filmRow} onPress={() => setFilmModal(true)}>
          <Text style={styles.filmValue}>{e.film_stock || 'Tap to set film'}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* Filter / technique */}
        {e.filter ? (
          <>
            <Text style={styles.sectionLabel}>FILTER / TECHNIQUE</Text>
            <Text style={styles.bodyText}>{e.filter}</Text>
          </>
        ) : null}

        {/* Raw notes */}
        {e.notes ? (
          <>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <Text style={styles.bodyText}>{e.notes}</Text>
          </>
        ) : null}

        {e.source ? (
          <Text style={styles.provenance}>
            imported from {e.source}{e.source_file ? ` · ${e.source_file}` : ''}
          </Text>
        ) : null}
      </ScrollView>

      {/* Film picker modal */}
      <Modal visible={filmModal} animationType="slide" transparent onRequestClose={() => setFilmModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Set film stock</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {stocks.map(s => (
                <TouchableOpacity key={s.id} style={styles.stockOption} onPress={() => setFilm(s.name)}>
                  <Text style={styles.stockOptionText}>{s.name}</Text>
                  {s.reciprocity_p != null && <Text style={styles.stockP}>P={Number(s.reciprocity_p).toFixed(2)}</Text>}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.stockOption} onPress={() => setFilm(null)}>
                <Text style={[styles.stockOptionText, { color: colors.textTertiary }]}>Clear film</Text>
              </TouchableOpacity>
            </ScrollView>
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                value={newStock}
                onChangeText={setNewStock}
                placeholder="Add new stock…"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.accent}
              />
              <TouchableOpacity style={styles.addBtn} onPress={createStock}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.modalClose} onPress={() => setFilmModal(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  title: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: colors.surface },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, aspectRatio: 16 / 9 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
  },
  gridItem: { width: '50%', paddingVertical: spacing.sm },
  gridLabel: { ...typography.labelMedium, color: colors.textTertiary, marginBottom: 2 },
  gridValue: { fontSize: 20, fontWeight: '600', color: colors.textPrimary },
  sectionLabel: { ...typography.labelMedium, color: colors.textTertiary, paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  filmRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: spacing.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  filmValue: { fontSize: 16, fontWeight: '600', color: colors.accent },
  bodyText: { ...typography.bodyLarge, color: colors.textPrimary, paddingHorizontal: spacing.lg },
  provenance: { ...typography.bodySmall, color: colors.textTertiary, paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  emptySub: { ...typography.bodySmall, color: colors.textTertiary },
  // modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surfaceElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  modalTitle: { ...typography.headlineMedium, marginBottom: spacing.md },
  stockOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  stockOptionText: { fontSize: 16, color: colors.textPrimary },
  stockP: { fontSize: 11, color: colors.textTertiary },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'center' },
  addInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  addBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent },
  addBtnText: { color: colors.accent, fontWeight: '600' },
  modalClose: { alignItems: 'center', marginTop: spacing.lg },
  modalCloseText: { color: colors.textSecondary, fontSize: 15 },
});
