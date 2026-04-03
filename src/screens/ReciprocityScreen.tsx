import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');

// ─────────────────────────────────────────────────────
// CALCULATION ENGINE (verified against manufacturer data)
// ─────────────────────────────────────────────────────

function logInterp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x <= 0 || x0 <= 0 || x1 <= 0) return y0;
  const logRatio = Math.log(x / x0) / Math.log(x1 / x0);
  return y0 * Math.pow(y1 / y0, logRatio);
}

function lookupReciprocity(metered: number, dataPoints: [number, number][]): number {
  if (metered < dataPoints[0][0]) return metered;
  if (metered >= dataPoints[dataPoints.length - 1][0]) {
    const [x0, y0] = dataPoints[dataPoints.length - 2];
    const [x1, y1] = dataPoints[dataPoints.length - 1];
    return logInterp(metered, x0, y0, x1, y1);
  }
  for (let i = 0; i < dataPoints.length - 1; i++) {
    const [x0, y0] = dataPoints[i];
    const [x1, y1] = dataPoints[i + 1];
    if (metered >= x0 && metered <= x1) {
      return logInterp(metered, x0, y0, x1, y1);
    }
  }
  return metered;
}

// Kodak lookup tables (from official data sheets)
const TRIX_DATA: [number, number][] = [[1, 2], [10, 50], [100, 1200]];
const TMY_DATA: [number, number][] = [[1, 1], [10, 15], [100, 200], [240, 540]];

type FilmStock = {
  name: string;
  method: 'power' | 'lookup' | 'portra' | 'provia';
  p?: number;
  data?: [number, number][];
  source: string;
  note?: string;
};

const FILM_STOCKS_4x5: FilmStock[] = [
  { name: 'Delta 100', method: 'power', p: 1.26, source: 'Ilford official PDF' },
  { name: 'FP4+', method: 'power', p: 1.26, source: 'Ilford official PDF' },
  { name: 'HP5+', method: 'power', p: 1.31, source: 'Ilford official PDF' },
  { name: 'T-Max 400', method: 'lookup', data: TMY_DATA, source: 'Kodak F-4016 + Bond' },
  { name: 'T-Max 100', method: 'power', p: 1.15, source: 'Kodak F-4016' },
  { name: 'Tri-X 320', method: 'lookup', data: TRIX_DATA, source: 'Kodak F-4017' },
  { name: 'Provia 100F', method: 'provia', source: 'Fuji data sheet', note: 'No correction up to 128s' },
  { name: 'Portra 160', method: 'portra', source: 'Sachs/community R²=0.995' },
  { name: 'Portra 400', method: 'portra', source: 'Same curve as 160' },
];

const FILM_STOCKS_120: FilmStock[] = [
  { name: 'SFX 200', method: 'power', p: 1.43, source: 'Ilford official PDF' },
  { name: 'Tri-X 400', method: 'lookup', data: TRIX_DATA, source: 'Kodak F-4017' },
  { name: 'T-Max 400', method: 'lookup', data: TMY_DATA, source: 'Kodak F-4016 + Bond' },
  { name: 'T-Max 100', method: 'power', p: 1.15, source: 'Kodak F-4016' },
];

function calculate(stock: FilmStock, metered: number): number {
  if (metered < 1) return metered; // No correction below 1s
  switch (stock.method) {
    case 'power':
      return Math.max(metered, Math.pow(metered, stock.p!));
    case 'lookup':
      return lookupReciprocity(metered, stock.data!);
    case 'portra': {
      const stops = 0.5167 * Math.log(metered) - 0.2;
      return stops > 0 ? metered * Math.pow(2, stops) : metered;
    }
    case 'provia':
      if (metered <= 128) return metered;
      if (metered <= 240) return metered * Math.pow(2, 0.33);
      return metered * Math.pow(2, 0.5);
    default:
      return metered;
  }
}

