import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { SUN3D_HTML } from './sun3dHtml';
import { SUN3D_GOOGLE_HTML } from './sun3dGoogleHtml';
import { detailFor, detailMask, detailTrees, detailWater, nearFor, regionFor, terrainData, TerrainDetail, TerrainNear, TerrainRegion, tripTerrainLine, useTripTerrain } from '../../services/terrain';
import { hdForget, hdLeftThisMonth, hdLeftToday, hdRoot, hdSetup, HdSetup } from '../../services/tiles3d';
import { fmtMinute, sunPosition } from '../../utils/sunEngine';
import { moveVantage } from '../../services/sunPlan';
import type { Pair, SkyPos } from '../../utils/sunEngine';
import { compassPoint } from './sunStyle';

// 3D view of the shot (TEST app, Phil 12 Nov 2026): the real terrain from the
// stand spot toward the subject, lit by the sun at the slider's time. The
// terrain file is saved on the phone, so it works with no signal. The page
// inside the web view is tools/sun3d/app_view.js (built into sun3dHtml.ts); it
// does the drawing, this component feeds it the place, the sun and the lens.
// Where a fine grid is listed around the stand spot (Faroes close-ups, Teton
// foregrounds) the shot gets that too; the page draws it inside the wide one.
// Where a detail box is listed around the stand spot (Grand Teton, from a 2022
// laser survey) the shot gets its heights and class mask as well: buildings
// and water near you are drawn as shapes, trees as points you can see between.
// Trees never change the sun times (the survey was flown in summer); the page
// only says when they would block the sun, and the panel passes that on in one
// line. The Foreground button (leaf, on by default, remembered while the app is
// open) turns the detail box off: the page is started again without it, so it
// draws exactly what it drew before this level existed.
// The plain view always comes first: the foreground's files are handed to the
// page only after it has said 'ready', and the page builds them in steps. If the
// web view's process dies with the foreground on (a small phone), the view is
// started once more without it and one line says so.
//
// HD (optional, off until tapped): the same view drawn on Google's 3D picture
// (tools/sun3d/app_view_google.js -> sun3dGoogleHtml.ts), lit by the same
// calculated sun. The button shows only when the phone is online and the tiles
// door says it is switched on (services/tiles3d); with the door off this panel
// is the offline one, unchanged. It needs a signal and nothing of it is kept;
// if it fails the offline view comes back by itself. Google's attribution
// (Google Maps logo, data credits, and the line saying which part is Google's)
// is drawn by the page along the bottom of the picture: nothing of ours may sit
// on it, so our caption moves to the top while HD is on. The HD page lights
// Google's surface from the wide grid alone, so it is not sent the fine grid.

type Props = {
  pair: Pair;
  tripId?: string | null;      // for the "terrain saved for this trip" line
  stopId?: string | null;      // with tripId: lets walk mode save a new stand spot for this shot
  sun: SkyPos;                 // from the section's own sun engine, at the slider's time
  day0: number;                // start of the stop's local day, ms
  height?: number;             // inline height; ignored when full
  full?: boolean;
  onJump: (minute: number) => void;
  onFull: () => void;          // open or close full screen
  hdOn?: boolean;              // HD wanted (kept by the parent so full screen opens the way the small view was)
  onHd?: (on: boolean) => void;
};

// The package's prop types don't resolve against this React Native version's types; the props used below are its documented ones.
const Web = WebView as unknown as React.ComponentType<any>;

