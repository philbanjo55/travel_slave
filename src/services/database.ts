import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIPS_KEY = 'pf_trips';
const TRIP_PREFIX = 'pf_trip_';
const PHOTOS_PREFIX = 'pf_photos_';
// Weather lives in its own entries, one per day, NOT inside the trip blob.
// Folding it in made a single value of several megabytes, which AsyncStorage
// would not write — and because the failure was swallowed, the previous copy
// survived and every sync silently no-opped. Same treatment photos get.
const WEATHER_PREFIX = 'pf_tripwx_';
const weatherKey = (tripId: string, dayId: string) => `${WEATHER_PREFIX}${tripId}_${dayId}`;
// Why the last cache write failed, if it did. Persisted so the reason survives
// the app being closed — which is exactly when the symptom shows up.
const CACHE_ERROR_KEY = 'pf_cache_error';
export async function getCacheError(): Promise<string | null> {
  try { return await AsyncStorage.getItem(CACHE_ERROR_KEY); } catch { return null; }
}

// The outcome of the last write, persisted. The whole problem with this bug is
// that the symptom only appears AFTER the app is closed, so anything held in
// memory is gone by the time you notice. Written on success as well as
// failure, because "it saved" is the claim actually in doubt.
const CACHE_STATUS_KEY = 'pf_cache_status';
export type CacheStatus = {
  ok: boolean; wroteDays: number; totalDays: number; kb: number;
  error: string | null; at: number; storageKb?: number; biggest?: string;
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
// holds a second copy of all four, and the app reads none of them from there —
// it reads `display` for those, and `raw` only for provenance, comparison,
// score, sea, sunrise/sunset and the legacy per-source keys. On the Faroes
// trip those four duplicates are 1.1 MB of a 2.7 MB write, so they are dropped
// on the way to disk. Nothing in memory is touched.
export function slimCachedWeather(w: any): any {
  if (!w || typeof w !== 'object' || !w.raw || typeof w.raw !== 'object') return w ?? null;
  const { models, ensemble, consensus, convergence, ...keep } = w.raw;
  return { ...w, raw: keep };
}

// What is actually on disk, by prefix. AsyncStorage on Android is one SQLite
// database with a fixed ceiling (6 MB by default, and nothing in this managed
// Expo project raises it), and setItem simply throws once it is full. That
// failure has been invisible: it is caught per key, logged to a console nobody
// is looking at, and the previous cache survives — so the app shows correct
// data until it is closed, then silently replays the older copy.
//
// This measures rather than assumes. Called whenever a write fails, so the log
// says which keys are holding the space instead of leaving it to guesswork.
export async function storageReport(): Promise<{ totalKb: number; byPrefix: Record<string, number>; keys: number }> {
  const byPrefix: Record<string, number> = {};
  let totalKb = 0, keys = 0;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    keys = allKeys.length;
    // Chunked: multiGet of every key at once is itself a large read, and on a
    // full database that is the operation most likely to fail.
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
    console.warn('[storage] report failed:', e);
  }
  totalKb = Math.round(totalKb);
  console.log(`[storage] ${totalKb} kB across ${keys} keys`, byPrefix);
  return { totalKb, byPrefix, keys };
}

// Delete everything superseded that is still occupying the budget: the two
// retired weather prefixes, and any other trip's cached blobs. Returns kB
// freed. Called only when a write has actually failed for space — it is a
// recovery step, not routine maintenance.
async function reclaimStorage(keepTripId: string): Promise<number> {
  let freed = 0;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter(k =>
      k.startsWith('pf_weather_stop_') ||
      k.startsWith('pf_weather_day_') ||
      ((k.startsWith(WEATHER_PREFIX) || k.startsWith(TRIP_PREFIX) || k.startsWith(PHOTOS_PREFIX))
        && !k.includes(keepTripId))
    );
    if (!doomed.length) return 0;
    for (let i = 0; i < doomed.length; i += 20) {
      const pairs = await AsyncStorage.multiGet(doomed.slice(i, i + 20) as string[]);
      for (const [, v] of pairs) freed += (v?.length ?? 0) / 1024;
    }
    await AsyncStorage.multiRemove(doomed as string[]);
    console.log(`[storage] reclaimed ${Math.round(freed)} kB from ${doomed.length} superseded keys`);
  } catch (e) {
    console.warn('[storage] reclaim failed:', e);
  }
  return Math.round(freed);
}

