import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { CameraFrame, ago, fetchFrames } from '../../services/planner';
import { WeatherRow, conditionsText, tempText, windText, visibilityText, kmhToMph } from '../../services/weather';
import { FrameModal } from './CameraView';

// The nearest cameras with a stored daylight frame: null while loading,
// [] when none is within 50 km (or the stop has no location).
export function useNearbyFrames(coords: { lat: number; lng: number } | null) {
  const [cams, setCams] = useState<CameraFrame[] | null>(null);
  const load = useCallback(() => {
    if (!coords) { setCams([]); return; }
    fetchFrames(coords, 3).then(r => setCams(r.filter(c => c.frame?.url))).catch(() => setCams([]));
  }, [coords?.lat, coords?.lng]);
  useEffect(load, [load]);
  return { cams, reload: load };
}

const W = Dimensions.get('window').width - spacing.xl * 2;
const H = Math.round(W * 0.66);

// TEST app only (mockup S3e): the nearest camera's picture, swipe for the
// next two, with the forecast for the stop's time written over it. Tap opens
// the full frame with Live and the label buttons.
export default function StopCameraHero({ cams, weather, timeLabel, onClosed }: {
  cams: CameraFrame[] | null; weather: WeatherRow | null; timeLabel?: string | null; onClosed: () => void;
}) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<CameraFrame | null>(null);
  if (cams == null) {
    return <View style={[styles.box, styles.loading]}><ActivityIndicator color={colors.textTertiary} /></View>;
  }
  const w = weather && weather.temperature_c != null ? weather : null;
  const gust = w?.wind_gusts_kmh != null ? Math.round(kmhToMph(w.wind_gusts_kmh)) : null;
  const line = w ? [
    conditionsText(w.weather_code),
    w.cloud_cover_pct != null ? `cloud ${w.cloud_cover_pct}%` : null,
    w.wind_speed_kmh != null ? `wind ${windText(w.wind_speed_kmh).replace(' mph', '')}${gust != null ? `, gusts ${gust}` : ''} mph` : null,
    w.visibility_m != null ? visibilityText(w.visibility_m) : null,
  ].filter(Boolean).join(' · ') : null;
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.box}
        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}>
        {cams.map(c => (
          <TouchableOpacity key={c.camera.code} activeOpacity={0.9} onPress={() => setOpen(c)}
            accessibilityLabel={`Camera ${c.camera.name}. Tap for the full picture and Live.`}>
            <Image source={{ uri: c.frame!.url! }} style={styles.image} resizeMode="cover" />
            <View style={styles.topRow}>
              <Text style={styles.chip} numberOfLines={1}>
                {c.camera.code} · {c.camera.name}{c.camera.distance_km != null ? ` · ${c.camera.distance_km} km` : ''}
              </Text>
              <Text style={[styles.chip, styles.chipTime]}>{ago(c.frame!.taken_at ?? c.frame!.captured_at)}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {w ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.forecastLabel}>FORECAST{timeLabel ? ` AT ${timeLabel.toUpperCase()}` : ''}</Text>
          <Text style={styles.temp}>{tempText(w.temperature_c)}</Text>
          {line ? <Text style={styles.line} numberOfLines={2}>{line}</Text> : null}
        </View>
      ) : null}
      {cams.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {cams.map((c, i) => <View key={c.camera.code} style={[styles.dot, i === page && styles.dotOn]} />)}
        </View>
      ) : null}
      <FrameModal item={open} onClose={() => { setOpen(null); onClosed(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: spacing.xl, marginBottom: spacing.lg, borderRadius: radius.lg, overflow: 'hidden' },
  box: { width: W, height: H, backgroundColor: colors.surface },
  loading: { marginHorizontal: spacing.xl, marginBottom: spacing.lg, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  image: { width: W, height: H, backgroundColor: colors.surfaceElevated },
  topRow: { position: 'absolute', left: 8, right: 8, top: 8, flexDirection: 'row', gap: 6, alignItems: 'center' },
  chip: {
    flexShrink: 1, fontSize: 10, fontWeight: '700', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: 'hidden',
  },
  chipTime: { flexShrink: 0, marginLeft: 'auto' },
  overlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', gap: 2,
  },
  forecastLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#dddddd' },
  temp: { fontFamily: 'Georgia', fontSize: 30, color: '#ffffff', lineHeight: 34 },
  line: { fontSize: 12, color: '#eeeeee', marginRight: 40 },
  dots: { position: 'absolute', right: 12, bottom: 14, flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { width: 16, backgroundColor: '#ffffff' },
});
