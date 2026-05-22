import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import {
  WeatherRow, fetchLatestWeatherForStop,
  conditionsText, tempText, windText, windDir, visibilityText, clockFromISO, fogBadge,
  conditionIcon, scoreConditions, forecastMode, shortDate,
} from '../services/weather';

interface Props {
  stopId: string;
  // shot_type drives the rating (how good these conditions are for THIS kind
  // of shot). Pass it from the stop record.
  shotType?: string | null;
  // The day's real date — used to flag preview (today+2) vs real trip-date data.
  dayDate?: string | null;
  // If the parent already loaded the day's weather, pass the row to avoid a
  // second fetch. Otherwise the card self-fetches the latest stored forecast.
  weather?: WeatherRow | null;
}

export default function StopWeatherCard({ stopId, shotType, dayDate, weather }: Props) {
  const [row, setRow] = useState<WeatherRow | null>(weather ?? null);
  const [loaded, setLoaded] = useState(weather !== undefined);

  useEffect(() => {
    if (weather !== undefined) { setRow(weather ?? null); setLoaded(true); return; }
    let cancelled = false;
    fetchLatestWeatherForStop(stopId)
      .then(r => { if (!cancelled) { setRow(r); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [stopId, weather]);

  // Nothing stored yet — render nothing so the stop screen stays clean until
  // a forecast has been pulled from the day view.
  if (!loaded || !row || row.temperature_c == null) return null;

  const fog = fogBadge(row.fog_risk);
  const feels = row.apparent_temperature_c;
  const showFeels = feels != null && Math.abs((feels ?? 0) - (row.temperature_c ?? 0)) >= 2;
  const dir = windDir(row.wind_direction_deg);
  const score = scoreConditions(shotType ?? null, row);
  const mode = forecastMode(row, dayDate);

  // Precip split — only show parts that are non-zero.
  const precipParts: string[] = [];
  if ((row.rain_mm ?? 0) > 0) precipParts.push(`${row.rain_mm} mm rain`);
  if ((row.showers_mm ?? 0) > 0) precipParts.push(`${row.showers_mm} mm showers`);
  if ((row.snowfall_cm ?? 0) > 0) precipParts.push(`${row.snowfall_cm} cm snow`);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.label}>WEATHER</Text>
          <View style={[styles.flag, mode.preview ? styles.flagPreview : styles.flagReal]}>
            <Ionicons
              name={mode.preview ? 'flask-outline' : 'calendar-outline'}
              size={9}
              color={mode.preview ? colors.signalWarning : colors.signalOk}
            />
            <Text style={[styles.flagText, { color: mode.preview ? colors.signalWarning : colors.signalOk }]}>
              {mode.preview ? `PREVIEW · ${shortDate(mode.forecastDate)}` : `TRIP DATE · ${shortDate(mode.forecastDate)}`}
            </Text>
          </View>
        </View>
        <View style={styles.badges}>
          {row.is_golden_hour ? (
            <View style={[styles.badge, { borderColor: colors.signalWarning }]}>
              <Ionicons name="sunny-outline" size={9} color={colors.signalWarning} />
              <Text style={[styles.badgeText, { color: colors.signalWarning }]}>GOLDEN HOUR</Text>
            </View>
          ) : null}
          {row.is_dark ? (
            <View style={[styles.badge, { borderColor: colors.textTertiary }]}>
              <Ionicons name="moon-outline" size={9} color={colors.textTertiary} />
              <Text style={[styles.badgeText, { color: colors.textTertiary }]}>DARK</Text>
            </View>
          ) : null}
          {fog ? (
            <View style={[styles.badge, { borderColor: fog.tone === 'alert' ? colors.accent : colors.signalWarning }]}>
              <Ionicons name="cloud-outline" size={9} color={fog.tone === 'alert' ? colors.accent : colors.signalWarning} />
              <Text style={[styles.badgeText, { color: fog.tone === 'alert' ? colors.accent : colors.signalWarning }]}>{fog.label}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Headline: condition logo + temperature + rating */}
      <View style={styles.headline}>
        <Ionicons name={conditionIcon(row.weather_code) as any} size={30} color={colors.textPrimary} />
        <Text style={styles.temp}>{tempText(row.temperature_c)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.conditions}>{conditionsText(row.weather_code)}</Text>
          {showFeels ? <Text style={styles.feels}>feels {tempText(feels)}</Text> : null}
        </View>
      </View>

      {/* Shot-type rating */}
      {score ? (
        <View style={styles.rating}>
          <View style={styles.stars}>
            {[0, 1, 2, 3].map(i => (
              <Ionicons
                key={i}
                name={i < score.stars ? 'star' : 'star-outline'}
                size={13}
                color={i < score.stars ? colors.textPrimary : colors.textTertiary}
              />
            ))}
          </View>
          <Text style={styles.ratingLabel}>{score.label.toUpperCase()}</Text>
          <Text style={styles.ratingReason} numberOfLines={1}>· {score.reason}</Text>
        </View>
      ) : null}

      {/* Detail grid */}
      <View style={styles.grid}>
        <Metric icon="cloud-outline" label="CLOUD" value={row.cloud_cover_pct != null ? `${row.cloud_cover_pct}%` : '—'}
          sub={`L ${n(row.cloud_cover_low_pct)} · M ${n(row.cloud_cover_mid_pct)} · H ${n(row.cloud_cover_high_pct)}`} />
        <Metric icon="rainy-outline" label="RAIN" value={row.precip_probability_pct != null ? `${row.precip_probability_pct}%` : '—'}
          sub={precipParts.length ? precipParts.join(' · ') : 'none expected'} />
        <Metric icon="navigate-outline" label="WIND" value={windText(row.wind_speed_kmh)}
          sub={`gusts ${windText(row.wind_gusts_kmh)}${dir ? ` · ${dir}` : ''}`} />
        <Metric icon="eye-outline" label="VISIBILITY" value={visibilityText(row.visibility_m)}
          sub={row.relative_humidity_pct != null ? `${row.relative_humidity_pct}% humidity` : ' '} />
        <Metric icon="sunny-outline" label="SUNRISE" value={clockFromISO(row.sunrise)}
          sub={row.uv_index != null ? `UV ${Math.round(row.uv_index)}` : ' '} />
        <Metric icon="moon-outline" label="SUNSET" value={clockFromISO(row.sunset)}
          sub={row.surface_pressure_hpa != null ? `${Math.round(row.surface_pressure_hpa)} hPa` : ' '} />
      </View>
    </View>
  );
}

function n(v: number | null): string { return v == null ? '–' : `${v}%`; }

function Metric({ icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricHead}>
        <Ionicons name={icon} size={11} color={colors.textTertiary} />
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      {sub ? <Text style={styles.metricSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  label: { ...typography.labelLarge, color: colors.textTertiary },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  flagPreview: { borderColor: colors.signalWarning },
  flagReal: { borderColor: colors.signalOk },
  flagText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  badges: { flexDirection: 'row', gap: spacing.xs, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeText: { ...typography.labelMedium, fontSize: 8 },

  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  temp: { fontFamily: 'Georgia', fontSize: 34, fontWeight: '400', color: colors.textPrimary },
  conditions: { ...typography.bodyLarge, color: colors.textPrimary },
  feels: { ...typography.bodySmall, color: colors.textTertiary, marginTop: 1 },

  rating: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  stars: { flexDirection: 'row', gap: 1 },
  ratingLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.textPrimary },
  ratingReason: { ...typography.bodySmall, color: colors.textTertiary, flex: 1 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  metric: {
    width: '33.33%',
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
  },
  metricHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  metricLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 1, color: colors.textTertiary },
  metricValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  metricSub: { fontSize: 10, color: colors.textTertiary, marginTop: 1 },
});