function formatTime(seconds: number): string {
  if (seconds < 1) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function stopsCorrection(metered: number, adjusted: number): string {
  if (adjusted <= metered) return '+0';
  const stops = Math.log2(adjusted / metered);
  return `+${stops.toFixed(1)}`;
}

// ─────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────

export default function ReciprocityScreen() {
  const navigation = useNavigation<any>();
  const [format, setFormat] = useState<'4x5' | '120'>('4x5');
  const [selectedStock, setSelectedStock] = useState(0);
  const [inputTime, setInputTime] = useState('');

  const stocks = format === '4x5' ? FILM_STOCKS_4x5 : FILM_STOCKS_120;
  const stock = stocks[selectedStock];
  const metered = parseFloat(inputTime) || 0;

  const result = useMemo(() => {
    if (metered <= 0) return null;
    const adjusted = calculate(stock, metered);
    return {
      adjusted,
      formatted: formatTime(adjusted),
      stops: stopsCorrection(metered, adjusted),
      meteredFormatted: formatTime(metered),
    };
  }, [stock, metered]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Reciprocity Calculator</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Format Toggle */}
        <View style={styles.formatRow}>
          {(['4x5', '120'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.formatBtn, format === f && styles.formatBtnActive]}
              onPress={() => { setFormat(f); setSelectedStock(0); }}
            >
              <Text style={[styles.formatText, format === f && styles.formatTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Film Stock Picker */}
        <View style={styles.stockGrid}>
          {stocks.map((s, i) => (
            <TouchableOpacity
              key={s.name}
              style={[styles.stockBtn, selectedStock === i && styles.stockBtnActive]}
              onPress={() => setSelectedStock(i)}
            >
              <Text style={[styles.stockName, selectedStock === i && styles.stockNameActive]} numberOfLines={1}>
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Source info */}
        <Text style={styles.sourceText}>{stock.source}</Text>
        {stock.note && <Text style={styles.noteText}>{stock.note}</Text>}

        {/* Time Input */}
        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>METERED TIME (SECONDS)</Text>
          <TextInput
            style={styles.input}
            value={inputTime}
            onChangeText={setInputTime}
            keyboardType="decimal-pad"
            placeholder="Enter seconds..."
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
          />
        </View>

        {/* Quick Buttons */}
        <View style={styles.quickRow}>
          {[1, 2, 4, 8, 10, 15, 30, 60].map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.quickBtn, inputTime === String(t) && styles.quickBtnActive]}
              onPress={() => setInputTime(String(t))}
            >
              <Text style={[styles.quickText, inputTime === String(t) && styles.quickTextActive]}>
                {t}s
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Result */}
        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>ADJUSTED EXPOSURE</Text>
            <Text style={styles.resultTime}>{result.formatted}</Text>
            <View style={styles.resultMeta}>
              <Text style={styles.resultStops}>{result.stops} stops correction</Text>
              <Text style={styles.resultOriginal}>from {result.meteredFormatted} metered</Text>
            </View>
          </View>
        )}

        {/* Reference Table */}
        <View style={styles.tableSection}>
          <Text style={styles.tableTitle}>REFERENCE TABLE — {stock.name}</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderCell}>Metered</Text>
            <Text style={styles.tableHeaderCell}>Adjusted</Text>
            <Text style={styles.tableHeaderCell}>Stops</Text>
          </View>
          {[1, 2, 4, 8, 10, 15, 30, 60, 120, 240].map(t => {
            const adj = calculate(stock, t);
            const stops = stopsCorrection(t, adj);
            const isHighlighted = Math.abs(t - metered) < 0.5;
            return (
              <View key={t} style={[styles.tableRow, isHighlighted && styles.tableRowHighlight]}>
                <Text style={[styles.tableCell, isHighlighted && styles.tableCellHighlight]}>
                  {formatTime(t)}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellBold, isHighlighted && styles.tableCellHighlight]}>
                  {formatTime(adj)}
                </Text>
                <Text style={[styles.tableCell, isHighlighted && styles.tableCellHighlight]}>
                  {stops}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
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

  formatRow: {
    flexDirection: 'row', marginHorizontal: spacing.xl, marginTop: spacing.lg,
    borderRadius: radius.md, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  formatBtn: {
    flex: 1, paddingVertical: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surface,
  },
  formatBtnActive: { backgroundColor: colors.accent },
  formatText: { fontSize: 14, fontWeight: '600', color: colors.textTertiary },
  formatTextActive: { color: '#fff' },

  stockGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.xs,
  },
  stockBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  stockBtnActive: { borderColor: colors.accent, backgroundColor: '#1a1a2e' },
  stockName: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  stockNameActive: { color: colors.accent },

  sourceText: {
    fontSize: 10, color: colors.textTertiary,
    paddingHorizontal: spacing.xl, marginTop: spacing.sm,
  },
  noteText: {
    fontSize: 10, color: colors.signalWarning || '#d4a017',
    paddingHorizontal: spacing.xl, marginTop: 2,
  },

  inputSection: { paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  inputLabel: { ...typography.labelMedium, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 24, fontWeight: '600', color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    textAlign: 'center',
  },

  quickRow: {
    flexDirection: 'row', paddingHorizontal: spacing.lg,
    marginTop: spacing.md, gap: spacing.xs, flexWrap: 'wrap',
  },
  quickBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    minWidth: 38, alignItems: 'center',
  },
  quickBtnActive: { borderColor: colors.accent },
  quickText: { fontSize: 12, fontWeight: '500', color: colors.textTertiary },
  quickTextActive: { color: colors.accent },

  resultCard: {
    marginHorizontal: spacing.xl, marginTop: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.xl, alignItems: 'center',
    borderWidth: 1, borderColor: colors.accent,
  },
  resultLabel: { ...typography.labelMedium, color: colors.textTertiary, marginBottom: spacing.sm },
  resultTime: { fontSize: 36, fontWeight: '700', color: colors.textPrimary },
  resultMeta: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  resultStops: { fontSize: 12, color: colors.accent, fontWeight: '500' },
  resultOriginal: { fontSize: 12, color: colors.textTertiary },

  tableSection: {
    marginHorizontal: spacing.xl, marginTop: spacing.xl,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  tableTitle: { ...typography.labelMedium, marginBottom: spacing.md },
  tableHeader: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border, paddingBottom: spacing.sm, marginBottom: spacing.xs,
  },
  tableHeaderCell: { flex: 1, fontSize: 10, fontWeight: '600', color: colors.textTertiary, textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  tableRowHighlight: { backgroundColor: '#1a1a2e', borderRadius: radius.sm },
  tableCell: { flex: 1, fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  tableCellBold: { fontWeight: '600', color: colors.textPrimary },
  tableCellHighlight: { color: colors.accent },
});
