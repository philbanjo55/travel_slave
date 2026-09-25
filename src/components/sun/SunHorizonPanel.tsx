import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import {
  Pair, Light, MoonPos, SUN_UP_GEO, fmtMinute, lightAt, moonPosition, relAngle, skylineAt,
} from '../../utils/sunEngine';
import { MOON, SHADED_SUN, SUN } from './sunStyle';

// The horizon as you see it facing the subject: subject straight ahead in the
// middle, directly behind you at both edges. The subject's skyline in grey,
// the day's sun path over it (dashed grey where a ridge shades the subject),
// the moon's path in blue, and the band above 35° where light is from above.
// Drawn with plain views, so no new native library is needed.

type Props = {
  pair: Pair;
  day0: number;
  light: Light;
  moon: MoonPos;
  height?: number;
};

const TOP = 50, BOTTOM = -3, PAD = 14, SKY = 22;

export default function SunHorizonPanel({ pair, day0, light, moon, height = 190 }: Props) {
  const [W, setW] = useState(0);
  const H = height;
  const b = pair.bearing ?? 0;
  const ex = (rel: number) => ((rel + 180) / 360) * W;
  const ey = (alt: number) => SKY + ((TOP - Math.max(BOTTOM, Math.min(TOP, alt))) / (TOP - BOTTOM)) * (H - PAD - SKY);

  // Everything that does not move with the time slider, drawn once per pair.
  const still = useMemo(() => {
    if (!W) return null;
    const ground = H - PAD;
    const cols: { x: number; w: number; y: number }[] = [];
    for (let k = -180; k < 180; k += 2) {
      const h = skylineAt(pair.s_sky, b + k + 1);
      const y = h == null ? ey(0) : ey(h);
      cols.push({ x: ex(k), w: W / 180 + 0.6, y: Math.min(y, ground) });
    }
    const sunDots: { x: number; y: number; lit: boolean }[] = [];
    const moonDots: { x: number; y: number }[] = [];
    const hours: { x: number; y: number; t: string }[] = [];
    for (let m = 0; m <= 1440; m += 5) {
      const ms = day0 + m * 60000;
      const l = lightAt(pair, ms);
      if (l.sun.geo >= SUN_UP_GEO) {
        const x = ex(relAngle(l.sun.az, b)), y = ey(l.sun.alt);
        sunDots.push({ x, y, lit: l.label !== 'in shadow' });
        if (m % 180 === 0 && m > 0 && m < 1440) hours.push({ x, y, t: fmtMinute(m).replace(':00', '') });
      }
      if (m % 10 === 0) {
        const mo = moonPosition(ms, pair.v.lat, pair.v.lng);
        if (mo.geo >= SUN_UP_GEO) moonDots.push({ x: ex(relAngle(mo.az, b)), y: ey(mo.alt) });
      }
    }
    const compass = ([[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as [number, string][])
      .map(([az, t]) => ({ x: ex(relAngle(az, b)), t }))
      .filter(c => c.x > 8 && c.x < W - 8);
    return { cols, sunDots, moonDots, hours, compass, ground };
  }, [pair.vantage_id, day0, W, H]);

  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));
  const band = ey(35);
  const zones = [
    { a: -180, z: -135, bg: 'rgba(240,176,74,0.10)' }, { a: -135, z: -45, bg: 'rgba(134,99,42,0.10)' },
    { a: -45, z: 45, bg: 'rgba(68,104,196,0.14)' }, { a: 45, z: 135, bg: 'rgba(134,99,42,0.10)' },
    { a: 135, z: 180, bg: 'rgba(240,176,74,0.10)' },
  ];
  const zoneLabels = [
    { r: -157.5, t: 'BEHIND\nFRONT', c: '#F0B04A' }, { r: -90, t: 'LEFT\nSIDE', c: '#c9a060' },
    { r: 0, t: 'AHEAD\nBACKLIT', c: '#8fa8e8' }, { r: 90, t: 'RIGHT\nSIDE', c: '#c9a060' },
    { r: 157.5, t: 'BEHIND\nFRONT', c: '#F0B04A' },
  ];
  const sunUp = light.sun.geo >= SUN_UP_GEO;
  const moonUp = moon.geo >= SUN_UP_GEO;

  // The same element object on every render, so moving the time slider only
  // redraws the sun and moon, not the ~500 views of terrain and paths.
  const stillLayer = useMemo(() => (!W || !still ? null : (
    <>
            {zones.map((z, i) => (
              <View key={i} style={{ position: 'absolute', top: band, bottom: PAD, left: ex(z.a), width: ex(z.z) - ex(z.a), backgroundColor: z.bg }} />
            ))}
            <View style={[styles.topBand, { height: band }]} />
            <Text style={styles.topBandText}>TOP LIGHT · SUN HIGHER THAN 35°</Text>
            {zoneLabels.map((z, i) => (
              <Text key={i} style={[styles.zoneLabel, { top: band + 4, left: Math.max(40, Math.min(W - 40, ex(z.r))) - 40, color: z.c }]}>{z.t}</Text>
            ))}
            {still.cols.map((c, i) => (
              <View key={`t${i}`} style={[styles.col, { left: c.x, width: c.w, top: c.y, height: Math.max(0, still.ground - c.y) }]} />
            ))}
            <View style={[styles.ahead, { left: ex(0) - 0.5, top: SKY, height: H - PAD - SKY }]} />
            {still.moonDots.map((d, i) => (
              <View key={`m${i}`} style={[styles.dot, { left: d.x - 1, top: d.y - 1, width: 2, height: 2, backgroundColor: MOON, opacity: 0.8 }]} />
            ))}
            <View style={[styles.zero, { top: ey(0) }]} />
            {still.sunDots.map((d, i) => (
              <View
                key={`s${i}`}
                style={[styles.dot, d.lit
                  ? { left: d.x - 1.5, top: d.y - 1.5, width: 3, height: 3, backgroundColor: SUN }
                  : { left: d.x - 1, top: d.y - 1, width: 2, height: 2, backgroundColor: SHADED_SUN }]}
              />
            ))}
            {still.hours.map((h, i) => (
              <React.Fragment key={`h${i}`}>
                <View style={[styles.dot, { left: h.x - 2, top: h.y - 2, width: 4, height: 4, backgroundColor: '#ffffff' }]} />
                <Text style={[styles.hourText, { left: h.x - 20, top: Math.max(SKY, h.y - 17) }]}>{h.t}</Text>
              </React.Fragment>
            ))}
            <View style={[styles.subject, { left: ex(0) - 6, top: ey(0) - 12 }]} />
            {still.compass.map((c, i) => (
              <Text key={`c${i}`} style={[styles.compass, { left: c.x - 10 }]}>{c.t}</Text>
            ))}
    </>
  )), [still, W, H]);

  return (
    <View>
      <View style={[styles.box, { height: H }]} onLayout={onLayout}>
        {!!W && still && (
          <>
            {stillLayer}
            {moonUp && (
              <View style={[styles.body, { left: ex(relAngle(moon.az, b)) - 5, top: ey(moon.alt) - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: MOON }]} />
            )}
            {sunUp && (
              <View style={[styles.body, {
                left: ex(relAngle(light.sun.az, b)) - 7, top: ey(light.sun.alt) - 7, width: 14, height: 14, borderRadius: 7,
                backgroundColor: light.label === 'in shadow' ? SHADED_SUN : SUN,
              }]} />
            )}
          </>
        )}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>← behind you</Text>
        <Text style={[styles.legendText, { color: '#ffffff' }]}>▲ {pair.subject_name.replace(/\s*\(.*$/, '')}</Text>
        <Text style={styles.legendText}>behind you →</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#07090c' },
  topBand: {
    position: 'absolute', left: 0, right: 0, top: 0,
    backgroundColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1, borderBottomColor: '#666666',
  },
  topBandText: {
    position: 'absolute', left: 0, right: 0, top: 5, textAlign: 'center',
    fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: '#d0d0d0',
  },
  zoneLabel: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 8, lineHeight: 10, fontWeight: '700', letterSpacing: 0.6 },
  col: { position: 'absolute', backgroundColor: '#262626', borderTopWidth: 1.2, borderTopColor: '#9a9a9a' },
  ahead: { position: 'absolute', width: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  zero: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#555555' },
  dot: { position: 'absolute', borderRadius: 2 },
  hourText: { position: 'absolute', width: 40, textAlign: 'center', fontSize: 9, color: '#cccccc' },
  subject: {
    position: 'absolute', width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#ffffff',
  },
  body: { position: 'absolute', borderWidth: 1.5, borderColor: '#000000' },
  compass: { position: 'absolute', bottom: 1, width: 20, textAlign: 'center', fontSize: 9, fontWeight: '700', color: '#777777' },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  legendText: { fontSize: 10, color: '#888888' },
});
