import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../theme';
import { WeatherRow, conditionIcon, conditionsText, readScore, kmhToMph, visibilityText, cToF, forecastTag } from '../../services/weather';
import { minutesToHoursMin, addMinutesToTimeLabel } from '../../utils/helpers';
import { ChanceLine, DayPlanner, stopHint } from './DayPlannerHints';
import { DayChange } from '../../services/planner';
import { VERDICT_TEXT, verdictOf } from '../../services/plannerWords';
import { sunPosition, parseTimeLabel, SUN_UP_GEO } from '../../utils/sunEngine';
import { OPTION3_UI } from '../../utils/variant';

// A rated stop whose time on the day is after that day's sunset at the stop (sun below the horizon at its start time,
// worked out from the stop's own position and date, never a fixed hour): T gives it no chance, so the card says why
// instead of a blank line (Phil, 28 Nov 2026).
function localMs(date: string, minutes: number, tz: string): number | null {
  try {
    const [y, m, d] = date.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess)).reduce((o: any, x) => (o[x.type] = x.value, o), {});
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    return guess - (shown - guess);
  } catch { return null; }
}
export function afterSunset(item: any, date: string | null | undefined, tz: string | null | undefined): boolean {
  const min = parseTimeLabel(item?.time_label);
  if (min == null || !date || !tz || item?.lat == null || item?.lng == null) return false;
  const ms = localMs(date, min, tz);
  return ms != null && sunPosition(ms, Number(item.lat), Number(item.lng)).geo < SUN_UP_GEO;
}

// Ghost mode (redesign C4): the day in T's best plan's order and times. moved / added stops
// get a dashed green card and the new time; skipped ones stay, dimmed (applying keeps them).
// say (option 3, the merged timeline): the card's own line instead of the ghost words ("T adds this", "T moved it to Mon").
export type GhostTag = { kind: 'same' | 'moved' | 'added' | 'skipped'; change?: DayChange; say?: string | null };

