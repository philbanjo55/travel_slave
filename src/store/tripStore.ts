import { create } from 'zustand';
import { fetchFullTrip } from '../services/supabase';
import { fetchWeatherForTrip } from '../services/weather';
import { getCachedFullTrip, getCachedTrips, cacheFullTrip, cacheTrips, getLastSynced } from '../services/database';
import { calculateDriveTimesForTrip } from '../services/driveTimes';
import { downloadAllPhotos } from '../services/photoCache';

// Fetch the full trip AND fold each stop's weather into it, so weather always
// travels + caches with the trip (every load/sync path uses this). Best-effort
// on weather so it never blocks or fails the trip load.
async function fetchTripWithWeather(tripId: string) {
  const fresh = await fetchFullTrip(tripId);
  try {
    const wx = await fetchWeatherForTrip(tripId);
    for (const d of fresh.days) {
      for (const s of (d.stops || [])) s.weather = wx[s.id] ?? null;
    }
  } catch {}
  return fresh;
}

interface TripState {
  trips: any[];
  currentTrip: any | null;
  currentTripData: { trip: any; days: any[] } | null;
  currentDayIndex: number;
  isOffline: boolean;
  isSyncing: boolean;

  // Actions
  loadTrips: () => Promise<void>;
  loadTrip: (tripId: string) => Promise<void>;
  setCurrentDay: (index: number) => void;
  setOffline: (offline: boolean) => void;
  syncTrip: (tripId: string) => Promise<void>;
  refreshCurrentTrip: () => Promise<void>;
  syncIfStale: (tripId: string, maxAgeMs?: number) => Promise<void>;
}

export const useTripStore = create<TripState>((set, get) => ({
  trips: [],
  currentTrip: null,
  currentTripData: null,
  currentDayIndex: 0,
  isOffline: false,
  isSyncing: false,

  loadTrips: async () => {
    // Try cache first
    const cached = await getCachedTrips();
    if (cached.length > 0) {
      set({ trips: cached });
    }

    // Try network
    try {
      const { fetchTrips } = await import('../services/supabase');
      const trips = await fetchTrips();
      set({ trips });
      await cacheTrips(trips);
    } catch {
      set({ isOffline: true });
    }
  },

  loadTrip: async (tripId: string) => {
    // Try cache first for instant load
    const cached = await getCachedFullTrip(tripId);
    if (cached) {
      set({
        currentTripData: cached,
        currentTrip: cached.trip,
        currentDayIndex: 0,
      });
    }

    // Network sync
    try {
      set({ isSyncing: true });

      // Check and calculate missing drive times FIRST before caching
      const allStops = (await fetchFullTrip(tripId)).days.flatMap((d: any) => d.stops || []);
      const missingDriveTimes = allStops.some(
        (s: any, i: number) => i > 0 && s.lat && s.lng && s.drive_override_minutes == null
      );
      if (missingDriveTimes) {
        await calculateDriveTimesForTrip(tripId).catch((e) => console.error("Drive times failed:", e));
      }

      // Fetch fresh trip WITH weather folded into each stop, then cache it all.
      const fresh = await fetchTripWithWeather(tripId);
      await cacheFullTrip(tripId, fresh);
      set({
        currentTripData: fresh,
        currentTrip: fresh.trip,
        isSyncing: false,
      });

      // Download all photos to device filesystem for offline use
      setTimeout(() => {
        downloadAllPhotos(fresh).catch(() => {});
      }, 1000);
    } catch {
      set({ isOffline: true, isSyncing: false });
    }
  },

  syncTrip: async (tripId: string) => {
    try {
      set({ isSyncing: true });
      const fresh = await fetchTripWithWeather(tripId);
      await cacheFullTrip(tripId, fresh);
      set({ currentTripData: fresh, isSyncing: false });
    } catch {
      set({ isSyncing: false });
    }
  },

  refreshCurrentTrip: async () => {
    const { currentTrip } = get();
    if (currentTrip) {
      await get().syncTrip(currentTrip.id);
    }
  },

  // Re-sync only if the cached trip is older than maxAgeMs (default 10 min).
  // Called on screen focus so weather/itinerary refresh from the latest DB
  // run automatically when you land on a day, without a network hit on every
  // navigation. Fresh cache (< maxAge) is trusted and rendered as-is.
  syncIfStale: async (tripId: string, maxAgeMs = 10 * 60 * 1000) => {
    if (get().isSyncing) return;
    const last = await getLastSynced(tripId);
    if (last != null && Date.now() - last < maxAgeMs) return; // cache still fresh
    await get().syncTrip(tripId);
  },

  setCurrentDay: (index: number) => set({ currentDayIndex: index }),
  setOffline: (offline: boolean) => set({ isOffline: offline }),
}));
