import { create } from 'zustand';
import { fetchFullTrip } from '../services/supabase';
import { getCachedFullTrip, getCachedTrips, cacheFullTrip } from '../services/database';
import { calculateDriveTimes } from '../services/driveTimes';

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

    // Try network sync in background
    try {
      set({ isSyncing: true });
      const fresh = await fetchFullTrip(tripId);
      await cacheFullTrip(tripId, fresh);
      set({
        currentTripData: fresh,
        currentTrip: fresh.trip,
        isSyncing: false,
      });

      // Auto-calculate drive times if any stops are missing them
      const allStops = fresh.days.flatMap((d: any) => d.stops || []);
      const missingDriveTimes = allStops.some(
        (s: any, i: number) => i > 0 && s.lat && s.lng && s.drive_override_minutes == null
      );
      if (missingDriveTimes) {
        calculateDriveTimes(tripId).then(() => get().syncTrip(tripId)).catch((e) => console.error("Drive times failed:", e));
      }
    } catch {
      set({ isOffline: true, isSyncing: false });
    }
  },

  syncTrip: async (tripId: string) => {
    try {
      set({ isSyncing: true });
      const fresh = await fetchFullTrip(tripId);
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

  setCurrentDay: (index: number) => set({ currentDayIndex: index }),
  setOffline: (offline: boolean) => set({ isOffline: offline }),
}));
