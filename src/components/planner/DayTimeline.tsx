import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';
import { WeatherRow, conditionIcon, conditionsText, readScore, kmhToMph, visibilityText, cToF } from '../../services/weather';
import { minutesToHoursMin, addMinutesToTimeLabel } from '../../utils/helpers';
import { ChanceLine, DayPlanner, stopHint } from './DayPlannerHints';

// TEST app only: one stop on the day timeline (mockup E5). Times sit in the
// left column, each stop is a dot on the line with the drive between stops on
// the line itself; shoot stops are cards with their weather at their time and
// the planner's chance, logistics stops stay one thin row.
export function TimelineRow({ item, index, isLast, weather, planner, onPress }: {
  item: any; index: number; isLast: boolean; weather?: WeatherRow; planner: DayPlanner | null; onPress: () => void;
}) {
  const shoot = !!item.shot_type && item.shot_type !== 'logistics';
  const drive = index > 0 ? item.drive_override_minutes : null;
  return (
    <View>
      {index > 0 ? (
        <View style={styles.driveRow}>
          <View style={styles.gutter} />
          <View style={styles.lineCol}><View style={styles.lineFill} /></View>
          {drive ? (
            <View style={styles.drive}>
              <Ionicons name="car-outline" size={11} color={colors.textTertiary} />
              <Text style={styles.driveText}>{minutesToHoursMin(drive)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}
        accessibilityRole="button" accessibilityLabel={`${item.time_label ?? ''} ${item.name}`}>
        <View style={[styles.gutter, styles.gutterTime]}>
          <Text style={[styles.time, shoot && styles.timeShoot]}>{item.time_label || ''}</Text>
          {item.duration_minutes && item.time_label ? (
            <Text style={styles.endTime}>{addMinutesToTimeLabel(item.time_label, item.duration_minutes)}</Text>
          ) : null}
        </View>
        <View style={styles.lineCol}>
          <View style={[styles.lineTop, index === 0 && styles.lineHidden]} />
          <View style={[styles.dot, shoot ? styles.dotShoot : styles.dotStop]} />
          <View style={[styles.lineFill, isLast && styles.lineHidden]} />
        </View>
        <View style={styles.body}>
          {shoot ? <ShootCard item={item} weather={weather} planner={planner} /> : (
            <View style={styles.logRow}>
              <Text style={styles.logEmoji}>{item.emoji || '📍'}</Text>
              <Text style={styles.logName} numberOfLines={1}>{item.name}</Text>
              {item.duration_minutes ? <Text style={styles.logDur}>{minutesToHoursMin(item.duration_minutes)}</Text> : null}
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

function ShootCard({ item, weather: w, planner }: { item: any; weather?: WeatherRow; planner: DayPlanner | null }) {
  const tier = planner?.tiers.get(item.id) ?? null;
  const hint = stopHint(item.id, planner);
  const sc = w && w.temperature_c != null ? readScore(item.shot_type, w) : null;
  const wind = w?.wind_speed_kmh != null ? Math.round(kmhToMph(w.wind_speed_kmh)) : null;
  const gust = w?.wind_gusts_kmh != null ? Math.round(kmhToMph(w.wind_gusts_kmh)) : null;
  const wxLine = w && w.temperature_c != null ? [
    `${Math.round(cToF(w.temperature_c))}° ${conditionsText(w.weather_code).toLowerCase()}`,
    wind != null ? `${wind}${gust != null ? `/${gust}` : ''} mph` : null,
    w.visibility_m != null ? visibilityText(w.visibility_m) : null,
  ].filter(Boolean).join(' · ') : null;
  const contested = w?.display?.agreement?.level === 'CONTESTED';
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardEmoji}>{item.emoji || '📷'}</Text>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        {tier ? <Text style={styles.tier}>{tier}</Text> : null}
        {item.signal_status === 'none' ? <Ionicons name="wifi-outline" size={12} color={colors.signalNone} /> : null}
        {item.alltrails_url ? <Ionicons name="trail-sign-outline" size={12} color={colors.accentDim} /> : null}
        {item.duration_minutes ? <Text style={styles.cardDur}>{minutesToHoursMin(item.duration_minutes)}</Text> : null}
      </View>
      {wxLine ? (
        <View style={styles.wxRow}>
          <Ionicons name={conditionIcon(w!.weather_code) as any} size={13} color={colors.textSecondary} />
          <Text style={styles.wxText} numberOfLines={1}>{wxLine}</Text>
          {contested ? <Ionicons name="warning" size={11} color={colors.signalWarning} /> : null}
          {sc ? (
            <View style={styles.stars}>
              {[0, 1, 2, 3].map(i => (
                <Ionicons key={i} name={i < sc.stars ? 'star' : 'star-outline'} size={9}
                  color={i < sc.stars ? colors.textSecondary : colors.textTertiary} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {hint ? <ChanceLine hint={hint} /> : null}
    </View>
  );
}

const GUTTER = 58;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  driveRow: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  gutter: { width: GUTTER },
  gutterTime: { paddingTop: 11 },
  time: { fontSize: 11, color: colors.textTertiary },
  timeShoot: { color: colors.textPrimary, fontWeight: '600' },
  endTime: { fontSize: 10, color: colors.textTertiary, marginTop: 1 },
  lineCol: { width: 20, alignItems: 'center', alignSelf: 'stretch' },
  lineTop: { width: StyleSheet.hairlineWidth * 2, height: 12, backgroundColor: colors.border },
  lineFill: { width: StyleSheet.hairlineWidth * 2, flex: 1, backgroundColor: colors.border },
  lineHidden: { backgroundColor: 'transparent' },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  dotShoot: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  dotStop: { width: 8, height: 8, backgroundColor: colors.background, borderColor: '#555555' },
  drive: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6 },
  driveText: { fontSize: 10, color: colors.textTertiary },
  body: { flex: 1, paddingLeft: 6, paddingVertical: 3 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 34 },
  logEmoji: { fontSize: 14, width: 20, opacity: 0.8 },
  logName: { flex: 1, fontSize: 13, color: colors.textSecondary },
  logDur: { fontSize: 10, color: colors.textTertiary },
  card: {
    padding: spacing.sm + 2, gap: 6, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardEmoji: { fontSize: 15 },
  cardName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  tier: {
    fontSize: 9, fontWeight: '800', color: colors.textInverse, backgroundColor: colors.accent,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
  },
  cardDur: { marginLeft: 'auto', fontSize: 10, color: colors.textTertiary },
  wxRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wxText: { flexShrink: 1, fontSize: 11, color: colors.textSecondary },
  stars: { flexDirection: 'row', gap: 1, marginLeft: 'auto' },
});
