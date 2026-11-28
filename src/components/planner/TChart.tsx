import React, { useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import { colors } from '../../theme';
import { minutesLabel, tzMinutes } from '../../services/planner';
import { TSlot, bestWindow } from '../../services/tCurve';

// Charts for the planner look round 2 (Phil, 28 Nov 2026; mockup https://claude.ai/artifact/5o13SQdCPoAyhJzDwwez9P), drawn
// with plain Views (no SVG package in the app): an area (thin columns) under a line (short rotated bars), the GOOD line
// at 60, the best window shaded with a dot, your time as a white line, and touch-and-drag for the exact numbers.

const GREEN = colors.signalOk;
const H = 128, L = 6, R = 6, T = 16, B = 18;

type Pt = { x: number; y: number };
function Segment({ a, b, color, width = 2 }: { a: Pt; b: Pt; color: string; width?: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - width / 2, width: len + 0.5, height: width,
    backgroundColor: color, borderRadius: width / 2, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
}
function Dashes({ x0, x1, y, color, dash = 3, gap = 4, h = 1 }: { x0: number; x1: number; y: number; color: string; dash?: number; gap?: number; h?: number }) {
  const out: React.ReactNode[] = [];
  for (let x = x0; x < x1; x += dash + gap) out.push(<View key={x} pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: Math.min(dash, x1 - x), height: h, backgroundColor: color }} />);
  return <>{out}</>;
}

