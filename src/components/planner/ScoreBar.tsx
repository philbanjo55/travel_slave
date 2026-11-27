import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';

// Two-tone "% of a perfect day" bar (redesign A1b, read-only): white up to your day,
// dark green on to T's best. mine null = your day has no score (best only).
export const GREEN_DARK = '#1f4d2e';

export function ScoreBar({ mine, best, height = 6 }: { mine: number | null | undefined; best: number | null | undefined; height?: number }) {
  const m = Math.max(0, Math.min(100, mine ?? 0)), b = Math.max(m, Math.min(100, best ?? 0));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      {b > m ? <View style={[styles.fill, { left: `${m}%`, width: `${b - m}%`, backgroundColor: mine == null ? colors.signalOk : GREEN_DARK }]} /> : null}
      {mine != null && m > 0 ? <View style={[styles.fill, { left: 0, width: `${Math.max(m, 1.5)}%`, backgroundColor: colors.textPrimary }]} /> : null}
    </View>
  );
}

// "52% → 63%", "63%" (same, or no score for your day), "—" (nothing rated).
export function ScoreText({ mine, best, style }: { mine: number | null | undefined; best: number | null | undefined; style?: any }) {
  if (best == null && mine == null) return <Text style={style}>—</Text>;
  if (mine == null || best == null || mine === best) return <Text style={style}>{best ?? mine}%</Text>;
  return (
    <Text style={style}>
      {mine}% <Text style={{ color: colors.textTertiary }}>→</Text> <Text style={{ color: colors.signalOk, fontWeight: '700' }}>{best}%</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', backgroundColor: colors.border, overflow: 'hidden', position: 'relative' },
  fill: { position: 'absolute', top: 0, bottom: 0 },
});

// Good shots of the big subjects (Phil, 3 Nov 2026): "0.4 → 1.3" (your day → T's plan), "1.3"
// (same, or no score for your day), "—" (no plan). Same look as ScoreText.
const shots = (x: number) => (x >= 9.95 ? String(Math.round(x)) : x.toFixed(1));
export function ShotsText({ mine, best, style }: { mine: number | null | undefined; best: number | null | undefined; style?: any }) {
  if (best == null && mine == null) return <Text style={style}>—</Text>;
  if (mine == null || best == null || shots(mine) === shots(best)) return <Text style={style}>{shots((best ?? mine)!)}</Text>;
  return (
    <Text style={style}>
      {shots(mine)} <Text style={{ color: colors.textTertiary }}>→</Text> <Text style={{ color: colors.signalOk, fontWeight: '700' }}>{shots(best)}</Text>
    </Text>
  );
}
