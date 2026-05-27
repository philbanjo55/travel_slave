import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';

// ─────────────────────────────────────────────────────
// CALCULATION ENGINE
// Focus spread (knob turns) → aperture, for the Chamonix 45F-2.
// MM_PER_TURN is a property of the camera's focusing gear (not the lens),
// so the same value applies to the 135mm, 300mm, or any lens on this body.
// ─────────────────────────────────────────────────────

const MM_PER_TURN = 1.28; // Chamonix 45F-2, calibrated (two 8-turn runs @ 1.275mm/turn)

// spread (mm) → f-number, from QT Long's focus-spread tables. Each row = one full stop.
const OPTIMAL: [number, number][] = [
  [1, 16], [2, 22], [3, 32], [5, 45], [10, 64],
];
const ACCEPTABLE: [number, number][] = [
  [2, 16], [3, 22], [4, 32], [6, 45], [10, 64],
];

// Third-stop marks the lens actually carries (some lenses mark 28/50 instead of 29/51).
const THIRD_STOPS = [16, 18, 20, 22, 25, 29, 32, 36, 40, 45, 51, 57, 64];

// Mode A — nearest whole-stop row (ties → larger spread = more DOF)
function pickWhole(table: [number, number][], spreadMm: number): number {
  let best = table[0];
  let bestDist = Infinity;
  for (const row of table) {
    const dist = Math.abs(row[0] - spreadMm);
    if (dist < bestDist || (dist === bestDist && row[0] > best[0])) {
      best = row;
      bestDist = dist;
    }
  }
  return best[1];
}

// Mode B — interpolate linearly on the f-NUMBER, then snap to nearest third the lens marks.
// (Linear in f-number, not in "stops" — never interpolate stops.)
function pickThirds(table: [number, number][], spreadMm: number): number {
  if (spreadMm <= table[0][0]) return table[0][1];                       // clamp low
  if (spreadMm >= table[table.length - 1][0]) return table[table.length - 1][1]; // clamp high
  let lo = table[0];
  let hi = table[table.length - 1];
  for (let i = 0; i < table.length - 1; i++) {
    if (spreadMm >= table[i][0] && spreadMm <= table[i + 1][0]) {
      lo = table[i];
      hi = table[i + 1];
      break;
    }
  }
  const n = lo[1] + (hi[1] - lo[1]) * (spreadMm - lo[0]) / (hi[0] - lo[0]);
  return THIRD_STOPS.reduce((prev, curr) =>
    Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev
  );
}

