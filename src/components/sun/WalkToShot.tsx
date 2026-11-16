import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { Pair } from '../../utils/sunEngine';
import { bearingDeg, distanceM } from '../../utils/sunEngine';
import { compassPoint, shotName } from './sunStyle';

// Walk to shot (Phil, 16 Nov 2026: "directions to the exact lat/long and then also the bearing of where to view").
// A live arrow to the shot's stand spot from the phone's GPS and compass, the distance, and Google Maps walking
// directions. Once there (within the GPS's own accuracy, at least 6 m) the arrow turns to the way to aim: the saved
// framing's heading, else the line to the subject. Works with no signal (GPS and compass need none); only the
// Google Maps button needs one.

const ARRIVE_M = 6;

const norm = (d: number) => ((d % 360) + 360) % 360;

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

type Props = {
  pair: Pair | null;
  visible: boolean;
  onClose: () => void;
  onOpen3d?: () => void;   // "Open in 3D" once there
};

export default function WalkToShot({ pair, visible, onClose, onOpen3d }: Props) {
  const insets = useSafeAreaInsets();
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number | null } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [perm, setPerm] = useState<'asking' | 'ok' | 'no'>('asking');
  const smooth = useRef<{ x: number; y: number } | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const subs: { remove: () => void }[] = [];
    smooth.current = null;
    setPerm('asking');
    (async () => {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (!alive) return;
        if (p.status !== 'granted') { setPerm('no'); return; }
        setPerm('ok');
        subs.push(await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          l => { if (alive) setPos({ lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? null }); },
        ));
        try {
          subs.push(await Location.watchHeadingAsync(h => {
            if (!alive) return;
            const deg = h.trueHeading != null && h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            if (deg == null || deg < 0) return;
            // a little smoothing so the arrow doesn't shake (on the circle, so 359 -> 1 doesn't swing round)
            const r = (deg * Math.PI) / 180, s = smooth.current;
            const n = s ? { x: s.x * 0.7 + Math.sin(r) * 0.3, y: s.y * 0.7 + Math.cos(r) * 0.3 } : { x: Math.sin(r), y: Math.cos(r) };
            smooth.current = n;
            setHeading(norm((Math.atan2(n.x, n.y) * 180) / Math.PI));
          }));
        } catch { /* no compass: the screen says the heading in degrees instead */ }
      } catch {
        if (alive) setPerm('no');
      }
    })();
    return () => { alive = false; subs.forEach(s => { try { s.remove(); } catch { /* gone */ } }); };
  }, [visible, tries]);

  const directions = useCallback(() => {
    if (!pair) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${pair.v.lat},${pair.v.lng}&travelmode=walking`).catch(() => {});
  }, [pair]);

  if (!pair) return null;
  const aim = pair.framing?.heading ?? pair.bearing ?? null;
  const dist = pos ? distanceM(pos, pair.v) : null;
  const to = pos ? bearingDeg(pos, pair.v) : null;
  const there = dist != null && dist <= Math.max(ARRIVE_M, pos?.acc ?? 0);
  const target = there ? aim : to;
  const turn = target != null && heading != null ? norm(target - heading) : null;
  const title = `${pair.code ? `${pair.code} · ` : ''}${shotName(pair)}`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.head}>
          <Text style={styles.title} numberOfLines={1} accessibilityLabel={`Walk to ${title}`}>Walk to {title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close walk to shot" hitSlop={8}>
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.middle}>
          {perm === 'no' ? (
            <>
              <Text style={styles.big}>Location is off</Text>
              <TouchableOpacity onPress={() => setTries(t => t + 1)} style={styles.btn} accessibilityRole="button">
                <Text style={styles.btnText}>Allow location</Text>
              </TouchableOpacity>
            </>
          ) : !pos ? (
            <Text style={styles.sub}>Finding you…</Text>
          ) : (
            <>
              <View style={[styles.dial, there && styles.dialThere]}>
                {turn != null ? (
                  <View style={{ transform: [{ rotate: `${turn}deg` }] }} accessibilityLabel={there ? 'Arrow: the way to aim' : 'Arrow: the way to walk'}>
                    <Ionicons name="arrow-up" size={120} color={there ? '#5aaa7a' : '#ffffff'} />
                  </View>
                ) : (
                  <Ionicons name="navigate-outline" size={72} color="#888888" />
                )}
              </View>
              {there ? (
                <>
                  <Text style={[styles.big, { color: '#5aaa7a' }]} accessibilityLabel="You're there">You're there</Text>
                  {aim != null ? <Text style={styles.aim}>Aim {Math.round(norm(aim))}° {compassPoint(aim)}</Text> : null}
                </>
              ) : (
                <>
                  <Text style={styles.big} accessibilityLabel={`Distance ${fmtDist(dist!)}`}>{fmtDist(dist!)}</Text>
                  {heading == null && to != null ? <Text style={styles.sub}>Head {Math.round(to)}° {compassPoint(to)}</Text> : null}
                  {aim != null ? <Text style={styles.sub}>Then aim {Math.round(norm(aim))}° {compassPoint(aim)}</Text> : null}
                </>
              )}
              <Text style={styles.small}>
                GPS ±{pos.acc != null ? Math.round(pos.acc) : '?'} m{heading == null ? ' · no compass' : ''}
              </Text>
            </>
          )}
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity onPress={directions} style={styles.btn} accessibilityRole="button" accessibilityLabel="Walking directions in Google Maps">
            <Ionicons name="walk-outline" size={18} color="#ffffff" />
            <Text style={styles.btnText}>Directions</Text>
          </TouchableOpacity>
          {onOpen3d ? (
            <TouchableOpacity onPress={onOpen3d} style={[styles.btn, there && styles.btnOn]} accessibilityRole="button" accessibilityLabel="Open this shot in 3D">
              <Ionicons name="cube-outline" size={18} color={there ? '#000000' : '#ffffff'} />
              <Text style={[styles.btnText, there && { color: '#000000' }]}>Open in 3D</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000', paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  title: { flex: 1, color: '#ffffff', fontSize: 17, fontWeight: '700' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  dial: { width: 220, height: 220, borderRadius: 110, borderWidth: 2, borderColor: '#2a2a2a', backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  dialThere: { borderColor: '#5aaa7a' },
  big: { color: '#ffffff', fontSize: 40, fontWeight: '700' },
  aim: { color: '#ffffff', fontSize: 26, fontWeight: '700' },
  sub: { color: '#aaaaaa', fontSize: 16 },
  small: { color: '#888888', fontSize: 12, marginTop: 6 },
  buttons: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111111', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  btnOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  btnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
