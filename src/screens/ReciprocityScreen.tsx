import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Dimensions, Vibration, Modal,
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
  const [targetTime, setTargetTime] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  type FilterDef = { name: string; stops: number; note?: string };
  const FILTERS: FilterDef[] = [
    { name: 'Polarizer', stops: 1.5, note: '1–2 stops, varies with angle' },
    { name: 'Red 25', stops: 3 },
    { name: 'Red 29', stops: 4 },
    { name: 'Hoya R72', stops: 4, note: 'Ilford rates 4 stops for SFX 200. Some shoot at 5 — bracket.' },
    { name: 'ND64 (6-stop)', stops: 6 },
    { name: '3-stop ND', stops: 3 },
  ];

  const toggleFilter = (name: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalFilterStops = useMemo(() => {
    let total = 0;
    FILTERS.forEach(f => { if (activeFilters.has(f.name)) total += f.stops; });
    return total;
  }, [activeFilters]);

  const totalFilterFactor = useMemo(() => Math.pow(2, totalFilterStops), [totalFilterStops]);

  const stocks = format === '4x5' ? FILM_STOCKS_4x5 : FILM_STOCKS_120;
  const stock = stocks[selectedStock];
  const metered = parseFloat(inputTime) || 0;

  // Timer state
  const [timerActive, setTimerActive] = useState(false);
  const [timerPhase, setTimerPhase] = useState<'countdown' | 'running' | 'done'>('countdown');
  const [countdownValue, setCountdownValue] = useState(3);
  const [remainingMs, setRemainingMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const exposureMsRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    clearTimer();
    setTimerActive(false);
  }, [clearTimer]);

  const startTimer = useCallback((adjustedSeconds: number) => {
    clearTimer();
    const expMs = Math.round(adjustedSeconds * 1000);
    exposureMsRef.current = expMs;
    setTotalMs(expMs);
    setTimerPhase('countdown');
    setCountdownValue(3);
    setTimerActive(true);

    // 3-second countdown
    let count = 3;
    Vibration.vibrate(100);

    timerRef.current = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdownValue(count);
        Vibration.vibrate(100);
      } else {
        // Countdown done — start exposure timer
        clearTimer();
        Vibration.vibrate([0, 300, 100, 300]); // double buzz = GO
        setTimerPhase('running');
        setRemainingMs(exposureMsRef.current);
        startTimeRef.current = Date.now();

        timerRef.current = setInterval(() => {
          const elapsed = Date.now() - startTimeRef.current;
          const remaining = exposureMsRef.current - elapsed;
          if (remaining <= 0) {
            clearTimer();
            setRemainingMs(0);
            setTimerPhase('done');
            Vibration.vibrate([0, 500, 200, 500, 200, 500]); // triple buzz = DONE
          } else {
            setRemainingMs(remaining);
          }
        }, 100);
      }
    }, 1000);
  }, [clearTimer]);

  useEffect(() => {
    return () => clearTimer(); // cleanup on unmount
  }, [clearTimer]);

  function formatTimerDisplay(ms: number): string {
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) return `${totalSec}`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatTimerLabel(ms: number): string {
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) return 'seconds';
    return 'min:sec';
  }

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

  // Aperture adjustment calculation
  const apertureAdj = useMemo(() => {
    const target = parseFloat(targetTime);
    if (!result || !target || target <= 0) return null;
    if (Math.abs(result.adjusted - target) < 0.5) return null; // no adjustment needed

    // How many stops between the reciprocity result and the target?
    const stopsDiff = Math.log2(result.adjusted / target);

    // Calculate new f-stop: each stop = sqrt(2) change in f-number
    // Opening up = smaller f-number, closing down = larger f-number
    const baseF = 22;
    const newF = baseF / Math.pow(2, stopsDiff / 2);

    // Find nearest standard f-stop (third stops)
    const thirdStops = [
      1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5,
      4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20,
      22, 25, 29, 32, 36, 40, 45, 51, 57, 64,
    ];
    const nearestF = thirdStops.reduce((prev, curr) =>
      Math.abs(curr - newF) < Math.abs(prev - newF) ? curr : prev
    );

    const direction = stopsDiff > 0 ? 'Open' : 'Close';

    return {
      stopsDiff: Math.abs(stopsDiff),
      direction,
      newF,
      nearestF,
      targetSeconds: target,
    };
  }, [result, targetTime]);

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
            <TouchableOpacity
              style={styles.timerBtn}
              onPress={() => startTimer(apertureAdj ? apertureAdj.targetSeconds : result.adjusted)}
            >
              <Ionicons name="timer-outline" size={18} color={colors.accent} />
              <Text style={styles.timerBtnText}>
                Start Timer{apertureAdj ? ` (${formatTime(apertureAdj.targetSeconds)})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Aperture Adjustment */}
        {result && (
          <View style={styles.apertureSection}>
            <Text style={styles.inputLabel}>TARGET EXPOSURE TIME (OPTIONAL)</Text>
            <TextInput
              style={styles.apertureInput}
              value={targetTime}
              onChangeText={setTargetTime}
              keyboardType="decimal-pad"
              placeholder="Desired actual seconds..."
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
            />
            {apertureAdj && (
              <View style={styles.apertureResult}>
                <Text style={styles.apertureDirection}>
                  {apertureAdj.direction} {apertureAdj.stopsDiff.toFixed(1)} stops from f/22
                </Text>
                <Text style={styles.apertureValue}>
                  f/{apertureAdj.nearestF}
                </Text>
                <Text style={styles.apertureSub}>
                  Shoot at f/{apertureAdj.nearestF} for ~{formatTime(apertureAdj.targetSeconds)} actual exposure
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Timer Overlay */}
        <Modal
          visible={timerActive}
          animationType="fade"
          statusBarTranslucent
          onRequestClose={stopTimer}
        >
          <View style={styles.timerOverlay}>
            {timerPhase === 'countdown' && (
              <View style={styles.timerCenter}>
                <Text style={styles.timerLabel}>GET READY</Text>
                <Text style={styles.timerCountdown}>{countdownValue}</Text>
                <Text style={styles.timerSub}>Open shutter when timer starts</Text>
              </View>
            )}

            {timerPhase === 'running' && (
              <View style={styles.timerCenter}>
                <Text style={styles.timerLabel}>EXPOSING — {stock.name}</Text>
                <Text style={styles.timerRunning}>{formatTimerDisplay(remainingMs)}</Text>
                <Text style={styles.timerUnit}>{formatTimerLabel(remainingMs)}</Text>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.max(0, Math.min(100, ((totalMs - remainingMs) / totalMs) * 100))}%` },
                    ]}
                  />
                </View>
                <Text style={styles.timerElapsed}>
                  {formatTime(Math.round((totalMs - remainingMs) / 1000))} of {formatTime(Math.round(totalMs / 1000))}
                </Text>
              </View>
            )}

            {timerPhase === 'done' && (
              <View style={styles.timerCenter}>
                <Text style={styles.timerLabel}>EXPOSURE COMPLETE</Text>
                <Ionicons name="checkmark-circle" size={80} color="#4CAF50" />
                <Text style={styles.timerDoneText}>Close shutter</Text>
                <Text style={styles.timerSub}>{formatTime(Math.round(totalMs / 1000))} on {stock.name}</Text>
              </View>
            )}

            <TouchableOpacity style={styles.timerStopBtn} onPress={stopTimer}>
              <Text style={styles.timerStopText}>
                {timerPhase === 'done' ? 'Done' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {/* Filter Reference */}
        <View style={styles.filterSection}>
          <Text style={styles.filterTitle}>FILTER STACK</Text>
          <View style={styles.filterGrid}>
            {FILTERS.map(f => {
              const active = activeFilters.has(f.name);
              return (
                <TouchableOpacity
                  key={f.name}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => toggleFilter(f.name)}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {f.name}
                  </Text>
                  <Text style={[styles.filterChipStops, active && styles.filterChipStopsActive]}>
                    +{f.stops}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {activeFilters.size > 0 && (
            <View style={styles.filterResult}>
              <Text style={styles.filterResultLabel}>COMBINED</Text>
              <Text style={styles.filterResultValue}>+{totalFilterStops} stops</Text>
              <Text style={styles.filterResultFactor}>{totalFilterFactor.toFixed(0)}× factor</Text>
              {metered > 0 && (
                <Text style={styles.filterResultExample}>
                  {formatTime(metered)} metered → {formatTime(metered * totalFilterFactor)} with filters
                </Text>
              )}
            </View>
          )}
          {FILTERS.filter(f => f.note && activeFilters.has(f.name)).map(f => (
            <Text key={f.name} style={styles.filterNote}>⚠ {f.name}: {f.note}</Text>
          ))}
        </View>

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
  formatBtnActive: { backgroundColor: '#1a1a2e', borderBottomWidth: 2, borderBottomColor: colors.accent },
  formatText: { fontSize: 14, fontWeight: '600', color: colors.textTertiary },
  formatTextActive: { color: colors.accent },

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

  // Timer button
  timerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, backgroundColor: '#1a1a2e',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent,
  },
  timerBtnText: { fontSize: 14, fontWeight: '600', color: colors.accent },

  // Aperture adjustment
  apertureSection: {
    marginHorizontal: spacing.xl, marginTop: spacing.lg,
  },
  apertureInput: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    fontSize: 18, fontWeight: '600', color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    textAlign: 'center', marginTop: spacing.sm,
  },
  apertureResult: {
    marginTop: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.lg, alignItems: 'center',
    borderWidth: 1, borderColor: '#d4a017',
  },
  apertureDirection: {
    fontSize: 13, fontWeight: '600', color: '#d4a017',
  },
  apertureValue: {
    fontSize: 32, fontWeight: '700', color: colors.textPrimary, marginVertical: spacing.sm,
  },
  apertureSub: {
    fontSize: 11, color: colors.textTertiary, textAlign: 'center',
  },

  // Filter stack
  filterSection: {
    marginHorizontal: spacing.xl, marginTop: spacing.xl,
  },
  filterTitle: { ...typography.labelMedium, marginBottom: spacing.md },
  filterGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: {
    borderColor: colors.accent, backgroundColor: '#1a1a2e',
  },
  filterChipText: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  filterChipTextActive: { color: colors.textPrimary },
  filterChipStops: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
  filterChipStopsActive: { color: colors.accent },
  filterResult: {
    marginTop: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.lg, alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  filterResultLabel: { fontSize: 10, fontWeight: '600', color: colors.textTertiary, letterSpacing: 1 },
  filterResultValue: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, marginVertical: spacing.xs },
  filterResultFactor: { fontSize: 13, color: colors.accent, fontWeight: '500' },
  filterResultExample: { fontSize: 11, color: colors.textTertiary, marginTop: spacing.sm },
  filterNote: { fontSize: 10, color: '#d4a017', marginTop: spacing.xs, paddingHorizontal: spacing.xs },

  // Timer overlay
  timerOverlay: {
    flex: 1, backgroundColor: '#000',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  timerCenter: { alignItems: 'center', justifyContent: 'center' },
  timerLabel: {
    fontSize: 12, fontWeight: '700', letterSpacing: 2,
    color: colors.textTertiary, marginBottom: spacing.lg,
  },
  timerCountdown: {
    fontSize: 120, fontWeight: '200', color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  timerRunning: {
    fontSize: 80, fontWeight: '300', color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  timerUnit: {
    fontSize: 14, color: colors.textTertiary, marginTop: spacing.xs,
  },
  timerSub: {
    fontSize: 14, color: colors.textTertiary, marginTop: spacing.xl,
  },
  timerDoneText: {
    fontSize: 24, fontWeight: '600', color: '#4CAF50', marginTop: spacing.lg,
  },
  timerElapsed: {
    fontSize: 12, color: colors.textTertiary, marginTop: spacing.md,
  },
  progressBarBg: {
    width: width - spacing.xl * 4, height: 4,
    backgroundColor: '#1a1a2e', borderRadius: 2, marginTop: spacing.xl,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4, backgroundColor: colors.accent, borderRadius: 2,
  },
  timerStopBtn: {
    position: 'absolute', bottom: 60,
    paddingHorizontal: spacing.xl * 2, paddingVertical: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  timerStopText: { fontSize: 16, fontWeight: '500', color: colors.textSecondary },
});
