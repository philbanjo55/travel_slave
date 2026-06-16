import React, { useState, useMemo } from 'react';
import { pullWeatherForTrip, scoreConditions, WeatherRow } from '../services/weather';
import { fetchMetNoForStop, compareForecasts, ComparisonResult } from '../services/metno';
import { useTripStore } from '../store/tripStore';
import DayWeatherOverview from './DayWeatherOverview';

// Parse a stop's "h:mm AM/PM" time_label into a UTC ISO for the day's date.
// Ireland/Scotland are UTC+1 (IST/BST) in June–July, so local hour - 1 = UTC hour.
function stopTargetUtc(date: string | null | undefined, timeLabel: string | null | undefined): string | null {
  if (!date) return null;
  let hour = 12;
  const m = (timeLabel || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    hour = parseInt(m[1], 10);
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && hour !== 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
  }
  const utcHour = ((hour - 1) + 24) % 24;  // UTC+1 local -> UTC
  return `${date}T${String(utcHour).padStart(2, '0')}:00:00Z`;
}

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
  // Second-source (MET Norway) comparison results, keyed by stop id. Populated
  // on refresh alongside the normal Open-Meteo pull. Test wiring for now.
  const [compare, setCompare] = useState<Record<string, ComparisonResult>>({});

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

      // SECOND SOURCE (MET Norway): for each stop on this day, fetch met.no and
      // compare against the freshly-folded Open-Meteo row. Runs frontend-side
      // (app network reaches api.met.no). Errors per stop are swallowed so one
      // bad stop doesn't kill the batch.
      const day = useTripStore.getState().currentTripData?.days?.find((d: any) => d.id === dayId);
      const stops = day?.stops ?? [];
      const results: Record<string, ComparisonResult> = {};
      for (const s of stops) {
        if (!s.lat || !s.lng || !s.shot_type || s.shot_type === 'logistics') continue;
        const targetUtc = stopTargetUtc(date, s.time_label);
        if (!targetUtc) continue;
        try {
          const mn = await fetchMetNoForStop(s.lat, s.lng, targetUtc, s.shot_type, {
            sunriseIso: s.weather?.sunrise ?? null,
            sunsetIso: s.weather?.sunset ?? null,
            isDark: s.weather?.is_dark ?? false,
          });
          const omRow = s.weather as WeatherRow | undefined;
          const omScore = omRow ? scoreConditions(s.shot_type, omRow) : null;
          const cmp = compareForecasts(omRow, mn.row, omScore);
          results[s.id] = cmp;
          // Visible in Metro/console for the live-response check.
          console.log(`[met.no] ${s.name}`, { error: mn.error, metnoStars: cmp.metnoStars, omStars: cmp.openMeteoStars, agreement: cmp.agreement, note: cmp.note, symbol: mn.raw?.symbol, matched: mn.raw?.provenance?.matched_time_utc });
        } catch (e) {
          console.log(`[met.no] ${s.name} FAILED`, e);
        }
      }
      setCompare(results);
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
      comparison={compare}
    />
  );
}
