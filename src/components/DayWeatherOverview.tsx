import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import {
  WeatherRow, summarizeDay, conditionIcon, conditionsText, shortDate, cToF, kmhToMph,
  verificationStatus,
} from '../services/weather';

interface Props {
  rows: WeatherRow[];
  dayDate?: string | null;
  // When provided, shows a refresh button (day view). Omit for read-only (week view).
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
}

export default function DayWeatherOverview({ rows, dayDate, onRefresh, loading, error }: Props) {
  const ov = summarizeDay(rows, dayDate);
  const [showVerify, setShowVerify] = useState(false);

  // Aggregate verification across the day's stops (derived from provenance).
  const statuses = rows.map(r => ({ row: r, st: verificationStatus(r) }));
  const verifiedCount = statuses.filter(s => s.st.verified).length;
  const allVerified = statuses.length > 0 && verifiedCount === statuses.length;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>DAY WEATHER</Text>
        <View style={styles.headerRight}>
          {statuses.length ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowVerify(v => !v)}
              style={[styles.vBadge, { borderColor: allVerified ? colors.signalOk : colors.accent }]}
            >
              <Ionicons
                name={allVerified ? 'shield-checkmark' : 'shield-outline'}
                size={9}
                color={allVerified ? colors.signalOk : colors.accent}
              />
              <Text style={[styles.flagText, { color: allVerified ? colors.signalOk : colors.accent }]}>
                {allVerified ? 'VERIFIED' : `${statuses.length - verifiedCount} UNVERIFIED`}
              </Text>
              <Ionicons name={showVerify ? 'chevron-up' : 'chevron-down'} size={9}
                color={allVerified ? colors.signalOk : colors.accent} />
            </TouchableOpacity>
          ) : null}
          {ov ? (
            <View style={[styles.flag, ov.preview ? styles.flagPreview : styles.flagReal]}>
              <Ionicons
                name={ov.preview ? 'flask-outline' : 'calendar-outline'}
                size={9}
                color={ov.preview ? colors.signalWarning : colors.signalOk}
              />
              <Text style={[styles.flagText, { color: ov.preview ? colors.signalWarning : colors.signalOk }]}>
                {ov.preview ? `PREVIEW · ${shortDate(ov.forecastDate)}` : `TRIP DATE · ${shortDate(ov.forecastDate)}`}
              </Text>
            </View>
          ) : null}
          {onRefresh ? (
            <TouchableOpacity style={styles.btn} onPress={onRefresh} disabled={loading} activeOpacity={0.7}>
              {loading
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Ionicons name="refresh-outline" size={15} color={colors.textPrimary} />}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {ov ? (
        <>
          <View style={styles.headline}>
            <Ionicons name={conditionIcon(ov.code) as any} size={26} color={colors.textPrimary} />
            <Text style={styles.range}>{Math.round(cToF(ov.tempMin))}–{Math.round(cToF(ov.tempMax))}°F</Text>
            <Text style={styles.summary} numberOfLines={2}>{ov.summary}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric icon="cloud-outline" value={`${ov.avgCloud}%`} sub="cloud" />
            <Metric icon="rainy-outline" value={`${ov.maxPrecip}%`} sub="max rain" />
            <Metric icon="navigate-outline" value={`${Math.round(kmhToMph(ov.maxGust))}`} sub="gust mph" />
            {ov.foggy ? <Metric icon="cloudy-outline" value={`${ov.foggy}`} sub="fog stops" /> : null}
            {ov.golden ? <Metric icon="sunny-outline" value={`${ov.golden}`} sub="golden" /> : null}
          </View>
        </>
      ) : error ? (
        <Text style={styles.muted}>{error}</Text>
      ) : (
        <Text style={styles.muted}>{onRefresh ? 'Tap refresh for the day forecast' : 'No weather pulled yet'}</Text>
      )}

      {showVerify && statuses.length ? (
        <View style={styles.verifyList}>
          <Text style={styles.verifyHint}>
            {allVerified
              ? 'Every stop matched its exact requested hour from Open-Meteo.'
              : 'Stops below need a re-pull (no exact-hour match or missing data).'}
          </Text>
          {statuses.map(({ row, st }, i) => {
            const p = row.raw?.provenance;
            return (
              <View key={row.stop_id ?? i} style={styles.verifyItem}>
                <Ionicons
                  name={st.verified ? 'checkmark-circle' : 'alert-circle-outline'}
                  size={12}
                  color={st.verified ? colors.signalOk : colors.accent}
                />
                <Text style={styles.verifyItemLabel} numberOfLines={1}>
                  {p?.requested_time_label ?? '—'} → {p?.matched_time_local?.slice(11) ?? '—'}
                </Text>
                <Text style={styles.verifyItemCoord}>
                  {p ? `${Number(p.source_lat).toFixed(3)},${Number(p.source_lng).toFixed(3)}` : st.reason}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function Metric({ icon, value, sub }: { icon: any; value: string; sub: string }) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={12} color={colors.textTertiary} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...typography.labelMedium, color: colors.textTertiary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  flagPreview: { borderColor: colors.signalWarning },
  flagReal: { borderColor: colors.signalOk },
  flagText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  btn: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 32, alignItems: 'center',
  },
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  range: { fontFamily: 'Georgia', fontSize: 22, fontWeight: '400', color: colors.textPrimary },
  summary: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.sm },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricValue: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  metricSub: { fontSize: 10, color: colors.textTertiary },
  muted: { ...typography.bodySmall, color: colors.textTertiary, marginTop: spacing.sm },
  vBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 2,
  },
  verifyList: {
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 4,
  },
  verifyHint: { fontSize: 10, color: colors.textTertiary, fontStyle: 'italic', marginBottom: 2 },
  verifyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verifyItemLabel: { fontSize: 11, color: colors.textSecondary, flex: 1, fontVariant: ['tabular-nums'] },
  verifyItemCoord: { fontSize: 10, color: colors.textTertiary, fontVariant: ['tabular-nums'] },
});
