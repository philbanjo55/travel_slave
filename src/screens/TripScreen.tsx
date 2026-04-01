import React, { useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  FlatList, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTripStore } from '../store/tripStore';
import { colors, typography, spacing, radius } from '../theme';
import { format } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function TripScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { tripId } = route.params;
  const { currentTripData, currentDayIndex, loadTrip, isSyncing, setCurrentDay } = useTripStore();
  const tabScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);

  useEffect(() => { loadTrip(tripId); }, [tripId]);

  // Scroll tab bar to keep active tab visible
  const scrollTabIntoView = useCallback((index: number) => {
    tabScrollRef.current?.scrollTo({ x: index * 72, animated: true });
  }, []);

  // When day changes, scroll both tab bar and day pager
  const goToDay = useCallback((index: number) => {
    setCurrentDay(index);
    scrollTabIntoView(index);
    dayScrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
  }, []);

  // Handle swipe end — snap to nearest day
  const onDayScrollEnd = useCallback((e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentDay(index);
    scrollTabIntoView(index);
  }, []);

  if (!currentTripData) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const { trip, days } = currentTripData;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.tripTitle}>{trip.title}</Text>
          <Text style={styles.tripDates}>
            {trip.start_date ? format(new Date(trip.start_date), 'MMM d') : ''} —{' '}
            {trip.end_date ? format(new Date(trip.end_date), 'MMM d, yyyy') : ''}
          </Text>
        </View>
        {isSyncing && <ActivityIndicator color={colors.accentDim} size="small" />}
      </View>

      {/* Tab bar — scrollable, tap to jump */}
      <View style={styles.tabBarWrapper}>
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarContent}
          scrollEventThrottle={16}
        >
          {days.map((day: any, index: number) => {
            const isActive = index === currentDayIndex;
            return (
              <TouchableOpacity
                key={day.id}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => goToDay(index)}
              >
                <Text style={[styles.tabDayNum, isActive && styles.tabDayNumActive]}>
                  {day.day_number === 0 ? 'Day 0' : `Day ${day.day_number}`}
                </Text>
                <Text style={[styles.tabDate, isActive && styles.tabDateActive]}>
                  {day.date ? format(new Date(day.date), 'MMM d') : ''}
                </Text>
                {day.checked && <View style={styles.checkedDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Swipeable day pages */}
      <ScrollView
        ref={dayScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onDayScrollEnd}
        scrollEventThrottle={16}
        style={styles.dayPager}
      >
        {days.map((day: any, dayIndex: number) => (
          <DayPage
            key={day.id}
            day={day}
            dayIndex={dayIndex}
            tripId={tripId}
            navigation={navigation}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function DayPage({ day, dayIndex, tripId, navigation }: any) {
  const stops = day.stops || [];

  return (
    <View style={[styles.dayPage, { width: SCREEN_WIDTH }]}>
      {/* Day header */}
      <View style={styles.dayHeader}>
        <View style={styles.dayHeaderLeft}>
          <Text style={styles.dayTitle}>{day.title}</Text>
          {day.subtitle && <Text style={styles.daySub}>{day.subtitle}</Text>}
        </View>
        <TouchableOpacity
          style={styles.mapBtn}
          onPress={() => navigation.navigate('Day', { tripId, dayIndex })}
        >
          <Ionicons name="map-outline" size={16} color={colors.textPrimary} />
          <Text style={styles.mapBtnText}>MAP</Text>
        </TouchableOpacity>
      </View>

      {/* Stop list */}
      <FlatList
        data={stops}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={styles.stopList}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        renderItem={({ item, index }: { item: any; index: number }) => (
          <StopRow
            item={item}
            index={index}
            stops={stops}
            day={day}
            navigation={navigation}
          />
        )}
      />
    </View>
  );
}

function StopRow({ item, index, stops, day, navigation }: any) {
  const prevStop = index > 0 ? stops[index - 1] : null;
  const driveMin = item.drive_override_minutes;

  return (
    <View>
      {/* Drive connector */}
      {index > 0 && (
        <View style={styles.connector}>
          <View style={styles.connectorLine} />
          {driveMin ? (
            <View style={styles.driveBadge}>
              <Ionicons name="car-outline" size={10} color={colors.textTertiary} />
              <Text style={styles.driveText}>{driveMin} min</Text>
            </View>
          ) : null}
        </View>
      )}

      <TouchableOpacity
        style={styles.stopRow}
        onPress={() => navigation.navigate('StopDetail', { stopId: item.id, dayId: day.id })}
        activeOpacity={0.7}
      >
        <Text style={styles.stopTime}>{item.time_label || ''}</Text>
        <Text style={styles.stopEmoji}>{item.emoji || '📷'}</Text>
        <View style={styles.stopMeta}>
          <Text style={styles.stopName} numberOfLines={1}>{item.name}</Text>
          {item.duration_minutes ? (
            <Text style={styles.stopDur}>{item.duration_minutes} min</Text>
          ) : null}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  headerCenter: { flex: 1 },
  tripTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  tripDates: { ...typography.labelMedium, color: colors.textTertiary, marginTop: 2 },

  tabBarWrapper: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabBarContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minWidth: 64,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    position: 'relative',
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabDayNum: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  tabDayNumActive: { color: colors.textSecondary },
  tabDate: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    marginTop: 2,
  },
  tabDateActive: { color: colors.textPrimary },
  checkedDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.signalOk,
  },

  dayPager: { flex: 1 },
  dayPage: { flex: 1 },

  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayHeaderLeft: { flex: 1 },
  dayTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary },
  daySub: { ...typography.bodySmall, marginTop: 3 },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  mapBtnText: { ...typography.labelMedium, color: colors.textPrimary },

  stopList: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: 100,
  },

  connector: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 84,
  },
  connectorLine: {
    position: 'absolute',
    left: 91,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  driveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  driveText: { fontSize: 10, color: colors.textTertiary },

  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  stopTime: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    width: 68,
    flexShrink: 0,
  },
  stopEmoji: { fontSize: 18, width: 26 },
  stopMeta: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  stopDur: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  stopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
