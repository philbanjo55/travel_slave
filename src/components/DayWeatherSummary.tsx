import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { pullWeather, fetchLatestWeatherForDay, useTestModeFor, WeatherRow } from '../services/weather';

interface Props {
  dayId: string;
  // The day's real date (from days.date). Used to auto-decide whether to pull
  // the real forecast (within ~16 days) or fall back to test/today+2.
  date?: string | null;
  onLoaded?: (byStop: Record<string, WeatherRow>) => void;
}

export default function DayWeatherSummary({ dayId, date, onLoaded }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, surface any previously-stored forecast so the banner isn't
  // empty. The summary itself isn't stored per-row, so we derive a short
  // recency note from the newest fetched_at and let the stop cards carry detail.
  const loadCached = useCallback(async () => {
    const byStop = await fetchLatestWeatherForDay(dayId);
    const rows = Object.values(byStop);
    if (rows.length) {
      const newest = rows
        .map(r => r.fetched_at)
        .sort()
        .reverse()[0];
      setFetchedAt(newest);
      onLoaded?.(byStop);
    }
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
        setSummary(res.day_summary || null);
        setFetchedAt(res.generated_at || new Date().toISOString());
        const byStop = await fetchLatestWeatherForDay(dayId);
        onLoaded?.(byStop);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const recency = fetchedAt ? relativeTime(fetchedAt) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <Ionicons name="partly-sunny-outline" size={14} color={colors.textTertiary} />
        {summary ? (
          <Text style={styles.summary} numberOfLines={2}>{summary}</Text>
        ) : error ? (
          <Text style={[styles.summary, { color: colors.signalWarning }]} numberOfLines={2}>{error}</Text>
        ) : recency ? (
          <Text style={styles.muted}>Weather updated {recency} · tap to refresh</Text>
        ) : (
          <Text style={styles.muted}>Tap for weather forecast</Text>
        )}
      </View>
      <TouchableOpacity style={styles.btn} onPress={refresh} disabled={loading} activeOpacity={0.7}>
        {loading
          ? <ActivityIndicator size="small" color={colors.accent} />
          : <Ionicons name="refresh-outline" size={16} color={colors.textPrimary} />}
      </TouchableOpacity>
    </View>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return 'recently';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  summary: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1 },
  muted: { ...typography.bodySmall, color: colors.textTertiary, flex: 1 },
  btn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 34,
    alignItems: 'center',
  },
});
