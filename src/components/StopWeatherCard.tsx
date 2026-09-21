import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import {
  WeatherRow, fetchLatestWeatherForStop,
  conditionsText, tempText, windText, windDir, visibilityText, clockFromISO, fogBadge,
  conditionIcon, readScore, forecastMode, forecastConfidence, shortDate, updatedAgoText,
  buildSourceComparison, cToF, kmhToMph, rainCell, inchesText, kmToMiles,
  verifyStopWeather, VerifyResult, verificationStatus,
  allFields, fieldLabel, fieldValueText, SourceReading,
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

// The comparison table, declared as data. Adding a column is one line here;
// the header, every row and the horizontal width all follow from it. Fields
// not given a column still appear — tap a source to expand the rest.
const mph = (k: number | null) => k == null ? '—' : `${Math.round(kmhToMph(k))}`;
const pct = (v: number | null) => v == null ? '—' : `${Math.round(v)}%`;
const miT = (km: number | null) => {
  if (km == null) return '—';
  const mi = kmToMiles(km);
  return mi < 10 ? `${mi.toFixed(1)}` : `${Math.round(mi)}`;
};
const ft  = (m: number | null) => m == null ? '—' : `${Math.round(m * 3.28084 / 100) * 100}`;
const inch = (v: number | null) => v == null ? '—' : inchesText(v / 25.4).replace(' in', '');
const num = (v: any) => v == null ? '—' : typeof v === 'number' ? `${Math.round(v)}` : String(v);

// Ensemble and consensus name their variables the way Open-Meteo does
// (cloud_cover, wind_gusts_10m). Map them onto the unit-bearing field names so
// the shared formatter knows a gust is mph and a temperature is °F. An
// unmapped variable still renders — it just falls through to a bare number.
const ENS_UNIT_KEY: Record<string, string> = {
  cloud_cover: 'cloud_cover_pct',
  cloud_cover_low: 'cloud_cover_low_pct',
  cloud_base: 'cloud_base_m',
  precipitation: 'precip_mm',
  precipitation_probability: 'precip_probability_pct',
  temperature_2m: 'temperature_c',
  wind_gusts_10m: 'wind_gusts_kmh',
  wind_speed_10m: 'wind_speed_kmh',
  relative_humidity_2m: 'relative_humidity_pct',
  surface_pressure: 'surface_pressure_hpa',
  visibility: 'visibility_m',
};
const ensKey = (k: string) => ENS_UNIT_KEY[k] ?? k;

// Contract v2 moved the ensemble member count under each variable, so the
// top-level one reads null and the label rendered "? ENSEMBLE MEMBERS".
const memberCount = (u: any): number | null => {
  const counts = Object.values(u?.byVariable ?? {})
    .map((v: any) => v?.members).filter((m: any) => typeof m === 'number');
  return counts.length ? Math.max(...counts) : null;
};

type Col = { key: string; head: string; unit: string; hint: string; get: (s: SourceReading) => string; wide?: boolean };

const COLUMNS: Col[] = [
  { key: 'grid',  head: 'GRID', unit: 'km',  hint: 'model resolution in km — the smallest thing it can resolve',
    get: s => s.resolutionKm == null ? '—' : `${s.resolutionKm}k` },
  { key: 'away',  head: 'AWAY', unit: 'mi',  hint: 'km from this stop to the grid point the model actually sampled',
    get: s => miT(s.distanceKm) },
  { key: 'cloud', head: 'CLOUD', unit: '%', hint: 'total cloud cover', get: s => pct(s.cloud_cover_pct) },
  { key: 'low',   head: 'LOW', unit: '%',   hint: 'low cloud — the layer that hides a summit',
    get: s => pct(s.cloud_cover_low_pct) },
  { key: 'base',  head: 'BASE', unit: 'ft',  hint: 'cloud base in feet — compare to the height of your subject',
    get: s => ft(s.cloud_base_m) },
  { key: 'top',   head: 'TOP', unit: 'ft',   hint: 'cloud top in feet — thin deck or deep overcast',
    get: s => ft(s.values?.cloud_top_m ?? null) },
  { key: 'vis',   head: 'VIS', unit: 'mi',   hint: 'visibility in miles', get: s => s.visibility_m == null ? '—'
    : s.visibility_m < 1609 ? `${(s.visibility_m / 1609.34).toFixed(1)}` : `${Math.round(s.visibility_m / 1609.34)}` },
  { key: 'fog',   head: 'FOG', unit: '%',   hint: 'cloud sitting at 2 m — the native fog field, DMI only',
    get: s => pct(s.values?.cloud_cover_2m_pct ?? null) },
  { key: 'rain',  head: 'RAIN', unit: 'in',  hint: 'precipitation in mm for the hour', get: s => inch(s.rain_mm) },
  { key: 'pop',   head: 'POP', unit: '%',   hint: 'chance of precipitation — only some models report it',
    get: s => pct(s.precip_probability_pct) },
  { key: 'gust',  head: 'GUST', unit: 'mph',  hint: 'gusts in mph', get: s =>
    `${mph(s.wind_gusts_kmh)}${s.wind_gusts_kmh != null && !s.gustMeasured ? '*' : ''}` },
  { key: 'wind',  head: 'WIND', unit: 'mph',  hint: 'mean wind in mph', get: s => mph(s.wind_speed_kmh) },
  { key: 'dir',   head: 'DIR', unit: '',   hint: 'wind direction', get: s => {
    const d = s.values?.wind_direction_deg; return d == null ? '—' : windDir(d); }, wide: true },
  { key: 'temp',  head: 'TEMP', unit: '°F',  hint: 'temperature in °F',
    get: s => s.temperature_c == null ? '—' : `${Math.round(cToF(s.temperature_c))}` },
  { key: 'dew',   head: 'DEW', unit: '°F',   hint: 'dew point — within 2°F of temp means fog',
    get: s => s.values?.dew_point_c == null ? '—' : `${Math.round(cToF(s.values.dew_point_c))}` },
  { key: 'hum',   head: 'HUM', unit: '%',   hint: 'relative humidity', get: s => pct(s.relative_humidity_pct) },
  { key: 'pres',  head: 'PRES', unit: 'inHg',  hint: 'surface pressure, altimeter setting',
    get: s => s.surface_pressure_hpa == null ? '—'
      : (s.surface_pressure_hpa * 0.02953).toFixed(2), wide: true },
];
const COL_W = 46, COL_W_WIDE = 58, SRC_W = 132;
const TABLE_W = SRC_W + COLUMNS.reduce((w, c) => w + (c.wide ? COL_W_WIDE : COL_W), 0);

export default function StopWeatherCard({ stopId, shotType, dayDate, weather }: Props) {
  const [row, setRow] = useState<WeatherRow | null>(weather ?? null);
  const [loaded, setLoaded] = useState(weather !== undefined);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  // Which source's full field list is open. Only one at a time — eighteen
  // sources times twenty-six fields is not a thing to scroll past.
  const [openSource, setOpenSource] = useState<string | null>(null);
  // The analysis blocks below the table. Off by default: the dropdown exists
  // to compare sources, and this used to sit in front of that.
  const [showDetail, setShowDetail] = useState(false);

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
  const score = readScore(shotType ?? null, row);
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
            {/* The icon has to agree with the sentence beside it. That sentence
                is now the centre vote, so a contested verdict warns too — not
                just a cloud-cover outlier. */}
            <Ionicons
              name={(cmp.cloudOutlier || cmp.agreement === 'CONTESTED') ? 'alert-circle-outline' : 'checkmark-circle-outline'}
              size={14}
              color={(cmp.cloudOutlier || cmp.agreement === 'CONTESTED') ? colors.signalWarning : colors.signalOk} />
            <Text style={[styles.compareVerdictText, { color: (cmp.cloudOutlier || cmp.agreement === 'CONTESTED') ? colors.signalWarning : colors.signalOk }]}>
              {cmp.verdict}
            </Text>
          </View>

          {/* Ensemble probabilities. Rain and wind uncertainty are measurable;
              fog uncertainty is not, because no ensemble serves visibility. */}
          {cmp.uncertainty ? (
              <View style={styles.uncertaintyRow}>
                <Text style={styles.uncertaintyLabel}>
                  {cmp.uncertainty.members ?? memberCount(cmp.uncertainty) ?? '?'} ENSEMBLE MEMBERS
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
                {cmp.groundTruth.observedAt ? ` ${clockFromISO(cmp.groundTruth.observedAt)}` : ''}
                {cmp.groundTruth.flightCategory ? ` · ${cmp.groundTruth.flightCategory}` : ''}
              </Text>
            </View>
          ) : null}

          {/* The table scrolls sideways because there are more real columns
              than a phone is wide, and truncating them would be choosing for
              you which measurements matter. Tap any source for the rest. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={true}
                      style={styles.cmpScroll} contentContainerStyle={{ width: TABLE_W }}>
            <View>
              <View style={styles.cmpHeadRow}>
                <Text style={[styles.cmpCellSource, styles.cmpHeadText]}>SOURCE</Text>
                {COLUMNS.map(c => (
                  <View key={c.key} style={{ width: c.wide ? COL_W_WIDE : COL_W }}>
                    <Text style={[styles.cmpHeadText, styles.cmpHeadCell]}>{c.head}</Text>
                    {c.unit ? (
                      <Text style={[styles.cmpHeadUnit, styles.cmpHeadCell]}>{c.unit}</Text>
                    ) : null}
                  </View>
                ))}
              </View>

              {cmp.sources.map(s => {
                const isOutlier = s.key === cmp.cloudOutlier;
                const dim = !s.present;
                const open = openSource === s.key;
                const extra = open ? allFields(s.values, { skipTableFields: true }) : [];
                return (
                  <View key={s.key}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setOpenSource(open ? null : s.key)}
                      style={[styles.cmpRow, isOutlier ? styles.cmpRowOutlier : null,
                              open ? styles.cmpRowOpen : null]}>
                      <View style={styles.cmpCellSource}>
                        <Text style={[styles.cmpSourceName, dim ? styles.cmpDim : null]} numberOfLines={1}>
                          {s.name}
                        </Text>
                        <View style={styles.cmpTags}>
                          {s.isPrimary ? <Text style={styles.cmpTagLocal}>PRIMARY</Text> : null}
                          {s.isBlend ? <Text style={styles.cmpTagNote}>blend</Text> : null}
                          {s.note ? <Text style={styles.cmpTagNote}>{s.note}</Text> : null}
                          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'}
                                    size={10} color={colors.textTertiary} />
                        </View>
                      </View>
                      {COLUMNS.map(c => (
                        <Text key={c.key}
                              style={[styles.cmpCell, { width: c.wide ? COL_W_WIDE : COL_W },
                                      dim ? styles.cmpDim : null,
                                      isOutlier && c.key === 'cloud' ? styles.cmpOutlierVal : null]}>
                          {c.get(s)}
                        </Text>
                      ))}
                    </TouchableOpacity>

                    {/* Everything this model reported that has no column of its
                        own. Read straight off the contract, so a field the
                        backend starts collecting appears here by itself. */}
                    {open ? (
                      <View style={[styles.cmpDetail, { width: TABLE_W }]}>
                        {s.centre ? (
                          <Text style={styles.cmpDetailCentre}>
                            {s.centre}{s.blendNote ? ` · ${s.blendNote}` : ''}
                          </Text>
                        ) : null}
                        <View style={styles.cmpDetailGrid}>
                          {extra.map(f => (
                            <View key={f.key} style={styles.cmpDetailItem}>
                              <Text style={styles.cmpDetailLabel} numberOfLines={1}>{f.label}</Text>
                              <Text style={styles.cmpDetailValue} numberOfLines={1}>{f.text}</Text>
                            </View>
                          ))}
                        </View>
                        {extra.length === 0 ? (
                          <Text style={styles.cmpDetailLabel}>No further fields reported.</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Everything below is analysis, not comparison. It used to sit
              above the table, which meant scrolling past thirty lines of it to
              reach the thing the dropdown is for. Collapsed by default. */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowDetail(d => !d)}
            style={styles.detailToggle}>
            <Ionicons name={showDetail ? 'chevron-down' : 'chevron-forward'}
                      size={11} color={colors.textSecondary} />
            <Text style={styles.detailToggleText}>
              {showDetail ? 'HIDE' : 'SHOW'} SPREAD, DRIFT, SEA &amp; OBSERVED
            </Text>
          </TouchableOpacity>

          {showDetail ? (
            <View>
              {/* The spread behind those probabilities. "60% chance of rain"
                  hides whether the members disagree between a drizzle and a
                  downpour; p10–p90 does not. Every ensemble variable is listed
                  — a new one appears here on its own. */}
              {cmp.uncertainty && Object.keys(cmp.uncertainty.byVariable).length ? (
                <View style={styles.driftRow}>
                  <Text style={styles.driftLabel}>SPREAD ACROSS MEMBERS (p10 · median · p90)</Text>
                  {Object.entries(cmp.uncertainty.byVariable).map(([k, v]: [string, any]) => (
                    <Text key={k} style={styles.driftText}>
                      {fieldLabel(ensKey(k))}: {fieldValueText(ensKey(k), v.p10) ?? '—'} · {fieldValueText(ensKey(k), v.median) ?? '—'} · {fieldValueText(ensKey(k), v.p90) ?? '—'}
                      {v.members != null ? `  (${v.members})` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}

          {/* How much this model has changed its mind about this hour across
              its last four runs. Drift near zero means it has settled. */}
          {cmp.convergence && Object.keys(cmp.convergence.byVariable).length ? (
            <View style={styles.driftRow}>
              <Text style={styles.driftLabel}>
                RUN-TO-RUN DRIFT{cmp.convergence.model ? ` · ${cmp.convergence.model}` : ''}
              </Text>
              {Object.entries(cmp.convergence.byVariable).map(([k, v]: [string, any]) => (
                <Text key={k} style={styles.driftText}>
                  {fieldLabel(ensKey(k))}: {v.runs.map((r: number) => fieldValueText(ensKey(k), r) ?? '—').join(' → ')}
                </Text>
              ))}
            </View>
          ) : null}

          {/* Sea state. It decides whether the ferry sails and whether a sea
              stack is shootable from the water at all. */}
          {cmp.sea ? (
            <View style={styles.seaRow}>
              <Ionicons name="water-outline" size={11} color={colors.textSecondary} />
              <Text style={styles.seaText} numberOfLines={3}>
                {allFields(cmp.sea as any).map((f: any) => `${f.label} ${f.text}`).join(' · ')}
              </Text>
            </View>
          ) : null}

          {/* The rest of the observation, rendered the same way a model's
              fields are. Observed temperature next to observed dew point is
              the one thing eighteen forecasts cannot give you: when they meet,
              the airfield is already in fog. */}
          {cmp.groundTruth ? (
            <View style={styles.cmpDetailGrid}>
              {allFields(cmp.groundTruth.values, { skipNonValues: true }).map((f: any) => (
                <View key={f.key} style={styles.cmpDetailItem}>
                  <Text style={styles.cmpDetailLabel} numberOfLines={1}>{f.label}</Text>
                  <Text style={styles.cmpDetailValue} numberOfLines={1}>{f.text}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* The raw strings, because they carry things no parse keeps: the
              TAF's TEMPO groups, and remarks like the Skeið wind. */}
          {cmp.groundTruth?.rawMetar || cmp.groundTruth?.rawTaf ? (
            <View style={styles.rawRow}>
              {cmp.groundTruth.rawMetar ? (
                <Text style={styles.rawText} numberOfLines={3}>{cmp.groundTruth.rawMetar}</Text>
              ) : null}
              {cmp.groundTruth.rawTaf ? (
                <Text style={styles.rawText} numberOfLines={4}>{cmp.groundTruth.rawTaf}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Spread across forecasting CENTRES, one representative each, so
              six ECMWF derivatives cannot vote six times. This is the real
              disagreement — the table below shows who is saying what. */}
          {cmp.consensus && Object.keys(cmp.consensus).length ? (
            <View style={styles.driftRow}>
              <Text style={styles.driftLabel}>
                SPREAD ACROSS CENTRES (min · median · max)
              </Text>
              {Object.entries(cmp.consensus).map(([k, v]: [string, any]) => (
                <Text key={k} style={styles.driftText}>
                  {fieldLabel(ensKey(k))}: {fieldValueText(ensKey(k), v.min) ?? '—'} · {fieldValueText(ensKey(k), v.median) ?? '—'} · {fieldValueText(ensKey(k), v.max) ?? '—'}
                  {v.centres_reporting != null ? `  (${v.centres_reporting} centre${v.centres_reporting === 1 ? '' : 's'})` : ''}
                </Text>
              ))}
            </View>
          ) : null}

            </View>
          ) : null}

          <Text style={styles.cmpFootnote}>
            Units are in the header. Everything is imperial except GRID, which stays
            in km because that is how every forecast centre names its models — the
            2 km one really is called the 2 km model. Scroll sideways for the rest of
            the columns; tap a source for every field it reported. Sorted by grid
            size, then distance: a coarse model whose sampled point happens to land
            nearby is still averaging over its whole cell. Compare BASE to the height
            of what you are shooting. FOG is cloud at 2 m, which only DMI reports.
            RAIN is fall for the hour, POP the chance of any — most models report one
            or the other, not both. DEW within a couple of degrees of TEMP means fog.
            * gust estimated from mean wind.
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
  cmpCellSource: { width: SRC_W, paddingLeft: 2 },
  // Fixed width, not flex: the table is inside a horizontal scroll, so the
  // columns have to be sized rather than sharing whatever is left.
  cmpCell: { width: COL_W, textAlign: 'center', fontSize: 11, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  cmpScroll: { marginHorizontal: -2 },
  cmpHeadCell: { textAlign: 'center' },
  cmpHeadUnit: {
    fontSize: 7, fontWeight: '600', letterSpacing: 0.3,
    color: colors.textTertiary, marginTop: -1,
  },
  detailToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingVertical: 4,
  },
  detailToggleText: {
    fontSize: 8, fontWeight: '700', letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  cmpRowOpen: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.sm },
  cmpDetail: {
    paddingVertical: 6, paddingHorizontal: 8, marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: radius.sm,
  },
  cmpDetailCentre: {
    fontSize: 9, fontWeight: '700', letterSpacing: 0.4,
    color: colors.textTertiary, marginBottom: 4,
  },
  cmpDetailGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  cmpDetailItem: { width: 118, paddingRight: 6 },
  cmpDetailLabel: { fontSize: 8, letterSpacing: 0.3, color: colors.textTertiary },
  cmpDetailValue: { fontSize: 11, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  seaRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.xs, marginBottom: spacing.xs,
  },
  seaText: { fontSize: 10, color: colors.textSecondary, flex: 1 },
  driftRow: { marginBottom: spacing.xs },
  driftLabel: {
    fontSize: 8, fontWeight: '700', letterSpacing: 0.5,
    color: colors.textTertiary, marginBottom: 2,
  },
  driftText: { fontSize: 10, color: colors.textSecondary },
  rawRow: { marginTop: 6 },
  rawText: {
    fontSize: 9, color: colors.textTertiary, fontFamily: undefined,
    fontVariant: ['tabular-nums'], marginTop: 2,
  },
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
    color: colors.textTertiary,
    fontSize: 9, letterSpacing: 0.5,
  },
  uncertaintyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flex: 1 },
  uncertaintyChip: {
    fontSize: 10, color: colors.textSecondary,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
  truthRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  truthText: { fontSize: 10, color: colors.signalOk, flex: 1 },
  cmpFootnote: { fontSize: 9, color: colors.textTertiary, fontStyle: 'italic', marginTop: 6 },
});
