import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTripStore } from '../store/tripStore';
import { supabase, checkDayForDelete, deleteDay } from '../services/supabase';
import { calculateDriveTimesForTrip, recalculateTimeLabels } from '../services/driveTimes';
import { pullWeatherForTrip, WeatherRow, conditionIcon, readScore, cToF } from '../services/weather';
import { getCacheStatus } from '../services/database';
import DaySummary from '../components/DaySummary';
import DayWeatherOverview from '../components/DayWeatherOverview';
import { colors, typography, spacing, radius } from '../theme';
import { minutesToHoursMin, addMinutesToTimeLabel } from '../utils/helpers';
import { format, parseISO } from 'date-fns';
import { IS_TEST_APP } from '../utils/variant';
import {
  fetchClaudeSpend, spendLine, fetchDayRuns, dayChanges, applyPreview, applyPlan, canApply, changesLine,
  labelMinutes, DayChange,
} from '../services/planner';
import { DayScoreCard, dayScore, useDayPlanner } from '../components/planner/DayPlannerHints';
import { briefSeenAt } from '../services/plannerSeen';
import { GhostTag, TimelineRow } from '../components/planner/DayTimeline';
import PlanningStrip from '../components/planner/PlanningStrip';
import { acceptedText } from '../components/planner/PlanView';

