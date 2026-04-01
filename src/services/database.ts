import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIPS_KEY = 'pf_trips';
const TRIP_PREFIX = 'pf_trip_';

export async function initDatabase(): Promise<void> {
  // AsyncStorage is ready immediately, nothing to init
  return;
}

export async function cacheFullTrip(tripId: string, tripData: any): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${TRIP_PREFIX}${tripId}`,
      JSON.stringify({ ...tripData, cachedAt: Date.now() })
    );

    // Also update the trips list
    const existing = await getCachedTrips();
    const others = existing.filter((t: any) => t.id !== tripData.trip.id);
    await AsyncStorage.setItem(
      TRIPS_KEY,
      JSON.stringify([...others, tripData.trip])
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
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function getLastSynced(tripId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(`${TRIP_PREFIX}${tripId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.cachedAt || null;
  } catch {
    return null;
  }
}
