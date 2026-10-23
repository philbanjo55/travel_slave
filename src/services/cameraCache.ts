import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CameraFrame } from './planner';

// TEST app: the newest picture of every camera is kept on the phone, shared
// by every view, so a stop or the Planner's camera strip opens on its
// cameras' last pictures at once (offline too, and for a stop never opened
// before) and swaps in newer ones when the server has them, like weather.
// The server's picture links are signed for an hour, so the file itself is
// kept: one per camera, named by frame id (a newer frame replaces it).
const DIR = `${FileSystem.documentDirectory}pf_webcams/`;
const LATEST_KEY = 'pf_cam_latest';      // { [camera code]: CameraFrame with a file url }
const TRIP_PREFIX = 'pf_cam_trip_';      // camera codes the trip's strip showed last
const MAX_CAMERA_KM = 50;                // as solver-actions

const fileFor = (code: string, frameId: string) => `${DIR}${code.replace(/[^A-Za-z0-9-]/g, '_')}_${frameId}.jpg`;

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function readLatest(): Promise<Record<string, CameraFrame>> {
  try {
    const raw = await AsyncStorage.getItem(LATEST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Saved cameras whose picture file is still on the phone.
async function present(list: CameraFrame[]): Promise<CameraFrame[]> {
  const ok = await Promise.all(list.map(async c => {
    try { return !!c.frame?.url && (await FileSystem.getInfoAsync(c.frame.url)).exists; } catch { return false; }
  }));
  return list.filter((_, i) => ok[i]);
}

// The n saved cameras nearest a point (within 50 km), nearest first; null
// when none is saved.
export async function cachedNear(coords: { lat: number; lng: number }, n: number): Promise<CameraFrame[] | null> {
  const ranked = Object.values(await readLatest())
    .filter(c => c.camera.lat != null && c.camera.lng != null)
    .map(c => ({ ...c, camera: { ...c.camera, distance_km: Math.round(km(coords, c.camera) * 10) / 10 } }))
    .filter(c => c.camera.distance_km! <= MAX_CAMERA_KM)
    .sort((a, b) => a.camera.distance_km! - b.camera.distance_km!);
  const out = (await present(ranked)).slice(0, n);
  return out.length ? out : null;
}

// The cameras the trip's strip showed last, each at its newest saved picture.
export async function cachedTrip(tripId: string): Promise<CameraFrame[] | null> {
  try {
    const codes: string[] = JSON.parse((await AsyncStorage.getItem(TRIP_PREFIX + tripId)) ?? '[]');
    const latest = await readLatest();
    const out = await present(codes.map(code => latest[code]).filter(Boolean));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// Saves each camera's picture (downloaded once per frame) into the shared
// store, keeping whichever frame is newer, and returns the list showing the
// newest picture of each camera. A picture that fails to download keeps
// its signed link for now. tripId also remembers the strip's cameras.
export async function storeFrames(list: CameraFrame[], tripId?: string): Promise<CameraFrame[]> {
  try {
    const dir = await FileSystem.getInfoAsync(DIR);
    if (!dir.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  } catch {
    return list;
  }
  const latest = await readLatest();
  const out = await Promise.all(list.map(async c => {
    const f = c.frame;
    const have = latest[c.camera.code];
    const haveFile = have?.frame?.url ? (await FileSystem.getInfoAsync(have.frame.url).catch(() => ({ exists: false }))).exists : false;
    // Keep the saved one when it is the same frame or newer (a view can ask
    // for an older moment), only refreshing the camera's details.
    if (haveFile && have!.frame && (!f || have!.frame.captured_at >= f.captured_at)) {
      const merged = { ...have!, camera: { ...have!.camera, ...c.camera } };
      latest[c.camera.code] = merged;
      return merged;
    }
    if (!f?.url || !/^https?:/.test(f.url)) return c;
    const path = fileFor(c.camera.code, f.id);
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        const r = await FileSystem.downloadAsync(f.url, path);
        if (r.status !== 200) {
          await FileSystem.deleteAsync(path, { idempotent: true });
          return c;
        }
        await removeOlder(c.camera.code, path);
      }
      const saved = { ...c, frame: { ...f, url: path } };
      latest[c.camera.code] = saved;
      return saved;
    } catch {
      return c;
    }
  }));
  try {
    await AsyncStorage.setItem(LATEST_KEY, JSON.stringify(latest));
    if (tripId) await AsyncStorage.setItem(TRIP_PREFIX + tripId, JSON.stringify(list.map(c => c.camera.code)));
  } catch {}
  return out;
}

// One file per camera: the previous frames go once a newer one is saved.
async function removeOlder(code: string, keep: string) {
  try {
    const prefix = fileFor(code, '').slice(DIR.length);
    const names = await FileSystem.readDirectoryAsync(DIR);
    await Promise.all(names.filter(n => n.startsWith(prefix) && `${DIR}${n}` !== keep)
      .map(n => FileSystem.deleteAsync(`${DIR}${n}`, { idempotent: true })));
  } catch {}
}
