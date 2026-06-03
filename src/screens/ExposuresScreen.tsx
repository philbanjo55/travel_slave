import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, FlatList, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { format, parseISO } from 'date-fns';
import { loadExposures, Exposure } from '../services/exposures';

type SortKey = 'time_desc' | 'time_asc' | 'ev_desc' | 'ev_asc' | 'aperture' | 'shutter';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'time_desc', label: 'Newest' },
  { key: 'time_asc', label: 'Oldest' },
  { key: 'ev_desc', label: 'EV high' },
  { key: 'ev_asc', label: 'EV low' },
  { key: 'aperture', label: 'Aperture' },
  { key: 'shutter', label: 'Shutter' },
];

function fmtShutter(e: Exposure): string {
  if (e.shutter_display) return e.shutter_display;
  if (e.shutter_seconds == null) return '—';
  return e.shutter_seconds >= 1 ? `${e.shutter_seconds}s` : `1/${Math.round(1 / e.shutter_seconds)}`;
}

export default function ExposuresScreen() {
  const navigation = useNavigation<any>();
  const [exposures, setExposures] = useState<Exposure[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>('time_desc');
  const [filmFilter, setFilmFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { exposures, offline } = await loadExposures();
    setExposures(exposures);
    setOffline(offline);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // distinct film stocks present, for filter chips
  const films = useMemo(() => {
    const s = new Set<string>();
    exposures.forEach(e => { if (e.film_stock) s.add(e.film_stock); });
    return Array.from(s).sort();
  }, [exposures]);

  const visible = useMemo(() => {
    let list = exposures;
    if (filmFilter) list = list.filter(e => e.film_stock === filmFilter);
    const sorted = [...list];
    switch (sort) {
      case 'time_desc': sorted.sort((a, b) => b.captured_at.localeCompare(a.captured_at)); break;
      case 'time_asc': sorted.sort((a, b) => a.captured_at.localeCompare(b.captured_at)); break;
      case 'ev_desc': sorted.sort((a, b) => (b.ev ?? -99) - (a.ev ?? -99)); break;
      case 'ev_asc': sorted.sort((a, b) => (a.ev ?? 99) - (b.ev ?? 99)); break;
      case 'aperture': sorted.sort((a, b) => (a.aperture ?? 0) - (b.aperture ?? 0)); break;
      case 'shutter': sorted.sort((a, b) => (b.shutter_seconds ?? 0) - (a.shutter_seconds ?? 0)); break;
    }
    return sorted;
  }, [exposures, sort, filmFilter]);

  const renderItem = ({ item }: { item: Exposure }) => {
    let when = '';
    try { when = format(parseISO(item.captured_at), 'MMM d · h:mm a'); } catch {}
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ExposureDetail', { id: item.id })}
      >
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="image-outline" size={20} color={colors.textTertiary} />
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardWhen}>{when}</Text>
          <Text style={styles.cardSettings}>
            f/{item.aperture ?? '—'} · {fmtShutter(item)} · ISO {item.iso ?? '—'}
          </Text>
          <View style={styles.cardMetaRow}>
            {item.ev != null && <Text style={styles.cardMeta}>EV {item.ev}</Text>}
            {item.nd_ev != null && item.nd_ev !== 0 && <Text style={styles.cardMeta}>ND {item.nd_ev}</Text>}
            {item.adjust_ev != null && item.adjust_ev !== 0 && (
              <Text style={styles.cardMeta}>{item.adjust_ev > 0 ? '+' : ''}{item.adjust_ev} EV</Text>
            )}
          </View>
          <View style={styles.cardTags}>
            {item.film_stock && <Text style={styles.filmTag}>{item.film_stock}</Text>}
            {item.filter && <Text style={styles.filterTag} numberOfLines={1}>{item.filter}</Text>}
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Exposures</Text>
        {offline && <Text style={styles.offline}>OFFLINE</Text>}
        <TouchableOpacity onPress={() => navigation.navigate('ExposureImport')} style={styles.backBtn}>
          <Ionicons name="add" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Sort row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
        {SORTS.map(s => (
          <TouchableOpacity
            key={s.key}
            style={[styles.chip, sort === s.key && styles.chipActive]}
            onPress={() => setSort(s.key)}
          >
            <Text style={[styles.chipText, sort === s.key && styles.chipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Film filter row */}
      {films.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          <TouchableOpacity
            style={[styles.chip, !filmFilter && styles.chipActive]}
            onPress={() => setFilmFilter(null)}
          >
            <Text style={[styles.chipText, !filmFilter && styles.chipTextActive]}>All film</Text>
          </TouchableOpacity>
          {films.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, filmFilter === f && styles.chipActive]}
              onPress={() => setFilmFilter(filmFilter === f ? null : f)}
            >
              <Text style={[styles.chipText, filmFilter === f && styles.chipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
      ) : visible.length === 0 ? (
        <View style={styles.loading}>
          <Ionicons name="film-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyText}>No exposures yet</Text>
          <Text style={styles.emptySub}>Tap + to import a Samsung note or text</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={e => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  offline: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1, color: colors.textTertiary,
    borderWidth: 1, borderColor: colors.textTertiary,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm,
  },
  chipRow: { maxHeight: 44, flexGrow: 0 },
  chipRowContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    marginRight: spacing.xs,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  chipText: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  chipTextActive: { color: colors.accent },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardWhen: { ...typography.labelMedium, color: colors.textTertiary, marginBottom: 2 },
  cardSettings: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  cardMetaRow: { flexDirection: 'row', gap: spacing.md, marginTop: 2 },
  cardMeta: { fontSize: 11, color: colors.textSecondary },
  cardTags: { flexDirection: 'row', gap: spacing.sm, marginTop: 4, alignItems: 'center' },
  filmTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: colors.accent },
  filterTag: { fontSize: 10, color: colors.textTertiary, flexShrink: 1 },
  chevron: { color: colors.textTertiary, fontSize: 18 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  emptyText: { ...typography.bodyLarge, color: colors.textSecondary, marginTop: spacing.sm },
  emptySub: { ...typography.bodySmall, color: colors.textTertiary },
});