// The day's chart. slots null = no forecast that day: `typical` (0-100 per slot, light only) is drawn dotted grey.
export function TDayChart({ slots, typical, tz, youMin, youLabel }: {
  slots: TSlot[] | null; typical?: { t: string; pct: number }[] | null; tz?: string; youMin: number | null; youLabel: string | null;
}) {
  const [w, setW] = useState(0);
  const [touch, setTouch] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const data: { t: string; pct: number; good?: number; of?: number }[] = slots ?? typical ?? [];
  const n = data.length;
  const dim = !slots;
  const x = (i: number) => L + (w - L - R) * (n > 1 ? i / (n - 1) : 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - Math.max(0, Math.min(100, v)) / 100);
  const mins = data.map(s => tzMinutes(s.t, tz) ?? 0);
  const best = slots ? bestWindow(slots) : null;
  let you: number | null = null;
  if (youMin != null && n) {
    let bi = 0;
    mins.forEach((m, i) => { if (Math.abs(m - youMin) < Math.abs(mins[bi] - youMin)) bi = i; });
    if (Math.abs(mins[bi] - youMin) <= 20) you = bi;
  }
  const pick = (px: number) => Math.max(0, Math.min(n - 1, Math.round(((px - L) / Math.max(1, w - L - R)) * (n - 1))));
  const colW = n > 1 ? (w - L - R) / (n - 1) : 4;
  const tip = touch != null && n ? data[touch] : null;
  return (
    <View onLayout={onLayout} style={{ height: H }} accessibilityLabel={dim ? 'Typical light only: no forecast for this day yet' : 'How good each 15 minutes is'}>
      {w > 0 && n > 0 ? (
        <>
          {best ? <View pointerEvents="none" style={[s.bestBox, { left: x(best[0]) - 3, width: Math.max(6, x(best[1]) - x(best[0]) + 6) }]} /> : null}
          <Dashes x0={L} x1={w - R} y={y(60)} color="rgba(90,170,122,0.55)" />
          <Text style={[s.goodLab, { top: y(60) - 13 }]}>GOOD</Text>
          <View pointerEvents="none" style={[s.base, { top: y(0), left: L, width: w - L - R }]} />
          {dim ? data.map((d, i) => (
            <View key={i} pointerEvents="none" style={{ position: 'absolute', left: x(i) - 1, top: y(d.pct) - 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#6a6a6a' }} />
          )) : (
            <>
              {data.map((d, i) => (
                <View key={`a${i}`} pointerEvents="none" style={{ position: 'absolute', left: x(i) - colW / 2, top: y(d.pct), width: colW + 0.5, height: Math.max(0, y(0) - y(d.pct)),
                  backgroundColor: 'rgba(90,170,122,0.16)' }} />
              ))}
              {data.slice(1).map((d, i) => <Segment key={`l${i}`} a={{ x: x(i), y: y(data[i].pct) }} b={{ x: x(i + 1), y: y(d.pct) }} color={GREEN} />)}
            </>
          )}
          {you != null ? (
            <>
              <View pointerEvents="none" style={[s.you, { left: x(you) - 0.75, top: T - 8, height: y(0) - T + 8 }]} />
              <Text pointerEvents="none" style={[s.youLab, x(you) > w - 70 ? { right: w - x(you) + 4, textAlign: 'right' } : { left: x(you) + 4 }]}>YOU{youLabel ? ` ${youLabel}` : ''}</Text>
            </>
          ) : null}
          {best ? (
            <>
              <Text pointerEvents="none" style={[s.bestLab, { right: Math.max(0, w - x(best[1]) - 3) }]}>BEST</Text>
              <View pointerEvents="none" style={[s.dot, { left: x(best[0]) - 5, top: y(data[best[0]].pct) - 5 }]} />
            </>
          ) : null}
          {mins.map((m, i) => (m % 120 === 0 ? (
            <Text key={`t${i}`} pointerEvents="none" style={[s.tick, { left: x(i) - 12 }]}>{String(((Math.floor(m / 60) + 11) % 12) + 1)}</Text>
          ) : null))}
          {tip ? (
            <>
              <View pointerEvents="none" style={[s.cross, { left: x(touch!) - 0.5, top: T - 8, height: y(0) - T + 8 }]} />
              <View pointerEvents="none" style={[s.tip, x(touch!) > w / 2 ? { right: w - x(touch!) + 6 } : { left: x(touch!) + 6 }, { top: Math.max(0, y(tip.pct) - 30) }]}>
                <Text style={s.tipText}>
                  {minutesLabel(mins[touch!])} · <Text style={s.tipNum}>{tip.pct}%</Text>{tip.of ? ` · good in ${tip.good} of ${tip.of}` : dim ? ' · typical' : ''}
                </Text>
              </View>
            </>
          ) : null}
          <View style={StyleSheet.absoluteFill}
            onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
            onResponderGrant={e => setTouch(pick(e.nativeEvent.locationX))}
            onResponderMove={e => setTouch(pick(e.nativeEvent.locationX))}
            onResponderRelease={() => setTouch(null)} onResponderTerminate={() => setTouch(null)}
            onResponderTerminationRequest={() => true} />
        </>
      ) : null}
    </View>
  );
}

// A tiny curve for a day card or a week tile. values 0-100; null = no forecast (a dotted flat line).
export function MiniCurve({ values, width, height, dim }: { values: number[] | null | undefined; width: number; height: number; dim?: boolean }) {
  if (!values || values.length < 2) {
    return (
      <View style={{ width, height }} pointerEvents="none">
        <Dashes x0={2} x1={width - 2} y={height - 4} color="#4a4a4a" dash={2} gap={3} />
      </View>
    );
  }
  const n = values.length;
  const x = (i: number) => 1 + ((width - 2) * i) / (n - 1);
  const y = (v: number) => height - 1.5 - ((height - 3) * Math.max(0, Math.min(100, v))) / 100;
  const cw = (width - 2) / (n - 1);
  const line = dim ? '#5a6a60' : GREEN;
  return (
    <View style={{ width, height }} pointerEvents="none">
      {values.map((v, i) => (
        <View key={`a${i}`} style={{ position: 'absolute', left: x(i) - cw / 2, top: y(v), width: cw + 0.3, height: Math.max(0, height - 1.5 - y(v)),
          backgroundColor: dim ? 'rgba(90,170,122,0.10)' : 'rgba(90,170,122,0.22)' }} />
      ))}
      {values.slice(1).map((v, i) => <Segment key={`l${i}`} a={{ x: x(i), y: y(values[i]) }} b={{ x: x(i + 1), y: y(v) }} color={line} width={1.5} />)}
    </View>
  );
}

const s = StyleSheet.create({
  bestBox: { position: 'absolute', top: T - 8, height: H - T - B + 8, borderRadius: 4, backgroundColor: 'rgba(90,170,122,0.12)' },
  goodLab: { position: 'absolute', left: L + 2, fontSize: 9, fontWeight: '700', color: GREEN },
  base: { position: 'absolute', height: 1, backgroundColor: '#2a2a2a' },
  you: { position: 'absolute', width: 1.5, backgroundColor: 'rgba(255,255,255,0.7)' },
  youLab: { position: 'absolute', top: 0, fontSize: 9, fontWeight: '700', color: '#dddddd' },
  bestLab: { position: 'absolute', top: 0, fontSize: 9, fontWeight: '800', color: GREEN },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN, borderWidth: 2, borderColor: colors.surface },
  tick: { position: 'absolute', bottom: 0, width: 24, textAlign: 'center', fontSize: 9, color: '#666666' },
  cross: { position: 'absolute', width: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  tip: { position: 'absolute', backgroundColor: '#1d1d1d', borderWidth: 1, borderColor: '#333333', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tipText: { fontSize: 11, color: colors.textPrimary },
  tipNum: { fontWeight: '700' },
});
