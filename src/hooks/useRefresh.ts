import { useState, useCallback } from 'react';
import { useTripStore } from '../store/tripStore';

/**
 * Drop-in pull-to-refresh for any FlatList or ScrollView.
 *
 * Usage:
 *   const { refreshing, onRefresh } = useRefresh();
 *   <FlatList refreshing={refreshing} onRefresh={onRefresh} ... />
 */
export function useRefresh(tripId?: string) {
  const [refreshing, setRefreshing] = useState(false);
  const { syncTrip, loadTrips, refreshCurrentTrip } = useTripStore();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (tripId) {
        await syncTrip(tripId);
      } else {
        await loadTrips();
      }
    } catch (err) {
      // Silently fail — user is probably offline
    } finally {
      setRefreshing(false);
    }
  }, [tripId]);

  return { refreshing, onRefresh };
}
