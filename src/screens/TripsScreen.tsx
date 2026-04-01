import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTripStore } from '../store/tripStore';
import { colors, typography, spacing, radius } from '../theme';
import { format, differenceInDays } from 'date-fns';
import * as Updates from 'expo-updates';
import { migratePhotosToStorage } from '../services/migratePhotos';

export default function TripsScreen() {
  const navigation = useNavigation<any>();
  const { trips, loadTrips, isOffline } = useTripStore();
  const [migrating, setMigrating] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  useEffect(() => {
    try {
      const updateDate = Updates.createdAt;
      if (updateDate) {
        setLastUpdate(format(new Date(updateDate), 'MMM d h:mm a'));
      }
    } catch {}
  }, []);

  useEffect(() => { loadTrips(); }, []);

  const handleLongPress = (item: any) => {
    Alert.alert(
      item.title,
      'Trip options',
      [
        {
          text: '📷 Migrate Photos to Storage',
          onPress: async () => {
            setMigrating(true);
            try {
              const result = await migratePhotosToStorage();
              Alert.alert('Done!', `Migrated ${result.migrated} photos. Reload the app to see them.`);
            } catch (e) {
              Alert.alert('Error', 'Could not migrate photos. Check your connection.');
            } finally {
              setMigrating(false);
            }
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const renderTrip = ({ item }: { item: any }) => {
    const start = item.start_date ? format(new Date(item.start_date), 'MMM d') : '';
    const end = item.end_date ? format(new Date(item.end_date), 'MMM d, yyyy') : '';
    const days = item.start_date && item.end_date
      ? differenceInDays(new Date(item.end_date), new Date(item.start_date))
      : null;

    return (
      <TouchableOpacity
        style={styles.tripCard}
        onPress={() => navigation.navigate('Trip', { tripId: item.id })}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.8}
      >
        <View style={styles.tripCardInner}>
          <View style={styles.tripLeft}>
            <Text style={styles.tripDates}>{start} — {end}</Text>
            <Text style={styles.tripTitle}>{item.title}</Text>
            {item.subtitle ? <Text style={styles.tripSub}>{item.subtitle}</Text> : null}
            {days ? <Text style={styles.tripMeta}>{days} days</Text> : null}
          </View>
          <Text style={{ color: '#444', fontSize: 18 }}>›</Text>
        </View>
        <View style={styles.tripDivider} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.header}>
        <Text style={styles.brand}>PHILM+FRAME</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {migrating && <ActivityIndicator size="small" color={colors.accentDim} />}
          {isOffline && <Text style={styles.offline}>OFFLINE</Text>}
        </View>
      </View>

      <Text style={styles.sectionLabel}>TRIPS</Text>
      {lastUpdate && (
        <Text style={styles.lastUpdate}>SYNCED {lastUpdate}</Text>
      )}

      {trips.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={item => item.id}
          renderItem={renderTrip}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  brand: { fontSize: 13, fontWeight: '700', letterSpacing: 2.5, color: colors.textPrimary },
  offline: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1, color: colors.textTertiary,
    borderWidth: 1, borderColor: colors.textTertiary,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm,
  },
  sectionLabel: { ...typography.labelLarge, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  list: { paddingHorizontal: spacing.xl },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tripCard: { marginBottom: spacing.md },
  tripCardInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.lg },
  tripLeft: { flex: 1 },
  tripDates: { ...typography.labelMedium, marginBottom: spacing.xs },
  tripTitle: { fontFamily: 'Georgia', fontSize: 24, color: colors.textPrimary, fontWeight: '400', marginBottom: 4 },
  tripSub: { ...typography.bodyMedium, marginBottom: 4 },
  tripMeta: { ...typography.labelMedium, color: colors.textTertiary },
  tripDivider: { height: 1, backgroundColor: colors.border },
  lastUpdate: { ...typography.labelMedium, color: colors.textTertiary, paddingHorizontal: spacing.xl, marginTop: -spacing.sm, paddingBottom: spacing.md },
});
