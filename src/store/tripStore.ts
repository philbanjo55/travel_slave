import { create } from 'zustand';
import { fetchFullTrip, supabase } from '../services/supabase';
import { fetchWeatherForDays, pruneStopWeatherCache } from '../services/weather';
import { getCachedFullTrip, getCachedTrips, cacheFullTrip, cacheTrips } from '../services/database';
import { calculateDriveTimesForTrip } from '../services/driveTimes';
import { downloadAllPhotos } from '../services/photoCache';

type TripData = { trip: any; days: any[] };

// Fold weather into a trip, stop by stop, returning a NEW structure so the
// store sees a change. Stops with no fresh row keep whatever they had - the
// cached copy's weather - rather than going blank while a read is in flight.
function attachWeather(data: TripData, wx: Record<string, any>): TripData {
  return {
    ...data,
    days: data.days.map(d => ({
      ...d,
      stops: (d.stops || []).map((s: any) => ({ ...s, weather: wx[s.id] ?? s.weather ?? null })),
    })),
  };
}

function weatherByStop(data: TripData | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const d of data?.days ?? []) for (const s of d.stops ?? []) if (s.weather) out[s.id] = s.weather;
  return out;
}

// A swallowed failure, reported somewhere it can be read. loadTrip's catch used
// to set isOffline and nothing else, so the one line it died on tonight left
// no trace anywhere - not on screen, not in a log, not in a request. app_logs
// is the same table the photo cache already writes to from the device.
function reportSilently(where: string, e: any) {
  const message = String(e?.message ?? e);
  console.warn(`[trip] ${where} failed:`, message);
  try {
    supabase.from('app_logs').insert({
      level: 'error',
      message: `[trip] ${where} failed`,
      data: { message, stack: String(e?.stack ?? '').slice(0, 800) },
    }).then(() => {}, () => {});
  } catch {}
}

// Trips whose drive times were calculated this launch - see loadTrip.
const driveTimesTried = new Set<string>();

function hasMissingDriveTimes(data: TripData): boolean {
  return data.days.some((d: any) => {
    const stops = d.stops || [];
    return stops.some((s: any, i: number) =>
      i > 0 && s.lat && s.lng && stops[i - 1].lat && stops[i - 1].lng && s.drive_override_minutes == null
    );
  });
}

interface TripState {
  trips: any[];
  currentTrip: any | null;
  currentTripData: TripData | null;
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
      await cacheTrips(trips);
    } catch {
      set({ isOffline: true });
    }
  },

  loadTrip: async (tripId: string) => {
    // Reclaim space from the superseded per-stop weather entries before any
    // write is attempted. Harmless once they are gone; returns 0 thereafter.
    pruneStopWeatherCache()
      .then(n => { if (n) console.log(`[trip] reclaimed ${n} stale weather entries`); })
      .catch(() => {});

    // Cache first, for an instant screen.
    const cached = await getCachedFullTrip(tripId);
    if (cached) {
      set({ currentTripData: cached, currentTrip: cached.trip, currentDayIndex: 0 });
    }

    // The itinerary. This is the part the screen actually needs to exist, so
    // it is fetched and rendered before anything slower is attempted.
    set({ isSyncing: true });
    let fresh: TripData;
    try {
      fresh = await fetchFullTrip(tripId);
      // On screen now, carrying whatever weather the cache had for each stop.
      fresh = attachWeather(fresh, weatherByStop(cached));
      set({ currentTripData: fresh, currentTrip: fresh.trip });
    } catch (e) {
      reportSilently('loadTrip', e);
      set({ isOffline: true, isSyncing: false });
      return;
    }

    // Drive times, in the background and only when a leg is missing one. A
    // leg is a stop with coordinates that follows a stop with coordinates in
    // the same day - the first stop of a day has no leg and never gets a
    // value, and the calculation skips a pair without coordinates. Tried once
    // per launch: a leg Google cannot route (a ferry crossing) stays empty,
    // and must not put the whole trip through the calculation on every open.
    if (!driveTimesTried.has(tripId) && hasMissingDriveTimes(fresh)) {
      driveTimesTried.add(tripId);
      calculateDriveTimesForTrip(tripId)
        .then(() => fetchFullTrip(tripId))
        .then(t => set({ currentTripData: attachWeather(t, weatherByStop(get().currentTripData)) }))
        .catch(e => console.error('Drive times failed:', e));
    }

    // Weather, per day, each read on its own timeout. Best effort: a day that
    // does not come back leaves that day's cached weather in place.
    try {
      const wx = await fetchWeatherForDays(fresh.days.map((d: any) => d.id));
      fresh = attachWeather(fresh, wx);
      set({ currentTripData: fresh, isSyncing: false });
    } catch (e) {
      reportSilently('weather', e);
      set({ isSyncing: false });
    }

    // Persist after rendering, never before. cacheFullTrip reports its own
    // outcome; a failed write must not take the screen with it.
    const wrote = await cacheFullTrip(tripId, fresh);
    if (!wrote) console.warn('[trip] offline copy NOT updated — cache write failed');

    // Photos to the device filesystem for offline use.
    const snapshot = fresh;
    setTimeout(() => { downloadAllPhotos(snapshot).catch(() => {}); }, 1000);
  },

  syncTrip: async (tripId: string) => {
    set({ isSyncing: true });
    let fresh: TripData;
    try {
      fresh = attachWeather(await fetchFullTrip(tripId), weatherByStop(get().currentTripData));
      set({ currentTripData: fresh });                    // render before weather, before persisting
    } catch (e) {
      reportSilently('syncTrip', e);
      set({ isSyncing: false });
      return;
    }
    try {
      const wx = await fetchWeatherForDays(fresh.days.map((d: any) => d.id));
      fresh = attachWeather(fresh, wx);
      set({ currentTripData: fresh, isSyncing: false });
    } catch (e) {
      reportSilently('weather', e);
      set({ isSyncing: false });
    }
    const wrote = await cacheFullTrip(tripId, fresh);
    if (!wrote) console.warn('[trip] offline copy NOT updated — cache write failed');
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
