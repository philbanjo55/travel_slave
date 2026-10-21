import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius } from '../../theme';
import { Plan, PlanRun, TripSetting, fetchDayRuns, fetchPlans, fetchTripSettings, latestByDay } from '../../services/planner';
import { PlanBody } from '../../components/planner/PlanView';
import { darkMapStyle } from '../DayScreen';

// The chosen day's plan as a route: numbered stops in order, rated stops the
// plan leaves out in grey. Same day as the Plans tab.
export default function MapTab({ tripId, days, date, setDate, goPlans }: {
  tripId: string; days: any[]; date: string | null; setDate: (d: string) => void; goPlans: (d: string) => void;
}) {
  const mapRef = useRef<MapView>(null);
  const [run, setRun] = useState<PlanRun | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rank, setRank] = useState(1);
  const [settings, setSettings] = useState<TripSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dated = days.filter((d: any) => d.date);
  const cur = date ?? dated[0]?.date ?? null;
  const day = dated.find((d: any) => d.date === cur);
  const stops = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of days) for (const s of d.stops ?? []) m.set(s.id, s);
    return m;
  }, [days]);

  const load = useCallback(async () => {
    if (!cur) return;
    setLoading(true); setError(null);
    try {
      const m = latestByDay(await fetchDayRuns(tripId)).get(cur) ?? {};
      const r = m.forecast ?? m.light ?? null;
      setRun(r); setPlans(r ? await fetchPlans(r.id) : []); setRank(1);
      setSettings(await fetchTripSettings(tripId));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setLoading(false);
  }, [tripId, cur]);
  useEffect(() => { load(); }, [load]);

  const plan = plans.find(p => p.rank === rank) ?? plans[0];
  const route = (plan?.visits ?? []).map(v => ({ v, s: stops.get(v.stop_id) })).filter(x => x.s?.lat != null && x.s?.lng != null);
  const inPlan = new Set(route.map(x => x.v.stop_id));
  // Rated stops on this day (or rated anywhere, if the plan pulls from other days) that the plan skips.
  const others = settings.filter(st => st.tier && !inPlan.has(st.stop_id)).map(st => stops.get(st.stop_id))
    .filter((s: any) => s?.lat != null && (s.day_id === day?.id || route.length === 0));
  const coords = route.map(x => ({ latitude: x.s.lat, longitude: x.s.lng }));

  useEffect(() => {
    const pts = coords.length ? coords : others.map((s: any) => ({ latitude: s.lat, longitude: s.lng }));
    if (pts.length) setTimeout(() => mapRef.current?.fitToCoordinates(pts, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false }), 300);
  }, [plan?.rank, run?.id, coords.length]);

  const first = coords[0] ?? (others[0] ? { latitude: others[0].lat, longitude: others[0].lng } : { latitude: 20, longitude: 0 });
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {dated.map((d: any) => (
          <TouchableOpacity key={d.id} onPress={() => setDate(d.date)} style={[styles.day, d.date === cur && styles.dayOn]}>
            <Text style={[styles.dayText, d.date === cur && styles.dayTextOn]}>D{d.day_number} · {format(parseISO(d.date), 'd MMM')}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.mapBox}>
        <MapView ref={mapRef} provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} customMapStyle={darkMapStyle}
          initialRegion={{ ...first, latitudeDelta: 0.4, longitudeDelta: 0.4 }}>
          {coords.length > 1 ? <Polyline coordinates={coords} strokeColor="rgba(255,255,255,0.7)" strokeWidth={2} /> : null}
          {others.map((s: any) => (
            <Marker key={`o-${s.id}`} coordinate={{ latitude: s.lat, longitude: s.lng }} title={s.name} description="Rated, not in this plan"
              anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.greyDot} />
            </Marker>
          ))}
          {route.map((x, i) => (
            <Marker key={`r-${x.v.stop_id}-${i}`} coordinate={{ latitude: x.s.lat, longitude: x.s.lng }} title={`${i + 1} · ${x.v.name}`}
              description={x.v.p_good != null ? `${Math.round(x.v.p_good * 100)}% chance` : undefined} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.pin, x.v.booked && styles.pinBooked]}><Text style={styles.pinText}>{i + 1}</Text></View>
            </Marker>
          ))}
        </MapView>
      </View>
      <Text style={styles.hint}>White = this plan in order · grey = rated, not in the plan. Lines are straight, not the road.</Text>

      {/* Only the list scrolls: a map inside a scrolling page fights it for the finger. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
        : error ? <Text style={styles.error}>{error}</Text>
        : !run ? (
          <TouchableOpacity style={styles.planBtn} onPress={() => cur && goPlans(cur)}>
            <Text style={styles.planText}>Not planned yet · plan this day</Text>
          </TouchableOpacity>
        ) : <PlanBody run={run} plans={plans} initialRank={1} onRank={setRank} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm },
  list: { paddingBottom: spacing.xxxl, gap: spacing.sm },
  days: { gap: 6 },
  day: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { fontSize: 12, color: colors.textPrimary },
  dayTextOn: { color: colors.textInverse, fontWeight: '700' },
  mapBox: { height: 280, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  pin: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000' },
  pinBooked: { backgroundColor: colors.signalOk },
  pinText: { fontSize: 12, fontWeight: '800', color: colors.textInverse },
  greyDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#666', borderWidth: 1, borderColor: '#000' },
  planBtn: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  planText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  error: { color: '#e74c3c', fontSize: 12 },
  hint: { fontSize: 12, color: colors.textTertiary },
});
