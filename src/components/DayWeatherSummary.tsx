import React, { useState, useMemo } from 'react';
import { pullWeatherForTrip, WeatherRow } from '../services/weather';
import { useTripStore } from '../store/tripStore';
import DayWeatherOverview from './DayWeatherOverview';

interface Props {
  dayId: string;
  // The day's real date (from days.date). Auto-decides real-forecast vs preview.
  date?: string | null;
  onLoaded?: (byStop: Record<string, WeatherRow>) => void;
}

// Presentational wrapper for the day view. Weather is NOT fetched here — it's
// already folded into each stop (stop.weather) when the trip loads/syncs
// (tripStore.fetchTripWithWeather) and cached with the trip, exactly like the
// itinerary text and photos. So we just read it off the cached trip in the
// store. No per-screen fetch, no socket to die on resume, nothing to race or
// blank out offline. Resume-freshness comes from useNetworkSync, which already
// re-syncs the whole trip (weather included) on foreground.
export default function DayWeatherSummary({ dayId, date, onLoaded }: Props) {
  const { currentTripData, refreshCurrentTrip } = useTripStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull this day's stops out of the already-loaded trip and read each stop's
  // folded-in weather row. Recomputed whenever the cached trip changes (e.g.
  // after a refresh re-folds fresh rows), so the card updates with no fetch.
  const rows = useMemo<WeatherRow[]>(() => {
    const day = currentTripData?.days?.find((d: any) => d.id === dayId);
    const stops = day?.stops ?? [];
    const out: WeatherRow[] = [];
    const byStop: Record<string, WeatherRow> = {};
    for (const s of stops) {
      if (s.weather) {
        out.push(s.weather as WeatherRow);
        byStop[s.id] = s.weather as WeatherRow;
      }
    }
    if (out.length) onLoaded?.(byStop);
    return out;
  }, [currentTripData, dayId, onLoaded]);

  // Refresh button: force a live server pull for the WHOLE trip (every day's
  // weather), then re-sync the trip — the same path trip text refreshes
  // through — which re-folds the fresh rows into every stop and re-caches.
  const refresh = async () => {
    const tripId = currentTripData?.trip?.id;
    if (!tripId) return;
    setLoading(true);
    setError(null);
    try {
      await pullWeatherForTrip(tripId);
      await refreshCurrentTrip();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DayWeatherOverview
      rows={rows}
      dayDate={date}
      onRefresh={refresh}
      loading={loading}
      error={error}
    />
  );
}