export async function cacheFullTrip(tripId: string, tripData: any, retried = false): Promise<boolean> {
  const startedAt = Date.now();
  try {
    // Photos and weather both come out of the trip blob and go into their own
    // entries. What is left is the itinerary, which is small and always writes.
    const photoMap: Record<string, any[]> = {};
    const weatherEntries: [string, string][] = [];

    const strippedDays = (tripData.days || []).map((day: any) => {
      const byStop: Record<string, any> = {};
      const stops = (day.stops || []).map((stop: any) => {
        if (stop.stop_photos?.length) {
          photoMap[stop.id] = stop.stop_photos.map((p: any) => ({
            id: p.id,
            stop_id: p.stop_id,
            storage_url: p.storage_url,
            position: p.position,
          }));
        }
        if (stop.weather) byStop[stop.id] = slimCachedWeather(stop.weather);
        return { ...stop, stop_photos: [], weather: null };
      });
      weatherEntries.push([weatherKey(tripId, day.id), JSON.stringify(byStop)]);
      return { ...day, stops };
    });

    // Weather FIRST, before the trip blob. The blob no longer carries weather,
    // so writing it first and then failing here leaves a trip with no weather
    // at all — worse than the stale copy it replaced. Written per day, and
    // per key rather than in one multiSet, so one oversized day cannot take
    // the rest down with it.
    let wroteWeather = 0;
    let firstError: string | null = null;
    for (const [k, v] of weatherEntries) {
      try { await AsyncStorage.setItem(k, v); wroteWeather++; }
      catch (e: any) {
        if (!firstError) firstError = String(e?.message ?? e);
        console.warn(`Weather cache write failed for ${k} (${Math.round(v.length/1024)} kB):`, e);
      }
    }
    if (weatherEntries.length && wroteWeather < weatherEntries.length) {
      // A PARTIAL write is the case that was being missed: the old guard only
      // bailed when every day failed, so one day landing was enough to rewrite
      // the itinerary and call it a success, leaving the rest stale forever.
      const want = Math.round(weatherEntries.reduce((n, [, v]) => n + v.length, 0) / 1024);
      console.warn(
        `[trip] weather cache incomplete — ${wroteWeather}/${weatherEntries.length} days, ` +
        `wanted ${want} kB. First error: ${firstError ?? 'none'}`
      );
      const rep = await storageReport();
      const biggest = Object.entries(rep.byPrefix).sort((a, b) => b[1] - a[1])[0];
      await putCacheStatus({
        ok: false, wroteDays: wroteWeather, totalDays: weatherEntries.length,
        kb: want, error: firstError, at: Date.now(),
        storageKb: rep.totalKb,
        biggest: biggest ? `${biggest[0]} ${Math.round(biggest[1])} kB` : undefined,
      });
    }
    if (weatherEntries.length && wroteWeather === 0) {
      // Nothing landed — keep the previous cache rather than replacing it
      // with an itinerary that has no weather attached.
      try { await AsyncStorage.setItem(CACHE_ERROR_KEY, firstError ?? 'unknown'); } catch {}
      return false;
    }
    try { await AsyncStorage.removeItem(CACHE_ERROR_KEY); } catch {}

    // Itinerary only — no photos, no weather.
    await AsyncStorage.setItem(
      `${TRIP_PREFIX}${tripId}`,
      JSON.stringify({ ...tripData, days: strippedDays, cachedAt: Date.now() })
    );

    // Cache photo metadata separately (tiny without base64)
    await AsyncStorage.setItem(
      `${PHOTOS_PREFIX}${tripId}`,
      JSON.stringify(photoMap)
    );

    // Update trips list cache
    const existing = await getCachedTrips();
    const others = existing.filter((t: any) => t.id !== tripData.trip.id);
    await AsyncStorage.setItem(
      TRIPS_KEY,
      JSON.stringify([...others, tripData.trip])
    );
    // Success is logged, not just failure: the screen now renders before this
    // runs, so "the data appeared" says nothing about whether it was stored.
    // This line is the only way to know the offline copy is actually safe.
    const kb = Math.round(weatherEntries.reduce((n, [, v]) => n + v.length, 0) / 1024);
    if (wroteWeather === weatherEntries.length) {
      await putCacheStatus({
        ok: true, wroteDays: wroteWeather, totalDays: weatherEntries.length,
        kb, error: null, at: Date.now(),
      });
    }
    console.log(
      `[trip] offline copy updated — ${wroteWeather}/${weatherEntries.length} days of weather, ` +
      `${kb} kB, ${Date.now() - startedAt} ms`
    );
    return true;
  } catch (e: any) {
    // Returned, not just logged: a failed write used to be indistinguishable
    // from a successful one, which is how a stale trip survived for hours.
    console.warn('Cache write failed:', e);
    const msg = String(e?.message ?? e);

    // A full database is recoverable: drop what is superseded and try once
    // more. Without this the first run after an upgrade still fails, because
    // the space is only freed by a prune that has not happened yet.
    if (!retried && /full|SQLITE_FULL|code 13/i.test(msg)) {
      const freed = await reclaimStorage(tripId);
      if (freed > 0) {
        console.log(`[trip] retrying cache write after reclaiming ${freed} kB`);
        return cacheFullTrip(tripId, tripData, true);
      }
    }

    // Status recorded here too, or a failure on the trip/photo writes would
    // leave the previous run's "saved" showing and report a lie.
    const rep = await storageReport();
    const biggest = Object.entries(rep.byPrefix).sort((a, b) => b[1] - a[1])[0];
    await putCacheStatus({
      ok: false, wroteDays: 0, totalDays: 0, kb: 0,
      error: msg, at: Date.now(), storageKb: rep.totalKb,
      biggest: biggest ? `${biggest[0]} ${Math.round(biggest[1])} kB` : undefined,
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
  try {
    const raw = await AsyncStorage.getItem(`${TRIP_PREFIX}${tripId}`);
    if (!raw) return null;
    const tripData = JSON.parse(raw);

    // Try to reattach cached photos
    try {
      const photosRaw = await AsyncStorage.getItem(`${PHOTOS_PREFIX}${tripId}`);
      if (photosRaw) {
        const photoMap = JSON.parse(photosRaw);
        tripData.days = tripData.days.map((day: any) => ({
          ...day,
          stops: (day.stops || []).map((stop: any) => ({
            ...stop,
            stop_photos: photoMap[stop.id] || [],
          })),
        }));
      }
    } catch {
      // Photos not cached — fine, load from network
    }

    // Reattach weather from its per-day entries.
    try {
      const days: any[] = tripData.days || [];
      const pairs = await AsyncStorage.multiGet(days.map((d: any) => weatherKey(tripId, d.id)));
      const byKey: Record<string, Record<string, any>> = {};
      for (const [k, v] of pairs) {
        if (!v) continue;
        try { byKey[k] = JSON.parse(v); } catch {}
      }
      tripData.days = days.map((day: any) => {
        const wx = byKey[weatherKey(tripId, day.id)] || {};
        return {
          ...day,
          stops: (day.stops || []).map((stop: any) => ({
            ...stop,
            weather: wx[stop.id] ?? stop.weather ?? null,
          })),
        };
      });
    } catch {
      // Weather not cached — the network read will fill it in.
    }

    return tripData;
  } catch {
    return null;
  }
}

export async function getLastSynced(tripId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(`${TRIP_PREFIX}${tripId}`);
    if (!raw) return null;
    return JSON.parse(raw).cachedAt || null;
  } catch {
    return null;
  }
}
