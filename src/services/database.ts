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

export async function cacheFullTrip(tripId: string, tripData: any): Promise<boolean> {
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
    for (const [k, v] of weatherEntries) {
      try { await AsyncStorage.setItem(k, v); wroteWeather++; }
      catch (e) { console.warn(`Weather cache write failed for ${k}:`, e); }
    }
    if (weatherEntries.length && wroteWeather === 0) {
      // Nothing landed — keep the previous cache rather than replacing it
      // with an itinerary that has no weather attached.
      return false;
    }

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
    return true;
  } catch (e) {
    // Returned, not just logged: a failed write used to be indistinguishable
    // from a successful one, which is how a stale trip survived for hours.
    console.warn('Cache write failed:', e);
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
