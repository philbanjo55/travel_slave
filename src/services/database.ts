import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

// WHERE THINGS LIVE
//
// The trip cache - itinerary, per-day weather, photo metadata - is JSON files
// under the app's document directory. The small stuff - the trips list and
// the status of the last write - stays in AsyncStorage.
//
// AsyncStorage on Android is a single SQLite database with a 6 MB ceiling by
// default, and this trip's weather alone is ~1.7 MB per copy. It was full:
// every write threw SQLITE_FULL, the throw was caught per key, and the
// previous copy survived - so the app showed fresh data until it was closed
// and then replayed the old one. Clearing app data made it work again, which
// is the same as saying it would stop working again. Files have no such
// ceiling, no 2 MB-per-value CursorWindow limit either, and this is the same
// directory the photo cache has been using without incident.
const TRIPS_KEY = 'pf_trips';
const CACHE_DIR = `${FileSystem.documentDirectory}pf_cache/`;
const tripFile   = (tripId: string) => `${CACHE_DIR}trip_${tripId}.json`;
const photosFile = (tripId: string) => `${CACHE_DIR}photos_${tripId}.json`;
const weatherFile = (tripId: string, dayId: string) => `${CACHE_DIR}wx_${tripId}_${dayId}.json`;

// The AsyncStorage keys the cache used to live under. Removed once the file
// copy has landed, so the database stops carrying megabytes it no longer
// needs and the trips list has room to write.
const LEGACY_PREFIXES = ['pf_trip_', 'pf_tripwx_', 'pf_photos_', 'pf_weather_day_', 'pf_weather_stop_'];

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

