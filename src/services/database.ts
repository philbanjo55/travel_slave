import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIPS_KEY = 'pf_trips';
const TRIP_PREFIX = 'pf_trip_';
const PHOTOS_PREFIX = 'pf_photos_';

export async function initDatabase(): Promise<void> {
  return;
}

export async function cacheFullTrip(tripId: string, tripData: any): Promise<void> {
  try {
    // Cache photos separately — metadata only, no base64
    const photoMap: Record<string, any[]> = {};
    const strippedDays = tripData.days.map((day: any) => ({
      ...day,
      stops: (day.stops || []).map((stop: any) => {
        if (stop.stop_photos?.length) {
          photoMap[stop.id] = stop.stop_photos.map((p: any) => ({
            id: p.id,
            stop_id: p.stop_id,
            storage_url: p.storage_url,
            position: p.position,
          }));
        }
        return { ...stop, stop_photos: [] };
      }),
    }));

    // Cache main trip data (no photos — stays well under 6MB)
    await AsyncStorage.setItem(
      `${TRIP_PREFIX}${tripId}`,
      JSON.stringify({ ...tripData, days: strippedDays, cachedAt: Date.now() })
    );

    // Cache photo metadata separately (tiny without base64)
    await AsyncStorage.setItem(
      `${PHOTOS_PREFIX}${tripId}`,
      JSON.stringify(photoMap)
    );
  } catch (e) {
    console.warn('Cache write failed:', e);
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
