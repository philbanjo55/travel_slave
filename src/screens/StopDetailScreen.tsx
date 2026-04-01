import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Linking, Dimensions, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useTripStore } from '../store/tripStore';
import { colors, typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');

export default function StopDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { stopId, dayId } = route.params;
  const { currentTripData } = useTripStore();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const day = currentTripData?.days.find((d: any) => d.id === dayId);
  const stops = day?.stops || [];
  const stopIndex = stops.findIndex((s: any) => s.id === stopId);
  const stop = stops[stopIndex];
  const prevStop = stopIndex > 0 ? stops[stopIndex - 1] : null;

  if (!stop) return null;

  const photos = stop.stop_photos || [];

  // Navigate from PREVIOUS stop to THIS stop (chained directions)
  const openNavigation = () => {
    if (!stop.lat || !stop.lng) return;

    let url: string;
    if (prevStop?.lat && prevStop?.lng) {
      // Google Maps directions from previous stop to this stop
      url = `https://www.google.com/maps/dir/?api=1&origin=${prevStop.lat},${prevStop.lng}&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    } else {
      // Just navigate to this stop
      url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    }

    Linking.openURL(url).catch(() => {
      Alert.alert('Maps not available', 'Could not open Google Maps.');
    });
  };

  // Full day route in Google Maps
  const openFullDayRoute = () => {
    const pts = stops.filter((s: any) => s.lat && s.lng);
    if (pts.length < 2) return;
    const origin = `${pts[0].lat},${pts[0].lng}`;
    const dest = `${pts[pts.length-1].lat},${pts[pts.length-1].lng}`;
    const waypoints = pts.slice(1, -1).map((s: any) => `${s.lat},${s.lng}`).join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${waypoints}&travelmode=driving`;
    Linking.openURL(url);
  };

  const openAllTrails = () => {
    if (stop.alltrails_url) Linking.openURL(stop.alltrails_url);
  };

  const SIGNAL_CONFIG: Record<string, any> = {
    ok:      { color: colors.signalOk,      label: 'SIGNAL OK'   },
    warning: { color: colors.signalWarning, label: 'WEAK SIGNAL' },
    none:    { color: colors.signalNone,    label: 'NO SIGNAL'   },
  };
  const signal = stop.signal_status ? SIGNAL_CONFIG[stop.signal_status] : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.timeLabel}>{stop.time_label || ''}</Text>
        {stop.duration_minutes ? (
          <View style={styles.durBadge}>
            <Text style={styles.durText}>{stop.duration_minutes} MIN</Text>
          </View>
        ) : null}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} directionalLockEnabled disableScrollViewPanResponder>
        {/* Stop name */}
        <View style={styles.nameSection}>
          <Text style={styles.stopEmoji}>{stop.emoji || '📷'}</Text>
          <Text style={styles.stopName}>{stop.name}</Text>
          {signal && (
            <View style={[styles.signalBadge, { borderColor: signal.color }]}>
              <Text style={[styles.signalText, { color: signal.color }]}>{signal.label}</Text>
            </View>
          )}
          {prevStop?.name && (
            <Text style={styles.fromLabel}>From {prevStop.name}</Text>
          )}
        </View>

        {/* Photos */}
        {photos.length > 0 && (
          <View style={[styles.photoSection, { overflow: "hidden" }]}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              bounces={false}
              overScrollMode="never"
              onMomentumScrollEnd={(e) => {
                setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width));
              }}
            >
              {photos.map((photo: any) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.storage_url || photo.base64_data || photo.url }}
                  style={styles.photo}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
            {photos.length > 1 && (
              <View style={styles.photoDots}>
                {photos.map((_: any, i: number) => (
                  <View key={i} style={[styles.dot, i === photoIndex && styles.dotActive]} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Info */}
        {stop.info && (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>{stop.info}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {stop.lat && stop.lng && (
            <TouchableOpacity style={styles.actionBtn} onPress={openNavigation}>
              <Ionicons name="navigate-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.actionText}>
                {prevStop ? 'Directions from prev stop' : 'Navigate here'}
              </Text>
            </TouchableOpacity>
          )}

          {stops.filter((s: any) => s.lat && s.lng).length > 2 && (
            <TouchableOpacity style={styles.actionBtn} onPress={openFullDayRoute}>
              <Ionicons name="map-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.actionText}>Full day route</Text>
            </TouchableOpacity>
          )}

          {stop.alltrails_url && (
            <TouchableOpacity style={styles.actionBtn} onPress={openAllTrails}>
              <Ionicons name="trail-sign-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.actionText}>AllTrails</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Map — shows route from prev stop */}
        {stop.lat && stop.lng && (
          <View style={styles.mapContainer}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              initialRegion={{
                latitude: prevStop?.lat ? (stop.lat + prevStop.lat) / 2 : stop.lat,
                longitude: prevStop?.lng ? (stop.lng + prevStop.lng) / 2 : stop.lng,
                latitudeDelta: prevStop?.lat ? Math.abs(stop.lat - prevStop.lat) * 2.5 + 0.02 : 0.02,
                longitudeDelta: prevStop?.lng ? Math.abs(stop.lng - prevStop.lng) * 2.5 + 0.02 : 0.02,
              }}
              customMapStyle={darkMapStyle}
            >
              {prevStop?.lat && prevStop?.lng && (
                <>
                  <Marker
                    coordinate={{ latitude: prevStop.lat, longitude: prevStop.lng }}
                    title={prevStop.name}
                    pinColor="#888888"
                  />
                  <Polyline
                    coordinates={[
                      { latitude: prevStop.lat, longitude: prevStop.lng },
                      { latitude: stop.lat, longitude: stop.lng },
                    ]}
                    strokeColor="rgba(255,255,255,0.4)"
                    strokeWidth={2}
                    lineDashPattern={[6, 4]}
                  />
                </>
              )}
              <Marker
                coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                title={stop.name}
                pinColor="#ffffff"
              />
            </MapView>
          </View>
        )}

        {/* Log */}
        {stop.log && (
          <TouchableOpacity
            style={styles.expandSection}
            onPress={() => setExpanded(expanded === 'log' ? null : 'log')}
          >
            <View style={styles.expandHeader}>
              <Text style={styles.expandLabel}>FIELD NOTES</Text>
              <Ionicons
                name={expanded === 'log' ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.textTertiary}
              />
            </View>
            {expanded === 'log' && (
              <Text style={styles.expandContent}>{stop.log}</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Hist */}
        {stop.hist && (
          <TouchableOpacity
            style={styles.expandSection}
            onPress={() => setExpanded(expanded === 'hist' ? null : 'hist')}
          >
            <View style={styles.expandHeader}>
              <Text style={styles.expandLabel}>HISTORY</Text>
              <Ionicons
                name={expanded === 'hist' ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.textTertiary}
              />
            </View>
            {expanded === 'hist' && (
              <Text style={styles.expandContent}>{stop.hist}</Text>
            )}
          </TouchableOpacity>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
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
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  timeLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, flex: 1 },
  durBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  durText: { ...typography.labelMedium, color: colors.textTertiary },

  nameSection: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  stopEmoji: { fontSize: 28 },
  stopName: { fontSize: 22, fontWeight: '600', color: colors.textPrimary, lineHeight: 28 },
  signalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  signalText: { ...typography.labelMedium, fontSize: 9 },
  fromLabel: { fontSize: 11, color: colors.textTertiary, fontStyle: 'italic' },

  photoSection: { marginBottom: spacing.lg, overflow: 'hidden' },
  photo: { width, height: 260 },
  photoDots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent },

  infoCard: {
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  infoText: { ...typography.bodyLarge, lineHeight: 22 },

  actions: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionText: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },

  mapContainer: {
    marginHorizontal: spacing.xl,
    borderRadius: radius.md,
    overflow: 'hidden',
    height: 220,
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  expandSection: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  expandHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expandLabel: { ...typography.labelMedium },
  expandContent: { ...typography.bodyMedium, marginTop: spacing.md, lineHeight: 20 },
});