type Phase = 'finding' | 'none' | 'loading' | 'failed' | 'starting' | 'ready' | 'error';
type Moments = { firstSubject: number | null; lastSubject: number | null; firstHere: number | null; lastHere: number | null; trees: boolean };
// Phil's cameras (12 Nov 2026): his 4x5 lenses, and the Fuji GW690III (a fixed 90 mm lens on 6x9 roll film).
// `long` x `short` is the film's open area in mm; the page works the view out from that, so 135 here is what a
// 135 mm lens sees on 4x5. Checked against Phil's own Snake River Overlook frame from the Fuji: the model's skyline
// sits on the photo's within about 0.1% of the frame width once the picture's crop is allowed for.
type Lens = { id: string; f: number; long: number; short: number; label: string; format: string };
const LENSES: Lens[] = [
  { id: '75', f: 75, long: 120, short: 96, label: '75', format: '4×5' },
  { id: '90', f: 90, long: 120, short: 96, label: '90', format: '4×5' },
  { id: '135', f: 135, long: 120, short: 96, label: '135', format: '4×5' },
  { id: '300', f: 300, long: 120, short: 96, label: '300', format: '4×5' },
  { id: 'gw690', f: 90, long: 82.6, short: 56, label: '6×9', format: '6×9 (GW690)' },
];
type FrameMode = 'land' | 'port' | 'off';
const FRAME_NEXT: Record<FrameMode, FrameMode> = { land: 'port', port: 'off', off: 'land' };
const FRAME_SAY: Record<FrameMode, string> = { land: 'landscape', port: 'portrait', off: 'off' };
// The last lens and frame chosen, kept while the app is open so full screen and the next stop start the same way.
let lastLens = '135';
let lastFrame: FrameMode = 'land';
let lastForeground = true;
let lastIce: boolean | null = null;
let foregroundTooHeavy = false;   // the web view died with the foreground on: it stays off until the user turns it on again
// How this phone kept up the last time the view was moved: the page's quality levels while moving (0 full .. 3 low),
// one for looking around / walking and one for the time slider. Handed to the next page, so it starts where this one ended.
let lastLevels: { look: number; sun: number } | null = null;
type Perf = { ms: number; worst: number; quality: string };
// "9 ms a frame (worst 21) · quality full": the time one picture took while the view was last moved (under about
// 17 ms is as smooth as most screens show), and the quality the page drew at while moving (it is always full when still).
const perfLine = (p: Perf) => `${p.ms < 10 ? Math.round(p.ms * 10) / 10 : Math.round(p.ms)} ms a frame (worst ${Math.round(p.worst)}) · quality ${p.quality}`;
const CHUNK = 240000;   // base64 characters per message to the page; a multiple of 4