// The two whole stops the measured spread sits between (for the "between" hint).
function bracketWhole(table: [number, number][], spreadMm: number): [number, number] | null {
  if (spreadMm <= table[0][0] || spreadMm >= table[table.length - 1][0]) return null;
  for (let i = 0; i < table.length - 1; i++) {
    if (spreadMm >= table[i][0] && spreadMm <= table[i + 1][0]) {
      return [table[i][1], table[i + 1][1]];
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────

export default function FocusSpreadScreen() {
  const navigation = useNavigation<any>();
  const [unit, setUnit] = useState<'turns' | 'mm'>('turns');
  const [mode, setMode] = useState<'thirds' | 'whole'>('thirds');
  const [input, setInput] = useState('');

  const raw = parseFloat(input) || 0;
  const spreadMm = unit === 'turns' ? raw * MM_PER_TURN : raw;

  const result = useMemo(() => {
    if (spreadMm <= 0) return null;

    const pick = mode === 'thirds' ? pickThirds : pickWhole;
    const optimal = pick(OPTIMAL, spreadMm);
    const acceptable = pick(ACCEPTABLE, spreadMm);

    // Half the spread, expressed in turns, is the dial-back to center the plane of focus.
    const totalTurns = spreadMm / MM_PER_TURN;
    const centerTurns = totalTurns / 2;

    const optBracket = mode === 'thirds' ? bracketWhole(OPTIMAL, spreadMm) : null;
    const accBracket = mode === 'thirds' ? bracketWhole(ACCEPTABLE, spreadMm) : null;

    // Flags
    let flag: string | null = null;
    if (spreadMm > 10) {
      flag = 'Spread too large — use tilt to reduce it, or accept diffraction softening at f/64.';
    } else if (spreadMm < OPTIMAL[0][0]) {
      flag = 'Minimal stopping down needed; f/16 or wider is fine.';
    }

    return {
      optimal, acceptable, centerTurns, totalTurns,
      optBracket, accBracket, flag,
    };
  }, [spreadMm, mode]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Focus Spread → Aperture</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Unit Toggle */}
        <View style={styles.formatRow}>
          {(['turns', 'mm'] as const).map(u => (
            <TouchableOpacity
              key={u}
              style={[styles.formatBtn, unit === u && styles.formatBtnActive]}
              onPress={() => setUnit(u)}
            >
              <Text style={[styles.formatText, unit === u && styles.formatTextActive]}>
                {u === 'turns' ? 'KNOB TURNS' : 'MILLIMETERS'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mode Toggle */}
        <View style={styles.modeRow}>
          {(['thirds', 'whole'] as const).map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                {m === 'thirds' ? 'Thirds' : 'Whole stops'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sourceText}>
          Chamonix 45F-2 · {MM_PER_TURN}mm/turn · QT Long focus-spread tables
        </Text>

        {/* Spread Input */}
        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>
            FOCUS SPREAD ({unit === 'turns' ? 'KNOB TURNS' : 'MM'})
          </Text>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            placeholder={unit === 'turns' ? 'Turns between near & far...' : 'mm between near & far...'}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
          />
          {spreadMm > 0 && (
            <Text style={styles.conversionText}>
              {unit === 'turns'
                ? `${raw} turns = ${spreadMm.toFixed(2)} mm`
                : `${raw} mm = ${(spreadMm / MM_PER_TURN).toFixed(2)} turns`}
            </Text>
          )}
        </View>

        {/* Quick Buttons (turns) */}
        {unit === 'turns' && (
          <View style={styles.quickRow}>
            {[1, 2, 3, 4, 5, 6, 8].map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.quickBtn, input === String(t) && styles.quickBtnActive]}
                onPress={() => setInput(String(t))}
              >
                <Text style={[styles.quickText, input === String(t) && styles.quickTextActive]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Results */}
        {result && (
          <>
            <View style={styles.resultRow}>
              <View style={[styles.resultCard, styles.resultCardHalf]}>
                <Text style={styles.resultLabel}>OPTIMAL</Text>
                <Text style={styles.resultF}>f/{result.optimal}</Text>
                {result.optBracket && (
                  <Text style={styles.bracketText}>
                    between f/{result.optBracket[0]} & f/{result.optBracket[1]}
                  </Text>
                )}
                <Text style={styles.resultSub}>edge-to-edge sharp</Text>
              </View>
              <View style={[styles.resultCard, styles.resultCardHalf, styles.resultCardAcc]}>
                <Text style={styles.resultLabel}>ACCEPTABLE</Text>
                <Text style={styles.resultF}>f/{result.acceptable}</Text>
                {result.accBracket && (
                  <Text style={styles.bracketText}>
                    between f/{result.accBracket[0]} & f/{result.accBracket[1]}
                  </Text>
                )}
                <Text style={styles.resultSub}>~1 stop wider, faster shutter</Text>
              </View>
            </View>

            {/* Center focus */}
            <View style={styles.centerCard}>
              <Text style={styles.resultLabel}>CENTER THE FOCUS</Text>
              <Text style={styles.centerTurns}>
                {result.centerTurns.toFixed(2)} turns
              </Text>
              <Text style={styles.centerSub}>
                Dial back {result.centerTurns.toFixed(2)} turns from either the near or far
                mark to put the plane of focus in the middle of the spread.
              </Text>
            </View>

            {result.flag && (
              <Text style={styles.flagText}>⚠ {result.flag}</Text>
            )}
          </>
        )}

        {/* Reference Table */}
        <View style={styles.tableSection}>
          <Text style={styles.tableTitle}>REFERENCE — {mode === 'thirds' ? 'THIRDS' : 'WHOLE STOPS'}</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderCell}>Turns</Text>
            <Text style={styles.tableHeaderCell}>Spread</Text>
            <Text style={styles.tableHeaderCell}>Optimal</Text>
            <Text style={styles.tableHeaderCell}>Accept.</Text>
            <Text style={styles.tableHeaderCell}>Center</Text>
          </View>
          {[1, 2, 3, 4, 5, 6, 8].map(t => {
            const mm = t * MM_PER_TURN;
            const pick = mode === 'thirds' ? pickThirds : pickWhole;
            const isHighlighted = unit === 'turns' && Math.abs(t - raw) < 0.05;
            return (
              <View key={t} style={[styles.tableRow, isHighlighted && styles.tableRowHighlight]}>
                <Text style={[styles.tableCell, isHighlighted && styles.tableCellHighlight]}>{t}</Text>
                <Text style={[styles.tableCell, isHighlighted && styles.tableCellHighlight]}>{mm.toFixed(1)}mm</Text>
                <Text style={[styles.tableCell, styles.tableCellBold, isHighlighted && styles.tableCellHighlight]}>f/{pick(OPTIMAL, mm)}</Text>
                <Text style={[styles.tableCell, isHighlighted && styles.tableCellHighlight]}>f/{pick(ACCEPTABLE, mm)}</Text>
                <Text style={[styles.tableCell, isHighlighted && styles.tableCellHighlight]}>{(t / 2).toFixed(1)}</Text>
              </View>
            );
          })}
        </View>

        {/* Field workflow */}
        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>FIELD WORKFLOW</Text>
          <Text style={styles.helpStep}>1. Tilt? Receding plane (ground/water to distance) → tilt. Frontal wall (cliff, waterfall face) → skip.</Text>
          <Text style={styles.helpStep}>2. If tilting, set it first — focus near with the knob, tilt to bring far in, iterate 2–3× until both lock.</Text>
          <Text style={styles.helpStep}>3. Measure spread — focus near, focus far, count knob turns between = your spread.</Text>
          <Text style={styles.helpStep}>4. Read the aperture above (optimal / acceptable).</Text>
          <Text style={styles.helpStep}>5. Center — dial back half the turns to put the plane in the middle.</Text>
          <Text style={styles.helpStep}>6. Expose — meter, place highlights, apply reciprocity.</Text>
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
  formatText: { fontSize: 12, fontWeight: '600', color: colors.textTertiary, letterSpacing: 1 },
  formatTextActive: { color: colors.accent },

  modeRow: {
    flexDirection: 'row', marginHorizontal: spacing.xl, marginTop: spacing.sm,
    gap: spacing.sm,
  },
  modeBtn: {
    flex: 1, paddingVertical: 6, alignItems: 'center',
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  modeBtnActive: { borderColor: colors.accent, backgroundColor: '#1a1a2e' },
  modeText: { fontSize: 12, fontWeight: '500', color: colors.textTertiary },
  modeTextActive: { color: colors.accent },

  sourceText: {
    fontSize: 10, color: colors.textTertiary,
    paddingHorizontal: spacing.xl, marginTop: spacing.sm,
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
  conversionText: {
    fontSize: 11, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm,
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

  resultRow: {
    flexDirection: 'row', marginHorizontal: spacing.xl, marginTop: spacing.lg, gap: spacing.md,
  },
  resultCard: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.lg, alignItems: 'center',
    borderWidth: 1, borderColor: colors.accent,
  },
  resultCardHalf: { flex: 1 },
  resultCardAcc: { borderColor: '#d4a017' },
  resultLabel: { ...typography.labelMedium, color: colors.textTertiary, marginBottom: spacing.xs },
  resultF: { fontSize: 34, fontWeight: '700', color: colors.textPrimary },
  bracketText: { fontSize: 10, color: colors.textTertiary, marginTop: 2 },
  resultSub: { fontSize: 10, color: colors.textTertiary, marginTop: spacing.xs, textAlign: 'center' },

  centerCard: {
    marginHorizontal: spacing.xl, marginTop: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.xl, alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  centerTurns: { fontSize: 36, fontWeight: '700', color: colors.textPrimary, marginVertical: spacing.xs },
  centerSub: { fontSize: 11, color: colors.textTertiary, textAlign: 'center', lineHeight: 16 },

  flagText: {
    fontSize: 11, color: '#d4a017', marginHorizontal: spacing.xl,
    marginTop: spacing.md, lineHeight: 16,
  },

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
  tableCell: { flex: 1, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  tableCellBold: { fontWeight: '600', color: colors.textPrimary },
  tableCellHighlight: { color: colors.accent },

  helpSection: {
    marginHorizontal: spacing.xl, marginTop: spacing.xl,
  },
  helpTitle: { ...typography.labelMedium, marginBottom: spacing.md },
  helpStep: { fontSize: 11, color: colors.textTertiary, lineHeight: 18, marginBottom: spacing.xs },
});
