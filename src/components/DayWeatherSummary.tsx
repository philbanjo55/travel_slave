import React, { useState, useEffect, useCallback } from 'react';
import { pullWeather, fetchLatestWeatherForDay, useTestModeFor, WeatherRow } from '../services/weather';
import DayWeatherOverview from './DayWeatherOverview';

interface Props {
  dayId: string;
  // The day's real date (from days.date). Auto-decides real-forecast vs preview.
  date?: string | null;
  onLoaded?: (byStop: Record<string, WeatherRow>) => void;
}

// Stateful container for the day view: owns the pull + cached load, lifts
// per-stop weather to the screen, and renders the DayWeatherOverview card.
export default function DayWeatherSummary({ dayId, date, onLoaded }: Props) {
  const [rows, setRows] = useState<WeatherRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCached = useCallback(async () => {
    const byStop = await fetchLatestWeatherForDay(dayId);
    setRows(Object.values(byStop));
    if (Object.keys(byStop).length) onLoaded?.(byStop);
  }, [dayId, onLoaded]);

  useEffect(() => { loadCached(); }, [loadCached]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await pullWeather(dayId, { test: useTestModeFor(date) });
      if (!res.ok) {
        setError(res.error || 'Pull failed');
      } else {
        const byStop = await fetchLatestWeatherForDay(dayId);
        setRows(Object.values(byStop));
        onLoaded?.(byStop);
      }
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
