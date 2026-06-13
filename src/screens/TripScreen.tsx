import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTripStore } from '../store/tripStore';
import { supabase } from '../services/supabase';
import { calculateDriveTimesForTrip, recalculateTimeLabels } from '../services/driveTimes';
import { pullWeatherForTrip, WeatherRow, conditionIcon, scoreConditions, cToF } from '../services/weather';
import DaySummary from '../components/DaySummary';
import DayWeatherOverview from '../components/DayWeatherOverview';
import { colors, typography, spacing, radius } from '../theme';
import { minutesToHoursMin, addMinutesToTimeLabel } from '../utils/helpers';
import { format, parseISO } from 'date-fns';

export default function TripScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { tripId } = route.params;
  const { currentTripData, loadTrip, isSyncing, setCurrentDay } = useTripStore();
  const tabScrollRef = useRef<ScrollView>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [recalculating, setRecalculating] = useState(false);
  const [weatherUpdating, setWeatherUpdating] = useState(false);
  const [weatherProgress, setWeatherProgress] = useState<{ done: number; total: number } | null>(null);
  const [dayWeather, setDayWeather] = useState<Record<string, WeatherRow>>({});

  useEffect(() => { loadTrip(tripId); }, [tripId]);

  const goToDay = useCallback((index: number) => {
    setActiveDay(index);
    setCurrentDay(index);
    tabScrollRef.current?.scrollTo({ x: Math.max(0, index * 72 - 100), animated: true });
  }, []);

  const cycleDayStatus = useCallback(async (dayId: string, checked: boolean, review: boolean) => {
    // Cycle: off → green → yellow → off
    let newChecked = false;
    let newReview = false;
    if (!checked && !review) {
      newChecked = true; // → green
    } else if (checked && !review) {
      newReview = true; // → yellow
    }
    // else yellow → off (both false)

    useTripStore.setState((state) => {
      if (!state.currentTripData) return state;
      return {
        currentTripData: {
          ...state.currentTripData,
          days: state.currentTripData.days.map((d: any) =>
            d.id === dayId ? { ...d, checked: newChecked, review: newReview } : d
          ),
        },
      };
    });
    supabase.from('days').update({ checked: newChecked, review: newReview }).eq('id', dayId).then();
  }, []);

  const recalcDriveTimes = useCallback(async () => {
    Alert.alert(
      'Recalculate Schedule',
      'This will update all drive times using real Google Maps data, then rewrite each stop\'s time so the day cadence reflects the new drive times. Flights and other anchor stops keep their existing times. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Recalculate',
          onPress: async () => {
            setRecalculating(true);
            try {
              const drive = await calculateDriveTimesForTrip(tripId);
              const times = await recalculateTimeLabels(tripId);
              Alert.alert(
                'Done',
                `Updated ${drive.updated} drive times and ${times.stopsUpdated} stop times across ${times.daysProcessed} days.`
              );
              loadTrip(tripId); // Refresh data
            } catch (e) {
              Alert.alert('Error', 'Failed to recalculate schedule.');
            } finally {
              setRecalculating(false);
            }
          }
        }
      ]
    );
  }, [tripId]);

  // Pull weather for the whole trip (week-view action).
  const updateTripWeather = useCallback(async () => {
    Alert.alert(
      'Update Trip Weather',
      'Pull the latest forecast for every stop across all days. Days within ~16 days use their real date; days further out use a near-date preview. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update All',
          onPress: async () => {
            setWeatherUpdating(true);
            setWeatherProgress({ done: 0, total: 0 });
            try {
              const res = await pullWeatherForTrip(tripId, (done, total) =>
                setWeatherProgress({ done, total })
              );
              Alert.alert(
                'Weather Updated',
                `Pulled ${res.ok} of ${res.days} days${res.failed ? ` (${res.failed} failed)` : ''}.`
              );
              const d = useTripStore.getState().currentTripData?.days[activeDay];
              if (d) await loadTrip(tripId); // re-fold fresh weather into trip data
            } catch (e) {
              Alert.alert('Error', 'Failed to update trip weather.');
            } finally {
              setWeatherUpdating(false);
              setWeatherProgress(null);
            }
          },
        },
      ]
    );
  }, [tripId, activeDay]);

  // Weather now travels inside the trip data (folded in at load, cached with
  // it), so read it straight off the active day's stops — synchronous and
  // offline-safe, with no separate fetch to race or blank out.
  useEffect(() => {
    const d = currentTripData?.days[activeDay];
    const m: Record<string, WeatherRow> = {};
    if (d) for (const s of (d.stops || [])) if (s.weather) m[s.id] = s.weather as WeatherRow;
    setDayWeather(m);
  }, [activeDay, currentTripData]);

  if (!currentTripData) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const { trip, days } = currentTripData;
  const day = days[activeDay];
  const stops = day?.stops || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.tripTitle}>{trip.title}</Text>
          <Text style={styles.tripDates}>
            {trip.start_date ? format(parseISO(trip.start_date), 'MMM d') : ''} —{' '}
            {trip.end_date ? format(parseISO(trip.end_date), 'MMM d, yyyy') : ''}
          </Text>
        </View>
        {isSyncing && <ActivityIndicator color={colors.accentDim} size="small" />}
        <TouchableOpacity onPress={updateTripWeather} disabled={weatherUpdating} style={styles.headerBtn}>
          {weatherUpdating
            ? (weatherProgress && weatherProgress.total > 0
                ? <Text style={styles.wxProgress}>{weatherProgress.done}/{weatherProgress.total}</Text>
                : <ActivityIndicator color={colors.textSecondary} size="small" />)
            : <Ionicons name="partly-sunny-outline" size={20} color={colors.textSecondary} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={recalcDriveTimes} disabled={recalculating}>
          <Ionicons name="time-outline" size={20} color={recalculating ? colors.textTertiary : colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabBarWrapper}>
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={styles.tabBarContent}
        >
          {days.map((d: any, index: number) => {
            const isActive = index === activeDay;
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => goToDay(index)}
                onLongPress={() => cycleDayStatus(d.id, d.checked, d.review)}
              >
                <Text style={[styles.tabDayNum, isActive && styles.tabDayNumActive]}>
                  {`Day ${d.day_number}`}
                </Text>
                <Text style={[styles.tabDate, isActive && styles.tabDateActive]}>
                  {d.date ? format(parseISO(d.date), 'MMM d') : ''}
                </Text>
                {d.checked && <View style={styles.checkedDot} />}
                {d.review && <View style={styles.reviewDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {day && (
        <View style={styles.dayHeader}>
          <View style={styles.dayHeaderLeft}>
            <Text style={styles.dayTitle}>{day.title}</Text>
            {day.subtitle && <Text style={styles.daySub}>{day.subtitle}</Text>}
          </View>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => navigation.navigate('Day', { tripId, dayIndex: activeDay })}
          >
            <Ionicons name="map-outline" size={15} color={colors.textPrimary} />
            <Text style={styles.mapBtnText}>MAP</Text>
          </TouchableOpacity>
        </View>
      )}

      <DayWeatherOverview rows={Object.values(dayWeather)} dayDate={day?.date} />

      <DaySummary stops={stops} />

      <FlatList
        data={stops}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={styles.stopList}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }: { item: any; index: number }) => (
          <View>
            {index > 0 && (
              <View style={styles.connector}>
                <View style={styles.connectorLine} />
                {item.drive_override_minutes ? (
                  <View style={styles.driveBadge}>
                    <Ionicons name="car-outline" size={10} color={colors.textTertiary} />
                    <Text style={styles.driveText}>{minutesToHoursMin(item.drive_override_minutes)}</Text>
                  </View>
                ) : null}
              </View>
            )}
            <TouchableOpacity
              style={styles.stopRow}
              onPress={() => navigation.navigate('StopDetail', { stopId: item.id, dayId: day.id })}
              activeOpacity={0.7}
            >
              <View style={styles.stopTimeCol}>
                <Text style={styles.stopTime}>{item.time_label || ''}</Text>
                {item.duration_minutes && item.time_label ? (
                  <Text style={styles.stopEndTime}>{addMinutesToTimeLabel(item.time_label, item.duration_minutes)}</Text>
                ) : null}
              </View>
              <Text style={styles.stopEmoji}>{item.emoji || '📷'}</Text>
              <View style={styles.stopMeta}>
                <Text style={styles.stopName} numberOfLines={1}>{item.name}</Text>
                {item.duration_minutes ? (
                  <Text style={styles.stopDur}>{minutesToHoursMin(item.duration_minutes)}</Text>
                ) : null}
                {(() => {
                  const w = dayWeather[item.id];
                  if (!w || w.temperature_c == null) return null;
                  const sc = scoreConditions(item.shot_type, w);
                  return (
                    <View style={styles.stopWx}>
                      <Ionicons name={conditionIcon(w.weather_code) as any} size={11} color={colors.textSecondary} />
                      <Text style={styles.stopWxTemp}>{Math.round(cToF(w.temperature_c))}°</Text>
                      {sc ? (
                        <View style={styles.stopWxStars}>
                          {[0, 1, 2, 3].map(i => (
                            <Ionicons
                              key={i}
                              name={i < sc.stars ? 'star' : 'star-outline'}
                              size={8}
                              color={i < sc.stars ? colors.textSecondary : colors.textTertiary}
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })()}
              </View>
              <View style={styles.stopRight}>
                {item.alltrails_url && (
                  <Ionicons name="trail-sign-outline" size={12} color={colors.accentDim} />
                )}
                {item.signal_status === 'none' && (
                  <Ionicons name="wifi-outline" size={12} color={colors.signalNone} />
                )}
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, overflow: 'hidden' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  headerCenter: { flex: 1 },
  tripTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  tripDates: { ...typography.labelMedium, color: colors.textTertiary, marginTop: 2 },
  tabBarWrapper: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, overflow: 'hidden' },
  tabBarContent: { paddingHorizontal: spacing.md },
  tab: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    alignItems: 'center', minWidth: 68,
    borderBottomWidth: 2, borderBottomColor: 'transparent', position: 'relative',
  },
  tabActive: { borderBottomColor: colors.accent },
  tabDayNum: { fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.textTertiary },
  tabDayNumActive: { color: colors.textSecondary },
  tabDate: { fontSize: 12, fontWeight: '600', color: colors.textTertiary, marginTop: 2 },
  tabDateActive: { color: colors.textPrimary },
  checkedDot: { position: 'absolute', top: 8, right: 8, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.signalOk },
  reviewDot: { position: 'absolute', top: 8, left: 8, width: 5, height: 5, borderRadius: 3, backgroundColor: '#d4a017' },
  dayHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  dayHeaderLeft: { flex: 1 },
  dayTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary },
  daySub: { ...typography.bodySmall, marginTop: 3 },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm,
  },
  mapBtnText: { ...typography.labelMedium, color: colors.textPrimary },
  stopList: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 100 },
  connector: { height: 28, flexDirection: 'row', alignItems: 'center', paddingLeft: 84, position: 'relative' },
  connectorLine: { position: 'absolute', left: 91, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  driveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm,
  },
  driveText: { fontSize: 10, color: colors.textTertiary },
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  stopTimeCol: { width: 68, flexShrink: 0 },
  stopTime: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  stopEndTime: { fontSize: 10, color: colors.textTertiary, marginTop: 1 },
  stopEmoji: { fontSize: 18, width: 26 },
  stopMeta: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  stopDur: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  stopWx: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  stopWxTemp: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  stopWxStars: { flexDirection: 'row', gap: 1, marginLeft: 2 },
  headerBtn: { minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  wxProgress: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  stopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
