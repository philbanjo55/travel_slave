import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { SUN3D_HTML } from './sun3dHtml';
import { nearFor, regionFor, terrainData, TerrainNear, TerrainRegion } from '../../services/terrain';
import { fmtMinute, sunPosition } from '../../utils/sunEngine';
import type { Pair, SkyPos } from '../../utils/sunEngine';
import { compassPoint } from './sunStyle';

// 3D view of the shot (TEST app, Phil 12 Nov 2026): the real terrain from the
// stand spot toward the subject, lit by the sun at the slider's time. The
// terrain file is saved on the phone, so it works with no signal. The page
// inside the web view is tools/sun3d/app_view.js (built into sun3dHtml.ts); it
// does the drawing, this component feeds it the place, the sun and the lens.
// Close shots (Faroes) also get a small fine grid around the stand spot and the
// subject, when one is listed; the page draws it inside the wide one.

type Props = {
  pair: Pair;
  sun: SkyPos;                 // from the section's own sun engine, at the slider's time
  day0: number;                // start of the stop's local day, ms
  height?: number;             // inline height; ignored when full
  full?: boolean;
  onJump: (minute: number) => void;
  onFull: () => void;          // open or close full screen
};

// The package's prop types don't resolve against this React Native version's types; the props used below are its documented ones.
const Web = WebView as unknown as React.ComponentType<any>;

type Phase = 'finding' | 'none' | 'loading' | 'failed' | 'starting' | 'ready' | 'error';
type Moments = { firstSubject: number | null; lastSubject: number | null; firstHere: number | null; lastHere: number | null };
const LENSES = [24, 50, 100];
const CHUNK = 240000;   // base64 characters per message to the page; a multiple of 4