// Written to a temp name and moved into place, so a crash mid-write cannot
// leave a truncated JSON file where a good one used to be.
async function writeJson(path: string, value: any): Promise<number> {
  const text = JSON.stringify(value);
  const tmp = `${path}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, text);
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: tmp, to: path });
  return text.length;
}

async function readJson<T = any>(path: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(path)) as T;
  } catch {
    return null;
  }
}

// The outcome of the last write, persisted. The symptom of a failed cache only
// appears AFTER the app is closed, so anything held in memory is gone by the
// time you notice. Written on success as well as failure, because "it saved"
// is the claim actually in doubt. Read by the Weather Updated alert.
const CACHE_STATUS_KEY = 'pf_cache_status';
export type CacheStatus = {
  ok: boolean; wroteDays: number; totalDays: number; kb: number;
  error: string | null; at: number; storageKb?: number; fileKb?: number; biggest?: string;
};
export async function getCacheStatus(): Promise<CacheStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_STATUS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function putCacheStatus(st: CacheStatus): Promise<void> {
  try { await AsyncStorage.setItem(CACHE_STATUS_KEY, JSON.stringify(st)); } catch {}
}

export async function initDatabase(): Promise<void> {
  return;
}

export async function cacheTrips(trips: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  } catch {}
}

// The render contract in `display` already carries every model, the ensemble
// distribution, the spread across centres and the run-to-run drift. `raw`
// holds a second copy of all four, and the app reads none of them from there.
// Dropped on the way to disk; nothing in memory is touched.
export function slimCachedWeather(w: any): any {
  if (!w || typeof w !== 'object' || !w.raw || typeof w.raw !== 'object') return w ?? null;
  const { models, ensemble, consensus, convergence, ...keep } = w.raw;
  return { ...w, raw: keep };
}

// What is on disk: AsyncStorage by key prefix, and the file cache in total.
// Called whenever a write does not fully land, so the report names what is
// holding the space rather than leaving it to guesswork.
export async function storageReport(): Promise<{ totalKb: number; fileKb: number; byPrefix: Record<string, number>; keys: number }> {
  const byPrefix: Record<string, number> = {};
  let totalKb = 0, keys = 0, fileKb = 0;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    keys = allKeys.length;
    for (let i = 0; i < allKeys.length; i += 20) {
      const pairs = await AsyncStorage.multiGet(allKeys.slice(i, i + 20) as string[]);
      for (const [k, v] of pairs) {
        const kb = (v?.length ?? 0) / 1024;
        totalKb += kb;
        const prefix = k.replace(/[0-9a-f-]{8,}.*$/i, '*');
        byPrefix[prefix] = Math.round(((byPrefix[prefix] ?? 0) + kb) * 10) / 10;
      }
    }
  } catch (e) {
    console.warn('[storage] AsyncStorage report failed:', e);
  }
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (info.exists) {
      for (const name of await FileSystem.readDirectoryAsync(CACHE_DIR)) {
        const f = await FileSystem.getInfoAsync(CACHE_DIR + name, { size: true });
        if (f.exists && typeof (f as any).size === 'number') fileKb += (f as any).size / 1024;
      }
    }
  } catch (e) {
    console.warn('[storage] file report failed:', e);
  }
  totalKb = Math.round(totalKb); fileKb = Math.round(fileKb);
  console.log(`[storage] AsyncStorage ${totalKb} kB across ${keys} keys; file cache ${fileKb} kB`, byPrefix);
  return { totalKb, fileKb, byPrefix, keys };
}

// Drop the AsyncStorage entries the cache used to live under. Called after a
// successful file write, so nothing is removed until its replacement exists.
async function pruneLegacyEntries(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(k => LEGACY_PREFIXES.some(p => k.startsWith(p)));
    if (stale.length) await AsyncStorage.multiRemove(stale as string[]);
    return stale.length;
  } catch {
    return 0;
  }
}

export async function cacheFullTrip(tripId: string, tripData: any): Promise<boolean> {
  const startedAt = Date.now();
  try {
    await ensureDir();

    // Photos and weather both come out of the trip blob and go into their own
    // files. What is left is the itinerary, which is small.
    const photoMap: Record<string, any[]> = {};
    const weatherByDay: [string, Record<string, any>][] = [];

    const strippedDays = (tripData.days || []).map((day: any) => {
      const byStop: Record<string, any> = {};
      const stops = (day.stops || []).map((stop: any) => {
        if (stop.stop_photos?.length) {
          photoMap[stop.id] = stop.stop_photos.map((p: any) => ({
            id: p.id, stop_id: p.stop_id, storage_url: p.storage_url, position: p.position,
            photo_type: p.photo_type,
          }));
        }
        if (stop.weather) byStop[stop.id] = slimCachedWeather(stop.weather);
        return { ...stop, stop_photos: [], weather: null };
      });
      weatherByDay.push([day.id, byStop]);
      return { ...day, stops };
    });

    // Weather first, one file per day, so one bad day cannot take the rest
    // with it - and so the itinerary is never written ahead of weather that
    // then fails, which would leave a trip with no weather at all.
    let wroteWeather = 0, kb = 0;
    let firstError: string | null = null;
    for (const [dayId, byStop] of weatherByDay) {
      try { kb += (await writeJson(weatherFile(tripId, dayId), byStop)) / 1024; wroteWeather++; }
      catch (e: any) {
        if (!firstError) firstError = String(e?.message ?? e);
        console.warn(`[trip] weather cache write failed for day ${dayId}:`, e);
      }
    }
    kb = Math.round(kb);

    if (weatherByDay.length && wroteWeather < weatherByDay.length) {
      const rep = await storageReport();
      await putCacheStatus({
        ok: false, wroteDays: wroteWeather, totalDays: weatherByDay.length, kb,
        error: firstError, at: Date.now(), storageKb: rep.totalKb, fileKb: rep.fileKb,
      });
      if (wroteWeather === 0) return false;
    }

    await writeJson(tripFile(tripId), { ...tripData, days: strippedDays, cachedAt: Date.now() });
    await writeJson(photosFile(tripId), photoMap);

    // Trips list stays in AsyncStorage: a few kilobytes.
    const existing = await getCachedTrips();
    const others = existing.filter((t: any) => t.id !== tripData.trip.id);
    await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify([...others, tripData.trip]));

    const pruned = await pruneLegacyEntries();
    if (pruned) console.log(`[trip] removed ${pruned} legacy AsyncStorage cache entries`);

    if (wroteWeather === weatherByDay.length) {
      await putCacheStatus({
        ok: true, wroteDays: wroteWeather, totalDays: weatherByDay.length, kb,
        error: null, at: Date.now(),
      });
    }
    console.log(
      `[trip] offline copy updated — ${wroteWeather}/${weatherByDay.length} days of weather, ` +
      `${kb} kB, ${Date.now() - startedAt} ms`
    );
    return true;
  } catch (e: any) {
    // Returned, not just logged: a failed write used to be indistinguishable
    // from a successful one, which is how a stale trip survived for hours.
    console.warn('[trip] cache write failed:', e);
    const rep = await storageReport();
    await putCacheStatus({
      ok: false, wroteDays: 0, totalDays: 0, kb: 0,
      error: String(e?.message ?? e), at: Date.now(), storageKb: rep.totalKb, fileKb: rep.fileKb,
    });
    return false;
  }
}

export async function getCachedTrips(): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem(TRIPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function getCachedFullTrip(tripId: string): Promise<any | null> {
  const tripData = await readJson<any>(tripFile(tripId));
  if (!tripData) return null;

  const photoMap = (await readJson<Record<string, any[]>>(photosFile(tripId))) ?? {};
  const days: any[] = tripData.days || [];

  // Weather per day. A missing or unreadable file leaves that day's weather
  // null; the network read fills it in.
  const weather = await Promise.all(days.map(d => readJson<Record<string, any>>(weatherFile(tripId, d.id))));

  tripData.days = days.map((day: any, i: number) => {
    const wx = weather[i] ?? {};
    return {
      ...day,
      stops: (day.stops || []).map((stop: any) => ({
        ...stop,
        stop_photos: photoMap[stop.id] || [],
        weather: wx[stop.id] ?? stop.weather ?? null,
      })),
    };
  });
  return tripData;
}

export async function getLastSynced(tripId: string): Promise<number | null> {
  const t = await readJson<any>(tripFile(tripId));
  return t?.cachedAt ?? null;
}
