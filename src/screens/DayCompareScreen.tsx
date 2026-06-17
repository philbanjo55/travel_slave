import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import {
  WeatherRow, buildSourceComparison, cToF, kmhToMph, SourceKey,
} from '../services/weather';

// Read-only per-day comparison across all four weather sources. Receives the
// day's stops and the already-loaded weather map via route params — no fetch.
export default function DayCompareScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { dayTitle, dayNumber, stops, weather } = route.params as {
    dayTitle: string; dayNumber: number;
    stops: any[]; weather: Record<string, WeatherRow>;
  };

  const stopsWithWx = useMemo(
    () => (stops || [])
      .filter((s: any) => s.shot_type && s.shot_type !== 'logistics')
      .map((s: any) => ({ stop: s, row: (s.weather as WeatherRow) ?? weather?.[s.id] }))
      .filter((x: any) => x.row && x.row.temperature_c != null),
    [stops, weather]
  );

  // Day-level rollup: how often each source is the cloud outlier, and its mean
  // stars across stops. Surfaces which model is consistently the pessimist.
  const rollup = useMemo(() => {
    const outlierCount: Record<string, number> = { open_meteo: 0, metno: 0, met_eireann: 0, ukmo: 0 };
    const starSum: Record<string, number> = { open_meteo: 0, metno: 0, met_eireann: 0, ukmo: 0 };
    const starN: Record<string, number> = { open_meteo: 0, metno: 0, met_eireann: 0, ukmo: 0 };
    let multiCount = 0;
    for (const { row } of stopsWithWx) {
      const cmp = buildSourceComparison(row);
      if (cmp.hasMulti) multiCount++;
      if (cmp.cloudOutlier) outlierCount[cmp.cloudOutlier]++;
      for (const s of cmp.sources) {
        if (s.present && s.stars != null) { starSum[s.key] += s.stars; starN[s.key]++; }
      }
    }
    const names: Record<SourceKey, string> = {
      open_meteo: 'Open-Meteo', metno: 'MET Norway', met_eireann: 'Met Éireann', ukmo: 'UK Met Office',
    };
    const rows = (Object.keys(names) as SourceKey[]).map(k => ({
      key: k, name: names[k],
      outliers: outlierCount[k],
      meanStars: starN[k] ? (starSum[k] / starN[k]) : null,
      n: starN[k],
    }));
    return { rows, multiCount };
  }, [stopsWithWx]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.dayLabel}>DAY {dayNumber} · SOURCE COMPARISON</Text>
          <Text style={styles.dayTitle}>{dayTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}>
        {/* Day-level rollup */}
        <View style={styles.rollup}>
          <Text style={styles.sectionLabel}>DAY ROLLUP</Text>
          <Text style={styles.rollupHint}>
            Across {rollup.multiCount} stop{rollup.multiCount === 1 ? '' : 's'} with multiple sources.
            "Outlier" = times that source disagreed most on cloud.
          </Text>
          <View style={styles.rollHeadRow}>
            <Text style={[styles.rollSource, styles.rollHead]}>SOURCE</Text>
            <Text style={[styles.rollCell, styles.rollHead]}>OUTLIER</Text>
            <Text style={[styles.rollCell, styles.rollHead]}>AVG ★</Text>
          </View>
          {rollup.rows.map(r => (
            <View key={r.key} style={styles.rollRow}>
              <Text style={[styles.rollSource, r.n === 0 ? styles.dim : null]}>{r.name}</Text>
              <Text style={[styles.rollCell, r.outliers > 0 ? styles.warn : styles.dim]}>
                {r.n === 0 ? '—' : `${r.outliers}×`}
              </Text>
              <Text style={[styles.rollCell, r.n === 0 ? styles.dim : null]}>
                {r.meanStars == null ? '—' : r.meanStars.toFixed(1)}
              </Text>
            </View>
          ))}
        </View>

        {/* Per-stop comparisons */}
        {stopsWithWx.map(({ stop, row }) => {
          const cmp = buildSourceComparison(row);
          return (
            <View key={stop.id} style={styles.stopCard}>
              <View style={styles.stopHead}>
                <Text style={styles.stopName} numberOfLines={1}>{stop.name}</Text>
                <Text style={styles.stopTime}>{stop.time_label ?? ''}</Text>
              </View>

              {cmp.hasMulti ? (
                <View style={[styles.verdict, cmp.cloudOutlier ? styles.verdictWarn : styles.verdictOk]}>
                  <Ionicons
                    name={cmp.cloudOutlier ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                    size={13}
                    color={cmp.cloudOutlier ? colors.signalWarning : colors.signalOk} />
                  <Text style={[styles.verdictText, { color: cmp.cloudOutlier ? colors.signalWarning : colors.signalOk }]}>
                    {cmp.verdict}
                  </Text>
                </View>
              ) : (
                <Text style={styles.singleSource}>Only one source available for this stop.</Text>
              )}

              <View style={styles.headRow}>
                <Text style={[styles.cellSource, styles.headText]}>SOURCE</Text>
                <Text style={[styles.cell, styles.headText]}>TEMP</Text>
                <Text style={[styles.cell, styles.headText]}>CLOUD</Text>
                <Text style={[styles.cell, styles.headText]}>RAIN</Text>
                <Text style={[styles.cell, styles.headText]}>WIND</Text>
                <Text style={[styles.cell, styles.headText]}>GUST</Text>
                <Text style={[styles.cell, styles.headText]}>★</Text>
              </View>

              {cmp.sources.map(s => {
                const isOutlier = s.key === cmp.cloudOutlier;
                const dim = !s.present;
                const f = (c: number | null) => c == null ? '—' : `${Math.round(cToF(c))}°`;
                const mph = (k: number | null) => k == null ? '—' : `${Math.round(kmhToMph(k))}`;
                const pct = (v: number | null) => v == null ? '—' : `${Math.round(v)}%`;
                return (
                  <View key={s.key} style={[styles.row, isOutlier ? styles.rowOutlier : null]}>
                    <View style={styles.cellSource}>
                      <Text style={[styles.sourceName, dim ? styles.dim : null]} numberOfLines={1}>{s.name}</Text>
                      <View style={styles.tags}>
                        {s.isLocalModel ? <Text style={styles.tagLocal}>LOCAL</Text> : null}
                        {s.note ? <Text style={styles.tagNote}>{s.note}</Text> : null}
                      </View>
                    </View>
                    <Text style={[styles.cell, dim ? styles.dim : null]}>{f(s.temperature_c)}</Text>
                    <Text style={[styles.cell, dim ? styles.dim : null, isOutlier ? styles.outlierVal : null]}>{pct(s.cloud_cover_pct)}</Text>
                    <Text style={[styles.cell, dim ? styles.dim : null]}>{pct(s.precip_probability_pct)}</Text>
                    <Text style={[styles.cell, dim ? styles.dim : null]}>{mph(s.wind_speed_kmh)}</Text>
                    <Text style={[styles.cell, dim ? styles.dim : null]}>
                      {mph(s.wind_gusts_kmh)}{s.wind_gusts_kmh != null && !s.gustMeasured ? '*' : ''}
                    </Text>
                    <Text style={[styles.cell, dim ? styles.dim : null]}>{s.stars == null ? '—' : s.stars}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}

        <Text style={styles.footnote}>
          * gust estimated from mean wind. LOCAL = home-team high-res model for this region
          (Met Éireann in Ireland, UK Met Office in Scotland). "Out of range" means that model
          doesn't forecast this far ahead yet — it'll fill in as the date approaches.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4, marginRight: spacing.sm },
  headerInfo: { flex: 1 },
  dayLabel: { ...typography.labelMedium, fontSize: 9, color: colors.textTertiary, letterSpacing: 1 },
  dayTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginTop: 2 },

  sectionLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: colors.textTertiary, marginBottom: 4 },
  rollup: {
    padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radius.md, marginBottom: spacing.md,
  },
  rollupHint: { fontSize: 10, color: colors.textTertiary, fontStyle: 'italic', marginBottom: 6 },
  rollHeadRow: { flexDirection: 'row', marginBottom: 2 },
  rollHead: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: colors.textTertiary },
  rollRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  rollSource: { width: 130, fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  rollCell: { flex: 1, textAlign: 'center', fontSize: 12, color: colors.textPrimary, fontVariant: ['tabular-nums'] },

  stopCard: {
    padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radius.md, marginBottom: spacing.sm,
  },
  stopHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  stopName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  stopTime: { fontSize: 11, color: colors.textTertiary, fontVariant: ['tabular-nums'] },

  verdict: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6, paddingVertical: 3 },
  verdictOk: {}, verdictWarn: {},
  verdictText: { fontSize: 12, fontWeight: '600', flex: 1 },
  singleSource: { fontSize: 11, color: colors.textTertiary, fontStyle: 'italic', marginBottom: 6 },

  headRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginBottom: 1 },
  headText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.4, color: colors.textTertiary },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  rowOutlier: { backgroundColor: 'rgba(170,170,170,0.08)', borderRadius: radius.sm },
  cellSource: { width: 92, paddingLeft: 2 },
  cell: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  sourceName: { fontSize: 11, color: colors.textPrimary, fontWeight: '600' },
  dim: { color: colors.textTertiary },
  warn: { color: colors.signalWarning, fontWeight: '700' },
  outlierVal: { color: colors.signalWarning, fontWeight: '700' },
  tags: { flexDirection: 'row', gap: 3, marginTop: 1 },
  tagLocal: { fontSize: 7, fontWeight: '700', letterSpacing: 0.4, color: colors.signalOk },
  tagNote: { fontSize: 7, fontWeight: '700', letterSpacing: 0.4, color: colors.textTertiary, fontStyle: 'italic' },
  footnote: { fontSize: 9, color: colors.textTertiary, fontStyle: 'italic', marginTop: spacing.md, lineHeight: 14 },
});