export default function Sun3DPanel({ pair, sun, day0, height = 208, full, onJump, onFull }: Props) {
  const web = useRef<any>(null);
  const [phase, setPhase] = useState<Phase>('finding');
  const [region, setRegion] = useState<TerrainRegion | null>(null);
  const [near, setNear] = useState<TerrainNear | null>(null);
  const [b64, setB64] = useState<string | null>(null);
  const [nearB64, setNearB64] = useState<string | null>(null);
  const [focal, setFocal] = useState(50);
  const [lit, setLit] = useState<{ subjectLit: boolean; hereLit: boolean; up: boolean } | null>(null);
  const [moments, setMoments] = useState<Moments | null>(null);
  const [look, setLook] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const booted = useRef(false);
  const sent = useRef(false);
  const loaded = useRef<string | null>(null);   // the files the page holds: "<region>|<fine box or nothing>"
  const ready = phase === 'ready';

  const run = useCallback((js: string) => { web.current?.injectJavaScript(`${js};true;`); }, []);

  // Which terrain files this shot needs (the wide one for the stand spot, plus a fine box that holds
  // both the stand spot and the subject), then the files themselves (from the phone when saved).
  const vLat = pair.v.lat, vLng = pair.v.lng, sLat = pair.s.lat, sLng = pair.s.lng;
  useEffect(() => {
    let alive = true;
    (async () => {
      const stand = { lat: vLat, lng: vLng };
      const r = await regionFor(stand);
      const nr = r ? await nearFor(r, stand, { lat: sLat, lng: sLng }) : null;
      if (!alive) return;
      if (r && loaded.current === `${r.id}|${nr?.id ?? ''}`) return;   // same files: the page only gets the new view
      loaded.current = null; booted.current = false; sent.current = false;
      setPhase('finding'); setRegion(null); setNear(null); setB64(null); setNearB64(null); setLit(null); setMoments(null);
      if (!r) { setPhase('none'); return; }
      setPhase('loading');
      const [d, nd] = await Promise.all([terrainData(r), nr ? terrainData(nr) : Promise.resolve(null)]);
      if (!alive) return;
      if (!d) { setPhase('failed'); return; }
      // No fine file (no signal the first time): the wide grid alone still draws, and the next shot tries again.
      loaded.current = `${r.id}|${nr && nd ? nr.id : ''}`;
      setRegion(r); setNear(nr && nd ? nr : null); setB64(d); setNearB64(nr && nd ? nd : null); setPhase('starting');
    })();
    return () => { alive = false; };
  }, [vLat, vLng, sLat, sLng]);

  const dayPath = useMemo(() => {
    const out: number[][] = [];
    for (let m = 0; m < 1440; m += 4) {
      const s = sunPosition(day0 + m * 60000, vLat, vLng);
      if (s.alt > -2.5) out.push([m, Math.round(s.az * 100) / 100, Math.round(s.alt * 100) / 100]);
    }
    return out;
  }, [day0, vLat, vLng]);

  // Hand the page its place and the terrain once both the page and the file are there.
  const start = useCallback(() => {
    if (!booted.current || sent.current || !region || !b64) return;
    sent.current = true;
    const cfg = {
      n: region.n, north: region.north, south: region.south, west: region.west, east: region.east,
      W: region.width_m, D: region.depth_m, base: region.base_m, step: region.step_m, ground: region.ground,
      eye: pair.v, target: pair.s, focal,
      near: near && nearB64
        ? { n: near.n, north: near.north, south: near.south, west: near.west, east: near.east, base: near.base_m, step: near.step_m }
        : undefined,
    };
    run(`window.S3D.init(${JSON.stringify(cfg)})`);
    for (let i = 0; i < b64.length; i += CHUNK) run(`window.S3D.chunk("${b64.slice(i, i + CHUNK)}")`);
    if (near && nearB64) for (let i = 0; i < nearB64.length; i += CHUNK) run(`window.S3D.chunk("${nearB64.slice(i, i + CHUNK)}","near")`);
    run('window.S3D.done()');
  }, [region, near, b64, nearB64, pair.v, pair.s, focal, run]);
  useEffect(() => { start(); }, [start]);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let m: any = null;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'boot') { booted.current = true; start(); }
    else if (m.type === 'ready') setPhase('ready');
    else if (m.type === 'state') setLit({ subjectLit: !!m.subjectLit, hereLit: !!m.hereLit, up: !!m.up });
    else if (m.type === 'moments') setMoments({ firstSubject: m.firstSubject ?? null, lastSubject: m.lastSubject ?? null, firstHere: m.firstHere ?? null, lastHere: m.lastHere ?? null });
    else if (m.type === 'look') setLook(typeof m.deg === 'number' ? m.deg : null);
    else if (m.type === 'error') { setProblem(String(m.msg ?? '')); setPhase(p => (p === 'ready' ? p : 'error')); }
  }, [start]);

  // The sun follows the slider; the place and the day's first / last light follow the chosen shot.
  const az = sun.az, alt = sun.alt;
  useEffect(() => { if (ready) run(`window.S3D.sun(${az.toFixed(3)},${alt.toFixed(3)})`); }, [ready, az, alt, run]);
  useEffect(() => {
    if (!ready) return;
    setMoments(null);
    run(`window.S3D.view(${vLat},${vLng},${sLat},${sLng})`);
    run(`window.S3D.path(${JSON.stringify(dayPath)})`);
  }, [ready, vLat, vLng, sLat, sLng, dayPath, run]);
  useEffect(() => { if (ready) run(`window.S3D.focal(${focal})`); }, [ready, focal, run]);

  const waiting = phase === 'finding' ? 'Finding the terrain for this spot…'
    : phase === 'loading' ? 'Getting the terrain (once, a few MB)…'
    : phase === 'starting' ? 'Drawing the terrain…'
    : phase === 'none' ? 'No 3D terrain for this area yet.'
    : phase === 'failed' ? "Couldn't get the terrain. It needs a signal the first time."
    : null;
  const subject = pair.subject_name || 'The subject';
  const chips: { label: string; minute: number | null }[] = moments ? [
    { label: `First sun on ${subject}`, minute: moments.firstSubject },
    { label: 'Sun reaches you', minute: moments.firstHere },
    { label: 'You lose the sun', minute: moments.lastHere },
    { label: `Last sun on ${subject}`, minute: moments.lastSubject },
  ] : [];

  return (
    <View style={full ? styles.fullWrap : undefined} accessibilityLabel={`3D view ${ready ? 'ready' : phase}`}>
      <View style={[styles.frame, full ? styles.frameFull : { height }]}>
        {region && b64 ? (
          <Web
            ref={web}
            key={`${region.id}|${near?.id ?? ''}`}
            source={{ html: SUN3D_HTML }}
            originWhitelist={['*']}
            javaScriptEnabled
            onMessage={onMessage}
            scrollEnabled={false}
            overScrollMode="never"
            setSupportMultipleWindows={false}
            androidLayerType="hardware"
            style={styles.web}
          />
        ) : null}
        {waiting ? (
          <View style={styles.cover} pointerEvents="none"><Text style={styles.coverText}>{waiting}</Text></View>
        ) : null}
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.lens} accessibilityRole="tablist">
            {LENSES.map(f => (
              <TouchableOpacity
                key={f}
                onPress={() => setFocal(f)}
                style={[styles.lensBtn, focal === f && styles.lensOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: focal === f }}
                accessibilityLabel={`${f} millimetre lens`}
              >
                <Text style={[styles.lensText, focal === f && styles.lensTextOn]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={onFull} style={styles.fullBtn} accessibilityRole="button" accessibilityLabel={full ? 'Close full screen' : 'Open the 3D view full screen'} hitSlop={6}>
            <Ionicons name={full ? 'contract-outline' : 'expand-outline'} size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
        {ready && look != null ? (
          <Text style={styles.caption} pointerEvents="none">Looking {compassPoint(look)} {look}° · {focal} mm · drag to look around</Text>
        ) : null}
      </View>

      {ready && lit ? (
        <Text style={styles.status}>
          <Text style={lit.subjectLit ? styles.sunOn : undefined}>{subject}: {lit.subjectLit ? 'in the sun' : lit.up ? 'in shadow' : 'no sun'}</Text>
          <Text>  ·  </Text>
          <Text style={lit.hereLit ? styles.sunOn : undefined}>You: {lit.hereLit ? 'in the sun' : lit.up ? 'in shade' : 'no sun'}</Text>
        </Text>
      ) : phase === 'error' && problem ? (
        <Text style={styles.status}>{problem}</Text>
      ) : null}

      {chips.length > 0 && (
        <View style={styles.moments}>
          {chips.map(c => (
            <TouchableOpacity
              key={c.label}
              style={styles.moment}
              disabled={c.minute == null}
              onPress={() => c.minute != null && onJump(c.minute)}
              accessibilityRole="button"
              accessibilityLabel={`${c.label}: ${c.minute == null ? 'not this day' : fmtMinute(c.minute)}`}
            >
              <Text style={styles.momentLabel} numberOfLines={2}>{c.label}</Text>
              <Text style={styles.momentTime}>{c.minute == null ? '—' : fmtMinute(c.minute)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {ready ? <Text style={styles.note}>Terrain shape and calculated sun only: no trees, buildings or clouds. Times are within a few minutes. Elevation data: ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullWrap: { flex: 1 },
  frame: { borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  frameFull: { flex: 1, borderRadius: 0, borderWidth: 0 },
  web: { flex: 1, backgroundColor: colors.surface },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.surface },
  coverText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  topRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lens: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.55)' },
  lensBtn: { minWidth: 40, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  lensOn: { backgroundColor: '#ffffff' },
  lensText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  lensTextOn: { color: '#000000' },
  fullBtn: { width: 36, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.55)' },
  caption: { position: 'absolute', left: 10, right: 10, bottom: 8, color: '#ffffff', fontSize: 11, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  status: { color: colors.textSecondary, fontSize: 13, marginTop: 8, paddingHorizontal: 2 },
  sunOn: { color: '#F0B04A', fontWeight: '700' },
  moments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  moment: { flexGrow: 1, flexBasis: '47%', minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  momentLabel: { color: colors.textSecondary, fontSize: 11 },
  momentTime: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  note: { color: colors.textTertiary, fontSize: 11, marginTop: 8, paddingHorizontal: 2 },
});
