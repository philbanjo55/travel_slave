import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { SUN3D_HTML } from './sun3dHtml';
import { SUN3D_GOOGLE_HTML } from './sun3dGoogleHtml';
import { detailBuildings, detailColor, detailFor, detailLeaf, detailMask, detailTrees, TREE_STYLE, treeTilesLeaf, detailWater, houseTileFile, houseTilesFor, nearColor, nearFor, rangeFile, rangeFor, regionColor, regionFor, terrainData, TerrainDetail, TerrainHouseTile, TerrainNear, TerrainRange, TerrainRegion, TerrainTreeTile, treeTileFile, treeTilesFor, tripTerrainLine, useTripTerrain } from '../../services/terrain';
import { hdForget, hdLeftThisMonth, hdLeftToday, hdRoot, hdSetup, HdSetup } from '../../services/tiles3d';
import { fmtMinute, sunPosition } from '../../utils/sunEngine';
import { framingOf, saveShot, takeRefusal, useShotSaves, waitingFor } from '../../services/shotSaves';
import type { Framing, Pair, SkyPos } from '../../utils/sunEngine';
import { compassPoint } from './sunStyle';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PhotoXf, RefPhoto, RefPhotoCard, RefPhotoGhost, SeeThroughBar, XF0 } from './RefPhotoOverlay';
import { Overhead3D, useOverhead3D } from './overhead3d';

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
// Faroes (13 Nov 2026): the foreground there is the agency's aerial photos (the
// detail box's and the fine box's), its building outlines (heights guessed) and
// its water; they colour the ground and draw the houses but never change a sun
// time. A fine box with a photo and no detail box still gets its photo. One
// credit line says where it comes from.
// Sharp range and park-wide buildings (Grand Teton, 14 Nov 2026): the range box
// around the shot's subject (5 m, USGS lidar DEM) is sent first with the
// foreground, then the building tiles within 8 km (after the detail box's files):
// the page builds the range right after the plain view and the buildings after
// the foreground, each on its own (a failure leaves only that one out). Both go
// with the Foreground switch: off = exactly the plain view as before.
// Park-wide trees (Grand Teton, 13 Nov 2026): the tiles of a coarse canopy layer
// within 12 km of the stand spot go with the foreground too (last); the page draws
// trees from them beyond the detail box, never counts them in a sun time, and
// leaves them out alone if they fail or are slow.
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
//
// Framing (Phil, 14 Nov 2026: frame every shot in 3D and keep it): in full screen
// "Save framing" keeps where the view points (heading and tilt), the lens and the
// frame box's orientation on the shot (services/shotSaves -> sun_vantage_frame);
// the view then opens on it, small or full screen, with that lens. "Aim at
// subject" points the view back at the subject pin (the saved framing stays until
// a new one is saved or it is forgotten). Saves made with no signal wait on the
// phone and are sent later, the stand spot's too. HD shows no framing controls.
//
// Reference photo (Phil, 15 Nov 2026): in full screen a photo button (only when the
// stop has photos) opens a small card of the stop's photos in the top-right corner;
// a tap on it lays the photo see-through over the picture, with an amount slider.
// It is drawn over the web view and never touches it (no restart, no new key), so
// the view, heading, lens and walk position stay as they are. Not over HD: Google's
// picture and its credits must stay clear.

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
  photos?: RefPhoto[];         // full screen: the stop's photos as the stop page lists them, for the reference photo card
  preview?: boolean;           // Find spot's small per-lens picture: no buttons, no lines under it, touches pass through
  // Find spot's full screen before "Add as a shot" (Phil, 16 Nov 2026: place, frame and save there): the shot is not on
  // the stop yet, so the first save (stand spot or framing) makes it first and then saves onto it. Returns the new
  // shot's vantage id; throws with a plain reason. The parent then hands the new id in as pair.vantage_id.
  addShot?: () => Promise<string>;
  // The stop's other shots (Phil, 17 Nov 2026): their stand spots stand in the picture as markers with the distance, the
  // height difference and the steepest ground on the way; a tap on one picks that shot.
  others?: Pair[];
  onPickOther?: (vantageId: string) => void;
  // Overhead tab, our 3D look (16 Nov 2026; Overhead3DPanel): the same page looking straight down over every shot of the
  // place. The perspective controls (lens, frame box, walk, framing, HD, photo, Street View, the lines under the picture)
  // are hidden and overhead3d.tsx's are shown; the foreground is always on. `pair` must be the picked shot.
  overhead?: Overhead3D;
  // Find my spot (17 Nov 2026): the camera height the photo was found at (metres above the ground), used as the starting
  // camera height instead of eye height. Clamped to the height control's range.
  eyeHeight?: number;
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
let lastFrameOnly = false;
let lastForeground = true;
let lastTrees = true;   // the foreground's trees (Phil, 16 Nov 2026: a "no trees" setting): kept like the foreground itself
let lastIce: boolean | null = null;
let pickedFor: string | null = null;   // the shot whose lens / frame box the user changed by hand: its framing's lens is not put back over that
let lastGlass = false;
let lastOthersOn = true;
const EYE_H = 1.73, CAM_MIN = 0.3048, CAM_MAX = 10000;   // camera height above the ground, metres (5'8" = 1.73; min 1 ft, no real top)
const INCH = 0.0254;
const feetIn = (m: number) => { const t = Math.round(m / 0.0254); return t >= 1200 ? `${Math.round(t / 12)} ft` : `${Math.floor(t / 12)}'${t % 12}"`; };   // the stop's other stand spots shown in the 3D view (kept while the app is open)
const FINE_STEP = 0.25, WALK_STEP = 2;   // metres: a tap, and the most a held arrow moves per step
const REF_OPACITY_KEY = 'pf_ref_opacity';
let refOpacityRead = false;
// Where each photo was moved / zoomed to, while the app is open, pinned to the 3D scene (not to the screen): the small
// view, full screen and every lens show it over the same part of the scene (Phil, 18 Nov 2026: the small view's crop was
// off from the full screen's, and opening it there threw full screen off too).
type PhotoOnScene = { x: number; y: number; wd: number };   // the photo's middle and width, in focal lengths (see unitPx)
const refScKept = new Map<string, PhotoOnScene>();
const photoShape = new Map<string, number>();   // photo key -> width / height, once it has loaded
// One focal length in dp for a view of w x h with this lens: the page draws the lens a little wider than its frame,
// its camera's vertical view = 2 atan(k) (lensFov in tools/sun3d/app_view.js; keep the two the same).
function unitPx(w: number, h: number, l: { f: number; fw: number; fh: number }): number {
  const a = w / h, th = l.fw / (2 * l.f), tv = l.fh / (2 * l.f), k = Math.max(th / (a * 0.9), tv / 0.9);
  return h / (2 * k);
}
const fitW = (w: number, h: number, shape: number) => Math.min(w, h * shape);   // the photo's width at 'contain' fit
function xfToScene(xf: PhotoXf, w: number, h: number, l: { f: number; fw: number; fh: number }, shape: number): PhotoOnScene {
  const u = unitPx(w, h, l);
  return { x: xf.x / u, y: xf.y / u, wd: (xf.s * fitW(w, h, shape)) / u };
}
function sceneToXf(sc: PhotoOnScene, w: number, h: number, l: { f: number; fw: number; fh: number }, shape: number): PhotoXf {
  const u = unitPx(w, h, l);
  return { s: (sc.wd * u) / fitW(w, h, shape), x: sc.x * u, y: sc.y * u };
}
const lensOf = (id: string, orient: string) => {
  const L = LENSES.find(l => l.id === id); if (!L) return null;
  return { f: L.f, fw: orient === 'portrait' ? L.short : L.long, fh: orient === 'portrait' ? L.long : L.short };
};
let lastRefOpacity = 0.45;   // the see-through amount last chosen, kept while the app is open
let foregroundTooHeavy = false;   // the web view died with the foreground on: it stays off until the user turns it on again
// How this phone kept up the last time the view was moved: the page's quality levels while moving (0 full .. 3 low),
// one for looking around / walking and one for the time slider. Handed to the next page, so it starts where this one ended.
let lastLevels: { look: number; sun: number } | null = null;
type Perf = { ms: number; worst: number; quality: string };
// "9 ms a frame (worst 21) · quality full": the time one picture took while the view was last moved (under about
// 17 ms is as smooth as most screens show), and the quality the page drew at while moving (it is always full when still).
const perfLine = (p: Perf) => `${p.ms < 10 ? Math.round(p.ms * 10) / 10 : Math.round(p.ms)} ms a frame (worst ${Math.round(p.worst)}) · quality ${p.quality}`;
const CHUNK = 240000;
const ADD_FIRST = 'It is added to this stop as a shot first, on the real trip and its practice copy. ';
const TREE_CHUNK = 60000;   // the park-wide tree tiles' pieces (a multiple of 4)
// Wherever the Faroes photos / buildings are drawn (the agency's terms ask for the credit; ArcticDEM is CC-BY-4.0).
// Grand Teton winter colour (13 Nov 2026), when the region row has no credit text of its own.
const TETON_CREDIT = 'Ground colour: Copernicus Sentinel-2 (ESA), 30 Dec 2025. Aerial photos: USDA NAIP via USGS, July 2022, snow added.';
const FAROES_CREDIT = 'Heights, ground photos, buildings and water: Faroese Environment Agency, Umhvørvisstovan (DSM 2015; Myndakort, Bygningar, Topo; November 2026). House heights measured in the 2015 surface model.';   // base64 characters per message to the page; a multiple of 4

