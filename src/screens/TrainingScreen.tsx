import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useTripStore } from '../store/tripStore';
import { supabase } from '../services/supabase';
import { colors, typography, spacing } from '../theme';

// TEST app only: the live training trips (trips.training_of set), kept off
// the main trips list. Each is a copy of a main trip's itinerary moved to
// now, planned on real forecasts and scored against what happened.
export function isTrainingRunning(t: any, today = format(new Date(), 'yyyy-MM-dd')) {
  return !!t.training_of && !t.archived && !!t.training_until && today <= t.training_until;
}

export default function TrainingScreen() {
  const navigation = useNavigation<any>();
  const { trips, loadTrips } = useTripStore();
  useEffect(() => { loadTrips(); }, []);

  const training = trips.filter((t: any) => t.training_of);
  const running = training.filter((t: any) => isTrainingRunning(t));
  const finished = training.filter((t: any) => !isTrainingRunning(t));
  const parentTitle = (id: string) => trips.find((t: any) => t.id === id)?.title ?? 'a trip';
  const rows = [
    ...(running.length ? [{ header: 'RUNNING' }, ...running] : []),
    ...(finished.length ? [{ header: 'FINISHED' }, ...finished] : []),
  ];

  const archiveTrip = (item: any) => {
    Alert.alert(item.title, item.archived ? 'Bring this training trip back?' : 'Archive this training trip? Its results stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: item.archived ? 'Unarchive' : 'Archive',
        onPress: async () => {
          try {
            await supabase.from('trips').update({ archived: !item.archived }).eq('id', item.id);
            await loadTrips();
          } catch {
            Alert.alert('Error', 'Could not update trip.');
          }
        },
      },
    ]);
  };

  const renderRow = ({ item }: { item: any }) => {
    if (item.header) return <Text style={styles.section}>{item.header}</Text>;
    const on = isTrainingRunning(item);
    const dates = item.start_date && item.end_date
      ? `${format(parseISO(item.start_date), 'MMM d')} — ${format(parseISO(item.end_date), 'MMM d')}` : '';
    const until = item.training_until ? format(parseISO(item.training_until), 'MMM d') : null;
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.8}
        onPress={() => navigation.navigate('Trip', { tripId: item.id })} onLongPress={() => archiveTrip(item)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dates}>{dates}{until ? `  ·  ${on ? 'runs until' : 'ended'} ${until}` : ''}</Text>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.sub}>Training for {parentTitle(item.training_of)}{item.archived ? ' · archived' : ''}</Text>
        </View>
        <View style={[styles.dot, on && styles.dotOn]} />
        <Text style={styles.chev}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Training trips</Text>
      </View>
      <Text style={styles.intro}>
        Copies of your trips moved to today, planned every night on the real forecast and checked against the
        webcams and airports the next day. Each trip gets one automatically once its stops are rated.
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(item: any, i) => item.id ?? `h${i}`}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No training trips yet.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  intro: { ...typography.bodyMedium, color: colors.textSecondary, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  section: { ...typography.labelLarge, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  dates: { ...typography.labelMedium, marginBottom: spacing.xs },
  title: { fontFamily: 'Georgia', fontSize: 20, color: colors.textPrimary, marginBottom: 4 },
  sub: { ...typography.bodyMedium, color: colors.textTertiary },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.signalOk },
  chev: { color: '#444', fontSize: 18 },
  empty: { ...typography.bodyMedium, color: colors.textTertiary, paddingTop: spacing.xl },
});