export default function Sun3DPanel({ pair, tripId, stopId, sun, day0, height = 208, full, onJump, onFull, hdOn, onHd }: Props) {
  const web = useRef<any>(null);
  const [phase, setPhase] = useState<Phase>('finding');
  const [region, setRegion] = useState<TerrainRegion | null>(null);
  const [near, setNear] = useState<TerrainNear | null>(null);
  const [b64, setB64] = useState<string | null>(null);
  const [nearB64, setNearB64] = useState<string | null>(null);
  const [detail, setDetail] = useState<TerrainDetail | null>(null);
  const [detailB64, setDetailB64] = useState<string | null>(null);
  const [maskB64, setMaskB64] = useState<string | null>(null);
  const [treesB64, setTreesB64] = useState<string | null>(null);
  const [waterB64, setWaterB64] = useState<string | null>(null);
  const [iceChoice, setIceChoice] = useState<boolean | null>(lastIce);   // null = the page's own default (frozen where the ground is snow)
  const [shapes, setShapes] = useState(false);   // the page says it is drawing the detail box
  const [foreBusy, setForeBusy] = useState(false);   // the foreground has been sent and the page has not answered yet
  const [foreground, setForegroundState] = useState(lastForeground);
  const [lensId, setLensState] = useState(lastLens);
  const pickLens = LENSES.find(l => l.id === lensId) ?? LENSES[2];
  const focal = pickLens.f;
  const [frame, setFrameState] = useState<FrameMode>(lastFrame);
  const setLens = useCallback((id: string) => { lastLens = id; setLensState(id); }, []);
  const setFrame = useCallback((m: FrameMode) => { lastFrame = m; setFrameState(m); }, []);
  // What the page needs for the lens: focal length, the film's width and height as the camera is turned, box on / off.
  const lens = useMemo(() => ({
    f: pickLens.f,
    fw: frame === 'port' ? pickLens.short : pickLens.long,
    fh: frame === 'port' ? pickLens.long : pickLens.short,
    box: frame !== 'off',
  }), [pickLens, frame]);
  const [lit, setLit] = useState<{ subjectLit: boolean; hereLit: boolean; up: boolean; trees: boolean } | null>(null);
  const [moments, setMoments] = useState<Moments | null>(null);
  const [look, setLook] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);   // the last movement's frame time, as the page measured it (offline view)
  const booted = useRef(false);
  const sent = useRef(false);
  const foreSent = useRef(false);
  const [gen, setGen] = useState(0);                         // bumped to start the web view afresh after it died
  const [heavy, setHeavy] = useState(foregroundTooHeavy);
  const loaded = useRef<string | null>(null);   // the files the plain view holds: "<region>|<fine box or nothing>"
  const loadedDetail = useRef('');               // the detail box whose files are loaded (or loading) for this shot
  const nearUsed = useRef<TerrainNear | null>(null);
  const ready = phase === 'ready';
  // Walk mode (full screen, offline view): the arrows step the viewpoint; `at` is where it now stands.
  const [walking, setWalking] = useState(false);
  const [at, setAt] = useState<{ lat: number; lng: number; moved: number } | null>(null);
  const [walkNote, setWalkNote] = useState<string | null>(null);
  const [savingSpot, setSavingSpot] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Full screen runs edge to edge: the lines under the picture keep a margin from the sides of the phone.
  const pad = full ? styles.fullPad : null;
  // HD: undefined = still asking whether it is there, null = not available
  const [hdCfg, setHdCfg] = useState<HdSetup | null | undefined>(undefined);
  const [hd, setHd] = useState<string | null>(null);      // Google's root tile set while the HD page is showing
  const [wantLocal, setWantLocal] = useState(false);
  const [hdNote, setHdNote] = useState<string | null>(null);
  const [hdLoading, setHdLoading] = useState(false);
  const hdRef = useRef<string | null>(null);
  hdRef.current = hd;
  const want = hdOn ?? wantLocal;
  const setWant = useCallback((on: boolean) => { if (onHd) onHd(on); else setWantLocal(on); }, [onHd]);
  const savedLine = tripTerrainLine(useTripTerrain(tripId));

  const run = useCallback((js: string) => { web.current?.injectJavaScript(`${js};true;`); }, []);

  // Which terrain files this shot needs (the wide one for the stand spot, plus a fine box around the
  // stand spot when there is one), then the files themselves (from the phone when saved).
  const vLat = pair.v.lat, vLng = pair.v.lng, sLat = pair.s.lat, sLng = pair.s.lng;
  useEffect(() => {
    let alive = true;
    (async () => {
      const stand = { lat: vLat, lng: vLng };
      const r = await regionFor(stand);
      const nr = r ? await nearFor(r, stand, { lat: sLat, lng: sLng }) : null;
      if (!alive) return;
      if (!(r && loaded.current === `${r.id}|${nr?.id ?? ''}`)) {   // (same files: the page only gets the new view)
        loaded.current = null; loadedDetail.current = ''; nearUsed.current = null; booted.current = false; sent.current = false; foreSent.current = false;
        setPhase('finding'); setRegion(null); setNear(null); setB64(null); setNearB64(null); setDetail(null); setDetailB64(null); setMaskB64(null); setTreesB64(null); setWaterB64(null); setShapes(false); setForeBusy(false); setLit(null); setMoments(null);
        if (!r) { setPhase('none'); return; }
        setPhase('loading');
        // The fine file is an extra: with a weak signal it gets 10 s, then the wide grid draws alone (the download carries on).
        const fine = nr ? Promise.race([terrainData(nr), new Promise<null>(res => setTimeout(() => res(null), 10000))]) : Promise.resolve(null);
        const [d, nd] = await Promise.all([terrainData(r), fine]);
        if (!alive) return;
        if (!d) { setPhase('failed'); return; }
        // No fine file (no signal the first time): the wide grid alone still draws, and the next shot tries again.
        loaded.current = `${r.id}|${nr && nd ? nr.id : ''}`; nearUsed.current = nr && nd ? nr : null;
        setRegion(r); setNear(nearUsed.current); setB64(d); setNearB64(nr && nd ? nd : null); setPhase('starting');
      }
      // The foreground's files come behind the plain view, never before it: the detail box for this shot (it must sit
      // inside the fine box the page really has), its mask, the tree returns and the wide water.
      const dt0 = await detailFor(r, nearUsed.current, stand, { lat: sLat, lng: sLng });
      if (!alive || (dt0?.id ?? '') === loadedDetail.current) return;
      if (foreSent.current) {   // the page already holds another box's foreground: start it afresh for this one
        booted.current = false; sent.current = false; foreSent.current = false;
        setLit(null); setMoments(null); setLook(null); setShapes(false); setForeBusy(false); setPhase(p => (p === 'ready' ? 'starting' : p)); setGen(g => g + 1);
      }
      loadedDetail.current = dt0?.id ?? '';
      setDetail(null); setDetailB64(null); setMaskB64(null); setTreesB64(null); setWaterB64(null);
      if (!dt0) return;
      const mk = detailMask(dt0), tk = detailTrees(dt0), wk = detailWater(dt0);
      const [dd, md, td, wd] = await Promise.all([terrainData(dt0), mk ? terrainData(mk) : null, tk ? terrainData(tk) : null, wk ? terrainData(wk) : null]);
      if (!alive || loadedDetail.current !== dt0.id) return;
      if (!dd) { loadedDetail.current = ''; return; }   // not on the phone and no signal: tried again with the next shot
      setMaskB64(md); setTreesB64(td); setWaterB64(wd); setDetailB64(dd); setDetail(dt0);
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

  // Is the HD picture there at all (online, deployed, under its daily cap)? One small call, remembered for 5 minutes.
  useEffect(() => {
    let alive = true;
    hdSetup().then(v => { if (alive) setHdCfg(v); });
    return () => { alive = false; };
  }, []);

  // Change between the offline page and the HD page: the web view is made anew, so everything it reported is cleared.
  const swap = useCallback((root: string | null) => {
    booted.current = false; sent.current = false;
    setLit(null); setMoments(null); setLook(null); setHdLoading(false); setProblem(null); setShapes(false);
    setPhase(p => (p === 'ready' || p === 'error' ? 'starting' : p));
    setHd(root);
  }, []);
  useEffect(() => {
    if (!want) { if (hd) swap(null); return; }
    if (hd || !hdCfg) return;
    let alive = true;
    hdRoot().then(root => {
      if (!alive) return;
      if (root) { setHdNote(null); swap(root); }
      else { hdForget(); setHdNote("The HD picture isn't available right now."); setWant(false); }
    });
    return () => { alive = false; };
  }, [want, hd, hdCfg, swap, setWant]);
  // Foreground on / off: the page is started again with or without the detail box (off = exactly the page without it).
  const setForeground = useCallback((on: boolean) => {
    lastForeground = on; setForegroundState(on);
    if (on) { foregroundTooHeavy = false; setHeavy(false); foreSent.current = false; return; }   // on: sent to the page that is up (sendFore)
    if (hdRef.current) return;   // the HD page has no detail box: nothing to restart
    // off: the page is started afresh without it, so it draws exactly the plain view
    booted.current = false; sent.current = false; foreSent.current = false;
    setLit(null); setMoments(null); setLook(null); setShapes(false); setForeBusy(false); setProblem(null);
    setPhase(p => (p === 'ready' || p === 'error' ? 'starting' : p)); setGen(g => g + 1);
  }, []);
  const useDetail = foreground && !hd && !!detail && !!detailB64;
  const useDetailRef = useRef(false);
  useDetailRef.current = useDetail;
  // Frozen lakes: still water drawn as snow-covered ice, rivers open. Default from the area's ground; a tap changes it in place.
  const iceOn = iceChoice ?? (region ? region.ground !== 'green' : true);
  const setIce = useCallback((on: boolean) => { lastIce = on; setIceChoice(on); run(`window.S3D.ice(${on ? 'true' : 'false'})`); }, [run]);
  // HD is wanted and on its way: the offline page is not started just to be replaced
  // (one that is already showing stays up until the HD page takes over)
  const holding = want && !hd && hdCfg !== null && phase !== 'ready';

  // Hand the page its place and the terrain once both the page and the file are there.
  const start = useCallback(() => {
    if (!booted.current || sent.current || !region || !b64) return;
    sent.current = true;
    const cfg = {
      n: region.n, north: region.north, south: region.south, west: region.west, east: region.east,
      W: region.width_m, D: region.depth_m, base: region.base_m, step: region.step_m, ground: region.ground,
      eye: pair.v, target: pair.s, focal, lens, inline: !full,
      near: !hd && near && nearB64
        ? { n: near.n, north: near.north, south: near.south, west: near.west, east: near.east, base: near.base_m, step: near.step_m }
        : undefined,
      ice: iceOn,
      level: lastLevels ?? undefined,
      ...(hd && hdCfg ? { tiles: { base: hdCfg.base, draco: hdCfg.draco, root: hd } } : null),
    };
    run(`window.S3D.init(${JSON.stringify(cfg)})`);
    for (let i = 0; i < b64.length; i += CHUNK) run(`window.S3D.chunk("${b64.slice(i, i + CHUNK)}")`);
    if (!hd && near && nearB64) for (let i = 0; i < nearB64.length; i += CHUNK) run(`window.S3D.chunk("${nearB64.slice(i, i + CHUNK)}","near")`);
    run('window.S3D.done()');
  // iceOn is read when the page starts; a later tap goes to the page directly (setIce), so it is not a reason to start again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, near, b64, nearB64, pair.v, pair.s, focal, lens, full, run, hd, hdCfg]);
  useEffect(() => { start(); }, [start]);

  // The foreground (detail box, tree returns, water) goes to the page only once the plain view is up ('ready'): several
  // MB of text that must not stand between the user and a first picture. The page builds it in steps and answers
  // 'foreground' (ok, or dropped: the plain view then simply stays).
  const sendFore = useCallback(() => {
    if (foreSent.current || !useDetail || !detail || !detailB64) return;
    foreSent.current = true; setForeBusy(true);
    const fore = {
      detail: {
        n: detail.n, north: detail.north, south: detail.south, west: detail.west, east: detail.east, base: detail.base_m, step: detail.step_m,
        trees: treesB64 ? { bins: detail.trees_bins ?? 64, bin: detail.trees_bin_m ?? 0.6 } : undefined,
      },
      water: waterB64 ? { n: detail.water_n, north: detail.water_north, south: detail.water_south, west: detail.water_west, east: detail.water_east } : undefined,
      ice: iceOn,
    };
    run(`window.S3D.fore(${JSON.stringify(fore)})`);
    const feed = (data: string | null, kind: string) => { if (data) for (let i = 0; i < data.length; i += CHUNK) run(`window.S3D.chunk("${data.slice(i, i + CHUNK)}","${kind}")`); };
    feed(detailB64, 'detail'); feed(maskB64, 'mask'); feed(treesB64, 'trees'); feed(waterB64, 'water');
    run('window.S3D.foreDone()');
  }, [useDetail, detail, detailB64, maskB64, treesB64, waterB64, iceOn, run]);
  useEffect(() => { if (ready) sendFore(); }, [ready, sendFore]);

  // The web view's own process died (Android: out of memory, or killed) or its graphics context went. With the
  // foreground on, that is the likely cause: start once more WITHOUT it, switch it off for this session and say so.
  // Without the foreground nothing is restarted: no loop.
  const onGone = useCallback(() => {
    if (hdRef.current) { hdForget(); setHdNote("The HD picture couldn't load. Showing the offline view."); setWant(false); return; }
    booted.current = false; sent.current = false; foreSent.current = false;
    setLit(null); setMoments(null); setLook(null); setShapes(false); setForeBusy(false);
    if (useDetailRef.current) {
      lastForeground = false; foregroundTooHeavy = true;
      setForegroundState(false); setHeavy(true); setProblem(null); setPhase('starting'); setGen(g => g + 1);
    } else { setProblem('The 3D view stopped on this phone.'); setPhase('error'); }
  }, [setWant]);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let m: any = null;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'boot') { booted.current = true; foreSent.current = false; setPerf(null); start(); }
    else if (m.type === 'perf') {
      if (m.levels && typeof m.levels.look === 'number' && typeof m.levels.sun === 'number') lastLevels = { look: m.levels.look, sun: m.levels.sun };
      if (typeof m.ms === 'number') setPerf({ ms: m.ms, worst: typeof m.worst === 'number' ? m.worst : m.ms, quality: typeof m.quality === 'string' ? m.quality : 'full' });
    }
    else if (m.type === 'ready') setPhase('ready');
    else if (m.type === 'foreground') { setShapes(!!m.ok); setForeBusy(false); }   // not ok = the page dropped it and kept the plain view
    else if (m.type === 'lost') onGone();
    else if (m.type === 'state') setLit({ subjectLit: !!m.subjectLit, hereLit: !!m.hereLit, up: !!m.up, trees: !!m.trees });
    else if (m.type === 'moments') setMoments({ firstSubject: m.firstSubject ?? null, lastSubject: m.lastSubject ?? null, firstHere: m.firstHere ?? null, lastHere: m.lastHere ?? null, trees: !!m.trees });
    else if (m.type === 'look') setLook(typeof m.deg === 'number' ? m.deg : null);
    else if (m.type === 'eye') { setAt({ lat: m.lat, lng: m.lng, moved: m.moved || 0 }); setWalkNote(null); }
    else if (m.type === 'walk') setWalkNote(m.stopped === 'far' ? `That's as far as walk mode goes: ${m.max} m from your saved spot.` : 'That is the edge of the saved terrain.');
    else if (m.type === 'hd') setHdLoading(!!m.loading);
    else if (m.type === 'error') {
      if (hdRef.current) {
        // the HD page gave up (no signal, Google's session ran out, the phone's memory): back to the offline view
        hdForget();
        setHdNote("The HD picture couldn't load. Showing the offline view.");
        setWant(false);
      } else { setProblem(String(m.msg ?? '')); setPhase(p => (p === 'ready' ? p : 'error')); }
    }
  }, [start, setWant, onGone]);

  // The sun follows the slider; the place and the day's first / last light follow the chosen shot.
  const az = sun.az, alt = sun.alt;
  useEffect(() => { if (ready) run(`window.S3D.sun(${az.toFixed(3)},${alt.toFixed(3)})`); }, [ready, az, alt, run]);
  useEffect(() => {
    if (!ready) return;
    setMoments(null);
    run(`window.S3D.view(${vLat},${vLng},${sLat},${sLng})`);
    run(`window.S3D.path(${JSON.stringify(dayPath)})`);
  }, [ready, vLat, vLng, sLat, sLng, dayPath, run]);
  useEffect(() => { if (ready) run(`window.S3D.lens(${JSON.stringify(lens)})`); }, [ready, lens, run]);

  // ---- Walk mode ----
  // A new shot (or a saved move) puts the viewpoint back on the stand pin.
  useEffect(() => { setAt(null); setWalkNote(null); }, [vLat, vLng, sLat, sLng]);
  // When the walking stops, the day's first / last light is worked out again for where the viewpoint now stands.
  const atLat = at?.lat, atLng = at?.lng;
  useEffect(() => {
    if (!ready || atLat == null) return;
    const t = setTimeout(() => run(`window.S3D.path(${JSON.stringify(dayPath)})`), 500);
    return () => clearTimeout(t);
  }, [ready, atLat, atLng, dayPath, run]);
  const stopStepping = useCallback(() => { if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; } }, []);
  useEffect(() => stopStepping, [stopStepping]);
  // One press = 2 m; holding keeps walking, about 15 m a second.
  const startStepping = useCallback((f: number, r: number) => {
    stopStepping();
    run(`window.S3D.walk(${f},${r})`);
    stepTimer.current = setInterval(() => run(`window.S3D.walk(${f},${r})`), 130);
  }, [run, stopStepping]);
  const leaveWalk = useCallback(() => { stopStepping(); setWalking(false); setWalkNote(null); run('window.S3D.home()'); }, [run, stopStepping]);
  const canSaveSpot = !!(tripId && stopId && at && at.moved >= 2);
  const saveSpot = useCallback(() => {
    if (!tripId || !stopId || !at) return;
    Alert.alert(
      'Move your stand spot here?',
      `This shot's stand spot moves ${at.moved} m to where you are standing in the view. The sun times and the planner follow. It changes the shot on every trip that uses it, practice copies included.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move it', onPress: async () => {
            setSavingSpot(true);
            try { await moveVantage(tripId, stopId, pair.vantage_id, at.lat, at.lng); setWalkNote('Saved: this is now your stand spot for the shot.'); }
            catch (e: any) { setWalkNote(`Couldn't save the spot: ${e?.message || 'check your connection'}`); }
            finally { setSavingSpot(false); }
          },
        },
      ],
    );
  }, [tripId, stopId, at, pair.vantage_id]);

  const waiting = phase === 'finding' ? 'Finding the terrain for this spot…'
    : phase === 'loading' ? 'Getting the terrain (once, a few MB)…'
    : phase === 'starting' ? (holding || hd ? 'Getting the HD picture…' : 'Drawing the terrain…')
    : phase === 'none' ? 'No 3D terrain for this area yet.'
    : phase === 'failed' ? "Couldn't get the terrain. It needs a signal the first time."
    : null;
  const left = hd ? hdLeftThisMonth() : null;
  const leftToday = hd ? hdLeftToday() : null;
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
        {region && b64 && !holding ? (
          <Web
            ref={web}
            key={hd ? `${region.id}:hd:${gen}` : `${region.id}|${near?.id ?? ''}|${gen}`}
            source={hd && hdCfg ? { html: SUN3D_GOOGLE_HTML, baseUrl: hdCfg.origin } : { html: SUN3D_HTML }}
            originWhitelist={['*']}
            javaScriptEnabled
            onMessage={onMessage}
            onRenderProcessGone={onGone}
            onContentProcessDidTerminate={onGone}
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
            {LENSES.map(l => (
              <TouchableOpacity
                key={l.id}
                onPress={() => setLens(l.id)}
                style={[styles.lensBtn, lensId === l.id && styles.lensOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: lensId === l.id }}
                accessibilityLabel={l.id === 'gw690' ? 'Fuji 6 by 9, 90 millimetre lens' : `${l.f} millimetre lens`}
              >
                <Text style={[styles.lensText, lensId === l.id && styles.lensTextOn]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.rightBtns}>
            {hdCfg && region && b64 ? (
              <TouchableOpacity
                onPress={() => { setHdNote(null); setWant(!want); }}
                style={[styles.hdBtn, want && styles.lensOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: want }}
                accessibilityLabel="HD picture from Google. Needs a signal."
                hitSlop={6}
              >
                <Text style={[styles.lensText, want && styles.lensTextOn]}>HD</Text>
              </TouchableOpacity>
            ) : null}
            {full && !hd && ready ? (
              <TouchableOpacity
                onPress={() => (walking ? leaveWalk() : setWalking(true))}
                style={[styles.fullBtn, walking && styles.lensOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: walking }}
                accessibilityLabel="Walk mode: move your viewpoint"
                hitSlop={6}
              >
                <Ionicons name="walk-outline" size={18} color={walking ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setFrame(FRAME_NEXT[frame])}
              style={[styles.fullBtn, frame !== 'off' && styles.lensOn]}
              accessibilityRole="button"
              accessibilityLabel={`4x5 frame box: ${FRAME_SAY[frame]}. Tap to change.`}
              hitSlop={6}
            >
              <Ionicons name={frame === 'port' ? 'tablet-portrait-outline' : frame === 'land' ? 'tablet-landscape-outline' : 'scan-outline'} size={17} color={frame !== 'off' ? '#000000' : '#ffffff'} />
            </TouchableOpacity>
            {detail && detailB64 && !hd ? (
              <TouchableOpacity
                onPress={() => setForeground(!foreground)}
                style={[styles.fullBtn, foreground && styles.lensOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: foreground }}
                accessibilityLabel={`Foreground (trees and buildings near you): ${foreground ? 'on' : 'off'}. Tap to change.`}
                hitSlop={6}
              >
                <Ionicons name="leaf-outline" size={17} color={foreground ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            {useDetail && ready && shapes && region?.ground === 'snow' ? (
              <TouchableOpacity
                onPress={() => setIce(!iceOn)}
                style={[styles.fullBtn, iceOn && styles.lensOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: iceOn }}
                accessibilityLabel={`Frozen lakes: ${iceOn ? 'on' : 'off'}. Tap to change.`}
                hitSlop={6}
              >
                <Ionicons name="snow-outline" size={17} color={iceOn ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onFull} style={styles.fullBtn} accessibilityRole="button" accessibilityLabel={full ? 'Close full screen' : 'Open the 3D view full screen'} hitSlop={6}>
              <Ionicons name={full ? 'contract-outline' : 'expand-outline'} size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
        {walking && full && !hd && ready ? (
          <View style={styles.pad} pointerEvents="box-none">
            {([['Walk forward', 'chevron-up', 2, 0, styles.padUp], ['Step left', 'chevron-back', 0, -2, styles.padLeft], ['Step right', 'chevron-forward', 0, 2, styles.padRight], ['Walk back', 'chevron-down', -2, 0, styles.padDown]] as const).map(([label, icon, f, r, where]) => (
              <TouchableOpacity
                key={label}
                style={[styles.padBtn, where]}
                onPressIn={() => startStepping(f, r)}
                onPressOut={stopStepping}
                accessibilityRole="button"
                accessibilityLabel={label}
                activeOpacity={0.6}
              >
                <Ionicons name={icon as any} size={24} color="#ffffff" />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {ready && look != null ? (
          <Text style={[styles.caption, hd ? styles.captionHd : null]} pointerEvents="none">Looking {compassPoint(look)} {look}° · {focal} mm on {pickLens.format} · {hd && hdLoading ? 'loading the picture…' : full ? 'drag to look around' : 'drag sideways to look'}</Text>
        ) : null}
      </View>

      {ready && lit ? (
        <Text style={[styles.status, pad]}>
          <Text style={lit.subjectLit ? styles.sunOn : undefined}>{subject}: {lit.subjectLit ? 'in the sun' : lit.up ? 'in shadow' : 'no sun'}</Text>
          <Text>  ·  </Text>
          <Text style={lit.hereLit ? styles.sunOn : undefined}>You: {lit.hereLit ? 'in the sun' : lit.up ? 'in shade' : 'no sun'}</Text>
        </Text>
      ) : phase === 'error' && problem ? (
        <Text style={[styles.status, pad]}>{problem}</Text>
      ) : null}
      {ready && perf && !hd ? (
        <Text style={[styles.perf, pad]} numberOfLines={1} accessibilityLabel={`Smoothness: ${perfLine(perf)}`}>Smoothness: {perfLine(perf)}</Text>
      ) : null}
      {ready && shapes && (lit?.trees || moments?.trees) ? (
        <Text style={[styles.status, pad]}>
          {lit?.trees ? 'Trees near you may block the sun here right now' : 'Trees near you may block the sun here at times today'} (summer survey; bare in winter if they are cottonwoods). The times don't count them.
        </Text>
      ) : null}
      {foreBusy && ready && !hd ? <Text style={[styles.note, pad]}>Foreground loading…</Text> : null}
      {heavy && !foreground && !hd ? (
        <Text style={[styles.status, pad]}>The foreground was too heavy for this phone, so it is off. The view below is the plain one.</Text>
      ) : null}
      {hdNote && !hd ? <Text style={[styles.status, pad]}>{hdNote}</Text> : null}
      {walking && full && !hd ? (
        <View style={[styles.walkRow, pad]}>
          <Text style={styles.walkText}>
            {walkNote ?? (at && at.moved > 0 ? `You've walked ${at.moved} m from your saved spot. The times below are for here.` : 'Hold an arrow to walk. Drag the picture to turn.')}
          </Text>
          <View style={styles.walkBtns}>
            <TouchableOpacity onPress={() => { stopStepping(); run('window.S3D.home()'); }} style={styles.walkBtn} accessibilityRole="button" accessibilityLabel="Back to my saved spot" disabled={!at || at.moved === 0}>
              <Text style={[styles.walkBtnText, (!at || at.moved === 0) && { opacity: 0.4 }]}>Back to my spot</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveSpot} style={[styles.walkBtn, styles.walkBtnMain, !canSaveSpot && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Save this as my stand spot for the shot" disabled={!canSaveSpot || savingSpot}>
              {savingSpot ? <ActivityIndicator size="small" color="#000000" /> : <Text style={styles.walkBtnMainText}>Save as my spot</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {chips.length > 0 && (
        <View style={[styles.moments, pad]}>
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
      {ready ? (
        <Text style={[styles.note, pad]}>
          {hd
            ? `Picture: Google Maps. ${region?.ground === 'green' ? 'Light and shadows' : 'Light, shadows and snow'} are calculated from elevation data: ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles. No clouds. Needs a signal; times are within a few minutes.${left != null ? ` HD views left: ${leftToday != null ? `${leftToday} today, ` : ''}${left} this month.` : ''}`
            : shapes
              ? 'Terrain shape and calculated sun. Buildings and trees close to you, and water within about 3 km, come from a 2022 summer laser survey: buildings as blocks, trees as dots, none farther off; no clouds. With the snowflake on, lakes and slow water are drawn frozen and rivers open (a guess from the slope of the water). Sun times count the ground and buildings, not the trees. Times are within a few minutes. Elevation data: USGS 3DEP lidar, ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles.'
              : 'Terrain shape and calculated sun only: no trees, buildings or clouds. Times are within a few minutes. Elevation data: ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles.'}
        </Text>
      ) : null}
      {ready ? (
        <TouchableOpacity
          onPress={() => Linking.openURL(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pair.v.lat},${pair.v.lng}&heading=${look ?? 0}`).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="Open Street View at this stand spot, facing the same way"
          hitSlop={{ top: 6, bottom: 6 }}
        >
          <Text style={[styles.streetLink, pad]}>Street View from this spot ›</Text>
        </TouchableOpacity>
      ) : null}
      {savedLine ? <Text style={[styles.note, pad]} accessibilityLabel={savedLine}>{savedLine}</Text> : null}
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
  lensBtn: { minWidth: 36, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  lensOn: { backgroundColor: '#ffffff' },
  lensText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  lensTextOn: { color: '#000000' },
  rightBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hdBtn: { minWidth: 40, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.55)' },
  fullBtn: { width: 36, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.55)' },
  caption: { position: 'absolute', left: 10, right: 10, bottom: 8, color: '#ffffff', fontSize: 11, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  captionHd: { top: 46, bottom: undefined },   // Google's attribution has the bottom of the picture
  status: { color: colors.textSecondary, fontSize: 13, marginTop: 8, paddingHorizontal: 2 },
  sunOn: { color: '#F0B04A', fontWeight: '700' },
  fullPad: { paddingHorizontal: 14 },
  pad: { position: 'absolute', left: 14, bottom: 44, width: 148, height: 148 },
  padBtn: { position: 'absolute', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: '#555555' },
  padUp: { left: 50, top: 0 },
  padLeft: { left: 0, top: 50 },
  padRight: { left: 100, top: 50 },
  padDown: { left: 50, top: 100 },
  walkRow: { marginTop: 8, gap: 8 },
  walkText: { color: colors.textSecondary, fontSize: 13 },
  walkBtns: { flexDirection: 'row', gap: 8 },
  walkBtn: { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  walkBtnText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  walkBtnMain: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  walkBtnMainText: { color: '#000000', fontSize: 13, fontWeight: '700' },
  streetLink: { color: colors.textSecondary, fontSize: 13, marginTop: 10, paddingHorizontal: 2, textDecorationLine: 'underline' },
  moments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  moment: { flexGrow: 1, flexBasis: '47%', minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  momentLabel: { color: colors.textSecondary, fontSize: 11 },
  momentTime: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  note: { color: colors.textTertiary, fontSize: 11, marginTop: 8, paddingHorizontal: 2 },
  perf: { color: colors.textTertiary, fontSize: 11, marginTop: 4, paddingHorizontal: 2 },
});