// The page's framing from a saved one: { yaw_deg, pitch_deg } (null = aim at the subject).
const pageFraming = (f: Framing | null) => (f ? { yaw_deg: f.heading, pitch_deg: f.pitch } : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "14 Nov" (the phone's own date)
function framedDay(at: string): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '';
}

// Everything under the picture. In full screen it may take at most a third of the screen and scrolls inside that:
// with the tree note, the HD line and the walk row all showing, these lines once grew past the bottom bar and pushed
// Close and the time slider off the screen (emulator, 12 Nov 2026).
function Below({ full, max, hide, children }: { full?: boolean; max: number; hide?: boolean; children: React.ReactNode }) {
  if (hide) return null;
  if (!full) return <>{children}</>;
  return <ScrollView style={{ maxHeight: max, flexGrow: 0 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>{children}</ScrollView>;
}

export default function Sun3DPanel({ pair, tripId, stopId, sun, day0, height = 208, full, onJump, onFull, hdOn, onHd, photos, preview, addShot, overhead, others, onPickOther, eyeHeight }: Props) {
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
  const [colorB64, setColorB64] = useState<string | null>(null);       // Faroes: the detail box's aerial photo
  const [bldB64, setBldB64] = useState<string | null>(null);           // Faroes: its building outlines
  const [nearColorB64, setNearColorB64] = useState<string | null>(null);   // Faroes: the fine box's aerial photo (Tetons: its winter colour)
  const [wideColorB64, setWideColorB64] = useState<string | null>(null);   // Tetons: the wide grid's winter colour (Sentinel-2)
  const [treeTiles, setTreeTiles] = useState<{ tiles: TerrainTreeTile[]; data: string[] } | null>(null);   // Tetons: the park-wide tree tiles in range
  const [wideTrees, setWideTrees] = useState(0);   // how many park-wide trees the page drew (0 = none)
  const [rangeBox, setRangeBox] = useState<{ r: TerrainRange; data: string } | null>(null);   // Tetons: the sharp range around the subject
  const [houseTiles, setHouseTiles] = useState<{ tiles: TerrainHouseTile[]; data: string[] } | null>(null);   // Tetons: the park-wide buildings in range
  const [rangeIn, setRangeIn] = useState(false);   // the page says it drew the sharp range
  const [housesIn, setHousesIn] = useState(0);     // how many buildings the page drew
  const [laser, setLaser] = useState(false);   // the foreground the page drew has a detail box (not only colour)
  const [photoFore, setPhotoFore] = useState(false);   // the page says it drew the Faroes photos / houses
  const [iceChoice, setIceChoice] = useState<boolean | null>(lastIce);   // null = the page's own default (frozen where the ground is snow)
  const [shapes, setShapes] = useState(false);   // the page says it is drawing the detail box
  const [foreBusy, setForeBusy] = useState(false);   // the foreground has been sent and the page has not answered yet
  const [foreground, setForegroundState] = useState(lastForeground);
  const [treesOn, setTreesState] = useState(lastTrees);
  const treesRef = useRef(lastTrees);
  treesRef.current = treesOn;
  const [lensId, setLensState] = useState(lastLens);
  const pickLens = LENSES.find(l => l.id === lensId) ?? LENSES[2];
  const focal = pickLens.f;
  const [frame, setFrameState] = useState<FrameMode>(lastFrame);
  // A shot made here by the first save (addShot): its new id stands in for the placeholder until the parent passes it,
  // so the view does not count it as another shot (no re-aim, no lens reset) when the id changes.
  const [made, setMade] = useState<{ from: string; id: string } | null>(null);
  const vid = made && made.from === pair.vantage_id ? made.id : pair.vantage_id;
  const ensureShot = useCallback(async (): Promise<string> => {
    if (!addShot) return vid;
    const id = await addShot();
    if (id !== pair.vantage_id) setMade({ from: pair.vantage_id, id });
    return id;
  }, [addShot, vid, pair.vantage_id]);
  const setLens = useCallback((id: string) => { lastLens = id; pickedFor = vid; setLensState(id); }, [vid]);
  const setFrame = useCallback((m: FrameMode) => { lastFrame = m; pickedFor = vid; setFrameState(m); }, [vid]);
  // The shot's saved framing (a save made on this phone first, sent or waiting, then the trip's sun plan).
  useShotSaves();   // re-render when a save is made, sent or dropped
  const framing = framingOf(vid === pair.vantage_id ? pair : { ...pair, vantage_id: vid });
  const framingRef = useRef<Framing | null>(framing);
  framingRef.current = framing;
  const queued = waitingFor(vid);   // saves of this shot still waiting for signal
  // A framed shot opens with its lens and frame box; another shot with the last ones chosen by hand.
  useEffect(() => {
    if (pickedFor === vid) return;   // the lens was just changed by hand for this shot (e.g. small view -> full screen)
    pickedFor = null;   // another shot: a hand pick on an earlier shot must not keep that shot from its saved lens and landscape / portrait later (Phil, 16 Nov 2026)
    const f = framingRef.current;
    if (f) {
      if (LENSES.some(l => l.id === f.lens)) setLensState(f.lens);
      setFrameState(f.orient === 'portrait' ? 'port' : 'land');
    } else { setLensState(lastLens); setFrameState(lastFrame); }
  }, [vid]);
  // What the page needs for the lens: focal length, the film's width and height as the camera is turned, box on / off.
  // Frame only (Phil, 17 Nov 2026): just what the lens sees, the rest of the picture black. Kept while the app is open.
  const [frameOnly, setFrameOnlyState] = useState(lastFrameOnly);
  const setFrameOnly = useCallback((v: boolean) => { lastFrameOnly = v; setFrameOnlyState(v); }, []);
  const lens = useMemo(() => ({
    f: pickLens.f,
    fw: frame === 'port' ? pickLens.short : pickLens.long,
    fh: frame === 'port' ? pickLens.long : pickLens.short,
    box: frame !== 'off',
    only: frame !== 'off' && frameOnly,   // everything outside the frame box blacked out (older pages ignore it)
  }), [pickLens, frame, frameOnly]);
  const [lit, setLit] = useState<{ subjectLit: boolean; hereLit: boolean; up: boolean; trees: boolean } | null>(null);
  const [moments, setMoments] = useState<Moments | null>(null);
  const [look, setLook] = useState<number | null>(null);
  const pairIdRef = useRef(pair.vantage_id);
  pairIdRef.current = pair.vantage_id;
  const lookRef = useRef<{ yaw: number; pitch: number } | null>(null);   // where the view points now, to 0.01 deg (page's `look`)
  // Where you stand and look, kept through a restart of the view (Phil, 17 Nov 2026: switching the foreground off / on
  // restarts the page and put him back on the saved spot): per shot, cleared when another shot is shown.
  const placedRef = useRef<string | null>(null);   // the shot and pins last sent to the page (see the place effect)
  const keepRef = useRef<{ id: string; eye: { lat: number; lng: number } | null; view: { yaw: number; pitch: number } | null } | null>(null);
  const [lookTilt, setLookTilt] = useState<number | null>(null);   // the tilt to 0.1 deg, so a tilt-only change re-checks Save framing
  const [problem, setProblem] = useState<string | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);   // the last movement's frame time, as the page measured it (offline view)
  const booted = useRef(false);
  const sent = useRef(false);
  const foreSent = useRef(false);
  const [readyN, setReadyN] = useState(0);                   // counts the page's 'ready' messages (a restart that keeps 'ready')
  const [gen, setGen] = useState(0);                         // bumped to start the web view afresh after it died
  const [heavy, setHeavy] = useState(foregroundTooHeavy);
  const loaded = useRef<string | null>(null);   // the files the plain view holds: "<region>|<fine box or nothing>"
  const loadedDetail = useRef('');               // the detail box whose files are loaded (or loading) for this shot
  const nearUsed = useRef<TerrainNear | null>(null);
  const ready = phase === 'ready';
  // Walk mode (full screen, offline view): the arrows step the viewpoint; `at` is where it now stands.
  const [walking, setWalking] = useState(false);
  // walk mode's tap to go (Phil, 18 Nov 2026): a tap on the ground in the picture jumps the viewpoint there
  const [at, setAt] = useState<{ lat: number; lng: number; moved: number } | null>(null);
  const [jumps, setJumps] = useState(0);   // tap-to-go jumps that Back can undo
  const [walkNote, setWalkNote] = useState<string | null>(null);
  const [savingSpot, setSavingSpot] = useState(false);
  const [frameNote, setFrameNote] = useState<string | null>(null);   // a one-off line about the framing (else framedLine)
  const [savingFrame, setSavingFrame] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Full screen runs edge to edge: the lines under the picture keep a margin from the sides of the phone.
  const pad = full ? styles.fullPad : null;
  const belowMax = Math.round(useWindowDimensions().height * 0.33);
  // HD: undefined = still asking whether it is there, null = not available
  const [hdCfg, setHdCfg] = useState<HdSetup | null | undefined>(undefined);
  const [hd, setHd] = useState<string | null>(null);      // Google's root tile set while the HD page is showing
  const [wantLocal, setWantLocal] = useState(false);
  const [hdNote, setHdNote] = useState<string | null>(null);
  const [hdLoading, setHdLoading] = useState(false);
  const hdRef = useRef<string | null>(null);
  hdRef.current = hd;
  const want = !overhead && (hdOn ?? wantLocal);   // (no HD from above)
  const setWant = useCallback((on: boolean) => { if (onHd) onHd(on); else setWantLocal(on); }, [onHd]);
  const savedLine = tripTerrainLine(useTripTerrain(tripId));
  // Reference photo (small view and full screen): 'card' = the small card, 'see' = see-through over the picture.
  // Phil, 16 Nov 2026: only the photo that belongs to this shot, never a pick of the stop's other photos. The shot's own
  // photo (scout_vantages.photo_id) when it has one; else the first photo the parent hands in (Find spot: the photo the
  // spot was found from); a shot with neither has no photo button.
  const ownRef: RefPhoto | null = pair.photo_id ? { id: pair.photo_id, storage_url: pair.photo_url ?? null }
    : (photos ?? []).find(p => p && (p.id || p.storage_url || p.base64_data)) ?? null;
  const refList = ownRef ? [ownRef] : [];   // small view too (Phil, 18 Nov 2026: pop the photo up without going full screen)
  const refKey = refList.map(p => p.id ?? p.storage_url ?? '').join('|');
  const [refMode, setRefMode] = useState<'off' | 'card' | 'see'>('off');
  const [refIdx, setRefIdx] = useState(0);
  const [refOpacity, setRefOpacityState] = useState(lastRefOpacity);
  // the see-through amount is kept on the phone (Phil, 16 Nov 2026: the photo button just toggles the overlay, at the
  // amount he last used)
  const setRefOpacity = useCallback((v: number) => {
    lastRefOpacity = v; setRefOpacityState(v);
    AsyncStorage.setItem(REF_OPACITY_KEY, String(v)).catch(() => {});
  }, []);
  useEffect(() => {
    if (refOpacityRead) return;
    AsyncStorage.getItem(REF_OPACITY_KEY).then(v => {
      refOpacityRead = true;
      const n = v == null ? NaN : Number(v);
      if (isFinite(n) && n > 0 && n <= 1) { lastRefOpacity = n; setRefOpacityState(n); }
    }).catch(() => {});
  }, []);
  const [topH, setTopH] = useState(40);   // the button row's height (it wraps): the card sits under it
  // Another stop's shot (next / previous) brings its own photos: start again at its first, or close when it has none.
  useEffect(() => { setRefIdx(0); if (!refKey) setRefMode('off'); }, [refKey]);
  // "Move photo" (pinch / drag the see-through photo to match the framing): on only while see-through; where the photo
  // sits is kept across photos and lenses and put back to fit when the photo is closed.
  const [refMove, setRefMove] = useState(false);
  // Ground glass (Phil, 16 Nov 2026): the picture and the shot's photo turned upside down and left-right (a 180 degree
  // turn), as a view camera's ground glass shows them, so he can frame without turning the phone. Buttons stay upright.
  // Full screen only; kept while stepping between shots.
  const [glass, setGlassState] = useState(lastGlass);
  const setGlass = useCallback((on: boolean) => { lastGlass = on; setGlassState(on); }, []);
  const glassOn = !!full && glass && !overhead;
  // The picture's size (dp): a photo placement saved with the framing (Phil, 18 Nov 2026) is put back on a view of
  // about the same size (full screen on the same phone), scaled to small differences; on another size it opens fitted.
  const [pic, setPic] = useState<{ w: number; h: number } | null>(null);
  const savedPhoto = framing?.photo ?? null;
  const [shape, setShape] = useState<number | null>(() => photoShape.get(refKey) ?? null);
  useEffect(() => { setShape(photoShape.get(refKey) ?? null); }, [refKey]);
  const onPhotoSize = useCallback((w: number, h: number) => { photoShape.set(refKey, w / h); setShape(w / h); }, [refKey]);
  // the saved placement (screen points on the view it was saved on, with the framing's lens) -> on the scene
  const savedSc = ((): PhotoOnScene | null => {
    if (!savedPhoto || !shape || !refKey || savedPhoto.key !== refKey || !framing) return null;
    const l = lensOf(framing.lens, framing.orient);
    return l ? xfToScene({ s: savedPhoto.s, x: savedPhoto.x, y: savedPhoto.y }, savedPhoto.w, savedPhoto.h, l, shape) : null;
  })();
  const savedScKey = savedSc ? `${savedSc.x}|${savedSc.y}|${savedSc.wd}` : '';
  const [refSc, setRefSc] = useState<PhotoOnScene | null>(() => refScKept.get(refKey) ?? null);
  const [photoMoved, setPhotoMoved] = useState(false);   // moved since the framing was last saved: Save framing lights up
  // what the overlay draws: the scene placement turned into this view's points (fitted until one is known)
  const refXf: PhotoXf = refSc && pic && shape ? sceneToXf(refSc, pic.w, pic.h, lens, shape) : XF0;
  const setRefXf = useCallback((xf: PhotoXf) => {
    if (!pic || !shape) return;   // (the photo is on screen to be moved, so both are known)
    const sc = xfToScene(xf, pic.w, pic.h, lens, shape);
    refScKept.set(refKey, sc); setRefSc(sc); setPhotoMoved(true);
  }, [refKey, pic, shape, lens]);
  useEffect(() => { setRefSc(refScKept.get(refKey) ?? savedSc ?? null); setPhotoMoved(false); }, [refKey, savedScKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (refMode !== 'see') setRefMove(false); }, [refMode]);

  const run = useCallback((js: string) => { web.current?.injectJavaScript(`${js};true;`); }, []);
  const oh = useOverhead3D({ overhead, ready, run, full, onFull });
  // the stop's other stand spots in the picture (not from above: Overhead draws its own)
  const [othersOn, setOthersOnState] = useState(lastOthersOn);
  const setOthersOn = useCallback((v: boolean) => { lastOthersOn = v; setOthersOnState(v); }, []);
  const otherList = useMemo(() => (overhead ? [] : (others ?? []).filter(p => p.vantage_id !== pair.vantage_id && (Math.abs(p.v.lat - pair.v.lat) > 1e-6 || Math.abs(p.v.lng - pair.v.lng) > 1e-6))
    .map(p => ({ id: p.vantage_id, code: p.code ?? null, name: p.shot_name ?? null, lat: p.v.lat, lng: p.v.lng }))), [overhead, others, pair.vantage_id, pair.v.lat, pair.v.lng]);
  const otherKey = JSON.stringify(otherList);
  useEffect(() => {
    if (!ready || hd) return;
    run(`window.S3D.others && window.S3D.others(${otherKey})`);
    run(`window.S3D.othersOn && window.S3D.othersOn(${othersOn ? 'true' : 'false'})`);
  }, [ready, readyN, hd, otherKey, othersOn, run]);
  const pickOtherRef = useRef(onPickOther); pickOtherRef.current = onPickOther;
  // Camera height above the ground (Phil, 17 Nov 2026): walk mode raises it (over the trees, on the wall) or lowers it (low
  // shots), 0.3 to 3 m. Kept through restarts of the view; back to eye height (1.73 m, 5'8") on another shot.
  // a framed shot opens at the height saved with its framing (18 Nov 2026)
  const savedH = framing?.eye != null && isFinite(framing.eye) ? Math.max(CAM_MIN, Math.min(CAM_MAX, framing.eye)) : EYE_H;
  const startH = eyeHeight != null && isFinite(eyeHeight) ? Math.max(CAM_MIN, Math.min(CAM_MAX, eyeHeight)) : savedH;
  const [camH, setCamH] = useState(startH);
  const [groundFine, setGroundFine] = useState<boolean | null>(null);
  useEffect(() => { setCamH(startH); }, [pair.vantage_id, savedH]);   // (a framing that loads late brings its height)
  // sent at most every 150 ms while a button is held (a slow phone's view is not flooded), the last value always
  const camSent = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null }>({ t: 0, timer: null });
  useEffect(() => {
    if (!ready || hd || overhead) return;
    const send = () => { camSent.current.t = Date.now(); camSent.current.timer = null; run(`window.S3D.eyeHeight && window.S3D.eyeHeight(${camH.toFixed(3)})`); };
    const c = camSent.current, wait = 150 - (Date.now() - c.t);
    if (c.timer) clearTimeout(c.timer);
    if (wait <= 0) send(); else c.timer = setTimeout(send, wait);
  }, [ready, hd, overhead, camH, run]);
  useEffect(() => { if (ready) run(`window.S3D.tapGo && window.S3D.tapGo(${walking && full && !hd ? 'true' : 'false'})`); }, [ready, readyN, walking, full, hd, run]);
  const nudgeCamH = useCallback((d: number) => setCamH(h => Math.round(Math.max(CAM_MIN, Math.min(CAM_MAX, h + d)) * 10000) / 10000), []);
  // a tap = 1 inch; held, it keeps going and speeds up (Phil, 17 Nov 2026)
  const camTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCamHold = useCallback(() => { if (camTimer.current) { clearInterval(camTimer.current); camTimer.current = null; } }, []);
  useEffect(() => stopCamHold, [stopCamHold]);
  useEffect(() => { if (camH <= CAM_MIN) stopCamHold(); }, [camH, stopCamHold]);
  const startCamHold = useCallback((dir: number) => {
    stopCamHold();
    nudgeCamH(dir * INCH);
    let held = 0, step = INCH;
    camTimer.current = setInterval(() => {
      held += 80;
      if (held < 400) return;
      step = Math.min(25, step * 1.12);   // from an inch up to 25 m a step after a few seconds
      nudgeCamH(dir * step);
    }, 80);
  }, [nudgeCamH, stopCamHold]);

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
        setPhase('finding'); setRegion(null); setNear(null); setB64(null); setNearB64(null); setDetail(null); setDetailB64(null); setMaskB64(null); setTreesB64(null); setWaterB64(null); setColorB64(null); setBldB64(null); setNearColorB64(null); setWideColorB64(null); setShapes(false); setWideTrees(0); setRangeIn(false); setHousesIn(0); setLaser(false); setPhotoFore(false); setForeBusy(false); setLit(null); setMoments(null);
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
      if (preview) return;   // Find spot's small picture: the plain terrain only (no foreground files, no restarts)
      // The foreground's files come behind the plain view, never before it: the detail box for this shot (it must sit
      // inside the fine box the page really has), its mask, the tree returns and the wide water; in the Faroes also the
      // detail box's photo and buildings, and the fine box's photo (which comes even without a detail box).
      const dt0 = await detailFor(r, nearUsed.current, stand, { lat: sLat, lng: sLng });
      const nck = nearUsed.current ? nearColor(nearUsed.current) : null;
      const wck = r ? regionColor(r) : null;   // Tetons: the wide grid's winter colour, a foreground of its own
      const tts = r ? await treeTilesFor(r, stand) : [];   // Tetons: the park-wide tree tiles within reach of this stand spot
      const rg = r ? await rangeFor(r, stand, { lat: sLat, lng: sLng }) : null;   // Tetons: the sharp range around the subject
      const hts = r ? await houseTilesFor(r, stand) : [];   // Tetons: the building tiles within reach
      // (the tree tiles only by whether there are any: another shot of the same boxes keeps the page and its tiles, and
      // the page builds its trees again around the new stand spot; a few tiles at the 12 km edge may differ, no restart)
      const key = `${dt0?.id ?? ''}|${nck?.id ?? ''}|${wck?.id ?? ''}|${tts.length ? 'trees' : ''}|${rg?.id ?? ''}|${hts.map(t => t.id).join(',')}`;
      if (!alive || key === loadedDetail.current || (key === '|||||' && loadedDetail.current === '')) return;
      if (foreSent.current) {   // the page already holds another box's foreground: start it afresh for this one
        booted.current = false; sent.current = false; foreSent.current = false;
        setLit(null); setMoments(null); setLook(null); setShapes(false); setWideTrees(0); setRangeIn(false); setHousesIn(0); setPhotoFore(false); setForeBusy(false); setPhase(p => (p === 'ready' ? 'starting' : p)); setGen(g => g + 1);
      }
      loadedDetail.current = key;
      setDetail(null); setDetailB64(null); setMaskB64(null); setTreesB64(null); setWaterB64(null); setColorB64(null); setBldB64(null); setNearColorB64(null); setWideColorB64(null); setTreeTiles(null); setRangeBox(null); setHouseTiles(null);
      if (!dt0 && !nck && !wck && !tts.length && !rg && !hts.length) return;
      const mk = dt0 && detailMask(dt0), tk = dt0 && detailTrees(dt0), wk = dt0 && detailWater(dt0), ck = dt0 && detailColor(dt0), bk = dt0 && detailBuildings(dt0);
      const [dd, md, td, wd, cd, bd, ncd, wcd] = await Promise.all([dt0 ? terrainData(dt0) : null, mk ? terrainData(mk) : null, tk ? terrainData(tk) : null, wk ? terrainData(wk) : null,
        ck ? terrainData(ck) : null, bk ? terrainData(bk) : null, nck ? terrainData(nck) : null, wck ? terrainData(wck) : null]);
      // the tree tiles one at a time (a few hundred KB each): a tile that is not there (no signal) is simply left out
      const tds: { t: TerrainTreeTile; d: string }[] = [];
      for (const t of tts) { const d = await terrainData(treeTileFile(t)); if (!alive || loadedDetail.current !== key) return; if (d) tds.push({ t, d }); }
      const rgd = rg ? await terrainData(rangeFile(rg)) : null;
      const hds: { t: TerrainHouseTile; d: string }[] = [];
      for (const t of hts) { const d = await terrainData(houseTileFile(t)); if (!alive || loadedDetail.current !== key) return; if (d) hds.push({ t, d }); }
      if (!alive || loadedDetail.current !== key) return;
      if (!dd && !ncd && !wcd && !tds.length && !rgd && !hds.length) { loadedDetail.current = ''; return; }   // not on the phone and no signal: tried again with the next shot
      setRangeBox(rg && rgd ? { r: rg, data: rgd } : null);
      setHouseTiles(hds.length ? { tiles: hds.map(x => x.t), data: hds.map(x => x.d) } : null);
      setNearColorB64(ncd); setWideColorB64(wcd);
      setTreeTiles(tds.length ? { tiles: tds.map(x => x.t), data: tds.map(x => x.d) } : null);
      if (dt0 && dd) { setMaskB64(md); setTreesB64(td); setWaterB64(wd); setColorB64(cd); setBldB64(bd); setDetailB64(dd); setDetail(dt0); }
    })();
    return () => { alive = false; };
  }, [vLat, vLng, sLat, sLng, preview]);

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
    setLit(null); setMoments(null); setLook(null); setHdLoading(false); setProblem(null); setShapes(false); setWideTrees(0); setRangeIn(false); setHousesIn(0); setPhotoFore(false);
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
    setLit(null); setMoments(null); setLook(null); setShapes(false); setWideTrees(0); setRangeIn(false); setHousesIn(0); setPhotoFore(false); setForeBusy(false); setProblem(null);
    setPhase(p => (p === 'ready' || p === 'error' ? 'starting' : p)); setGen(g => g + 1);
  }, []);
  // Trees shown / hidden inside the foreground: the page only switches their visibility (no restart, no rebuild);
  // the sun times never use them, so first / last light stay exactly as they are.
  const setTrees = useCallback((on: boolean) => {
    lastTrees = on; treesRef.current = on; setTreesState(on);
    run(`window.S3D.trees && window.S3D.trees(${on ? 'true' : 'false'})`);
  }, [run]);
  // The foreground button's three states, in turn: everything -> buildings only (no trees) -> off -> everything.
  const cycleForeground = useCallback(() => {
    if (!foreground) { setForeground(true); return; }   // (trees are already back on: see below)
    if (treesOn) { setTrees(false); return; }
    lastTrees = true; treesRef.current = true; setTreesState(true);   // off; the next "on" is everything again
    setForeground(false);
  }, [foreground, treesOn, setForeground, setTrees]);
  const foreSay = !foreground ? 'off' : treesOn ? 'on' : 'buildings only, no trees';
  const refOn = !hd && !preview && refList.length > 0 && !overhead;   // (not on Find my spot's small lens previews)   // the photo button and card: offline view, the shot has a photo (small view and full screen)
  const refPhoto = refList[Math.min(refIdx, Math.max(0, refList.length - 1))] ?? null;
  const hasFore = (!!detail && !!detailB64) || !!nearColorB64 || !!wideColorB64 || !!treeTiles || !!rangeBox || !!houseTiles;   // a detail box, or a fine box's photo, or (Tetons) the wide winter colour or the park-wide trees
  const useDetail = (foreground || (!!overhead && !heavy)) && !hd && hasFore && !preview;   // from above: always (unless it proved too heavy)
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
      view: (keepRef.current?.id === pair.vantage_id && keepRef.current.view ? { yaw_deg: keepRef.current.view.yaw, pitch_deg: keepRef.current.view.pitch } : null)
        ?? pageFraming(framingRef.current) ?? undefined,   // a restart keeps the view; else a framed shot opens on its framing
      start: keepRef.current?.id === pair.vantage_id && keepRef.current.eye ? keepRef.current.eye : undefined,   // a walked-to spot
      level: lastLevels ?? undefined,
      treeStyle: TREE_STYLE,   // how the laser trees are drawn (services/terrain.ts TREE_STYLE)
      trees: overhead ? true : treesRef.current,   // the foreground's trees shown or hidden (older pages ignore it)
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
    if (foreSent.current || !useDetail) return;
    const det = detail && detailB64 ? detail : null, nc = near && nearB64 ? nearColorB64 : null;   // a fine-box photo needs the fine box in the page
    if (!det && !nc && !wideColorB64 && !treeTiles && !rangeBox && !houseTiles) return;
    foreSent.current = true; setForeBusy(true);
    const fore = {
      detail: det ? {
        n: det.n, north: det.north, south: det.south, west: det.west, east: det.east, base: det.base_m, step: det.step_m,
        width: det.width_m ?? undefined, depth: det.depth_m ?? undefined, bare: det.bare ?? undefined,
        trees: treesB64 ? { bins: det.trees_bins ?? 64, bin: det.trees_bin_m ?? 0.6 } : undefined,
        leaf: detailLeaf(det) || undefined,
      } : undefined,
      water: det && waterB64 ? { n: det.water_n, north: det.water_north, south: det.water_south, west: det.water_west, east: det.water_east } : undefined,
      ice: iceOn,
      canopy: treeTiles ? { tiles: treeTiles.tiles.map(t => ({ n: t.n, north: t.north, south: t.south, west: t.west, east: t.east, step: t.step_m, lod: t.lod ? 1 : 0 })), leaf: treeTilesLeaf(treeTiles.tiles) || undefined } : undefined,
      range: rangeBox ? { n: rangeBox.r.n, north: rangeBox.r.north, south: rangeBox.r.south, west: rangeBox.r.west, east: rangeBox.r.east, base: rangeBox.r.base_m, step: rangeBox.r.step_m } : undefined,
      houses: houseTiles ? { tiles: houseTiles.tiles.map(t => ({ north: t.north, south: t.south, west: t.west, east: t.east })) } : undefined,
    };
    run(`window.S3D.fore(${JSON.stringify(fore)})`);
    const feed = (data: string | null, kind: string) => { if (data) for (let i = 0; i < data.length; i += CHUNK) run(`window.S3D.chunk("${data.slice(i, i + CHUNK)}","${kind}")`); };
    if (rangeBox) feed(rangeBox.data, 'range');   // first: the page builds it first, right after the plain view
    if (det) { feed(detailB64, 'detail'); feed(maskB64, 'mask'); feed(treesB64, 'trees'); feed(waterB64, 'water'); feed(colorB64, 'color'); feed(bldB64, 'bld'); }
    feed(nc, 'ncolor'); feed(wideColorB64, 'wcolor');
    if (houseTiles) houseTiles.data.forEach((d, i) => feed(d, `house:${i}`));
    // last: the page builds them after everything else. Smaller pieces: the page's engine frees pieces under ~128 KB
    // soon after use (young objects), bigger ones only at a full clean-up, and a trip's tiles are a few MB of text
    if (treeTiles) treeTiles.data.forEach((d, i) => { for (let k = 0; k < d.length; k += TREE_CHUNK) run(`window.S3D.chunk("${d.slice(k, k + TREE_CHUNK)}","canopy:${i}")`); });
    run('window.S3D.foreDone()');
  }, [useDetail, detail, detailB64, maskB64, treesB64, waterB64, colorB64, bldB64, nearColorB64, wideColorB64, treeTiles, rangeBox, houseTiles, near, nearB64, iceOn, run]);
  useEffect(() => { if (ready) sendFore(); }, [ready, sendFore]);
  // The page answers every foreground request within its own minute (drawn, or dropped). If no answer comes at all
  // (the request never reached the page), stop saying "loading" and say the plain view is what is shown.
  const [foreLost, setForeLost] = useState(false);
  const [about, setAbout] = useState(false);   // the long notes and credits, behind one link (Phil, 13 Nov 2026: "too much explanation text")
  useEffect(() => {
    if (!foreBusy) return;
    const t = setTimeout(() => { setForeBusy(false); setForeLost(true); }, 90000);
    return () => clearTimeout(t);
  }, [foreBusy]);
  useEffect(() => { if (shapes || !foreground) setForeLost(false); }, [shapes, foreground]);

  // The web view's own process died (Android: out of memory, or killed) or its graphics context went. With the
  // foreground on, that is the likely cause: start once more WITHOUT it, switch it off for this session and say so.
  // Without the foreground nothing is restarted: no loop.
  const onGone = useCallback(() => {
    if (hdRef.current) { hdForget(); setHdNote("The HD picture couldn't load. Showing the offline view."); setWant(false); return; }
    booted.current = false; sent.current = false; foreSent.current = false;
    setLit(null); setMoments(null); setLook(null); setShapes(false); setWideTrees(0); setRangeIn(false); setHousesIn(0); setPhotoFore(false); setForeBusy(false);
    if (useDetailRef.current) {
      lastForeground = false; foregroundTooHeavy = true;
      setForegroundState(false); setHeavy(true); setProblem(null); setPhase('starting'); setGen(g => g + 1);
    } else { setProblem('The 3D view stopped on this phone.'); setPhase('error'); }
  }, [setWant]);

  const walkQ = useRef({ busy: 0, f: 0, r: 0 });   // walk steps in flight (see sendWalk)
  const walkAnsweredRef = useRef<() => void>(() => {});   // set by the walk code below (a step answered)
  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let m: any = null;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (oh.onMessage(m)) return;
    if (m.type === 'boot') { booted.current = true; foreSent.current = false; setPerf(null); start(); }
    else if (m.type === 'perf') {
      if (m.levels && typeof m.levels.look === 'number' && typeof m.levels.sun === 'number') lastLevels = { look: m.levels.look, sun: m.levels.sun };
      if (typeof m.ms === 'number') setPerf({ ms: m.ms, worst: typeof m.worst === 'number' ? m.worst : m.ms, quality: typeof m.quality === 'string' ? m.quality : 'full' });
    }
    else if (m.type === 'ready') { setPhase('ready'); setReadyN(n => n + 1); }   // every page start gets the pins again
    else if (m.type === 'foreground') { setShapes(!!m.ok); setLaser(!!(m.ok && m.detail)); setPhotoFore(!!(m.ok && m.colour)); setForeBusy(false); }   // not ok = the page dropped it and kept the plain view
    else if (m.type === 'wideTrees') setWideTrees(m.ok && typeof m.trees === 'number' ? m.trees : 0);   // not ok = left out, the rest stays
    else if (m.type === 'range') setRangeIn(!!m.ok);   // not ok = left out, the view stays as it was
    else if (m.type === 'houses') { setHousesIn(m.ok && typeof m.count === 'number' ? m.count : 0); setForeBusy(false); }   // the last stage before the trees
    else if (m.type === 'lost') onGone();
    else if (m.type === 'state') setLit({ subjectLit: !!m.subjectLit, hereLit: !!m.hereLit, up: !!m.up, trees: !!m.trees });
    else if (m.type === 'moments') setMoments({ firstSubject: m.firstSubject ?? null, lastSubject: m.lastSubject ?? null, firstHere: m.firstHere ?? null, lastHere: m.lastHere ?? null, trees: !!m.trees });
    else if (m.type === 'look') {
      setLook(typeof m.deg === 'number' ? m.deg : null);
      lookRef.current = typeof m.deg === 'number' ? { yaw: typeof m.yaw === 'number' ? m.yaw : m.deg, pitch: typeof m.pitch === 'number' ? m.pitch : 0 } : null;
      if (lookRef.current && !overhead) keepRef.current = { id: pairIdRef.current, eye: keepRef.current?.id === pairIdRef.current ? keepRef.current.eye : null, view: lookRef.current };
      setLookTilt(typeof m.pitch === 'number' ? Math.round(m.pitch * 10) / 10 : null);
    }
    else if (m.type === 'eye') {
      setAt({ lat: m.lat, lng: m.lng, moved: m.moved || 0 }); setWalkNote(null); walkAnsweredRef.current();
      if (typeof m.back === 'number') setJumps(m.back);
      if (typeof m.fine === 'boolean') setGroundFine(m.fine);
      if (!overhead) keepRef.current = { id: pairIdRef.current, eye: (m.moved || 0) > 0 ? { lat: m.lat, lng: m.lng } : null, view: keepRef.current?.id === pairIdRef.current ? keepRef.current.view : null };
    }
    else if (m.type === 'otherTap') { if (typeof m.id === 'string' && pickOtherRef.current) pickOtherRef.current(m.id); }
    else if (m.type === 'walk') { walkQ.current.busy = 0; walkQ.current.f = 0; walkQ.current.r = 0; setWalkNote(m.stopped === 'far' ? `That's as far as walk mode goes: ${m.max} m from your saved spot.` : m.stopped === 'sky' ? 'Tap the ground to jump there, not the sky.' : 'That is the edge of the saved terrain.'); }
    else if (m.type === 'hd') setHdLoading(!!m.loading);
    else if (m.type === 'error') {
      if (hdRef.current) {
        // the HD page gave up (no signal, Google's session ran out, the phone's memory): back to the offline view
        hdForget();
        setHdNote("The HD picture couldn't load. Showing the offline view.");
        setWant(false);
      } else { setProblem(String(m.msg ?? '')); setPhase(p => (p === 'ready' ? p : 'error')); }
    }
  }, [start, setWant, onGone, oh.onMessage]);

  // The sun follows the slider; the place and the day's first / last light follow the chosen shot.
  const az = sun.az, alt = sun.alt;
  useEffect(() => { if (ready) run(`window.S3D.sun(${az.toFixed(3)},${alt.toFixed(3)})`); }, [ready, az, alt, run]);
  useEffect(() => {
    if (!ready) return;
    setMoments(null);
    // After a restart of the view for the same shot and the same pins (foreground off / on), the page was started where
    // you had walked to and looking where you looked (keepRef in start()): sending the shot's spot again would put you
    // back on the saved spot (Phil, 17 Nov 2026), so only the day's path goes.
    const placed = `${vid}|${vLat}|${vLng}|${sLat}|${sLng}`;
    const kept = keepRef.current?.id === vid && (keepRef.current.eye || keepRef.current.view);
    if (!(kept && placedRef.current === placed)) run(`window.S3D.view(${vLat},${vLng},${sLat},${sLng},${JSON.stringify(pageFraming(framingRef.current))})`);
    placedRef.current = placed;
    run(`window.S3D.path(${JSON.stringify(dayPath)})`);
  }, [ready, vid, vLat, vLng, sLat, sLng, dayPath, run]);
  useEffect(() => { if (ready) run(`window.S3D.lens(${JSON.stringify(lens)})`); }, [ready, lens, run]);

  // ---- Walk mode ----
  // A new shot (or a saved move) puts the viewpoint back on the stand pin.
  useEffect(() => { setAt(null); setWalkNote(null); }, [vLat, vLng, sLat, sLng]);
  useEffect(() => { if (keepRef.current && keepRef.current.id !== pair.vantage_id) keepRef.current = null; }, [pair.vantage_id]);
  useEffect(() => { setFrameNote(null); }, [vid]);
  // A save of this shot that waited for signal and was then refused by the server: said once.
  useEffect(() => { const r = takeRefusal(vid); if (r) setFrameNote(`A save made with no signal was refused: ${r}`); });
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
  // Fine steps (Phil, 16 Nov 2026): a tap moves 25 cm; held, it starts walking after a moment and speeds up to 2 m a
  // step (~15 m a second). (f, r) give the direction: forward / back and right / left.
  // One walk step in flight at a time (emulator run 1, 16 Nov 2026: a held arrow sent a step every 100-130 ms while a
  // slow phone drew one frame a second, and the app stopped answering); steps that come in meanwhile are added up and
  // go as one when the page says where it now stands (its 'eye' message), or after 1.5 s at the most.
  const sendWalk = useCallback((df: number, dr: number) => {
    const q = walkQ.current;
    if (q.busy && Date.now() - q.busy < 1500) { q.f += df; q.r += dr; return; }
    q.busy = Date.now();
    run(`window.S3D.walk(${(df + q.f).toFixed(3)},${(dr + q.r).toFixed(3)})`);
    q.f = 0; q.r = 0;
  }, [run]);
  const walkAnswered = useCallback(() => {
    const q = walkQ.current; q.busy = 0;
    if (q.f || q.r) sendWalk(0, 0);
  }, [sendWalk]);
  walkAnsweredRef.current = walkAnswered;
  const startStepping = useCallback((f: number, r: number) => {
    stopStepping();
    const go = (m: number) => sendWalk(f * m, r * m);
    go(FINE_STEP);
    let size = FINE_STEP, held = 0;
    stepTimer.current = setInterval(() => {
      held += 100;
      if (held < 400) return;   // a tap is just the one fine step
      size = Math.min(WALK_STEP, size * 1.18);
      go(size);
    }, 100);
  }, [sendWalk, stopStepping]);
  // Leaving walk mode keeps the view where it walked to (Phil, 16 Nov 2026); "Back to my spot" in walk mode goes back.
  const leaveWalk = useCallback(() => { stopStepping(); setWalking(false); setWalkNote(null); }, [stopStepping]);
  const canSaveSpot = !!(tripId && stopId && at && at.moved >= 0.5);
  // Save framing greys out while the view is exactly the saved framing, like Save as my spot (Phil, 16 Nov 2026).
  const frameUnchanged = (() => {
    const lk = lookRef.current;
    if (!framing || addShot || !lk) return false;
    const dh = Math.abs(((((lk.yaw - framing.heading) % 360) + 540) % 360) - 180);
    return dh < 0.3 && Math.abs(lk.pitch - framing.pitch) < 0.3 && framing.lens === pickLens.id
      && framing.orient === (frame === 'port' ? 'portrait' : 'landscape') && !photoMoved && Math.abs(camH - savedH) < 0.005;
  })();
  void lookTilt;   // (read so the tilt state re-renders this check)
  const saveSpot = useCallback(() => {
    if (!tripId || !stopId || !at) return;
    const spot = at;
    Alert.alert(
      'Move your stand spot here?',
      `${addShot ? ADD_FIRST : ''}This shot's stand spot moves ${at.moved} m to where you are standing in the view. The sun times and the planner follow. It changes the shot on every trip that uses it, practice copies included.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move it', onPress: async () => {
            setSavingSpot(true);
            try {
              const id = await ensureShot();
              const r = await saveShot({ kind: 'move', tripId, stopId, vantageId: id, lat: spot.lat, lng: spot.lng, at: new Date().toISOString() });
              setWalkNote(r === 'queued' ? null : 'Saved: this is now your stand spot for the shot.');   // waiting: the line below says so
            }
            catch (e: any) { setWalkNote(`Couldn't save the spot: ${e?.message || 'try again'}`); }
            finally { setSavingSpot(false); }
          },
        },
      ],
    );
  }, [tripId, stopId, at, addShot, ensureShot]);

  // ---- Framing ----
  const canFrame = !!(tripId && stopId);
  const saveFraming = useCallback(() => {
    const lk = lookRef.current;
    if (!tripId || !stopId || !lk) return;
    const f: Framing = {
      heading: Math.round((((lk.yaw % 360) + 360) % 360) * 100) / 100, pitch: Math.round(lk.pitch * 100) / 100,
      lens: pickLens.id, orient: frame === 'port' ? 'portrait' : 'landscape', at: new Date().toISOString(),
      eye: Math.abs(camH - EYE_H) < 0.005 ? null : Math.round(camH * 10000) / 10000,   // camera height goes with the framing
    };
    // the photo goes with the framing when it is on screen or was moved; else the saved placement (if any) stays
    const withPhoto = !!(refKey && pic && (refMode === 'see' || photoMoved));
    if (withPhoto && pic) f.photo = { key: refKey, s: refXf.s, x: refXf.x, y: refXf.y, w: pic.w, h: pic.h };
    else if (framingRef.current?.photo !== undefined) f.photo = framingRef.current?.photo ?? null;
    const tilt = Math.abs(f.pitch) < 0.5 ? 'level' : `tilted ${f.pitch > 0 ? 'up' : 'down'} ${Math.abs(f.pitch).toFixed(1)}°`;
    Alert.alert(
      'Save this framing?',
      `${addShot ? ADD_FIRST : ''}The shot will open looking ${compassPoint(f.heading)} ${Math.round(f.heading)}°, ${tilt}, ${pickLens.f} mm on ${pickLens.format}, ${f.orient}${f.eye != null ? `, camera ${feetIn(f.eye)} up` : ''}.${withPhoto ? ' Your photo stays where you put it.' : ''} It changes the shot on every trip that uses it, practice copies included.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save', onPress: async () => {
            setSavingFrame(true);
            try {
              const id = await ensureShot();
              const r = await saveShot({ kind: 'frame', tripId, stopId, vantageId: id, framing: f });
              setPhotoMoved(false);
              pickedFor = null;   // the saved framing (lens, landscape / portrait) is what this shot opens with from now on
              run(`window.S3D.view(${JSON.stringify(pageFraming(f))})`);   // later re-aims (foreground, walk's home) keep it
              setFrameNote(null);   // the framing line says Framed, or that it waits for signal
            } catch (e: any) { setFrameNote(`Couldn't save the framing: ${e?.message || 'try again'}`); }
            finally { setSavingFrame(false); }
          },
        },
      ],
    );
  }, [tripId, stopId, pickLens, frame, run, addShot, ensureShot, refKey, pic, refMode, photoMoved, refXf, camH]);
  const aimAtSubject = useCallback(() => {
    run('window.S3D.view(null)');
    setFrameNote(framingRef.current ? 'Aimed at the subject. Your saved framing is kept.' : null);
  }, [run]);
  // Reset framing (Phil, 18 Nov 2026): back to the last saved framing (direction, tilt, lens, landscape / portrait and,
  // when one was saved with it, where the photo sat), instead of aiming at the subject.
  const resetFraming = useCallback(() => {
    const f = framingRef.current;
    if (!f) return;
    pickedFor = null;
    if (LENSES.some(l => l.id === f.lens)) setLensState(f.lens);
    setFrameState(f.orient === 'portrait' ? 'port' : 'land');
    run(`window.S3D.view(${JSON.stringify(pageFraming(f))})`);
    if (savedSc) { refScKept.set(refKey, savedSc); setRefSc(savedSc); }
    setCamH(savedH);
    setPhotoMoved(false);
    setFrameNote('Back to your saved framing.');
  }, [run, savedSc, refKey, savedH]);
  const forgetFraming = useCallback(() => {
    if (!tripId || !stopId) return;
    Alert.alert('Forget this framing?', 'The shot will open aimed at the subject again, on every trip that uses it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget', style: 'destructive', onPress: async () => {
          try {
            const r = await saveShot({ kind: 'unframe', tripId, stopId, vantageId: vid, at: new Date().toISOString() });
            run('window.S3D.view(null)');
            setFrameNote(r === 'queued' ? null : 'Framing forgotten: the shot opens aimed at the subject.');
          } catch (e: any) { setFrameNote(`Couldn't forget the framing: ${e?.message || 'try again'}`); }
        },
      },
    ]);
  }, [tripId, stopId, vid, run]);
  const framedLine = queued.frame ? 'Saved on the phone, sends when you have signal.'
    : addShot ? 'Not a shot yet: saving adds it'
    : framing ? `Framed ${framedDay(framing.at)} · ${LENSES.find(l => l.id === framing.lens)?.format === '6×9 (GW690)' ? '6×9' : `${framing.lens} mm`} · ${framing.orient}${framing.eye != null ? ` · camera ${feetIn(framing.eye)} up` : ''}${framing.photo ? ' · photo placed' : ''}`
    : 'Not framed yet';

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
    <View style={full ? styles.fullWrap : undefined} accessibilityLabel={overhead ? `Overhead 3D ${ready ? 'ready' : phase}, ${overhead.pairs.length} shots` : `3D view ${ready ? 'ready' : phase}${full ? ` · photos ${refList.length} of ${photos?.length ?? 0}` : ''}`}>
      <View style={[styles.frame, full ? styles.frameFull : { height }]} pointerEvents={preview ? 'none' : 'auto'}>
        <View style={[styles.web, glassOn ? styles.glass : null]} pointerEvents="box-none"
          onLayout={e => { const { width: w, height: h } = e.nativeEvent.layout; setPic(p => (p && Math.abs(p.w - w) < 0.5 && Math.abs(p.h - h) < 0.5 ? p : { w, h })); }}>
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
        {refOn && refMode === 'see' && refPhoto ? <RefPhotoGhost photo={refPhoto} opacity={refOpacity} xf={refXf} move={refMove} onXf={setRefXf} onSize={onPhotoSize} /> : null}
        </View>
        {waiting ? (
          <View style={styles.cover} pointerEvents="none"><Text style={styles.coverText}>{waiting}</Text></View>
        ) : null}
        {oh.controls}
        <View style={[styles.topRow, preview || overhead ? { display: 'none' } : null]} pointerEvents="box-none" onLayout={e => setTopH(Math.round(e.nativeEvent.layout.height))}>
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
            {frame !== 'off' && !hd ? (
              <TouchableOpacity
                onPress={() => setFrameOnly(!frameOnly)}
                style={[styles.fullBtn, frameOnly && styles.lensOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: frameOnly }}
                accessibilityLabel={frameOnly ? 'Frame only: on. Tap to see around the frame' : 'Frame only: off. Tap to black out everything outside the frame'}
                hitSlop={6}
              >
                <Ionicons name="crop-outline" size={17} color={frameOnly ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            {hasFore && !hd ? (
              <TouchableOpacity
                onPress={cycleForeground}
                style={[styles.fullBtn, foreground && styles.lensOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: foreground }}
                accessibilityLabel={`Foreground (trees and buildings near you): ${foreSay}${foreground ? (shapes ? ', showing' : foreBusy ? ', loading' : '') : ''}. Tap to change.`}
                hitSlop={6}
              >
                <Ionicons name={foreground && !treesOn ? 'business-outline' : 'leaf-outline'} size={17} color={foreground ? '#000000' : '#ffffff'} />
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
            {otherList.length && !hd ? (
              <TouchableOpacity
                onPress={() => setOthersOn(!othersOn)}
                style={[styles.fullBtn, othersOn && styles.lensOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: othersOn }}
                accessibilityLabel={othersOn ? `Other stand spots shown (${otherList.length}). Tap to hide` : `Other stand spots hidden (${otherList.length}). Tap to show`}
                hitSlop={6}
              >
                <Ionicons name="location-outline" size={17} color={othersOn ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            {full ? (
              <TouchableOpacity
                onPress={() => setGlass(!glass)}
                style={[styles.fullBtn, glass && styles.lensOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: glass }}
                accessibilityLabel={glass ? 'Ground glass on: picture upside down' : 'Ground glass: turn the picture upside down'}
                hitSlop={6}
              >
                <Ionicons name="swap-vertical" size={17} color={glass ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            {refOn ? (
              <TouchableOpacity
                onPress={() => setRefMode(refMode === 'off' ? 'see' : 'off')}
                style={[styles.fullBtn, refMode !== 'off' && styles.lensOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: refMode !== 'off' }}
                accessibilityLabel="Reference photo"
                hitSlop={6}
              >
                <Ionicons name="image-outline" size={17} color={refMode !== 'off' ? '#000000' : '#ffffff'} />
              </TouchableOpacity>
            ) : null}
            {/* full screen has its own Close at the bottom: no shrink button up here (Phil, 18 Nov 2026: next to the photo
                button it was hit by mistake and threw away the walked spot and framing) */}
            {!full ? (
              <TouchableOpacity onPress={onFull} style={styles.fullBtn} accessibilityRole="button" accessibilityLabel="Open the 3D view full screen" hitSlop={6}>
                <Ionicons name="expand-outline" size={18} color="#ffffff" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        {walking && full && !hd && ready ? (
          <View style={styles.pad} pointerEvents="box-none">
            {([['Walk forward', 'chevron-up', 1, 0, styles.padUp], ['Step left', 'chevron-back', 0, -1, styles.padLeft], ['Step right', 'chevron-forward', 0, 1, styles.padRight], ['Walk back', 'chevron-down', -1, 0, styles.padDown]] as const).map(([label, icon, f, r, where]) => (
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
        {refOn && refMode === 'card' ? (
          <RefPhotoCard photos={refList} index={Math.min(refIdx, refList.length - 1)} onIndex={setRefIdx} onSee={() => setRefMode('see')} onClose={() => setRefMode('off')} top={8 + topH + 2} />
        ) : null}
        {refOn && refMode === 'see' ? (
          // above the caption; while walking, above the walk arrows (bottom-left, up to 192 dp)
          <SeeThroughBar value={refOpacity} onChange={setRefOpacity} onClose={() => setRefMode('off')} bottom={walking ? 200 : 34} move={refMove} onMove={setRefMove} />
        ) : null}
        {ready && look != null && !overhead ? (
          <Text style={[styles.caption, hd ? styles.captionHd : null]} pointerEvents="none">Looking {compassPoint(look)} {look}° · {focal} mm on {pickLens.format}{preview ? '' : ` · ${hd && hdLoading ? 'loading the picture…' : full ? 'drag to look around' : 'drag sideways to look'}`}</Text>
        ) : null}
      </View>

      <Below full={full} max={belowMax} hide={preview || !!overhead}>
      {ready && lit ? (
        <Text style={[styles.status, pad]}>
          <Text style={lit.subjectLit ? styles.sunOn : undefined}>{subject}: {lit.subjectLit ? 'in the sun' : lit.up ? 'in shadow' : 'no sun'}</Text>
          <Text>  ·  </Text>
          <Text style={lit.hereLit ? styles.sunOn : undefined}>You: {lit.hereLit ? 'in the sun' : lit.up ? 'in shade' : 'no sun'}</Text>
        </Text>
      ) : phase === 'error' && problem ? (
        <Text style={[styles.status, pad]}>{problem}</Text>
      ) : null}
      {foreLost && foreground && !shapes && !hd ? <Text style={[styles.note, pad]}>Foreground didn't load. Turn it off and on to retry.</Text> : null}
      {heavy && !foreground && !hd ? <Text style={[styles.note, pad]}>Foreground too heavy for this phone: off.</Text> : null}
      {hdNote && !hd ? <Text style={[styles.note, pad]}>{hdNote}</Text> : null}
      {walking && full && !hd ? (
        <View style={[styles.walkRow, pad]}>
          <Text style={styles.walkText}>
            {queued.move ? 'Saved on the phone, sends when you have signal.' : walkNote ?? (at && at.moved > 0 ? `You've walked ${at.moved < 10 ? at.moved.toFixed(1) : Math.round(at.moved)} m from your saved spot. The times below are for here.` : 'Tap the ground to jump there, or hold an arrow to walk. Drag the picture to turn.')}
          </Text>
          <View style={styles.heightRow}>
            <Text style={styles.heightLabel} accessibilityLabel={`Camera height ${feetIn(camH)}, ${camH.toFixed(2)} metres`}>
              Camera {feetIn(camH)} · {camH < 10 ? camH.toFixed(2) : Math.round(camH)} m{groundFine === false ? ' · ground ±2 m here' : ''}
            </Text>
            <TouchableOpacity onPressIn={() => startCamHold(-1)} onPressOut={stopCamHold} disabled={camH <= CAM_MIN} style={[styles.heightBtn, camH <= CAM_MIN && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel="Lower the camera" hitSlop={4}>
              <Ionicons name="remove" size={18} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity onPressIn={() => startCamHold(1)} onPressOut={stopCamHold} style={styles.heightBtn} accessibilityRole="button" accessibilityLabel="Raise the camera" hitSlop={4}>
              <Ionicons name="add" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <View style={styles.heightRow}>
            {([['Low', 0.5], ['Eye', EYE_H], ['On the wall', 2.7]] as const).map(([t, v]) => (
              <TouchableOpacity key={t} onPress={() => setCamH(v)} style={[styles.heightChip, Math.abs(camH - v) < 0.01 && styles.heightChipOn]} accessibilityRole="button" accessibilityLabel={`Camera ${t}: ${feetIn(v)}`}>
                <Text style={[styles.heightChipText, Math.abs(camH - v) < 0.01 && { color: '#000000' }]}>{t} {feetIn(v)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.walkBtns}>
            <TouchableOpacity onPress={() => { stopStepping(); run('window.S3D.back && window.S3D.back()'); }} style={styles.walkBtn} accessibilityRole="button" accessibilityLabel="Back: undo the last jump" disabled={jumps === 0}>
              <Text style={[styles.walkBtnText, jumps === 0 && { opacity: 0.4 }]}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { stopStepping(); run('window.S3D.home()'); }} style={styles.walkBtn} accessibilityRole="button" accessibilityLabel="Back to my saved spot" disabled={!at || at.moved === 0}>
              <Text style={[styles.walkBtnText, (!at || at.moved === 0) && { opacity: 0.4 }]}>Back to my spot</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveSpot} style={[styles.walkBtn, styles.walkBtnMain, !canSaveSpot && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Save this as my stand spot for the shot" disabled={!canSaveSpot || savingSpot}>
              {savingSpot ? <ActivityIndicator size="small" color="#000000" /> : <Text style={styles.walkBtnMainText}>Save as my spot</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {full && !hd && ready ? (
        <View style={[styles.walkRow, pad]}>
          <Text style={styles.walkText} accessibilityLabel={`Framing: ${frameNote ?? framedLine}`}>{frameNote ?? framedLine}</Text>
          <View style={styles.walkBtns}>
            <TouchableOpacity onPress={aimAtSubject} style={styles.walkBtn} accessibilityRole="button" accessibilityLabel="Aim at subject">
              <Text style={styles.walkBtnText}>Aim at subject</Text>
            </TouchableOpacity>
            {framing && !addShot ? (
              <TouchableOpacity onPress={resetFraming} style={styles.walkBtn} accessibilityRole="button" accessibilityLabel="Reset framing to the saved one" accessibilityState={{ disabled: frameUnchanged }} disabled={frameUnchanged}>
                <Text style={[styles.walkBtnText, frameUnchanged && { opacity: 0.4 }]}>Reset framing</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={saveFraming} style={[styles.walkBtn, styles.walkBtnMain, (!canFrame || frameUnchanged) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Save framing for this shot" accessibilityState={{ disabled: !canFrame || frameUnchanged }} disabled={!canFrame || savingFrame || look == null || frameUnchanged}>
              {savingFrame ? <ActivityIndicator size="small" color="#000000" /> : <Text style={styles.walkBtnMainText}>Save framing</Text>}
            </TouchableOpacity>
          </View>
          {framing && canFrame && !addShot && !queued.frame ? (
            <TouchableOpacity onPress={forgetFraming} accessibilityRole="button" accessibilityLabel="Forget the saved framing" hitSlop={{ top: 6, bottom: 6 }}>
              <Text style={[styles.streetLink, { marginTop: 0 }]}>Forget framing</Text>
            </TouchableOpacity>
          ) : null}
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
        <View style={[styles.aboutRow, pad]}>
          {perf && !hd ? (
            <Text style={styles.perf} numberOfLines={1} accessibilityLabel={`Smoothness: ${perfLine(perf)}`}>Smoothness: {perfLine(perf)}</Text>
          ) : null}
          {foreBusy && !hd ? <Text style={styles.perf}>Foreground loading…</Text> : null}
          {hd && left != null ? <Text style={styles.perf}>HD views left: {leftToday != null ? `${leftToday} today, ` : ''}{left} this month</Text> : null}
          <TouchableOpacity
            onPress={() => Linking.openURL(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pair.v.lat},${pair.v.lng}&heading=${look ?? 0}`).catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel="Open Street View at this stand spot, facing the same way"
            hitSlop={{ top: 6, bottom: 6 }}
          >
            <Text style={[styles.streetLink, { marginTop: 0 }]}>Street View ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAbout(!about)} accessibilityRole="button" accessibilityLabel={about ? 'Hide about this view' : 'About this view: sources and notes'} hitSlop={{ top: 6, bottom: 6 }}>
            <Text style={[styles.streetLink, { marginTop: 0 }]}>{about ? 'Less' : 'About ›'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {ready && about ? (
        <View style={pad}>
          {shapes && (lit?.trees || moments?.trees) ? (
            <Text style={styles.note}>{lit?.trees ? 'Trees near you may block the sun right now' : 'Trees near you may block the sun at times today'} (summer survey; bare in winter if cottonwoods). The times don't count them.</Text>
          ) : null}
          <Text style={styles.note}>
          {hd
            ? `Picture: Google Maps. ${region?.ground === 'green' ? 'Light and shadows' : 'Light, shadows and snow'} are calculated from elevation data: ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles. No clouds. Needs a signal; times are within a few minutes.${left != null ? ` HD views left: ${leftToday != null ? `${leftToday} today, ` : ''}${left} this month.` : ''}`
            : shapes && photoFore && region?.ground !== 'green'
              ? `Terrain shape and calculated sun. The ground's colour is a real winter day: a satellite picture of the whole area and, close to you, summer aerial photos with the snow put in.${laser ? ' Buildings and trees close to you, and water within about 3 km, come from a 2022 summer laser survey (buildings as blocks, trees as dots).' : ''} No clouds. Sun times count the ground${laser && !detail?.bare ? ' and buildings' : ''} only, never the colours. Times are within a few minutes.`
            : shapes && photoFore
              ? 'Terrain shape and calculated sun. Close to you the ground is coloured from aerial photos, with houses drawn as blocks with roofs; no clouds. Sun times count the ground only, not the houses. Times are within a few minutes.'
            : shapes
              ? `Terrain shape and calculated sun. Buildings and trees close to you, and water within about 3 km, come from a 2022 summer laser survey: ${detail?.bare ? 'trees as dots near you; buildings are drawn from the same survey out to 8 km' : 'buildings as blocks, trees as dots, none farther off'}; no clouds. With the snowflake on, lakes and slow water are drawn frozen and rivers open (a guess from the slope of the water). Sun times count the ground${detail?.bare ? '' : ' and buildings'}, not the trees. Times are within a few minutes. Elevation data: USGS 3DEP lidar, ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles.`
              : 'Terrain shape and calculated sun only: no trees, buildings or clouds. Times are within a few minutes. Elevation data: ArcticDEM (Polar Geospatial Center), Mapzen terrain tiles.'}
        </Text>
          {rangeIn && !hd ? (
            <Text style={styles.note}>Mountains: USGS 3DEP 1 m lidar elevation (2022), drawn at 5 m around the peaks this shot looks at; the sun times use it.</Text>
          ) : null}
          {housesIn > 0 && !hd ? (
            <Text style={styles.note}>{region?.ground === 'green'
              ? `Buildings out to 8 km (${housesIn}): the agency's outlines, walls and roofs measured in its 2015 surface model, roof colours from the air photos. Not in the sun times.`
              : `Buildings out to 8 km (${housesIn}): walls and roofs measured by the same 2022 laser survey, colours guessed, snow on the roofs. Not in the sun times.`}</Text>
          ) : null}
          {wideTrees > 0 && !hd ? (
            <Text style={styles.note}>Forest out to 12 km: the same 2022 laser survey on a 7 m grid, a tree a cell near you, clumps farther off. Not in the sun times.</Text>
          ) : null}
          {shapes && photoFore && !hd ? (
            <Text style={styles.note}>{region?.color_credit || (region?.ground === 'green' ? FAROES_CREDIT : TETON_CREDIT)}</Text>
          ) : null}
          {savedLine ? <Text style={styles.note} accessibilityLabel={savedLine}>{savedLine}</Text> : null}
        </View>
      ) : null}
      </Below>
    </View>
  );
}

const styles = StyleSheet.create({
  fullWrap: { flex: 1 },
  frame: { borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  frameFull: { flex: 1, borderRadius: 0, borderWidth: 0 },
  web: { flex: 1, backgroundColor: colors.surface },
  glass: { transform: [{ rotate: '180deg' }] },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.surface },
  coverText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  // The buttons wrap onto a second line when they don't fit: with HD, frame, foreground and frozen lakes the row ran past
  // the right edge of a 1080-px-wide phone and the full-screen button was off screen (emulator, 13 Nov 2026).
  topRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 6, columnGap: 6 },
  lens: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#444444', backgroundColor: 'rgba(0,0,0,0.55)' },
  lensBtn: { minWidth: 36, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  lensOn: { backgroundColor: '#ffffff' },
  lensText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  lensTextOn: { color: '#000000' },
  aboutRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4, marginTop: 6 },
  rightBtns: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1, marginLeft: 'auto' },
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
  heightRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  heightLabel: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  heightBtn: { width: 44, height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#444444', alignItems: 'center', justifyContent: 'center' },
  heightChip: { minHeight: 32, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: '#444444', justifyContent: 'center' },
  heightChipOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  heightChipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
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
