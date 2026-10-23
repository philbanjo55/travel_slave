import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CameraFrame } from './planner';

// TEST app: the newest picture of each camera is kept on the phone, so the
// stop screen and the Planner's camera strip open on it at once (offline
// too) and swap in a newer one when the server has it, like weather. The
// server's picture links are signed for an hour, so the file itself is kept:
// one per camera, named by frame id (a new frame replaces the old file).
const DIR = `${FileSystem.documentDirectory}pf_webcams/`;
const KEY_PREFIX = 'pf_cam_frames_';

export const nearKey = (c: { lat: number; lng: number }, n: number) => `near_${c.lat.toFixed(3)}_${c.lng.toFixed(3)}_${n}`;
export const tripKey = (tripId: string) => `trip_${tripId}`;

const fileFor = (code: string, frameId: string) => `${DIR}${code.replace(/[^A-Za-z0-9-]/g, '_')}_${frameId}.jpg`;

// The last list saved under this key, with pictures on the phone; cameras
// whose file is gone are left out. null when nothing is saved.
export async function cachedFrames(key: string): Promise<CameraFrame[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    if (!raw) return null;
    const list: CameraFrame[] = JSON.parse(raw);
    const out: CameraFrame[] = [];
    for (const c of list) {
      if (!c.frame?.url) continue;
      const info = await FileSystem.getInfoAsync(c.frame.url);
      if (info.exists) out.push(c);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// Saves each camera's picture to the phone (downloaded once per frame) and
// the list under this key. Returns the list pointing at the saved files; a
// picture that fails to download keeps its signed link for now and is left
// out of the saved list.
export async function storeFrames(key: string, list: CameraFrame[]): Promise<CameraFrame[]> {
  try {
    const dir = await FileSystem.getInfoAsync(DIR);
    if (!dir.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  } catch {
    return list;
  }
  const out = await Promise.all(list.map(async c => {
    const f = c.frame;
    if (!f?.url || !/^https?:/.test(f.url)) return { c, saved: !!f?.url };
    const path = fileFor(c.camera.code, f.id);
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        const r = await FileSystem.downloadAsync(f.url, path);
        if (r.status !== 200) {
          await FileSystem.deleteAsync(path, { idempotent: true });
          return { c, saved: false };
        }
        await removeOlder(c.camera.code, path);
      }
      return { c: { ...c, frame: { ...f, url: path } }, saved: true };
    } catch {
      return { c, saved: false };
    }
  }));
  try {
    await AsyncStorage.setItem(KEY_PREFIX + key, JSON.stringify(out.filter(o => o.saved).map(o => o.c)));
  } catch {}
  return out.map(o => o.c);
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
