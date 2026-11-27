import { create } from 'zustand';
import { fetchFullTrip, supabase } from '../services/supabase';
import { fetchWeatherForDays, pruneStopWeatherCache } from '../services/weather';
import { getCachedFullTrip, getCachedTrips, cacheFullTrip, cacheTrips } from '../services/database';
import { refreshSunPlan } from '../services/sunPlan';
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

// Which load is the newest. A load writes to the screen only while it is still the newest
// load of the trip on screen (see loadTrip).
let loadSeq = 0;

interface TripState {
  trips: any[];
  currentTrip: any | null;
  // The trip the screens last asked for. Only that trip's data is ever put in
  // currentTripData: a slower read of another trip that finishes later is dropped
  // (it is still saved for offline). Before this, opening Faroes Live and then
  // Teton Live let the Faroes read land on top, and the Teton page, still on its
  // 4th day tab, showed Faroes day 4 (Phil, 4 Nov 2026).
  currentTripId: string | null;
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
  currentTripId: null,
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
    // From here on this is the trip on screen. Another trip's data must not stay
    // up while this one loads: the screens show their spinner instead.
    const seq = ++loadSeq;
    const mine = () => seq === loadSeq && get().currentTripId === tripId;
    if (get().currentTripData?.trip?.id !== tripId) {
      set({ currentTripId: tripId, currentTripData: null, currentTrip: null, currentDayIndex: 0 });
    } else {
      set({ currentTripId: tripId });
    }

    // Reclaim space from the superseded per-stop weather entries before any
    // write is attempted. Harmless once they are gone; returns 0 thereafter.
    pruneStopWeatherCache()
      .then(n => { if (n) console.log(`[trip] reclaimed ${n} stale weather entries`); })
      .catch(() => {});

    // Cache first, for an instant screen.
    const cached = await getCachedFullTrip(tripId);
    // Only fills an empty screen: a newer copy already showing stays.
    if (cached && mine() && get().currentTripData?.trip?.id !== tripId) {
      set({ currentTripData: cached, currentTrip: cached.trip, currentDayIndex: 0 });
    }

    // The itinerary. This is the part the screen actually needs to exist, so
    // it is fetched and rendered before anything slower is attempted.
    if (mine()) set({ isSyncing: true });
    let fresh: TripData;
    try {
      fresh = await fetchFullTrip(tripId);
      // On screen now, carrying whatever weather the cache had for each stop.
      fresh = attachWeather(fresh, weatherByStop(cached));
      if (mine()) set({ currentTripData: fresh, currentTrip: fresh.trip });
    } catch (e) {
      reportSilently('loadTrip', e);
      if (mine()) set({ isOffline: true, isSyncing: false });
      return;
    }

    // Sun & Moon planner data for every stop in the trip, saved for offline
    // like the weather. Its own call and file; never throws, never waits.
    refreshSunPlan(tripId, true);

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
        .then(t => { if (get().currentTripId === tripId) set({ currentTripData: attachWeather(t, weatherByStop(get().currentTripData)) }); })
        .catch(e => console.error('Drive times failed:', e));
    }

    // Weather, per day, each read on its own timeout. Best effort: a day that
    // does not come back leaves that day's cached weather in place.
    try {
      const wx = await fetchWeatherForDays(fresh.days.map((d: any) => d.id));
      fresh = attachWeather(fresh, wx);
      if (mine()) set({ currentTripData: fresh, isSyncing: false });
    } catch (e) {
      reportSilently('weather', e);
      if (mine()) set({ isSyncing: false });
    }

    // Saved for offline even when another trip is on screen by now: it is
    // still this trip's newest copy. Persist after rendering, never before. cacheFullTrip reports its own
    // outcome; a failed write must not take the screen with it.
    const wrote = await cacheFullTrip(tripId, fresh);
    if (!wrote) console.warn('[trip] offline copy NOT updated — cache write failed');

    // Photos to the device filesystem for offline use.
    const snapshot = fresh;
    setTimeout(() => { downloadAllPhotos(snapshot).catch(() => {}); }, 1000);
  },

  syncTrip: async (tripId: string) => {
    // A re-read of the trip on screen. If another trip is opened before it comes
    // back, it only updates the offline copy (see currentTripId).
    const onScreen = () => get().currentTripId === tripId;
    if (!onScreen()) return;
    set({ isSyncing: true });
    let fresh: TripData;
    try {
      const own = get().currentTripData?.trip?.id === tripId ? get().currentTripData : null;
      fresh = attachWeather(await fetchFullTrip(tripId), weatherByStop(own));
      if (onScreen()) set({ currentTripData: fresh, currentTrip: fresh.trip });  // render before weather, before persisting
    } catch (e) {
      reportSilently('syncTrip', e);
      if (onScreen()) set({ isSyncing: false });
      return;
    }
    refreshSunPlan(tripId, true);
    try {
      const wx = await fetchWeatherForDays(fresh.days.map((d: any) => d.id));
      fresh = attachWeather(fresh, wx);
      if (onScreen()) set({ currentTripData: fresh, isSyncing: false });
    } catch (e) {
      reportSilently('weather', e);
      if (onScreen()) set({ isSyncing: false });
    }
    const wrote = await cacheFullTrip(tripId, fresh);
    if (!wrote) console.warn('[trip] offline copy NOT updated — cache write failed');
  },

  refreshCurrentTrip: async () => {
    const { currentTripId } = get();
    if (currentTripId) {
      await get().syncTrip(currentTripId);
    }
  },

  setCurrentDay: (index: number) => set({ currentDayIndex: index }),
  setOffline: (offline: boolean) => set({ isOffline: offline }),
}));

// The loaded trip, only when it is the one asked for: null (a spinner) while any
// other trip's data is in memory, so a screen never draws another trip's days.
export function useTripData(tripId: string | null | undefined): TripData | null {
  return useTripStore(s => (tripId && s.currentTripData?.trip?.id === tripId ? s.currentTripData : null));
}