export default function TripScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { tripId } = route.params;
  const { currentTripData, loadTrip, isSyncing, setCurrentDay } = useTripStore();
  const tabScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [recalculating, setRecalculating] = useState(false);
  const [weatherUpdating, setWeatherUpdating] = useState(false);
  const [weatherProgress, setWeatherProgress] = useState<{ done: number; total: number } | null>(null);
  const [dayWeather, setDayWeather] = useState<Record<string, WeatherRow>>({});
  const [deletingDay, setDeletingDay] = useState(false);
  // TEST app only: the planner's read of the shown day, and a dot on the
  // Planner icon when there's a plan newer than the last brief Phil opened.
  const planner = useDayPlanner(IS_TEST_APP ? tripId : null, currentTripData?.days?.[activeDay]?.date, currentTripData?.days ?? []);
  const [briefNew, setBriefNew] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!IS_TEST_APP) return;
    Promise.all([fetchDayRuns(tripId, 5), briefSeenAt(tripId)])
      .then(([runs, seen]) => setBriefNew(!!runs[0] && (!seen || runs[0].created_at > seen)))
      .catch(() => {});
  }, [tripId]));

  useEffect(() => { loadTrip(tripId); }, [tripId]);

  // TEST app (redesign A1 + C2/C4): what T's best plan changes on the shown day, against the
  // day as it stands, and ghost mode (the day in the best plan's order, accept all or not now).
  const shownDay = currentTripData?.days?.[activeDay];
  const shownStops: any[] = shownDay?.stops ?? [];
  const planTz: string | undefined = planner?.run?.params?.tz ?? currentTripData?.trip?.timezone ?? undefined;
  const changes = useMemo<DayChange[]>(() => (IS_TEST_APP && planner?.best
    ? dayChanges(shownStops, currentTripData?.days ?? [], planner.mine, planner.best, planTz, id => planner.tiers.get(id) ?? null) : []),
    [planner, shownStops, currentTripData, planTz]);
  const score = IS_TEST_APP && shownDay?.date ? dayScore(planner, shownDay.date, shownStops, changes) : null;
  const realChanges = changes.filter(c => c.kind !== 'skipped');
  const [ghost, setGhost] = useState(false);
  const [pop, setPop] = useState<string | null>(null);
  const [ghostPreview, setGhostPreview] = useState<any | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [ghostDetails, setGhostDetails] = useState(false);
  useEffect(() => { setGhost(false); setPop(null); }, [activeDay, planner?.run?.id]);
  // What applying also does (set aside, tight connections), shown before Accept.
  useEffect(() => {
    if (!ghost || !planner?.run) { setGhostPreview(null); return; }
    let alive = true;
    applyPreview(planner.run.id, 1).then(j => { if (alive) setGhostPreview(j.result); }).catch(() => {});
    return () => { alive = false; };
  }, [ghost, planner?.run?.id]);
  const ghostRows = useMemo(() => {
    if (!ghost || !planner?.best) return null;
    const byId = new Map(changes.map(c => [c.stop_id, c]));
    const rows: { item: any; tag: GhostTag; k: number }[] = [];
    let last = -1;
    shownStops.forEach((s: any, i: number) => {
      const c = byId.get(s.id);
      const item = c?.kind === 'moved' ? { ...s, time_label: c.now } : s;
      const m = labelMinutes(item.time_label);
      const k = i === 0 && m == null ? -1 : i === shownStops.length - 1 && m == null ? 1e5 : m ?? last;
      if (m != null) last = m;
      rows.push({ item, tag: { kind: c ? c.kind : 'same', change: c }, k });
    });
    for (const c of changes.filter(x => x.kind === 'added')) {
      const src = (currentTripData?.days ?? []).flatMap((d: any) => d.stops ?? []).find((x: any) => x.id === c.stop_id);
      const v = planner.best.visits.find(x => x.stop_id === c.stop_id);
      rows.push({ item: { ...(src ?? { id: c.stop_id, name: c.name, shot_type: 'landscape' }), id: c.stop_id, time_label: c.now }, tag: { kind: 'added', change: c },
                  k: labelMinutes(c.now) ?? (v ? 0 : 1e4) });
    }
    return rows.sort((a, b) => a.k - b.k);
  }, [ghost, changes, shownStops, planner, currentTripData]);
  const acceptAll = useCallback(async () => {
    if (!planner?.run) return;
    setAccepting(true);
    try {
      const j = await applyPlan(planner.run.id, 1);
      if (j.preview_only) throw new Error('This trip is preview only.');
      await loadTrip(tripId);
      setGhost(false);
      Alert.alert('Plan accepted', acceptedText(j.result));
    } catch (e: any) { Alert.alert('Not applied', String(e?.message ?? e)); }
    setAccepting(false);
  }, [planner?.run?.id, tripId]);

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
    // Saved after the screen changes; if the save fails, put the old status back.
    const { error } = await supabase.from('days').update({ checked: newChecked, review: newReview }).eq('id', dayId);
    if (error) {
      useTripStore.setState((state) => state.currentTripData ? {
        currentTripData: {
          ...state.currentTripData,
          days: state.currentTripData.days.map((d: any) => (d.id === dayId ? { ...d, checked, review } : d)),
        },
      } : state);
      Alert.alert('Not saved', "Couldn't change the day's status. Check your connection and try again.");
    }
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
              const d = useTripStore.getState().currentTripData?.days[activeDay];
              if (d) await loadTrip(tripId); // re-fold fresh weather into trip data

              // Pulling and SAVING are different things, and the difference is
              // invisible until the app is closed — the screen shows fresh data
              // either way, then replays the old copy on reopen. So the alert
              // reports the write, not just the pull.
              const st = await getCacheStatus();
              const saved = st?.ok
                ? `Offline copy saved (${st.wroteDays}/${st.totalDays} days, ${st.kb} kB).`
                : st
                  ? `OFFLINE COPY NOT SAVED — ${st.wroteDays}/${st.totalDays} days wrote, `
                    + `wanted ${st.kb} kB.\n${st.storageKb != null ? `AsyncStorage ${st.storageKb} kB` : ''}${st.fileKb != null ? `, files ${st.fileKb} kB` : ''}`
                    + `${st.biggest ? `, biggest ${st.biggest}` : ''}.`
                    + `\n${st.error ?? 'no error reported'}`
                  : 'Offline copy: no result recorded.';
              const spend = IS_TEST_APP ? await fetchClaudeSpend().catch(() => null) : null;
              Alert.alert(
                'Weather Updated',
                `Pulled ${res.ok} of ${res.days} days${res.failed ? ` (${res.failed} failed)` : ''}.`
                + `\n\n${saved}`
                + (spend ? `\n\n${spendLine(spend)}` : '')
              );
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

  // Delete the day on screen. Checks the server first: a day whose stops
  // still carry photos is refused, because deleting the stops would delete
  // the photos with them.
  const confirmDeleteDay = useCallback(async () => {
    const all = useTripStore.getState().currentTripData?.days ?? [];
    const d = all[activeDay];
    if (!d) return;
    let chk;
    try {
      chk = await checkDayForDelete(d.id);
    } catch {
      Alert.alert('Offline', 'Deleting a day needs a connection. Try again when you are online.');
      return;
    }
    if (chk.photos > 0) {
      Alert.alert(
        'Can’t delete this day yet',
        `Day ${d.day_number} has ${chk.photos} photo${chk.photos === 1 ? '' : 's'} on its stops. `
        + 'Deleting the day would delete those photos too. Move the stops with photos to another day first.'
      );
      return;
    }
    const extras = [
      chk.sunPairs ? `${chk.sunPairs} sun/moon pin link${chk.sunPairs === 1 ? '' : 's'}` : null,
      chk.exposures ? `${chk.exposures} exposure${chk.exposures === 1 ? '' : 's'} will be kept but unlinked` : null,
    ].filter(Boolean).join(', ');
    Alert.alert(
      `Delete Day ${d.day_number}?`,
      `“${d.title}”\n\nRemoves the day and its ${chk.stops} stop${chk.stops === 1 ? '' : 's'} with their weather`
      + (extras ? ` (also ${extras})` : '')
      + '. Later days move up one number. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingDay(true);
            try {
              await deleteDay(d.id, tripId);
              const next = Math.max(0, Math.min(activeDay, all.length - 2));
              setActiveDay(next);
              setCurrentDay(next);
              await loadTrip(tripId);
            } catch (e: any) {
              Alert.alert('Not deleted', String(e?.message ?? e));
            } finally {
              setDeletingDay(false);
            }
          },
        },
      ]
    );
  }, [activeDay, tripId]);

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
        {IS_TEST_APP && (
          <TouchableOpacity onPress={() => navigation.navigate('Planner', { tripId })} style={styles.plannerBtn}
            accessibilityLabel="Open the Planner">
            <Ionicons name="sparkles-outline" size={18} color={colors.textPrimary} />
            {briefNew ? <View style={styles.plannerDot} /> : null}
          </TouchableOpacity>
        )}
      </View>

      {IS_TEST_APP ? <PlanningStrip tripId={tripId} onView={() => navigation.navigate('Planner', { tripId, tab: 'plans', date: day?.date })} /> : null}

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
            style={styles.deleteDayBtn}
            onPress={confirmDeleteDay}
            disabled={deletingDay}
            accessibilityLabel={`Delete day ${day.day_number}`}
          >
            {deletingDay
              ? <ActivityIndicator color={colors.textTertiary} size="small" />
              : <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => navigation.navigate('Day', { tripId, dayIndex: activeDay })}
          >
            <Ionicons name="map-outline" size={15} color={colors.textPrimary} />
            <Text style={styles.mapBtnText}>MAP</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Real app: the day weather stays above the stops. TEST app (Phil, 1 Nov 2026: "crowded, I
          can't see the timeline"): it and the T card scroll away with the timeline instead. */}
      {IS_TEST_APP ? null : <DayWeatherOverview rows={Object.values(dayWeather)} dayDate={day?.date} />}

      {/* TEST (mockup E5): the timeline shows each drive, so no totals row. */}
      {IS_TEST_APP ? null : <DaySummary stops={stops} />}

      <FlatList
        data={ghostRows ? ghostRows.map(r => r.item) : stops}
        keyExtractor={(item: any) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={IS_TEST_APP ? (
          <View style={styles.listHead}>
            <DayWeatherOverview rows={Object.values(dayWeather)} dayDate={day?.date} />
            {day?.date ? (
              <DayScoreCard tripId={tripId} date={day.date} planner={planner} score={score}
                onShowChanges={() => { setPop(null); setGhost(true); }} />
            ) : null}
          </View>
        ) : undefined}
        contentContainerStyle={[styles.stopList, ghostRows ? { paddingBottom: ghostDetails ? 260 : 130 } : null]}
        renderItem={({ item, index }: { item: any; index: number }) => IS_TEST_APP ? (
          <TimelineRow item={item} index={index} isLast={index === (ghostRows ?? stops).length - 1} weather={dayWeather[item.id]} dayDate={day?.date}
            planner={planner} ghost={ghostRows ? ghostRows[index]?.tag : null}
            change={changes.find(c => c.stop_id === item.id && c.kind !== 'added') ?? null}
            onChip={() => setPop(p => (p === item.id ? null : item.id))}
            popover={!ghostRows && pop === item.id && score ? (
              <View style={styles.popover}>
                <Text style={styles.popText}>
                  Part of T's best plan: {realChanges.length} change{realChanges.length === 1 ? '' : 's'}
                  {score.mine != null && score.best != null ? `, ${score.mine}% → ${score.best}%` : score.best != null ? `, best ${score.best}%` : ''}.
                </Text>
                <View style={styles.popBtns}>
                  <TouchableOpacity style={styles.popGo} onPress={() => { setPop(null); setGhost(true); }} accessibilityRole="button">
                    <Text style={styles.popGoText}>Show in timeline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.popNo} onPress={() => setPop(null)} accessibilityRole="button">
                    <Text style={styles.popNoText}>Not now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            onPress={() => {
              const d = ghostRows ? (currentTripData?.days ?? []).find((x: any) => (x.stops ?? []).some((s: any) => s.id === item.id)) : day;
              if (d) navigation.navigate('StopDetail', { stopId: item.id, dayId: d.id });
            }} />
        ) : (
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
                  // Guard w BEFORE scoring — readScore reads w.is_dark and
                  // would crash on a stop that has no weather row yet (w undefined).
                  if (!w || w.temperature_c == null) return null;
                  // Only rated shoot stops get a weather row. readScore returns
                  // null for logistics / non-shoot stops, so those show nothing.
                  const sc = readScore(item.shot_type, w);
                  if (!sc) return null;
                  // Rating first, then conditions: rain %, rain amount, wind/gusts.
                  // All-monochrome (Ionicons), no temperature, kept compact.
                  const pop = w.precip_probability_pct;
                  const rainAmt = (w.rain_mm ?? 0) + (w.showers_mm ?? 0);
                  const windMph = w.wind_speed_kmh != null ? Math.round(w.wind_speed_kmh / 1.609) : null;
                  const gustMph = w.wind_gusts_kmh != null ? Math.round(w.wind_gusts_kmh / 1.609) : null;
                  // Contested flag: the centres disagree about whether this is
                  // SHOOTABLE, which is the thing worth warning about — not about
                  // a raw number. Read from the render contract rather than
                  // reaching into raw, so the rule stays in one place.
                  // The old raw.comparison verdict read SPLIT on 68 of 72 stops,
                  // so this triangle was lit on nearly every stop and said nothing.
                  const isContested = w.display?.agreement?.level === 'CONTESTED';
                  return (
                    <View style={styles.stopWx}>
                      {isContested ? (
                        <Ionicons name="warning" size={12} color="#e0a82e" />
                      ) : null}
                      <View style={styles.stopWxStars}>
                        {[0, 1, 2, 3].map(i => (
                          <Ionicons
                            key={i}
                            name={i < sc.stars ? 'star' : 'star-outline'}
                            size={9}
                            color={i < sc.stars ? colors.textSecondary : colors.textTertiary}
                          />
                        ))}
                      </View>
                      {pop != null ? (
                        <View style={styles.stopWxItem}>
                          <Ionicons name="water-outline" size={11} color={colors.textTertiary} />
                          <Text style={styles.stopWxDetail} numberOfLines={1}>{Math.round(pop)}%{rainAmt > 0 ? `/${rainAmt.toFixed(1)}mm` : ''}</Text>
                        </View>
                      ) : null}
                      {windMph != null || gustMph != null ? (
                        <View style={styles.stopWxItem}>
                          <Ionicons name="navigate-outline" size={11} color={colors.textTertiary} />
                          <Text style={styles.stopWxDetail} numberOfLines={1}>{windMph != null ? windMph : '–'}{gustMph != null ? `/${gustMph}` : ''} mph</Text>
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

      {IS_TEST_APP && ghostRows ? (
        <View style={styles.ghostBar}>
          {/* One line of what accepting does; the lists behind Details (the timeline stays visible). */}
          <TouchableOpacity onPress={() => setGhostDetails(v => !v)} style={styles.ghostSummary} accessibilityRole="button"
            accessibilityState={{ expanded: ghostDetails }}>
            {ghostPreview ? (
              <Text style={styles.ghostNote} numberOfLines={1}>
                {ghostPreview.stops_changed ?? 0} stops change
                {ghostPreview.set_aside?.length ? ` · ${ghostPreview.set_aside.length} set aside` : ''}
                {ghostPreview.clashes?.length ? ` · ${ghostPreview.clashes.length} tight` : ''}
              </Text>
            ) : <ActivityIndicator size="small" color={colors.textTertiary} />}
            <Text style={styles.ghostDetailsLink}>{ghostDetails ? 'Hide' : 'Details'} {ghostDetails ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {ghostDetails ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.ghostNote}>{changesLine(changes)}</Text>
              {ghostPreview ? (() => {
                // Accepting this day also takes stops from the days T moved them off (they lose them).
                const here = (ghostPreview.days ?? []).find((d: any) => d.date === day?.date);
                const from = [...new Set<string>((here?.stops ?? []).map((x: any) => x.moved_from).filter(Boolean))]
                  .map(dt => (currentTripData?.days ?? []).find((d: any) => d.date === dt)?.day_number).filter(Boolean);
                return from.length ? <Text style={styles.ghostNote}>Takes stops from Day {from.join(', ')}</Text> : null;
              })() : null}
              {ghostPreview?.set_aside?.length ? (
                <Text style={styles.ghostNote}>Sets aside: {ghostPreview.set_aside.map((x: any) => x.name).join(', ')}</Text>
              ) : null}
              {ghostPreview?.clashes?.length ? (
                <Text style={styles.ghostNote}>Tight: {ghostPreview.clashes.map((x: any) => `${x.name} into ${x.next_name} (${x.late_min} min)`).join('; ')}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.ghostBtns}>
            {canApply(tripId) ? (
              <TouchableOpacity style={styles.ghostAccept} onPress={acceptAll} disabled={accepting || !realChanges.length} accessibilityRole="button">
                {accepting ? <ActivityIndicator color={colors.textInverse} /> : (
                  <Text style={styles.ghostAcceptText} numberOfLines={1}>
                    Accept all {realChanges.length} change{realChanges.length === 1 ? '' : 's'}
                    {score?.mine != null && score.best != null ? ` · ${score.mine}% → ${score.best}%` : score?.best != null ? ` · best ${score.best}%` : ''}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={[styles.ghostAccept, styles.ghostPreviewOnly]}>
                <Text style={styles.ghostPreviewText}>Preview only on real trips</Text>
              </View>
            )}
            <TouchableOpacity style={styles.ghostNo} onPress={() => setGhost(false)} accessibilityRole="button">
              <Text style={styles.ghostNoText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
  deleteDayBtn: { padding: spacing.sm, marginRight: spacing.sm },
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
  stopWx: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  stopWxTemp: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  stopWxStars: { flexDirection: 'row', gap: 1 },
  stopWxItem: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  stopWxDetail: { fontSize: 11, color: colors.textSecondary },
  headerBtn: { minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  plannerBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, marginLeft: spacing.xs,
  },
  plannerDot: { position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.signalOk, borderWidth: 1, borderColor: colors.background },
  wxProgress: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  stopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  popover: {
    marginTop: 6, padding: spacing.sm, gap: spacing.sm, borderRadius: radius.md, backgroundColor: '#161616',
    borderWidth: 1, borderColor: colors.signalOk,
  },
  popText: { fontSize: 12, color: colors.textPrimary, lineHeight: 17 },
  popBtns: { flexDirection: 'row', gap: spacing.sm },
  popGo: { flex: 1, minHeight: 36, borderRadius: radius.sm, backgroundColor: colors.signalOk, alignItems: 'center', justifyContent: 'center' },
  popGoText: { fontSize: 13, fontWeight: '700', color: colors.background },
  popNo: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  popNoText: { fontSize: 13, color: colors.textSecondary },
  ghostBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: 6,
    backgroundColor: '#0d0d0d', borderTopWidth: 1, borderTopColor: colors.signalOk,
  },
  ghostBtns: { flexDirection: 'row', gap: spacing.sm },
  ghostSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  ghostDetailsLink: { marginLeft: 'auto', fontSize: 12, fontWeight: '700', color: colors.signalOk },
  listHead: { marginHorizontal: -spacing.xl, marginBottom: spacing.xs },
  ghostAccept: { flex: 1, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.signalOk, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  ghostAcceptText: { fontSize: 14, fontWeight: '800', color: colors.background },
  ghostPreviewOnly: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  ghostPreviewText: { fontSize: 13, color: colors.textSecondary },
  ghostNo: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  ghostNoText: { fontSize: 14, color: colors.textPrimary },
  ghostNote: { fontSize: 11, color: colors.textSecondary },
});
