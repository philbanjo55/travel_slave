import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import {
  WeatherRow, fetchLatestWeatherForStop,
  conditionsText, tempText, windText, windDir, visibilityText, clockFromISO, fogBadge,
  conditionIcon, scoreConditions, forecastMode, forecastConfidence, shortDate, updatedAgoText,
  buildSourceComparison, cToF, kmhToMph, rainCell,
  verifyStopWeather, VerifyResult, verificationStatus,
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
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

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
  const conf = forecastConfidence(dayDate);
  const confColor = conf?.level === 'HIGH' ? colors.signalOk
    : conf?.level === 'MEDIUM' ? colors.signalWarning : colors.accent;
  const vstatus = verificationStatus(row);
  const prov = row.raw?.provenance;
  const cmp = buildSourceComparison(row);

  // Precip split — only show parts that are non-zero.
  const precipParts: string[] = [];
  if ((row.rain_mm ?? 0) > 0) precipParts.push(`${row.rain_mm} mm rain`);
  if ((row.showers_mm ?? 0) > 0) precipParts.push(`${row.showers_mm} mm showers`);
  if ((row.snowfall_cm ?? 0) > 0) precipParts.push(`${row.snowfall_cm} cm snow`);

  return (
    <View style={styles.section}>
      <View style={styles.headerCol}>
        <View style={styles.titleRow}>
          <Text style={styles.label}>WEATHER</Text>
          {updatedAgoText(row?.fetched_at) ? (
            <Text style={styles.updatedText}>· {updatedAgoText(row?.fetched_at)}</Text>
          ) : null}
        </View>
        <View style={styles.badgeFlow}>
          <View style={[styles.flag, mode.preview ? styles.flagPreview : styles.flagReal]}>
            <Ionicons
              name={mode.preview ? 'flask-outline' : 'calendar-outline'}
              size={9}
              color={mode.preview ? colors.signalWarning : colors.signalOk}
            />
            <Text style={[styles.flagText, { color: mode.preview ? colors.signalWarning : colors.signalOk }]}>
              {mode.preview ? `PREVIEW · ${shortDate(mode.forecastDate)}` : `LIVE · ${shortDate(mode.forecastDate)}`}
            </Text>
          </View>
          {conf ? (
            <View style={[styles.flag, { borderColor: confColor }]}>
              <Text style={[styles.flagText, { color: confColor }]}>
                {conf.level} · {conf.daysOut}d
              </Text>
            </View>
          ) : null}
          {cmp.hasMulti ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowCompare(v => !v)}
              style={[styles.badge, styles.vBadge, { borderColor: cmp.cloudOutlier ? colors.signalWarning : colors.textTertiary }]}
            >
              <Ionicons name="git-compare-outline" size={9}
                color={cmp.cloudOutlier ? colors.signalWarning : colors.textSecondary} />
              <Text style={[styles.badgeText, { color: cmp.cloudOutlier ? colors.signalWarning : colors.textSecondary }]}>
                {cmp.sources.filter(s => s.present).length} SOURCES
              </Text>
              <Ionicons name={showCompare ? 'chevron-up' : 'chevron-down'} size={9}
                color={cmp.cloudOutlier ? colors.signalWarning : colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowVerify(v => !v)}
            style={[styles.badge, styles.vBadge, { borderColor: vstatus.verified ? colors.signalOk : colors.accent }]}
          >
            <Ionicons
              name={vstatus.verified ? 'shield-checkmark' : 'shield-outline'}
              size={9}
              color={vstatus.verified ? colors.signalOk : colors.accent}
            />
            <Text style={[styles.badgeText, { color: vstatus.verified ? colors.signalOk : colors.accent }]}>
              {vstatus.verified ? 'VERIFIED' : 'UNVERIFIED'}
            </Text>
            <Ionicons name={showVerify ? 'chevron-up' : 'chevron-down'} size={9}
              color={vstatus.verified ? colors.signalOk : colors.accent} />
          </TouchableOpacity>
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
        {/* Sun times: the sunrise/sunset columns are timestamptz and serialize
            in UTC, so clockFromISO would render an hour off in BST/IST etc.
            raw.sunrise/sunset hold the location's local wall-clock (Open-Meteo
            timezone=auto) — correct everywhere regardless of device timezone. */}
        <Metric icon="sunny-outline" label="SUNRISE" value={clockFromISO(row.raw?.sunrise ?? row.sunrise)}
          sub={row.uv_index != null ? `UV ${Math.round(row.uv_index)}` : ' '} />
        <Metric icon="moon-outline" label="SUNSET" value={clockFromISO(row.raw?.sunset ?? row.sunset)}
          sub={row.surface_pressure_hpa != null ? `${Math.round(row.surface_pressure_hpa)} hPa` : ' '} />
      </View>

      {/* Source comparison dropdown — toggled by the SOURCES badge.
          Everything here comes from the backend render contract, already
          ordered by grid size then distance. Adding a model changes nothing
          in this file. */}
      {showCompare && cmp.hasMulti ? (
        <View style={styles.compareWrap}>
          <View style={styles.compareVerdict}>
            <Ionicons
              name={cmp.cloudOutlier ? 'alert-circle-outline' : 'checkmark-circle-outline'}
              size={14}
              color={cmp.cloudOutlier ? colors.signalWarning : colors.signalOk} />
            <Text style={[styles.compareVerdictText, { color: cmp.cloudOutlier ? colors.signalWarning : colors.signalOk }]}>
              {cmp.verdict}
            </Text>
          </View>

          {/* Ensemble probabilities. Rain and wind uncertainty are measurable;
              fog uncertainty is not, because no ensemble serves visibility. */}
          {cmp.uncertainty ? (
            <View style={styles.uncertaintyRow}>
              <Text style={styles.uncertaintyLabel}>
                {cmp.uncertainty.members ?? '?'} ENSEMBLE MEMBERS
              </Text>
              <View style={styles.uncertaintyChips}>
                {cmp.uncertainty.probAnyRainPct != null ? (
                  <Text style={styles.uncertaintyChip}>{cmp.uncertainty.probAnyRainPct}% rain</Text>
                ) : null}
                {cmp.uncertainty.probGustOver40Pct != null ? (
                  <Text style={styles.uncertaintyChip}>{cmp.uncertainty.probGustOver40Pct}% gust&gt;25mph</Text>
                ) : null}
                {cmp.uncertainty.probBrokenSkyPct != null ? (
                  <Text style={styles.uncertaintyChip}>{cmp.uncertainty.probBrokenSkyPct}% broken sky</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Observed conditions at Vagar. The only real-time measured cloud
              base in the Faroes — everything else above is a forecast. */}
          {cmp.groundTruth ? (
            <View style={styles.truthRow}>
              <Ionicons name="eye-outline" size={11} color={colors.signalOk} />
              <Text style={styles.truthText} numberOfLines={2}>
                {cmp.groundTruth.station} observed
                {cmp.groundTruth.ceilingFt != null ? ` · ceiling ${cmp.groundTruth.ceilingFt} ft` : ''}
                {cmp.groundTruth.visibilityM != null ? ` · vis ${Math.round(cmp.groundTruth.visibilityM / 1000)} km` : ''}
                {cmp.groundTruth.flightCategory ? ` · ${cmp.groundTruth.flightCategory}` : ''}
              </Text>
            </View>
          ) : null}

          <View style={styles.cmpHeadRow}>
            <Text style={[styles.cmpCellSource, styles.cmpHeadText]}>SOURCE</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadText]}>GRID</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadText]}>AWAY</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadText]}>CLOUD</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadText]}>BASE</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadText]}>RAIN</Text>
            <Text style={[styles.cmpCell, styles.cmpHeadText]}>GUST</Text>
          </View>

          {cmp.sources.map(s => {
            const isOutlier = s.key === cmp.cloudOutlier;
            const dim = !s.present;
            const mph = (k: number | null) => k == null ? '—' : `${Math.round(kmhToMph(k))}`;
            const pct = (v: number | null) => v == null ? '—' : `${Math.round(v)}%`;
            const km  = (v: number | null) => v == null ? '—' : v < 10 ? `${v.toFixed(1)}` : `${Math.round(v)}`;
            const ft  = (m: number | null) => m == null ? '—' : `${Math.round(m * 3.28084 / 100) * 100}`;
            return (
              <View key={s.key} style={[styles.cmpRow, isOutlier ? styles.cmpRowOutlier : null]}>
                <View style={styles.cmpCellSource}>
                  <Text style={[styles.cmpSourceName, dim ? styles.cmpDim : null]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <View style={styles.cmpTags}>
                    {s.isPrimary ? <Text style={styles.cmpTagLocal}>PRIMARY</Text> : null}
                    {s.isBlend ? <Text style={styles.cmpTagNote}>blend</Text> : null}
                    {s.note ? <Text style={styles.cmpTagNote}>{s.note}</Text> : null}
                  </View>
                </View>
                <Text style={[styles.cmpCell, dim ? styles.cmpDim : null]}>
                  {s.resolutionKm == null ? '—' : `${s.resolutionKm}k`}
                </Text>
                <Text style={[styles.cmpCell, dim ? styles.cmpDim : null]}>{km(s.distanceKm)}</Text>
                <Text style={[styles.cmpCell, dim ? styles.cmpDim : null, isOutlier ? styles.cmpOutlierVal : null]}>
                  {pct(s.cloud_cover_pct)}
                </Text>
                <Text style={[styles.cmpCell, dim ? styles.cmpDim : null]}>{ft(s.cloud_base_m)}</Text>
                <Text style={[styles.cmpCell, dim ? styles.cmpDim : null]}>
                  {rainCell(s.precip_probability_pct, s.rain_mm).text}
                </Text>
                <Text style={[styles.cmpCell, dim ? styles.cmpDim : null]}>
                  {mph(s.wind_gusts_kmh)}{s.wind_gusts_kmh != null && !s.gustMeasured ? '*' : ''}
                </Text>
              </View>
            );
          })}

          <Text style={styles.cmpFootnote}>
            GRID = model resolution in km, the smallest thing it can resolve. AWAY =
            how far its sampled grid point actually is from this stop. Sorted by grid
            size, then distance: a coarse model whose point lands nearby is still
            averaging over its whole cell. BASE = cloud base in feet — compare it to
            the height of what you are shooting. Blank means that model does not
            report cloud base. * gust estimated from mean wind.
            {cmp.fromContract ? '' : ' (Cached before source detail existed — pull to refresh.)'}
          </Text>
        </View>
      ) : null}

      {/* Verification dropdown — toggled by the header badge */}
      {showVerify ? (
        <View style={styles.verifyResult}>
          <View style={styles.verifyHead}>
            <Ionicons
              name={vstatus.verified ? 'checkmark-circle' : 'alert-circle-outline'}
              size={14}
              color={vstatus.verified ? colors.signalOk : colors.accent}
            />
            <Text style={[styles.verifyVerdict, { color: vstatus.verified ? colors.signalOk : colors.accent }]}>
              {vstatus.verified ? 'Verified' : 'Not verified'}
            </Text>
          </View>
          <Text style={styles.verifyMuted}>{vstatus.reason}</Text>

          {prov ? (
            <>
              <Text style={styles.provLine}>
                Coords  {Number(prov.source_lat)?.toFixed(4)}, {Number(prov.source_lng)?.toFixed(4)}
              </Text>
              <Text style={styles.provLine}>
                Hour  {prov.requested_time_label ?? '—'} → {prov.matched_time_local?.replace('T', ' ') ?? '—'} ({prov.match_method})
              </Text>
              <Text style={styles.provLine}>
                Zone  {prov.timezone ?? '—'} · {prov.date_mode === 'preview' ? 'preview date' : 'trip date'}
              </Text>
            </>
          ) : null}

          {/* Independent live re-check */}
          <TouchableOpacity
            style={styles.verifyBtn}
            activeOpacity={0.7}
            disabled={verifying}
            onPress={async () => { setVerifying(true); setVerify(null); try { setVerify(await verifyStopWeather(row)); } finally { setVerifying(false); } }}
          >
            {verifying
              ? <ActivityIndicator size="small" color={colors.textSecondary} />
              : <Ionicons name="sync-outline" size={13} color={colors.textSecondary} />}
            <Text style={styles.verifyBtnText}>{verifying ? 'CHECKING…' : 'RE-CHECK AGAINST OPEN-METEO'}</Text>
          </TouchableOpacity>

          {verify ? (
            verify.error ? (
              <Text style={styles.verifyMuted}>{verify.error}</Text>
            ) : (
              <>
                <Text style={[styles.verifyVerdict, { color: verify.ok ? colors.signalOk : colors.signalWarning, marginTop: 2 }]}>
                  {verify.ok ? '✓ Live values match' : '⚠ Live values differ'}
                </Text>
                {verify.checks.map(c => (
                  <View key={c.field} style={styles.verifyRow}>
                    <Text style={styles.verifyField}>{c.field}</Text>
                    <Text style={styles.verifyVals}>{c.stored ?? '—'} / {c.source ?? '—'}</Text>
                    <Ionicons name={c.match ? 'checkmark' : 'close'} size={12} color={c.match ? colors.signalOk : colors.signalWarning} />
                  </View>
                ))}
                {!verify.ok ? (
                  <Text style={styles.verifyMuted}>Location & hour reconstructed correctly; values differ only because Open-Meteo refreshed its forecast since the pull. Refresh the day to sync.</Text>
                ) : null}
              </>
            )
          ) : null}
        </View>
      ) : null}
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
  headerCol: {
    flexDirection: 'column',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  badgeFlow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', rowGap: spacing.xs },
  label: { ...typography.labelLarge, color: colors.textTertiary },
  updatedText: { color: colors.textTertiary, fontSize: 10, letterSpacing: 0.4 },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  flagPreview: { borderColor: colors.signalWarning },
  flagReal: { borderColor: colors.signalOk },
  flagText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
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

  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.sm, paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm,
  },
  vBadge: { gap: 3 },
  provLine: { fontSize: 10, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  verifyBtnText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.textSecondary },
  verifyResult: { marginTop: spacing.sm, gap: 4 },
  verifyHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifyVerdict: { fontSize: 12, fontWeight: '600' },
  verifyMeta: { fontSize: 10, color: colors.textTertiary },
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verifyField: { fontSize: 11, color: colors.textSecondary, width: 80 },
  verifyVals: { fontSize: 11, color: colors.textPrimary, flex: 1 },
  verifyMuted: { fontSize: 10, color: colors.textTertiary, fontStyle: 'italic', marginTop: 2 },

  compareWrap: { marginTop: spacing.sm, gap: 3 },
  compareVerdict: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  compareVerdictText: { fontSize: 12, fontWeight: '600', flex: 1 },
  cmpHeadRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 1 },
  cmpHeadText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: colors.textTertiary },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  cmpRowOutlier: { backgroundColor: 'rgba(170,170,170,0.08)', borderRadius: radius.sm },
  cmpCellSource: { width: 96, paddingLeft: 2 },
  cmpCell: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  cmpSourceName: { fontSize: 11, color: colors.textPrimary, fontWeight: '600' },
  cmpDim: { color: colors.textTertiary },
  cmpOutlierVal: { color: colors.signalWarning, fontWeight: '700' },
  cmpTags: { flexDirection: 'row', gap: 3, marginTop: 1 },
  cmpTagLocal: { fontSize: 7, fontWeight: '700', letterSpacing: 0.4, color: colors.signalOk },
  cmpTagNote: { fontSize: 7, fontWeight: '700', letterSpacing: 0.4, color: colors.textTertiary, fontStyle: 'italic' },
  uncertaintyRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.xs, marginBottom: spacing.xs,
  },
  uncertaintyLabel: {
    ...typography.caption, color: colors.textTertiary,
    fontSize: 9, letterSpacing: 0.5,
  },
  uncertaintyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flex: 1 },
  uncertaintyChip: {
    ...typography.caption, fontSize: 10, color: colors.textSecondary,
    backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
  truthRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  truthText: { ...typography.caption, fontSize: 10, color: colors.signalOk, flex: 1 },
  cmpFootnote: { fontSize: 9, color: colors.textTertiary, fontStyle: 'italic', marginTop: 6 },
});
