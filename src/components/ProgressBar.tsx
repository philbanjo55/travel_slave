import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The thin green bar of the planning strip (PlanningStrip), shared by every wait that has real progress to show
// (Phil, 27 Nov 2026: progress bars instead of spinners, never a made-up timer).
//   fraction: 0..1 of the whole job, or null when the source gives no amount (then only the steps fill).
//   steps + step: named stages; the bar is one segment per stage, done stages full, the current one filled by
//     `within` (0..1 inside that stage, when the source counts it), later ones empty.
//   text: the short line above the bar (defaults to the current step's name); detail: the grey part after it.
// The accessibility label starts "Progress:" so the emulator checks can find every bar; the line's own text stays a
// separate text node (the checks also read the old wait texts, e.g. "Drawing the terrain", from the start of a line).
export type ProgressProps = {
  label: string;
  text?: string;
  detail?: string | null;
  fraction?: number | null;
  steps?: string[];
  step?: number;
  within?: number | null;
  compact?: boolean;
  count?: string | null;   // the right-hand count instead of "2 of 4" / "50%" (null = none)
};

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export default function ProgressBar({ label, text, detail, fraction, steps, step = 0, within, compact, count: countIn }: ProgressProps) {
  const n = steps?.length ?? 0;
  const i = n ? Math.max(0, Math.min(n - 1, step)) : 0;
  const line = text ?? (n ? steps![i] : '');
  const count = countIn !== undefined ? countIn ?? '' : n ? `${i + 1} of ${n}` : fraction != null ? `${Math.round(clamp(fraction) * 100)}%` : '';
  const a11y = `Progress: ${label}${line ? `, ${line}` : ''}${detail ? `, ${detail}` : ''}${n ? `, step ${i + 1} of ${n}` : fraction != null ? `, ${Math.round(clamp(fraction) * 100)} percent` : ''}`;
  return (
    <View style={[styles.wrap, compact && { gap: 3 }]} accessibilityRole="progressbar" accessibilityLabel={a11y}
      accessibilityValue={n ? { min: 0, max: n, now: i + (within != null ? clamp(within) : 0) } : fraction != null ? { min: 0, max: 100, now: Math.round(clamp(fraction) * 100) } : undefined}>
      {line || count ? (
        <View style={styles.row}>
          <Text style={styles.text} numberOfLines={1}>
            {line}{detail ? <Text style={styles.sub}>{`  ·  ${detail}`}</Text> : null}
          </Text>
          {count ? <Text style={styles.count}>{count}</Text> : null}
        </View>
      ) : null}
      {n ? (
        <View style={styles.segs}>
          {steps!.map((s, k) => {
            const f = k < i ? 1 : k > i ? 0 : within != null ? clamp(within) : 0;
            return (
              <View key={`${k}-${s}`} style={[styles.track, { flex: 1 }]}>
                {f > 0 ? <View style={[styles.fill, { width: `${f * 100}%` }]} /> : null}
              </View>
            );
          })}
        </View>
      ) : <ProgressTrack fraction={fraction ?? null} />}
    </View>
  );
}

// The bare bar (track 3 px, green fill); `min` keeps a sliver showing once something has started.
export function ProgressTrack({ fraction, min = 2 }: { fraction: number | null; min?: number }) {
  return (
    <View style={styles.track}>
      {fraction != null && fraction > 0 ? <View style={[styles.fill, { width: `${Math.max(clamp(fraction) * 100, min)}%` }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  sub: { fontWeight: '400', color: colors.textSecondary },
  count: { fontSize: 11, color: colors.textSecondary },
  segs: { flexDirection: 'row', gap: 3 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.signalOk },
});
