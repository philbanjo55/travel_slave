import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { useTripStore } from '../store/tripStore';
import { colors, spacing, typography } from '../theme';
import OverviewTab from './planner/OverviewTab';
import PlansTab from './planner/PlansTab';
import SubjectsTab from './planner/SubjectsTab';
import MapTab from './planner/MapTab';
import SetupTab from './planner/SetupTab';
import NightlyToggle from '../components/planner/NightlyToggle';

export { dayBadge } from '../components/planner/dayBadge';

export type PlannerTab = 'overview' | 'plans' | 'subjects' | 'map' | 'setup';
const TABS: { key: PlannerTab; text: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'overview', text: 'Overview', icon: 'sunny-outline' },
  { key: 'plans', text: 'Plans', icon: 'list-outline' },
  { key: 'subjects', text: 'Subjects', icon: 'star-outline' },
  { key: 'map', text: 'Map', icon: 'map-outline' },
  { key: 'setup', text: 'Setup', icon: 'options-outline' },
];

// TEST app only: the solver Planner for one trip, in five tabs. Plans and
// Map share the chosen day. Params: tripId, tab?, date?.
export default function PlannerScreen() {
  const navigation = useNavigation<any>();
  const params = useRoute<any>().params ?? {};
  const tripId: string = params.tripId;
  const { currentTripData } = useTripStore();
  const days: any[] = currentTripData?.days ?? [];
  const [tab, setTab] = useState<PlannerTab>(params.tab ?? 'overview');
  const [date, setDate] = useState<string | null>(params.date ?? null);

  // Default day: the next trip day, else the first.
  useEffect(() => {
    if (date || !days.length) return;
    const next = days.find((d: any) => d.date && differenceInCalendarDays(parseISO(d.date), new Date()) >= 0) ?? days.find((d: any) => d.date);
    if (next) setDate(next.date);
  }, [days.length]);
  useEffect(() => { if (params.tab) setTab(params.tab); if (params.date) setDate(params.date); }, [params.tab, params.date]);

  const goPlans = (d: string) => { setDate(d); setTab('plans'); };
  const tz: string | undefined = currentTripData?.trip?.timezone ?? undefined;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityLabel="Back to the trip">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{TABS.find(t => t.key === tab)?.text === 'Overview' ? 'Planner' : TABS.find(t => t.key === tab)?.text}</Text>
          <Text style={styles.subtitle}>{currentTripData?.trip?.title ?? ''} · TEST</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'overview' ? <OverviewTab tripId={tripId} days={days} goPlans={goPlans} goTab={setTab}
            extra={<NightlyToggle tripId={tripId} tripTitle={currentTripData?.trip?.title ?? 'Trip'} />} />
          : tab === 'plans' ? <PlansTab tripId={tripId} days={days} date={date} setDate={setDate} goMap={() => setTab('map')} />
          : tab === 'subjects' ? <SubjectsTab tripId={tripId} days={days} tz={tz} goPlans={goPlans} />
          : tab === 'map' ? <MapTab tripId={tripId} days={days} date={date} setDate={setDate} goPlans={goPlans} />
          : <SetupTab tripId={tripId} days={days} />}
      </View>

      <View style={styles.tabBar} accessibilityRole="tablist">
        {TABS.map(t => {
          const on = t.key === tab;
          return (
            <TouchableOpacity key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}
              accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Ionicons name={on ? (t.icon.replace('-outline', '') as any) : t.icon} size={20} color={on ? colors.textPrimary : colors.textTertiary} />
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  title: { ...typography.displayMedium, fontSize: 20 },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  tabBar: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.background, paddingTop: 6, paddingBottom: 4,
  },
  tabBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabText: { fontSize: 10, color: colors.textTertiary },
  tabTextOn: { color: colors.textPrimary, fontWeight: '700' },
});
