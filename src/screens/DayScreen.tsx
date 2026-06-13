import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Dimensions, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useTripStore } from '../store/tripStore';
import DaySummary from '../components/DaySummary';
import DayWeatherSummary from '../components/DayWeatherSummary';
import { WeatherRow, conditionIcon, scoreConditions, cToF } from '../services/weather';
import { colors, typography, spacing, radius } from '../theme';

const { height } = Dimensions.get('window');
const MAP_HEIGHT = height * 0.38;

export default function DayScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { tripId, dayIndex } = route.params;
  const { currentTripData, syncIfStale } = useTripStore();
  const mapRef = useRef<MapView>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [weather, setWeather] = useState<Record<string, WeatherRow>>({});

  // On focus, re-sync the trip (re-folds latest DB weather into each stop and
  // re-caches) only if the cache is stale (>10 min). Keeps weather current when
  // you land on a day without a network hit on every navigation.
  useFocusEffect(
    useCallback(() => {
      if (tripId) syncIfStale(tripId);
    }, [tripId, syncIfStale])
  );

  const day = currentTripData?.days[dayIndex];
  if (!day) return null;

  const stops = day.stops || [];
  const stopsWithLocation = stops.filter((s: any) => s.lat && s.lng);

  const routeCoords = stopsWithLocation.map((s: any) => ({
    latitude: s.lat,
    longitude: s.lng,
  }));

  // Open full day route in Google Maps with all stops as waypoints
  const openFullRoute = () => {
    if (stopsWithLocation.length < 2) return;
    const origin = `${stopsWithLocation[0].lat},${stopsWithLocation[0].lng}`;
    const dest = `${stopsWithLocation[stopsWithLocation.length-1].lat},${stopsWithLocation[stopsWithLocation.length-1].lng}`;
    const wps = stopsWithLocation.slice(1,-1).map((s: any) => `${s.lat},${s.lng}`).join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${wps}&travelmode=driving`;
    Linking.openURL(url);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.dayLabel}>DAY {day.day_number}</Text>
          <Text style={styles.dayTitle}>{day.title}</Text>
        </View>
        {stopsWithLocation.length > 1 && (
          <TouchableOpacity style={styles.routeBtn} onPress={openFullRoute}>
            <Ionicons name="navigate-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.routeBtnText}>ROUTE</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Weather — pinned to the top so it's the first thing seen */}
      <DayWeatherSummary dayId={day.id} date={day.date} onLoaded={setWeather} />

      {/* Map */}
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={() => setMapExpanded(!mapExpanded)}
        style={[styles.mapContainer, mapExpanded && { height: height * 0.55 }]}
      >
        {routeCoords.length > 0 ? (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={{
              latitude: routeCoords[0]?.latitude || day.map_center_lat || 54,
              longitude: routeCoords[0]?.longitude || day.map_center_lng || -8,
              latitudeDelta: 0.3,
              longitudeDelta: 0.3,
            }}
            customMapStyle={darkMapStyle}
          >
            {routeCoords.length > 1 && (
              <Polyline
                coordinates={routeCoords}
                strokeColor="rgba(255,255,255,0.5)"
                strokeWidth={2}
                lineDashPattern={[8, 5]}
              />
            )}
            {stopsWithLocation.map((stop: any, i: number) => (
              <Marker
                key={stop.id}
                coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                title={stop.name}
                pinColor={i === 0 || i === stopsWithLocation.length - 1 ? '#ffffff' : '#666666'}
              />
            ))}
          </MapView>
        ) : (
          <View style={styles.noMap}>
            <Ionicons name="map-outline" size={32} color={colors.textTertiary} />
            <Text style={styles.noMapText}>No GPS locations on this day</Text>
          </View>
        )}

        <View style={styles.mapHint}>
          <Ionicons
            name={mapExpanded ? 'contract-outline' : 'expand-outline'}
            size={13}
            color={colors.textSecondary}
          />
        </View>
      </TouchableOpacity>

      <DaySummary stops={stops} />

      {/* Stop list */}
      <FlatList
        data={stops}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item, index }: { item: any; index: number }) => {
          const prevStop = index > 0 ? stops[index - 1] : null;
          return (
            <View>
              {index > 0 && (
                <View style={styles.connector}>
                  <View style={styles.connLine} />
                  {item.drive_override_minutes ? (
                    <View style={styles.driveBadge}>
                      <Ionicons name="car-outline" size={10} color={colors.textTertiary} />
                      <Text style={styles.driveText}>{item.drive_override_minutes} min</Text>
                    </View>
                  ) : null}
                </View>
              )}
              <TouchableOpacity
                style={styles.stopCard}
                onPress={() => navigation.navigate('StopDetail', { stopId: item.id, dayId: day.id })}
                activeOpacity={0.75}
              >
                <Text style={styles.stopTime}>{item.time_label || ''}</Text>
                <Text style={styles.stopEmoji}>{item.emoji || '📷'}</Text>
                <View style={styles.stopBody}>
                  <Text style={styles.stopName} numberOfLines={1}>{item.name}</Text>
                  {item.duration_minutes ? (
                    <Text style={styles.stopDur}>{item.duration_minutes} min</Text>
                  ) : null}
                  {(() => {
                    const w = (item.weather as WeatherRow) ?? weather[item.id];
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
                <View style={styles.stopIcons}>
                  {item.alltrails_url && <Ionicons name="trail-sign-outline" size={12} color={colors.textTertiary} />}
                  {item.signal_status === 'none' && <Ionicons name="wifi-outline" size={12} color={colors.signalNone} />}
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#111111' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#222222' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#333333' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1628' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  headerInfo: { flex: 1 },
  dayLabel: { ...typography.labelMedium, color: colors.textTertiary },
  dayTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginTop: 2 },
  routeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  routeBtnText: { ...typography.labelMedium, color: colors.textPrimary },

  mapContainer: {
    height: MAP_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    position: 'relative',
  },
  noMap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  noMapText: { ...typography.bodySmall },
  mapHint: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: radius.sm,
    padding: 5,
  },

  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: 100,
  },

  connector: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 84,
    position: 'relative',
  },
  connLine: {
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

  stopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  stopTime: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, width: 68 },
  stopEmoji: { fontSize: 18, width: 26 },
  stopBody: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  stopDur: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  stopWx: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  stopWxTemp: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  stopWxStars: { flexDirection: 'row', gap: 1, marginLeft: 2 },
  stopIcons: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
