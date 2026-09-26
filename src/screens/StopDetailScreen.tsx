import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Linking, Dimensions, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { getPhotoUri } from '../services/photoCache';
import { usePhotoUpload } from '../hooks/usePhotoUpload';
import { useTripStore } from '../store/tripStore';
import StopWeatherCard from '../components/StopWeatherCard';
import FullScreenPhotoViewer from '../components/FullScreenPhotoViewer';
import SunPlannerSection from '../components/sun/SunPlannerSection';
import { colors, typography, spacing, radius } from '../theme';
import { minutesToHoursMin, addMinutesToTimeLabel } from '../utils/helpers';

const { width } = Dimensions.get('window');




function PhotoItem({ photo }: { photo: any }) {
  const [uri, setUri] = React.useState<string>('');

  React.useEffect(() => {
    let cancelled = false;
    getPhotoUri(photo).then(resolved => {
      if (!cancelled && resolved) {
        setUri(resolved);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [photo.id]);

  if (!uri) return null;
  return <Image source={{ uri }} style={styles.photo} resizeMode="contain" />;
}

// The first reference photo, small, top right of the stop. Tap opens the
// full-screen viewer, which swipes through all of them.
function PhotoThumb({ photo, count, onPress }: { photo: any; count: number; onPress: () => void }) {
  const [uri, setUri] = React.useState<string>('');

  React.useEffect(() => {
    let cancelled = false;
    getPhotoUri(photo).then(resolved => {
      if (!cancelled && resolved) setUri(resolved);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [photo.id]);

  return (
    <TouchableOpacity
      style={styles.thumb}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={`Open reference photos (1 of ${count})`}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <ActivityIndicator size="small" color={colors.textTertiary} />
      )}
      {count > 1 && (
        <View style={styles.thumbBadge}>
          <Text style={styles.thumbBadgeText}>1/{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function StopDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { stopId, dayId } = route.params;
  const { currentTripData } = useTripStore();
  const [fieldPhotoIndex, setFieldPhotoIndex] = useState(0);
  const [viewerPhoto, setViewerPhoto] = useState<any | null>(null);
  const [viewerKind, setViewerKind] = useState<'reference' | 'field'>('reference');
  const [expanded, setExpanded] = useState<string | null>(null);

  const day = currentTripData?.days.find((d: any) => d.id === dayId);
  const stops = day?.stops || [];
  const stopIndex = stops.findIndex((s: any) => s.id === stopId);
  const stop = stops[stopIndex];
  const prevStop = stopIndex > 0 ? stops[stopIndex - 1] : null;

  if (!stop) return null;

  const allPhotos = stop.stop_photos || [];
  const byPosition = (a: any, b: any) => (a.position ?? 1e9) - (b.position ?? 1e9);
  const refPhotos = allPhotos.filter((p: any) => !p.photo_type || p.photo_type === 'reference').sort(byPosition);
  const fieldPhotos = allPhotos.filter((p: any) => p.photo_type === 'field').sort(byPosition);
  const { pickAndUpload, takePhoto, deletePhoto, makeFirst, uploading, uploadProgress, error } = usePhotoUpload(stop.id);

  const handlePhotoLongPress = (photoId: string, type: string, after?: () => void) => {
    Alert.alert('Delete Photo', `Remove this ${type} photo?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deletePhoto(photoId); after?.(); } },
    ]);
  };

  // The viewer always gets the live list, so a reorder or delete shows at once.
  const openViewer = (photo: any, kind: 'reference' | 'field') => {
    setViewerKind(kind);
    setViewerPhoto(photo);
  };
  const closeViewer = () => setViewerPhoto(null);

  // Navigate from PREVIOUS stop to THIS stop (chained directions)
  const openNavigation = () => {
    if (!stop.lat || !stop.lng) return;

    // Use google.navigation intent — works offline with downloaded maps
    const url = `google.navigation:q=${stop.lat},${stop.lng}&mode=d`;

    Linking.openURL(url).catch(() => {
      Linking.openURL(`geo:${stop.lat},${stop.lng}?q=${stop.lat},${stop.lng}(${encodeURIComponent(stop.name)})`).catch(() => {
        Alert.alert('Maps not available', 'Could not open Google Maps.');
      });
    });
  };

  // Show route from previous stop to this stop (for planning)
  const openRouteFromPrev = () => {
    if (!stop.lat || !stop.lng || !prevStop?.lat || !prevStop?.lng) return;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${prevStop.lat},${prevStop.lng}&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    Linking.openURL(url);
  };

  // Full day route in Google Maps
  const openFullDayRoute = () => {
    const pts = stops.filter((s: any) => s.lat && s.lng);
    if (pts.length < 2) return;
    // geo: doesn't support waypoints, so use web URL (requires internet)
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
        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>{stop.time_label || ''}</Text>
          {stop.duration_minutes && stop.time_label ? (
            <Text style={styles.timeEndLabel}>— {addMinutesToTimeLabel(stop.time_label, stop.duration_minutes)}</Text>
          ) : null}
        </View>
        {stop.duration_minutes ? (
          <View style={styles.durBadge}>
            <Text style={styles.durText}>{minutesToHoursMin(stop.duration_minutes).toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} directionalLockEnabled disableScrollViewPanResponder>
        {/* Stop name, with the reference photos top right */}
        <View style={styles.nameRow}>
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
          <View style={styles.thumbCol}>
            {refPhotos.length > 0 && (
              <PhotoThumb
                photo={refPhotos[0]}
                count={refPhotos.length}
                onPress={() => openViewer(refPhotos[0], 'reference')}
              />
            )}
            <TouchableOpacity
              style={styles.addThumbBtn}
              onPress={() => pickAndUpload('reference')}
              disabled={uploading}
              accessibilityLabel="Add reference photos"
            >
              {uploading ? (
                <>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.addThumbText}>{uploadProgress || '…'}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={styles.addThumbText}>Add photo</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
        {error && (
          <Text style={[styles.uploadError, { marginBottom: spacing.md }]}>Upload failed: {error}</Text>
        )}

        {/* Weather — pinned near the top of the location */}
        <StopWeatherCard stopId={stop.id} shotType={stop.shot_type} dayDate={day?.date} weather={stop.weather ?? null} />

        {/* Sun & Moon — hidden unless this stop has vantage/subject pairs */}
        <SunPlannerSection tripId={currentTripData?.trip?.id} stopId={stop.id} timeLabel={stop.time_label} />

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
                Navigate here
              </Text>
            </TouchableOpacity>
          )}

          {prevStop?.lat && prevStop?.lng && stop.lat && stop.lng && (
            <TouchableOpacity style={styles.actionBtn} onPress={openRouteFromPrev}>
              <Ionicons name="git-commit-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.actionText}>
                Route from {prevStop.name?.replace(/^[^\w]*/, '').split(' ').slice(0, 3).join(' ')}
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

        {/* Field Photos — taken on location */}
        <View style={styles.fieldPhotoSection}>
          <Text style={styles.fieldPhotoTitle}>FIELD PHOTOS</Text>
          {fieldPhotos.length > 0 && (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
                onMomentumScrollEnd={(e) => {
                  setFieldPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width));
                }}
              >
                {fieldPhotos.map((photo: any) => (
                  <TouchableOpacity
                    key={photo.id}
                    onPress={() => openViewer(photo, 'field')}
                    onLongPress={() => handlePhotoLongPress(photo.id, 'field')}
                    activeOpacity={0.9}
                  >
                    <PhotoItem photo={photo} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {fieldPhotos.length > 1 && (
                <View style={styles.photoDots}>
                  {fieldPhotos.map((_: any, i: number) => (
                    <View key={i} style={[styles.dot, i === fieldPhotoIndex && styles.dotActive]} />
                  ))}
                </View>
              )}
            </>
          )}
          <View style={styles.fieldPhotoBtns}>
            <TouchableOpacity
              style={[styles.addPhotoBtn, { flex: 1 }]}
              onPress={() => takePhoto('field')}
              disabled={uploading}
            >
              <Ionicons name="camera-outline" size={16} color={colors.accent} />
              <Text style={styles.addPhotoText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addPhotoBtn, { flex: 1 }]}
              onPress={() => pickAndUpload('field')}
              disabled={uploading}
            >
              <Ionicons name="images-outline" size={16} color={colors.accent} />
              <Text style={styles.addPhotoText}>From Roll</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
      <FullScreenPhotoViewer
        photo={viewerPhoto}
        photos={viewerKind === 'field' ? fieldPhotos : refPhotos}
        visible={!!viewerPhoto}
        onClose={closeViewer}
        onDelete={(p) => handlePhotoLongPress(p.id, viewerKind, closeViewer)}
        onMakeFirst={viewerKind === 'reference' ? async (p) => {
          const ok = await makeFirst(p.id, refPhotos.map((r: any) => r.id));
          if (!ok) Alert.alert('Not saved', 'Could not change the photo order. Check your connection and try again.');
        } : undefined}
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
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  timeRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  timeLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  timeEndLabel: { fontSize: 13, color: colors.textTertiary, marginLeft: 4 },
  durBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  durText: { ...typography.labelMedium, color: colors.textTertiary },

  nameRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: 14 },
  nameSection: { flex: 1, minWidth: 0, gap: spacing.sm },
  thumbCol: { width: 96, gap: 6 },
  thumb: {
    width: 96, height: 96, borderRadius: 10, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbBadge: {
    position: 'absolute', right: 5, bottom: 5, paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.75)',
  },
  thumbBadgeText: { fontSize: 9, fontWeight: '700', color: '#ffffff' },
  addThumbBtn: {
    minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: 8,
  },
  addThumbText: { fontSize: 11, fontWeight: '600', color: colors.accent },
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

  photo: { width, height: 260, backgroundColor: '#111' },
  photoDots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border },
  addPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.xl, marginTop: spacing.sm, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, borderStyle: 'dashed',
  },
  addPhotoText: { fontSize: 12, fontWeight: '500', color: colors.accent },
  uploadError: { fontSize: 11, color: '#e74c3c', textAlign: 'center', marginTop: spacing.xs, marginHorizontal: spacing.xl },
  fieldPhotoSection: {
    marginTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border, paddingTop: spacing.lg,
  },
  fieldPhotoTitle: {
    ...typography.labelMedium, paddingHorizontal: spacing.xl, marginBottom: spacing.md,
  },
  fieldPhotoBtns: {
    flexDirection: 'row', gap: spacing.sm,
    marginHorizontal: spacing.xl, marginTop: spacing.sm,
  },
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