// TEST app only: one stop on the day timeline (mockup E5). Times sit in the
// left column, each stop is a dot on the line with the drive between stops on
// the line itself; shoot stops are cards with their weather at their time and
// the planner's chance, logistics stops stay one thin row.
export function TimelineRow({ item, index, isLast, weather, planner, onPress, ghost, change, onChip, popover, dayDate }: {
  item: any; index: number; isLast: boolean; weather?: WeatherRow; planner: DayPlanner | null; onPress: () => void; dayDate?: string | null;
  ghost?: GhostTag | null; change?: DayChange | null; onChip?: () => void; popover?: React.ReactNode;
}) {
  const shoot = !!item.shot_type && item.shot_type !== 'logistics';
  const g = ghost?.kind;
  const fresh = g === 'moved' || g === 'added';
  const drive = index > 0 ? item.drive_override_minutes : null;
  return (
    <View>
      {index > 0 ? (
        <View style={styles.driveRow}>
          <View style={styles.gutter} />
          {OPTION3_UI ? null : <View style={styles.lineCol}><View style={styles.lineFill} /></View>}
          {drive ? (
            <View style={styles.drive}>
              <Ionicons name="car-outline" size={11} color={colors.textTertiary} />
              <Text style={styles.driveText}>{minutesToHoursMin(drive)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <TouchableOpacity style={[styles.row, g === 'skipped' && styles.dim]} onPress={onPress} activeOpacity={0.75}
        accessibilityRole="button" accessibilityLabel={`${item.time_label ?? ''} ${item.name}${fresh ? ', new in T\'s plan' : g === 'skipped' ? ', not in T\'s plan' : ''}`}>
        <View style={[styles.gutter, styles.gutterTime]}>
          <Text style={[styles.time, shoot && styles.timeShoot, fresh && styles.timeNew]}>{item.time_label || ''}</Text>
          {item.duration_minutes && item.time_label ? (
            <Text style={styles.endTime}>{addMinutesToTimeLabel(item.time_label, item.duration_minutes)}</Text>
          ) : null}
        </View>
        {OPTION3_UI ? null : (
          <View style={styles.lineCol}>
            <View style={[styles.lineTop, index === 0 && styles.lineHidden]} />
            <View style={[styles.dot, shoot ? styles.dotShoot : styles.dotStop]} />
            <View style={[styles.lineFill, isLast && styles.lineHidden]} />
          </View>
        )}
        <View style={styles.body}>
          {shoot && OPTION3_UI ? <ShootCard3 item={item} weather={weather} planner={planner} ghost={ghost} dayDate={dayDate} /> : shoot ? <ShootCard item={item} weather={weather} planner={planner} ghost={ghost} change={change} onChip={onChip} dayDate={dayDate} /> : (
            <View style={[styles.logRow, fresh && styles.ghostLog]}>
              <Text style={styles.logEmoji}>{item.emoji || '📍'}</Text>
              <Text style={styles.logName} numberOfLines={1}>{item.name}</Text>
              {item.duration_minutes ? <Text style={styles.logDur}>{minutesToHoursMin(item.duration_minutes)}</Text> : null}
            </View>
          )}
          {popover}
        </View>
      </TouchableOpacity>
    </View>
  );
}

// What T's plan does to this stop, in a few words, for the ghost card.
function ghostLine(ghost: GhostTag): string | null {
  if (ghost.say !== undefined) return ghost.say;
  const c = ghost.change;
  // T's verdict, never a bare % (one chance per stop, the same words everywhere).
  const vd = (x?: number | null) => (x == null ? null : VERDICT_TEXT[verdictOf(x)]);
  if (ghost.kind === 'moved') return [c?.was ? `was ${c.was}` : null, vd(c?.wasP) && vd(c?.p_good) && vd(c?.wasP) !== vd(c?.p_good) ? `${vd(c?.wasP)} → ${vd(c?.p_good)}` : vd(c?.p_good)].filter(Boolean).join(' · ');
  if (ghost.kind === 'added') return [c?.fromDay ? `from Day ${c.fromDay}` : 'added by T', vd(c?.p_good)].filter(Boolean).join(' · ');
  if (ghost.kind === 'skipped') return "not in T's plan · stays on your day";
  return null;
}

function ShootCard({ item, weather: w, planner, ghost, change, onChip, dayDate }: {
  item: any; weather?: WeatherRow; planner: DayPlanner | null; ghost?: GhostTag | null; change?: DayChange | null; onChip?: () => void;
  dayDate?: string | null;
}) {
  const wxTag = w && w.temperature_c != null ? forecastTag(w, dayDate) : null;
  const tier = planner?.tiers.get(item.id) ?? null;
  const base = stopHint(item.id, planner, item.name);
  // C2: a stop T's best plan changes gets a chip even without a better-time hint; tapping opens the popover.
  const chip = base?.chip ?? (change?.kind === 'moved' ? `T: ${change.now}` : change?.kind === 'skipped' ? 'T skips this' : null);
  const hint = base ? { ...base, chip: ghost ? null : chip } : null;
  const g = ghost?.kind;
  const line = ghost ? ghostLine(ghost) : null;
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
    <View style={[styles.card, (g === 'moved' || g === 'added') && styles.cardGhost]}>
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
          {wxTag ? <Text style={styles.wxTag} numberOfLines={1}>{wxTag.toUpperCase()}</Text> : null}
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
      {line ? <Text style={[styles.ghostText, g === 'skipped' && styles.ghostSkip]}>{line}</Text> : null}
      {hint ? <ChanceLine hint={hint} onChip={!ghost && chip && change && change.kind !== 'added' ? onChip : undefined} /> : null}
      {!hint && !ghost && tier && afterSunset(item, dayDate, planner?.run?.params?.tz) ? (
        <Text style={styles.darkLine} accessibilityLabel="After sunset">After sunset</Text>
      ) : null}
      {!hint && !ghost && chip && change ? (
        <TouchableOpacity onPress={onChip} style={styles.loneChip} accessibilityRole="button" accessibilityLabel={`${chip}. Part of T's best plan`}>
          <Text style={styles.loneChipText}>{chip}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Planner look round 2 (Phil, 28 Nov 2026): no dots on a line; each shoot card shows its chance at its time as a number on
// the right ("61%" over CHANCE, green for a good bet, amber for a long shot) and a thin bar along its bottom. T's added
// stops are dashed green, your stops T leaves out are faded and struck with where they went.
const AMBER = '#e0b34a';
function ShootCard3({ item, weather: w, planner, ghost, dayDate }: {
  item: any; weather?: WeatherRow; planner: DayPlanner | null; ghost?: GhostTag | null; dayDate?: string | null;
}) {
  const tier = planner?.tiers.get(item.id) ?? null;
  const hint = stopHint(item.id, planner, item.name);
  const g = ghost?.kind;
  const gone = g === 'skipped';
  const fresh = g === 'added' || g === 'moved';
  const line = ghost ? ghostLine(ghost) : null;
  const wx = w && w.temperature_c != null ? `${Math.round(cToF(w.temperature_c))}°F · ${conditionsText(w.weather_code).toLowerCase()}` : null;
  const vd = hint && !hint.done ? verdictOf(hint.p) : null;
  const col = vd === 'good' ? colors.signalOk : vd === 'long' ? AMBER : '#8a8a8a';
  const pct = hint && !hint.done ? Math.round(hint.p * 100) : null;
  const dark = !hint && !ghost && tier && afterSunset(item, dayDate, planner?.run?.params?.tz);
  return (
    <View style={[styles.card3, g === 'added' && styles.card3New, gone && styles.card3Gone]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardName, gone && styles.struck]} numberOfLines={1}>{item.name}</Text>
          {tier ? <Text style={styles.tier3}>{tier}</Text> : null}
          {item.signal_status === 'none' ? <Ionicons name="wifi-outline" size={12} color={colors.signalNone} /> : null}
        </View>
        <View style={styles.meta3Row}>
          {[gone ? null : wx, fresh || gone ? line : null].some(Boolean) ? (
            <Text style={styles.meta3} numberOfLines={2}>{[gone ? null : wx, fresh || gone ? line : null].filter(Boolean).join(' · ')}</Text>
          ) : null}
          {vd ? <Text style={[styles.meta3, { color: col, fontWeight: '700' }]}>{VERDICT_TEXT[vd]}</Text> : null}
          {hint?.done ? <Text style={styles.meta3}>Done · this time has passed</Text> : null}
          {dark ? <Text style={styles.meta3} accessibilityLabel="After sunset">After sunset</Text> : null}
        </View>
        {!gone && hint?.chip ? <Text style={styles.chip3} numberOfLines={1}>{hint.chip}</Text> : null}
      </View>
      {!gone && pct != null ? (
        <View style={styles.pct3} accessibilityLabel={`${pct} percent chance`}>
          <Text style={[styles.pct3N, { color: col }]}>{pct}%</Text>
          <Text style={styles.pct3L}>CHANCE</Text>
        </View>
      ) : null}
      {!gone && pct != null ? (
        <View style={styles.cbar3}><View style={[styles.cbar3Fill, { width: `${Math.max(2, pct)}%`, backgroundColor: col }]} /></View>
      ) : null}
    </View>
  );
}

const GUTTER = 58;
const styles = StyleSheet.create({
  darkLine: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  driveRow: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  gutter: { width: GUTTER },
  gutterTime: { paddingTop: 11 },
  time: { fontSize: 11, color: colors.textTertiary },
  timeShoot: { color: colors.textPrimary, fontWeight: '600' },
  timeNew: { color: colors.signalOk, fontWeight: '700' },
  dim: { opacity: 0.4 },
  cardGhost: { borderStyle: 'dashed', borderWidth: 1, borderColor: colors.signalOk },
  ghostLog: { borderStyle: 'dashed', borderWidth: 1, borderColor: colors.signalOk, borderRadius: radius.sm, paddingHorizontal: 6 },
  ghostText: { fontSize: 11, color: colors.signalOk, fontWeight: '600' },
  ghostSkip: { color: colors.textSecondary, fontWeight: '400' },
  loneChip: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.signalOk, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  loneChipText: { fontSize: 10, fontWeight: '700', color: colors.signalOk },
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
  wxTag: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: colors.signalWarning, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.signalWarning, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  stars: { flexDirection: 'row', gap: 1, marginLeft: 'auto' },
  card3: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 13, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: '#262626', overflow: 'hidden',
  },
  card3New: { borderStyle: 'dashed', borderColor: colors.signalOk, backgroundColor: '#0d140f' },
  card3Gone: { opacity: 0.42 },
  struck: { textDecorationLine: 'line-through' },
  tier3: { fontSize: 9, fontWeight: '800', borderWidth: 1, borderColor: '#444444', borderRadius: 5, paddingHorizontal: 4, color: '#cccccc' },
  meta3: { fontSize: 11, color: '#8a8a8a', flexShrink: 1 },
  meta3Row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 1 },
  chip3: { fontSize: 10, fontWeight: '700', color: colors.signalOk },
  pct3: { alignItems: 'flex-end' },
  pct3N: { fontFamily: 'Georgia', fontSize: 19, lineHeight: 21 },
  pct3L: { fontSize: 8.5, letterSpacing: 0.8, color: '#8a8a8a', fontWeight: '700' },
  cbar3: { position: 'absolute', left: 10, right: 10, bottom: 6, height: 3, borderRadius: 2, backgroundColor: '#232323', overflow: 'hidden' },
  cbar3Fill: { height: 3, borderRadius: 2 },
});
